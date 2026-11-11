import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChartColumn, CloudUpload, Database, Ellipsis, FileSpreadsheet, Pencil, SearchX, Sparkles, Table2, Trash2 } from "lucide-react";
import { useData } from "../context/Data";
import { useDashboards } from "../context/Dashboards";
import { useToast } from "../context/Toast";
import { useShell } from "../components/layout/AppShell";
import { api, errorMessage } from "../lib/api";
import { trackSearch } from "../lib/tracker";
import { formatDate, formatInteger, formatRelative } from "../lib/format";
import type { Column, Dataset, InsightsStatus } from "../types";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { SearchInput, Select, Textfield } from "../components/ui/Field";
import { ConfirmDialog, MenuItem, MenuSeparator, Modal, Popover } from "../components/ui/Overlay";
import { Dropzone } from "../components/data/Dropzone";

const SEARCH_DEBOUNCE_MS = 350;

const STATUS_BADGE: Record<InsightsStatus, { tone: "good" | "warn" | "bad"; label: string }> = {
  ready: { tone: "good", label: "Insights ready" },
  pending: { tone: "warn", label: "Generating" },
  failed: { tone: "bad", label: "Insights failed" },
};

/** Proportional bar of column roles (metrics / dates / categories / other). */
const Composition: React.FC<{ columns?: Column[] }> = ({ columns = [] }) => {
  if (!columns.length) return <span className="text-xs text-ink-3">—</span>;
  const counts = { measure: 0, date: 0, category: 0, other: 0 };
  for (const c of columns) {
    if (c.semanticType === "identifier" || c.semanticType === "text") counts.other++;
    else if (c.type === "date" || c.semanticType === "date") counts.date++;
    else if (c.type === "numeric" || ["currency", "quantity", "percentage"].includes(c.semanticType ?? "")) counts.measure++;
    else counts.category++;
  }
  const parts = [
    { k: "Metrics", n: counts.measure, c: "bg-brand" },
    { k: "Dates", n: counts.date, c: "bg-good" },
    { k: "Categories", n: counts.category, c: "bg-warn" },
    { k: "IDs & text", n: counts.other, c: "bg-line-strong" },
  ].filter((p) => p.n);
  const label = parts.map((p) => `${p.n} ${p.k.toLowerCase()}`).join(", ");
  return (
    <div className="w-28" title={label} aria-label={label}>
      <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.k} className={p.c} style={{ flex: p.n }} />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">{columns.length} columns</p>
    </div>
  );
};

type SortKey = "newest" | "oldest" | "name" | "rows";

