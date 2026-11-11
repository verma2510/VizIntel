import type { PaletteName } from "../../types";

/**
 * Categorical palettes. Every ordering below was validated with the data-viz palette validator
 * (lightness band, chroma floor, adjacent-pair CVD separation >= 8, normal-vision floor >= 15)
 * against the app's own card surfaces: light #ffffff, dark #14161c. Do not reorder without re-validating:
 * slot ORDER is the colour-blind-safety mechanism.
 *
 * Light-mode aqua/yellow/magenta sit below 3:1 contrast on white, so every chart ships a tooltip and a
 * table view (the "relief rule").
 */
const HUES = {
  light: { blue: "#3d5afe", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#8b5cf6", red: "#e34948" },
  dark: { blue: "#5b76ff", orange: "#d95926", aqua: "#199e70", yellow: "#c98500", magenta: "#d55181", green: "#008300", violet: "#9085e9", red: "#e66767" },
} as const;

type Hue = keyof (typeof HUES)["light"];
const ORDERS: Record<Exclude<PaletteName, "mono">, Hue[]> = {
  signal: ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"],
  cool: ["aqua", "violet", "orange", "blue", "yellow", "magenta", "green", "red"],
  warm: ["orange", "violet", "aqua", "blue", "yellow", "magenta", "green", "red"],
};

/** Single-hue brand ramp, for an explicit "mono" choice (ordered/emphasis use). */
const MONO = {
  light: ["#3d5afe", "#2a44e0", "#7088ff", "#1f33b0", "#9aabff", "#162585", "#c2ccff", "#0e1a5e"],
  dark: ["#5b76ff", "#8a9dff", "#3d5afe", "#b3c0ff", "#2a44e0", "#d6ddff", "#1f33b0", "#eef1ff"],
};

export type ThemeName = "light" | "dark";

export function paletteColors(palette: PaletteName = "signal", theme: ThemeName): string[] {
  if (palette === "mono") return MONO[theme];
  const order = ORDERS[palette] ?? ORDERS.signal;
  return order.map((h) => HUES[theme][h]);
}

export const PALETTE_OPTIONS: { value: PaletteName; label: string }[] = [
  { value: "signal", label: "Signal" },
  { value: "cool", label: "Cool" },
  { value: "warm", label: "Warm" },
  { value: "mono", label: "Mono" },
];

/** Which palette slots need dark text when a label sits inside the fill (yellow). */
export const needsDarkLabel = (color: string) => ["#eda100", "#c98500"].includes(color.toLowerCase());

export interface ChartChrome {
  surface: string;
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  ink3: string;
  other: string;
  tooltipBg: string;
  tooltipInk: string;
  tooltipInk2: string;
  tooltipBorder: string;
  /** Diverging scale (correlations): negative pole, neutral midpoint, positive pole. */
  divNeg: string;
  divMid: string;
  divPos: string;
}

export const CHROME: Record<ThemeName, ChartChrome> = {
  light: {
    surface: "#ffffff",
    grid: "#eceef2",
    axis: "#cfd4dd",
    ink: "#0d1017",
    ink2: "#4a5161",
    ink3: "#7d8494",
    other: "#aab0bc",
    tooltipBg: "#0d1017",
    tooltipInk: "#f0f1f4",
    tooltipInk2: "#c9cdd6",
    tooltipBorder: "#0d1017",
    divNeg: "#e34948",
    divMid: "#f0f1f4",
    divPos: "#3d5afe",
  },
  dark: {
    surface: "#14161c",
    grid: "#22252e",
    axis: "#3a3f4c",
    ink: "#f0f1f4",
    ink2: "#b1b6c3",
    ink3: "#7a8191",
    other: "#596071",
    tooltipBg: "#262a34",
    tooltipInk: "#f0f1f4",
    tooltipInk2: "#c3c7d1",
    tooltipBorder: "#343947",
    divNeg: "#e66767",
    divMid: "#262a33",
    divPos: "#5b76ff",
  },
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const alpha = (hex: string, a: number) => {
  if (!hex.startsWith("#")) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Diverging colour for a value in [-1, 1] (gray midpoint). */
export function divergingColor(value: number, theme: ThemeName): string {
  const c = CHROME[theme];
  const v = Math.max(-1, Math.min(1, value));
  return v >= 0 ? mix(c.divMid, c.divPos, v) : mix(c.divMid, c.divNeg, -v);
}
