import React, { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowRight, Copy, Ellipsis, GripVertical, Pencil, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import type { Dataset, DateRange, Filter, TableSpec, Widget } from "../../types";
import { getPrepared, type PreparedDataset } from "../../lib/data/prepare";
import { applyFilters, newId } from "../../lib/data/filters";
import { kpiSummary } from "../../lib/kpi";
import type { DrillTarget } from "../../lib/chart/engine";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ChartCard } from "../charts/ChartCard";
import { KpiCard } from "../charts/KpiCard";
import { DataTable } from "../data/DataTable";
import { AiNarrative, InsightsFailed, InsightsPending } from "../insights/InsightsStatus";
import { Button } from "../ui/Button";
import { Card, Spinner } from "../ui/Surface";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "../ui/Overlay";

export const ROW_HEIGHT = 84;
export const GAP = 16;

export type DatasetState = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | { status: "ready"; dataset: Dataset };

export interface CanvasProps {
  widgets: Widget[];
  datasets: Record<string, DatasetState>;
  dateRange?: DateRange;
  filters?: Filter[];
  editable?: boolean;
  onChange?: (widgets: Widget[]) => void;
  onEditWidget?: (widget: Widget) => void;
  onDrill?: (ds: PreparedDataset, base: Uint32Array, target: DrillTarget) => void;
  onRetryInsights?: (datasetId: string) => void;
  readOnly?: boolean;
}

const widgetHeight = (h: number) => h * ROW_HEIGHT + (h - 1) * GAP;

const WidgetBody: React.FC<{
  widget: Widget;
  state: DatasetState | undefined;
  dateRange?: DateRange;
  filters?: Filter[];
  menu: React.ReactNode;
  onDrill?: CanvasProps["onDrill"];
  onRetryInsights?: (id: string) => void;
  readOnly?: boolean;
}> = ({ widget, state, dateRange, filters, menu, onDrill, onRetryInsights, readOnly }) => {
  const ready = state?.status === "ready" ? state.dataset : null;
  const ds = useMemo(() => (ready?.originalData ? getPrepared(ready) : null), [ready]);
  const ownFilters = widget.kind === "chart" || widget.kind === "kpi" || widget.kind === "table" ? widget.spec.filters : undefined;
  const idx = useMemo(() => (ds ? applyFilters(ds, [...(ownFilters ?? []), ...(filters ?? [])], { dateRange }) : null), [ds, ownFilters, filters, dateRange]);
  const height = widgetHeight(widget.h);

  if (widget.kind === "text") {
    return (
      <Card className="relative h-full overflow-auto">
        <div className="no-print absolute right-2 top-2">{menu}</div>
        {widget.title && <h3 className="mb-2 pr-8 text-[14px] font-semibold tracking-tight text-ink">{widget.title}</h3>}
        <div className="vz-prose text-[13.5px] text-ink-2">
          <ReactMarkdown>{widget.spec.text || "_Empty note_"}</ReactMarkdown>
        </div>
      </Card>
    );
  }

  const frame = (body: React.ReactNode) => (
    <Card padded={false} className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
        <h3 className="truncate text-[14px] font-semibold tracking-tight text-ink">{widget.title || "Untitled widget"}</h3>
        <div className="no-print shrink-0">{menu}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-4 text-center">{body}</div>
    </Card>
  );

  if (!widget.datasetId) return frame(<p className="text-[13px] text-ink-3">No dataset selected.</p>);
  if (!state || state.status === "loading") return frame(<Spinner />);
  if (state.status === "missing") {
    return frame(
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <TriangleAlert size={15} className="text-warn" /> The dataset for this widget was deleted or isn't available.
      </p>
    );
  }
  if (state.status === "error") return frame(<p className="text-[13px] text-bad">{state.message}</p>);

  if (widget.kind === "insights") {
    const status = state.dataset.insightsStatus ?? "ready";
    return (
      <Card className="vz-ai-ring flex h-full flex-col overflow-hidden">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 truncate text-[14px] font-semibold tracking-tight text-ink">
            <span className="rounded bg-volt px-1 text-[10px] font-semibold text-volt-ink">AI</span>
            {widget.title || state.dataset.name}
          </h3>
          <div className="no-print shrink-0">{menu}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {status === "pending" ? (
            <InsightsPending compact />
          ) : status === "failed" ? (
            onRetryInsights ? <InsightsFailed onRetry={() => onRetryInsights(state.dataset._id)} retrying={false} /> : <p className="text-[13px] text-ink-3">Insights are not available for this dataset yet.</p>
          ) : (
            <AiNarrative insights={state.dataset.insights ?? ""} compact />
          )}
        </div>
      </Card>
    );
  }

  if (!ds || !idx) return frame(<Spinner />);

  if (widget.kind === "chart") {
    return (
      <ChartCard
        ds={ds}
        idx={idx}
        spec={widget.spec}
        title={widget.title}
        compact
        height={Math.max(80, height - 60)}
        className="h-full"
        actions={menu}
        readOnly={readOnly}
        onDrill={onDrill ? (t) => onDrill(ds, idx, t) : undefined}
      />
    );
  }

  if (widget.kind === "kpi") {
    const kpi = kpiSummary(ds, idx, widget.spec, widget.title || ds.field(widget.spec.column)?.label || "Rows");
    return (
      <div className="relative h-full">
        <KpiCard kpi={kpi} className="h-full" />
        <div className="no-print absolute right-2 top-2">{menu}</div>
      </div>
    );
  }

  const spec = widget.spec as TableSpec;
  const tableIdx = spec.limit ? idx.subarray(0, spec.limit) : idx;
  return (
    <Card padded={false} className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h3 className="truncate text-[14px] font-semibold tracking-tight text-ink">{widget.title || ds.name}</h3>
        <div className="no-print shrink-0">{menu}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-2">
        <DataTable ds={ds} idx={tableIdx} columns={spec.columns} pageSize={Math.max(5, widget.h * 3)} maxHeight={height - 100} dense />
      </div>
    </Card>
  );
};

