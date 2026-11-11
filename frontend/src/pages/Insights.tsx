import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChartColumn, FileText, LayoutDashboard, RefreshCw, ShieldCheck, Sparkles, Table2 } from "lucide-react";
import { useActiveDataset } from "../hooks/useActiveDataset";
import { useData } from "../context/Data";
import { useToast } from "../context/Toast";
import { useShell } from "../components/layout/AppShell";
import { analyze, type Signal, type SignalKind } from "../lib/analysis";
import { applyFilters, newId } from "../lib/data/filters";
import type { DrillTarget } from "../lib/chart/engine";
import { builderUrl } from "../lib/spec";
import { errorMessage } from "../lib/api";
import { formatInteger, formatRelative } from "../lib/format";
import type { DateRange, Filter, Widget } from "../types";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader, Segmented } from "../components/ui/Surface";
import { Button, ButtonLink } from "../components/ui/Button";
import { Drawer } from "../components/ui/Overlay";
import { DatasetPicker } from "../components/data/DatasetPicker";
import { DateRangePicker, FilterBar } from "../components/data/Filters";
import { DataTable } from "../components/data/DataTable";
import { DrillDrawer } from "../components/data/DrillDrawer";
import { KpiCard } from "../components/charts/KpiCard";
import { ChartCard } from "../components/charts/ChartCard";
import { AiNarrative, InsightsFailed, InsightsPending } from "../components/insights/InsightsStatus";
import { SignalCard } from "../components/insights/SignalCard";
import { CorrelationMatrix } from "../components/insights/CorrelationMatrix";
import { AskAI } from "../components/insights/AskAI";
import { AddToDashboardDialog } from "../components/dashboard/AddToDashboardDialog";

type KindFilter = "all" | "trends" | "anomalies" | "relationships" | "composition" | "quality";
const KIND_GROUPS: Record<Exclude<KindFilter, "all">, SignalKind[]> = {
  trends: ["trend", "change"],
  anomalies: ["anomaly", "outlier", "distribution"],
  relationships: ["correlation", "segment"],
  composition: ["concentration"],
  quality: ["quality"],
};

