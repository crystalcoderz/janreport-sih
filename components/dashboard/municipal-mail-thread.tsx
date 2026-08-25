import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { MunicipalMail } from "@/lib/municipal-mail";

// The complaint sent to the municipal body, and anything it sent back, in one
// thread. Rendered server-side with <details> for the bodies, so a clerk's
// four-paragraph reply is one tap away without shipping any JavaScript.

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function MunicipalMailThread({
  mail,
  linkToDetail = false,
}: {
  mail: MunicipalMail[];
  /** Only admins can open the full-letter page, so only they get the link. */
  linkToDetail?: boolean;
}) {
  if (mail.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing sent yet. A complaint goes out automatically when a report
        resolves to a municipal office covering its location — if none does, or
        no address is configured, nothing is sent and this stays empty.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {mail.map((m) => {
        const outbound = m.direction === "outbound";
        return (
          <li
            key={m.id}
            className={
              "rounded-md border p-3 " +
              (outbound
                ? "border-border/60 bg-background/40"
                : "border-emerald-600/40 bg-emerald-950/10")
            }
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {outbound ? (
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-500" />
              )}
              <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                {outbound ? "Sent to" : "Reply from"}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">
                {m.officeName ?? m.address}
              </span>
              <span
                className="ml-auto shrink-0 text-xs text-muted-foreground"
                title={formatWhen(m.createdAt)}
              >
                {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
              </span>
            </div>

            {/* The office name is friendlier in the heading, but an officer
                chasing this up needs the actual address. */}
            {m.officeName && (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {m.address}
              </p>
            )}

            {m.subject && (
              <p className="mt-1.5 text-sm text-foreground/90">{m.subject}</p>
            )}

            {linkToDetail && (
              <Link
                href={`/correspondence/${m.id}`}
                className="mt-1.5 inline-block text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
              >
                {outbound ? "Open the letter as it was sent" : "Open the reply as it arrived"}
              </Link>
            )}

            {m.body && (
              <details className="group mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  <span className="group-open:hidden">Show the message</span>
                  <span className="hidden group-open:inline">Hide the message</span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                  {m.body}
                </pre>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
