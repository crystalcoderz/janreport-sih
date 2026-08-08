-- JanReport (SIH25031) — schema, RLS policies, triggers, seed data.
-- Run this once against a fresh Supabase project (SQL Editor -> New query).

-- Known, accepted Supabase advisor findings after running this file:
-- - `spatial_ref_sys` (RLS disabled) and `extension_in_public` (postgis)
--   are PostGIS/extension-owned; the connecting role isn't the owner, so
--   they can't be fixed via migration, and they carry no sensitive data
--   (spatial_ref_sys is just public SRID reference rows).
-- - `st_estimatedextent` "SECURITY DEFINER exposed to anon" is a PostGIS-
--   internal function, not ours to touch.
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

create type volunteer_offer_status as enum (
  'offered',
  'accepted',
  'completed',
  'withdrawn'
);

-- AI-verified resolution: Gemini compares the officer's resolution photo
-- against the original report photo, so "resolved" is backed by evidence
-- rather than being an unverifiable claim.
create type resolution_verdict as enum ('verified', 'not_fixed', 'unclear');

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
  -- Set for citizens who signed up / logged in via the WhatsApp OTP flow
  -- (see lib/whatsapp/otp.ts). Unique but nullable — most profiles won't
  -- have one.
  phone text unique,
  created_at timestamptz not null default now()
);

