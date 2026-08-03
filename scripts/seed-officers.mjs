// One-time setup script: creates demo officer + admin accounts and points
// each officer at a department. Signup only ever creates citizens (see
// supabase/schema.sql handle_new_user trigger), so privileged accounts for
// the live demo are provisioned here via the service role key.
//
// Usage:
//   node scripts/seed-officers.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local (loaded automatically).

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

const ACCOUNTS = [
  { email: "admin@janreport.demo", fullName: "City Admin", role: "admin" },
  {
    email: "roads.officer@janreport.demo",
    fullName: "Roads Officer",
    role: "officer",
    departmentName: "Roads & Infrastructure",
  },
  {
    email: "water.officer@janreport.demo",
    fullName: "Water Officer",
    role: "officer",
    departmentName: "Water Supply & Sewerage",
  },
  {
    email: "sanitation.officer@janreport.demo",
    fullName: "Sanitation Officer",
    role: "officer",
    departmentName: "Sanitation & Waste Management",
  },
];

async function main() {
  const { data: departments, error: deptError } = await supabase
    .from("departments")
    .select("id, name");
  if (deptError) throw deptError;

  for (const account of ACCOUNTS) {
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      });

    let userId = created?.user?.id;

    if (createError) {
      if (createError.message.includes("already been registered")) {
        const { data: list } = await supabase.auth.admin.listUsers();
        userId = list.users.find((u) => u.email === account.email)?.id;
        console.log(`Already exists: ${account.email}`);
      } else {
        console.error(`Failed to create ${account.email}:`, createError.message);
        continue;
      }
    } else {
      console.log(`Created: ${account.email}`);
    }

    if (!userId) continue;

    const department = account.departmentName
      ? departments.find((d) => d.name === account.departmentName)
      : null;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        role: account.role,
        department_id: department?.id ?? null,
      })
      .eq("id", userId);

    if (updateError) {
      console.error(`Failed to set role for ${account.email}:`, updateError.message);
    } else {
      console.log(`  -> role=${account.role}${department ? ` dept=${department.name}` : ""}`);
    }
  }

  console.log(`\nDemo password for all seeded accounts: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
