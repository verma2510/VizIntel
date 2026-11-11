import React, { useEffect, useMemo, useState } from "react";
import { Check, ChartColumn, Gauge, NotebookText, Sparkles, Table2 } from "lucide-react";
import { useData, useDataset } from "../../context/Data";
import { getPrepared } from "../../lib/data/prepare";
import { naturalAgg, profileColumns, recommendCharts } from "../../lib/analysis";
import { applyFilters, newId } from "../../lib/data/filters";
import { autoTitle } from "../../lib/chart/engine";
import { chartWidget, defaultSize } from "../../lib/spec";
import { AGG_LABEL } from "../../lib/format";
import type { Aggregation, ChartSpec, Widget, WidgetKind } from "../../types";
import { Modal } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Label, inputClass, Textarea } from "../ui/Field";
import { Spinner } from "../ui/Surface";
import { DatasetPicker } from "../data/DatasetPicker";
import { ChartCard } from "../charts/ChartCard";

const KINDS: { kind: WidgetKind; label: string; icon: React.ComponentType<{ size?: number }>; hint: string }[] = [
  { kind: "chart", label: "Chart", icon: ChartColumn, hint: "Recommended or custom" },
  { kind: "kpi", label: "KPI", icon: Gauge, hint: "One headline number" },
  { kind: "table", label: "Table", icon: Table2, hint: "Rows and columns" },
  { kind: "insights", label: "AI summary", icon: Sparkles, hint: "The AI narrative" },
  { kind: "text", label: "Note", icon: NotebookText, hint: "Markdown text" },
];

