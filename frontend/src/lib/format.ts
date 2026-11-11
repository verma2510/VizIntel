import type { SemanticType } from "../types";
import { getPrefs } from "./prefs";

const nfCache = new Map<string, Intl.NumberFormat>();
const nf = (options: Intl.NumberFormatOptions) => {
  const key = JSON.stringify(options);
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, options);
    nfCache.set(key, f);
  }
  return f;
};

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };

export interface FormatOptions {
  compact?: boolean;
  /** Percentage columns stored as fractions (0.42) rather than whole numbers (42). */
  percentIsFraction?: boolean;
  decimals?: number;
}

export function formatNumber(value: number | null | undefined, { compact, decimals }: FormatOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  const useCompact = compact ?? getPrefs().compactNumbers;
  const abs = Math.abs(value);
  if (useCompact && abs >= 10000) {
    return nf({ notation: "compact", maximumFractionDigits: abs >= 1e6 ? 2 : 1 }).format(value);
  }
  const maxDigits = decimals ?? (abs >= 100 ? 0 : abs >= 1 ? 2 : abs === 0 ? 0 : 3);
  return nf({ maximumFractionDigits: maxDigits, minimumFractionDigits: 0 }).format(value);
}

/** Formats a value according to the column's semantic type and the user's currency preference. */
export function formatMeasure(value: number | null | undefined, semanticType?: SemanticType, options: FormatOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (semanticType === "percentage") {
    const pct = options.percentIsFraction ? value * 100 : value;
    return `${nf({ maximumFractionDigits: Math.abs(pct) >= 10 ? 1 : 2 }).format(pct)}%`;
  }
  const text = formatNumber(value, options);
  if (semanticType === "currency") {
    const symbol = CURRENCY_SYMBOL[getPrefs().currency];
    if (symbol) return value < 0 ? `−${symbol}${text.replace(/^[-−]/, "")}` : `${symbol}${text}`;
  }
  return text;
}

export const formatInteger = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : nf({ maximumFractionDigits: 0 }).format(value);

/** Signed relative change, e.g. "+12.4%". `fraction` is 0.124. */
export function formatDelta(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Math.abs(pct))}%`;
}

export const formatShare = (fraction: number) => `${nf({ maximumFractionDigits: fraction < 0.1 ? 1 : 0 }).format(fraction * 100)}%`;

const dfCache = new Map<string, Intl.DateTimeFormat>();
const df = (options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options);
  let f = dfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, options);
    dfCache.set(key, f);
  }
  return f;
};

export function formatDate(value: string | number | Date | null | undefined, style: "short" | "medium" | "long" | "datetime" = "medium"): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  switch (style) {
    case "short":
      return df({ month: "short", day: "numeric" }).format(d);
    case "long":
      return df({ year: "numeric", month: "long", day: "numeric" }).format(d);
    case "datetime":
      return df({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
    default:
      return df({ year: "numeric", month: "short", day: "numeric" }).format(d);
  }
}

/** UTC-based date label for bucketed chart axes (data dates are calendar dates, not instants). */
export function formatBucketLabel(ms: number, bucket: "day" | "week" | "month" | "quarter" | "year"): string {
  const d = new Date(ms);
  switch (bucket) {
    case "year":
      return String(d.getUTCFullYear());
    case "quarter":
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case "month":
      return df({ month: "short", year: "numeric", timeZone: "UTC" }).format(d);
    default:
      return df({ month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }).format(d);
  }
}

export function formatRelative(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["week", 7 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(-Math.round(diff / size), unit);
  }
  return "just now";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${formatInteger(count)} ${count === 1 ? singular : plural}`;

export const AGG_LABEL: Record<string, string> = {
  sum: "Total",
  avg: "Average",
  count: "Count",
  min: "Minimum",
  max: "Maximum",
  median: "Median",
  distinct: "Distinct",
};
