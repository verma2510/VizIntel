import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { AGG_LABEL, formatDelta, formatMeasure } from "../../lib/format";
import type { KpiSummary } from "../../lib/analysis";
import { usePrefs } from "../../lib/prefs";

/** Tiny SVG sparkline (no axes); the last point is marked. */
export const Sparkline: React.FC<{ values: number[]; className?: string; color?: string; height?: number }> = ({ values, className = "", color = "var(--vz-brand)", height = 36 }) => {
  if (values.length < 2) return null;
  const w = 120;
  const h = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const gid = `spark-${Math.round(values.reduce((a, b) => a + b, 0) * 1000) % 100000}-${values.length}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`overflow-visible ${className}`} style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
};

export const DeltaBadge: React.FC<{ delta: number | null | undefined; label?: string }> = ({ delta, label }) => {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < 0.005;
  const up = delta > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  // Direction only (not good/bad): whether "up" is good depends on the metric (revenue vs cost).
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={label}>
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-medium ${flat ? "bg-surface-3 text-ink-2" : "bg-surface-3 text-ink"}`}>
        <Icon size={12} />
        {formatDelta(delta)}
      </span>
      {label && <span className="truncate text-ink-3">{label}</span>}
    </span>
  );
};

export const KpiCard: React.FC<{ kpi: KpiSummary; className?: string; onClick?: () => void }> = ({ kpi, className = "", onClick }) => {
  usePrefs(); // re-render when currency/number preferences change
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface p-4 text-left shadow-card-sm ${onClick ? "transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card" : ""} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-ink-2" title={kpi.label}>
          {kpi.label}
        </p>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-3">{AGG_LABEL[kpi.agg]}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="truncate text-[26px] font-semibold leading-none tracking-tight text-ink" title={formatMeasure(kpi.value, kpi.semanticType, { compact: false, percentIsFraction: kpi.percentIsFraction })}>
          {formatMeasure(kpi.value, kpi.semanticType, { percentIsFraction: kpi.percentIsFraction })}
        </p>
        {kpi.spark && kpi.spark.length > 2 && <Sparkline values={kpi.spark} className="w-24 shrink-0" height={30} />}
      </div>
      <div className="mt-3 min-h-5">
        {kpi.delta !== undefined && kpi.delta !== null ? <DeltaBadge delta={kpi.delta} label={kpi.deltaLabel} /> : <span className="text-xs text-ink-3">No time column for trend</span>}
      </div>
    </Wrapper>
  );
};
