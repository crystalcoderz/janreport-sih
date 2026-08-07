// Populates the database with a realistic spread of demo issues (varied
// categories/severities/statuses/locations around Ranchi) so the officer
// dashboard, public map, and analytics page look populated on first run,
// without having to live-submit a dozen reports through the UI.
//
// Uses the service role key, so it bypasses RLS entirely — the
// award_points_on_issue_report / _resolved triggers still fire normally
// since triggers run regardless of how the row was written.
//
// Usage: node scripts/seed-demo-issues.mjs
// Run scripts/seed-officers.mjs first so officer accounts exist to
// attribute status changes to.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnvLocal() {
  try {
    const content = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  } catch {
    // .env.local not found — assume env vars are already set
  }
}

loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = "JanReport@2026";

// Where the seeded issues cluster. Defaults to Ranchi (the SIH25031
// problem statement's city), but override it so demo data lands near
// wherever the live demo is actually being given — otherwise seeded and
// live-reported issues sit hundreds of km apart and the map looks broken.
//   node scripts/seed-demo-issues.mjs --center 28.31,77.52
const RANCHI_CENTER = { lat: 23.3441, lng: 85.3096 };
const centerArgIndex = process.argv.indexOf("--center");
const CENTER =
  centerArgIndex !== -1 && process.argv[centerArgIndex + 1]
    ? (([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }))(
        process.argv[centerArgIndex + 1].split(",")
      )
    : RANCHI_CENTER;

if (Number.isNaN(CENTER.lat) || Number.isNaN(CENTER.lng)) {
  console.error("Invalid --center value. Expected: --center <lat>,<lng>");
  process.exit(1);
}

const DEMO_CITIZENS = [
  "Aarav Kumar",
  "Priya Sharma",
  "Rohit Singh",
  "Sneha Devi",
  "Vikram Oraon",
];

// [category, severity, title, description, statusIndex] — statusIndex:
// 0 = reported, 1 = acknowledged, 2 = in_progress, 3 = resolved, 4 = rejected
const SAMPLE_ISSUES = [
  ["pothole", 8, "Deep pothole on Main Road", "Large pothole causing traffic to swerve dangerously near the market junction.", 0],
  ["pothole", 5, "Cracked pavement near school", "Cracked road surface outside a school gate, minor but growing.", 2],
  ["road_damage", 9, "Collapsed road shoulder after rain", "Road shoulder has eroded, exposing a drop-off next to moving traffic.", 1],
  ["water_supply", 7, "No water supply for 2 days", "Entire block has had no piped water supply since Monday.", 0],
  ["water_supply", 4, "Low water pressure", "Water pressure has been unusually low in the mornings.", 3],
  ["drainage_sewage", 9, "Open sewage overflow", "Sewage overflowing onto the street, strong odor, health hazard.", 1],
  ["drainage_sewage", 6, "Blocked storm drain", "Storm drain clogged with debris, causing waterlogging after rain.", 2],
  ["electricity_outage", 8, "Frequent power cuts in evening", "Power goes out almost every evening for 1-2 hours.", 0],
  ["electricity_outage", 10, "Sparking transformer", "Transformer sparking visibly, extremely dangerous, needs urgent attention.", 1],
  ["streetlight", 3, "Streetlight not working", "Streetlight on the corner has been off for two weeks, area is dark at night.", 3],
  ["garbage_waste", 6, "Garbage not collected for a week", "Household waste piling up, collection truck hasn't come in over a week.", 0],
  ["garbage_waste", 5, "Overflowing public bin", "Public garbage bin overflowing near the bus stand.", 3],
  ["pollution", 7, "Open burning of waste", "Someone is burning plastic waste openly, causing heavy smoke.", 2],
  ["traffic_safety", 6, "Missing traffic signal", "Traffic signal at a busy junction has been non-functional.", 0],
  ["accident", 9, "Accident-prone unmarked turn", "Sharp unmarked turn has caused multiple minor accidents this month.", 1],
  ["tree_park", 7, "Fallen tree blocking path", "A large tree fell across the walking path after the storm.", 3],
  ["tree_park", 2, "Park bench damaged", "One of the park benches is broken and needs repair.", 4],
];

