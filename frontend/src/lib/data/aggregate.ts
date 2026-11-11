import type { Aggregation, DateBucket, SortMode } from "../../types";
import { formatBucketLabel, formatNumber } from "../format";
import { BLANK, type PreparedDataset } from "./prepare";
import { niceBins, quantileSorted } from "./stats";

export const OTHER_KEY = "__other__";
export const OTHER_LABEL = "Other";
const DAY = 864e5;
const MAX_DATE_BUCKETS = 1500;
export const MAX_SERIES_SLOTS = 8;

export type FixedBucket = Exclude<DateBucket, "auto">;

// ---- Accumulator -------------------------------------------------------------------------------

class Acc {
  n = 0;
  s = 0;
  min = Infinity;
  max = -Infinity;
  vals: number[] | null;
  set: Set<string> | null;
  constructor(agg: Aggregation) {
    this.vals = agg === "median" ? [] : null;
    this.set = agg === "distinct" ? new Set() : null;
  }
  add(v: number, raw?: string) {
    if (this.set) {
      if (raw !== undefined && raw !== BLANK) this.set.add(raw);
      return;
    }
    if (!Number.isFinite(v)) return;
    this.n++;
    this.s += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
    this.vals?.push(v);
  }
  countRow() {
    this.n++;
  }
  value(agg: Aggregation): number | null {
    switch (agg) {
      case "sum":
        return this.n ? this.s : 0;
      case "count":
        return this.n;
      case "avg":
        return this.n ? this.s / this.n : null;
      case "min":
        return this.n ? this.min : null;
      case "max":
        return this.n ? this.max : null;
      case "median":
        return this.vals && this.vals.length ? quantileSorted(Float64Array.from(this.vals).sort(), 0.5) : null;
      case "distinct":
        return this.set ? this.set.size : 0;
    }
  }
}

// ---- Date buckets ------------------------------------------------------------------------------

export function bucketStart(t: number, bucket: FixedBucket): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (bucket) {
    case "day":
      return Math.floor(t / DAY) * DAY;
    case "week": {
      const day = Math.floor(t / DAY);
      const dow = (new Date(day * DAY).getUTCDay() + 6) % 7; // Monday-based weeks
      return (day - dow) * DAY;
    }
    case "month":
      return Date.UTC(y, m, 1);
    case "quarter":
      return Date.UTC(y, Math.floor(m / 3) * 3, 1);
    case "year":
      return Date.UTC(y, 0, 1);
  }
}

export function nextBucket(start: number, bucket: FixedBucket): number {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (bucket) {
    case "day":
      return start + DAY;
    case "week":
      return start + 7 * DAY;
    case "month":
      return Date.UTC(y, m + 1, 1);
    case "quarter":
      return Date.UTC(y, m + 3, 1);
    case "year":
      return Date.UTC(y + 1, 0, 1);
  }
}

export function autoBucket(extent: [number, number] | null): FixedBucket {
  if (!extent) return "month";
  const days = (extent[1] - extent[0]) / DAY;
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  if (days <= 365 * 4) return "month";
  if (days <= 365 * 10) return "quarter";
  return "year";
}

// ---- Entity colour slots ---------------------------------------------------------------------

/**
 * Maps visible entity keys to palette slots (0-7). A key keeps the slot of its position in the
 * dataset-wide entity order when that is < 8; keys beyond take the lowest free slot. "Other" => -1.
 */
export function assignSlots(keys: string[], order: string[]): Map<string, number> {
  const slots = new Map<string, number>();
  const used = new Set<number>();
  const pending: string[] = [];
  for (const key of keys) {
    if (key === OTHER_KEY) {
      slots.set(key, -1);
      continue;
    }
    const pos = order.indexOf(key);
    if (pos >= 0 && pos < MAX_SERIES_SLOTS && !used.has(pos)) {
      slots.set(key, pos);
      used.add(pos);
    } else pending.push(key);
  }
  let next = 0;
  for (const key of pending) {
    while (used.has(next) && next < MAX_SERIES_SLOTS) next++;
    slots.set(key, next < MAX_SERIES_SLOTS ? next : -1);
    used.add(next);
  }
  return slots;
}

