// Thin wrapper around the `web-push` library (VAPID-based Web Push).
// Server-only — never import from client components. Requires
// NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; see README for setup
// (scripts/generate-vapid-keys.mjs generates a fresh keypair).
import webpush, { WebPushError } from "web-push";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@janreport.demo";

export function isPushConfigured(): boolean {
  return Boolean(vapidPublicKey && vapidPrivateKey);
}

if (isPushConfigured()) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey!, vapidPrivateKey!);
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushNotification(
  subscription: PushSubscriptionKeys,
  payload: { title: string; body: string; url?: string }
): Promise<{ ok: true } | { ok: false; expired: boolean }> {
  if (!isPushConfigured()) return { ok: false, expired: false };

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    const expired =
      err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
    if (!expired) console.error("Push send failed", err);
    return { ok: false, expired };
  }
}
