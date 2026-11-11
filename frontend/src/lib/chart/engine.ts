/**
 * Chart engine: ChartSpec + PreparedDataset rows -> Chart.js config, an accessible table view, and a
 * drill-down resolver (chart element -> row filters). Pure and theme-aware; no React.
 */
import type { ChartData, ChartOptions, ScriptableContext, TooltipItem } from "chart.js";
import type { ChartSpec, ChartType, Filter, LegendPosition } from "../../types";
import { AGG_LABEL, formatDelta, formatInteger, formatMeasure, formatShare } from "../format";
import { aggregate, assignSlots, histogram, OTHER_KEY, scatterPoints, type AggResult } from "../data/aggregate";
import { newId } from "../data/filters";
import type { PreparedDataset } from "../data/prepare";
import { alpha, CHROME, needsDarkLabel, paletteColors, type ThemeName } from "./theme";

export type ChartKind = "bar" | "line" | "pie" | "doughnut" | "polarArea" | "radar" | "scatter" | "bubble";

export interface DrillTarget {
  title: string;
  filters: Filter[];
}

export interface TableView {
  headers: string[];
  rows: string[][];
}

export interface BuiltChart {
  kind: ChartKind;
  data: ChartData;
  options: ChartOptions;
  empty: boolean;
  emptyReason?: string;
  notes: string[];
  table: TableView;
  drill?: (datasetIndex: number, index: number) => DrillTarget | null;
  /** Headline facts computed from the plotted data (used for AI answers and summaries). */
  facts: string[];
}

export interface BuildInput {
  ds: PreparedDataset;
  idx: Uint32Array;
  spec: ChartSpec;
  theme: ThemeName;
  /** Small tiles: fewer ticks, no axis titles, legend at the bottom. */
  compact?: boolean;
}

export const CHART_TYPES: { value: ChartType; label: string; hint: string }[] = [
  { value: "bar", label: "Column", hint: "Compare categories" },
  { value: "hbar", label: "Bar", hint: "Rank long labels" },
  { value: "line", label: "Line", hint: "Change over time" },
  { value: "area", label: "Area", hint: "Volume over time" },
  { value: "doughnut", label: "Doughnut", hint: "Share of a whole" },
  { value: "pie", label: "Pie", hint: "Share of a whole" },
  { value: "polarArea", label: "Polar", hint: "Cyclical magnitude" },
  { value: "radar", label: "Radar", hint: "Profile across metrics" },
  { value: "scatter", label: "Scatter", hint: "Relationship of two metrics" },
  { value: "bubble", label: "Bubble", hint: "Three metrics at once" },
  { value: "histogram", label: "Histogram", hint: "Distribution of a metric" },
];

/** What each chart type needs, for builder validation and empty states. */
export function requirements(type: ChartType): { x: "category" | "measure" | "none"; minY: number; maxY: number; group: boolean; size: boolean } {
  switch (type) {
    case "histogram":
      return { x: "none", minY: 1, maxY: 1, group: false, size: false };
    case "scatter":
      return { x: "measure", minY: 1, maxY: 1, group: true, size: false };
    case "bubble":
      return { x: "measure", minY: 1, maxY: 1, group: true, size: true };
    case "pie":
    case "doughnut":
    case "polarArea":
      return { x: "category", minY: 0, maxY: 1, group: false, size: false };
    case "radar":
      return { x: "category", minY: 0, maxY: 6, group: true, size: false };
    default:
      return { x: "category", minY: 0, maxY: 6, group: true, size: false };
  }
}

export function autoTitle(spec: ChartSpec, ds: PreparedDataset | null): string {
  const label = (name?: string) => (name ? ds?.field(name)?.label ?? name : "");
  const metrics = spec.y.map(label).join(" & ");
  if (spec.type === "histogram") return `Distribution of ${label(spec.y[0] ?? spec.x)}`;
  if (spec.type === "scatter" || spec.type === "bubble") return `${metrics} vs ${label(spec.x)}`;
  const what = spec.agg === "count" && !spec.y.length ? "Rows" : `${AGG_LABEL[spec.agg]} ${metrics}`.trim();
  const by = spec.x ? (ds?.field(spec.x)?.role === "date" ? ` over ${label(spec.x)}` : ` by ${label(spec.x)}`) : "";
  const split = spec.groupBy ? `, split by ${label(spec.groupBy)}` : "";
  return `${what}${by}${split}`;
}

