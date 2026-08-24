import type { IssueStatus } from "@/lib/supabase/types";

// Email HTML is not web HTML: Gmail strips <style> blocks, ignores flexbox and
// grid, and Outlook renders through Word. Tables for layout, inline styles
// only, explicit background colours (a transparent background is what
// dark-mode clients invert into something unreadable), absolute image URLs.
//
// The look is a municipal notice rather than a product email — this is a
// government service, and a rounded card floating on grey with a blue button
// reads as marketing. Hierarchy comes from type and spacing; colour is spent
// only where it carries meaning (the status, the severity), never as
// decoration.

const INK = "#18181b";
const BODY = "#3f3f46";
const MUTED = "#71717a";
const FAINT = "#a1a1aa";
const RULE = "#e4e4e7";
const PAPER = "#ffffff";
const WASH = "#fafafa";

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const STATUS_LABEL: Record<IssueStatus, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  rejected: "Rejected",
};

const STATUS_INK: Record<IssueStatus, string> = {
  reported: "#52525b",
  acknowledged: "#1e40af",
  in_progress: "#92400e",
  resolved: "#166534",
  rejected: "#991b1b",
};

function severityInk(score: number): string {
  if (score >= 9) return "#991b1b";
  if (score >= 7) return "#9a3412";
  if (score >= 5) return "#854d0e";
  return "#166534";
}

export interface IssueEmailData {
  id: string;
  reference: string;
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

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

// The eyebrow: small, spaced capitals. Does the work a coloured pill used to,
// without looking like a badge from a component library.
function eyebrow(text: string, color: string): string {
  return `<div style="font:600 11px ${SANS};letter-spacing:0.09em;text-transform:uppercase;color:${color};padding-bottom:10px;">${esc(
    text
  )}</div>`;
}

// A definition row. Label in the left gutter, value doing the talking.
function field(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:9px 16px 9px 0;font:400 12px ${SANS};letter-spacing:0.04em;text-transform:uppercase;color:${FAINT};vertical-align:top;white-space:nowrap;">${esc(
      label
    )}</td>
    <td style="padding:9px 0;font:400 15px ${SANS};color:${BODY};line-height:22px;vertical-align:top;">${valueHtml}</td>
  </tr>`;
}

function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(
    text
  )}</div>`;
}

function shell(p: {
  preheaderText: string;
  eyebrowText: string;
  eyebrowColor: string;
  headline: string;
  standfirst?: string;
  bodyHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
  footNote?: string;
}): string {
  const cta =
    p.ctaHref && p.ctaLabel
      ? `<tr><td style="padding:4px 0 0;">
           <a href="${p.ctaHref}" style="font:600 15px ${SANS};color:${INK};text-decoration:none;border-bottom:1.5px solid ${INK};padding-bottom:2px;">${esc(
             p.ctaLabel
           )} &rarr;</a>
         </td></tr>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${WASH};">
${preheader(p.preheaderText)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:552px;background:${PAPER};border:1px solid ${RULE};">

      <!-- masthead: a rule and a wordmark, like letterhead -->
      <tr><td style="padding:22px 32px 18px;border-bottom:1px solid ${RULE};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:700 15px ${SANS};color:${INK};letter-spacing:-0.01em;">JanReport</td>
          <td align="right" style="font:400 11px ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:${FAINT};">Civic Issue Reporting</td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:30px 32px 32px;">
        ${eyebrow(p.eyebrowText, p.eyebrowColor)}
        <h1 style="margin:0;font:600 25px/32px ${SANS};color:${INK};letter-spacing:-0.02em;">${esc(
          p.headline
        )}</h1>
        ${
          p.standfirst
            ? `<p style="margin:10px 0 0;font:400 15px/23px ${SANS};color:${MUTED};">${esc(
                p.standfirst
              )}</p>`
            : ""
        }
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;">
          ${p.bodyHtml}
          ${cta}
        </table>
      </td></tr>

      <tr><td style="padding:16px 32px 20px;border-top:1px solid ${RULE};background:${WASH};">
        <p style="margin:0;font:400 12px/18px ${SANS};color:${FAINT};">${esc(
          p.footNote ??
            "Sent because an email address was given when this report was filed."
        )}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// The photo, edge to edge inside the sheet. No rounded corners — a rounded
// photo is the single most "template" thing in an email.
function photoBlock(url: string, alt: string): string {
  return `<tr><td style="padding-bottom:24px;">
    <img src="${url}" width="488" alt="${esc(
      alt
    )}" style="display:block;width:100%;max-width:488px;height:auto;border:1px solid ${RULE};" />
  </td></tr>`;
}

function detailBlock(issue: IssueEmailData): string {
  const location = issue.address
    ? `${esc(issue.address)}<br /><a href="${mapsLink(
        issue.lat,
        issue.lng
      )}" style="color:${MUTED};text-decoration:underline;">Open in Maps</a>`
    : `<a href="${mapsLink(issue.lat, issue.lng)}" style="color:${MUTED};text-decoration:underline;">Open in Maps</a>`;

  return `<tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${RULE};">
      ${field("Issue", `<span style="color:${INK};font-weight:600;">${esc(issue.title)}</span>`)}
      ${field("Category", esc(issue.category))}
      ${field(
        "Severity",
        `<span style="color:${severityInk(issue.severity)};font-weight:600;">${esc(
          issue.severityLabel
        )}</span> <span style="color:${FAINT};">${issue.severity}/10</span>`
      )}
      ${field(
        "Status",
        `<span style="color:${STATUS_INK[issue.status]};font-weight:600;">${esc(
          STATUS_LABEL[issue.status]
        )}</span>`
      )}
      ${field("Department", esc(issue.department ?? "Being assigned"))}
      ${field("Location", location)}
      ${field("Filed", esc(formatDate(issue.createdAt)))}
      ${field(
        "Reference",
        `<span style="font-family:${MONO};font-size:14px;color:${INK};letter-spacing:0.02em;">${esc(
          issue.reference
        )}</span>`
      )}
    </table>
  </td></tr>`;
}

