import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Photo storage lives behind this one function so the rest of the app
// doesn't care where bytes land. Cloudflare R2 is used when configured;
// otherwise it falls back to Supabase Storage (same graceful-degradation
// pattern as WhatsApp/push), so the app works with zero R2 setup.

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET || "janreport-photos";
// Public base URL for the bucket — either an r2.dev subdomain or a custom
// domain. Required: R2 objects aren't publicly readable without it.
const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

export function isR2Configured(): boolean {
  return Boolean(accountId && accessKeyId && secretAccessKey && publicBaseUrl);
}

const r2 = isR2Configured()
  ? new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    })
  : null;

export interface UploadResult {
  publicUrl: string;
}

// The only hosts a photo URL is ever legitimately produced by — whichever
// backend uploadIssuePhoto wrote to.
function allowedPhotoOrigins(): string[] {
  const origins: string[] = [];
  if (publicBaseUrl) {
    try {
      origins.push(new URL(publicBaseUrl).origin);
    } catch {
      // Misconfigured value — just don't allowlist it.
    }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      origins.push(new URL(supabaseUrl).origin);
    } catch {
      // Same.
    }
  }
  return origins;
}

// Deliberately narrow: SVG is excluded because it's an executable document
// that would be served from our own public storage origin (stored XSS), and
// everything outside this list has no reason to be a civic-issue photo.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// A declared Content-Type is just a client-supplied string, so confirm the
// bytes really are the format they claim before anything is stored or later
// rendered.
export function looksLikeAllowedImage(bytes: Uint8Array): boolean {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return true;
  // WebP: "RIFF" .... "WEBP"
  if (bytes.length >= 12) {
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.slice(start, end));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  }
  return false;
}

// Photo URLs arrive from the client (the resolve form posts back whatever
// /api/uploads/resolution-photo returned) and are later fetched server-side
// for AI verification. Without this, an officer could point that fetch at
// cloud metadata or an internal service — a classic SSRF. Only URLs on the
// storage hosts we actually upload to are accepted.
export function isAllowedPhotoUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return allowedPhotoOrigins().includes(url.origin);
}

// `path` is the object key, e.g. "<userId>/<uuid>.jpg" — callers keep
// using the same user-scoped layout regardless of backend.
export async function uploadIssuePhoto(params: {
  supabase: SupabaseClient<Database>;
  path: string;
  body: Buffer;
  contentType: string;
}): Promise<UploadResult> {
  const { supabase, path, body, contentType } = params;

  if (r2) {
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        Body: body,
        ContentType: contentType,
      })
    );
    return { publicUrl: `${publicBaseUrl!.replace(/\/$/, "")}/${path}` };
  }

  const { error } = await supabase.storage
    .from("issue-photos")
    .upload(path, body, { contentType });
  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from("issue-photos").getPublicUrl(path);
  return { publicUrl };
}
