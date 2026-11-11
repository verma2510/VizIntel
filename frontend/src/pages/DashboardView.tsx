import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, CloudOff, Copy, Eye, Globe, LayoutDashboard, LoaderCircle, Pencil, Plus, Printer, Share2 } from "lucide-react";
import { useDashboards } from "../context/Dashboards";
import { useData } from "../context/Data";
import { useToast } from "../context/Toast";
import { useWidgetDatasets } from "../hooks/useWidgetDatasets";
import { api, ApiError, errorMessage } from "../lib/api";
import type { PreparedDataset } from "../lib/data/prepare";
import type { DrillTarget } from "../lib/chart/engine";
import { builderUrl } from "../lib/spec";
import { formatRelative } from "../lib/format";
import type { Dashboard, DateRange, Filter, Widget } from "../types";
import { Badge, Card, EmptyState, ErrorState, PageLoader } from "../components/ui/Surface";
import { Button, ButtonLink } from "../components/ui/Button";
import { MenuItem, Popover } from "../components/ui/Overlay";
import { DateRangePicker, FilterChips } from "../components/data/Filters";
import { DrillDrawer } from "../components/data/DrillDrawer";
import { DashboardCanvas } from "../components/dashboard/DashboardCanvas";
import { WidgetDialog } from "../components/dashboard/WidgetDialog";
import { ShareDialog } from "../components/dashboard/ShareDialog";

type SaveState = "saved" | "dirty" | "saving" | "error";
const AUTOSAVE_MS = 800;

