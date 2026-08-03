import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyIssuePhoto } from "@/lib/ai/classify";
import { reverseGeocode } from "@/lib/geo";
import { pushNearbyIssueAlerts } from "@/lib/push/fanout";

export const runtime = "nodejs";

const DEDUPE_RADIUS_M = 75;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const photo = formData.get("photo");
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  const note = formData.get("note")?.toString().slice(0, 500) || undefined;
  const forceNew = formData.get("forceNew") === "true";

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Photo is required" }, { status: 400 });
  }
  if (!photo.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Uploaded file must be an image" },
      { status: 400 }
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "Photo must be under 8MB" },
      { status: 400 }
    );
  }
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json(
      { error: "A valid GPS location is required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await photo.arrayBuffer());

  let classification;
  try {
    classification = await classifyIssuePhoto({
      imageBase64: buffer.toString("base64"),
      mimeType: photo.type,
      note,
    });
  } catch (err) {
    console.error("AI classification failed", err);
    return NextResponse.json(
      { error: "AI classification failed. Please try again." },
      { status: 502 }
    );
  }

  if (!forceNew) {
    const { data: nearby, error: nearbyError } = await supabase.rpc(
      "nearby_open_issues",
      {
        p_category: classification.category,
        p_lng: lng,
        p_lat: lat,
        p_radius_m: DEDUPE_RADIUS_M,
      }
    );

    if (nearbyError) {
      console.error("Dedupe lookup failed", nearbyError);
    } else if (nearby && nearby.length > 0) {
      return NextResponse.json({ classification, duplicates: nearby });
    }
  }

  const ext = photo.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("issue-photos")
    .upload(path, buffer, { contentType: photo.type });

  if (uploadError) {
    console.error("Photo upload failed", uploadError);
    return NextResponse.json(
      { error: "Failed to upload photo" },
      { status: 500 }
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("issue-photos").getPublicUrl(path);

  const [address, departmentResult] = await Promise.all([
    reverseGeocode(lat, lng),
    supabase
      .from("departments")
      .select("id")
      .contains("category_keys", [classification.category])
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: issue, error: insertError } = await supabase
    .from("issues")
    .insert({
      reporter_id: user.id,
      title: classification.title,
      description: classification.description,
      ai_category: classification.category,
      ai_severity: classification.severity,
      ai_severity_label: classification.severityLabel,
      ai_confidence: classification.confidence,
      photo_url: publicUrl,
      lat,
      lng,
      address: address ?? undefined,
      department_id: departmentResult.data?.id ?? null,
    })
    .select("*, departments(name)")
    .single();

  if (insertError) {
    console.error("Issue insert failed", insertError);
    return NextResponse.json(
      { error: "Failed to save the report" },
      { status: 500 }
    );
  }

  await pushNearbyIssueAlerts(issue.id);

  return NextResponse.json({ issue }, { status: 201 });
}