/** Create (any kind) or edit (KPI / table / AI summary / note) a dashboard widget. */
export const WidgetDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  editing?: Widget | null;
  defaultDatasetId?: string;
  onSubmit: (widget: Widget) => void;
  onBuildCustomChart: (datasetId: string | undefined) => void;
}> = ({ open, onClose, editing, defaultDatasetId, onSubmit, onBuildCustomChart }) => {
  const { datasets } = useData();
  const [kind, setKind] = useState<WidgetKind>("chart");
  const [datasetId, setDatasetId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [column, setColumn] = useState<string>("");
  const [agg, setAgg] = useState<Aggregation>("sum");
  const [columns, setColumns] = useState<string[]>([]);
  const [limit, setLimit] = useState<number | "">("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(editing?.kind ?? "chart");
    setDatasetId(editing?.datasetId ?? defaultDatasetId ?? datasets[0]?._id);
    setTitle(editing?.title ?? "");
    setColumn(editing?.kind === "kpi" ? editing.spec.column ?? "" : "");
    setAgg(editing?.kind === "kpi" ? editing.spec.agg : "sum");
    setColumns(editing?.kind === "table" ? editing.spec.columns ?? [] : []);
    setLimit(editing?.kind === "table" ? editing.spec.limit ?? "" : "");
    setText(editing?.kind === "text" ? editing.spec.text : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const needsData = kind !== "text";
  const { dataset, loading } = useDataset(open && needsData ? datasetId : undefined);
  const ds = useMemo(() => (dataset?.originalData ? getPrepared(dataset) : null), [dataset]);
  const recs = useMemo(() => {
    if (!ds || kind !== "chart") return [];
    const all = ds.allIndices();
    return recommendCharts(ds, profileColumns(ds, all), [], Object.keys(dataset?.kpis ?? {})).slice(0, 6);
  }, [ds, kind, dataset?.kpis]);
  const allIdx = useMemo(() => (ds ? applyFilters(ds, []) : null), [ds]);

  // Sensible KPI defaults when the dataset changes.
  useEffect(() => {
    if (!ds || kind !== "kpi" || editing) return;
    const m = ds.measures[0];
    setColumn(m?.name ?? "");
    setAgg(m ? naturalAgg(m) : "count");
  }, [ds, kind, editing]);

  const submit = () => {
    const base = { id: editing?.id ?? newId("w"), datasetId: needsData ? datasetId ?? null : null };
    let widget: Widget;
    switch (kind) {
      case "kpi":
        widget = { ...base, kind, title: title.trim() || (column ? ds?.field(column)?.label ?? column : "Rows"), spec: { column: column || undefined, agg: column ? agg : "count", filters: editing?.kind === "kpi" ? editing.spec.filters : undefined }, w: editing?.w ?? 3, h: editing?.h ?? 2 };
        break;
      case "table":
        widget = { ...base, kind, title: title.trim() || dataset?.name || "Table", spec: { columns: columns.length ? columns : undefined, limit: limit || undefined, filters: editing?.kind === "table" ? editing.spec.filters : undefined }, w: editing?.w ?? 12, h: editing?.h ?? 5 };
        break;
      case "insights":
        widget = { ...base, kind, title: title.trim() || `AI insights · ${dataset?.name ?? ""}`, spec: {}, w: editing?.w ?? 6, h: editing?.h ?? 4 };
        break;
      case "text":
        widget = { ...base, datasetId: null, kind, title: title.trim(), spec: { text }, w: editing?.w ?? 6, h: editing?.h ?? 2 };
        break;
      default:
        return;
    }
    onSubmit(widget);
    onClose();
  };

  const addChart = (spec: ChartSpec) => {
    if (!datasetId || !ds) return;
    const titled = { ...spec, title: spec.title ?? autoTitle(spec, ds) };
    onSubmit({ ...chartWidget(datasetId, titled), ...defaultSize(titled) });
    onClose();
  };

  const canSubmit = kind === "text" ? Boolean(text.trim() || title.trim()) : Boolean(datasetId) && (kind !== "table" || Boolean(ds));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit widget" : "Add a widget"}
      size="xl"
      footer={
        kind !== "chart" && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSubmit} data-track="widget_save" data-track-kind={kind}>
              {editing ? "Save widget" : "Add widget"}
            </Button>
          </>
        )
      }
    >
      {!editing && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Widget type">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${kind === k.kind ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong"}`}
            >
              <span className={kind === k.kind ? "text-brand-ink" : "text-ink-2"}>
                <k.icon size={18} />
              </span>
              <span className="text-[13px] font-medium text-ink">{k.label}</span>
              <span className="text-[11.5px] text-ink-3">{k.hint}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {needsData && (
          <div>
            <Label>Dataset</Label>
            <DatasetPicker value={datasetId} onChange={setDatasetId} className="w-full" />
          </div>
        )}
        {kind !== "chart" && (
          <div>
            <Label htmlFor="w-title">Title</Label>
            <input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Automatic" maxLength={200} className={`${inputClass} h-9`} />
          </div>
        )}
      </div>

      {needsData && loading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {kind === "chart" && ds && allIdx && (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink">Recommended for this dataset</p>
            <Button variant="secondary" size="sm" onClick={() => onBuildCustomChart(datasetId)}>
              <ChartColumn size={14} /> Build a custom chart
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {recs.map((r) => (
              <button key={r.id} type="button" onClick={() => addChart(r.spec)} className="group rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand" data-track="widget_add_recommended" data-track-type={r.spec.type}>
                <ChartCard ds={ds} idx={allIdx} spec={r.spec} height={150} compact showMenu={false} className="pointer-events-none transition-[border-color] group-hover:border-brand" subtitle={r.reason} />
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === "kpi" && ds && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="w-col">Metric</Label>
            <select id="w-col" value={column} onChange={(e) => setColumn(e.target.value)} className={`${inputClass} h-9`}>
              <option value="">Row count</option>
              {ds.fields
                .filter((f) => f.role === "measure" || f.role === "dimension" || f.role === "identifier")
                .map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="w-agg">Aggregation</Label>
            <select id="w-agg" value={column ? agg : "count"} disabled={!column} onChange={(e) => setAgg(e.target.value as Aggregation)} className={`${inputClass} h-9`}>
              {(ds.field(column)?.role === "measure" ? ["sum", "avg", "median", "min", "max", "count", "distinct"] : ["count", "distinct"]).map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {kind === "table" && ds && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <Label hint={columns.length ? `${columns.length} selected` : "all columns"}>Columns</Label>
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-line p-2">
              {ds.fields.map((f) => {
                const on = columns.includes(f.name);
                return (
                  <button key={f.name} type="button" onClick={() => setColumns((c) => (on ? c.filter((x) => x !== f.name) : [...c, f.name]))} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-surface-3">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-line-strong"}`}>{on && <Check size={11} />}</span>
                    <span className="truncate text-ink">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label htmlFor="w-limit" hint="blank = all">Max rows</Label>
            <input id="w-limit" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value ? Math.max(1, Number(e.target.value)) : "")} className={`${inputClass} h-9`} />
          </div>
        </div>
      )}

      {kind === "insights" && dataset && (
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px] text-ink-2">Shows the AI narrative for “{dataset.name}”. It updates automatically when insights are regenerated.</p>
      )}

      {kind === "text" && (
        <div className="mt-4">
          <Label htmlFor="w-text" hint="Markdown supported">Note</Label>
          <Textarea id="w-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} maxLength={5000} placeholder={"## Context\nWhat should readers know about this dashboard?"} />
        </div>
      )}
    </Modal>
  );
};
