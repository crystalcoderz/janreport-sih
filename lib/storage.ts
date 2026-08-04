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