function jitter(center, maxKm = 4) {
  const degPerKm = 1 / 111;
  const dLat = (Math.random() - 0.5) * 2 * maxKm * degPerKm;
  const dLng = (Math.random() - 0.5) * 2 * maxKm * degPerKm;
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

// Same Google-then-Nominatim approach as lib/geo.ts, inlined here since
// this script runs outside Next's module resolution. Best-effort: a null
// address is fine, the UI falls back to raw coordinates.
async function reverseGeocode(lat, lng) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  try {
    if (key) {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`
      );
      const data = await res.json();
      const formatted = data.results?.[0]?.formatted_address;
      if (formatted) return formatted;
    }
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { "Accept-Language": "en", "User-Agent": "JanReport/1.0" } }
    );
    const data = await res.json();
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

function severityLabel(score) {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 5) return "Moderate";
  if (score >= 3) return "Low";
  return "Minimal";
}

const STATUS_FLOW = ["reported", "acknowledged", "in_progress", "resolved", "rejected"];

async function ensureCitizens() {
  const ids = [];
  for (let i = 0; i < DEMO_CITIZENS.length; i++) {
    const email = `demo.citizen${i + 1}@janreport.demo`;
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEMO_CITIZENS[i] },
    });

    let userId = created?.user?.id;
    if (error) {
      if (error.message.includes("already been registered")) {
        const { data: list } = await supabase.auth.admin.listUsers();
        userId = list.users.find((u) => u.email === email)?.id;
      } else {
        console.error(`Failed to create ${email}:`, error.message);
        continue;
      }
    }
    if (userId) ids.push(userId);
  }
  return ids;
}

async function main() {
  console.log("Ensuring demo citizen accounts...");
  const citizenIds = await ensureCitizens();
  if (citizenIds.length === 0) throw new Error("No demo citizens available");

  const { data: departments } = await supabase.from("departments").select("*");
  const { data: officers } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "officer");
  const officerId = officers?.[0]?.id ?? null;

  console.log(`Seeding ${SAMPLE_ISSUES.length} demo issues...`);

  for (let i = 0; i < SAMPLE_ISSUES.length; i++) {
    const [category, severity, title, description, statusIdx] = SAMPLE_ISSUES[i];
    const reporterId = citizenIds[i % citizenIds.length];
    const { lat, lng } = jitter(CENTER);
    const department = departments?.find((d) => d.category_keys.includes(category));
    const status = STATUS_FLOW[statusIdx];
    const createdAt = new Date(Date.now() - (SAMPLE_ISSUES.length - i) * 6 * 3_600_000);

    const { data: issue, error } = await supabase
      .from("issues")
      .insert({
        reporter_id: reporterId,
        title,
        description,
        ai_category: category,
        ai_severity: severity,
        ai_severity_label: severityLabel(severity),
        ai_confidence: 0.82 + Math.random() * 0.15,
        photo_url: `https://picsum.photos/seed/janreport-${i}/800/600`,
        lat,
        lng,
        address: await reverseGeocode(lat, lng),
        department_id: department?.id ?? null,
        status: "reported", // always insert as reported, then walk forward below
        created_at: createdAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error(`Failed to insert "${title}":`, error.message);
      continue;
    }

    // Walk the issue through its status history so timelines/analytics
    // (avg resolution time) have real data to show.
    let cursor = createdAt;
    for (let s = 1; s <= statusIdx; s++) {
      cursor = new Date(cursor.getTime() + (2 + Math.random() * 6) * 3_600_000);
      await supabase
        .from("issues")
        .update({ status: STATUS_FLOW[s] })
        .eq("id", issue.id);
      await supabase.from("issue_status_history").insert({
        issue_id: issue.id,
        status: STATUS_FLOW[s],
        changed_by: officerId,
        changed_at: cursor.toISOString(),
      });
    }

    // Sprinkle a few upvotes from other demo citizens.
    const upvoterCount = Math.floor(Math.random() * 4);
    const upvoters = citizenIds.filter((id) => id !== reporterId).slice(0, upvoterCount);
    for (const upvoterId of upvoters) {
      await supabase
        .from("issue_upvotes")
        .insert({ issue_id: issue.id, user_id: upvoterId });
    }

    console.log(`  -> ${title} [${status}]`);
  }

  console.log("\nDone. Refresh /dashboard, /map, or /analytics to see the seeded data.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
