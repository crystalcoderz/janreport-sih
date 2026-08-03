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
   - `WHATSAPP_*` — optional, see [WhatsApp integration](#whatsapp-integration-meta-cloud-api)
     below. Everything else works without these.

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
7. Geofenced alerts: on a second citizen account, visit `/alerts` and save the
   current location as the alert location (radius defaults to 100m). Submit a
   water/electricity/drainage/pollution report from the first account within
   that radius — the second account gets a live "reported nearby, be aware"
   alert via the notification bell (and a browser notification if the tab is
   backgrounded), without ever visiting the issue.

## WhatsApp integration (Meta Cloud API)

Two independent features run on the [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api):
citizens can log in with a phone number (OTP delivered over WhatsApp instead of
email/password), and a chatbot on the same number lets citizens file a report by
sending a photo and a location, no app or login required. Both are fully
implemented and typechecked, but need your own Meta app + WhatsApp Business
Account to actually send/receive messages — without it, the OTP flow still
works in a **dev/demo mode** (the code is logged to the server console and
returned in the API response instead of being sent) and the chatbot webhook
simply has nothing to call it.

### Setup

1. Create a [Meta App](https://developers.facebook.com/apps) with the WhatsApp
   product added, and a WhatsApp Business Account (WABA) with a test or
   production phone number.
2. Set these env vars (server-only, never exposed to the client):
   - `WHATSAPP_PHONE_NUMBER_ID` — from the WhatsApp > API Setup page.
   - `WHATSAPP_ACCESS_TOKEN` — a permanent access token for the app (temporary
     tokens from the quickstart page expire in 24h).
   - `WHATSAPP_APP_SECRET` — App Settings -> Basic. Used to verify the
     `X-Hub-Signature-256` header on inbound webhook calls; **without it, the
     webhook skips signature verification** (logged as a warning) — fine for
     local testing, not for a public deployment.
   - `WHATSAPP_VERIFY_TOKEN` — any string you choose; used once, when Meta
     verifies the webhook URL (step 4).
   - `WHATSAPP_OTP_TEMPLATE_NAME` — optional. Meta only allows free-form
     business-initiated messages within a 24h window after the user last
     messaged you; for OTPs sent outside that window you need an
     **approved "authentication" template** (WhatsApp Manager -> Message
     Templates) and set its name here. Without it, OTPs send as a plain text
     message, which only works within that 24h window (e.g. test numbers, or
     a citizen who just messaged the bot).
3. Point your app's redeploy/tunnel URL at `POST /api/whatsapp/webhook` in
   Meta's WhatsApp > Configuration page, subscribed to the `messages` field.
4. Meta will call `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...`
   once to confirm the URL — it must echo back `hub.challenge`, which the
   route already handles as long as `WHATSAPP_VERIFY_TOKEN` matches.

### How it works

- **Login** (`/login` -> WhatsApp tab): `POST /api/auth/whatsapp/request-otp`
  generates and sends a 6-digit code (`lib/whatsapp/otp.ts`);
  `POST /api/auth/whatsapp/verify-otp` checks it, then either finds the
  existing profile for that phone number or provisions a new one
  (`lib/whatsapp/profile.ts` — Supabase Auth still needs an email internally,
  so a deterministic, never-shown shadow address is used), and bootstraps a
  real Supabase session server-side via `admin.generateLink` +
  `auth.verifyOtp` (no separate SMS/phone provider involved).
- **Reporting bot** (`app/api/whatsapp/webhook/route.ts`): a citizen sends a
  photo, then a location (as two separate WhatsApp messages); the webhook
  holds the in-progress report in `whatsapp_report_sessions` until both
  arrive, then runs the same AI classification + department routing as the
  web `/report` flow and replies with the result. Duplicate detection is
  skipped for WhatsApp reports (the "is this a duplicate?" back-and-forth
  doesn't map well onto a chat), so every WhatsApp report files as new.

## Project structure

See [`supabase/schema.sql`](supabase/schema.sql) for the data model and
`lib/departments.ts` for the AI category taxonomy / department routing table (the two
must stay in sync).
