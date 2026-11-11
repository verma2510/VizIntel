/**
 * Automated analysis ("signals"): deterministic statistics over the real rows that complement the LLM
 * narrative. Everything here is computed from data — no sampling of the model, no invented numbers —
 * so each signal links to the chart that proves it.
 */
import type { Aggregation, ChartSpec, SemanticType } from "../types";
import { formatDelta, formatInteger, formatMeasure, formatShare } from "./format";
import { aggregate, OTHER_KEY } from "./data/aggregate";
import { BLANK, type Field, type FieldRole, type PreparedDataset } from "./data/prepare";
import { linearTrend, mean, pearson, quantileSorted, robustZ, skewness, stddev } from "./data/stats";

export type SignalKind = "trend" | "change" | "anomaly" | "outlier" | "correlation" | "concentration" | "segment" | "distribution" | "quality";
export type Tone = "neutral" | "warning" | "info";

export interface Signal {
  id: string;
  kind: SignalKind;
  tone: Tone;
  direction?: "up" | "down";
  title: string;
  detail: string;
  /** Headline figure, already formatted. */
  metric?: string;
  score: number;
  spec?: ChartSpec;
  columns: string[];
  /** Row indices that exhibit the signal (outliers), for drill-down. */
  rows?: number[];
}

export interface ColumnProfile {
  name: string;
  label: string;
  role: FieldRole;
  semanticType?: SemanticType;
  count: number;
  missing: number;
  distinct: number;
  numeric?: { min: number; max: number; mean: number; median: number; std: number; q1: number; q3: number; sum: number; outliers: number };
  date?: { min: number; max: number };
  top?: { value: string; count: number }[];
}

export interface KpiSummary {
  column?: string;
  label: string;
  agg: Aggregation;
  value: number | null;
  semanticType?: SemanticType;
  percentIsFraction?: boolean;
  spark?: number[];
  delta?: number | null;
  deltaLabel?: string;
}

export interface Recommendation {
  id: string;
  spec: ChartSpec;
  reason: string;
  score: number;
}

export interface Correlation {
  a: string;
  b: string;
  r: number;
  n: number;
}

export interface Analysis {
  rowCount: number;
  profiles: ColumnProfile[];
  kpis: KpiSummary[];
  signals: Signal[];
  recommendations: Recommendation[];
  correlations: Correlation[];
  quality: { score: number; issues: string[]; duplicates: number };
}

const fmtFor = (ds: PreparedDataset, col: string) => {
  const sem = ds.semantic(col);
  const percentIsFraction = sem === "percentage" ? ds.percentIsFraction(col) : false;
  return (v: number, compact = true) => formatMeasure(v, sem, { compact, percentIsFraction });
};

/** Percentages and rates are averaged; amounts and quantities are summed. */
export const naturalAgg = (field: Field | undefined): Aggregation => (field?.semanticType === "percentage" ? "avg" : "sum");

function finiteValues(ds: PreparedDataset, col: string, idx: Uint32Array): Float64Array {
  const nums = ds.num(col);
  const out = new Float64Array(idx.length);
  let n = 0;
  for (let k = 0; k < idx.length; k++) {
    const v = nums[idx[k]];
    if (Number.isFinite(v)) out[n++] = v;
  }
  return out.subarray(0, n);
}

