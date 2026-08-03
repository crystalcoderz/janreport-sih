-- JanReport (SIH25031) — schema, RLS policies, triggers, seed data.
-- Run this once against a fresh Supabase project (SQL Editor -> New query).

create extension if not exists postgis;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------

create type user_role as enum ('citizen', 'officer', 'admin');

create type issue_status as enum (
  'reported',
  'acknowledged',
  'in_progress',
  'resolved',
  'rejected'
);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category_keys text[] not null default '{}'
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role user_role not null default 'citizen',
  department_id uuid references departments (id),
  points integer not null default 0,
  -- Geofencing: where to center "alert me about nearby issues" checks, and
  -- how far out. Null home_lat/home_lng means the resident hasn't opted in.
  home_lat double precision,
  home_lng double precision,
  home_location geography(point, 4326) generated always as (
    case
      when home_lat is null or home_lng is null then null
      else st_setsrid(st_makepoint(home_lng, home_lat), 4326)::geography
    end
  ) stored,
  notify_radius_m integer not null default 100 check (notify_radius_m between 25 and 5000),
  created_at timestamptz not null default now()
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id),
  title text not null,
  description text,
  ai_category text not null,
  ai_severity smallint not null check (ai_severity between 1 and 10),
  ai_severity_label text not null,
  ai_confidence numeric(4, 3) not null check (ai_confidence between 0 and 1),
  photo_url text not null,
  lat double precision not null,
  lng double precision not null,
  location geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(lng, lat), 4326)::geography
  ) stored,
  address text,
  status issue_status not null default 'reported',
  department_id uuid references departments (id),
  upvote_count integer not null default 0,
  duplicate_of uuid references issues (id),
  resolution_photo_url text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table issue_upvotes (
  issue_id uuid not null references issues (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create table issue_status_history (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id) on delete cascade,
  status issue_status not null,
  note text,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now()
);

-- Geofenced alerts: one row per (issue, nearby resident) fan-out, created
-- by the trigger below. Citizens read/mark-read their own rows only;
-- inserts only ever happen server-side via the security-definer trigger.
create table issue_notifications (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id) on delete cascade,
  recipient_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (issue_id, recipient_id)
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

create index issues_location_gix on issues using gist (location);
create index issues_department_id_idx on issues (department_id);
create index issues_status_idx on issues (status);
create index issues_ai_category_idx on issues (ai_category);
create index issues_created_at_idx on issues (created_at desc);
create index issue_status_history_issue_id_idx on issue_status_history (issue_id);
create index profiles_home_location_gix on profiles using gist (home_location)
  where home_location is not null;
create index issue_notifications_recipient_id_idx
  on issue_notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------
-- Functions & triggers
-- ---------------------------------------------------------------------

-- Auto-create a profile row (role defaults to citizen) whenever someone
-- signs up via Supabase Auth.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Block clients from self-escalating role/department/points via the
-- normal "update own profile" policy. Direct client updates land here at
-- trigger depth 1; pg_trigger_depth() > 1 means this update was issued
-- from inside another trigger (e.g. the points-award triggers below),
-- which is the only legitimate way these columns change post-signup.
create function prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and pg_trigger_depth() <= 1 then
    new.role := old.role;
    new.department_id := old.department_id;
    new.points := old.points;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileged_columns
  before update on profiles
  for each row execute function prevent_profile_privilege_escalation();

create function touch_issues_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger issues_set_updated_at
  before update on issues
  for each row execute function touch_issues_updated_at();

-- Keep issues.upvote_count in sync with issue_upvotes rows.
create function apply_upvote_delta()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update issues set upvote_count = upvote_count + 1 where id = new.issue_id;
    return new;
  elsif tg_op = 'DELETE' then
    update issues set upvote_count = greatest(upvote_count - 1, 0) where id = old.issue_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger issue_upvotes_apply_delta
  after insert or delete on issue_upvotes
  for each row execute function apply_upvote_delta();

-- Gamification: points are only ever changed here, never by direct client
-- writes (see prevent_profile_privilege_escalation above).
create function award_points_on_issue_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set points = points + 5 where id = new.reporter_id;
  return new;
end;
$$;

create trigger issues_award_points_on_report
  after insert on issues
  for each row execute function award_points_on_issue_report();

create function award_points_on_issue_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    update profiles set points = points + 15 where id = new.reporter_id;
  end if;
  return new;
end;
$$;

create trigger issues_award_points_on_resolved
  after update on issues
  for each row execute function award_points_on_issue_resolved();

-- Radius search used by the dedupe check when a new issue is submitted.
-- SECURITY INVOKER (default) so it still respects the caller's RLS.
create function nearby_open_issues(
  p_category text,
  p_lng double precision,
  p_lat double precision,
  p_radius_m integer default 75
)
returns setof issues
language sql
stable
as $$
  select *
  from issues
  where ai_category = p_category
    and status not in ('resolved', 'rejected')
    and duplicate_of is null
    and st_dwithin(
      location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
  order by created_at desc;
$$;

-- Geofencing: categories where one report signals a hazard/disruption for
-- the whole surrounding area (a water outage, not just a single pothole),
-- so they're worth pushing to nearby residents who never saw the report.
-- Must stay in sync with AREA_ALERT_CATEGORIES in lib/departments.ts.
create function area_alert_categories()
returns text[]
language sql
immutable
as $$
  select array[
    'water_supply',
    'drainage_sewage',
    'electricity_outage',
    'pollution'
  ];
$$;

-- Fans out a row per nearby opted-in resident whenever an area-alert-worthy
-- issue is reported, so the geofenced "water shortage nearby, be aware"
-- notification (see lib/hooks/use-issue-notifications.ts) has something to
-- subscribe to. SECURITY DEFINER because inserting on another citizen's
-- behalf would otherwise be blocked by issue_notifications' own RLS.
create function notify_nearby_residents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ai_category = any(area_alert_categories()) then
    insert into issue_notifications (issue_id, recipient_id)
    select new.id, p.id
    from profiles p
    where p.home_location is not null
      and p.id <> new.reporter_id
      and st_dwithin(p.home_location, new.location, p.notify_radius_m)
    on conflict (issue_id, recipient_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger issues_notify_nearby_residents
  after insert on issues
  for each row execute function notify_nearby_residents();

-- Recipients may only toggle read_at on their own notifications, never
-- reassign a row to themselves or point it at a different issue.
create function prevent_issue_notification_tamper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.issue_id := old.issue_id;
  new.recipient_id := old.recipient_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger issue_notifications_guard_columns
  before update on issue_notifications
  for each row execute function prevent_issue_notification_tamper();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table departments enable row level security;
alter table issues enable row level security;
alter table issue_upvotes enable row level security;
alter table issue_status_history enable row level security;
alter table issue_notifications enable row level security;

-- profiles: any signed-in user can read profiles (names/roles are not
-- sensitive here); users may only edit their own row, and privileged
-- columns are guarded by the trigger above.
create policy "profiles_select_authenticated" on profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- departments: public read-only reference data.
create policy "departments_select_all" on departments
  for select to authenticated using (true);

-- issues: readable by any signed-in user (public transparency, dedupe
-- checks, and upvoting all depend on this). Citizens can only create
-- issues they report. Only officers (own department) or admins may
-- update status/resolution fields.
create policy "issues_select_authenticated" on issues
  for select to authenticated using (true);

create policy "issues_insert_own" on issues
  for insert to authenticated with check (reporter_id = auth.uid());

create policy "issues_update_officer_admin" on issues
  for update to authenticated using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('officer', 'admin')
        and (p.role = 'admin' or p.department_id = issues.department_id)
    )
  );

-- issue_upvotes: any signed-in user can upvote/un-upvote, only as themselves.
create policy "issue_upvotes_select_authenticated" on issue_upvotes
  for select to authenticated using (true);

create policy "issue_upvotes_insert_own" on issue_upvotes
  for insert to authenticated with check (user_id = auth.uid());

create policy "issue_upvotes_delete_own" on issue_upvotes
  for delete to authenticated using (user_id = auth.uid());

-- issue_status_history: readable by all (citizen-facing timeline), only
-- writable by officers/admins recording a status change they made.
create policy "issue_status_history_select_authenticated" on issue_status_history
  for select to authenticated using (true);

create policy "issue_status_history_insert_officer_admin" on issue_status_history
  for insert to authenticated with check (
    changed_by = auth.uid()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  );

-- issue_notifications: recipients can read and mark-read their own
-- geofenced alerts. No insert/delete policy for authenticated users —
-- rows are only ever created by the security-definer trigger above.
create policy "issue_notifications_select_own" on issue_notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy "issue_notifications_update_own" on issue_notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime: let the officer dashboard subscribe to live issue changes,
-- and citizens subscribe to their own geofenced alerts.
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table issues;
alter publication supabase_realtime add table issue_notifications;

-- ---------------------------------------------------------------------
-- Storage: public bucket for issue photos
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('issue-photos', 'issue-photos', true)
on conflict (id) do nothing;

create policy "issue_photos_public_read" on storage.objects
  for select using (bucket_id = 'issue-photos');

create policy "issue_photos_authenticated_upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'issue-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- Seed departments (Govt of Jharkhand-style municipal structure).
-- category_keys map to the AI classifier's category taxonomy — see
-- lib/departments.ts, which must stay in sync with these values.
-- ---------------------------------------------------------------------

insert into departments (name, category_keys) values
  ('Roads & Infrastructure', array['pothole', 'road_damage']),
  ('Water Supply & Sewerage', array['water_supply', 'drainage_sewage']),
  ('Electricity Department', array['electricity_outage', 'streetlight']),
  ('Sanitation & Waste Management', array['garbage_waste', 'pollution']),
  ('Traffic & Public Safety', array['traffic_safety', 'accident']),
  ('Parks, Environment & Horticulture', array['tree_park']),
  ('General Administration', array['other']);
