import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Chart as ChartJS } from "chart.js";
import { Download, Ellipsis, ImageDown, LayoutDashboard, SlidersHorizontal, Table2, ChartColumn } from "lucide-react";
import { buildChart, autoTitle, type DrillTarget, type TableView } from "../../lib/chart/engine";
import type { PreparedDataset } from "../../lib/data/prepare";
import { usePrefs, useResolvedTheme } from "../../lib/prefs";
import { downloadDataUrl, downloadTableCsv, safeFilename } from "../../lib/export";
import { builderUrl, chartWidget } from "../../lib/spec";
import type { ChartSpec } from "../../types";
import { ChartView } from "./ChartView";
import { Card } from "../ui/Surface";
import { Button } from "../ui/Button";
import { MenuItem, MenuSeparator, Popover } from "../ui/Overlay";
import { AddToDashboardDialog } from "../dashboard/AddToDashboardDialog";

export const TableFallback: React.FC<{ table: TableView; maxRows?: number }> = ({ table, maxRows = 200 }) => (
  <div className="h-full overflow-auto rounded-lg border border-line">
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 bg-surface-2">
        <tr>
          {table.headers.map((h, i) => (
            <th key={i} scope="col" className={`whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-2 ${i ? "text-right" : "text-left"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.slice(0, maxRows).map((r, ri) => (
          <tr key={ri} className="border-b border-line last:border-0">
            {r.map((c, ci) => (
              <td key={ci} className={`whitespace-nowrap px-3 py-1.5 ${ci ? "vz-num text-right text-ink" : "text-ink-2"}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export interface ChartCardProps {
  ds: PreparedDataset;
  idx: Uint32Array;
  spec: ChartSpec;
  title?: string;
  subtitle?: React.ReactNode;
  height?: number;
  compact?: boolean;
  onDrill?: (target: DrillTarget) => void;
  /** Extra header controls (e.g. widget menu on dashboards). */
  actions?: React.ReactNode;
  showMenu?: boolean;
  className?: string;
  badge?: React.ReactNode;
  /** Public/shared views: no builder or dashboard actions. */
  readOnly?: boolean;
}

export const ChartCard: React.FC<ChartCardProps> = ({ ds, idx, spec, title, subtitle, height = 280, compact, onDrill, actions, showMenu = true, className = "", badge, readOnly = false }) => {
  const theme = useResolvedTheme();
  const prefs = usePrefs();
  const chartRef = useRef<ChartJS | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [addOpen, setAddOpen] = useState(false);
  const built = useMemo(
    () => buildChart({ ds, idx, spec, theme, compact }),
    // currency / compact preferences change the formatters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, idx, spec, theme, compact, prefs.currency, prefs.compactNumbers]
  );
  const heading = title || spec.title || autoTitle(spec, ds);

  return (
    <Card padded={false} className={`print-break-avoid flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-tight text-ink" title={heading}>
              {heading}
            </h3>
            {badge}
          </div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
        </div>
        <div className="no-print flex shrink-0 items-center gap-0.5">
          {actions}
          {showMenu && (
            <Popover
              align="end"
              width={220}
              trigger={({ toggle, ref }) => (
                <Button ref={ref} variant="ghost" size="xs" iconOnly onClick={toggle} aria-label="Chart options">
                  <Ellipsis size={16} />
                </Button>
              )}
            >
              {(close) => (
                <div role="menu">
                  <MenuItem
                    icon={view === "chart" ? <Table2 size={15} /> : <ChartColumn size={15} />}
                    onClick={() => {
                      setView(view === "chart" ? "table" : "chart");
                      close();
                    }}
                  >
                    {view === "chart" ? "View as table" : "View as chart"}
                  </MenuItem>
                  {!readOnly && (
                    <>
                      <Link to={builderUrl(ds.id, { ...spec, title: spec.title ?? heading })} onClick={close} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink hover:bg-surface-3">
                        <SlidersHorizontal size={15} className="text-ink-3" /> Open in chart builder
                      </Link>
                      <MenuItem
                        icon={<LayoutDashboard size={15} />}
                        onClick={() => {
                          close();
                          setAddOpen(true);
                        }}
                      >
                        Add to dashboard
                      </MenuItem>
                    </>
                  )}
                  <MenuSeparator />
                  <MenuItem
                    icon={<ImageDown size={15} />}
                    disabled={built.empty || view !== "chart"}
                    data-track="export_chart_png"
                    onClick={() => {
                      const url = chartRef.current?.toBase64Image("image/png", 1);
                      if (url) downloadDataUrl(url, safeFilename(heading, "png"));
                      close();
                    }}
                  >
                    Download PNG
                  </MenuItem>
                  <MenuItem
                    icon={<Download size={15} />}
                    disabled={built.empty}
                    data-track="export_chart_csv"
                    onClick={() => {
                      downloadTableCsv(built.table.headers, built.table.rows, safeFilename(heading, "csv"));
                      close();
                    }}
                  >
                    Download data (CSV)
                  </MenuItem>
                </div>
              )}
            </Popover>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3" style={{ height }}>
        {view === "chart" ? <ChartView ref={chartRef} built={built} onDrill={onDrill} trackName={heading} /> : <TableFallback table={built.table} />}
      </div>
      {built.notes.length > 0 && !compact && (
        <p className="border-t border-line px-4 py-2 text-[11.5px] leading-snug text-ink-3">{built.notes.join(" ")}</p>
      )}
      {!readOnly && <AddToDashboardDialog open={addOpen} onClose={() => setAddOpen(false)} widget={addOpen ? chartWidget(ds.id, { ...spec, title: spec.title ?? heading }) : null} />}
    </Card>
  );
};
