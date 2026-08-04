"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/i18n/locale";
import { en, hi, type TranslationKey } from "@/lib/i18n/translations";

const DICTIONARIES: Record<Locale, Partial<Record<TranslationKey, string>>> = {
  en,
  hi,
};

const LOCALE_CHANGE_EVENT = "janreport-locale-change";

function subscribeToLocaleChange(callback: () => void) {
  window.addEventListener(LOCALE_CHANGE_EVENT, callback);
  return () => window.removeEventListener(LOCALE_CHANGE_EVENT, callback);
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe: server and first client render both see the default locale
  // (no hydration mismatch), then this re-syncs to the real stored value
  // right after mount — same pattern as useSpeechToText/useNotificationPermission.
  const locale = useSyncExternalStore(
    subscribeToLocaleChange,
    readStoredLocale,
    () => DEFAULT_LOCALE
  );

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
  }, []);

  const t = useMemo(() => {
    const dictionary = DICTIONARIES[locale];
    return (key: TranslationKey) => dictionary[key] ?? en[key] ?? key;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return ctx;
}
