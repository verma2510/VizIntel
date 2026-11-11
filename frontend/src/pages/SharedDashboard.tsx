import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock, Moon, Printer, Sun } from "lucide-react";
import { api, ApiError, errorMessage } from "../lib/api";
import { setPrefs, useResolvedTheme } from "../lib/prefs";
import { formatRelative } from "../lib/format";
import type { PreparedDataset } from "../lib/data/prepare";
import type { DrillTarget } from "../lib/chart/engine";
import type { DateRange, Filter, SharedDashboardPayload } from "../types";
import { useAuth } from "../context/Auth";
import { Logo } from "../components/brand/Logo";
import { Button, ButtonLink } from "../components/ui/Button";
import { Card, EmptyState, ErrorState, PageLoader } from "../components/ui/Surface";
import { DateRangePicker, FilterChips } from "../components/data/Filters";
import { DrillDrawer } from "../components/data/DrillDrawer";
import { DashboardCanvas, type DatasetState } from "../components/dashboard/DashboardCanvas";

/** Public, read-only view of a shared dashboard (no sign-in). Filters and drill-down are local only. */
export const SharedDashboard: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const theme = useResolvedTheme();
  const [payload, setPayload] = useState<SharedDashboardPayload | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [filters, setFilters] = useState<Filter[]>([]);
  const [drill, setDrill] = useState<{ ds: PreparedDataset; base: Uint32Array; target: DrillTarget } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api<SharedDashboardPayload>(`/api/public/dashboards/${encodeURIComponent(token)}`, { auth: false, signal: controller.signal })
      .then((p) => {
        setPayload(p);
        setDateRange(p.dashboard.filters?.dateRange ?? { preset: "all" });
        setFilters(p.dashboard.filters?.filters ?? []);
        document.title = `${p.dashboard.name} · VizIntel`;
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError({ status: err instanceof ApiError ? err.status : 0, message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [token, attempt]);

  const datasets = useMemo(() => {
    const map: Record<string, DatasetState> = {};
    if (!payload) return map;
    for (const d of payload.datasets) map[d._id] = { status: "ready", dataset: d };
    for (const w of payload.dashboard.widgets) if (w.datasetId && !map[w.datasetId]) map[w.datasetId] = { status: "missing" };
    return map;
  }, [payload]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="VizIntel">
            <Logo />
          </Link>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" iconOnly aria-label="Toggle theme" onClick={() => setPrefs({ theme: theme === "dark" ? "light" : "dark" })}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            {payload && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer size={14} /> PDF
              </Button>
            )}
            <ButtonLink to={user ? "/app" : "/register"} size="sm" data-track="shared_cta">
              {user ? "Open workspace" : "Try VizIntel"}
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-4 py-8 sm:px-6 lg:px-8">
        {error ? (
          <Card className="mx-auto max-w-xl">
            {error.status === 404 ? (
              <EmptyState icon={<Lock size={20} />} title="This link isn't available" description="The dashboard doesn't exist or its owner stopped sharing it." action={<ButtonLink to="/" variant="secondary" size="sm">Go to VizIntel</ButtonLink>} />
            ) : (
              <ErrorState
                message={error.message}
                onRetry={() => {
                  setError(null);
                  setAttempt((a) => a + 1);
                }}
              />
            )}
          </Card>
        ) : !payload ? (
          <PageLoader label="Loading shared dashboard…" />
        ) : (
          <>
            <div className="mb-6">
              <p className="vz-eyebrow mb-2">Shared dashboard · read-only</p>
              <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{payload.dashboard.name}</h1>
              {payload.dashboard.description && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{payload.dashboard.description}</p>}
              <p className="mt-2 text-xs text-ink-3">Updated {formatRelative(payload.dashboard.updatedAt)}</p>
            </div>
            {payload.dashboard.widgets.length === 0 ? (
              <Card>
                <EmptyState title="Nothing here yet" description="The owner hasn't added widgets to this dashboard." />
              </Card>
            ) : (
              <>
                <div className="no-print mb-5 flex flex-wrap items-center gap-2">
                  <DateRangePicker value={dateRange} onChange={setDateRange} />
                  <FilterChips filters={filters} onRemove={(id) => setFilters((f) => f.filter((x) => x.id !== id))} onClear={() => setFilters([])} />
                </div>
                <DashboardCanvas widgets={payload.dashboard.widgets} datasets={datasets} dateRange={dateRange} filters={filters} readOnly onDrill={(ds, base, target) => setDrill({ ds, base, target })} />
              </>
            )}
            <p className="mt-10 text-center text-xs text-ink-3">
              Made with{" "}
              <Link to="/" className="font-medium text-ink-2 hover:underline">
                VizIntel
              </Link>{" "}
              — AI-first analytics for spreadsheets.
            </p>
          </>
        )}
      </main>
      <DrillDrawer ds={drill?.ds ?? null} base={drill?.base ?? null} target={drill?.target ?? null} onClose={() => setDrill(null)} onApplyFilters={(f) => setFilters((cur) => [...cur, ...f])} applyLabel="Filter dashboard" readOnly />
    </div>
  );
};
