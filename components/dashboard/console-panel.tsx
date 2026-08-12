import { cn } from "@/lib/utils";

// Replaces the plain shadcn Card (rounded-xl, soft shadow, default border)
// on officer-console surfaces — that default look is what makes a
// dashboard read as an assembled component kit rather than a purpose-built
// tool. Matches the flat-bordered, mono-label language already used for
// the stat strip and issue rows on the dashboard list page.
export function ConsolePanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-card/40 p-4", className)}>
      <h2 className="mb-3 font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}
