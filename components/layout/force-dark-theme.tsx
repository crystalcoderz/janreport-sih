"use client";

import { useEffect } from "react";

// Puts the dark class on <html> rather than on a wrapper div, because
// Select dropdowns, dialogs and toasts render through a portal appended to
// <body> — a sibling of any wrapper, not a descendant. Scoped to a wrapper,
// those popups kept resolving --popover to white and rendered light-on-dark
// over the console. Removed again on unmount so the citizen-facing pages,
// which share this document, stay light.
export function ForceDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    return () => root.classList.remove("dark");
  }, []);

  return null;
}
