import { forwardRef, useMemo } from "react";
import { Chart } from "react-chartjs-2";
import type { ActiveElement, Chart as ChartJS, ChartEvent, ChartOptions } from "chart.js";
import { ChartColumn } from "lucide-react";
import { registerCharts } from "../../lib/chart/register";
import type { BuiltChart, DrillTarget } from "../../lib/chart/engine";
import { trackClick } from "../../lib/tracker";

registerCharts();

interface ChartViewProps {
  built: BuiltChart;
  onDrill?: (target: DrillTarget) => void;
  /** Used for interaction tracking. */
  trackName?: string;
  className?: string;
}

/** Renders a built chart; clicking a mark resolves the rows behind it (drill-down). */
export const ChartView = forwardRef<ChartJS | null, ChartViewProps>(({ built, onDrill, trackName, className = "" }, ref) => {
  const options = useMemo<ChartOptions>(() => {
    if (!built.drill) return built.options;
    return {
      ...built.options,
      onClick: (_e: ChartEvent, elements: ActiveElement[]) => {
        const el = elements[0];
        if (!el || !built.drill) return;
        const target = built.drill(el.datasetIndex, el.index);
        if (!target) return;
        trackClick("chart_point", { chart: trackName ?? null, label: target.title });
        onDrill?.(target);
      },
      onHover: (e: ChartEvent, elements: ActiveElement[]) => {
        const canvas = (e.native?.target as HTMLCanvasElement | undefined) ?? null;
        if (canvas) canvas.style.cursor = elements.length && onDrill ? "pointer" : "default";
      },
    } as ChartOptions;
  }, [built, onDrill, trackName]);

  if (built.empty) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-2 px-4 text-center ${className}`}>
        <ChartColumn size={20} className="text-ink-3" />
        <p className="max-w-xs text-[13px] text-ink-3">{built.emptyReason}</p>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${className}`}>
      <Chart key={built.kind} ref={ref as never} type={built.kind} data={built.data as never} options={options as never} aria-label="Chart" role="img" />
    </div>
  );
});
ChartView.displayName = "ChartView";
