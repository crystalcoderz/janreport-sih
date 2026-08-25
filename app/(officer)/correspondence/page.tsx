import { redirect } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { getRecentMail } from "@/lib/municipal-mail";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Every complaint JanReport has sent to a municipal body, and every reply.
//
// This is the page that answers the question the whole middleman model rests
// on: are these letters going anywhere, and is anyone writing back? Before it
// existed a complaint left nothing behind but a log line, so the honest answer
// was that nobody knew.

export default async function CorrespondencePage() {
  const profile = await getCurrentProfile();
  // Same gate as /analytics and /bot-users. This lists municipal addresses and
  // their replies verbatim, and municipal_emails grants nothing to
  // `authenticated` — the check has to happen before the service-role read.
  if (profile?.role !== "admin") redirect("/dashboard");

  const { mail, sent, received, repliedIssues } = await getRecentMail(150);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Municipal Correspondence</h1>
        <p className="text-muted-foreground">
          What JanReport sent to each nagar nigam on a citizen&apos;s behalf, and
          what came back.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Complaints sent" value={sent} />
        <StatTile label="Replies received" value={received} />
        <StatTile label="Reports answered" value={repliedIssues} />
      </div>

      {mail.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="font-medium">No correspondence yet.</p>
            <p className="text-sm text-muted-foreground">
              A complaint is emailed automatically when a report resolves to a
              verified municipal office covering its location. If a report falls
              outside every office&apos;s area, nothing is sent — that is
              deliberate, so a complaint never goes to the wrong body.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {mail.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <li key={m.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 py-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {outbound ? (
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ArrowDownLeft className="size-4 shrink-0 text-emerald-500" />
                      )}
                      <Badge variant={outbound ? "secondary" : "default"}>
                        {outbound ? "Sent" : "Reply"}
                      </Badge>
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {m.address}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(m.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>

                    <Link
                      href={`/correspondence/${m.id}`}
                      className="text-sm underline-offset-2 hover:underline"
                    >
                      {m.subject ?? (outbound ? "Complaint" : "Reply")}
                    </Link>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Link
                        href={`/dashboard/${m.issueId}`}
                        className="font-mono underline underline-offset-2 hover:text-foreground"
                      >
                        {m.issueReference ?? m.issueId.slice(0, 8).toUpperCase()}
                      </Link>
                      <span className="min-w-0 truncate">{m.issueTitle}</span>
                      <Badge variant="outline">{m.issueStatus}</Badge>
                    </div>

                    {m.body && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          <span className="group-open:hidden">Show the message</span>
                          <span className="hidden group-open:inline">
                            Hide the message
                          </span>
                        </summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                          {m.body}
                        </pre>
                      </details>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
