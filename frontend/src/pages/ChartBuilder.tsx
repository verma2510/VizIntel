import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Chart as ChartJS } from "chart.js";
import {
  ArrowUp,
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  CircleDot,
  Donut,
  Download,
  ImageDown,
  LayoutDashboard,
  Link2,
  Radar,
  RotateCcw,
  Sparkles,
  Table2,
  X,
  ChartColumnBig,
  Save,
} from "lucide-react";
import { useData, useDataset } from "../context/Data";
import { useDashboards } from "../context/Dashboards";
import { useToast } from "../context/Toast";
import { useShell } from "../components/layout/AppShell";
import { api, errorMessage } from "../lib/api";
import { autoTitle, buildChart, CHART_TYPES, requirements, type DrillTarget } from "../lib/chart/engine";
import { PALETTE_OPTIONS, paletteColors } from "../lib/chart/theme";
import { applyFilters } from "../lib/data/filters";
import { getPrepared, type Field, type PreparedDataset } from "../lib/data/prepare";
import { naturalAgg } from "../lib/analysis";
import { usePrefs, useResolvedTheme } from "../lib/prefs";
import { builderUrl, chartWidget, parseSpec } from "../lib/spec";
import { copyText, downloadDataUrl, downloadTableCsv, safeFilename } from "../lib/export";
import { AGG_LABEL } from "../lib/format";
import type { Aggregation, AskResponse, ChartSpec, ChartStyle, ChartType, DateBucket, DateRange, Filter, LegendPosition, SortMode, Widget } from "../types";
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader, Segmented } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { inputClass, Label, Switch } from "../components/ui/Field";
import { DatasetPicker } from "../components/data/DatasetPicker";
import { DateRangePicker, FilterBar } from "../components/data/Filters";
import { DrillDrawer } from "../components/data/DrillDrawer";
import { ChartView } from "../components/charts/ChartView";
import { TableFallback } from "../components/charts/ChartCard";
import { AddToDashboardDialog } from "../components/dashboard/AddToDashboardDialog";

const TYPE_ICON: Record<ChartType, React.ComponentType<{ size?: number; className?: string }>> = {
  bar: ChartColumn,
  hbar: ChartBar,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  doughnut: Donut,
  polarArea: CircleDot,
  radar: Radar,
  scatter: ChartScatter,
  bubble: CircleDot,
  histogram: ChartColumnBig,
};

const NO_FILTERS: Filter[] = [];

const ROLE_GROUP: Record<string, string> = { measure: "Metrics", date: "Dates", dimension: "Categories", identifier: "Identifiers", text: "Text" };

function defaultSpec(ds: PreparedDataset): ChartSpec {
  const m = ds.measures[0];
  const t = ds.primaryDate;
  const d = ds.dimensions[0];
  if (t && m) return { type: "area", x: t.name, y: [m.name], agg: naturalAgg(m), bucket: "auto" };
  if (d && m) return { type: "bar", x: d.name, y: [m.name], agg: naturalAgg(m), sort: "desc", limit: 12 };
  if (d) return { type: "bar", x: d.name, y: [], agg: "count", sort: "desc", limit: 12 };
  if (m) return { type: "histogram", y: [m.name], agg: "count" };
  return { type: "bar", x: ds.fields[0]?.name, y: [], agg: "count" };
}

/** Keeps a spec valid when the chart type or dataset changes. */
function reconcile(spec: ChartSpec, ds: PreparedDataset): ChartSpec {
  const req = requirements(spec.type);
  const next: ChartSpec = { ...spec, y: spec.y.filter((m) => ds.field(m)?.role === "measure") };
  if (next.groupBy && !ds.has(next.groupBy)) delete next.groupBy;
  if (req.x === "measure" && ds.field(next.x)?.role !== "measure") next.x = ds.measures.find((m) => !next.y.includes(m.name))?.name ?? ds.measures[0]?.name;
  if (req.x === "category" && (!ds.has(next.x) || ds.field(next.x)?.role === "measure")) next.x = (ds.primaryDate ?? ds.dimensions[0] ?? ds.fields.find((f) => f.role !== "measure"))?.name;
  if (req.x === "none") delete next.x;
  if (next.y.length > req.maxY) next.y = next.y.slice(0, req.maxY);
  if (next.y.length < req.minY && ds.measures[0]) next.y = [ds.measures.find((m) => m.name !== next.x)?.name ?? ds.measures[0].name];
  if (!req.group) delete next.groupBy;
  if (req.size && !ds.has(next.size)) next.size = ds.measures.find((m) => m.name !== next.x && !next.y.includes(m.name))?.name;
  if (!next.y.length && next.agg !== "count") next.agg = "count";
  return next;
}

