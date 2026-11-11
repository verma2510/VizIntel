import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Ellipsis, Globe, LayoutDashboard, Plus, SearchX, Trash2 } from "lucide-react";
import { useDashboards } from "../context/Dashboards";
import { useToast } from "../context/Toast";
import { errorMessage } from "../lib/api";
import { formatRelative } from "../lib/format";
import type { Dashboard } from "../types";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { SearchInput, Textarea, Textfield } from "../components/ui/Field";
import { ConfirmDialog, MenuItem, MenuSeparator, Modal, Popover } from "../components/ui/Overlay";

/** Miniature of the widget layout (12-column grid, scaled). */
const LayoutPreview: React.FC<{ dashboard: Dashboard }> = ({ dashboard }) => (
  <div className="grid h-28 grid-cols-12 content-start gap-1 overflow-hidden rounded-lg bg-surface-2 p-2" style={{ gridAutoRows: 10 }} aria-hidden="true">
    {dashboard.widgets.length === 0 ? (
      <span className="col-span-12 row-span-6 rounded border border-dashed border-line-strong" />
    ) : (
      dashboard.widgets.slice(0, 12).map((w) => (
        <span
          key={w.id}
          className={`rounded-[3px] ${w.kind === "chart" ? "bg-brand/25" : w.kind === "kpi" ? "bg-ink/15" : w.kind === "insights" ? "bg-volt/60" : "bg-line-strong/60"}`}
          style={{ gridColumn: `span ${w.w}`, gridRow: `span ${Math.max(1, Math.round(w.h / 1.5))}` }}
        />
      ))
    )}
  </div>
);

export const Dashboards: React.FC = () => {
  const { dashboards, status, error, refresh, create, duplicate, remove } = useDashboards();
  const toast = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Dashboard | null>(null);

  const visible = dashboards.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(query.toLowerCase()));

  const submit = async () => {
    setBusy(true);
    try {
      const d = await create({ name: name.trim() || "Untitled dashboard", description: description.trim() });
      navigate(`/app/dashboards/${d._id}?edit=1`);
    } catch (err) {
      toast.error("Couldn't create dashboard", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Present"
        title="Dashboards"
        description="Compose charts, KPIs, tables, AI summaries and notes. Arrange them, cross-filter, and share read-only links."
        actions={
          <Button
            onClick={() => {
              setName("");
              setDescription("");
              setCreating(true);
            }}
            data-track="dashboards_new"
          >
            <Plus size={15} /> New dashboard
          </Button>
        }
      />

      {status === "error" && dashboards.length === 0 ? (
        <Card>
          <ErrorState message={error ?? "Could not load dashboards."} onRetry={refresh} />
        </Card>
      ) : status === "loading" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : dashboards.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutDashboard size={20} />}
            title="Create your first dashboard"
            description="Start from scratch, or add charts from the chart builder and AI insights pages with “Add to dashboard”."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus size={15} /> New dashboard
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Search dashboards" className="mb-4 max-w-sm" aria-label="Search dashboards" />
          {visible.length === 0 ? (
            <Card>
              <EmptyState compact icon={<SearchX size={18} />} title="No dashboards match" description={`Nothing matches “${query}”.`} />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((d) => (
                <Card key={d._id} interactive padded={false} className="group relative">
                  <Link to={`/app/dashboards/${d._id}`} className="block p-4" data-track="dashboard_open">
                    <LayoutPreview dashboard={d} />
                    <div className="mt-3 flex items-start justify-between gap-2 pr-8">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{d.name}</p>
                        <p className="mt-0.5 truncate text-[13px] text-ink-3">{d.description || `${d.widgets.length} widget${d.widgets.length === 1 ? "" : "s"}`}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                      <span>Edited {formatRelative(d.updatedAt)}</span>
                      {d.isShared && (
                        <Badge tone="brand" icon={<Globe size={11} />}>
                          Shared
                        </Badge>
                      )}
                    </div>
                  </Link>
                  <div className="absolute bottom-[54px] right-3">
                    <Popover
                      align="end"
                      width={190}
                      trigger={({ toggle, ref }) => (
                        <Button ref={ref} variant="ghost" size="xs" iconOnly onClick={toggle} aria-label={`Actions for ${d.name}`}>
                          <Ellipsis size={16} />
                        </Button>
                      )}
                    >
                      {(close) => (
                        <div role="menu">
                          <MenuItem
                            icon={<Copy size={15} />}
                            onClick={async () => {
                              close();
                              try {
                                await duplicate(d._id);
                                toast.success("Dashboard duplicated");
                              } catch (err) {
                                toast.error("Duplicate failed", errorMessage(err));
                              }
                            }}
                          >
                            Duplicate
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
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New dashboard"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={submit} isLoading={busy}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textfield label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quarterly sales review" maxLength={120} data-autofocus onKeyDown={(e) => e.key === "Enter" && submit()} />
          <div>
            <label htmlFor="dash-desc" className="mb-1.5 block text-[13px] font-medium text-ink-2">
              Description <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <Textarea id="dash-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete dashboard?"
        confirmLabel="Delete dashboard"
        description={
          <>
            <strong className="text-ink">{deleting?.name}</strong> will be deleted{deleting?.isShared ? " and its public link will stop working" : ""}. Datasets are not affected.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove(deleting._id);
            toast.success("Dashboard deleted");
          } catch (err) {
            toast.error("Delete failed", errorMessage(err));
          }
        }}
      />
    </div>
  );
};