export function profileColumns(ds: PreparedDataset, idx: Uint32Array): ColumnProfile[] {
  return ds.fields.map((f) => {
    const strs = ds.str(f.name);
    const counts = new Map<string, number>();
    let missing = 0;
    for (let k = 0; k < idx.length; k++) {
      const s = strs[idx[k]];
      if (s === BLANK) missing++;
      else counts.set(s, (counts.get(s) || 0) + 1);
    }
    const profile: ColumnProfile = {
      name: f.name,
      label: f.label,
      role: f.role,
      semanticType: f.semanticType,
      count: idx.length - missing,
      missing,
      distinct: counts.size,
    };
    if (f.role === "measure") {
      const vals = finiteValues(ds, f.name, idx);
      if (vals.length) {
        const sorted = Float64Array.from(vals).sort();
        const q1 = quantileSorted(sorted, 0.25);
        const q3 = quantileSorted(sorted, 0.75);
        const iqr = q3 - q1;
        let outliers = 0;
        if (iqr > 0) for (const v of sorted) if (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) outliers++;
        let s = 0;
        for (const v of vals) s += v;
        profile.numeric = { min: sorted[0], max: sorted[sorted.length - 1], mean: s / vals.length, median: quantileSorted(sorted, 0.5), std: stddev(vals), q1, q3, sum: s, outliers };
      }
    } else if (f.role === "date") {
      const ext = ds.timeExtent(f.name, idx);
      if (ext) profile.date = { min: ext[0], max: ext[1] };
    }
    if (f.role !== "measure" && f.role !== "date") {
      profile.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count }));
    }
    return profile;
  });
}