-- Field crews a department dispatches to an issue. Routing picks the
-- department; this is the next step down — which crew owns the job.
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references departments (id) on delete set null,
  contact_phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index teams_department_id_idx on teams (department_id);

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
  -- Set by lib/ai/verify-resolution.ts after a resolution photo is
  -- attached; null means never verified (no photo, or AI unavailable).
  resolution_verdict resolution_verdict,
  resolution_verdict_reason text,
  resolution_verdict_confidence numeric(4, 3)
    check (resolution_verdict_confidence is null
           or resolution_verdict_confidence between 0 and 1),
  resolution_verified_at timestamptz,
  assigned_team_id uuid references teams (id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_assigned_team_id_idx on issues (assigned_team_id);

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

-- Discussion threads: public comments on a reported issue ("this pothole
-- has been here for 3 months"). Flat (no replies) by design — keep it
-- simple, matches how issue_status_history is a flat append-only log too.
create table issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- NGOs / citizen groups that register to help resolve smaller issues
-- (garbage cleanups, tree planting, etc). `verified` is admin/officer-only
-- (see the guard trigger below) so the directory can flag legitimate orgs.
create table volunteer_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  contact_phone text,
  contact_email text,
  categories text[] not null default '{}',
  created_by uuid not null references profiles (id) on delete cascade,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- One row per citizen/group that offers to help with a specific issue.
-- volunteer_group_id is null for an individual citizen offering directly.
create table issue_volunteer_offers (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues (id) on delete cascade,
  volunteer_group_id uuid references volunteer_groups (id) on delete set null,
  offered_by uuid not null references profiles (id) on delete cascade,
  status volunteer_offer_status not null default 'offered',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, offered_by)
);

-- ---------------------------------------------------------------------
-- WhatsApp integration
-- ---------------------------------------------------------------------

-- OTP codes for the WhatsApp login flow (lib/whatsapp/otp.ts). Never
-- exposed via RLS — only the service-role client (server-only) touches
-- this table, matching how issue_notifications inserts are locked down.
create table whatsapp_otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Scratch space for an in-progress "report an issue" conversation over
-- WhatsApp (see app/api/whatsapp/webhook/route.ts) — a citizen sends a
-- photo and a location as separate messages, so we hold the photo here
-- (base64 — small enough at this scale, and avoids uploading to storage
-- twice) until both pieces have arrived and the report can be filed.
create table whatsapp_report_sessions (
  phone text primary key,
  photo_base64 text,
  photo_mime_type text,
  lat double precision,
  lng double precision,
  note text,
  updated_at timestamptz not null default now()
);

-- Meta retries a webhook delivery if it isn't acknowledged fast enough.
-- Claiming the message id here makes handling idempotent, so a retry
-- can't produce a second reply to the same citizen message.
create table whatsapp_processed_messages (
  message_id text primary key,
  processed_at timestamptz not null default now()
);

create index whatsapp_processed_messages_processed_at_idx
  on whatsapp_processed_messages (processed_at);

-- ---------------------------------------------------------------------
-- Web Push
-- ---------------------------------------------------------------------

-- One row per browser/device a citizen has enabled push notifications on
-- (a citizen can have several — phone + laptop, etc). Sent to by
-- lib/push/fanout.ts whenever the geofencing trigger above creates
-- issue_notifications rows, so alerts still arrive with the tab closed.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

create index issues_location_gix on issues using gist (location);
create index issues_department_id_idx on issues (department_id);
create index issues_status_idx on issues (status);
create index issues_ai_category_idx on issues (ai_category);
create index issues_created_at_idx on issues (created_at desc);
-- Admin analytics wants "resolved but AI says otherwise" fast.
create index issues_resolution_verdict_idx
  on issues (resolution_verdict)
  where resolution_verdict is not null;
create index issue_status_history_issue_id_idx on issue_status_history (issue_id);
create index profiles_home_location_gix on profiles using gist (home_location)
  where home_location is not null;
create index issue_notifications_recipient_id_idx
  on issue_notifications (recipient_id, created_at desc);
create index issue_comments_issue_id_idx
  on issue_comments (issue_id, created_at asc);
create index issue_volunteer_offers_issue_id_idx
  on issue_volunteer_offers (issue_id);
create index issue_volunteer_offers_group_id_idx
  on issue_volunteer_offers (volunteer_group_id);
create index volunteer_groups_created_by_idx
  on volunteer_groups (created_by);
create index whatsapp_otp_codes_phone_idx
  on whatsapp_otp_codes (phone, created_at desc);
create index push_subscriptions_user_id_idx
  on push_subscriptions (user_id);

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
set search_path = public
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
set search_path = public
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
set search_path = public
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
set search_path = public
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

create function touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger issue_volunteer_offers_set_updated_at
  before update on issue_volunteer_offers
  for each row execute function touch_updated_at();

-- Only an officer/admin may flip a volunteer group's `verified` flag —
-- otherwise a group could self-certify as legitimate. Mirrors
-- prevent_profile_privilege_escalation's approach above.
create function prevent_volunteer_group_self_verify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verified is distinct from old.verified
    and not exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  then
    new.verified := old.verified;
  end if;
  return new;
end;
$$;

create trigger volunteer_groups_guard_verified
  before update on volunteer_groups
  for each row execute function prevent_volunteer_group_self_verify();

-- These are all trigger-only functions (return type "trigger"), so
-- Postgres already refuses to run them outside an actual trigger context
-- — but Supabase grants EXECUTE on every public-schema function to
-- anon/authenticated by default, and being SECURITY DEFINER makes that a
-- real (if inert) RPC exposure the linter flags. Revoke the unnecessary
-- grant; PostgREST/anon and authenticated must go from PUBLIC *and* the
-- named roles, since Supabase grants them explicitly, not just via PUBLIC.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function prevent_profile_privilege_escalation() from public, anon, authenticated;
revoke execute on function award_points_on_issue_report() from public, anon, authenticated;
revoke execute on function award_points_on_issue_resolved() from public, anon, authenticated;
revoke execute on function notify_nearby_residents() from public, anon, authenticated;
revoke execute on function prevent_issue_notification_tamper() from public, anon, authenticated;
revoke execute on function prevent_volunteer_group_self_verify() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table departments enable row level security;
alter table issues enable row level security;
alter table issue_upvotes enable row level security;
alter table issue_status_history enable row level security;
alter table issue_notifications enable row level security;
alter table issue_comments enable row level security;
alter table volunteer_groups enable row level security;
alter table issue_volunteer_offers enable row level security;
-- No policies: whatsapp_otp_codes and whatsapp_report_sessions are
-- service-role-only, so RLS with zero grants blocks every client-side
-- (anon/authenticated) access outright.
alter table whatsapp_otp_codes enable row level security;
alter table whatsapp_report_sessions enable row level security;
alter table whatsapp_processed_messages enable row level security;
alter table teams enable row level security;

-- Any signed-in staff member needs to read the crew list to assign work;
-- only admins curate it.
-- Crew rosters carry direct contact numbers for municipal field staff and
-- are only ever rendered on officer screens.
create policy "teams_select_officer_admin" on teams
  for select to authenticated using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  );

create policy "teams_admin_manage" on teams
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
alter table push_subscriptions enable row level security;

-- profiles: any signed-in user can read profiles (names/roles are not
-- sensitive here); users may only edit their own row, and privileged
-- columns are guarded by the trigger above.
create policy "profiles_select_authenticated" on profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- RLS is row-level only, so the policy above would still expose every
-- resident's phone number and exact home coordinates to any signed-in
-- user. Column grants are the missing half: cross-user reads are narrowed
-- to the display fields the UI actually joins on (profiles(full_name)).
revoke select on profiles from authenticated;
grant select (id, full_name, role, department_id, points, created_at)
  on profiles to authenticated;

revoke update on profiles from authenticated;
grant update (full_name, home_lat, home_lng, notify_radius_m)
  on profiles to authenticated;

