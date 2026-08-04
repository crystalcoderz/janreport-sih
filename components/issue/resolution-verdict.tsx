import { BadgeCheck, ShieldAlert, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolutionVerdict } from "@/lib/supabase/types";

const VERDICT_CONFIG: Record<
  ResolutionVerdict,
  { label: string; icon: typeof BadgeCheck; className: string; iconClassName: string }
> = {
  verified: {
    label: "AI-verified fixed",
    icon: BadgeCheck,
    className:
      "border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-300",
    iconClassName: "text-green-600 dark:text-green-400",
  },
  not_fixed: {
    label: "Flagged — doesn't look fixed",
    icon: ShieldAlert,
    className: "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300",
    iconClassName: "text-red-600 dark:text-red-400",
  },
  unclear: {
    label: "Could not verify",
    icon: HelpCircle,
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
};

// Compact pill for lists/cards.
export function ResolutionVerdictBadge({
  verdict,
}: {
  verdict: ResolutionVerdict;
}) {
  const config = VERDICT_CONFIG[verdict];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        config.className
      )}
    >
      <Icon className={cn("size-3.5", config.iconClassName)} />
      {config.label}
    </span>
  );
}

// Full panel with the AI's reasoning — the citizen-facing proof that
// "resolved" was actually checked against evidence, not just clicked.
export function ResolutionVerdictPanel({
  verdict,
  reason,
  confidence,
}: {
  verdict: ResolutionVerdict;
  reason: string | null;
  confidence: number | null;
}) {
  const config = VERDICT_CONFIG[verdict];
  const Icon = config.icon;

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3", config.className)}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className={cn("size-4", config.iconClassName)} />
        {config.label}
        {confidence !== null && (
          <span className="ml-auto text-xs font-normal opacity-75">
            {Math.round(confidence * 100)}% confidence
          </span>
        )}
      </div>
      {reason && <p className="text-sm leading-relaxed opacity-90">{reason}</p>}
      <p className="text-[11px] opacity-70">
        Automatically checked by comparing the officer&apos;s resolution photo
        against the original report.
      </p>
    </div>
  );
}
