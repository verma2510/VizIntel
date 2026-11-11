import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ChartScatter, CircleAlert, GitCompareArrows, Layers, PieChart, ShieldAlert, SlidersHorizontal, Sigma, TrendingUp, Zap } from "lucide-react";
import type { Signal, SignalKind } from "../../lib/analysis";
import { SIGNAL_LABEL } from "../../lib/analysis";
import type { PreparedDataset } from "../../lib/data/prepare";
import type { DrillTarget } from "../../lib/chart/engine";
import { builderUrl } from "../../lib/spec";
import { ChartCard } from "../charts/ChartCard";
import { Button } from "../ui/Button";

const KIND_ICON: Record<SignalKind, React.ComponentType<{ size?: number; className?: string }>> = {
  trend: TrendingUp,
  change: Zap,
  anomaly: CircleAlert,
  outlier: ChartScatter,
  correlation: GitCompareArrows,
  concentration: PieChart,
  segment: Layers,
  distribution: Sigma,
  quality: ShieldAlert,
};

export const SignalCard: React.FC<{
  signal: Signal;
  ds: PreparedDataset;
  idx: Uint32Array;
  showChart?: boolean;
  onDrill?: (t: DrillTarget) => void;
  onViewRows?: (signal: Signal) => void;
}> = ({ signal, ds, idx, showChart = true, onDrill, onViewRows }) => {
  const Icon = KIND_ICON[signal.kind];
  const warning = signal.tone === "warning";
  return (
    <article className="print-break-avoid flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card-sm">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${warning ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2"}`}>
            <Icon size={12} />
            {SIGNAL_LABEL[signal.kind]}
          </span>
          {signal.metric && (
            <span className="inline-flex items-center gap-0.5 text-[15px] font-semibold tracking-tight text-ink">
              {signal.direction === "up" && <ArrowUpRight size={15} className="text-ink-3" />}
              {signal.direction === "down" && <ArrowDownRight size={15} className="text-ink-3" />}
              {signal.metric}
            </span>
          )}
        </div>
        <h3 className="mt-2.5 text-[14.5px] font-semibold leading-snug tracking-tight text-ink">{signal.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{signal.detail}</p>
        {(signal.spec || signal.rows) && (
          <div className="no-print mt-3 flex flex-wrap gap-1.5">
            {signal.rows && onViewRows && (
              <Button variant="secondary" size="xs" onClick={() => onViewRows(signal)} data-track="signal_view_rows" data-track-kind={signal.kind}>
                View {signal.rows.length} rows
              </Button>
            )}
            {signal.spec && (
              <Link
                to={builderUrl(ds.id, signal.spec)}
                data-track="signal_open_builder"
                data-track-kind={signal.kind}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink"
              >
                <SlidersHorizontal size={13} /> Customize chart
              </Link>
            )}
          </div>
        )}
      </div>
      {showChart && signal.spec && (
        <div className="border-t border-line">
          <ChartCard ds={ds} idx={idx} spec={signal.spec} height={170} compact onDrill={onDrill} className="rounded-none! border-0! shadow-none!" />
        </div>
      )}
    </article>
  );
};
