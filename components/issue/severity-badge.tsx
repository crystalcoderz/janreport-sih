"use client";

import { Badge } from "@/components/ui/badge";
import { severityLabel } from "@/lib/departments";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

const STYLES: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  High: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  Moderate: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Low: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  Minimal: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export function SeverityBadge({ severity }: { severity: number }) {
  const { t } = useTranslation();
  const label = severityLabel(severity);

  return (
    <Badge variant="outline" className={STYLES[label]}>
      {t(`severity.${label}` as TranslationKey)} · {severity}/10
    </Badge>
  );
}
