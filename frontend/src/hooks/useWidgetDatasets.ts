import { useEffect, useMemo, useState } from "react";
import { useData } from "../context/Data";
import type { DatasetState } from "../components/dashboard/DashboardCanvas";
import type { Widget } from "../types";
import { errorMessage } from "../lib/api";

/** Loads every dataset referenced by a dashboard's widgets and reports per-dataset state. */
export function useWidgetDatasets(widgets: Widget[]): Record<string, DatasetState> {
  const { datasets, status, full, loadFull } = useData();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = useMemo(() => [...new Set(widgets.map((w) => w.datasetId).filter((id): id is string => Boolean(id)))], [widgets]);
  const idsKey = ids.join(",");

  useEffect(() => {
    for (const id of ids) {
      if (full(id) || errors[id]) continue;
      if (status === "ready" && !datasets.some((d) => d._id === id)) continue; // deleted
      loadFull(id).catch((err) => setErrors((e) => ({ ...e, [id]: errorMessage(err, "Could not load dataset") })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, status, datasets.length]);

  return useMemo(() => {
    const out: Record<string, DatasetState> = {};
    for (const id of ids) {
      const loaded = full(id);
      const meta = datasets.find((d) => d._id === id);
      if (loaded) out[id] = { status: "ready", dataset: meta ? { ...loaded, name: meta.name, insights: meta.insights ?? loaded.insights, insightsStatus: meta.insightsStatus ?? loaded.insightsStatus } : loaded };
      else if (errors[id]) out[id] = { status: "error", message: errors[id] };
      else if (status === "ready" && !meta) out[id] = { status: "missing" };
      else out[id] = { status: "loading" };
    }
    return out;
  }, [ids, full, datasets, errors, status]);
}
