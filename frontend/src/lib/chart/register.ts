/**
 * One-time Chart.js registration (tree-shaken: only what VizIntel renders) plus global defaults and the
 * small custom plugins: selective value labels, doughnut centre total, line crosshair, export background.
 */
import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  PolarAreaController,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Tooltip,
  type Plugin,
  type ChartType,
} from "chart.js";

export interface ValueLabelOptions {
  enabled: boolean;
  color: string;
  insideColors?: string[];
  format: (value: number) => string;
  horizontal?: boolean;
  mode: "bar" | "end" | "slice";
}
export interface CenterOptions {
  enabled: boolean;
  value: string;
  label: string;
  color: string;
  subColor: string;
}

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    vzLabels?: ValueLabelOptions;
    vzCenter?: CenterOptions;
    vzCrosshair?: { enabled: boolean; color: string };
    vzBackground?: { color: string };
  }
}

const FONT = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const backgroundPlugin: Plugin = {
  id: "vzBackground",
  beforeDraw(chart, _args, opts: { color?: string }) {
    if (!opts?.color) return;
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

const crosshairPlugin: Plugin = {
  id: "vzCrosshair",
  afterDatasetsDraw(chart, _args, opts: { enabled?: boolean; color?: string }) {
    if (!opts?.enabled) return;
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = opts.color ?? "#888";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

const centerPlugin: Plugin = {
  id: "vzCenter",
  afterDraw(chart, _args, opts: CenterOptions) {
    if (!opts?.enabled) return;
    const arc = chart.getDatasetMeta(0)?.data?.[0] as unknown as { x: number; y: number; innerRadius: number } | undefined;
    if (!arc || !arc.innerRadius) return;
    const { ctx } = chart;
    const size = Math.max(12, Math.min(26, arc.innerRadius * 0.36));
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color;
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.fillText(opts.value, arc.x, arc.y - (arc.innerRadius > 40 ? 7 : 0));
    if (arc.innerRadius > 40) {
      ctx.fillStyle = opts.subColor;
      ctx.font = `500 11px ${FONT}`;
      ctx.fillText(opts.label, arc.x, arc.y + size * 0.62);
    }
    ctx.restore();
  },
};

/** Selective direct labels: bar ends (<= 24 bars), line endpoints, slice shares (>= 7%). */
const labelsPlugin: Plugin = {
  id: "vzLabels",
  afterDatasetsDraw(chart, _args, opts: ValueLabelOptions) {
    if (!opts?.enabled) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = `500 11px ${FONT}`;
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden || !chart.isDatasetVisible(di)) return;
      const values = dataset.data as (number | null)[];
      if (opts.mode === "bar") {
        if (meta.data.length > 24) return;
        meta.data.forEach((el, i) => {
          const v = values[i];
          if (v === null || v === undefined || typeof v !== "number") return;
          const { x, y } = el as unknown as { x: number; y: number };
          ctx.fillStyle = opts.color;
          if (opts.horizontal) {
            ctx.textAlign = v < 0 ? "right" : "left";
            ctx.textBaseline = "middle";
            ctx.fillText(opts.format(v), x + (v < 0 ? -6 : 6), y);
          } else {
            ctx.textAlign = "center";
            ctx.textBaseline = v < 0 ? "top" : "bottom";
            ctx.fillText(opts.format(v), x, y + (v < 0 ? 4 : -4));
          }
        });
      } else if (opts.mode === "end") {
        for (let i = values.length - 1; i >= 0; i--) {
          const v = values[i];
          if (typeof v !== "number") continue;
          const { x, y } = meta.data[i] as unknown as { x: number; y: number };
          ctx.fillStyle = opts.color;
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(opts.format(v), x, y - 6);
          break;
        }
      } else if (opts.mode === "slice") {
        const total = values.reduce<number>((s, v) => s + (typeof v === "number" && v > 0 ? v : 0), 0);
        meta.data.forEach((el, i) => {
          const v = values[i];
          if (typeof v !== "number" || !total || v / total < 0.07) return;
          const arc = el as unknown as { startAngle: number; endAngle: number; innerRadius: number; outerRadius: number; tooltipPosition: (b: boolean) => { x: number; y: number } };
          const text = `${Math.round((v / total) * 100)}%`;
          const midRadius = (arc.innerRadius + arc.outerRadius) / 2;
          const thickness = arc.outerRadius - arc.innerRadius;
          const arcLength = (arc.endAngle - arc.startAngle) * midRadius;
          // Only label inside a slice when the text fits with padding (otherwise tooltip + legend carry it).
          if (thickness < 20 || arcLength < ctx.measureText(text).width + 12) return;
          const pos = arc.tooltipPosition(true);
          ctx.fillStyle = opts.insideColors?.[i] ?? "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, pos.x, pos.y);
        });
      }
    });
    ctx.restore();
  },
};

let registered = false;

export function registerCharts(): void {
  if (registered) return;
  registered = true;
  ChartJS.register(
    ArcElement,
    BarController,
    BarElement,
    BubbleController,
    CategoryScale,
    DoughnutController,
    Filler,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PieController,
    PointElement,
    PolarAreaController,
    RadarController,
    RadialLinearScale,
    ScatterController,
    Tooltip,
    backgroundPlugin,
    crosshairPlugin,
    centerPlugin,
    labelsPlugin
  );
  ChartJS.defaults.font.family = FONT;
  ChartJS.defaults.font.size = 11.5;
  // Mutate, never replace: Chart.js derives the copyable animation keys (type, fn, from, …) from
  // Object.keys(defaults.animation); replacing the object drops `type` and breaks colour interpolation.
  if (ChartJS.defaults.animation) {
    Object.assign(ChartJS.defaults.animation, {
      duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
      easing: "easeOutQuart",
    });
  }
}
