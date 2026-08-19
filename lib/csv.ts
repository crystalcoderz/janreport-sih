// Minimal CSV serializer — the export is a handful of columns, so a
// dependency isn't worth it. Handles the cases that actually break naive
// joins: embedded quotes, commas, and newlines in free-text fields.
// A cell starting with =, +, -, or @ is interpreted as a formula by
// Excel/Sheets when the CSV is opened — a well-known injection vector
// (CWE-1236) since several of these columns (title, address) ultimately
// trace back to citizen- or AI-generated text we don't fully control.
// Prefixing with a tab keeps the visible text identical while stopping
// spreadsheet apps from treating it as a formula.
const FORMULA_PREFIX_RE = /^[=+\-@]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (FORMULA_PREFIX_RE.test(str)) {
    str = `\t${str}`;
  }
  if (/[",\r\n\t]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

// Triggers a client-side download without a server round-trip. The BOM
// makes Excel open UTF-8 correctly instead of mangling non-ASCII names.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
