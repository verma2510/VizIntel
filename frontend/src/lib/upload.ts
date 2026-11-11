/* Client-side upload validation (mirrors the API: CSV/Excel, UPLOAD_MAX_FILE_MB default 15). */
export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
export const MAX_UPLOAD_MB = 15;

export function validateFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return "Upload a CSV or Excel file (.csv, .xlsx, .xls).";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `That file is larger than ${MAX_UPLOAD_MB} MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}