export const DashboardView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { update, duplicate, upsertLocal } = useDashboards();
  const { regenerateInsights } = useData();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [widgetDialog, setWidgetDialog] = useState<{ open: boolean; editing: Widget | null }>({ open: false, editing: null });
  const [shareOpen, setShareOpen] = useState(false);
  const [drill, setDrill] = useState<{ ds: PreparedDataset; base: Uint32Array; target: DrillTarget } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<Partial<Dashboard> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      setDashboard(await api<Dashboard>(`/api/dashboards/${id}`));
    } catch (err) {
      setLoadError({ message: errorMessage(err), status: err instanceof ApiError ? err.status : 0 });
    }
  }, [id]);

  useEffect(() => {
    setDashboard(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get("edit")) {
      const next = new URLSearchParams(params);
      next.delete("edit");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    if (!id || !pending.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const patch = pending.current;
    pending.current = null;
    setSaveState("saving");
    try {
      const saved = await update(id, patch as Parameters<typeof update>[1]);
      upsertLocal(saved);
      setDashboard((d) => (d ? { ...d, updatedAt: saved.updatedAt } : d));
      setSaveState(pending.current ? "dirty" : "saved");
    } catch (err) {
      pending.current = { ...patch, ...(pending.current ?? {}) };
      setSaveState("error");
      toast.error("Changes not saved", errorMessage(err));
    }
  }, [id, update, upsertLocal, toast]);

  /** Applies a change locally and schedules an autosave. */
  const change = (patch: Partial<Pick<Dashboard, "name" | "description" | "widgets" | "filters">>) => {
    setDashboard((d) => (d ? { ...d, ...patch } : d));
    pending.current = { ...(pending.current ?? {}), ...patch };
    setSaveState("dirty");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  // Save before leaving the page.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (pending.current) void flush();
    };
  }, [flush]);

  const widgets = dashboard?.widgets ?? [];
  const datasetStates = useWidgetDatasets(widgets);

  // View filters start from the saved defaults; in edit mode they are saved back as the new defaults.
  const [dateRange, setDateRange] = useState<DateRange>({ preset: "all" });
  const [crossFilters, setCrossFilters] = useState<Filter[]>([]);
  const [initialised, setInitialised] = useState<string | null>(null);
  if (dashboard && initialised !== dashboard._id) {
    setInitialised(dashboard._id);
    setDateRange(dashboard.filters?.dateRange ?? { preset: "all" });
    setCrossFilters(dashboard.filters?.filters ?? []);
  }
  const setViewFilters = (range: DateRange, filters: Filter[]) => {
    setDateRange(range);
    setCrossFilters(filters);
    if (editing) change({ filters: { dateRange: range, filters } });
  };

  if (loadError) {
    return (
      <Card>
        <ErrorState title={loadError.status === 404 ? "Dashboard not found" : "Couldn't load dashboard"} message={loadError.status === 404 ? "It may have been deleted." : loadError.message} onRetry={loadError.status === 404 ? undefined : load} />
        <div className="pb-8 text-center">
          <ButtonLink to="/app/dashboards" variant="secondary" size="sm">
            <ArrowLeft size={14} /> All dashboards
          </ButtonLink>
        </div>
      </Card>
    );
  }
  if (!dashboard) return <PageLoader label="Loading dashboard…" />;

  const editWidget = async (w: Widget) => {
    if (w.kind === "chart") {
      await flush();
      navigate(builderUrl(w.datasetId, { ...w.spec, title: w.title || w.spec.title }, { dashboard: dashboard._id, widget: w.id }));
    } else setWidgetDialog({ open: true, editing: w });
  };

  const saveIndicator = {
    saved: { icon: <Check size={13} />, text: `Saved ${formatRelative(dashboard.updatedAt)}` },
    dirty: { icon: <LoaderCircle size={13} className="opacity-50" />, text: "Unsaved changes" },
    saving: { icon: <LoaderCircle size={13} className="animate-spin" />, text: "Saving…" },
    error: { icon: <CloudOff size={13} className="text-bad" />, text: "Not saved" },
  }[saveState];

  return (
    <div className="animate-rise print-full">
      <div className="no-print mb-3">
        <Link to="/app/dashboards" className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft size={14} /> Dashboards
        </Link>
      </div>

      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <input
                value={dashboard.name}
                onChange={(e) => change({ name: e.target.value })}
                onBlur={() => !dashboard.name.trim() && change({ name: "Untitled dashboard" })}
                maxLength={120}
                aria-label="Dashboard name"
                className="w-full rounded-lg border border-transparent bg-transparent px-1 -ml-1 text-2xl font-semibold tracking-tight text-ink outline-none hover:border-line focus:border-brand sm:text-[28px]"
              />
              <input
                value={dashboard.description}
                onChange={(e) => change({ description: e.target.value })}
                placeholder="Add a description…"
                maxLength={500}
                aria-label="Dashboard description"
                className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 -ml-1 text-sm text-ink-2 outline-none placeholder:text-ink-3 hover:border-line focus:border-brand"
              />
            </>
          ) : (
            <>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
                {dashboard.name}
                {dashboard.isShared && (
                  <Badge tone="brand" icon={<Globe size={11} />}>
                    Shared
                  </Badge>
                )}
              </h1>
              {dashboard.description && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{dashboard.description}</p>}
            </>
          )}
          <p className="no-print mt-2 flex items-center gap-1.5 text-xs text-ink-3" aria-live="polite">
            {saveIndicator.icon} {saveIndicator.text}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setWidgetDialog({ open: true, editing: null })} data-track="dashboard_add_widget">
                <Plus size={14} /> Add widget
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await flush();
                  setEditing(false);
                }}
                data-track="dashboard_done"
              >
                <Eye size={14} /> Done editing
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => window.print()} data-track="dashboard_print">
                <Printer size={14} /> PDF
              </Button>
              <Popover
                align="end"
                width={200}
                trigger={({ toggle, ref }) => (
                  <Button ref={ref} variant="ghost" size="sm" onClick={toggle}>
                    More
                  </Button>
                )}
              >
                {(close) => (
                  <MenuItem
                    icon={<Copy size={15} />}
                    onClick={async () => {
                      close();
                      try {
                        const copy = await duplicate(dashboard._id);
                        navigate(`/app/dashboards/${copy._id}`);
                        toast.success("Dashboard duplicated");
                      } catch (err) {
                        toast.error("Duplicate failed", errorMessage(err));
                      }
                    }}
                  >
                    Duplicate
                  </MenuItem>
                )}
              </Popover>
              <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)} data-track="dashboard_share">
                <Share2 size={14} /> Share
              </Button>
              <Button size="sm" onClick={() => setEditing(true)} data-track="dashboard_edit">
                <Pencil size={14} /> Edit
              </Button>
            </>
          )}
        </div>
      </header>

      {widgets.length > 0 && (
        <div className="no-print mb-5 flex flex-wrap items-center gap-2">
          <DateRangePicker value={dateRange} onChange={(r) => setViewFilters(r, crossFilters)} hint="Applies to every widget whose dataset has a date column" />
          <FilterChips filters={crossFilters} onRemove={(fid) => setViewFilters(dateRange, crossFilters.filter((f) => f.id !== fid))} onClear={() => setViewFilters(dateRange, [])} />
          {!crossFilters.length && <span className="text-xs text-ink-3">Click any chart element to drill down or cross-filter.</span>}
        </div>
      )}

      {widgets.length === 0 ? (
        <Card className="border-dashed">
          <EmptyState
            icon={<LayoutDashboard size={20} />}
            title="This dashboard is empty"
            description="Add charts (recommended or custom), KPI tiles, tables, AI summaries and notes. Drag to rearrange and resize in edit mode."
            action={
              <Button
                onClick={() => {
                  setEditing(true);
                  setWidgetDialog({ open: true, editing: null });
                }}
              >
                <Plus size={15} /> Add your first widget
              </Button>
            }
          />
        </Card>
      ) : (
        <DashboardCanvas
          widgets={widgets}
          datasets={datasetStates}
          dateRange={dateRange}
          filters={crossFilters}
          editable={editing}
          onChange={(next) => change({ widgets: next })}
          onEditWidget={editWidget}
          onDrill={(ds, base, target) => setDrill({ ds, base, target })}
          onRetryInsights={(datasetId) => regenerateInsights(datasetId).catch((err) => toast.error("Retry failed", errorMessage(err)))}
        />
      )}

      {editing && widgets.length > 0 && (
        <button
          type="button"
          onClick={() => setWidgetDialog({ open: true, editing: null })}
          className="no-print mt-4 flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm text-ink-3 transition-colors hover:border-brand hover:text-brand-ink"
        >
          <Plus size={16} /> Add widget
        </button>
      )}

      <WidgetDialog
        open={widgetDialog.open}
        editing={widgetDialog.editing}
        onClose={() => setWidgetDialog({ open: false, editing: null })}
        defaultDatasetId={widgets.find((w) => w.datasetId)?.datasetId ?? undefined}
        onSubmit={(w) => change({ widgets: widgetDialog.editing ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, w] })}
        onBuildCustomChart={async (datasetId) => {
          await flush();
          navigate(builderUrl(datasetId, undefined, { dashboard: dashboard._id }));
        }}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} dashboard={dashboard} onUpdated={(d) => setDashboard((cur) => (cur ? { ...cur, isShared: d.isShared, shareToken: d.shareToken, sharedAt: d.sharedAt } : d))} />
      <DrillDrawer
        ds={drill?.ds ?? null}
        base={drill?.base ?? null}
        target={drill?.target ?? null}
        onClose={() => setDrill(null)}
        onApplyFilters={(f) => setViewFilters(dateRange, [...crossFilters, ...f])}
        applyLabel="Filter dashboard"
      />
    </div>
  );
};