const INSIGHTS_FALLBACK = "Failed to generate AI insights";
const KPI_COLS: Record<number, string> = { 1: "", 2: "", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-3 2xl:grid-cols-5", 6: "xl:grid-cols-3 2xl:grid-cols-6" };

export const Insights: React.FC = () => {
  const { id, dataset, meta, prepared: ds, loading, error, retry, hasDatasets, listStatus, select } = useActiveDataset("/app/insights");
  const { regenerateInsights } = useData();
  const { openUpload } = useShell();
  const toast = useToast();
  const location = useLocation();
  const [filters, setFilters] = useState<Filter[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [kind, setKind] = useState<KindFilter>("all");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [rowsSignal, setRowsSignal] = useState<Signal | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [widget, setWidget] = useState<Widget | null>(null);

  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    setFilters([]);
    setDateRange({ preset: "all" });
  }

  const idx = useMemo(() => (ds ? applyFilters(ds, filters, { dateRange }) : null), [ds, filters, dateRange]);
  const kpiColumns = useMemo(() => Object.keys(dataset?.kpis ?? {}), [dataset?.kpis]);
  const analysis = useMemo(() => (ds && idx ? analyze(ds, idx, { kpiColumns }) : null), [ds, idx, kpiColumns]);

  useEffect(() => {
    if (location.hash === "#ask" && analysis) document.getElementById("ask")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, analysis]);

  if (listStatus === "ready" && !hasDatasets) {
    return (
      <>
        <PageHeader eyebrow="Analyze" title="AI insights" />
        <Card>
          <EmptyState icon={<Sparkles size={20} />} title="Upload data to get insights" description="VizIntel detects KPIs, trends, anomalies, outliers and correlations, and writes an AI briefing for every dataset." action={<Button onClick={() => openUpload()}>Upload a dataset</Button>} />
        </Card>
      </>
    );
  }

  const status = meta?.insightsStatus ?? dataset?.insightsStatus ?? "ready";
  const narrative = meta?.insights ?? dataset?.insights ?? "";
  const narrativeFailed = status === "failed" || narrative.startsWith(INSIGHTS_FALLBACK);
  const signals = analysis?.signals.filter((s) => kind === "all" || KIND_GROUPS[kind].includes(s.kind)) ?? [];
  const filteredView = filters.length > 0 || dateRange.preset !== "all";

  const onRetry = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      await regenerateInsights(id);
      toast.info("Regenerating insights", "This usually takes a few seconds.");
    } catch (err) {
      toast.error("Could not restart insight generation", errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="AI insights"
        title={<DatasetPicker value={id} onChange={select} className="max-w-[min(520px,80vw)]" />}
        description={meta ? `${formatInteger(meta.rowCount ?? 0)} rows · ${formatInteger(meta.columnCount ?? meta.columns?.length ?? 0)} columns · uploaded ${formatRelative(meta.createdAt)}` : undefined}
        actions={
          id && (
            <>
              <ButtonLink to={`/app/explore/${id}`} variant="secondary" size="sm">
                <Table2 size={14} /> Explore
              </ButtonLink>
              <ButtonLink to={`/app/reports?dataset=${id}`} variant="secondary" size="sm">
                <FileText size={14} /> Report
              </ButtonLink>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setWidget({ id: newId("w"), kind: "insights", title: `AI insights · ${meta?.name ?? "dataset"}`, datasetId: id, spec: {}, w: 6, h: 4 })}
              >
                <LayoutDashboard size={14} /> Add to dashboard
              </Button>
            </>
          )
        }
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={retry} />
        </Card>
      ) : loading || !ds || !idx || !analysis ? (
        <PageLoader label="Analyzing your data…" />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <DateRangePicker value={dateRange} onChange={setDateRange} disabled={!ds.primaryDate} hint={ds.primaryDate ? `Filters on ${ds.primaryDate.label}` : undefined} />
            <FilterBar ds={ds} filters={filters} onChange={setFilters} />
            {filteredView && (
              <span className="text-[13px] text-ink-3">
                Analyzing <span className="vz-num font-medium text-ink">{formatInteger(idx.length)}</span> of {formatInteger(ds.n)} rows
              </span>
            )}
          </div>

          {analysis.kpis.length > 0 ? (
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${KPI_COLS[Math.min(analysis.kpis.length, 6)]}`}>
              {analysis.kpis.map((k) => (
                <KpiCard key={k.column} kpi={k} />
              ))}
            </div>
          ) : (
            <Card className="text-[13px] text-ink-3">No numeric metric columns were detected, so there are no KPI totals. Category and date analysis is below.</Card>
          )}

          <div className="mt-6 grid gap-6 xl:grid-cols-5">
            <Card className="vz-ai-ring xl:col-span-3">
              <CardHeader
                eyebrow="AI narrative"
                title="Executive briefing"
                description={filteredView ? "Written for the full dataset (filters don't apply to the narrative)." : "Written by the AI from the dataset's KPIs and column profile."}
                actions={
                  <>
                    <Badge tone="ai">AI</Badge>
                    {status !== "pending" && (
                      <Button variant="ghost" size="xs" iconOnly onClick={onRetry} isLoading={retrying} aria-label="Regenerate narrative" title="Regenerate" data-track="insights_regenerate">
                        {!retrying && <RefreshCw size={14} />}
                      </Button>
                    )}
                  </>
                }
              />
              {status === "pending" ? <InsightsPending /> : narrativeFailed ? <InsightsFailed onRetry={onRetry} retrying={retrying} /> : narrative ? <AiNarrative insights={narrative} /> : <p className="text-[13px] text-ink-3">No narrative yet.</p>}
            </Card>

            <Card id="ask" className="scroll-mt-20 xl:col-span-2">
              <CardHeader eyebrow="Ask AI" title="Ask your data" description="Plain-English questions become charts computed from your rows." />
              <AskAI ds={ds} idx={idx} onDrill={setDrill} />
            </Card>
          </div>

          <section className="mt-10" aria-labelledby="signals-heading">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="vz-eyebrow mb-1">Automated analysis</p>
                <h2 id="signals-heading" className="text-lg font-semibold tracking-tight">
                  {analysis.signals.length} signals detected
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-3">Deterministic statistics over {filteredView ? "the filtered" : "all"} rows — each links to the chart that shows it.</p>
              </div>
              <Segmented
                ariaLabel="Signal type"
                size="sm"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "all", label: "All" },
                  { value: "trends", label: "Trends" },
                  { value: "anomalies", label: "Anomalies" },
                  { value: "relationships", label: "Relationships" },
                  { value: "composition", label: "Composition" },
                  { value: "quality", label: "Quality" },
                ]}
              />
            </div>
            {signals.length ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {signals.map((s, i) => (
                  <SignalCard key={s.id} signal={s} ds={ds} idx={idx} showChart={i < 9} onDrill={setDrill} onViewRows={setRowsSignal} />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState compact icon={<ShieldCheck size={18} />} title="Nothing notable here" description={kind === "all" ? "No strong trends, anomalies or concentrations were found in these rows." : "No signals of this type in these rows."} />
              </Card>
            )}
          </section>

          <div className="mt-10 grid gap-6 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader eyebrow="Relationships" title="Correlation matrix" description="Pearson r between numeric columns. Click a cell to plot the pair." />
              <CorrelationMatrix ds={ds} correlations={analysis.correlations} />
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader eyebrow="Data quality" title={`Quality score: ${analysis.quality.score}/100`} description="Missing values, constant columns and duplicate rows." />
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={analysis.quality.score} aria-valuemin={0} aria-valuemax={100} aria-label="Data quality score">
                <div className="h-full rounded-full bg-brand" style={{ width: `${analysis.quality.score}%` }} />
              </div>
              {analysis.quality.issues.length ? (
                <ul className="space-y-2">
                  {analysis.quality.issues.slice(0, 8).map((issue) => (
                    <li key={issue} className="flex gap-2 text-[13px] text-ink-2">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-ink-2">
                  <ShieldCheck size={16} className="text-good" /> No missing-value, duplicate or constant-column issues found.
                </p>
              )}
            </Card>
          </div>

          <section className="mt-10" aria-labelledby="recs-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="vz-eyebrow mb-1">Recommended visualizations</p>
                <h2 id="recs-heading" className="text-lg font-semibold tracking-tight">
                  Charts that fit this data
                </h2>
              </div>
              <ButtonLink to={builderUrl(id)} variant="secondary" size="sm">
                <ChartColumn size={14} /> Build your own
              </ButtonLink>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {analysis.recommendations.map((r) => (
                <ChartCard key={r.id} ds={ds} idx={idx} spec={r.spec} height={240} onDrill={setDrill} subtitle={r.reason} />
              ))}
            </div>
          </section>

          <DrillDrawer ds={ds} base={idx} target={drill} onClose={() => setDrill(null)} onApplyFilters={(f) => setFilters((cur) => [...cur, ...f])} applyLabel="Filter this analysis" />
          <Drawer open={Boolean(rowsSignal)} onClose={() => setRowsSignal(null)} title={rowsSignal?.title ?? ""} description="Most extreme rows first" width="max-w-3xl">
            {rowsSignal?.rows && <DataTable ds={ds} idx={Uint32Array.from(rowsSignal.rows)} pageSize={25} highlight={rowsSignal.columns[0]} dense />}
          </Drawer>
        </>
      )}
      <AddToDashboardDialog open={Boolean(widget)} onClose={() => setWidget(null)} widget={widget} />
    </div>
  );
};