-- Own profile still needs the full row (home location for geofenced
-- alerts). SECURITY DEFINER to see the withheld columns, hard-scoped to
-- auth.uid() so it can never return anyone else's.
create or replace function get_my_profile()
returns setof profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from profiles where id = auth.uid();
$$;

revoke all on function get_my_profile() from public, anon;
grant execute on function get_my_profile() to authenticated;

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

-- RLS scopes which ROWS an officer/admin may touch, but has no opinion on
-- which COLUMNS — without this, an officer could rewrite title, photo_url,
-- reporter_id, the AI fields, or even department_id (letting them escape
-- department scoping on their next update). The app's officer-facing
-- routes (status update, crew assignment) only ever write this exact
-- column set.
revoke update on issues from authenticated;
grant update (
  status,
  resolution_photo_url,
  resolution_note,
  resolution_verdict,
  resolution_verdict_reason,
  resolution_verdict_confidence,
  resolution_verified_at,
  assigned_team_id,
  assigned_at
) on issues to authenticated;

-- issues_insert_own (citizens filing a report) still needs its full column
-- set — the revoke above only narrowed UPDATE, not INSERT.
grant insert on issues to authenticated;

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

-- Department-scoped, matching issues_update_officer_admin — checking only
-- the actor's role would let any officer write timeline entries onto
-- another department's issues.
create policy "issue_status_history_insert_officer_admin" on issue_status_history
  for insert to authenticated with check (
    changed_by = auth.uid()
    and exists (
      select 1
      from profiles p
      join issues i on i.id = issue_status_history.issue_id
      where p.id = auth.uid()
        and p.role in ('officer', 'admin')
        and (p.role = 'admin' or p.department_id = i.department_id)
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

-- issue_comments: readable by all (public discussion thread), only
-- writable/deletable by the comment's own author. No edits — matches the
-- append-only spirit of issue_status_history.
create policy "issue_comments_select_authenticated" on issue_comments
  for select to authenticated using (true);

create policy "issue_comments_insert_own" on issue_comments
  for insert to authenticated with check (author_id = auth.uid());

create policy "issue_comments_delete_own" on issue_comments
  for delete to authenticated using (author_id = auth.uid());

-- volunteer_groups: public directory (readable by all signed-in users),
-- self-registered by any citizen, editable by the group's own registrant
-- or an officer/admin (the only ones who can flip `verified`, guarded
-- above).
create policy "volunteer_groups_select_authenticated" on volunteer_groups
  for select to authenticated using (true);

create policy "volunteer_groups_insert_own" on volunteer_groups
  for insert to authenticated with check (created_by = auth.uid());

create policy "volunteer_groups_update_own_or_officer_admin" on volunteer_groups
  for update to authenticated using (
    created_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  ) with check (
    created_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  );

-- issue_volunteer_offers: readable by all (transparency on who's helping),
-- offered only as yourself, withdrawn/updated only by the offerer or an
-- officer/admin (to mark accepted/completed).
create policy "issue_volunteer_offers_select_authenticated" on issue_volunteer_offers
  for select to authenticated using (true);

create policy "issue_volunteer_offers_insert_own" on issue_volunteer_offers
  for insert to authenticated with check (offered_by = auth.uid());

create policy "issue_volunteer_offers_update_own_or_officer_admin" on issue_volunteer_offers
  for update to authenticated using (
    offered_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  ) with check (
    offered_by = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('officer', 'admin')
    )
  );

-- push_subscriptions: a citizen manages only their own devices. Fan-out
-- (reading other users' subscriptions to send them a push) always goes
-- through the service-role client in lib/push/fanout.ts, which bypasses
-- RLS — no broader select policy is needed here.
create policy "push_subscriptions_select_own" on push_subscriptions
  for select to authenticated using (user_id = auth.uid());

create policy "push_subscriptions_insert_own" on push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

create policy "push_subscriptions_update_own" on push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own" on push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime: let the officer dashboard subscribe to live issue changes,
-- citizens subscribe to their own geofenced alerts, issue detail pages
-- subscribe to new discussion comments, and volunteer offers update live.
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table issues;
alter publication supabase_realtime add table issue_notifications;
alter publication supabase_realtime add table issue_comments;
alter publication supabase_realtime add table issue_volunteer_offers;

-- ---------------------------------------------------------------------
-- Storage: public bucket for issue photos
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('issue-photos', 'issue-photos', true)
on conflict (id) do nothing;

-- No SELECT policy needed: a public bucket already bypasses storage RLS
-- entirely for reads (Supabase docs: "public buckets... bypasses access
-- controls for retrieving and serving files"). Adding one anyway would
-- only grant a side effect the linter flags — LISTing every file in the
-- bucket (enumerating other citizens' report photos), not just fetching
-- a known URL.

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
