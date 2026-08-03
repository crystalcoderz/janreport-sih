# JanReport — Crowdsourced Civic Issue Reporting & Resolution System

Built for **SIH25031** (Govt of Jharkhand, Clean & Green Technology theme).

Citizens report civic issues (potholes, garbage, water/electricity faults, accidents, etc.)
with a photo and GPS location. AI (Claude vision) classifies the issue and scores its
severity, the system auto-routes it to the responsible municipal department, officers
manage resolution on a live dashboard, and status flows back to the citizen in real time.

## Stack

- **Next.js 16** (App Router, TypeScript) — citizen PWA, officer/admin dashboard, and API
  routes in one codebase
- **Supabase** — Postgres (+ PostGIS), Auth, Storage, Realtime
- **Claude (Anthropic API)** — vision-based issue classification & severity scoring
- **Leaflet** — live issue map, severity markers, heatmap

## One-time setup

1. **Install dependencies** (already done if you're reading this after the initial build):
   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com/dashboard) (free
   tier is fine).

3. **Run the schema.** In the Supabase dashboard, open SQL Editor -> New query, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates all
   tables, RLS policies, triggers, the `issue-photos` storage bucket, and seeds the
   municipal departments.

4. **Get an Anthropic API key** at [console.anthropic.com](https://console.anthropic.com).

5. **Configure environment variables.** Copy `.env.local.example` to `.env.local` and fill
   in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings -> API
   - `SUPABASE_SERVICE_ROLE_KEY` — same page (keep secret, server-only)
   - `ANTHROPIC_API_KEY`

6. **Seed demo officer/admin accounts** (citizen signup is self-serve, but officer/admin
   accounts are provisioned separately so nobody can grant themselves department powers):
   ```bash
   node scripts/seed-officers.mjs
   ```
   This creates `admin@janreport.demo`, `roads.officer@janreport.demo`,
   `water.officer@janreport.demo`, and `sanitation.officer@janreport.demo`, all with
   password `JanReport@2026`.

7. **(Optional) Seed demo issues** so the dashboard/map/analytics aren't empty on first
   run:
   ```bash
   node scripts/seed-demo-issues.mjs
   ```
   Inserts ~17 sample issues across categories/severities/statuses around Ranchi, with
   realistic status timelines and a few upvotes, using placeholder photos.

8. **Run the app:**
   ```bash
   npm run dev
   ```

## Demo script (two-screen live update)

1. Open `/report` in one browser/tab, signed in as a citizen. Open `/dashboard` in a
   second tab/window, signed in as `roads.officer@janreport.demo`.
2. Submit a report with a photo of a pothole/road damage on the citizen screen.
3. Watch it appear instantly on the officer dashboard (Supabase Realtime) with AI-assigned
   category, severity, and department routing already applied.
4. Update its status on the officer screen (Acknowledged -> In Progress -> Resolved,
   optionally attaching a resolution photo).
5. Watch the citizen's `/my-reports` timeline update live to match.
6. Show `/map` for the live severity map + heatmap, and `/leaderboard` /
   `/analytics` (admin) for the gamification and city-wide stats differentiators.

## Project structure

See [`supabase/schema.sql`](supabase/schema.sql) for the data model and
`lib/departments.ts` for the AI category taxonomy / department routing table (the two
must stay in sync).
