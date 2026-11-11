import type { ChartSpec, Widget } from "../types";
import { newId } from "./data/filters";

/** Deep links into the chart builder carry the spec in the query string. */
export function builderUrl(datasetId: string | null | undefined, spec?: ChartSpec, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (datasetId) params.set("dataset", datasetId);
  if (spec) params.set("spec", JSON.stringify(spec));
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return `/app/builder${qs ? `?${qs}` : ""}`;
}

export function parseSpec(raw: string | null): ChartSpec | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return { ...parsed, y: Array.isArray(parsed.y) ? parsed.y : parsed.y ? [parsed.y] : [], agg: parsed.agg ?? "sum" } as ChartSpec;
    }
  } catch {
    // ignore malformed links
  }
  return null;
}

/** Default grid footprint per chart form. */
export function defaultSize(spec: ChartSpec): { w: number; h: number } {
  if (spec.type === "pie" || spec.type === "doughnut" || spec.type === "polarArea" || spec.type === "radar") return { w: 4, h: 4 };
  if (spec.type === "line" || spec.type === "area") return { w: 8, h: 4 };
  return { w: 6, h: 4 };
}

export function chartWidget(datasetId: string, spec: ChartSpec, title?: string): Widget {
  const { w, h } = defaultSize(spec);
  return { id: newId("w"), kind: "chart", title: title ?? spec.title ?? "", datasetId, spec, w, h };
}

export const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;
