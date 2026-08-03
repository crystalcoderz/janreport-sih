"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

function getPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function useNotificationPermission() {
  // Same SSR-safe pattern as useSpeechToText: avoids a hydration mismatch
  // from reading a browser-only API during the initial render.
  const initialPermission = useSyncExternalStore(
    noopSubscribe,
    getPermission,
    () => "unsupported" as const
  );
  const [permission, setPermission] = useState(initialPermission);

  const request = useCallback(async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification(title, options);
  }, []);

  return { permission, request, notify };
}
