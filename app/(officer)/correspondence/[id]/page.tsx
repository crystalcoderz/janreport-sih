import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { getMailById } from "@/lib/municipal-mail";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// One message, shown as the other end actually saw it.
//
// The list and the panel on a report both show a plain-text extract, which is
// right for scanning but wrong for the question this page answers: what
// exactly did the nagar nigam receive? The HTML is stored as sent rather than
// re-rendered from today's template, so this cannot quietly drift away from
// the letter that really went out.

export default async function CorrespondenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  // Same gate as the list: this shows a municipal address and the reply
  // verbatim, and municipal_emails grants nothing to `authenticated`.
  if (profile?.role !== "admin") redirect("/dashboard");

  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const mail = await getMailById(numericId);
  if (!mail) notFound();

  const outbound = mail.direction === "outbound";
  const when = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(mail.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/correspondence"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All correspondence
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {outbound ? (
            <ArrowUpRight className="size-5 text-muted-foreground" />
          ) : (
            <ArrowDownLeft className="size-5 text-emerald-500" />
          )}
          <h1 className="text-2xl font-bold">
            {mail.subject ?? (outbound ? "Complaint" : "Reply")}
          </h1>
          <Badge variant={outbound ? "secondary" : "default"}>
            {outbound ? "Sent" : "Reply"}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-[8rem_1fr]">
          <Field label={outbound ? "To" : "From"}>
            <span className="font-mono">{mail.address}</span>
            {mail.officeName && (
              <span className="block text-muted-foreground">{mail.officeName}</span>
            )}
          </Field>
          <Field label={outbound ? "Sent" : "Received"}>{when}</Field>
          <Field label="Report">
            <Link
              href={`/dashboard/${mail.issueId}`}
              className="font-mono underline underline-offset-2"
            >
              {mail.issueReference ?? mail.issueId.slice(0, 8).toUpperCase()}
            </Link>
            <span className="block text-muted-foreground">{mail.issueTitle}</span>
          </Field>
          <Field label="Status">
            <Badge variant="outline">{mail.issueStatus}</Badge>
          </Field>
        </CardContent>
      </Card>

      {mail.bodyHtml ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {outbound ? "The letter as it was sent" : "The reply as it arrived"}
          </h2>
          {/* Fully sandboxed: no scripts, no same-origin, no form submission.
              An inbound reply is HTML written by someone outside this system,
              and even the outbound letter is better rendered in isolation than
              injected into the console's own DOM. */}
          <iframe
            title={mail.subject ?? "Message"}
            sandbox=""
            srcDoc={mail.bodyHtml}
            className="h-[70vh] w-full rounded-lg border border-border/60 bg-white"
          />
        </div>
      ) : null}

      {mail.body && (
        <details className="group" open={!mail.bodyHtml}>
          <summary className="cursor-pointer font-mono text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground">
            Plain text version
          </summary>
          <pre className="mt-2 overflow-auto rounded-lg border border-border/60 bg-card/40 p-4 font-mono text-xs whitespace-pre-wrap">
            {mail.body}
          </pre>
        </details>
      )}

      {!mail.body && !mail.bodyHtml && (
        <p className="text-sm text-muted-foreground">
          This message was recorded without a body. Messages sent before the
          body was captured show only their metadata.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mb-2 sm:mb-0">{children}</dd>
    </>
  );
}
