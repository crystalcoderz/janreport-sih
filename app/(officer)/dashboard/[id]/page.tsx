import { notFound } from "next/navigation";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { SeverityBadge } from "@/components/issue/severity-badge";
import { StatusBadge } from "@/components/issue/status-badge";
import { StatusUpdateForm } from "@/components/dashboard/status-update-form";
import { IssueTimeline } from "@/components/issue/issue-timeline";
import { ResolutionVerdictPanel } from "@/components/issue/resolution-verdict";
import { IssueComments } from "@/components/issue/issue-comments";
import { IssueVolunteerOffers } from "@/components/issue/issue-volunteer-offers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, ThumbsUp, User } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getCurrentProfile();

  const [
    { data: issue },
    { data: history },
    { data: comments },
    { data: offers },
    { data: myGroups },
  ] = await Promise.all([
    supabase
      .from("issues")
      .select("*, departments(name), profiles!issues_reporter_id_fkey(full_name)")
      .eq("id", id)
      .single(),
    supabase
      .from("issue_status_history")
      .select("*, profiles(full_name)")
      .eq("issue_id", id)
      .order("changed_at", { ascending: true }),
    supabase
      .from("issue_comments")
      .select("*, profiles(full_name)")
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("issue_volunteer_offers")
      .select("*, profiles(full_name), volunteer_groups(name)")
      .eq("issue_id", id)
      .order("created_at", { ascending: false }),
    profile
      ? supabase.from("volunteer_groups").select("id, name").eq("created_by", profile.id)
      : Promise.resolve({ data: null }),
  ]);

  if (!issue) notFound();

  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-4 lg:col-span-3">
        <Image
          src={issue.photo_url}
          alt={issue.title}
          width={800}
          height={500}
          unoptimized
          className="max-h-96 w-full rounded-lg object-cover"
        />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <SeverityBadge severity={issue.ai_severity} />
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
            {CATEGORY_LABELS[issue.ai_category as IssueCategory] ??
              issue.ai_category}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ThumbsUp className="size-3" />
            {issue.upvote_count} upvotes
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-bold">{issue.title}</h1>
          <p className="mt-1 text-muted-foreground">{issue.description}</p>
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" />
            {issue.address ?? `${issue.lat.toFixed(5)}, ${issue.lng.toFixed(5)}`}
          </span>
          <span className="flex items-center gap-1.5">
            <User className="size-4" />
            Reported by{" "}
            {(issue as { profiles?: { full_name: string | null } }).profiles
              ?.full_name ?? "a citizen"}{" "}
            ·{" "}
            {formatDistanceToNow(new Date(issue.created_at), {
              addSuffix: true,
            })}
          </span>
          <span>Routed to {issue.departments?.name ?? "Unassigned"}</span>
          <span>{Math.round(issue.ai_confidence * 100)}% AI confidence</span>
        </div>

        {issue.resolution_photo_url && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proof of resolution</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {issue.resolution_verdict && (
                <ResolutionVerdictPanel
                  verdict={issue.resolution_verdict}
                  reason={issue.resolution_verdict_reason}
                  confidence={issue.resolution_verdict_confidence}
                />
              )}
              <Image
                src={issue.resolution_photo_url}
                alt="Resolution"
                width={800}
                height={500}
                unoptimized
                className="max-h-72 w-full rounded-lg object-cover"
              />
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusUpdateForm issueId={issue.id} currentStatus={issue.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueTimeline
              createdAt={issue.created_at}
              entries={(history ?? []).map((h) => ({
                id: h.id,
                status: h.status,
                note: h.note,
                changed_at: h.changed_at,
                officerName: (
                  h as { profiles?: { full_name: string | null } }
                ).profiles?.full_name,
              }))}
            />
          </CardContent>
        </Card>

        {profile && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volunteers &amp; NGOs</CardTitle>
            </CardHeader>
            <CardContent>
              <IssueVolunteerOffers
                issueId={issue.id}
                userId={profile.id}
                myGroups={myGroups ?? []}
                initialOffers={(offers ?? []).map((o) => ({
                  ...o,
                  offererName:
                    (o as { profiles?: { full_name: string | null } }).profiles
                      ?.full_name ?? null,
                  groupName:
                    (o as { volunteer_groups?: { name: string } | null })
                      .volunteer_groups?.name ?? null,
                }))}
              />
            </CardContent>
          </Card>
        )}

        {profile && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discussion</CardTitle>
            </CardHeader>
            <CardContent>
              <IssueComments
                issueId={issue.id}
                userId={profile.id}
                userFullName={profile.full_name}
                initialComments={(comments ?? []).map((c) => ({
                  ...c,
                  authorName: (
                    c as { profiles?: { full_name: string | null } }
                  ).profiles?.full_name ?? null,
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
