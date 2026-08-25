import { notFound } from "next/navigation";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { googleMapsLink } from "@/lib/geo";
import { SeverityBadge } from "@/components/issue/severity-badge";
import { StatusBadge } from "@/components/issue/status-badge";
import { StatusUpdateForm } from "@/components/dashboard/status-update-form";
import { AssignTeamForm } from "@/components/dashboard/assign-team-form";
import { SendAcknowledgementButton } from "@/components/dashboard/send-acknowledgement-button";
import { IssueLocationMap } from "@/components/map/issue-location-map";
import { IssueTimeline } from "@/components/issue/issue-timeline";
import { MunicipalMailThread } from "@/components/dashboard/municipal-mail-thread";
import { SendComplaintButton } from "@/components/dashboard/send-complaint-button";
import { getMailForIssue } from "@/lib/municipal-mail";
import { resolveMunicipalRecipient } from "@/lib/email/municipal";
import { ResolutionVerdictPanel } from "@/components/issue/resolution-verdict";
import { IssueComments } from "@/components/issue/issue-comments";
import { ConsolePanel } from "@/components/dashboard/console-panel";
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

  const [{ data: issue }, { data: history }, { data: comments }] =
    await Promise.all([
      supabase
        .from("issues")
        .select(
          "*, departments(name), teams(id, name, contact_phone), profiles!issues_reporter_id_fkey(full_name)"
        )
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
    ]);

  if (!issue) notFound();

  // Read with the service role, so it is fetched only after the officer layout
  // has established who is asking. municipal_emails grants nothing to
  // `authenticated` -- it holds the office's address and its reply verbatim.
  const isStaff = profile?.role === "officer" || profile?.role === "admin";
  const municipalMail = isStaff ? await getMailForIssue(issue.id) : [];
  // Resolved here so the officer can see which body it would reach before
  // committing to send, rather than finding out from a toast afterwards.
  const municipalRecipient = isStaff
    ? await resolveMunicipalRecipient({
        departmentEmail: null,
        lat: issue.lat,
        lng: issue.lng,
      })
    : null;

  // Crews for this issue's department only. A crew with no department is not
  // "dispatchable anywhere" — the database trigger rejects it outright — so
  // offering one here only produces a failed save.
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, contact_phone, department_id")
    .eq("active", true)
    .order("name");

  const eligibleTeams = (teams ?? []).filter(
    (t) => t.department_id && t.department_id === issue.department_id
  );

  const assignedTeam = (
    issue as { teams?: { id: string; name: string; contact_phone: string | null } | null }
  ).teams;

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
          <span className="inline-flex items-center rounded-sm border border-border/60 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
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
          <a
            href={googleMapsLink(issue.lat, issue.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:underline"
          >
            <MapPin className="size-4" />
            {issue.address ?? `${issue.lat.toFixed(5)}, ${issue.lng.toFixed(5)}`}
          </a>
          <span className="flex items-center gap-1.5">
            <User className="size-4" />
            Reported by{" "}
            {issue.reporter_name ??
              (issue as { profiles?: { full_name: string | null } }).profiles
                ?.full_name ??
              "a citizen"}{" "}
            ·{" "}
            {formatDistanceToNow(new Date(issue.created_at), {
              addSuffix: true,
            })}
          </span>
          <span>Routed to {issue.departments?.name ?? "Unassigned"}</span>
          <span>{Math.round(issue.ai_confidence * 100)}% AI confidence</span>
        </div>

        <div
          className="overflow-hidden rounded-lg border border-border/60"
          style={{ filter: "invert(1) hue-rotate(180deg)" }}
        >
          <IssueLocationMap issue={issue} />
        </div>

        {issue.resolution_photo_url && (
          <ConsolePanel title="Proof of resolution">
            <div className="flex flex-col gap-3">
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
            </div>
          </ConsolePanel>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <ConsolePanel title="Acknowledgement">
          <SendAcknowledgementButton
            issueId={issue.id}
            sentAt={issue.acknowledgement_sent_at}
          />
        </ConsolePanel>

        {isStaff && (
          <ConsolePanel title="Municipal correspondence">
            <div className="flex flex-col gap-4">
              <MunicipalMailThread mail={municipalMail} />
              <SendComplaintButton
                issueId={issue.id}
                officeName={municipalRecipient?.office?.name ?? null}
                address={municipalRecipient?.email ?? null}
                alreadySent={municipalMail.some((m) => m.direction === "outbound")}
              />
            </div>
          </ConsolePanel>
        )}

        <ConsolePanel title="Assigned crew">
          <AssignTeamForm
            issueId={issue.id}
            teams={eligibleTeams}
            currentTeamId={issue.assigned_team_id}
            currentTeamName={assignedTeam?.name}
            currentTeamPhone={assignedTeam?.contact_phone}
            assignedAt={issue.assigned_at}
          />
        </ConsolePanel>

        <ConsolePanel title="Update status">
          <StatusUpdateForm issueId={issue.id} currentStatus={issue.status} />
        </ConsolePanel>

        <ConsolePanel title="Timeline">
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
        </ConsolePanel>

        {profile && (
          <ConsolePanel title="Discussion">
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
          </ConsolePanel>
        )}
      </div>
    </div>
  );
}
