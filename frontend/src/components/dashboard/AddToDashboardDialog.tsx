import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Plus } from "lucide-react";
import { Modal } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Textfield } from "../ui/Field";
import { useDashboards } from "../../context/Dashboards";
import { useToast } from "../../context/Toast";
import { errorMessage } from "../../lib/api";
import { formatRelative } from "../../lib/format";
import type { Widget } from "../../types";

/** Sends a widget (chart, KPI, table, AI summary) to a new or existing dashboard. */
export const AddToDashboardDialog: React.FC<{ open: boolean; onClose: () => void; widget: Widget | null }> = ({ open, onClose, widget }) => {
  const { dashboards, create, addWidget } = useDashboards();
  const toast = useToast();
  const navigate = useNavigate();
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(dashboards[0]?._id ?? "new");
    setName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!widget) return;
    setBusy(true);
    try {
      const d = target === "new" ? await create({ name: name.trim() || "Untitled dashboard", widgets: [widget] }) : await addWidget(target, widget);
      toast.toast({ tone: "success", title: `Added to ${d.name}`, action: { label: "Open dashboard", onClick: () => navigate(`/app/dashboards/${d._id}`) } });
      onClose();
    } catch (err) {
      toast.error("Couldn't add to dashboard", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to dashboard"
      description={widget?.title ? `“${widget.title}”` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={busy} data-track="add_to_dashboard" data-track-kind={widget?.kind}>
            Add widget
          </Button>
        </>
      }
    >
      <div className="space-y-1.5" role="radiogroup" aria-label="Destination dashboard">
        <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${target === "new" ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"}`}>
          <input type="radio" name="dash" className="accent-[var(--vz-brand)]" checked={target === "new"} onChange={() => setTarget("new")} />
          <Plus size={16} className="text-ink-2" />
          <span className="text-sm font-medium text-ink">New dashboard</span>
        </label>
        {target === "new" && (
          <div className="pb-2 pl-1 pt-1">
            <Textfield value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashboard name" maxLength={120} data-autofocus aria-label="New dashboard name" />
          </div>
        )}
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {dashboards.map((d) => (
            <label key={d._id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${target === d._id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"}`}>
              <input type="radio" name="dash" className="accent-[var(--vz-brand)]" checked={target === d._id} onChange={() => setTarget(d._id)} />
              <LayoutDashboard size={16} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{d.name}</span>
                <span className="block text-xs text-ink-3">
                  {d.widgets.length} widgets · edited {formatRelative(d.updatedAt)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
};
