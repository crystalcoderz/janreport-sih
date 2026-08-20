import { severityColor } from "@/lib/departments";
import type { IssueStatus } from "@/lib/supabase/types";

// Email HTML is not web HTML. Gmail strips <style> blocks in some clients,
// ignores flexbox and grid entirely, and Outlook renders through Word. So:
// tables for layout, inline styles only, explicit background colours (a
// transparent background gets inverted to something unreadable by dark-mode
// clients), and absolute image URLs.
//
// Everything is composed from the small helpers below rather than one big
// string per email, so the three templates cannot drift apart visually.

const BRAND = "#2563eb";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const PAGE_BG = "#f3f4f6";
const CARD_BG = "#ffffff";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const STATUS_LABEL: Record<IssueStatus, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  resolved: "Resolved",
  rejected: "Rejected",
};

const STATUS_COLOR: Record<IssueStatus, string> = {
  reported: "#475569",
  acknowledged: "#1d4ed8",
  in_progress: "#b45309",
  resolved: "#15803d",
  rejected: "#b91c1c",
};

export interface IssueEmailData {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  severity: number;
  severityLabel: string;
  status: IssueStatus;
  department?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  photoUrl?: string | null;
  reporterName?: string | null;
  createdAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function pill(text: string, color: string): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${color};color:#ffffff;font-size:12px;font-weight:600;line-height:18px;">${escapeHtml(
    text
  )}</span>`;
}

function row(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:7px 0;font:400 13px ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;width:110px;">${escapeHtml(
      label
    )}</td>
    <td style="padding:7px 0;font:400 14px ${FONT};color:${INK};vertical-align:top;">${valueHtml}</td>
  </tr>`;
}

// Hidden line the inbox shows next to the subject. Without it clients preview
// whatever text comes first, which is usually the brand name.
function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(
    text
  )}</div>`;
}

function shell(params: {
  preheaderText: string;
  heading: string;
  headingColor?: string;
  intro: string;
  bodyHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
  footerNote?: string;
}): string {
  const cta =
    params.ctaHref && params.ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
           <tr><td style="border-radius:6px;background:${BRAND};">
             <a href="${params.ctaHref}" style="display:inline-block;padding:11px 20px;font:600 14px ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(
               params.ctaLabel
             )}</a>
           </td></tr>
         </table>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${PAGE_BG};">
${preheader(params.preheaderText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD_BG};border:1px solid ${LINE};border-radius:10px;overflow:hidden;">
      <tr><td style="padding:18px 24px;border-bottom:1px solid ${LINE};">
        <span style="font:700 17px ${FONT};color:${BRAND};letter-spacing:-0.2px;">JanReport</span>
        <span style="font:400 12px ${FONT};color:${MUTED};"> &nbsp;·&nbsp; Civic issue reporting</span>
      </td></tr>
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 6px;font:700 20px ${FONT};color:${
          params.headingColor ?? INK
        };">${escapeHtml(params.heading)}</h1>
        <p style="margin:0 0 18px;font:400 14px ${FONT};color:${MUTED};line-height:21px;">${escapeHtml(
          params.intro
        )}</p>
        ${params.bodyHtml}
        ${cta}
      </td></tr>
      <tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid ${LINE};">
        <p style="margin:0;font:400 12px ${FONT};color:${MUTED};line-height:18px;">${escapeHtml(
          params.footerNote ??
            "You are receiving this because you reported a civic issue through JanReport."
        )}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function issueCard(issue: IssueEmailData): string {
  const photo = issue.photoUrl
    ? `<tr><td style="padding-bottom:16px;">
         <img src="${issue.photoUrl}" width="512" alt="${escapeHtml(
           issue.title
         )}" style="display:block;width:100%;max-width:512px;height:auto;border-radius:8px;border:1px solid ${LINE};" />
       </td></tr>`
    : "";

  const address = issue.address
    ? `${escapeHtml(issue.address)}<br /><a href="${mapsLink(
        issue.lat,
        issue.lng
      )}" style="color:${BRAND};text-decoration:none;">View on map</a>`
    : `<a href="${mapsLink(issue.lat, issue.lng)}" style="color:${BRAND};text-decoration:none;">View on map</a>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${photo}
    <tr><td style="padding-bottom:10px;">
      ${pill(STATUS_LABEL[issue.status], STATUS_COLOR[issue.status])}
      &nbsp;${pill(
        `${issue.severityLabel} · ${issue.severity}/10`,
        severityColor(issue.severity)
      )}
    </td></tr>
    <tr><td style="padding-bottom:4px;font:600 16px ${FONT};color:${INK};line-height:22px;">${escapeHtml(
      issue.title
    )}</td></tr>
    ${
      issue.description
        ? `<tr><td style="padding-bottom:12px;font:400 14px ${FONT};color:${MUTED};line-height:21px;">${escapeHtml(
            issue.description
          )}</td></tr>`
        : ""
    }
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};margin-top:4px;">
        ${row("Category", escapeHtml(issue.category))}
        ${row("Department", escapeHtml(issue.department ?? "Being assigned"))}
        ${row("Location", address)}
        ${row(
          "Report ID",
          `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">${escapeHtml(
            issue.id.slice(0, 8)
          )}</span>`
        )}
      </table>
    </td></tr>
  </table>`;
}