/** Formatter for aggregated values of a metric (count/distinct are plain integers). */
export function metricFormatter(ds: PreparedDataset, metric: string | undefined, agg: ChartSpec["agg"], compact = true) {
  if (!metric || agg === "count" || agg === "distinct") return (v: number) => formatInteger(v);
  const sem = ds.semantic(metric);
  const percentIsFraction = sem === "percentage" ? ds.percentIsFraction(metric) : false;
  return (v: number) => formatMeasure(v, sem, { compact, percentIsFraction });
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const empty = (reason: string): BuiltChart => ({
  kind: "bar",
  data: { labels: [], datasets: [] },
  options: {},
  empty: true,
  emptyReason: reason,
  notes: [],
  table: { headers: [], rows: [] },
  facts: [],
});

function legendConfig(position: LegendPosition | undefined, seriesCount: number, compact: boolean, chrome = CHROME.light) {
  const display = position ? position !== "none" : seriesCount >= 2;
  return {
    display,
    position: (position && position !== "none" ? position : compact ? "bottom" : "top") as "top" | "bottom" | "right",
    align: "start" as const,
    labels: {
      usePointStyle: true,
      pointStyle: "rectRounded" as const,
      boxWidth: 8,
      boxHeight: 8,
      padding: compact ? 10 : 14,
      color: chrome.ink2,
      font: { size: 11.5, weight: 500 as const },
    },
  };
}

function tooltipConfig(chrome: (typeof CHROME)["light"]) {
  return {
    backgroundColor: chrome.tooltipBg,
    titleColor: chrome.tooltipInk,
    bodyColor: chrome.tooltipInk2,
    borderColor: chrome.tooltipBorder,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { weight: 600 as const, size: 12 },
    bodyFont: { size: 12 },
    caretSize: 5,
  };
}

/** Builds the Chart.js configuration for a spec. Never throws on bad specs: returns an empty state. */
export function buildChart({ ds, idx, spec, theme, compact = false }: BuildInput): BuiltChart {
  const chrome = CHROME[theme];
  const palette = paletteColors(spec.style?.palette, theme);
  const overrides = spec.style?.colors ?? {};
  const colorFor = (slot: number, key: string) => overrides[key] ?? (slot < 0 ? chrome.other : palette[slot % palette.length]);
  const req = requirements(spec.type);
  const metrics = spec.y.filter((m) => ds.has(m));
  const xField = ds.field(spec.x);

  if (!ds.n) return empty("This dataset has no rows.");
  if (req.x === "category" && !xField) return empty("Choose a field for the X axis.");
  if (req.x === "measure" && (!xField || xField.role !== "measure")) return empty("Scatter and bubble charts need a numeric field on the X axis.");
  if (metrics.length < req.minY) return empty(spec.type === "histogram" ? "Choose a numeric field to see its distribution." : "Choose a metric for the Y axis.");
  if (req.size && !ds.has(spec.size)) return empty("Bubble charts need a numeric field for bubble size.");
  if (!idx.length) return empty("No rows match the current filters.");

  const legendPos = spec.style?.legend;
  const showGrid = spec.style?.grid !== false;
  const notes: string[] = [];
  const facts: string[] = [];
  const surfaceGap = { borderColor: chrome.surface };
  const fmtY = metricFormatter(ds, metrics[0], metrics.length ? spec.agg : "count");
  const fmtYFull = metricFormatter(ds, metrics[0], metrics.length ? spec.agg : "count", false);
  const labelOf = (name?: string) => (name ? ds.field(name)?.label ?? name : "");

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: compact ? { top: 4, right: 6, bottom: 0, left: 0 } : { top: 8, right: 12, bottom: 0, left: 4 } },
    plugins: {
      vzBackground: { color: chrome.surface },
      tooltip: tooltipConfig(chrome),
    },
  };

  const axisTitle = (text: string | undefined) => ({ display: Boolean(text) && !compact, text: text ?? "", color: chrome.ink3, font: { size: 11, weight: 500 as const } });

  // -- Histogram ---------------------------------------------------------------------------------
  if (spec.type === "histogram") {
    const metric = metrics[0];
    const h = histogram(ds, idx, metric, spec.bins);
    if (!h.total) return empty(`No numeric values in ${labelOf(metric)}.`);
    const color = colorFor(0, metric);
    const fmtEdge = metricFormatter(ds, metric, "sum");
    const labels = h.counts.map((_, b) => `${fmtEdge(h.edges[b])}–${fmtEdge(h.edges[b + 1])}`);
    const peak = h.counts.indexOf(Math.max(...h.counts));
    facts.push(`Most values of ${labelOf(metric)} fall in ${labels[peak]} (${formatShare(h.counts[peak] / h.total)} of rows).`);
    return {
      kind: "bar",
      data: { labels, datasets: [{ label: "Rows", data: h.counts, backgroundColor: color, hoverBackgroundColor: alpha(color, 0.85), borderRadius: 3, borderWidth: 1, ...surfaceGap, borderSkipped: "start", categoryPercentage: 1, barPercentage: 1 }] },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          legend: { display: false },
          tooltip: { ...tooltipConfig(chrome), callbacks: { label: (item: TooltipItem<"bar">) => `${formatInteger(item.parsed.y ?? 0)} rows (${formatShare((item.parsed.y ?? 0) / h.total)})` } },
          vzLabels: { enabled: Boolean(spec.style?.dataLabels), color: chrome.ink2, format: (v: number) => formatInteger(v), mode: "bar" },
        },
        scales: {
          x: { grid: { display: false }, border: { color: chrome.axis }, ticks: { color: chrome.ink3, maxRotation: 0, autoSkipPadding: 16 }, title: axisTitle(spec.style?.xLabel ?? labelOf(metric)) },
          y: { beginAtZero: true, grid: { display: showGrid, color: chrome.grid }, border: { display: false }, ticks: { color: chrome.ink3, padding: 8, maxTicksLimit: compact ? 4 : 6, precision: 0 }, title: axisTitle(spec.style?.yLabel ?? "Rows") },
        },
      } as ChartOptions,
      empty: false,
      notes,
      facts,
      table: { headers: [labelOf(metric), "Rows"], rows: labels.map((l, i) => [l, formatInteger(h.counts[i])]) },
      drill: (_d, i) => ({
        title: `${labelOf(metric)} ${labels[i]}`,
        filters: [{ id: newId(), column: metric, op: "between", value: [h.edges[i], h.edges[i + 1]] }],
      }),
    };
  }

  // -- Scatter / bubble -----------------------------------------------------------------------------
  if (spec.type === "scatter" || spec.type === "bubble") {
    const yMetric = metrics[0];
    const result = scatterPoints(ds, idx, { x: spec.x!, y: yMetric, groupBy: spec.groupBy, size: spec.type === "bubble" ? spec.size : undefined });
    if (!result.total) return empty("No rows have numeric values on both axes.");
    if (result.sampled) notes.push(`Showing an even sample of ${formatInteger(4000)} of ${formatInteger(idx.length)} rows.`);
    const fmtX = metricFormatter(ds, spec.x, "sum");
    const fmtV = metricFormatter(ds, yMetric, "sum");
    const fmtS = spec.size ? metricFormatter(ds, spec.size, "sum") : null;
    const sizeValues = spec.size ? ds.num(spec.size) : null;
    const datasets = result.groups.map((g) => {
      const color = colorFor(g.slot, g.key);
      return {
        label: g.name,
        data: g.points.map((p) => ({ x: p.x, y: p.y, r: p.r ?? 4 })),
        backgroundColor: alpha(color, spec.type === "bubble" ? 0.55 : 0.75),
        borderColor: chrome.surface,
        borderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        hoverBorderColor: chrome.surface,
        rowIndex: g.points.map((p) => p.i),
      };
    });
    return {
      kind: spec.type,
      data: { datasets } as ChartData,
      options: {
        ...baseOptions,
        interaction: { mode: "nearest", intersect: false, axis: "xy" },
        plugins: {
          ...baseOptions.plugins,
          legend: legendConfig(legendPos, datasets.length, compact, chrome),
          tooltip: {
            ...tooltipConfig(chrome),
            callbacks: {
              title: (items: TooltipItem<"scatter">[]) => (spec.groupBy ? String(items[0]?.dataset.label ?? "") : ""),
              label: (item: TooltipItem<"scatter">) => {
                const raw = item.raw as { x: number; y: number };
                const rowIdx = (item.dataset as unknown as { rowIndex: number[] }).rowIndex?.[item.dataIndex];
                const parts = [`${labelOf(spec.x)}: ${fmtX(raw.x)}`, `${labelOf(yMetric)}: ${fmtV(raw.y)}`];
                if (fmtS && sizeValues && rowIdx !== undefined) parts.push(`${labelOf(spec.size)}: ${fmtS(sizeValues[rowIdx])}`);
                return parts;
              },
            },
          },
        },
        scales: {
          x: { type: "linear", grid: { display: showGrid, color: chrome.grid }, border: { color: chrome.axis }, ticks: { color: chrome.ink3, maxTicksLimit: compact ? 5 : 8, callback: (v: string | number) => fmtX(Number(v)) }, title: axisTitle(spec.style?.xLabel ?? labelOf(spec.x)) },
          y: { type: "linear", grid: { display: showGrid, color: chrome.grid }, border: { display: false }, ticks: { color: chrome.ink3, padding: 8, maxTicksLimit: compact ? 5 : 7, callback: (v: string | number) => fmtV(Number(v)) }, title: axisTitle(spec.style?.yLabel ?? labelOf(yMetric)) },
        },
      } as ChartOptions,
      empty: false,
      notes,
      facts,
      table: {
        headers: [...(spec.groupBy ? [labelOf(spec.groupBy)] : []), labelOf(spec.x), labelOf(yMetric), ...(spec.size ? [labelOf(spec.size)] : [])],
        rows: result.groups.flatMap((g) =>
          g.points.slice(0, 200).map((p) => [...(spec.groupBy ? [g.name] : []), fmtX(p.x), fmtV(p.y), ...(fmtS && sizeValues ? [fmtS(sizeValues[p.i])] : [])])
        ),
      },
    };
  }

  // -- Aggregated charts --------------------------------------------------------------------------
  const isPart = spec.type === "pie" || spec.type === "doughnut" || spec.type === "polarArea";
  const xIsDate = xField?.role === "date";
  const defaultLimit = xIsDate ? undefined : isPart ? 6 : spec.type === "radar" ? 8 : 30;
  const distinct = xIsDate ? 0 : ds.distinctCount(spec.x!);
  const limit = spec.limit ?? (defaultLimit && distinct > defaultLimit ? defaultLimit : undefined);
  const res: AggResult = aggregate(ds, idx, {
    x: spec.x!,
    y: isPart ? metrics.slice(0, 1) : metrics,
    agg: metrics.length ? spec.agg : "count",
    groupBy: isPart ? undefined : spec.groupBy,
    bucket: spec.bucket,
    sort: spec.sort ?? (xIsDate ? "none" : isPart ? "desc" : "none"),
    limit,
  });
  if (!res.keys.length) return empty(`No values found for ${labelOf(spec.x)}.`);
  if (res.keptKeys) notes.push(`Showing the top ${res.keptKeys.length} of ${formatInteger(distinct)} ${labelOf(spec.x)} values; the rest are grouped as “Other”.`);
  if (res.keptGroups) notes.push(`Showing the ${res.keptGroups.length} largest ${labelOf(spec.groupBy)} groups; the rest are grouped as “Other”.`);
  if (res.xKind === "date" && res.bucket) notes.push(`Grouped by ${res.bucket}.`);

  const seriesTotals = res.series.map((s) => s.values.reduce<number>((a, v) => a + (v ?? 0), 0));
  const xName = labelOf(spec.x);

  // Facts (deterministic, from plotted values)
  const first = res.series[0];
  if (first) {
    const vals = first.values.map((v) => v ?? NaN);
    if (res.xKind === "date" && vals.length >= 2) {
      const finite = vals.filter(Number.isFinite);
      const a = finite[0];
      const b = finite[finite.length - 1];
      if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) facts.push(`${first.name} moved ${formatDelta((b - a) / Math.abs(a))} from ${res.labels[0]} to ${res.labels[res.labels.length - 1]}.`);
      const peakIdx = vals.indexOf(Math.max(...finite));
      if (peakIdx >= 0) facts.push(`Peak: ${res.labels[peakIdx]} at ${fmtYFull(vals[peakIdx])}.`);
    } else if (vals.length >= 2) {
      const ranked = vals.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v)).sort((p, q) => q[0] - p[0]);
      const [topV, topI] = ranked[0] ?? [NaN, -1];
      if (topI >= 0) {
        const share = spec.agg === "sum" || spec.agg === "count" ? seriesTotals[0] && topV / seriesTotals[0] : null;
        facts.push(`${res.labels[topI]} leads with ${fmtYFull(topV)}${share ? ` (${formatShare(share)} of the total)` : ""}.`);
        const [lowV, lowI] = ranked[ranked.length - 1];
        if (lowI !== topI) facts.push(`${res.labels[lowI]} is lowest at ${fmtYFull(lowV)}.`);
      }
    }
  }

  const drill = (datasetIndex: number, index: number): DrillTarget | null => {
    const filters: Filter[] = [];
    const key = res.keys[index];
    if (key === undefined) return null;
    let title = res.labels[index];
    if (res.xKind === "date" && res.bounds) {
      filters.push({ id: newId(), column: spec.x!, op: "dateBetween", value: [res.bounds[index][0], res.bounds[index][1]] });
    } else if (key === OTHER_KEY) {
      filters.push({ id: newId(), column: spec.x!, op: "nin", value: res.keptKeys ?? [] });
      title = `${xName}: Other`;
    } else {
      filters.push({ id: newId(), column: spec.x!, op: "in", value: [key] });
    }
    const s = res.series[datasetIndex];
    if (spec.groupBy && !isPart && s) {
      if (s.key === OTHER_KEY) filters.push({ id: newId(), column: spec.groupBy, op: "nin", value: res.keptGroups ?? [] });
      else filters.push({ id: newId(), column: spec.groupBy, op: "in", value: [s.key] });
      title = `${title} · ${s.name}`;
    }
    return { title, filters };
  };

  const table: TableView = {
    headers: [xName, ...res.series.map((s) => s.name)],
    rows: res.labels.map((l, i) => [l, ...res.series.map((s) => (s.values[i] === null ? "—" : fmtYFull(s.values[i]!)))]),
  };

  // -- Part-to-whole --------------------------------------------------------------------------------
  if (isPart) {
    const s = res.series[0];
    const positive = s.values.map((v) => (v !== null && v > 0 ? v : 0));
    if (s.values.some((v) => v !== null && v < 0)) notes.push("Negative values can't be shown as slices and were left out.");
    const total = positive.reduce((a, b) => a + b, 0);
    if (!total) return empty("Nothing to show: all values are zero or negative.");
    const slots = assignSlots(res.keys, ds.entityOrder(spec.x!));
    const colors = res.keys.map((k) => colorFor(slots.get(k) ?? -1, k));
    const fill = spec.type === "polarArea" ? colors.map((c) => alpha(c, 0.78)) : colors;
    return {
      kind: spec.type as ChartKind,
      data: {
        labels: res.labels,
        datasets: [{ label: s.name, data: positive, backgroundColor: fill, hoverBackgroundColor: colors, borderColor: chrome.surface, borderWidth: 2, hoverOffset: 6, borderRadius: spec.type === "doughnut" ? 4 : 0 }],
      } as ChartData,
      options: {
        ...baseOptions,
        ...(spec.type === "doughnut" ? { cutout: "64%" } : {}),
        plugins: {
          ...baseOptions.plugins,
          legend: { ...legendConfig(legendPos ?? (compact ? "bottom" : "right"), res.keys.length, compact, chrome), display: legendPos !== "none" },
          tooltip: {
            ...tooltipConfig(chrome),
            callbacks: { label: (item: TooltipItem<"doughnut">) => ` ${item.label}: ${fmtYFull(Number(item.raw))} (${formatShare(Number(item.raw) / total)})` },
          },
          vzCenter: { enabled: spec.type === "doughnut", value: fmtY(total), label: metrics.length ? AGG_LABEL[spec.agg] : "Rows", color: chrome.ink, subColor: chrome.ink3 },
          vzLabels: { enabled: spec.style?.dataLabels ?? spec.type !== "polarArea", color: "#ffffff", insideColors: colors.map((c) => (needsDarkLabel(c) ? "#0d1017" : "#ffffff")), format: fmtY, mode: "slice" },
        },
        ...(spec.type === "polarArea"
          ? { scales: { r: { grid: { color: chrome.grid }, angleLines: { color: chrome.grid }, ticks: { display: false, backdropColor: "transparent" }, pointLabels: { display: false } } } }
          : {}),
      } as ChartOptions,
      empty: false,
      notes,
      facts,
      table: { headers: [xName, s.name, "Share"], rows: res.labels.map((l, i) => [l, fmtYFull(positive[i]), formatShare(positive[i] / total)]) },
      drill: (_d, i) => drill(0, i),
    };
  }

  // -- Radar ------------------------------------------------------------------------------------------
  if (spec.type === "radar") {
    const raw = res.series.map((s) => s.values);
    const maxes = raw.map((vals) => Math.max(...vals.map((v) => Math.abs(v ?? 0))));
    const normalize = res.series.length > 1 && !spec.groupBy && Math.max(...maxes) / Math.max(1e-9, Math.min(...maxes)) > 3;
    if (normalize) notes.push("Metrics have different scales, so each is indexed to its own maximum (= 100). Tooltips show actual values.");
    const datasets = res.series.map((s, si) => {
      const color = colorFor(s.slot, s.key);
      return {
        label: s.name,
        data: normalize ? s.values.map((v) => (v === null ? null : maxes[si] ? (v / maxes[si]) * 100 : 0)) : s.values,
        borderColor: color,
        backgroundColor: alpha(color, 0.14),
        pointBackgroundColor: color,
        pointBorderColor: chrome.surface,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      };
    });
    return {
      kind: "radar",
      data: { labels: res.labels.map((l) => truncate(l, 18)), datasets } as ChartData,
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          legend: legendConfig(legendPos, datasets.length, compact, chrome),
          tooltip: {
            ...tooltipConfig(chrome),
            callbacks: {
              title: (items: TooltipItem<"radar">[]) => res.labels[items[0]?.dataIndex ?? 0],
              label: (item: TooltipItem<"radar">) => {
                const value = raw[item.datasetIndex][item.dataIndex];
                const fmt = metricFormatter(ds, res.series[item.datasetIndex].metric, metrics.length ? spec.agg : "count", false);
                return ` ${item.dataset.label}: ${value === null ? "—" : fmt(value)}`;
              },
            },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            grid: { color: chrome.grid },
            angleLines: { color: chrome.grid },
            ticks: { display: false, backdropColor: "transparent" },
            pointLabels: { color: chrome.ink2, font: { size: compact ? 10 : 11.5, weight: 500 } },
          },
        },
      } as ChartOptions,
      empty: false,
      notes,
      facts,
      table,
      drill,
    };
  }

  // -- Cartesian: bar / hbar / line / area -------------------------------------------------------
  const horizontal = spec.type === "hbar";
  const isLine = spec.type === "line" || spec.type === "area";
  const stacked = Boolean(spec.stacked) && res.series.length > 1;
  const smooth = spec.style?.smooth ?? true;
  const singlePoint = res.keys.length === 1;

  const datasets = res.series.map((s, si) => {
    const color = colorFor(s.slot, s.key);
    if (isLine) {
      const area = spec.type === "area";
      return {
        label: s.name,
        data: s.values,
        borderColor: color,
        backgroundColor: area
          ? stacked
            ? alpha(color, 0.72)
            : (ctx: ScriptableContext<"line">) => {
                const { chartArea, ctx: c } = ctx.chart;
                if (!chartArea) return alpha(color, 0.15);
                const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                g.addColorStop(0, alpha(color, 0.3));
                g.addColorStop(1, alpha(color, 0.02));
                return g;
              }
          : color,
        fill: area ? (stacked ? (si === 0 ? "origin" : "-1") : "origin") : false,
        tension: smooth ? 0.32 : 0,
        borderWidth: 2,
        pointRadius: singlePoint ? 4 : 0,
        pointHoverRadius: 4.5,
        pointBackgroundColor: color,
        pointBorderColor: chrome.surface,
        pointHoverBorderWidth: 2,
        spanGaps: true,
      };
    }
    return {
      label: s.name,
      data: s.values,
      backgroundColor: color,
      hoverBackgroundColor: alpha(color, 0.82),
      borderRadius: stacked ? 2 : 4,
      borderSkipped: stacked ? false : ("start" as const),
      ...(stacked ? { borderWidth: 1, borderColor: chrome.surface } : {}),
      maxBarThickness: 44,
      categoryPercentage: res.series.length > 1 && !stacked ? 0.8 : 0.72,
      barPercentage: res.series.length > 1 && !stacked ? 0.92 : 1,
    };
  });

  const valueAxis = {
    beginAtZero: true,
    stacked,
    grid: { display: showGrid, color: chrome.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: chrome.ink3, padding: 8, maxTicksLimit: compact ? 4 : 6, callback: (v: string | number) => fmtY(Number(v)) },
    title: axisTitle(spec.style?.yLabel ?? (metrics.length === 1 ? labelOf(metrics[0]) : undefined)),
  };
  const categoryAxis = {
    stacked,
    grid: { display: false },
    border: { color: chrome.axis },
    ticks: {
      color: chrome.ink3,
      maxRotation: 0,
      autoSkip: true,
      autoSkipPadding: 14,
      callback(this: { getLabelForValue: (v: number) => string }, v: string | number) {
        return truncate(String(this.getLabelForValue(Number(v))), horizontal ? 22 : 14);
      },
    },
    title: axisTitle(spec.style?.xLabel ?? xName),
  };

  const options = {
    ...baseOptions,
    indexAxis: horizontal ? ("y" as const) : ("x" as const),
    interaction: isLine ? { mode: "index" as const, intersect: false } : { mode: "nearest" as const, intersect: true, axis: horizontal ? ("y" as const) : ("x" as const) },
    plugins: {
      ...baseOptions.plugins,
      legend: legendConfig(legendPos, datasets.length, compact, chrome),
      tooltip: {
        ...tooltipConfig(chrome),
        callbacks: {
          label: (item: TooltipItem<"bar" | "line">) => {
            const v = horizontal ? item.parsed.x : item.parsed.y;
            const fmt = metricFormatter(ds, res.series[item.datasetIndex]?.metric, metrics.length ? spec.agg : "count", false);
            return ` ${item.dataset.label}: ${v === null || v === undefined ? "—" : fmt(v)}`;
          },
        },
      },
      vzCrosshair: { enabled: isLine && res.keys.length > 1, color: chrome.axis },
      vzLabels: {
        enabled: Boolean(spec.style?.dataLabels) && !stacked,
        color: chrome.ink2,
        format: fmtY,
        horizontal,
        mode: isLine ? ("end" as const) : ("bar" as const),
      },
    },
    scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
  };

  return {
    kind: isLine ? "line" : "bar",
    data: { labels: res.labels, datasets } as ChartData,
    options: options as unknown as ChartOptions,
    empty: false,
    notes,
    facts,
    table,
    drill,
  };
}

/** Converts the upload-time chart definitions (dataAnalyzer.js) into aggregated specs. */
export function specFromLegacy(def: { type: string; xAxis: string; yAxis: string; title: string }, ds: PreparedDataset): ChartSpec | null {
  if (!ds.has(def.xAxis) || !ds.has(def.yAxis)) return null;
  const xRole = ds.field(def.xAxis)?.role;
  if (xRole === "measure") return { type: "scatter", x: def.xAxis, y: [def.yAxis], agg: "sum", title: def.title };
  if (def.type === "LineChart" || xRole === "date") return { type: "area", x: def.xAxis, y: [def.yAxis], agg: "sum", bucket: "auto", title: def.title };
  return { type: ds.distinctCount(def.xAxis) > 8 ? "hbar" : "bar", x: def.xAxis, y: [def.yAxis], agg: "sum", sort: "desc", limit: 12, title: def.title };
}