const FieldSelect: React.FC<{ ds: PreparedDataset; value?: string; onChange: (v: string | undefined) => void; filter?: (f: Field) => boolean; placeholder: string; id: string; allowNone?: boolean }> = ({
  ds,
  value,
  onChange,
  filter = () => true,
  placeholder,
  id,
  allowNone,
}) => {
  const groups = ["measure", "date", "dimension", "identifier", "text"].map((role) => ({ role, fields: ds.fields.filter((f) => f.role === role && filter(f)) })).filter((g) => g.fields.length);
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={`${inputClass} h-9 appearance-none bg-[length:14px] pr-8`}>
      <option value="" disabled={!allowNone}>
        {placeholder}
      </option>
      {groups.map((g) => (
        <optgroup key={g.role} label={ROLE_GROUP[g.role]}>
          {g.fields.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ title, children, aside }) => (
  <section className="border-b border-line px-4 py-4 last:border-0">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
      {aside}
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

export const ChartBuilder: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { datasets, status: listStatus } = useData();
  const { update: updateDashboard, addWidget } = useDashboards();
  const { openUpload } = useShell();
  const toast = useToast();
  const theme = useResolvedTheme();
  const prefs = usePrefs();
  const chartRef = useRef<ChartJS | null>(null);

  const editingDashboard = params.get("dashboard");
  const editingWidget = params.get("widget");
  const [datasetId, setDatasetId] = useState<string | undefined>(params.get("dataset") ?? undefined);
  const effectiveId = datasetId ?? datasets[0]?._id;
  const { dataset, loading, error, retry } = useDataset(effectiveId);
  const ds = useMemo(() => (dataset?.originalData ? getPrepared(dataset) : null), [dataset]);

  const [spec, setSpec] = useState<ChartSpec | null>(() => parseSpec(params.get("spec")));
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [view, setView] = useState<"chart" | "table">("chart");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [saveWidget, setSaveWidget] = useState<Widget | null>(null);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // Initialise / reconcile the spec whenever the prepared dataset changes.
  const [specFor, setSpecFor] = useState<string | null>(null);
  useEffect(() => {
    if (!ds || specFor === ds.id) return;
    setSpec((current) => reconcile(current && (specFor === null || specFor === ds.id) ? current : defaultSpec(ds), ds));
    setSpecFor(ds.id);
  }, [ds, specFor]);

  const filters = spec?.filters ?? NO_FILTERS;
  const idx = useMemo(() => (ds ? applyFilters(ds, filters, { dateRange }) : null), [ds, filters, dateRange]);
  const built = useMemo(
    () => (ds && idx && spec ? buildChart({ ds, idx, spec, theme }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, idx, spec, theme, prefs.currency, prefs.compactNumbers]
  );

  if (listStatus === "ready" && datasets.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Analyze" title="Chart builder" />
        <Card>
          <EmptyState icon={<ChartColumn size={20} />} title="Upload data to start building" description="The chart builder works on your uploaded datasets." action={<Button onClick={() => openUpload()}>Upload a dataset</Button>} />
        </Card>
      </>
    );
  }

  const set = (patch: Partial<ChartSpec>) => setSpec((s) => (s ? { ...s, ...patch } : s));
  const setStyle = (patch: Partial<ChartStyle>) => setSpec((s) => (s ? { ...s, style: { ...s.style, ...patch } } : s));
  const changeType = (type: ChartType) => ds && spec && setSpec(reconcile({ ...spec, type, stacked: type === "area" || type === "bar" || type === "hbar" ? spec.stacked : false }, ds));
  const title = spec ? spec.title || autoTitle(spec, ds) : "";
  const req = spec ? requirements(spec.type) : null;
  const xIsDate = ds && spec ? ds.field(spec.x)?.role === "date" : false;
  const seriesNames: string[] = built && !built.empty ? ((built.kind === "pie" || built.kind === "doughnut" || built.kind === "polarArea" ? built.data.labels : built.data.datasets.map((d) => d.label)) as string[]).slice(0, 8) : [];
  const palette = paletteColors(spec?.style?.palette, theme);

  const askAI = async () => {
    if (!effectiveId || prompt.trim().length < 3 || !ds) return;
    setAsking(true);
    setAiNote(null);
    try {
      const res = await api<AskResponse>(`/api/datasets/${effectiveId}/ask`, { method: "POST", body: { question: prompt.trim() } });
      if (res.chart) {
        setSpec((s) => reconcile({ ...(s ?? defaultSpec(ds)), ...res.chart, y: res.chart?.y ?? [], agg: res.chart?.agg ?? "sum", style: s?.style, filters: s?.filters } as ChartSpec, ds));
        setAiNote(res.answer || "Chart updated.");
      } else setAiNote(res.answer || "The AI couldn't map that to a chart for this dataset.");
    } catch (err) {
      setAiNote(errorMessage(err));
    } finally {
      setAsking(false);
    }
  };

  const save = async () => {
    if (!spec || !effectiveId) return;
    const finalSpec = { ...spec, title };
    if (!editingDashboard) {
      setSaveWidget(chartWidget(effectiveId, finalSpec));
      return;
    }
    setSaving(true);
    try {
      if (editingWidget) {
        const current = await api<{ widgets: Widget[] }>(`/api/dashboards/${editingDashboard}`);
        const widgets = current.widgets.map((w) => (w.id === editingWidget ? ({ ...w, kind: "chart", datasetId: effectiveId, title, spec: finalSpec } as Widget) : w));
        await updateDashboard(editingDashboard, { widgets });
      } else {
        await addWidget(editingDashboard, chartWidget(effectiveId, finalSpec));
      }
      toast.success(editingWidget ? "Widget updated" : "Chart added to dashboard");
      navigate(`/app/dashboards/${editingDashboard}?edit=1`);
    } catch (err) {
      toast.error("Couldn't save to dashboard", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={editingDashboard ? (editingWidget ? "Editing dashboard widget" : "Adding to dashboard") : "Visual chart builder"}
        title="Chart builder"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await copyText(window.location.origin + builderUrl(effectiveId, spec ?? undefined));
                if (ok) toast.success("Link copied", "Anyone in your workspace with this dataset can open it.");
              }}
              disabled={!spec}
            >
              <Link2 size={14} /> Copy link
            </Button>
            <Button variant="ghost" size="sm" onClick={() => ds && setSpec(defaultSpec(ds))} disabled={!ds}>
              <RotateCcw size={14} /> Reset
            </Button>
            {editingDashboard && (
              <Button variant="secondary" size="sm" onClick={() => navigate(`/app/dashboards/${editingDashboard}`)}>
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={save} isLoading={saving} disabled={!spec || !built || built.empty} data-track="builder_save">
              {editingDashboard ? <Save size={14} /> : <LayoutDashboard size={14} />}
              {editingWidget ? "Update widget" : editingDashboard ? "Add to dashboard" : "Save to dashboard"}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Configuration */}
        <Card padded={false} className="self-start lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <Section title="Data">
            <DatasetPicker
              value={effectiveId}
              onChange={(id) => {
                setDatasetId(id);
                setSpecFor(null);
                setSpec(null);
                setDateRange({ preset: "all" });
              }}
              className="w-full"
            />
            <div>
              <Label htmlFor="ai-prompt">Describe a chart</Label>
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  void askAI();
                }}
              >
                <input
                  id="ai-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. monthly revenue by region"
                  maxLength={500}
                  className={`${inputClass} h-9 pl-8 pr-10`}
                  disabled={!ds}
                />
                <Sparkles size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                <button type="submit" disabled={asking || prompt.trim().length < 3} aria-label="Generate chart with AI" data-track="builder_ai" className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-volt text-volt-ink disabled:opacity-40">
                  {asking ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-volt-ink/30 border-t-volt-ink" /> : <ArrowUp size={14} />}
                </button>
              </form>
              {aiNote && <p className="mt-2 text-[12.5px] leading-snug text-ink-2">{aiNote}</p>}
            </div>
          </Section>

          {ds && spec && req && (
            <>
              <Section title="Chart type">
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Chart type">
                  {CHART_TYPES.map((t) => {
                    const Icon = TYPE_ICON[t.value];
                    const active = spec.type === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={t.hint}
                        onClick={() => changeType(t.value)}
                        data-track="builder_type"
                        data-track-type={t.value}
                        className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors ${active ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}
                      >
                        <Icon size={18} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="Fields">
                {req.x !== "none" && (
                  <div>
                    <Label htmlFor="f-x">{req.x === "measure" ? "X axis (metric)" : spec.type === "pie" || spec.type === "doughnut" || spec.type === "polarArea" ? "Slices" : spec.type === "radar" ? "Spokes" : "X axis / category"}</Label>
                    <FieldSelect id="f-x" ds={ds} value={spec.x} onChange={(x) => set({ x, bucket: ds.field(x)?.role === "date" ? spec.bucket ?? "auto" : undefined })} filter={(f) => (req.x === "measure" ? f.role === "measure" : f.role !== "measure")} placeholder="Choose a field" />
                  </div>
                )}
                <div>
                  <Label hint={req.maxY > 1 ? `up to ${req.maxY}` : undefined}>{spec.type === "histogram" ? "Metric to distribute" : req.x === "measure" ? "Y axis (metric)" : "Metrics"}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {spec.y.map((m) => (
                      <span key={m} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface-2 pl-2 pr-1 text-[12.5px] text-ink">
                        {ds.field(m)?.label ?? m}
                        {spec.y.length > req.minY && (
                          <button type="button" onClick={() => set({ y: spec.y.filter((x) => x !== m), agg: spec.y.length === 1 ? "count" : spec.agg })} className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`Remove ${m}`}>
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {spec.y.length < req.maxY && (
                    <div className="mt-2">
                      <FieldSelect
                        id="f-y"
                        ds={ds}
                        value=""
                        onChange={(m) => m && set({ y: [...spec.y, m], agg: spec.y.length === 0 && spec.agg === "count" ? naturalAgg(ds.field(m)) : spec.agg })}
                        filter={(f) => f.role === "measure" && !spec.y.includes(f.name) && f.name !== spec.x}
                        placeholder={spec.y.length ? "Add another metric" : spec.type === "histogram" ? "Choose a metric" : "Add a metric (or count rows)"}
                      />
                    </div>
                  )}
                </div>
                {spec.type !== "histogram" && spec.type !== "scatter" && spec.type !== "bubble" && (
                  <div>
                    <Label htmlFor="f-agg">Aggregation</Label>
                    <select id="f-agg" value={spec.agg} onChange={(e) => set({ agg: e.target.value as Aggregation })} className={`${inputClass} h-9`}>
                      {(spec.y.length ? ["sum", "avg", "median", "min", "max", "count", "distinct"] : ["count"]).map((a) => (
                        <option key={a} value={a}>
                          {AGG_LABEL[a]}
                          {a === "count" && !spec.y.length ? " of rows" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {req.size && (
                  <div>
                    <Label htmlFor="f-size">Bubble size</Label>
                    <FieldSelect id="f-size" ds={ds} value={spec.size} onChange={(size) => set({ size })} filter={(f) => f.role === "measure"} placeholder="Choose a metric" />
                  </div>
                )}
                {req.group && (
                  <div>
                    <Label htmlFor="f-group" hint={spec.groupBy && spec.y.length > 1 ? "uses first metric" : undefined}>
                      Split into series by
                    </Label>
                    <FieldSelect id="f-group" ds={ds} value={spec.groupBy} onChange={(groupBy) => set({ groupBy })} filter={(f) => (f.role === "dimension" || f.role === "identifier") && f.name !== spec.x} placeholder="No split" allowNone />
                  </div>
                )}
                {xIsDate && (
                  <div>
                    <Label htmlFor="f-bucket">Time grain</Label>
                    <select id="f-bucket" value={spec.bucket ?? "auto"} onChange={(e) => set({ bucket: e.target.value as DateBucket })} className={`${inputClass} h-9`}>
                      {["auto", "day", "week", "month", "quarter", "year"].map((b) => (
                        <option key={b} value={b}>
                          {b === "auto" ? "Automatic" : b[0].toUpperCase() + b.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {spec.type === "histogram" && (
                  <div>
                    <Label htmlFor="f-bins" hint="blank = automatic">Bins</Label>
                    <input id="f-bins" type="number" min={2} max={100} value={spec.bins ?? ""} onChange={(e) => set({ bins: e.target.value ? Math.max(2, Math.min(100, Number(e.target.value))) : undefined })} className={`${inputClass} h-9`} />
                  </div>
                )}
                {req.x === "category" && !xIsDate && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="f-sort">Sort</Label>
                      <select id="f-sort" value={spec.sort ?? "none"} onChange={(e) => set({ sort: e.target.value as SortMode })} className={`${inputClass} h-9`}>
                        <option value="none">Data order</option>
                        <option value="desc">Largest first</option>
                        <option value="asc">Smallest first</option>
                        <option value="label">A → Z</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="f-limit">Top N</Label>
                      <input id="f-limit" type="number" min={1} max={100} placeholder="All" value={spec.limit ?? ""} onChange={(e) => set({ limit: e.target.value ? Math.max(1, Math.min(100, Number(e.target.value))) : undefined })} className={`${inputClass} h-9`} />
                    </div>
                  </div>
                )}
              </Section>

              <Section title="Filters" aside={filters.length ? <Badge tone="brand">{filters.length}</Badge> : undefined}>
                <DateRangePicker value={dateRange} onChange={setDateRange} disabled={!ds.primaryDate} />
                <FilterBar ds={ds} filters={filters} onChange={(f: Filter[]) => set({ filters: f })} />
              </Section>

              <Section title="Style">
                <div>
                  <Label htmlFor="f-title">Title</Label>
                  <input id="f-title" value={spec.title ?? ""} placeholder={autoTitle(spec, ds)} onChange={(e) => set({ title: e.target.value || undefined })} className={`${inputClass} h-9`} maxLength={120} />
                </div>
                <div>
                  <Label>Palette</Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {PALETTE_OPTIONS.map((p) => {
                      const colors = paletteColors(p.value, theme);
                      const active = (spec.style?.palette ?? "signal") === p.value;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setStyle({ palette: p.value })}
                          aria-pressed={active}
                          className={`rounded-lg border p-1.5 text-[11px] ${active ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:border-line-strong"}`}
                        >
                          <span className="mb-1 flex h-3 overflow-hidden rounded-sm">
                            {colors.slice(0, 5).map((c) => (
                              <span key={c} className="flex-1" style={{ background: c }} />
                            ))}
                          </span>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {seriesNames.length > 0 && (
                  <div>
                    <Label hint={spec.style?.colors && Object.keys(spec.style.colors).length ? <button type="button" className="hover:text-ink" onClick={() => setStyle({ colors: undefined })}>Reset</button> : undefined}>Series colors</Label>
                    <ul className="space-y-1">
                      {seriesNames.map((name, i) => (
                        <li key={name} className="flex items-center gap-2 text-[12.5px]">
                          <input
                            type="color"
                            value={spec.style?.colors?.[name] ?? palette[i % palette.length]}
                            onChange={(e) => setStyle({ colors: { ...spec.style?.colors, [name]: e.target.value } })}
                            className="h-6 w-6 cursor-pointer rounded border border-line bg-transparent p-0"
                            aria-label={`Color for ${name}`}
                          />
                          <span className="truncate text-ink-2">{name}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-3">Palettes are tested for color-blind separation; custom colors may not be.</p>
                  </div>
                )}
                <div>
                  <Label>Legend</Label>
                  <Segmented
                    size="sm"
                    ariaLabel="Legend position"
                    value={(spec.style?.legend ?? "auto") as LegendPosition | "auto"}
                    onChange={(v) => setStyle({ legend: v === "auto" ? undefined : (v as LegendPosition) })}
                    options={[
                      { value: "auto", label: "Auto" },
                      { value: "top", label: "Top" },
                      { value: "bottom", label: "Bottom" },
                      { value: "right", label: "Right" },
                      { value: "none", label: "Off" },
                    ]}
                  />
                </div>
                <Switch label="Value labels" description="Selective: bar ends, line endpoints, slice shares" checked={Boolean(spec.style?.dataLabels)} onChange={(v) => setStyle({ dataLabels: v })} />
                <Switch label="Gridlines" checked={spec.style?.grid !== false} onChange={(v) => setStyle({ grid: v })} />
                {(spec.type === "line" || spec.type === "area") && <Switch label="Smooth lines" checked={spec.style?.smooth !== false} onChange={(v) => setStyle({ smooth: v })} />}
                {(spec.type === "bar" || spec.type === "hbar" || spec.type === "area") && (
                  <Switch label="Stack series" description={spec.groupBy || spec.y.length > 1 ? undefined : "Needs a split or several metrics"} checked={Boolean(spec.stacked)} onChange={(v) => set({ stacked: v })} disabled={!spec.groupBy && spec.y.length < 2} />
                )}
                {spec.type !== "pie" && spec.type !== "doughnut" && spec.type !== "polarArea" && spec.type !== "radar" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="f-xl">X axis title</Label>
                      <input id="f-xl" value={spec.style?.xLabel ?? ""} onChange={(e) => setStyle({ xLabel: e.target.value || undefined })} className={`${inputClass} h-8 text-[13px]`} placeholder="Auto" />
                    </div>
                    <div>
                      <Label htmlFor="f-yl">Y axis title</Label>
                      <input id="f-yl" value={spec.style?.yLabel ?? ""} onChange={(e) => setStyle({ yLabel: e.target.value || undefined })} className={`${inputClass} h-8 text-[13px]`} placeholder="Auto" />
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}
        </Card>

        {/* Preview */}
        <div className="min-w-0 space-y-4">
          {error ? (
            <Card>
              <ErrorState message={error} onRetry={retry} />
            </Card>
          ) : loading || !ds || !spec || !built || !idx ? (
            <Card>
              <PageLoader label="Loading dataset…" />
            </Card>
          ) : (
            <>
              <Card padded={false} className="flex flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h2>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {ds.name} · {idx.length.toLocaleString()} rows{filters.length || dateRange.preset !== "all" ? " after filters" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Segmented
                      size="sm"
                      ariaLabel="Preview mode"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "chart", label: <><ChartColumn size={13} /> Chart</> },
                        { value: "table", label: <><Table2 size={13} /> Table</> },
                      ]}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      title="Download PNG"
                      aria-label="Download PNG"
                      disabled={built.empty || view !== "chart"}
                      data-track="export_chart_png"
                      onClick={() => {
                        const url = chartRef.current?.toBase64Image("image/png", 1);
                        if (url) downloadDataUrl(url, safeFilename(title, "png"));
                      }}
                    >
                      <ImageDown size={16} />
                    </Button>
                    <Button variant="ghost" size="sm" iconOnly title="Download CSV" aria-label="Download CSV" disabled={built.empty} data-track="export_chart_csv" onClick={() => downloadTableCsv(built.table.headers, built.table.rows, safeFilename(title, "csv"))}>
                      <Download size={16} />
                    </Button>
                  </div>
                </div>
                <div className="h-[460px] p-4">{view === "chart" ? <ChartView ref={chartRef} built={built} onDrill={setDrill} trackName={title} /> : <TableFallback table={built.table} />}</div>
                {(built.notes.length > 0 || built.facts.length > 0) && (
                  <div className="space-y-1 border-t border-line px-5 py-3 text-[12.5px]">
                    {built.facts.map((f) => (
                      <p key={f} className="text-ink-2">
                        {f}
                      </p>
                    ))}
                    {built.notes.length > 0 && <p className="text-ink-3">{built.notes.join(" ")}</p>}
                  </div>
                )}
              </Card>
              <p className="text-xs text-ink-3">Tip: click any bar, point or slice to see the rows behind it.</p>
            </>
          )}
        </div>
      </div>

      <DrillDrawer ds={ds} base={idx} target={drill} onClose={() => setDrill(null)} onApplyFilters={(f) => set({ filters: [...filters, ...f] })} applyLabel="Add as chart filters" />
      <AddToDashboardDialog open={Boolean(saveWidget)} onClose={() => setSaveWidget(null)} widget={saveWidget} />
    </div>
  );
};
