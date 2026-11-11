import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChartColumn, Check, CloudUpload, Database, FileSpreadsheet, LayoutDashboard, Plus, Share2, Sparkles, Table2 } from "lucide-react";
import { useAuth } from "../context/Auth";
import { useData } from "../context/Data";
import { useDashboards } from "../context/Dashboards";
import { useToast } from "../context/Toast";
import { useShell } from "../components/layout/AppShell";
import { api, errorMessage } from "../lib/api";
import { formatInteger, formatNumber, formatRelative } from "../lib/format";
import type { ActivitySummary, WorkspaceSummary } from "../types";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "../components/ui/Surface";
import { Button, ButtonLink } from "../components/ui/Button";
import { Dropzone } from "../components/data/Dropzone";
import { Sparkline } from "../components/charts/KpiCard";
import { AiNarrative, InsightsDot } from "../components/insights/InsightsStatus";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const StatTile: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ReactNode; loading?: boolean }> = ({ label, value, hint, icon, loading }) => (
  <Card className="flex flex-col gap-3">
    <div className="flex items-center justify-between text-[13px] text-ink-2">
      {label}
      <span className="text-ink-3">{icon}</span>
    </div>
    {loading ? <Skeleton className="h-7 w-24" /> : <p className="text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>}
    {hint && <div className="text-xs text-ink-3">{hint}</div>}
  </Card>
);

export const Workspace: React.FC = () => {
  const { user } = useAuth();
  const { datasets, status } = useData();
  const { dashboards, create } = useDashboards();
  const { openUpload } = useShell();
  const toast = useToast();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<WorkspaceSummary>("/api/analytics/summary", { signal: controller.signal }).then(setSummary).catch(() => {});
    api<ActivitySummary>("/api/activity/summary?days=7", { signal: controller.signal }).then(setActivity).catch(() => {});
    return () => controller.abort();
  }, [datasets.length]);

  const newDashboard = async () => {
    try {
      const d = await create({ name: "Untitled dashboard" });
      navigate(`/app/dashboards/${d._id}?edit=1`);
    } catch (err) {
      toast.error("Couldn't create dashboard", errorMessage(err));
    }
  };

  const latestWithInsights = datasets.find((d) => d.insightsStatus === "ready" && d.insights && !d.insights.startsWith("Failed to generate"));
  const interactions = activity ? activity.totals.pageViews + activity.totals.clicks + activity.totals.searches : null;
  const steps = [
    { done: datasets.length > 0, label: "Upload your first dataset", action: () => openUpload() },
    { done: Boolean(latestWithInsights), label: "Review AI insights", to: datasets[0] ? `/app/insights/${datasets[0]._id}` : undefined },
    { done: dashboards.some((d) => d.widgets.length > 0), label: "Build a chart into a dashboard", to: "/app/builder" },
    { done: dashboards.some((d) => d.isShared), label: "Share a dashboard link", to: "/app/dashboards" },
  ];
  const completed = steps.filter((s) => s.done).length;
  const firstName = user?.name?.split(" ")[0] ?? "there";

  if (status === "ready" && datasets.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Welcome" title={`${greeting()}, ${firstName}`} description="Upload a spreadsheet to get KPIs, charts, AI insights and anomaly detection automatically." />
        <Card className="p-2">
          <Dropzone onFile={(file) => openUpload(file)} />
        </Card>
        <p className="mt-3 text-center text-xs text-ink-3">
          Prefer the full dialog?{" "}
          <button type="button" onClick={() => openUpload()} className="text-brand-ink hover:underline">
            Open the uploader
          </button>
        </p>
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Sparkles, t: "AI insights", d: "A written briefing plus trends, anomalies and correlations." },
            { icon: ChartColumn, t: "Chart builder", d: "Eleven chart types with filters, splits and drill-down." },
            { icon: LayoutDashboard, t: "Dashboards", d: "Arrange, resize, cross-filter and share read-only links." },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-line bg-surface p-4">
              <f.icon size={18} className="text-brand" />
              <p className="mt-3 text-sm font-medium text-ink">{f.t}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        title={`${greeting()}, ${firstName}`}
        description="Here's what's happening across your data."
        actions={
          <>
            <Button variant="secondary" onClick={newDashboard} data-track="home_new_dashboard">
              <Plus size={15} /> New dashboard
            </Button>
            <Button onClick={() => openUpload()} data-track="home_upload">
              <CloudUpload size={15} /> Upload data
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Datasets" icon={<Database size={16} />} value={formatInteger(summary?.totalDatasets ?? datasets.length)} loading={status === "loading"} hint={datasets[0] ? `Latest ${formatRelative(datasets[0].createdAt)}` : undefined} />
        <StatTile label="Rows analyzed" icon={<Table2 size={16} />} value={summary ? formatNumber(summary.totalRowsProcessed) : "—"} loading={!summary} hint="Across all uploads" />
        <StatTile label="Dashboards" icon={<LayoutDashboard size={16} />} value={formatInteger(dashboards.length)} hint={`${dashboards.filter((d) => d.isShared).length} shared`} />
        <StatTile
          label="Interactions · 7 days"
          icon={<Sparkles size={16} />}
          value={interactions === null ? "—" : formatInteger(interactions)}
          loading={!activity}
          hint={activity?.series && activity.series.length > 1 ? <Sparkline values={activity.series.map((s) => s.pageViews + s.clicks + s.searches)} height={22} className="w-full" /> : "Page views, clicks and searches"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card padded={false} className="xl:col-span-2">
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Recent datasets</h2>
            <Link to="/app/data" className="flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
              All data <ArrowRight size={14} />
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {status === "loading" &&
              [0, 1, 2].map((i) => (
                <li key={i} className="px-5 py-3.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </li>
              ))}
            {datasets.slice(0, 6).map((d) => (
              <li key={d._id} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-brand">
                  <FileSpreadsheet size={17} />
                </span>
                <Link to={`/app/insights/${d._id}`} className="min-w-0 flex-1" data-track="home_open_dataset" data-track-dataset-id={d._id}>
                  <p className="truncate text-sm font-medium text-ink">{d.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                    <InsightsDot status={d.insightsStatus} />
                    {formatInteger(d.rowCount ?? 0)} rows · {formatInteger(d.columnCount ?? d.columns?.length ?? 0)} columns · {formatRelative(d.createdAt)}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                  <ButtonLink to={`/app/explore/${d._id}`} variant="ghost" size="xs" iconOnly aria-label={`Explore ${d.name}`} title="Explore">
                    <Table2 size={15} />
                  </ButtonLink>
                  <ButtonLink to={`/app/builder?dataset=${d._id}`} variant="ghost" size="xs" iconOnly aria-label={`Build a chart from ${d.name}`} title="Build chart">
                    <ChartColumn size={15} />
                  </ButtonLink>
                  <ButtonLink to={`/app/insights/${d._id}`} variant="ghost" size="xs" iconOnly aria-label={`Insights for ${d.name}`} title="Insights">
                    <Sparkles size={15} />
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="vz-ai-ring">
            <CardHeader
              eyebrow="Latest AI briefing"
              title={latestWithInsights?.name ?? "No briefing yet"}
              actions={<Badge tone="ai">AI</Badge>}
            />
            {latestWithInsights ? (
              <>
                <div className="max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                  <AiNarrative insights={latestWithInsights.insights!} compact />
                </div>
                <ButtonLink to={`/app/insights/${latestWithInsights._id}`} variant="secondary" size="sm" className="mt-3 w-full">
                  Read full analysis <ArrowRight size={14} />
                </ButtonLink>
              </>
            ) : (
              <p className="text-[13px] text-ink-3">
                {datasets.some((d) => d.insightsStatus === "pending") ? "Insights are being generated for your latest upload." : "Insights appear here once a dataset has been analyzed."}
              </p>
            )}
          </Card>

          {completed < steps.length && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold tracking-tight">Get set up</h2>
                <span className="vz-num text-xs text-ink-3">
                  {completed}/{steps.length}
                </span>
              </div>
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(completed / steps.length) * 100}%` }} />
              </div>
              <ul className="space-y-1">
                {steps.map((s) => {
                  const content = (
                    <>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${s.done ? "border-brand bg-brand text-white" : "border-line-strong"}`}>{s.done && <Check size={12} />}</span>
                      <span className={`flex-1 ${s.done ? "text-ink-3 line-through" : "text-ink"}`}>{s.label}</span>
                      {!s.done && <ArrowRight size={14} className="text-ink-3" />}
                    </>
                  );
                  const cls = "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-3";
                  return (
                    <li key={s.label}>
                      {s.to ? (
                        <Link to={s.to} className={cls}>
                          {content}
                        </Link>
                      ) : (
                        <button type="button" onClick={s.action} className={cls}>
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">Dashboards</h2>
          <Link to="/app/dashboards" className="flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
            All dashboards <ArrowRight size={14} />
          </Link>
        </div>
        {dashboards.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon={<LayoutDashboard size={18} />}
              title="No dashboards yet"
              description="Compose charts, KPIs, tables and AI summaries into a dashboard you can arrange and share."
              action={
                <Button size="sm" onClick={newDashboard}>
                  <Plus size={14} /> Create dashboard
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dashboards.slice(0, 4).map((d) => (
              <Link key={d._id} to={`/app/dashboards/${d._id}`} className="group rounded-xl border border-line bg-surface p-4 shadow-card-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card">
                <div className="mb-3 grid h-16 grid-cols-6 gap-1" aria-hidden="true">
                  {(d.widgets.length ? d.widgets.slice(0, 6) : [{ w: 12 }]).map((w, i) => (
                    <span key={i} className="rounded bg-surface-3 group-hover:bg-brand-soft" style={{ gridColumn: `span ${Math.max(1, Math.round(((w as { w: number }).w / 12) * 6))}` }} />
                  ))}
                </div>
                <p className="truncate text-sm font-medium text-ink">{d.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                  {d.widgets.length} widgets · {formatRelative(d.updatedAt)}
                  {d.isShared && (
                    <span className="inline-flex items-center gap-0.5 text-brand-ink">
                      <Share2 size={11} /> shared
                    </span>
                  )}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
