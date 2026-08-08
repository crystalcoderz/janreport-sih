import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { googleMapsLink } from "@/lib/geo";
import { findNearbyMunicipalOffice } from "@/lib/places";
import { isAllowedPhotoUrl } from "@/lib/storage";

export interface AcknowledgementParams {
  issueId: string;
  title: string;
  category: string;
  severityLabel: string;
  reporterName: string | null;
  department: string | null;
  address: string | null;
  lat: number;
  lng: number;
  photoUrl: string;
}

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 56;

function detectImageKind(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSig.every((b, i) => bytes[i] === b)) return "png";
  return null;
}

function wrapText(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Generates a formal, single-page acknowledgement letter: the citizen's
// name and report details, the reported location, the nearest municipal
// office we could find (best-effort — see lib/places.ts), and the
// citizen's own submitted photo. Every external step (photo fetch, office
// lookup) degrades gracefully instead of failing the whole document, since
// this gets sent straight to a citizen and half a letter is much better
// than none.
export async function generateAcknowledgementPdf(
  params: AcknowledgementParams
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE_WIDTH - MARGIN_X * 2;

  let y = PAGE_HEIGHT - 60;

  const line = (
    text: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}
  ) => {
    const size = opts.size ?? 11;
    page.drawText(text, {
      x: MARGIN_X,
      y,
      size,
      font: opts.font ?? font,
      color: opts.color ?? rgb(0.12, 0.12, 0.12),
    });
    y -= size + (opts.gap ?? 7);
  };

  const paragraph = (text: string, size = 11, f: PDFFont = font) => {
    for (const wrapped of wrapText(text, size, f, maxWidth)) {
      line(wrapped, { size, font: f, gap: 5 });
    }
  };

  // Header
  line("JanReport", { size: 20, font: bold, color: rgb(0.05, 0.32, 0.6), gap: 4 });
  line("Civic Issue Acknowledgement", { size: 13, font: bold, gap: 10 });
  page.drawLine({
    start: { x: MARGIN_X, y: y + 8 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: y + 8 },
    thickness: 1,
    color: rgb(0.82, 0.82, 0.82),
  });
  y -= 12;

  const dateStr = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  line(`Date: ${dateStr}`, { size: 10, color: rgb(0.45, 0.45, 0.45), gap: 4 });
  line(`Report ID: ${params.issueId.slice(0, 8).toUpperCase()}`, {
    size: 10,
    color: rgb(0.45, 0.45, 0.45),
    gap: 16,
  });

  const reporterName = params.reporterName?.trim() || "Resident";
  line(`Dear ${reporterName},`, { size: 12, font: bold, gap: 12 });

  const categoryLabel = CATEGORY_LABELS[params.category as IssueCategory] ?? params.category;
  paragraph(
    `This is to formally acknowledge receipt of your civic issue report submitted via JanReport. Your report — "${params.title}" (${categoryLabel}, ${params.severityLabel} severity) — has been reviewed and forwarded to the ${params.department ?? "relevant municipal"} department for necessary action.`
  );
  y -= 4;
  paragraph(
    "We appreciate your civic participation in helping us maintain and improve municipal services in your area. You will receive a further update on WhatsApp as the status of your report changes."
  );
  y -= 10;

  line("Reported Location", { size: 12, font: bold, gap: 6 });
  paragraph(params.address ?? `${params.lat.toFixed(5)}, ${params.lng.toFixed(5)}`);
  paragraph(googleMapsLink(params.lat, params.lng), 10, font);
  y -= 8;

  // Best-effort — Places API may not be enabled on every deployment, and
  // a missing/failed lookup should never block the letter itself.
  const office = await findNearbyMunicipalOffice(params.lat, params.lng);
  line("For Further Correspondence", { size: 12, font: bold, gap: 6 });
  if (office) {
    paragraph(office.name, 11, bold);
    paragraph(office.address);
  } else {
    paragraph(
      "Please contact your local Municipal Corporation / Nagar Nigam office regarding this report."
    );
  }
  y -= 12;

  // Best-effort photo embed — SVG/WebP or a fetch failure just becomes a
  // one-line note instead of failing PDF generation.
  let photoEmbedded = false;
  if (isAllowedPhotoUrl(params.photoUrl)) {
    try {
      const res = await fetch(params.photoUrl, { redirect: "error" });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const kind = detectImageKind(bytes);
        if (kind) {
          const image = kind === "jpg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
          const maxImgHeight = Math.min(220, y - 90); // leave room for the footer
          if (maxImgHeight > 40) {
            const scale = Math.min(maxWidth / image.width, maxImgHeight / image.height, 1);
            const imgW = image.width * scale;
            const imgH = image.height * scale;
            line("Submitted Photo", { size: 12, font: bold, gap: 6 });
            page.drawImage(image, { x: MARGIN_X, y: y - imgH, width: imgW, height: imgH });
            y -= imgH + 20;
            photoEmbedded = true;
          }
        }
      }
    } catch {
      // Fall through to the text note below.
    }
  }
  if (!photoEmbedded) {
    paragraph("(Photo submitted separately — see the WhatsApp conversation.)", 10);
    y -= 8;
  }

  line("Regards,", { size: 11, gap: 4 });
  line("JanReport Municipal Services", { size: 11, font: bold });

  return pdf.save();
}
