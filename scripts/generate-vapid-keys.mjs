// One-time setup: prints a fresh VAPID keypair for Web Push. Paste the
// public key into NEXT_PUBLIC_VAPID_PUBLIC_KEY and the private key into
// VAPID_PRIVATE_KEY in .env.local. Regenerating invalidates every existing
// push subscription (citizens would need to re-enable notifications).
//
// Usage:
//   node scripts/generate-vapid-keys.mjs

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("Add these to .env.local:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
