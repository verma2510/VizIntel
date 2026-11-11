import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Download, ListFilter, Table2 } from "lucide-react";
import type { DrillTarget } from "../../lib/chart/engine";
import { applyFilters, describeFilter } from "../../lib/data/filters";
import type { PreparedDataset } from "../../lib/data/prepare";
import { aggregateValue } from "../../lib/data/aggregate";
import { naturalAgg } from "../../lib/analysis";
import { AGG_LABEL, formatInteger, formatMeasure, formatShare } from "../../lib/format";
import { downloadRowsCsv, safeFilename } from "../../lib/export";
import { Drawer } from "../ui/Overlay";
import { Button, ButtonLink } from "../ui/Button";
import { DataTable } from "./DataTable";
import type { Filter } from "../../types";

/**
 * Drill-down: the exact rows behind a clicked chart mark, with summary stats, export, and (when the host
 * supports it) a cross-filter action that applies the selection to the whole page.
 */
export const DrillDrawer: React.FC<{
  ds: PreparedDataset | null;
  base: Uint32Array | null;
  target: DrillTarget | null;
  onClose: () => void;
  onApplyFilters?: (filters: Filter[]) => void;
  applyLabel?: string;
  /** Public views: no link into the workspace explorer. */
  readOnly?: boolean;
}> = ({ ds, base, target, onClose, onApplyFilters, applyLabel = "Filter this page", readOnly = false }) => {
  const idx = useMemo(() => (ds && base && target ? applyFilters(ds, target.filters, { base }) : null), [ds, base, target]);
  const stats = useMemo(() => {
    if (!ds || !idx) return [];
    return ds.measures.slice(0, 4).map((m) => {
      const agg = naturalAgg(m);
      const value = aggregateValue(ds, idx, m.name, agg);
      const total = base ? aggregateValue(ds, base, m.name, agg) : null;
      return { m, agg, value, share: agg === "sum" && total ? (value ?? 0) / total : null };
    });
  }, [ds, idx, base]);

  if (!ds || !target || !idx) return null;

  const explorerHref = `/app/explore/${ds.id}?filters=${encodeURIComponent(JSON.stringify(target.filters))}`;
  return (
    <Drawer
      open
      onClose={onClose}
      title={target.title}
      description={
        <span>
          {formatInteger(idx.length)} of {formatInteger(base?.length ?? ds.n)} rows · {target.filters.map((f) => describeFilter(f, ds.field(f.column)?.label)).join(" · ")}
        </span>
      }
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => downloadRowsCsv(ds.rows, ds.fields.map((f) => f.name), idx, safeFilename(`${ds.name}-${target.title}`, "csv"))} data-track="drill_export">
            <Download size={15} /> Export rows
          </Button>
          {!readOnly && (
            <ButtonLink to={explorerHref} variant="secondary" onClick={onClose}>
              <Table2 size={15} /> Open in explorer
            </ButtonLink>
          )}
          {onApplyFilters && (
            <Button
              onClick={() => {
                onApplyFilters(target.filters);
                onClose();
              }}
              data-track="drill_cross_filter"
            >
              <ListFilter size={15} /> {applyLabel}
            </Button>
          )}
        </>
      }
    >
      {stats.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map(({ m, agg, value, share }) => (
            <div key={m.name} className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="truncate text-xs text-ink-3">
                {AGG_LABEL[agg]} {m.label}
              </p>
              <p className="mt-1 truncate text-lg font-semibold tracking-tight text-ink">
                {formatMeasure(value, m.semanticType, { percentIsFraction: m.semanticType === "percentage" && ds.percentIsFraction(m.name) })}
              </p>
              {share !== null && <p className="text-xs text-ink-3">{formatShare(share)} of total</p>}
            </div>
          ))}
        </div>
      )}
      <DataTable ds={ds} idx={idx} pageSize={25} maxHeight="calc(100vh - 340px)" dense />
      {!readOnly && (
        <p className="mt-3 text-xs text-ink-3">
          <Link to={explorerHref} onClick={onClose} className="text-brand-ink hover:underline">
            Open these rows in the explorer
          </Link>{" "}
          to profile columns or refine the selection.
        </p>
      )}
    </Drawer>
  );
};
