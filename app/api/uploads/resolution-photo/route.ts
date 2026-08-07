import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  uploadIssuePhoto,
  ALLOWED_IMAGE_TYPES,
  looksLikeAllowedImage,
} from "@/lib/storage";

export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Officers upload resolution photos through here rather than straight to
// storage from the browser, so R2 credentials stay server-only.
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "officer" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const photo = formData.get("photo");
  const issueId = formData.get("issueId")?.toString();

  if (!(photo instanceof File) || !issueId) {
    return NextResponse.json(
      { error: "photo and issueId are required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_IMAGE_TYPES.includes(photo.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return NextResponse.json(
      { error: "Photo must be a JPEG, PNG, or WebP image" },
      { status: 400 }
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo must be under 8MB" }, { status: 400 });
  }

  const supabase = await createClient();
  const buffer = Buffer.from(await photo.arrayBuffer());

  // The declared type is just a client-supplied string; confirm the bytes.
  if (!looksLikeAllowedImage(buffer)) {
    return NextResponse.json(
      { error: "That file doesn't look like a real JPEG, PNG, or WebP image." },
      { status: 400 }
    );
  }
  const ext = photo.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const path = `${profile.id}/resolution-${issueId}-${Date.now()}.${ext}`;

  try {
    const { publicUrl } = await uploadIssuePhoto({
      supabase,
      path,
      body: buffer,
      contentType: photo.type,
    });
    return NextResponse.json({ publicUrl });
  } catch (err) {
    console.error("Resolution photo upload failed", err);
    return NextResponse.json(
      { error: "Failed to upload photo" },
      { status: 500 }
    );
  }
}
