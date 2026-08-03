import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const authKey = typeof body?.keys?.auth === "string" ? body.keys.auth : null;

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: user.id, endpoint, p256dh, auth: authKey },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("Failed to save push subscription", error);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
