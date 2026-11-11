/**
 * Datasets store for the signed-in workspace: metadata list, on-demand full datasets (rows), uploads,
 * rename/delete, and background polling of AI insight generation (async insights mode).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, uploadWithProgress } from "../lib/api";
import type { Dataset, InsightsStatus } from "../types";

const INSIGHTS_POLL_MS = 4000;
const INSIGHTS_POLL_MAX_ATTEMPTS = 45; // ~3 minutes per dataset

type Status = "loading" | "ready" | "error";

interface DataContextValue {
  datasets: Dataset[];
  status: Status;
  error: string | null;
  refresh: () => Promise<void>;
  /** Full dataset (with rows) if already loaded. */
  full: (id: string) => Dataset | undefined;
  loadFull: (id: string) => Promise<Dataset>;
  upload: (file: File, onProgress?: (fraction: number) => void) => Promise<Dataset>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  regenerateInsights: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fullById, setFullById] = useState<Record<string, Dataset>>({});
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(new Map<string, Promise<Dataset>>());
  const pollAttempts = useRef(new Map<string, number>());

  const patch = useCallback((id: string, partial: Partial<Dataset>) => {
    setDatasets((list) => list.map((d) => (d._id === id ? { ...d, ...partial } : d)));
    setFullById((m) => (m[id] ? { ...m, [id]: { ...m[id], ...partial } } : m));
  }, []);

  const fetchList = useCallback(
    () =>
      api<Dataset[]>("/api/datasets?limit=100").then(
        (list) => {
          setDatasets(list);
          setStatus("ready");
          setError(null);
        },
        (err) => {
          setError(err instanceof Error ? err.message : "Could not load datasets");
          setStatus((s) => (s === "ready" ? s : "error"));
        }
      ),
    []
  );
  const refresh = useCallback(() => fetchList(), [fetchList]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const loadFull = useCallback(
    (id: string): Promise<Dataset> => {
      const existing = inflight.current.get(id);
      if (existing) return existing;
      const promise = api<Dataset>(`/api/datasets/${id}`)
        .then((ds) => {
          setFullById((m) => ({ ...m, [id]: ds }));
          setDatasets((list) => list.map((d) => (d._id === id ? { ...d, insights: ds.insights, insightsStatus: ds.insightsStatus } : d)));
          return ds;
        })
        .finally(() => inflight.current.delete(id));
      inflight.current.set(id, promise);
      return promise;
    },
    []
  );

  const full = useCallback((id: string) => fullById[id], [fullById]);

  const upload = useCallback(async (file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    const created = await uploadWithProgress<Dataset>("/api/datasets/upload", form, onProgress ?? (() => {}));
    const { originalData, ...meta } = created;
    setDatasets((list) => [meta, ...list.filter((d) => d._id !== created._id)]);
    if (originalData) setFullById((m) => ({ ...m, [created._id]: created }));
    return created;
  }, []);

  const rename = useCallback(
    async (id: string, name: string) => {
      const updated = await api<Dataset>(`/api/datasets/${id}`, { method: "PATCH", body: { name } });
      patch(id, { name: updated.name });
    },
    [patch]
  );

  const remove = useCallback(async (id: string) => {
    await api(`/api/datasets/${id}`, { method: "DELETE" });
    setDatasets((list) => list.filter((d) => d._id !== id));
    setFullById((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }, []);

  const regenerateInsights = useCallback(
    async (id: string) => {
      await api(`/api/datasets/${id}/insights/regenerate`, { method: "POST" });
      pollAttempts.current.delete(id);
      patch(id, { insightsStatus: "pending", insights: "" });
    },
    [patch]
  );

  // Poll the lightweight status endpoint for every dataset whose insights are still being generated.
  const pendingIds = useMemo(() => datasets.filter((d) => d.insightsStatus === "pending").map((d) => d._id).join(","), [datasets]);
  useEffect(() => {
    if (!pendingIds) return;
    const ids = pendingIds.split(",");
    let cancelled = false;
    const timer = window.setInterval(async () => {
      for (const id of ids) {
        const attempts = (pollAttempts.current.get(id) ?? 0) + 1;
        pollAttempts.current.set(id, attempts);
        if (attempts > INSIGHTS_POLL_MAX_ATTEMPTS) continue;
        try {
          const res = await api<{ insightsStatus: InsightsStatus; insights: string }>(`/api/datasets/${id}/insights`);
          if (!cancelled && res.insightsStatus !== "pending") patch(id, { insightsStatus: res.insightsStatus, insights: res.insights });
        } catch {
          // transient: keep polling
        }
      }
    }, INSIGHTS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingIds, patch]);

  const value = useMemo<DataContextValue>(
    () => ({ datasets, status, error, refresh, full, loadFull, upload, rename, remove, regenerateInsights }),
    [datasets, status, error, refresh, full, loadFull, upload, rename, remove, regenerateInsights]
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

/** Loads (and caches) a full dataset with rows. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDataset(id: string | undefined): { dataset: Dataset | undefined; meta: Dataset | undefined; loading: boolean; error: string | null; retry: () => void } {
  const { datasets, full, loadFull, status } = useData();
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const error = failure && failure.id === id ? failure.message : null;
  const dataset = id ? full(id) : undefined;
  const meta = id ? datasets.find((d) => d._id === id) : undefined;
  const metaName = meta?.name;
  const metaInsights = meta?.insights;
  const metaStatus = meta?.insightsStatus;
  // The list entry carries the freshest name/insight status (rename, polling); rows come from the full load.
  const merged = useMemo(
    () =>
      dataset
        ? { ...dataset, name: metaName ?? dataset.name, insights: metaInsights ?? dataset.insights, insightsStatus: metaStatus ?? dataset.insightsStatus }
        : undefined,
    [dataset, metaName, metaInsights, metaStatus]
  );

  useEffect(() => {
    if (!id || dataset) return;
    let cancelled = false;
    loadFull(id).catch((err) => {
      if (!cancelled) setFailure({ id, message: err instanceof Error ? err.message : "Could not load dataset" });
    });
    return () => {
      cancelled = true;
    };
  }, [id, dataset, loadFull, attempt]);

  return {
    dataset: merged,
    meta,
    loading: Boolean(id) && !dataset && !error && (status === "loading" || Boolean(meta) || status === "ready"),
    error,
    retry: () => {
      setFailure(null);
      setAttempt((a) => a + 1);
    },
  };
}
