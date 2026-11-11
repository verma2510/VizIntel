import type { DateRange, DateRangePreset, Filter, FilterOp } from "../../types";
import { formatDate, formatNumber } from "../format";
import { toNumber, type PreparedDataset } from "./prepare";

const DAY = 864e5;

export const newId = (prefix = "f") => `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const DATE_PRESETS: { value: DateRangePreset; label: string; days?: number }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Latest 7 days", days: 7 },
  { value: "30d", label: "Latest 30 days", days: 30 },
  { value: "90d", label: "Latest 90 days", days: 90 },
  { value: "180d", label: "Latest 6 months", days: 182 },
  { value: "365d", label: "Latest 12 months", days: 365 },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom range" },
];

/**
 * Resolves a date range to [fromMs, toMs]. Relative presets are anchored to the most recent date in the
 * data (not today), so historical datasets still produce meaningful "latest N days" windows.
 */
export function dateRangeBounds(range: DateRange | undefined, extent: [number, number] | null): [number, number] | null {
  if (!range || range.preset === "all") return null;
  if (range.preset === "custom") {
    const from = range.from ? Date.parse(range.from) : -Infinity;
    const to = range.to ? Date.parse(range.to) + DAY - 1 : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to)) return null;
    return [from, to];
  }
  if (!extent) return null;
  const end = extent[1];
  const endDay = Math.floor(end / DAY) * DAY;
  if (range.preset === "ytd") return [Date.UTC(new Date(end).getUTCFullYear(), 0, 1), end];
  const days = DATE_PRESETS.find((p) => p.value === range.preset)?.days ?? 30;
  return [endDay - (days - 1) * DAY, end];
}

export function describeDateRange(range: DateRange | undefined): string {
  if (!range || range.preset === "all") return "All time";
  if (range.preset === "custom") {
    if (range.from && range.to) return `${formatDate(range.from + "T00:00:00Z")} – ${formatDate(range.to + "T00:00:00Z")}`;
    if (range.from) return `From ${formatDate(range.from + "T00:00:00Z")}`;
    if (range.to) return `Until ${formatDate(range.to + "T00:00:00Z")}`;
    return "Custom range";
  }
  return DATE_PRESETS.find((p) => p.value === range.preset)?.label ?? "Custom range";
}

const asArray = (value: Filter["value"]): (string | number)[] =>
  Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];

function rowPredicate(ds: PreparedDataset, f: Filter): ((i: number) => boolean) | null {
  const field = ds.field(f.column);
  if (!field) return null; // filter targets a column this dataset doesn't have: not applicable
  const values = asArray(f.value);
  switch (f.op) {
    case "in":
    case "nin": {
      const set = new Set(values.map(String));
      const strs = ds.str(f.column);
      return f.op === "in" ? (i) => set.has(strs[i]) : (i) => !set.has(strs[i]);
    }
    case "contains": {
      const needle = String(values[0] ?? "").toLowerCase();
      if (!needle) return null;
      const strs = ds.str(f.column);
      return (i) => strs[i].toLowerCase().includes(needle);
    }
    case "dateBetween": {
      const t = ds.time(f.column);
      const lo = values[0] === undefined || values[0] === "" ? -Infinity : Number(values[0]);
      const hi = values[1] === undefined || values[1] === "" ? Infinity : Number(values[1]);
      return (i) => t[i] >= lo && t[i] <= hi;
    }
    default: {
      const nums = ds.num(f.column);
      const a = toNumber(values[0]);
      const b = toNumber(values[1]);
      const ops: Record<Exclude<FilterOp, "in" | "nin" | "contains" | "dateBetween">, (v: number) => boolean> = {
        gt: (v) => v > a,
        gte: (v) => v >= a,
        lt: (v) => v < a,
        lte: (v) => v <= a,
        between: (v) => (Number.isNaN(a) || v >= a) && (Number.isNaN(b) || v <= b),
      };
      const test = ops[f.op as keyof typeof ops];
      if (!test || (f.op !== "between" && Number.isNaN(a))) return null;
      return (i) => Number.isFinite(nums[i]) && test(nums[i]);
    }
  }
}

/** Applies filters (AND) and an optional date range on a date column; returns matching row indices. */
export function applyFilters(
  ds: PreparedDataset,
  filters: Filter[] | undefined,
  options: { dateRange?: DateRange; dateColumn?: string; base?: Uint32Array } = {}
): Uint32Array {
  const base = options.base ?? ds.allIndices();
  const predicates = (filters ?? []).map((f) => rowPredicate(ds, f)).filter((p): p is (i: number) => boolean => p !== null);

  const dateCol = options.dateColumn ?? ds.primaryDate?.name;
  if (options.dateRange && dateCol && ds.has(dateCol)) {
    const bounds = dateRangeBounds(options.dateRange, ds.timeExtent(dateCol));
    if (bounds) {
      const t = ds.time(dateCol);
      predicates.push((i) => t[i] >= bounds[0] && t[i] <= bounds[1]);
    }
  }
  if (!predicates.length) return base;

  const out = new Uint32Array(base.length);
  let n = 0;
  for (let k = 0; k < base.length; k++) {
    const i = base[k];
    let ok = true;
    for (let p = 0; p < predicates.length; p++) {
      if (!predicates[p](i)) {
        ok = false;
        break;
      }
    }
    if (ok) out[n++] = i;
  }
  return out.subarray(0, n);
}

/** Whether a filter can apply to this dataset (it has the column). */
export const filterApplies = (ds: PreparedDataset, f: Filter) => ds.has(f.column);

const OP_LABEL: Record<FilterOp, string> = {
  in: "is",
  nin: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  contains: "contains",
  dateBetween: "between",
};

export function describeFilter(f: Filter, label = f.column): string {
  const values = asArray(f.value);
  if (f.op === "in" || f.op === "nin") {
    const shown = values.slice(0, 2).map(String).join(", ");
    return `${label} ${OP_LABEL[f.op]} ${shown}${values.length > 2 ? ` +${values.length - 2}` : ""}`;
  }
  if (f.op === "dateBetween") {
    const [a, b] = values.map(Number);
    return `${label}: ${Number.isFinite(a) ? formatDate(a) : "…"} – ${Number.isFinite(b) ? formatDate(b) : "…"}`;
  }
  if (f.op === "between") {
    const [a, b] = values.map((v) => toNumber(v));
    return `${label} ${Number.isFinite(a) ? formatNumber(a) : "…"} – ${Number.isFinite(b) ? formatNumber(b) : "…"}`;
  }
  return `${label} ${OP_LABEL[f.op]} ${values[0] ?? ""}`;
}