// ---- Grouped aggregation -------------------------------------------------------------------------

export interface AggSeries {
  key: string;
  name: string;
  values: (number | null)[];
  /** Palette slot (0-7) or -1 for "Other". */
  slot: number;
  /** Metric column this series aggregates (undefined = row count). */
  metric?: string;
}

export interface AggResult {
  xKind: "category" | "date";
  bucket?: FixedBucket;
  keys: string[];
  labels: string[];
  /** Date buckets: [start, end] in ms for drill-down. */
  bounds?: [number, number][];
  series: AggSeries[];
  /** Category keys kept explicitly (the rest were folded into "Other"). */
  keptKeys?: string[];
  keptGroups?: string[];
  rowCount: number;
}

export interface AggregateOptions {
  x: string;
  y: string[];
  agg: Aggregation;
  groupBy?: string;
  bucket?: DateBucket;
  sort?: SortMode;
  limit?: number;
  maxGroups?: number;
}

export function aggregate(ds: PreparedDataset, idx: Uint32Array, opts: AggregateOptions): AggResult {
  const xField = ds.field(opts.x);
  const xKind: AggResult["xKind"] = xField?.role === "date" ? "date" : "category";
  const metrics = (opts.y.length ? opts.y : [undefined]).filter((m) => m === undefined || ds.has(m));
  const effectiveMetrics = metrics.length ? metrics : [undefined];
  const groupCol = opts.groupBy && ds.has(opts.groupBy) && opts.groupBy !== opts.x ? opts.groupBy : undefined;
  const series = groupCol ? effectiveMetrics.slice(0, 1) : effectiveMetrics;
  const agg = opts.agg;

  // Per-row x keys
  const xStr = xKind === "category" ? ds.str(opts.x) : null;
  const xTime = xKind === "date" ? ds.time(opts.x) : null;
  const bucket: FixedBucket | undefined =
    xKind === "date" ? (opts.bucket && opts.bucket !== "auto" ? opts.bucket : autoBucket(ds.timeExtent(opts.x, idx))) : undefined;
  const keyOf = (i: number): string | null => {
    if (xStr) return xStr[i];
    const t = xTime![i];
    return Number.isFinite(t) ? String(bucketStart(t, bucket!)) : null;
  };

  const metricNum = series.map((m) => (m ? ds.num(m) : null));
  const metricStr = series.map((m) => (m && (agg === "distinct" || agg === "count") ? ds.str(m) : null));
  const groupStr = groupCol ? ds.str(groupCol) : null;
  const rank0 = metricNum[0];

  // Pass 1 (only when needed): magnitude per x key / group to choose the top-N and order.
  let keptX: Set<string> | null = null;
  let keptG: Set<string> | null = null;
  const limit = xKind === "category" && opts.limit && opts.limit > 0 ? opts.limit : 0;
  const maxGroups = opts.maxGroups ?? 6;
  if (limit || groupStr) {
    const xTot = new Map<string, number>();
    const gTot = new Map<string, number>();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const w = rank0 ? (Number.isFinite(rank0[i]) ? Math.abs(rank0[i]) : 0) : 1;
      if (limit) {
        const xk = keyOf(i);
        if (xk !== null) xTot.set(xk, (xTot.get(xk) || 0) + w);
      }
      if (groupStr) gTot.set(groupStr[i], (gTot.get(groupStr[i]) || 0) + w);
    }
    if (limit && xTot.size > limit) {
      keptX = new Set([...xTot.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k));
    }
    if (groupStr && gTot.size > maxGroups) {
      keptG = new Set([...gTot.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxGroups).map(([k]) => k));
    }
  }

  // Pass 2: accumulate
  const cells = new Map<string, Map<string, Acc[]>>();
  const firstSeen: string[] = [];
  const groupFirstSeen: string[] = [];
  const seenGroups = new Set<string>();
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    let xk = keyOf(i);
    if (xk === null) continue;
    if (keptX && !keptX.has(xk)) xk = OTHER_KEY;
    let gk = groupStr ? groupStr[i] : "";
    if (keptG && !keptG.has(gk)) gk = OTHER_KEY;
    let row = cells.get(xk);
    if (!row) {
      row = new Map();
      cells.set(xk, row);
      firstSeen.push(xk);
    }
    if (groupStr && !seenGroups.has(gk)) {
      seenGroups.add(gk);
      groupFirstSeen.push(gk);
    }
    let accs = row.get(gk);
    if (!accs) {
      accs = series.map(() => new Acc(agg));
      row.set(gk, accs);
    }
    for (let s = 0; s < series.length; s++) {
      if (series[s] === undefined) accs[s].countRow(); // no metric: count rows
      else if (agg === "count") {
        if (metricStr[s]![i] !== BLANK) accs[s].countRow(); // count non-empty values
      } else accs[s].add(metricNum[s]![i], metricStr[s]?.[i]);
    }
  }

  // Ordered x keys
  let keys: string[];
  let bounds: [number, number][] | undefined;
  if (xKind === "date") {
    const starts = firstSeen.map(Number).sort((a, b) => a - b);
    keys = [];
    bounds = [];
    if (starts.length) {
      // Fill gaps so time reads continuously (bounded to keep the chart sane).
      let cur = starts[0];
      const last = starts[starts.length - 1];
      while (cur <= last && keys.length < MAX_DATE_BUCKETS) {
        const next = nextBucket(cur, bucket!);
        keys.push(String(cur));
        bounds.push([cur, next - 1]);
        cur = next;
      }
    }
  } else {
    const total = (key: string) => {
      const row = cells.get(key);
      if (!row) return 0;
      let t = 0;
      for (const accs of row.values()) t += accs[0].value(agg) ?? 0;
      return t;
    };
    const real = firstSeen.filter((k) => k !== OTHER_KEY);
    switch (opts.sort) {
      case "desc":
        keys = [...real].sort((a, b) => total(b) - total(a));
        break;
      case "asc":
        keys = [...real].sort((a, b) => total(a) - total(b));
        break;
      case "label":
        keys = [...real].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        break;
      default:
        keys = real;
    }
    if (cells.has(OTHER_KEY)) keys.push(OTHER_KEY);
  }

  const labels =
    xKind === "date"
      ? keys.map((k) => formatBucketLabel(Number(k), bucket!))
      : keys.map((k) => (k === OTHER_KEY ? OTHER_LABEL : xField?.role === "measure" ? formatNumber(Number(k)) : k));

  const missingValue = agg === "sum" || agg === "count" || agg === "distinct" ? 0 : null;
  const valueAt = (xk: string, gk: string, s: number): number | null => {
    const accs = cells.get(xk)?.get(gk);
    return accs ? accs[s].value(agg) : missingValue;
  };

  let out: AggSeries[];
  if (groupStr) {
    const realGroups = groupFirstSeen.filter((g) => g !== OTHER_KEY);
    const order = ds.entityOrder(groupCol!);
    realGroups.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const groups = seenGroups.has(OTHER_KEY) ? [...realGroups, OTHER_KEY] : realGroups;
    const slots = assignSlots(groups, order);
    out = groups.map((g) => ({
      key: g,
      name: g === OTHER_KEY ? OTHER_LABEL : g,
      values: keys.map((xk) => valueAt(xk, g, 0)),
      slot: slots.get(g) ?? -1,
      metric: series[0],
    }));
  } else {
    out = series.map((m, s) => ({
      key: m ?? "__rows__",
      name: m ? ds.field(m)?.label ?? m : "Rows",
      values: keys.map((xk) => valueAt(xk, "", s)),
      slot: s % MAX_SERIES_SLOTS,
      metric: m,
    }));
  }

  return {
    xKind,
    bucket,
    keys,
    labels,
    bounds,
    series: out,
    keptKeys: keptX ? [...keptX] : undefined,
    keptGroups: keptG ? [...keptG] : undefined,
    rowCount: idx.length,
  };
}