function orderedMeasures(ds: PreparedDataset, preferred?: string[]): Field[] {
  const measures = ds.measures;
  if (!preferred?.length) return measures;
  const rank = (f: Field) => {
    const i = preferred.indexOf(f.name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...measures].sort((a, b) => rank(a) - rank(b));
}

/** Time series of a measure on the primary date column (sum per auto bucket, gaps filled). */
function timeSeries(ds: PreparedDataset, idx: Uint32Array, measure: string, agg: Aggregation) {
  const date = ds.primaryDate;
  if (!date) return null;
  const res = aggregate(ds, idx, { x: date.name, y: [measure], agg, bucket: "auto" });
  if (res.keys.length < 2) return null;
  return { labels: res.labels, values: res.series[0].values.map((v) => v ?? 0), bucket: res.bucket ?? "month", date: date.name };
}

export function computeKpis(ds: PreparedDataset, idx: Uint32Array, preferred?: string[], max = 6): KpiSummary[] {
  return orderedMeasures(ds, preferred)
    .slice(0, max)
    .map((f) => {
      const agg = naturalAgg(f);
      const vals = finiteValues(ds, f.name, idx);
      const value = vals.length ? (agg === "avg" ? mean(vals) : vals.reduce((a, b) => a + b, 0)) : null;
      const series = timeSeries(ds, idx, f.name, agg);
      let delta: number | null = null;
      let deltaLabel: string | undefined;
      if (series && series.values.length >= 2) {
        const last = series.values[series.values.length - 1];
        const prev = series.values[series.values.length - 2];
        if (prev) {
          delta = (last - prev) / Math.abs(prev);
          deltaLabel = `${series.labels[series.labels.length - 1]} vs previous ${series.bucket}`;
        }
      }
      return {
        column: f.name,
        label: f.label,
        agg,
        value,
        semanticType: f.semanticType,
        percentIsFraction: f.semanticType === "percentage" ? ds.percentIsFraction(f.name) : undefined,
        spark: series?.values.slice(-24),
        delta,
        deltaLabel,
      };
    });
}

let sid = 0;
const signalId = (kind: string) => `${kind}-${++sid}`;

export function analyze(ds: PreparedDataset, idx: Uint32Array = ds.allIndices(), options: { kpiColumns?: string[] } = {}): Analysis {
  const profiles = profileColumns(ds, idx);
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const measures = orderedMeasures(ds, options.kpiColumns).filter((m) => (byName.get(m.name)?.numeric ? true : false));
  const dims = ds.dimensions.filter((d) => {
    const p = byName.get(d.name);
    return p && p.distinct >= 2 && p.distinct <= 200;
  });
  const date = ds.primaryDate;
  const signals: Signal[] = [];
  const n = idx.length;

  // 1-3. Trends, latest-period changes and anomalies over time
  if (date) {
    for (const m of measures.slice(0, 4)) {
      const agg = naturalAgg(m);
      const series = timeSeries(ds, idx, m.name, agg);
      if (!series || series.values.length < 4) continue;
      const fmt = fmtFor(ds, m.name);
      const vals = series.values;
      const { r2 } = linearTrend(vals);
      const head = mean(vals.slice(0, Math.min(3, Math.floor(vals.length / 2))));
      const tail = mean(vals.slice(-Math.min(3, Math.floor(vals.length / 2))));
      const change = head ? (tail - head) / Math.abs(head) : NaN;
      const spec: ChartSpec = { type: "area", x: series.date, y: [m.name], agg, bucket: "auto", title: `${m.label} over time` };
      if (r2 >= 0.35 && Math.abs(change) >= 0.1) {
        const up = change > 0;
        signals.push({
          id: signalId("trend"),
          kind: "trend",
          tone: "neutral",
          direction: up ? "up" : "down",
          title: `${m.label} is trending ${up ? "up" : "down"}`,
          detail: `Averaging the first and last periods, ${m.label} moved ${formatDelta(change)} across ${vals.length} ${series.bucket}s (${series.labels[0]} → ${series.labels[vals.length - 1]}). The trend explains ${Math.round(r2 * 100)}% of the variation.`,
          metric: formatDelta(change),
          score: 0.55 + Math.min(0.35, Math.abs(change) * 0.3) + r2 * 0.1,
          spec,
          columns: [m.name, series.date],
        });
      }
      const last = vals[vals.length - 1];
      const prev = vals[vals.length - 2];
      const latest = prev ? (last - prev) / Math.abs(prev) : NaN;
      if (Number.isFinite(latest) && Math.abs(latest) >= 0.2) {
        signals.push({
          id: signalId("change"),
          kind: "change",
          tone: "neutral",
          direction: latest > 0 ? "up" : "down",
          title: `${m.label} ${latest > 0 ? "rose" : "fell"} ${formatDelta(Math.abs(latest)).replace("+", "")} in the latest ${series.bucket}`,
          detail: `${series.labels[vals.length - 1]}: ${fmt(last, false)} vs ${fmt(prev, false)} in ${series.labels[vals.length - 2]}. If the latest ${series.bucket} is still in progress, this comparison will understate it.`,
          metric: formatDelta(latest),
          score: 0.45 + Math.min(0.3, Math.abs(latest) * 0.2),
          spec,
          columns: [m.name, series.date],
        });
      }
      if (vals.length >= 8) {
        const z = robustZ(vals);
        const med = quantileSorted(Float64Array.from(vals).sort(), 0.5);
        const flagged = z
          .map((zi, i) => ({ zi, i }))
          .filter(({ zi }) => Math.abs(zi) >= 3.5)
          .sort((a, b) => Math.abs(b.zi) - Math.abs(a.zi))
          .slice(0, 2);
        for (const { zi, i } of flagged) {
          const ratio = med ? vals[i] / med : NaN;
          signals.push({
            id: signalId("anomaly"),
            kind: "anomaly",
            tone: "warning",
            direction: zi > 0 ? "up" : "down",
            title: `Unusual ${zi > 0 ? "spike" : "dip"} in ${m.label} — ${series.labels[i]}`,
            detail: `${fmt(vals[i], false)} against a typical ${series.bucket} of ${fmt(med, false)}${Number.isFinite(ratio) && ratio > 0 ? ` (${ratio.toFixed(1)}×)` : ""}. It sits ${Math.abs(zi).toFixed(1)} robust standard deviations from the median.`,
            metric: Number.isFinite(ratio) && ratio > 0 ? `${ratio.toFixed(1)}×` : undefined,
            score: 0.6 + Math.min(0.3, (Math.abs(zi) - 3.5) * 0.05),
            spec,
            columns: [m.name, series.date],
          });
        }
      }
    }
  }

  // 4. Row-level outliers (IQR fences) and skew
  for (const m of measures.slice(0, 6)) {
    const p = byName.get(m.name)!.numeric!;
    const fmt = fmtFor(ds, m.name);
    const iqr = p.q3 - p.q1;
    if (iqr > 0 && p.outliers > 0 && p.outliers <= Math.max(1, n * 0.05)) {
      const hi = p.q3 + 1.5 * iqr;
      const lo = p.q1 - 1.5 * iqr;
      const nums = ds.num(m.name);
      const rows: number[] = [];
      for (let k = 0; k < idx.length; k++) {
        const v = nums[idx[k]];
        if (Number.isFinite(v) && (v > hi || v < lo)) rows.push(idx[k]);
      }
      rows.sort((a, b) => Math.abs(nums[b] - p.median) - Math.abs(nums[a] - p.median));
      signals.push({
        id: signalId("outlier"),
        kind: "outlier",
        tone: "warning",
        title: `${formatInteger(p.outliers)} outlier ${p.outliers === 1 ? "row" : "rows"} in ${m.label}`,
        detail: `Values outside ${fmt(lo, false)} – ${fmt(hi, false)} (1.5× the interquartile range). The most extreme is ${fmt(nums[rows[0]], false)}; the median is ${fmt(p.median, false)}. Check them for data-entry errors before they distort totals.`,
        metric: formatInteger(p.outliers),
        score: 0.5 + Math.min(0.2, p.outliers / Math.max(1, n)),
        spec: { type: "histogram", y: [m.name], agg: "count", title: `Distribution of ${m.label}` },
        columns: [m.name],
        rows: rows.slice(0, 50),
      });
    }
    const sk = skewness(finiteValues(ds, m.name, idx));
    if (sk > 2 && p.mean > p.median * 1.5 && p.median > 0) {
      signals.push({
        id: signalId("distribution"),
        kind: "distribution",
        tone: "info",
        title: `${m.label} has a long tail`,
        detail: `The mean (${fmt(p.mean, false)}) is ${(p.mean / p.median).toFixed(1)}× the median (${fmt(p.median, false)}): a few large values dominate. Medians describe a "typical" row better than averages here.`,
        metric: `${(p.mean / p.median).toFixed(1)}×`,
        score: 0.35,
        spec: { type: "histogram", y: [m.name], agg: "count", title: `Distribution of ${m.label}` },
        columns: [m.name],
      });
    }
  }

  // 5. Correlations between measures
  const corrMeasures = measures.slice(0, 8);
  const correlations: Correlation[] = [];
  for (let a = 0; a < corrMeasures.length; a++) {
    for (let b = a + 1; b < corrMeasures.length; b++) {
      const { r, n: pairs } = pearson(ds.num(corrMeasures[a].name), ds.num(corrMeasures[b].name), idx);
      if (Number.isFinite(r)) correlations.push({ a: corrMeasures[a].name, b: corrMeasures[b].name, r, n: pairs });
    }
  }
  correlations
    .filter((c) => Math.abs(c.r) >= 0.6 && c.n >= 10 && Math.abs(c.r) < 0.999)
    .sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
    .slice(0, 3)
    .forEach((c) => {
      const la = ds.field(c.a)?.label ?? c.a;
      const lb = ds.field(c.b)?.label ?? c.b;
      const positive = c.r > 0;
      signals.push({
        id: signalId("correlation"),
        kind: "correlation",
        tone: "info",
        direction: positive ? "up" : "down",
        title: `${la} and ${lb} ${positive ? "move together" : "move in opposite directions"}`,
        detail: `Pearson r = ${c.r.toFixed(2)} across ${formatInteger(c.n)} rows: rows with higher ${la} tend to have ${positive ? "higher" : "lower"} ${lb}. Correlation alone doesn't establish cause.`,
        metric: `r ${c.r.toFixed(2)}`,
        score: 0.4 + Math.abs(c.r) * 0.35,
        spec: { type: "scatter", x: c.a, y: [c.b], agg: "sum", title: `${lb} vs ${la}` },
        columns: [c.a, c.b],
      });
    });

  // 6. Concentration & segment gaps for the primary measure
  const primary = measures[0];
  if (primary) {
    const fmt = fmtFor(ds, primary.name);
    for (const d of dims.slice(0, 4)) {
      const res = aggregate(ds, idx, { x: d.name, y: [primary.name], agg: "sum", sort: "desc" });
      const values = res.series[0]?.values.map((v) => v ?? 0) ?? [];
      const total = values.reduce((a, b) => a + b, 0);
      if (total <= 0 || values.some((v) => v < 0) || values.length < 3) continue;
      const topShare = values[0] / total;
      let cum = 0;
      let k80 = 0;
      for (const v of values) {
        cum += v;
        k80++;
        if (cum / total >= 0.8) break;
      }
      const partSpec: ChartSpec =
        values.length <= 6
          ? { type: "doughnut", x: d.name, y: [primary.name], agg: "sum", title: `${primary.label} share by ${d.label}` }
          : { type: "hbar", x: d.name, y: [primary.name], agg: "sum", sort: "desc", limit: 10, title: `Top ${d.label} by ${primary.label}` };
      if (values.length >= 5 && k80 / values.length <= 0.3) {
        signals.push({
          id: signalId("concentration"),
          kind: "concentration",
          tone: "info",
          title: `${k80} of ${values.length} ${d.label} values drive 80% of ${primary.label}`,
          detail: `${primary.label} is concentrated: ${res.labels.slice(0, Math.min(3, k80)).join(", ")}${k80 > 3 ? " and others" : ""} account for ${formatShare(cum / total)} of the ${fmt(total, false)} total.`,
          metric: formatShare(cum / total),
          score: 0.55 + (1 - k80 / values.length) * 0.25,
          spec: partSpec,
          columns: [d.name, primary.name],
        });
      } else if (topShare >= 0.3) {
        signals.push({
          id: signalId("concentration"),
          kind: "concentration",
          tone: "info",
          title: `${res.labels[0]} accounts for ${formatShare(topShare)} of ${primary.label}`,
          detail: `${res.labels[0]} contributes ${fmt(values[0], false)} of ${fmt(total, false)} across ${values.length} ${d.label} values; the next largest, ${res.labels[1]}, contributes ${formatShare(values[1] / total)}.`,
          metric: formatShare(topShare),
          score: 0.5 + topShare * 0.3,
          spec: partSpec,
          columns: [d.name, primary.name],
        });
      }
    }
    for (const d of dims.filter((x) => (byName.get(x.name)?.distinct ?? 0) <= 20).slice(0, 2)) {
      const avgRes = aggregate(ds, idx, { x: d.name, y: [primary.name], agg: "avg" });
      const cntRes = aggregate(ds, idx, { x: d.name, y: [], agg: "count" });
      const counts = new Map(cntRes.keys.map((k, i) => [k, cntRes.series[0].values[i] ?? 0]));
      const rows = avgRes.keys
        .map((k, i) => ({ k, label: avgRes.labels[i], v: avgRes.series[0].values[i] }))
        .filter((r) => r.k !== OTHER_KEY && r.v !== null && r.v > 0 && (counts.get(r.k) ?? 0) >= 5)
        .sort((a, b) => b.v! - a.v!);
      if (rows.length < 2) continue;
      const best = rows[0];
      const worst = rows[rows.length - 1];
      const ratio = best.v! / worst.v!;
      if (ratio >= 1.5) {
        signals.push({
          id: signalId("segment"),
          kind: "segment",
          tone: "info",
          title: `${best.label} outperforms ${worst.label} on average ${primary.label}`,
          detail: `Average ${primary.label} per row is ${fmt(best.v!, false)} for ${best.label} vs ${fmt(worst.v!, false)} for ${worst.label} — ${ratio.toFixed(1)}× higher.`,
          metric: `${ratio.toFixed(1)}×`,
          score: 0.45 + Math.min(0.25, (ratio - 1.5) * 0.08),
          spec: { type: "bar", x: d.name, y: [primary.name], agg: "avg", sort: "desc", title: `Average ${primary.label} by ${d.label}` },
          columns: [d.name, primary.name],
        });
      }
    }
  }

  // 7. Data quality
  const issues: string[] = [];
  let penalty = 0;
  for (const p of profiles) {
    const pct = n ? p.missing / n : 0;
    if (pct >= 0.05) {
      issues.push(`${p.label}: ${formatShare(pct)} of values are missing.`);
      penalty += Math.min(15, pct * 30);
    }
    if (p.distinct === 1 && n > 1) {
      issues.push(`${p.label} has the same value in every row.`);
      penalty += 3;
    }
  }
  let duplicates = 0;
  if (n <= 60000) {
    const seen = new Set<string>();
    for (let k = 0; k < idx.length; k++) {
      const key = JSON.stringify(ds.rows[idx[k]]);
      if (seen.has(key)) duplicates++;
      else seen.add(key);
    }
    if (duplicates) {
      issues.push(`${formatInteger(duplicates)} duplicate ${duplicates === 1 ? "row" : "rows"} (identical in every column).`);
      penalty += Math.min(20, (duplicates / Math.max(1, n)) * 100);
    }
  }
  if (issues.length) {
    signals.push({
      id: signalId("quality"),
      kind: "quality",
      tone: "warning",
      title: `${issues.length} data quality ${issues.length === 1 ? "issue" : "issues"} to review`,
      detail: issues.slice(0, 3).join(" "),
      score: 0.3 + Math.min(0.3, penalty / 100),
      columns: [],
    });
  }

  signals.sort((a, b) => b.score - a.score);

  return {
    rowCount: n,
    profiles,
    kpis: computeKpis(ds, idx, options.kpiColumns),
    signals: signals.slice(0, 14),
    recommendations: recommendCharts(ds, profiles, correlations, options.kpiColumns),
    correlations,
    quality: { score: Math.max(0, Math.round(100 - penalty)), issues, duplicates },
  };
}

/** Chart recommender: maps field roles + cardinalities to the chart forms that answer real questions. */
export function recommendCharts(ds: PreparedDataset, profiles: ColumnProfile[], correlations: Correlation[], kpiColumns?: string[]): Recommendation[] {
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const measures = orderedMeasures(ds, kpiColumns).filter((m) => byName.get(m.name)?.numeric);
  const dims = ds.dimensions.filter((d) => {
    const p = byName.get(d.name);
    return p && p.distinct >= 2 && p.distinct <= 500;
  });
  const date = ds.primaryDate;
  const recs: Recommendation[] = [];
  const add = (spec: ChartSpec, reason: string, score: number) => recs.push({ id: `rec-${recs.length}`, spec, reason, score });
  const m0 = measures[0];
  const m1 = measures[1];
  const distinct = (name: string) => byName.get(name)?.distinct ?? 0;
  const avgLabelLength = (name: string) => {
    const top = byName.get(name)?.top ?? [];
    return top.length ? top.reduce((s, t) => s + t.value.length, 0) / top.length : 0;
  };

  if (date && m0) {
    const agg = naturalAgg(m0);
    add({ type: "area", x: date.name, y: [m0.name], agg, bucket: "auto", title: `${m0.label} over time` }, `How ${m0.label} changes over ${date.label}.`, 0.95);
    const split = dims.find((d) => distinct(d.name) >= 2 && distinct(d.name) <= 6);
    if (split) {
      add(
        { type: "line", x: date.name, y: [m0.name], agg, groupBy: split.name, bucket: "auto", title: `${m0.label} over time by ${split.label}` },
        `Compares the trajectory of each ${split.label}.`,
        0.85
      );
    }
    if (m1) add({ type: "line", x: date.name, y: [m1.name], agg: naturalAgg(m1), bucket: "auto", title: `${m1.label} over time` }, `Trend of your second key metric, ${m1.label}.`, 0.7);
  }

  for (const d of dims.slice(0, 3)) {
    if (!m0) break;
    const k = distinct(d.name);
    const agg = naturalAgg(m0);
    if (k <= 6 && agg === "sum") {
      add({ type: "doughnut", x: d.name, y: [m0.name], agg, title: `${m0.label} share by ${d.label}` }, `Each ${d.label}'s share of total ${m0.label}.`, 0.8 - recs.length * 0.01);
    } else {
      add(
        { type: avgLabelLength(d.name) > 10 || k > 12 ? "hbar" : "bar", x: d.name, y: [m0.name], agg, sort: "desc", limit: 10, title: `Top ${d.label} by ${m0.label}` },
        `Ranks ${d.label} values by ${m0.label} so leaders and laggards stand out.`,
        0.82 - recs.length * 0.01
      );
    }
  }

  const strong = [...correlations].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
  if (strong && Math.abs(strong.r) >= 0.4) {
    const la = ds.field(strong.a)?.label ?? strong.a;
    const lb = ds.field(strong.b)?.label ?? strong.b;
    add({ type: "scatter", x: strong.a, y: [strong.b], agg: "sum", title: `${lb} vs ${la}` }, `${la} and ${lb} are correlated (r = ${strong.r.toFixed(2)}); see the relationship row by row.`, 0.75);
  } else if (m0 && m1) {
    add({ type: "scatter", x: m0.name, y: [m1.name], agg: "sum", title: `${m1.label} vs ${m0.label}` }, `Checks whether ${m0.label} and ${m1.label} are related.`, 0.5);
  }

  if (m0) add({ type: "histogram", y: [m0.name], agg: "count", title: `Distribution of ${m0.label}` }, `Shows the typical range of ${m0.label} and any long tail.`, 0.6);

  const radarDim = dims.find((d) => distinct(d.name) >= 3 && distinct(d.name) <= 8);
  if (radarDim && measures.length >= 3) {
    add(
      { type: "radar", x: radarDim.name, y: measures.slice(0, 4).map((m) => m.name), agg: "avg", title: `${radarDim.label} profile across metrics` },
      `Profiles each ${radarDim.label} across ${Math.min(4, measures.length)} metrics at once.`,
      0.55
    );
  }

  const d1 = dims[0];
  const d2 = dims.find((d) => d !== d1 && distinct(d.name) <= 6);
  if (d1 && d2 && distinct(d1.name) <= 15) {
    add(
      { type: "bar", x: d1.name, y: m0 ? [m0.name] : [], agg: m0 ? naturalAgg(m0) : "count", groupBy: d2.name, stacked: true, sort: "desc", title: `${m0 ? m0.label : "Rows"} by ${d1.label} and ${d2.label}` },
      `Breaks each ${d1.label} down by ${d2.label}.`,
      0.6
    );
  }

  if (!m0 && dims[0]) {
    add({ type: "bar", x: dims[0].name, y: [], agg: "count", sort: "desc", limit: 15, title: `Rows by ${dims[0].label}` }, `How rows are distributed across ${dims[0].label}.`, 0.7);
  }

  const seen = new Set<string>();
  return recs
    .filter((r) => {
      const key = JSON.stringify([r.spec.type, r.spec.x, r.spec.y, r.spec.groupBy]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  trend: "Trend",
  change: "Change",
  anomaly: "Anomaly",
  outlier: "Outliers",
  correlation: "Correlation",
  concentration: "Concentration",
  segment: "Segment gap",
  distribution: "Distribution",
  quality: "Data quality",
};