const SIZE_PRESETS: { label: string; w: number }[] = [
  { label: "Small (¼)", w: 3 },
  { label: "Third", w: 4 },
  { label: "Half", w: 6 },
  { label: "Two-thirds", w: 8 },
  { label: "Full width", w: 12 },
];

export const DashboardCanvas: React.FC<CanvasProps> = ({ widgets, datasets, dateRange, filters, editable = false, onChange, onEditWidget, onDrill, onRetryInsights, readOnly }) => {
  const wide = useMediaQuery("(min-width: 768px)");
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number } | null>(null);

  const update = (next: Widget[]) => onChange?.(next);
  const patch = (id: string, p: Partial<Widget>) => update(widgets.map((w) => (w.id === id ? ({ ...w, ...p } as Widget) : w)));
  const move = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const startResize = (e: React.PointerEvent, widget: Widget) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const colWidth = (grid.clientWidth - GAP * 11) / 12;
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let current = { id: widget.id, w: widget.w, h: widget.h };
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(2, Math.min(12, widget.w + Math.round((ev.clientX - startX) / (colWidth + GAP))));
      const h = Math.max(2, Math.min(10, widget.h + Math.round((ev.clientY - startY) / (ROW_HEIGHT + GAP))));
      if (w !== current.w || h !== current.h) {
        current = { id: widget.id, w, h };
        setResizing(current);
      }
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setResizing(null);
      if (current.w !== widget.w || current.h !== widget.h) patch(widget.id, { w: current.w, h: current.h });
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const drop = (targetId: string, after: boolean) => {
    if (!dragId || dragId === targetId) return;
    const dragged = widgets.find((w) => w.id === dragId);
    if (!dragged) return;
    const rest = widgets.filter((w) => w.id !== dragId);
    const at = rest.findIndex((w) => w.id === targetId) + (after ? 1 : 0);
    update([...rest.slice(0, at), dragged, ...rest.slice(at)]);
  };

  return (
    <div ref={gridRef} className="grid grid-cols-12" style={{ gap: GAP, gridAutoRows: ROW_HEIGHT }}>
      {widgets.map((widget, i) => {
        const size = resizing?.id === widget.id ? resizing : widget;
        const menu = editable ? (
          <Popover
            align="end"
            width={220}
            trigger={({ toggle, ref }) => (
              <Button ref={ref} variant="ghost" size="xs" iconOnly onClick={toggle} aria-label={`Options for ${widget.title || "widget"}`}>
                <Ellipsis size={16} />
              </Button>
            )}
          >
            {(close) => (
              <div role="menu">
                <MenuItem
                  icon={widget.kind === "chart" ? <SlidersHorizontal size={15} /> : <Pencil size={15} />}
                  onClick={() => {
                    close();
                    onEditWidget?.(widget);
                  }}
                >
                  {widget.kind === "chart" ? "Edit in chart builder" : "Edit widget"}
                </MenuItem>
                <MenuItem
                  icon={<Copy size={15} />}
                  onClick={() => {
                    close();
                    const copy = { ...widget, id: newId("w"), title: widget.title ? `${widget.title} (copy)` : "" } as Widget;
                    update([...widgets.slice(0, i + 1), copy, ...widgets.slice(i + 1)]);
                  }}
                >
                  Duplicate
                </MenuItem>
                <MenuSeparator />
                <MenuLabel>Width</MenuLabel>
                {SIZE_PRESETS.map((p) => (
                  <MenuItem key={p.w} onClick={() => patch(widget.id, { w: p.w })} hint={widget.w === p.w ? "✓" : undefined}>
                    {p.label}
                  </MenuItem>
                ))}
                <MenuLabel>Height</MenuLabel>
                <div className="flex gap-1 px-2 pb-1">
                  {[2, 3, 4, 5, 6].map((h) => (
                    <button key={h} type="button" onClick={() => patch(widget.id, { h })} className={`h-7 flex-1 rounded-md text-xs ${widget.h === h ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-3"}`}>
                      {h}
                    </button>
                  ))}
                </div>
                <MenuSeparator />
                <MenuItem icon={<ArrowLeft size={15} />} disabled={i === 0} onClick={() => move(widget.id, -1)}>
                  Move earlier
                </MenuItem>
                <MenuItem icon={<ArrowRight size={15} />} disabled={i === widgets.length - 1} onClick={() => move(widget.id, 1)}>
                  Move later
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash2 size={15} />}
                  danger
                  onClick={() => {
                    close();
                    update(widgets.filter((w) => w.id !== widget.id));
                  }}
                >
                  Remove
                </MenuItem>
              </div>
            )}
          </Popover>
        ) : null;

        return (
          <div
            key={widget.id}
            className={`group/widget relative min-w-0 ${dragId === widget.id ? "opacity-40" : ""}`}
            style={{ gridColumn: `span ${wide ? size.w : 12} / span ${wide ? size.w : 12}`, gridRow: `span ${size.h} / span ${size.h}` }}
            onDragOver={
              editable
                ? (e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDropHint({ id: widget.id, after: e.clientX > rect.left + rect.width / 2 });
                  }
                : undefined
            }
            onDragLeave={() => setDropHint((h) => (h?.id === widget.id ? null : h))}
            onDrop={
              editable
                ? (e) => {
                    e.preventDefault();
                    drop(widget.id, dropHint?.id === widget.id ? dropHint.after : false);
                    setDropHint(null);
                    setDragId(null);
                  }
                : undefined
            }
          >
            {dropHint?.id === widget.id && dragId && dragId !== widget.id && (
              <span className={`pointer-events-none absolute inset-y-0 z-10 w-1 rounded-full bg-brand ${dropHint.after ? "-right-2.5" : "-left-2.5"}`} />
            )}
            <div className={`h-full ${editable ? "rounded-xl ring-brand/40 transition-shadow group-hover/widget:ring-2" : ""} ${resizing?.id === widget.id ? "ring-2" : ""}`}>
              <WidgetBody widget={widget} state={widget.datasetId ? datasets[widget.datasetId] : undefined} dateRange={dateRange} filters={filters} menu={menu} onDrill={onDrill} onRetryInsights={onRetryInsights} readOnly={readOnly} />
            </div>
            {editable && (
              <>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    setDragId(widget.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", widget.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropHint(null);
                  }}
                  className="no-print absolute -left-2 top-1/2 z-10 flex h-8 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded-md border border-line bg-surface text-ink-3 opacity-0 shadow-card-sm transition-opacity hover:text-ink focus-visible:opacity-100 active:cursor-grabbing group-hover/widget:opacity-100"
                  aria-label={`Drag to reorder ${widget.title || "widget"} (or use the widget menu)`}
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </button>
                {wide && (
                  <span
                    onPointerDown={(e) => startResize(e, widget)}
                    className="no-print absolute bottom-1 right-1 z-10 h-4 w-4 cursor-nwse-resize rounded-sm opacity-0 transition-opacity group-hover/widget:opacity-100"
                    style={{ background: "linear-gradient(135deg, transparent 50%, var(--vz-line-strong) 50%)" }}
                    title="Drag to resize"
                    aria-hidden="true"
                  />
                )}
                {resizing?.id === widget.id && (
                  <span className="vz-num pointer-events-none absolute bottom-3 right-6 z-10 rounded-md bg-ink px-1.5 py-0.5 text-[11px] text-canvas">
                    {size.w} × {size.h}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
