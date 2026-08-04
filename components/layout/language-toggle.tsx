"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { LOCALE_LABELS, type Locale } from "@/lib/i18n/locale";
import { Languages } from "lucide-react";

const OTHER_LOCALE: Record<Locale, Locale> = { en: "hi", hi: "en" };

export function LanguageToggle() {
  const { locale, setLocale } = useTranslation();
  const next = OTHER_LOCALE[locale];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLocale(next)}
      aria-label={`Switch to ${LOCALE_LABELS[next]}`}
    >
      <Languages className="size-4" />
      {LOCALE_LABELS[next]}
    </Button>
  );
}
