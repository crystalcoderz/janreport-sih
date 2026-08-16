import { redirect } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { getCurrentProfile } from "@/lib/auth";
import { getBotUsage } from "@/lib/bot-users";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function BotUsersPage() {
  const profile = await getCurrentProfile();
  // Same gate as /analytics. This page shows residents' phone numbers, which
  // the schema withholds from every other authenticated read, so the check
  // has to happen before getBotUsage() touches the service-role client.
  if (profile?.role !== "admin") redirect("/dashboard");

  const {
    users,
    liveConversations,
    recentActivity,
    messagesHandled,
    messagesLast24h,
    reportsViaBot,
  } = await getBotUsage();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Bot Users</h1>
        <p className="text-muted-foreground">
          Everyone who has reported through WhatsApp, what they filed, and which
          conversations are open right now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Citizens on WhatsApp" value={users.length} />
        <StatTile label="Reports via the bot" value={reportsViaBot} />
        <StatTile label="Messages handled" value={messagesHandled} />
        <StatTile label="Messages (24h)" value={messagesLast24h} />
      </div>

      {liveConversations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Conversations in progress ({liveConversations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {liveConversations.map((c) => (
              <div
                key={c.phone}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">{c.name ?? "Name not given yet"}</p>
                  <p className="font-mono text-xs text-muted-foreground">{c.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {c.hasPhoto ? "📸 photo" : "no photo"}
                  </Badge>
                  <Badge variant="outline">
                    {c.hasLocation ? "📍 location" : "no location"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Citizens ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has used the WhatsApp bot yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">WhatsApp number</th>
                    <th className="pb-2 pr-4 text-right font-medium">Reports</th>
                    <th className="pb-2 pr-4 font-medium">Last report</th>
                    <th className="pb-2 font-medium">First seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.profileId} className="border-b last:border-0">
                      <td className="py-2.5 pr-4">
                        {u.name ?? (
                          <span className="text-muted-foreground">Not given</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{u.phone}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {u.reportCount}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {u.lastReportAt
                          ? formatDistanceToNow(new Date(u.lastReportAt), {
                              addSuffix: true,
                            })
                          : "never filed"}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {formatDistanceToNow(new Date(u.joinedAt), { addSuffix: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent reports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          ) : (
            recentActivity.map((a) => (
              <div
                key={a.issueId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/dashboard/${a.issueId}`}
                    className="font-medium hover:underline"
                  >
                    {a.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {a.reporterName ?? "Unnamed"}
                    {a.phone && <span className="font-mono"> · {a.phone}</span>}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6">
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
