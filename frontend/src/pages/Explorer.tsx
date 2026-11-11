import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChartColumn, Columns3, Download, Sparkles, Table2, ChartArea } from "lucide-react";
import { useActiveDataset } from "../hooks/useActiveDataset";
import { useShell } from "../components/layout/AppShell";
import { applyFilters } from "../lib/data/filters";
import type { Field, PreparedDataset } from "../lib/data/prepare";
import { profileColumns, type ColumnProfile } from "../lib/analysis";
import { specFromLegacy, type DrillTarget } from "../lib/chart/engine";
import { builderUrl } from "../lib/spec";
import { downloadRowsCsv, safeFilename } from "../lib/export";
import { formatDate, formatInteger, formatMeasure, formatRelative, formatShare } from "../lib/format";
import type { ChartSpec, Filter } from "../types";
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoader, Segmented } from "../components/ui/Surface";
import { Button, ButtonLink } from "../components/ui/Button";
import { SearchInput } from "../components/ui/Field";
import { Drawer } from "../components/ui/Overlay";
import { DatasetPicker } from "../components/data/DatasetPicker";
import { DataTable, RoleIcon } from "../components/data/DataTable";
import { ROLE_META } from "../components/data/roleMeta";
import { FilterBar } from "../components/data/Filters";
import { DrillDrawer } from "../components/data/DrillDrawer";
import { ChartCard } from "../components/charts/ChartCard";

const parseFilters = (raw: string | null): Filter[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.column === "string" && typeof f.op === "string") : [];
  } catch {
    return [];
  }
};

function profileSpec(f: Field, ds: PreparedDataset): ChartSpec {
  if (f.role === "measure") return { type: "histogram", y: [f.name], agg: "count", title: `Distribution of ${f.label}` };
  if (f.role === "date") return { type: "area", x: f.name, y: [], agg: "count", bucket: "auto", title: `Rows over ${f.label}` };
  return { type: ds.distinctCount(f.name) > 8 ? "hbar" : "bar", x: f.name, y: [], agg: "count", sort: "desc", limit: 15, title: `Most common ${f.label} values` };
}

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
    <p className="text-[11px] text-ink-3">{label}</p>
    <p className="vz-num mt-0.5 truncate text-sm font-medium text-ink">{value}</p>
  </div>
);