// A quoted remark from the officer handling it. A left rule, not a tinted box.
function quote(label: string, text: string): string {
  return `<tr><td style="padding-bottom:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="border-left:2px solid ${INK};padding:2px 0 2px 16px;">
        <div style="font:600 11px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};padding-bottom:5px;">${esc(
          label
        )}</div>
        <div style="font:400 15px/23px ${SANS};color:${BODY};">${esc(text)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

/** Sent the moment a report is filed. */
export function reportFiledEmail(issue: IssueEmailData, viewUrl?: string) {
  return {
    subject: `Report ${issue.reference} received — ${issue.title}`,
    html: shell({
      preheaderText: `Logged and routed to ${issue.department ?? "a department"}. Reference ${issue.reference}.`,
      eyebrowText: "Report received",
      eyebrowColor: MUTED,
      headline: issue.title,
      standfirst: `Logged and routed to ${
        issue.department ?? "the responsible department"
      }. You'll be emailed whenever the status changes.`,
      bodyHtml:
        (issue.photoUrl ? photoBlock(issue.photoUrl, issue.title) : "") +
        detailBlock(issue),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "Track this report" : undefined,
    }),
    text: [
      `Report received — ${issue.title}`,
      ``,
      `Category:   ${issue.category}`,
      `Severity:   ${issue.severityLabel} (${issue.severity}/10)`,
      `Department: ${issue.department ?? "Being assigned"}`,
      `Location:   ${issue.address ?? mapsLink(issue.lat, issue.lng)}`,
      `Filed:      ${formatDate(issue.createdAt)}`,
      `Reference:  ${issue.reference}`,
    ].join("\n"),
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
      preheaderText: `${STATUS_LABEL[previousStatus]} → ${label}.`,
      eyebrowText: `${STATUS_LABEL[previousStatus]} → ${label}`,
      eyebrowColor: STATUS_INK[issue.status],
      headline: issue.title,
      standfirst: `Your report is now ${label.toLowerCase()}.`,
      bodyHtml:
        (note ? quote("From the officer", note) : "") + detailBlock(issue),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "See the full timeline" : undefined,
    }),
    text: [
      `${label} — ${issue.title}`,
      ``,
      ...(note ? [`Officer's note: ${note}`, ``] : []),
      `Reference: ${issue.reference}`,
    ].join("\n"),
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
  const verdictInk = verified ? "#166534" : "#92400e";
  const verdictLabel = verified
    ? "Fix confirmed from the photo"
    : verdict.verdict === "not_fixed"
      ? "Fix not confirmed from the photo"
      : "Photo inconclusive";

  const beforeAfter =
    issue.photoUrl && resolutionPhotoUrl
      ? `<tr><td style="padding-bottom:24px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
             <td width="50%" style="padding-right:6px;vertical-align:top;">
               <div style="font:600 11px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};padding-bottom:6px;">Reported</div>
               <img src="${issue.photoUrl}" width="238" alt="Before" style="display:block;width:100%;height:auto;border:1px solid ${RULE};" />
             </td>
             <td width="50%" style="padding-left:6px;vertical-align:top;">
               <div style="font:600 11px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};padding-bottom:6px;">After repair</div>
               <img src="${resolutionPhotoUrl}" width="238" alt="After" style="display:block;width:100%;height:auto;border:1px solid ${RULE};" />
             </td>
           </tr></table>
         </td></tr>`
      : issue.photoUrl
        ? photoBlock(issue.photoUrl, issue.title)
        : "";

  const verdictRow = `<tr><td style="padding-bottom:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="border-left:2px solid ${verdictInk};padding:2px 0 2px 16px;">
        <div style="font:600 11px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${verdictInk};padding-bottom:5px;">
          Automated check &nbsp;·&nbsp; ${esc(verdictLabel)}${
            verdict.confidence != null
              ? ` &nbsp;·&nbsp; ${Math.round(verdict.confidence * 100)}% confident`
              : ""
          }
        </div>
        <div style="font:400 15px/23px ${SANS};color:${BODY};">${esc(
          verdict.reason ??
            "The repair photo was compared against the photo you originally sent."
        )}</div>
      </td>
    </tr></table>
  </td></tr>`;

  return {
    subject: `Resolved — ${issue.title}`,
    html: shell({
      preheaderText: verdictLabel,
      eyebrowText: "Marked resolved",
      eyebrowColor: STATUS_INK.resolved,
      headline: issue.title,
      standfirst:
        "The department has closed this report and submitted a photo of the repair.",
      bodyHtml:
        beforeAfter +
        verdictRow +
        detailBlock({ ...issue, status: "resolved" }),
      ctaHref: viewUrl,
      ctaLabel: viewUrl ? "Compare the photos" : undefined,
      footNote:
        "If this isn't actually fixed, report it again and it will be reopened against the same reference.",
    }),
    text: [
      `Resolved — ${issue.title}`,
      ``,
      `Automated check: ${verdictLabel}`,
      ...(verdict.reason ? [verdict.reason] : []),
      ``,
      `Reference: ${issue.reference}`,
    ].join("\n"),
  };
}
