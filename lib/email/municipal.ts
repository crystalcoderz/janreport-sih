import { slaHoursFor } from "@/lib/sla";
import { findNearbyMunicipalOffice, type NearbyOffice } from "@/lib/places";
import { sendEmail } from "@/lib/email/client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { findMunicipalOfficeFor, type MunicipalOffice } from "@/lib/municipal-directory";

// The complaint that goes to the municipal body — a different document from
// the citizen's confirmation. This one has to stand on its own in a clerk's
// inbox: it is a formal intimation of a civic complaint, and it should read
// like one. Reference first, facts in a table, photo as evidence, and a plain
// statement of the response window the service commits to.
//
// Same email-HTML constraints as lib/email/templates.ts: tables, inline
// styles, explicit backgrounds, absolute image URLs.

const INK = "#18181b";
const BODY = "#3f3f46";
const MUTED = "#71717a";
const FAINT = "#a1a1aa";
const RULE = "#d4d4d8";
const PAPER = "#ffffff";

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

export interface MunicipalComplaintData {
  id: string;
  /** Human-quotable tracking id, e.g. JR-2608-0042. */
  reference: string;
  title: string;
  description?: string | null;
  category: string;
  severity: number;
  severityLabel: string;
  department?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  photoUrl?: string | null;
  reporterName?: string | null;
  reporterPhone?: string | null;
  createdAt: string;
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

// The complaint is only actionable if the recipient can find the place, so the
// coordinates are given verbatim alongside the link — a printed copy has no
// clickable link, and a clerk may be dispatching from paper.
function locationBlock(d: MunicipalComplaintData): string {
  const maps = `https://www.google.com/maps?q=${d.lat},${d.lng}`;
  return `${d.address ? esc(d.address) + "<br />" : ""}<span style="font-family:${MONO};font-size:13px;color:${MUTED};">${d.lat.toFixed(
    6
  )}, ${d.lng.toFixed(6)}</span><br /><a href="${maps}" style="color:${INK};">${maps}</a>`;
}

function row(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:8px 14px 8px 0;font:600 12px ${SANS};letter-spacing:0.03em;text-transform:uppercase;color:${FAINT};vertical-align:top;white-space:nowrap;width:132px;">${esc(
      label
    )}</td>
    <td style="padding:8px 0;font:400 14px/21px ${SANS};color:${BODY};vertical-align:top;">${valueHtml}</td>
  </tr>`;
}

export function municipalComplaintEmail(
  d: MunicipalComplaintData,
  office: NearbyOffice | null,
  viewUrl?: string
) {
  const ref = d.reference;
  const slaHours = slaHoursFor(d.severity);
  const slaText =
    slaHours <= 24
      ? `${slaHours} hours`
      : `${Math.round(slaHours / 24)} day${slaHours >= 48 ? "s" : ""}`;

  const addressee = office?.name ?? "The Commissioner / Concerned Officer";
  const addresseeLine = office?.address ? `<br />${esc(office.address)}` : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Civic complaint ${esc(
    ref
  )} — ${esc(d.category)} at ${esc(d.address ?? "the location below")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
 <tr><td align="center" style="padding:36px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${PAPER};border:1px solid ${RULE};">

   <tr><td style="padding:24px 34px 18px;border-bottom:2px solid ${INK};">
     <table role="presentation" width="100%"><tr>
       <td style="font:700 16px ${SANS};color:${INK};">JanReport</td>
       <td align="right" style="font:400 11px ${SANS};letter-spacing:0.07em;text-transform:uppercase;color:${FAINT};">Citizen Complaint Intimation</td>
     </tr></table>
   </td></tr>

   <tr><td style="padding:26px 34px 0;">
     <table role="presentation" width="100%" style="font:400 13px ${SANS};color:${MUTED};">
       <tr>
         <td>Ref: <span style="font-family:${MONO};color:${INK};font-weight:600;">${esc(ref)}</span></td>
         <td align="right">${esc(formatDate(d.createdAt))}</td>
       </tr>
     </table>
   </td></tr>

   <tr><td style="padding:20px 34px 0;font:400 14px/21px ${SANS};color:${BODY};">
     <strong style="color:${INK};">To,</strong><br />
     ${esc(addressee)}${addresseeLine}
   </td></tr>

   <tr><td style="padding:22px 34px 0;">
     <div style="font:600 11px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};padding-bottom:6px;">Subject</div>
     <div style="font:600 17px/24px ${SANS};color:${INK};">${esc(d.title)}</div>
   </td></tr>

   <tr><td style="padding:18px 34px 0;font:400 14px/22px ${SANS};color:${BODY};">
     A citizen has reported the civic issue described below through JanReport. The
     report was classified automatically and routed to
     <strong style="color:${INK};">${esc(d.department ?? "the concerned department")}</strong>.
     Details and photographic evidence are set out below for necessary action.
   </td></tr>

   ${
     d.photoUrl
       ? `<tr><td style="padding:20px 34px 0;">
            <img src="${d.photoUrl}" width="532" alt="${esc(
              d.title
            )}" style="display:block;width:100%;max-width:532px;height:auto;border:1px solid ${RULE};" />
            <div style="font:400 11px ${SANS};color:${FAINT};padding-top:6px;">Photograph submitted by the complainant.</div>
          </td></tr>`
       : ""
   }

   <tr><td style="padding:20px 34px 0;">
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${RULE};">
       ${row("Nature", esc(d.category))}
       ${row(
         "Severity",
         `${esc(d.severityLabel)} <span style="color:${FAINT};">(${d.severity}/10)</span>`
       )}
       ${row("Location", locationBlock(d))}
       ${d.description ? row("Observation", esc(d.description)) : ""}
       ${row("Complainant", esc(d.reporterName ?? "Withheld"))}
       ${d.reporterPhone ? row("Contact", esc(d.reporterPhone)) : ""}
       ${row("Reported on", esc(formatDate(d.createdAt)))}
       ${row(
         "Response sought",
         `Within <strong style="color:${INK};">${esc(slaText)}</strong> as per the severity assessment.`
       )}
     </table>
   </td></tr>

   ${
     viewUrl
       ? `<tr><td style="padding:22px 34px 0;">
            <a href="${viewUrl}" style="font:600 14px ${SANS};color:${INK};border-bottom:1.5px solid ${INK};text-decoration:none;padding-bottom:2px;">View the full record &rarr;</a>
          </td></tr>`
       : ""
   }

   <tr><td style="padding:24px 34px 26px;font:400 14px/21px ${SANS};color:${BODY};">
     Please reply to this email to record action taken. Your reply is attached
     to reference <strong style="color:${INK};">${esc(ref)}</strong> automatically and
     relayed to the complainant.
     <div style="padding-top:14px;color:${MUTED};">Respectfully,<br /><strong style="color:${INK};">JanReport</strong><br />
     <span style="font-size:13px;">On behalf of the complainant named above</span></div>
   </td></tr>

   <tr><td style="padding:14px 34px 18px;border-top:1px solid ${RULE};background:#fafafa;font:400 11px/17px ${SANS};color:${FAINT};">
     Generated automatically from a citizen submission. Severity and category are
     assigned by automated assessment of the photograph and may be revised by the
     department. This intimation does not substitute for any statutory notice.
   </td></tr>

  </table>
 </td></tr>
</table>
</body></html>`;

  const text = [
    `CITIZEN COMPLAINT INTIMATION`,
    `Ref: ${ref}`,
    `Date: ${formatDate(d.createdAt)}`,
    ``,
    `To: ${addressee}`,
    ...(office?.address ? [office.address] : []),
    ``,
    `Subject: ${d.title}`,
    ``,
    `Nature:        ${d.category}`,
    `Severity:      ${d.severityLabel} (${d.severity}/10)`,
    ...(d.address ? [`Location:      ${d.address}`] : []),
    `Coordinates:   ${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}`,
    `Map:           https://www.google.com/maps?q=${d.lat},${d.lng}`,
    `Complainant:   ${d.reporterName ?? "Withheld"}`,
    ...(d.reporterPhone ? [`Contact:       ${d.reporterPhone}`] : []),
    `Response:      Within ${slaText}`,
    ``,
    `Generated from a citizen submission via JanReport.`,
    // No filter(Boolean): the empty strings above are paragraph breaks, and
    // stripping them ran the whole plain-text part together into one block.
    // Optional lines are spread in instead, so an absent address no longer
    // prints a labelled field with nothing after it.
  ].join("\n");

  return {
    subject: `Civic complaint ${ref} — ${d.category} at ${d.address?.split(",")[0] ?? "reported location"}`,
    html,
    text,
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Who the complaint is actually sent to, in priority order:
//
//   1. the department's own configured address, if the operator set one —
//      an explicit choice always beats a lookup
//   2. the nearest VERIFIED office in the municipal directory, chosen from the
//      report's coordinates, so a Ghaziabad pothole reaches Ghaziabad
//   3. MUNICIPAL_EMAIL, a single catch-all inbox
//
// Still deliberately NOT derived from the Places lookup: that returns a name
// and a postal address, never an email. And still never pattern-built — every
// directory row carries the page its address was read from, and unverified
// rows are ignored entirely. With none of the three set, nothing is sent and
// the report files exactly as before.
export async function resolveMunicipalRecipient(params: {
  departmentEmail?: string | null;
  lat: number;
  lng: number;
}): Promise<{ email: string; office: MunicipalOffice | null; via: string } | null> {
  const departmentConfigured = params.departmentEmail?.trim();
  if (departmentConfigured && EMAIL_RE.test(departmentConfigured)) {
    return { email: departmentConfigured, office: null, via: "department" };
  }

  const office = await findMunicipalOfficeFor(
    createServiceRoleClient(),
    params.lat,
    params.lng
  ).catch((err) => {
    console.error("[municipal] directory lookup threw", err);
    return null;
  });

  if (office && EMAIL_RE.test(office.contactEmail)) {
    return { email: office.contactEmail, office, via: "directory" };
  }

  const fallback = process.env.MUNICIPAL_EMAIL?.trim();
  if (fallback && EMAIL_RE.test(fallback)) {
    return { email: fallback, office: null, via: "fallback" };
  }
  return null;
}

// Compose and send in one call, so both filing paths behave identically and
// neither can forget the Places lookup or the recipient rules.
export async function sendMunicipalComplaint(params: {
  data: MunicipalComplaintData;
  departmentEmail?: string | null;
  viewUrl?: string;
}): Promise<{ sent: boolean; to?: string; via?: string; reason?: string }> {
  const recipient = await resolveMunicipalRecipient({
    departmentEmail: params.departmentEmail,
    lat: params.data.lat,
    lng: params.data.lng,
  });
  if (!recipient) return { sent: false, reason: "no_recipient_configured" };
  const to = recipient.email;

  // Address the letter to the body we resolved from the directory, since we
  // know its official name. Otherwise fall back to the Places lookup, which is
  // best-effort: that API is a separate product and may not be enabled, in
  // which case the letter is addressed generically rather than not sent.
  const office: NearbyOffice | null = recipient.office
    ? { name: recipient.office.name, address: "" }
    : await findNearbyMunicipalOffice(params.data.lat, params.data.lng).catch(() => null);

  const mail = municipalComplaintEmail(params.data, office, params.viewUrl);
  // Plus-addressing carries the reference through the reply, so an answer can
  // be matched to its report even if the clerk rewrites the subject line —
  // which they routinely do. The subject and body carry it too, as fallbacks.
  const inbox = process.env.INBOUND_EMAIL || "reports@janreport.xyz";
  const [local, domain] = inbox.split("@");
  const replyTo = domain ? `${local}+${params.data.reference}@${domain}` : inbox;
  const res = await sendEmail({ to, replyTo, ...mail });
  if (!res.ok) {
    console.error("Failed to send the municipal complaint", res.error);
    return { sent: false, reason: res.error };
  }
  console.log(
    `[municipal] complaint ${params.data.reference} sent to ${to} (via ${recipient.via})`
  );
  return { sent: true, to, via: recipient.via };
}