// ---- Histogram ---------------------------------------------------------------------------------

export interface HistogramResult {
  edges: number[];
  counts: number[];
  labels: string[];
  total: number;
}

export function histogram(ds: PreparedDataset, idx: Uint32Array, column: string, bins?: number): HistogramResult {
  const nums = ds.num(column);
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  for (let k = 0; k < idx.length; k++) {
    const v = nums[idx[k]];
    if (!Number.isFinite(v)) continue;
    total++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!total) return { edges: [], counts: [], labels: [], total: 0 };
  const target = bins && bins > 1 ? bins : Math.min(30, Math.max(6, Math.ceil(Math.log2(total) + 1)));
  const edges = niceBins(min, max, target);
  const counts = new Array(Math.max(0, edges.length - 1)).fill(0);
  const step = edges[1] - edges[0];
  for (let k = 0; k < idx.length; k++) {
    const v = nums[idx[k]];
    if (!Number.isFinite(v)) continue;
    let b = Math.floor((v - edges[0]) / step);
    if (b >= counts.length) b = counts.length - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const labels = counts.map((_, b) => `${formatNumber(edges[b])}–${formatNumber(edges[b + 1])}`);
  return { edges, counts, labels, total };
}

// ---- Scatter -----------------------------------------------------------------------------------

export interface ScatterGroup {
  key: string;
  name: string;
  slot: number;
  points: { x: number; y: number; r?: number; i: number }[];
}

export function scatterPoints(
  ds: PreparedDataset,
  idx: Uint32Array,
  opts: { x: string; y: string; groupBy?: string; size?: string; maxPoints?: number }
): { groups: ScatterGroup[]; sampled: boolean; total: number } {
  const xs = ds.num(opts.x);
  const ys = ds.num(opts.y);
  const sizes = opts.size && ds.has(opts.size) ? ds.num(opts.size) : null;
  const groupStr = opts.groupBy && ds.has(opts.groupBy) ? ds.str(opts.groupBy) : null;
  const maxPoints = opts.maxPoints ?? 4000;
  const stride = idx.length > maxPoints ? idx.length / maxPoints : 1;

  let sMin = Infinity;
  let sMax = -Infinity;
  if (sizes) {
    for (let k = 0; k < idx.length; k++) {
      const v = sizes[idx[k]];
      if (Number.isFinite(v)) {
        sMin = Math.min(sMin, v);
        sMax = Math.max(sMax, v);
      }
    }
  }
  const radius = (v: number) => {
    if (!sizes || !Number.isFinite(v)) return 4;
    if (sMax === sMin) return 8;
    return 4 + Math.sqrt((v - sMin) / (sMax - sMin)) * 16;
  };

  const order = groupStr ? ds.entityOrder(opts.groupBy!) : [];
  const top = new Set(order.slice(0, 6));
  const byGroup = new Map<string, ScatterGroup["points"]>();
  let total = 0;
  for (let p = 0; p < idx.length; p += stride) {
    const i = idx[Math.floor(p)];
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    total++;
    const g = groupStr ? (top.has(groupStr[i]) ? groupStr[i] : OTHER_KEY) : "__all__";
    let list = byGroup.get(g);
    if (!list) {
      list = [];
      byGroup.set(g, list);
    }
    list.push({ x, y, r: sizes ? radius(sizes[i]) : undefined, i });
  }
  const keys = [...byGroup.keys()].sort((a, b) => (a === OTHER_KEY ? 1 : b === OTHER_KEY ? -1 : order.indexOf(a) - order.indexOf(b)));
  const slots = assignSlots(keys, groupStr ? order : ["__all__"]);
  return {
    groups: keys.map((k) => ({
      key: k,
      name: k === OTHER_KEY ? OTHER_LABEL : k === "__all__" ? `${ds.field(opts.y)?.label ?? opts.y}` : k,
      slot: slots.get(k) ?? 0,
      points: byGroup.get(k)!,
    })),
    sampled: stride > 1,
    total,
  };
}

/** Single aggregate over a set of rows (KPI tiles). */
export function aggregateValue(ds: PreparedDataset, idx: Uint32Array, column: string | undefined, agg: Aggregation): number | null {
  const acc = new Acc(agg);
  if (!column || !ds.has(column)) {
    return idx.length;
  }
  const nums = ds.num(column);
  const strs = agg === "distinct" || agg === "count" ? ds.str(column) : null;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (agg === "count") {
      if (strs![i] !== BLANK) acc.countRow();
    } else acc.add(nums[i], strs?.[i]);
  }
  return acc.value(agg);
}
