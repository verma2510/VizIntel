import React, { useState } from "react";
import { Copy, ExternalLink, Globe, Lock } from "lucide-react";
import { useDashboards } from "../../context/Dashboards";
import { useToast } from "../../context/Toast";
import { errorMessage } from "../../lib/api";
import { copyText } from "../../lib/export";
import { shareUrl } from "../../lib/spec";
import { formatRelative } from "../../lib/format";
import type { Dashboard } from "../../types";
import { Modal } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Switch, inputClass } from "../ui/Field";

export const ShareDialog: React.FC<{ open: boolean; onClose: () => void; dashboard: Dashboard; onUpdated: (d: Dashboard) => void }> = ({ open, onClose, dashboard, onUpdated }) => {
  const { setSharing } = useDashboards();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async (shared: boolean) => {
    setBusy(true);
    try {
      onUpdated(await setSharing(dashboard._id, shared));
      toast.success(shared ? "Public link created" : "Sharing turned off", shared ? undefined : "The previous link no longer works.");
    } catch (err) {
      toast.error("Couldn't update sharing", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share dashboard" description={dashboard.name} size="md" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex items-start gap-3 rounded-xl border border-line p-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${dashboard.isShared ? "bg-brand-soft text-brand-ink" : "bg-surface-3 text-ink-2"}`}>{dashboard.isShared ? <Globe size={18} /> : <Lock size={18} />}</span>
        <div className="flex-1">
          <Switch
            label="Anyone with the link can view"
            description={dashboard.isShared ? `Shared ${formatRelative(dashboard.sharedAt)} · read-only, no sign-in required` : "Only you can see this dashboard."}
            checked={dashboard.isShared}
            disabled={busy}
            onChange={toggle}
          />
        </div>
      </div>
      {dashboard.isShared && dashboard.shareToken && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input readOnly value={shareUrl(dashboard.shareToken)} className={`${inputClass} h-9 font-mono text-[12.5px]`} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              data-track="share_copy_link"
              onClick={async () => {
                if (await copyText(shareUrl(dashboard.shareToken!))) toast.success("Link copied");
              }}
            >
              <Copy size={14} /> Copy
            </Button>
          </div>
          <a href={shareUrl(dashboard.shareToken)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-brand-ink hover:underline">
            Preview public view <ExternalLink size={13} />
          </a>
          <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
            Viewers can see every widget and the underlying rows of the datasets those widgets use (for drill-down and tables). Turn sharing off to revoke access instantly.
          </p>
        </div>
      )}
    </Modal>
  );
};