export const DataSources: React.FC = () => {
  const { datasets, status, error, refresh, rename, remove } = useData();
  const { dashboards } = useDashboards();
  const { openUpload } = useShell();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Dataset[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | InsightsStatus>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [renaming, setRenaming] = useState<Dataset | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Dataset | null>(null);

  // Debounced server-side search (cached in Redis); each settled query is tracked as a search event.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const found = await api<Dataset[]>(`/api/datasets?q=${encodeURIComponent(term)}&limit=100`, { signal: controller.signal });
        setResults(found);
        if (term.length >= 2) trackSearch(term, found.length);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const visible = useMemo(() => {
    // Search results come from the server; keep them in sync with local renames/deletes/status.
    const byId = new Map(datasets.map((d) => [d._id, d]));
    const base = results ? results.filter((r) => byId.has(r._id)).map((r) => byId.get(r._id)!) : datasets;
    const filtered = statusFilter === "all" ? base : base.filter((d) => (d.insightsStatus ?? "ready") === statusFilter);
    const sorted = [...filtered];
    if (sort === "oldest") sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "rows") sorted.sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0));
    return sorted;
  }, [datasets, results, statusFilter, sort]);

  const usage = (id: string) => dashboards.filter((d) => d.widgets.some((w) => w.datasetId === id)).length;
  const totalRows = datasets.reduce((s, d) => s + (d.rowCount ?? 0), 0);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Data"
        title="Data sources"
        description={datasets.length ? `${formatInteger(datasets.length)} datasets · ${formatInteger(totalRows)} rows analyzed` : "Upload spreadsheets to analyze them."}
        actions={
          <Button onClick={() => openUpload()} data-track="data_upload">
            <CloudUpload size={15} /> Upload dataset
          </Button>
        }
      />

      <Dropzone compact onFile={(file) => openUpload(file)} className="mb-6" />

      {status === "error" && datasets.length === 0 ? (
        <Card>
          <ErrorState message={error ?? "Could not load datasets."} onRetry={refresh} />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
            <SearchInput value={query} onChange={setQuery} busy={searching} placeholder="Search datasets by name" className="lg:w-80" aria-label="Search datasets" maxLength={100} />
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                ariaLabel="Insight status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "ready", label: "Ready" },
                  { value: "pending", label: "Generating" },
                  { value: "failed", label: "Failed" },
                ]}
              />
              <Select
                size="sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort datasets"
                options={[
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                  { value: "name", label: "Name A–Z" },
                  { value: "rows", label: "Most rows" },
                ]}
              />
            </div>
          </div>

          {status === "loading" ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : datasets.length === 0 ? (
            <EmptyState icon={<Database size={20} />} title="No datasets yet" description="Upload an Excel (.xlsx) or CSV file to generate KPIs, interactive charts and AI-powered insights." action={<Button onClick={() => openUpload()}>Upload your first dataset</Button>} />
          ) : visible.length === 0 ? (
            <EmptyState compact icon={<SearchX size={18} />} title="No matches" description={query ? `No datasets match “${query.trim()}”.` : "No datasets have this status."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Rows</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Columns</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">AI insights</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Uploaded</th>
                    <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => {
                    const st = STATUS_BADGE[d.insightsStatus ?? "ready"];
                    const used = usage(d._id);
                    return (
                      <tr key={d._id} className="border-t border-line hover:bg-surface-2">
                        <td className="max-w-[360px] px-5 py-3">
                          <Link to={`/app/explore/${d._id}`} className="flex items-center gap-3" data-track="dataset_select" data-track-dataset-id={d._id} data-track-source={results ? "search" : "list"}>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-brand">
                              <FileSpreadsheet size={16} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink hover:underline">{d.name}</span>
                              {used > 0 && <span className="block text-xs text-ink-3">Used in {used} dashboard{used === 1 ? "" : "s"}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className="vz-num px-3 py-3 text-right text-ink-2">{formatInteger(d.rowCount ?? 0)}</td>
                        <td className="px-3 py-3">
                          <Composition columns={d.columns} />
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={st.tone} icon={d.insightsStatus === "pending" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : undefined}>
                            {st.label}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-ink-2" title={formatDate(d.createdAt, "datetime")}>
                          {formatRelative(d.createdAt)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link to={`/app/insights/${d._id}`} className="hidden h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink sm:inline-flex">
                              <Sparkles size={13} /> Insights
                            </Link>
                            <Popover
                              align="end"
                              width={210}
                              trigger={({ toggle, ref }) => (
                                <Button ref={ref} variant="ghost" size="xs" iconOnly onClick={toggle} aria-label={`Actions for ${d.name}`}>
                                  <Ellipsis size={16} />
                                </Button>
                              )}
                            >
                              {(close) => (
                                <div role="menu">
                                  <Link to={`/app/explore/${d._id}`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-surface-3">
                                    <Table2 size={15} className="text-ink-3" /> Explore rows
                                  </Link>
                                  <Link to={`/app/builder?dataset=${d._id}`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-surface-3">
                                    <ChartColumn size={15} className="text-ink-3" /> Build a chart
                                  </Link>
                                  <MenuItem
                                    icon={<Pencil size={15} />}
                                    onClick={() => {
                                      close();
                                      setNewName(d.name);
                                      setRenaming(d);
                                    }}
                                  >
                                    Rename
                                  </MenuItem>
                                  <MenuSeparator />
                                  <MenuItem
                                    icon={<Trash2 size={15} />}
                                    danger
                                    onClick={() => {
                                      close();
                                      setDeleting(d);
                                    }}
                                  >
                                    Delete
                                  </MenuItem>
                                </div>
                              )}
                            </Popover>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename dataset"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!newName.trim()}
              data-track="dataset_rename"
              onClick={async () => {
                if (!renaming) return;
                try {
                  await rename(renaming._id, newName.trim());
                  toast.success("Dataset renamed");
                  setRenaming(null);
                } catch (err) {
                  toast.error("Rename failed", errorMessage(err));
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Textfield label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} data-autofocus />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete dataset?"
        confirmLabel="Delete dataset"
        description={
          <>
            <strong className="text-ink">{deleting?.name}</strong> and its rows, KPIs and insights will be permanently deleted.
            {deleting && usage(deleting._id) > 0 && ` ${usage(deleting._id)} dashboard widget source${usage(deleting._id) === 1 ? "" : "s"} will show as unavailable.`}
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove(deleting._id);
            toast.success("Dataset deleted");
          } catch (err) {
            toast.error("Delete failed", errorMessage(err));
          }
        }}
      />
    </div>
  );
};