/** Sent the moment a report is filed. */
export function reportFiledEmail(issue: IssueEmailData, viewUrl?: string) {
  const who = issue.reporterName ? `, ${issue.reporterName}` : "";
  return {
    subject: `Report filed — ${issue.title}`,
    html: shell({
      preheaderText: `Your report has been logged and routed to ${
        issue.department ?? "the right department"
      }.`,
      heading: "Report filed",
      intro: `Thanks${who}. Your report has been logged and routed to the right department. You'll get an email here whenever its status changes.`,
      bodyHtml: issueCard(issue),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "Track this report" : undefined,
    }),
    text:
      `Report filed\n\n${issue.title}\n` +
      `Severity: ${issue.severityLabel} (${issue.severity}/10)\n` +
      `Department: ${issue.department ?? "Being assigned"}\n` +
      `Location: ${issue.address ?? mapsLink(issue.lat, issue.lng)}\n` +
      `Report ID: ${issue.id.slice(0, 8)}\n`,
  };
}

/** Sent when an officer moves the report along. */
export function statusChangedEmail(
  issue: IssueEmailData,
  previousStatus: IssueStatus,
  note?: string | null,
  viewUrl?: string
) {
  const label = STATUS_LABEL[issue.status];
  return {
    subject: `${label} — ${issue.title}`,
    html: shell({
      preheaderText: `Moved from ${STATUS_LABEL[previousStatus]} to ${label}.`,
      heading: `Now ${label.toLowerCase()}`,
      headingColor: STATUS_COLOR[issue.status],
      intro: `Your report moved from ${STATUS_LABEL[
        previousStatus
      ].toLowerCase()} to ${label.toLowerCase()}.`,
      bodyHtml:
        (note
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
               <tr><td style="padding:12px 14px;background:#f8fafc;border-left:3px solid ${BRAND};border-radius:4px;font:400 14px ${FONT};color:${INK};line-height:21px;">
                 <strong style="color:${MUTED};font-size:12px;display:block;margin-bottom:3px;">NOTE FROM THE OFFICER</strong>
                 ${escapeHtml(note)}
               </td></tr>
             </table>`
          : "") + issueCard(issue),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "View the full timeline" : undefined,
    }),
    text: `${label} — ${issue.title}\n${note ? `\nOfficer note: ${note}\n` : ""}\nReport ID: ${issue.id.slice(
      0,
      8
    )}\n`,
  };
}

/** Sent on resolution, carrying the AI's verdict on the proof photo. */
export function resolvedEmail(
  issue: IssueEmailData,
  verdict: { verdict: string; reason?: string | null; confidence?: number | null },
  resolutionPhotoUrl?: string | null,
  viewUrl?: string
) {
  const verified = verdict.verdict === "verified";
  const verdictColor = verified ? "#15803d" : "#b45309";
  const verdictLabel = verified
    ? "AI verified the fix"
    : verdict.verdict === "not_fixed"
      ? "AI could not confirm the fix"
      : "AI verdict unclear";

  const beforeAfter =
    issue.photoUrl && resolutionPhotoUrl
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
           <tr>
             <td width="50%" style="padding-right:5px;vertical-align:top;">
               <div style="font:600 11px ${FONT};color:${MUTED};margin-bottom:4px;">BEFORE</div>
               <img src="${issue.photoUrl}" width="250" alt="Before" style="display:block;width:100%;height:auto;border-radius:6px;border:1px solid ${LINE};" />
             </td>
             <td width="50%" style="padding-left:5px;vertical-align:top;">
               <div style="font:600 11px ${FONT};color:${MUTED};margin-bottom:4px;">AFTER</div>
               <img src="${resolutionPhotoUrl}" width="250" alt="After" style="display:block;width:100%;height:auto;border-radius:6px;border:1px solid ${LINE};" />
             </td>
           </tr>
         </table>`
      : "";

  return {
    subject: `Resolved — ${issue.title}`,
    html: shell({
      preheaderText: verdictLabel,
      heading: "Marked resolved",
      headingColor: "#15803d",
      intro:
        "The department has marked your report resolved and uploaded a photo as proof.",
      bodyHtml:
        beforeAfter +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
           <tr><td style="padding:12px 14px;background:#f8fafc;border-left:3px solid ${verdictColor};border-radius:4px;font:400 14px ${FONT};color:${INK};line-height:21px;">
             <strong style="color:${verdictColor};font-size:12px;display:block;margin-bottom:3px;">${escapeHtml(
               verdictLabel.toUpperCase()
             )}${
               verdict.confidence != null
                 ? ` · ${Math.round(verdict.confidence * 100)}% CONFIDENCE`
                 : ""
             }</strong>
             ${escapeHtml(
               verdict.reason ?? "The proof photo was compared against your original report."
             )}
           </td></tr>
         </table>` +
        issueCard({ ...issue, status: "resolved" }),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "See before and after" : undefined,
      footerNote:
        "If the issue is not actually fixed, reply to this email or report it again and it will be reopened.",
    }),
    text: `Resolved — ${issue.title}\n\n${verdictLabel}\n${
      verdict.reason ?? ""
    }\n\nReport ID: ${issue.id.slice(0, 8)}\n`,
  };
}
