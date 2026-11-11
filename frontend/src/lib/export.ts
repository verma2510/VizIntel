/* Client-side exports: CSV / JSON downloads and chart PNGs. Everything is generated from loaded data. */
import type { Row } from "../types";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (name: string, ext: string) =>
  `${name.replace(/\.(csv|xlsx|xls)$/i, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "vizintel"}.${ext}`;

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Neutralise spreadsheet formula injection for values that would be evaluated by Excel/Sheets.
  const guarded = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

export function downloadRowsCsv(rows: Row[], columns: string[], indices: ArrayLike<number> | null, filename: string): void {
  const list = indices ? Array.from(indices, (i) => rows[i]) : rows;
  const csv = toCsv(columns, list.map((r) => columns.map((c) => r[c])));
  downloadBlob(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadTableCsv(headers: string[], rows: string[][], filename: string): void {
  downloadBlob(new Blob(["\ufeff", toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadJson(data: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