const ColumnProfileDrawer: React.FC<{ ds: PreparedDataset; idx: Uint32Array; profile: ColumnProfile | null; onClose: () => void; onDrill: (t: DrillTarget) => void }> = ({ ds, idx, profile, onClose, onDrill }) => {
  if (!profile) return null;
  const f = ds.field(profile.name)!;
  const fmt = (v: number) => formatMeasure(v, f.semanticType, { compact: false, percentIsFraction: f.semanticType === "percentage" && ds.percentIsFraction(f.name) });
  const spec = profileSpec(f, ds);
  const n = profile.count + profile.missing;
  return (
    <Drawer
      open
      onClose={onClose}
      title={f.label}
      description={
        <span className="inline-flex items-center gap-1.5">
          <RoleIcon role={f.role} /> {ROLE_META[f.role].label}
          {f.semanticType && f.semanticType !== "category" && ` · ${f.semanticType}`}
          {f.label !== f.name && <span className="font-mono text-[11px]">· {f.name}</span>}
        </span>
      }
      footer={
        <ButtonLink to={builderUrl(ds.id, spec)} variant="secondary" onClick={onClose}>
          <ChartColumn size={15} /> Open in chart builder
        </ButtonLink>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Values" value={formatInteger(profile.count)} />
        <Stat label="Missing" value={`${formatInteger(profile.missing)} (${formatShare(n ? profile.missing / n : 0)})`} />
        <Stat label="Distinct" value={formatInteger(profile.distinct)} />
        {profile.numeric && <Stat label="Outliers (IQR)" value={formatInteger(profile.numeric.outliers)} />}
        {profile.numeric && (
          <>
            <Stat label="Sum" value={fmt(profile.numeric.sum)} />
            <Stat label="Mean" value={fmt(profile.numeric.mean)} />
            <Stat label="Median" value={fmt(profile.numeric.median)} />
            <Stat label="Std. dev." value={fmt(profile.numeric.std)} />
            <Stat label="Min" value={fmt(profile.numeric.min)} />
            <Stat label="25th pct." value={fmt(profile.numeric.q1)} />
            <Stat label="75th pct." value={fmt(profile.numeric.q3)} />
            <Stat label="Max" value={fmt(profile.numeric.max)} />
          </>
        )}
        {profile.date && (
          <>
            <Stat label="Earliest" value={formatDate(profile.date.min)} />
            <Stat label="Latest" value={formatDate(profile.date.max)} />
          </>
        )}
      </div>
      <ChartCard ds={ds} idx={idx} spec={spec} height={240} className="mt-4" onDrill={onDrill} />
      {profile.top && profile.top.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-ink-2">Most common values</p>
          <ul className="space-y-1.5">
            {profile.top.map((t) => (
              <li key={t.value} className="flex items-center gap-3 text-[13px]">
                <span className="w-40 truncate text-ink" title={t.value}>
                  {t.value}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${(t.count / Math.max(1, profile.count)) * 100}%` }} />
                </span>
                <span className="vz-num w-20 text-right text-ink-3">{formatInteger(t.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
};

export const Explorer: React.FC = () => {
  const { id, dataset, meta, prepared: ds, loading, error, retry, hasDatasets, listStatus, select } = useActiveDataset("/app/explore");
  const { openUpload } = useShell();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<Filter[]>(() => parseFilters(params.get("filters")));
  const [tab, setTab] = useState<"data" | "columns" | "charts">("data");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [columnSearch, setColumnSearch] = useState("");
  const [profiled, setProfiled] = useState<string | null>(params.get("column"));
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  // Reset view state when switching datasets (filters from a deep link apply only to the first one).
  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    if (lastId) {
      setFilters([]);
      setQuery("");
    }
  }

  useEffect(() => {
    if (!params.get("filters") && !params.get("column")) return;
    const next = new URLSearchParams(params);
    next.delete("filters");
    next.delete("column");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => (ds ? applyFilters(ds, filters) : null), [ds, filters]);
  const idx = useMemo(() => {
    if (!ds || !filtered) return null;
    if (!deferredQuery) return filtered;
    const cols = ds.fields.map((f) => ds.str(f.name));
    const out: number[] = [];
    for (const i of filtered) {
      for (const col of cols) {
        if (col[i].toLowerCase().includes(deferredQuery)) {
          out.push(i);
          break;
        }
      }
    }
    return Uint32Array.from(out);
  }, [ds, filtered, deferredQuery]);
  const profiles = useMemo(() => (ds && idx ? profileColumns(ds, idx) : []), [ds, idx]);
  const legacySpecs = useMemo(() => (ds ? (dataset?.charts ?? []).map((c) => specFromLegacy(c, ds)).filter((s): s is ChartSpec => Boolean(s)) : []), [ds, dataset?.charts]);

  if (listStatus === "ready" && !hasDatasets) {
    return (
      <>
        <PageHeader eyebrow="Data" title="Explorer" />
        <Card>
          <EmptyState icon={<Table2 size={20} />} title="Nothing to explore yet" description="Upload a dataset to browse its rows, profile columns and filter data." action={<Button onClick={() => openUpload()}>Upload a dataset</Button>} />
        </Card>
      </>
    );
  }

  const profileFor = profiled ? profiles.find((p) => p.name === profiled) ?? null : null;
  const visibleColumns = ds?.fields.filter((f) => f.label.toLowerCase().includes(columnSearch.toLowerCase()) || f.name.toLowerCase().includes(columnSearch.toLowerCase())) ?? [];

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Dataset explorer"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <DatasetPicker value={id} onChange={select} className="max-w-[min(520px,80vw)] text-base" />
          </span>
        }
        description={
          meta ? (
            <>
              {formatInteger(meta.rowCount ?? 0)} rows · {formatInteger(meta.columnCount ?? meta.columns?.length ?? 0)} columns · uploaded {formatRelative(meta.createdAt)}
            </>
          ) : undefined
        }
        actions={
          id && (
            <>
              <ButtonLink to={`/app/insights/${id}`} variant="secondary" size="sm">
                <Sparkles size={14} /> Insights
              </ButtonLink>
              <ButtonLink to={builderUrl(id)} variant="secondary" size="sm">
                <ChartColumn size={14} /> Build chart
              </ButtonLink>
              <Button
                size="sm"
                variant="secondary"
                disabled={!ds || !idx}
                data-track="explorer_export_csv"
                onClick={() => ds && idx && downloadRowsCsv(ds.rows, ds.fields.map((f) => f.name), idx, safeFilename(`${ds.name}${filters.length || deferredQuery ? "-filtered" : ""}`, "csv"))}
              >
                <Download size={14} /> Export{filters.length || deferredQuery ? " filtered" : ""} CSV
              </Button>
            </>
          )
        }
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={retry} />
        </Card>
      ) : loading || !ds || !idx ? (
        <PageLoader label="Loading rows…" />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterBar ds={ds} filters={filters} onChange={setFilters}>
              <SearchInput value={query} onChange={setQuery} placeholder="Search all cells…" className="w-60" aria-label="Search rows" />
            </FilterBar>
            <Segmented
              ariaLabel="Explorer view"
              value={tab}
              onChange={setTab}
              options={[
                { value: "data", label: <><Table2 size={14} /> Rows</> },
                { value: "columns", label: <><Columns3 size={14} /> Columns</> },
                { value: "charts", label: <><ChartArea size={14} /> Auto charts</> },
              ]}
            />
          </div>
          {(filters.length > 0 || deferredQuery) && (
            <p className="mb-3 text-[13px] text-ink-2">
              <span className="vz-num font-medium text-ink">{formatInteger(idx.length)}</span> of {formatInteger(ds.n)} rows match ({formatShare(ds.n ? idx.length / ds.n : 0)}).
            </p>
          )}

          {tab === "data" && (
            <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
              <Card padded={false} className="hidden self-start xl:block">
                <div className="border-b border-line p-3">
                  <SearchInput value={columnSearch} onChange={setColumnSearch} placeholder="Find a column" aria-label="Find a column" />
                </div>
                <ul className="max-h-[560px] overflow-y-auto p-1.5">
                  {visibleColumns.map((f) => {
                    const p = profiles.find((x) => x.name === f.name);
                    return (
                      <li key={f.name}>
                        <button type="button" onClick={() => setProfiled(f.name)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-3" data-track="explorer_profile_column">
                          <RoleIcon role={f.role} />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.label}</span>
                          {p && p.missing > 0 && <span className="text-[10px] text-warn" title={`${p.missing} missing`}>{formatShare(p.missing / (p.count + p.missing))}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Card className="min-w-0 p-3">
                <DataTable ds={ds} idx={idx} highlight={profiled ?? undefined} onColumnClick={setProfiled} />
              </Card>
            </div>
          )}

          {tab === "columns" && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((p) => {
                const f = ds.field(p.name)!;
                const n = p.count + p.missing;
                const fmt = (v: number) => formatMeasure(v, f.semanticType, { percentIsFraction: f.semanticType === "percentage" && ds.percentIsFraction(f.name) });
                return (
                  <Card key={p.name} interactive className="cursor-pointer p-4" onClick={() => setProfiled(p.name)} role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && setProfiled(p.name)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                          <RoleIcon role={p.role} /> {p.label}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-3">{ROLE_META[p.role].label}{f.semanticType && f.semanticType !== "category" && f.semanticType !== "date" ? ` · ${f.semanticType}` : ""}</p>
                      </div>
                      {p.missing / Math.max(1, n) >= 0.05 ? <Badge tone="warn">{formatShare(p.missing / n)} missing</Badge> : <Badge tone="good">Complete</Badge>}
                    </div>
                    <div className="mt-3 text-[13px] text-ink-2">
                      {p.numeric ? (
                        <div className="grid grid-cols-3 gap-2">
                          <span><span className="block text-[11px] text-ink-3">Min</span>{fmt(p.numeric.min)}</span>
                          <span><span className="block text-[11px] text-ink-3">Median</span>{fmt(p.numeric.median)}</span>
                          <span><span className="block text-[11px] text-ink-3">Max</span>{fmt(p.numeric.max)}</span>
                        </div>
                      ) : p.date ? (
                        <span>{formatDate(p.date.min)} → {formatDate(p.date.max)}</span>
                      ) : (
                        <span>
                          {formatInteger(p.distinct)} distinct · top: <span className="text-ink">{p.top?.[0]?.value ?? "—"}</span>
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {tab === "charts" &&
            (legacySpecs.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {legacySpecs.map((spec, i) => (
                  <ChartCard key={i} ds={ds} idx={idx} spec={spec} onDrill={setDrill} badge={<Badge>Auto</Badge>} />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState compact icon={<ChartArea size={18} />} title="No automatic charts for this dataset" description="Charts are chosen at upload from date, category and metric columns. Build your own in the chart builder." action={<ButtonLink to={builderUrl(id)} size="sm">Open chart builder</ButtonLink>} />
              </Card>
            ))}

          <p className="mt-6 text-xs text-ink-3">
            Want the story behind the numbers?{" "}
            <Link to={`/app/insights/${id}`} className="text-brand-ink hover:underline">
              See AI insights for this dataset
            </Link>
            .
          </p>

          <ColumnProfileDrawer ds={ds} idx={idx} profile={profileFor} onClose={() => setProfiled(null)} onDrill={(t) => { setProfiled(null); setDrill(t); }} />
          <DrillDrawer ds={ds} base={idx} target={drill} onClose={() => setDrill(null)} onApplyFilters={(f) => setFilters((cur) => [...cur, ...f])} applyLabel="Add as filters" />
        </>
      )}
    </div>
  );
};
