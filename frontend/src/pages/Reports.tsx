import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Braces, FileSpreadsheet, FileText, LayoutDashboard, Printer } from "lucide-react";
import { useData, useDataset } from "../context/Data";
import { useDashboards } from "../context/Dashboards";
import { useAuth } from "../context/Auth";
import { useWidgetDatasets } from "../hooks/useWidgetDatasets";
import { getPrepared } from "../lib/data/prepare";
import { applyFilters, describeDateRange } from "../lib/data/filters";
import { analyze, SIGNAL_LABEL } from "../lib/analysis";
import { downloadJson, downloadRowsCsv, safeFilename } from "../lib/export";
import { formatDate, formatInteger, formatMeasure, formatShare, AGG_LABEL } from "../lib/format";
import type { DateRange } from "../types";
import { Card, EmptyState, PageHeader, PageLoader, Segmented } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { Switch, Select } from "../components/ui/Field";
import { DatasetPicker } from "../components/data/DatasetPicker";
import { DateRangePicker } from "../components/data/Filters";
import { ChartCard } from "../components/charts/ChartCard";
import { AiNarrative } from "../components/insights/InsightsStatus";
import { DashboardCanvas } from "../components/dashboard/DashboardCanvas";

const SECTIONS = [
  { key: "kpis", label: "Key metrics" },
  { key: "narrative", label: "AI narrative" },
  { key: "signals", label: "Detected signals" },
  { key: "charts", label: "Recommended charts" },
  { key: "columns", label: "Column summary" },
  { key: "quality", label: "Data quality" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const ReportSection: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="print-break-avoid mt-10 first:mt-0">
    <h2 className="mb-4 flex items-baseline gap-3 border-b border-line pb-2 text-lg font-semibold tracking-tight text-ink">
      <span className="font-mono text-xs text-ink-3">{String(n).padStart(2, "0")}</span>
      {title}
    </h2>
    {children}
  </section>
);

const DatasetReport: React.FC<{ datasetId: string; dateRange: DateRange; sections: Record<SectionKey, boolean> }> = ({ datasetId, dateRange, sections }) => {
  const { user } = useAuth();
  const [preparedAt] = useState(() => Date.now());
  const { dataset, loading, error } = useDataset(datasetId);
  const ds = useMemo(() => (dataset?.originalData ? getPrepared(dataset) : null), [dataset]);
  const idx = useMemo(() => (ds ? applyFilters(ds, [], { dateRange }) : null), [ds, dateRange]);
  const analysis = useMemo(() => (ds && idx ? analyze(ds, idx, { kpiColumns: Object.keys(dataset?.kpis ?? {}) }) : null), [ds, idx, dataset?.kpis]);

  if (error) return <EmptyState title="Couldn't load this dataset" description={error} />;
  if (loading || !ds || !idx || !analysis || !dataset) return <PageLoader label="Preparing report…" />;

  const enabled = SECTIONS.filter((s) => sections[s.key]);
  return (
    <article id="report">
      <header className="mb-10 border-b border-line pb-8">
        <p className="vz-eyebrow">VizIntel analysis report</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">{dataset.name}</h1>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4">
          {[
            ["Rows analyzed", `${formatInteger(idx.length)}${idx.length !== ds.n ? ` of ${formatInteger(ds.n)}` : ""}`],
            ["Columns", formatInteger(ds.fields.length)],
            ["Period", describeDateRange(dateRange)],
            ["Prepared", `${formatDate(preparedAt, "long")}${user ? ` · ${user.name}` : ""}`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-3">{k}</dt>
              <dd className="mt-0.5 font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      {enabled.map((s, i) => {
        const n = i + 1;
        switch (s.key) {
          case "kpis":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                {analysis.kpis.length ? (
                  <table className="w-full text-[13.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-ink-3">
                        <th className="py-2 font-medium">Metric</th>
                        <th className="py-2 text-right font-medium">Value</th>
                        <th className="py-2 text-right font-medium">Latest period change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.kpis.map((k) => (
                        <tr key={k.column} className="border-b border-line last:border-0">
                          <td className="py-2 text-ink">
                            {AGG_LABEL[k.agg]} {k.label}
                          </td>
                          <td className="vz-num py-2 text-right font-medium text-ink">{formatMeasure(k.value, k.semanticType, { compact: false, percentIsFraction: k.percentIsFraction })}</td>
                          <td className="vz-num py-2 text-right text-ink-2">{k.delta !== null && k.delta !== undefined ? `${k.delta > 0 ? "+" : ""}${(k.delta * 100).toFixed(1)}% (${k.deltaLabel})` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[13px] text-ink-3">No numeric metrics detected.</p>
                )}
              </ReportSection>
            );
          case "narrative":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                {dataset.insightsStatus === "ready" && dataset.insights ? <AiNarrative insights={dataset.insights} /> : <p className="text-[13px] text-ink-3">The AI narrative is {dataset.insightsStatus === "pending" ? "still being generated" : "not available"}.</p>}
                <p className="mt-3 text-[11.5px] text-ink-3">Generated by AI from the full dataset's KPIs and column profile.</p>
              </ReportSection>
            );
          case "signals":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                {analysis.signals.length ? (
                  <ol className="space-y-3">
                    {analysis.signals.map((sig) => (
                      <li key={sig.id} className="print-break-avoid rounded-lg border border-line p-3.5">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{SIGNAL_LABEL[sig.kind]}</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{sig.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sig.detail}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-ink-3">No notable signals in this period.</p>
                )}
              </ReportSection>
            );
          case "charts":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
                  {analysis.recommendations.slice(0, 6).map((r) => (
                    <ChartCard key={r.id} ds={ds} idx={idx} spec={r.spec} height={220} subtitle={r.reason} />
                  ))}
                </div>
              </ReportSection>
            );
          case "columns":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th className="py-2 font-medium">Column</th>
                      <th className="py-2 font-medium">Type</th>
                      <th className="py-2 text-right font-medium">Missing</th>
                      <th className="py-2 text-right font-medium">Distinct</th>
                      <th className="py-2 pl-4 font-medium">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.profiles.map((p) => {
                      const f = ds.field(p.name)!;
                      const fmt = (v: number) => formatMeasure(v, f.semanticType, { percentIsFraction: f.semanticType === "percentage" && ds.percentIsFraction(f.name) });
                      return (
                        <tr key={p.name} className="border-b border-line last:border-0">
                          <td className="py-1.5 text-ink">{p.label}</td>
                          <td className="py-1.5 capitalize text-ink-2">{f.semanticType ?? p.role}</td>
                          <td className="vz-num py-1.5 text-right text-ink-2">{formatShare(p.count + p.missing ? p.missing / (p.count + p.missing) : 0)}</td>
                          <td className="vz-num py-1.5 text-right text-ink-2">{formatInteger(p.distinct)}</td>
                          <td className="py-1.5 pl-4 text-ink-2">
                            {p.numeric ? `${fmt(p.numeric.min)} – ${fmt(p.numeric.max)} · median ${fmt(p.numeric.median)}` : p.date ? `${formatDate(p.date.min)} – ${formatDate(p.date.max)}` : p.top?.[0] ? `Most common: ${p.top[0].value}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ReportSection>
            );
          case "quality":
            return (
              <ReportSection key={s.key} n={n} title={s.label}>
                <p className="text-sm text-ink">
                  Quality score <span className="font-semibold">{analysis.quality.score}/100</span>
                </p>
                {analysis.quality.issues.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                    {analysis.quality.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-2">No missing-value, duplicate or constant-column issues found.</p>
                )}
              </ReportSection>
            );
          default:
            return null;
        }
      })}
    </article>
  );
};

const DashboardReport: React.FC<{ dashboardId: string }> = ({ dashboardId }) => {
  const { dashboards } = useDashboards();
  const dashboard = dashboards.find((d) => d._id === dashboardId);
  const [preparedAt] = useState(() => Date.now());
  const states = useWidgetDatasets(dashboard?.widgets ?? []);
  if (!dashboard) return <EmptyState title="Dashboard not found" />;
  return (
    <article id="report">
      <header className="mb-8 border-b border-line pb-6">
        <p className="vz-eyebrow">VizIntel dashboard report</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">{dashboard.name}</h1>
        {dashboard.description && <p className="mt-2 text-sm text-ink-2">{dashboard.description}</p>}
        <p className="mt-3 text-[13px] text-ink-3">
          Prepared {formatDate(preparedAt, "long")} · {dashboard.widgets.length} widgets · period: {describeDateRange(dashboard.filters?.dateRange)}
        </p>
      </header>
      {dashboard.widgets.length ? <DashboardCanvas widgets={dashboard.widgets} datasets={states} dateRange={dashboard.filters?.dateRange} filters={dashboard.filters?.filters} /> : <EmptyState title="This dashboard has no widgets" />}
    </article>
  );
};

export const Reports: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const { datasets } = useData();
  const { dashboards } = useDashboards();
  const [source, setSource] = useState<"dataset" | "dashboard">(params.get("dashboard") ? "dashboard" : "dataset");
  const datasetId = params.get("dataset") ?? datasets[0]?._id;
  const dashboardId = params.get("dashboard") ?? dashboards[0]?._id;
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({ kpis: true, narrative: true, signals: true, charts: true, columns: true, quality: true });
  const { dataset } = useDataset(source === "dataset" ? datasetId : undefined);

  // Reset the period when the dataset changes (render-time reset, no effect needed).
  const [rangeFor, setRangeFor] = useState(datasetId);
  if (rangeFor !== datasetId) {
    setRangeFor(datasetId);
    setDateRange({ preset: "all" });
  }

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("dataset");
    next.delete("dashboard");
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const exportSummary = () => {
    if (!dataset?.originalData) return;
    const ds = getPrepared(dataset);
    const idx = applyFilters(ds, [], { dateRange });
    const a = analyze(ds, idx, { kpiColumns: Object.keys(dataset.kpis ?? {}) });
    downloadJson(
      {
        dataset: { id: dataset._id, name: dataset.name, rows: idx.length, columns: ds.fields.length, period: describeDateRange(dateRange) },
        generatedAt: new Date().toISOString(),
        kpis: a.kpis.map((k) => ({ column: k.column, label: k.label, agg: k.agg, value: k.value, latestChange: k.delta ?? null, latestChangeLabel: k.deltaLabel ?? null })),
        narrative: dataset.insightsStatus === "ready" ? dataset.insights : null,
        signals: a.signals.map((s) => ({ kind: s.kind, tone: s.tone, direction: s.direction ?? null, title: s.title, detail: s.detail, metric: s.metric ?? null, columns: s.columns })),
        correlations: a.correlations,
        quality: a.quality,
        columns: a.profiles,
      },
      safeFilename(`${dataset.name}-summary`, "json")
    );
  };

  return (
    <div className="animate-rise">
      <div className="no-print">
        <PageHeader eyebrow="Present" title="Reports & export" description="Compose a print-ready report, save it as PDF from the print dialog, or export the underlying data." />
        <Card className="mb-6 grid gap-5 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Report on</p>
              <Segmented
                ariaLabel="Report source"
                value={source}
                onChange={setSource}
                options={[
                  { value: "dataset", label: <><FileSpreadsheet size={14} /> Dataset</> },
                  { value: "dashboard", label: <><LayoutDashboard size={14} /> Dashboard</> },
                ]}
              />
            </div>
            {source === "dataset" ? (
              <>
                <div className="min-w-[240px]">
                  <p className="mb-1.5 text-[13px] font-medium text-ink-2">Dataset</p>
                  <DatasetPicker value={datasetId} onChange={(id) => setParam("dataset", id)} className="w-full" />
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-ink-2">Period</p>
                  <DateRangePicker value={dateRange} onChange={setDateRange} />
                </div>
              </>
            ) : (
              <div className="min-w-[240px]">
                <p className="mb-1.5 text-[13px] font-medium text-ink-2">Dashboard</p>
                <Select value={dashboardId ?? ""} onChange={(e) => setParam("dashboard", e.target.value)} options={dashboards.map((d) => ({ value: d._id, label: d.name }))} placeholder={dashboards.length ? undefined : "No dashboards yet"} aria-label="Dashboard" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={() => window.print()} data-track="report_print" disabled={source === "dataset" ? !datasetId : !dashboardId}>
              <Printer size={15} /> Print / Save PDF
            </Button>
            {source === "dataset" && (
              <>
                <Button
                  variant="secondary"
                  disabled={!dataset?.originalData}
                  data-track="report_export_csv"
                  onClick={() => {
                    if (!dataset?.originalData) return;
                    const ds = getPrepared(dataset);
                    downloadRowsCsv(ds.rows, ds.fields.map((f) => f.name), applyFilters(ds, [], { dateRange }), safeFilename(dataset.name, "csv"));
                  }}
                >
                  <FileText size={15} /> CSV
                </Button>
                <Button variant="secondary" disabled={!dataset?.originalData} onClick={exportSummary} data-track="report_export_json">
                  <Braces size={15} /> JSON summary
                </Button>
              </>
            )}
          </div>
          {source === "dataset" && (
            <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-6">
              {SECTIONS.map((s) => (
                <Switch key={s.key} label={s.label} checked={sections[s.key]} onChange={(v) => setSections((cur) => ({ ...cur, [s.key]: v }))} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="print-full mx-auto max-w-5xl p-6 sm:p-10 print:border-0 print:shadow-none">
        {source === "dataset" ? (
          datasetId ? <DatasetReport datasetId={datasetId} dateRange={dateRange} sections={sections} /> : <EmptyState title="No datasets yet" description="Upload a dataset to generate a report." />
        ) : dashboardId ? (
          <DashboardReport dashboardId={dashboardId} />
        ) : (
          <EmptyState title="No dashboards yet" description="Create a dashboard to export it as a report." />
        )}
      </Card>
    </div>
  );
};
