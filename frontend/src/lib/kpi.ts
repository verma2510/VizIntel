import type { KpiSpec } from "../types";
import type { KpiSummary } from "./analysis";
import { aggregate, aggregateValue } from "./data/aggregate";
import type { PreparedDataset } from "./data/prepare";

/** KPI tile data for a dashboard widget: the aggregate plus a trend on the primary date column. */
export function kpiSummary(ds: PreparedDataset, idx: Uint32Array, spec: KpiSpec, label: string): KpiSummary {
  const field = ds.field(spec.column);
  const agg = field ? spec.agg : "count";
  const value = aggregateValue(ds, idx, field?.name, agg);
  let spark: number[] | undefined;
  let delta: number | null = null;
  let deltaLabel: string | undefined;
  if (ds.primaryDate) {
    const res = aggregate(ds, idx, { x: ds.primaryDate.name, y: field ? [field.name] : [], agg, bucket: "auto" });
    const values = res.series[0]?.values.map((v) => v ?? 0) ?? [];
    if (values.length >= 2) {
      spark = values.slice(-24);
      const last = values[values.length - 1];
      const prev = values[values.length - 2];
      if (prev) {
        delta = (last - prev) / Math.abs(prev);
        deltaLabel = `${res.labels[res.labels.length - 1]} vs previous ${res.bucket}`;
      }
    }
  }
  const countLike = agg === "count" || agg === "distinct";
  return {
    column: field?.name,
    label,
    agg,
    value,
    semanticType: countLike ? undefined : field?.semanticType,
    percentIsFraction: field?.semanticType === "percentage" ? ds.percentIsFraction(field.name) : undefined,
    spark,
    delta,
    deltaLabel,
  };
}
