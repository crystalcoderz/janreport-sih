"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { IssueStatus } from "@/lib/supabase/types";

const STATUS_STYLES: Record<IssueStatus, string> = {
  reported: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  acknowledged: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  const { t } = useTranslation();

  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {t(`status.${status}` as TranslationKey)}
    </Badge>
  );
}
