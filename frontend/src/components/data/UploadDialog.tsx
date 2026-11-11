import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleCheck, FileSpreadsheet, Sparkles } from "lucide-react";
import { Modal } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/Surface";
import { Dropzone } from "./Dropzone";
import { validateFile } from "../../lib/upload";
import { useData } from "../../context/Data";
import { errorMessage } from "../../lib/api";
import { formatBytes, formatInteger } from "../../lib/format";
import type { Dataset } from "../../types";

type Phase = { kind: "idle" } | { kind: "uploading"; file: File; progress: number } | { kind: "analyzing"; file: File } | { kind: "done"; dataset: Dataset } | { kind: "error"; message: string };

const STEPS = ["Parse rows and detect column types", "Classify column meaning with AI", "Compute KPIs and pick charts", "Generate AI insights (may continue in the background)"];

export const UploadDialog: React.FC<{ open: boolean; onClose: () => void; initialFile?: File | null }> = ({ open, onClose, initialFile }) => {
  const { upload } = useData();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "idle" });
    if (initialFile) void start(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const start = async (file: File) => {
    const invalid = validateFile(file);
    if (invalid) {
      setPhase({ kind: "error", message: invalid });
      return;
    }
    setPhase({ kind: "uploading", file, progress: 0 });
    try {
      const dataset = await upload(file, (p) => {
        if (p >= 1) setPhase({ kind: "analyzing", file });
        else setPhase({ kind: "uploading", file, progress: p });
      });
      setPhase({ kind: "done", dataset });
    } catch (err) {
      setPhase({ kind: "error", message: errorMessage(err, "Upload failed.") });
    }
  };

  const busy = phase.kind === "uploading" || phase.kind === "analyzing";

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Upload a dataset" description="VizIntel profiles every column, builds KPIs and charts, and writes AI insights." size="md">
      {(phase.kind === "idle" || phase.kind === "error") && (
        <>
          <Dropzone onFile={start} />
          {phase.kind === "error" && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{phase.message}</p>}
        </>
      )}

      {busy && (
        <div className="py-2">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <FileSpreadsheet className="shrink-0 text-brand" size={22} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{phase.file.name}</p>
              <p className="text-xs text-ink-3">{formatBytes(phase.file.size)}</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-[13px]">
              <span className="font-medium text-ink">{phase.kind === "uploading" ? "Uploading…" : "Analyzing…"}</span>
              {phase.kind === "uploading" && <span className="vz-num text-ink-3">{Math.round(phase.progress * 100)}%</span>}
            </div>
            <ProgressBar value={phase.kind === "uploading" ? phase.progress : 1} indeterminate={phase.kind === "analyzing"} />
          </div>
          {phase.kind === "analyzing" && (
            <div className="mt-5 rounded-xl border border-line bg-surface-2 p-3.5">
              <p className="mb-2 text-xs font-medium text-ink-2">The server is running the analysis pipeline:</p>
              <ol className="space-y-1.5">
                {STEPS.map((label, i) => (
                  <li key={label} className="flex items-center gap-2.5 text-[13px] text-ink-2">
                    <span className="vz-num flex h-4 w-4 items-center justify-center rounded-full bg-surface-3 text-[10px] text-ink-3">{i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {phase.kind === "done" && (
        <div className="py-2 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-good-soft">
            <CircleCheck className="text-good" size={24} />
          </div>
          <p className="font-semibold text-ink">{phase.dataset.name} is ready</p>
          <p className="mt-1 text-[13px] text-ink-3">
            {formatInteger(phase.dataset.rowCount ?? phase.dataset.originalData?.length ?? 0)} rows · {formatInteger(phase.dataset.columns?.length ?? 0)} columns ·{" "}
            {Object.keys(phase.dataset.kpis ?? {}).length} KPIs
            {phase.dataset.insightsStatus === "pending" && " · insights generating in the background"}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                navigate(`/app/explore/${phase.dataset._id}`);
              }}
            >
              Explore data
            </Button>
            <Button
              variant="primary"
              data-track="upload_open_insights"
              onClick={() => {
                onClose();
                navigate(`/app/insights/${phase.dataset._id}`);
              }}
            >
              <Sparkles size={15} /> See insights
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
