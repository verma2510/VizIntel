import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Dashboard, DashboardFilters, Widget } from "../types";

interface DashboardInput {
  name: string;
  description?: string;
  widgets?: Widget[];
  filters?: DashboardFilters;
}

interface DashboardsContextValue {
  dashboards: Dashboard[];
  status: "loading" | "ready" | "error";
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: DashboardInput) => Promise<Dashboard>;
  update: (id: string, patch: Partial<DashboardInput>) => Promise<Dashboard>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<Dashboard>;
  setSharing: (id: string, shared: boolean) => Promise<Dashboard>;
  /** Appends a widget to an existing dashboard (used by the chart builder, insights, explorer). */
  addWidget: (id: string, widget: Widget) => Promise<Dashboard>;
  /** Keeps the cached list in sync after a page-level save. */
  upsertLocal: (dashboard: Dashboard) => void;
}

const DashboardsContext = createContext<DashboardsContextValue | null>(null);

const sortByUpdated = (list: Dashboard[]) => [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const DashboardsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const upsertLocal = useCallback((d: Dashboard) => {
    setDashboards((list) => sortByUpdated([d, ...list.filter((x) => x._id !== d._id)]));
  }, []);

  const refresh = useCallback(
    () =>
      api<Dashboard[]>("/api/dashboards").then(
        (list) => {
          setDashboards(list);
          setStatus("ready");
          setError(null);
        },
        (err) => {
          setError(err instanceof Error ? err.message : "Could not load dashboards");
          setStatus((s) => (s === "ready" ? s : "error"));
        }
      ),
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: DashboardInput) => {
      const d = await api<Dashboard>("/api/dashboards", { method: "POST", body: input });
      upsertLocal(d);
      return d;
    },
    [upsertLocal]
  );

  const update = useCallback(
    async (id: string, patch: Partial<DashboardInput>) => {
      const d = await api<Dashboard>(`/api/dashboards/${id}`, { method: "PUT", body: patch });
      upsertLocal(d);
      return d;
    },
    [upsertLocal]
  );

  const remove = useCallback(async (id: string) => {
    await api(`/api/dashboards/${id}`, { method: "DELETE" });
    setDashboards((list) => list.filter((d) => d._id !== id));
  }, []);

  const duplicate = useCallback(
    async (id: string) => {
      const d = await api<Dashboard>(`/api/dashboards/${id}/duplicate`, { method: "POST" });
      upsertLocal(d);
      return d;
    },
    [upsertLocal]
  );

  const setSharing = useCallback(
    async (id: string, shared: boolean) => {
      const d = await api<Dashboard>(`/api/dashboards/${id}/share`, { method: shared ? "POST" : "DELETE" });
      upsertLocal(d);
      return d;
    },
    [upsertLocal]
  );

  const addWidget = useCallback(
    async (id: string, widget: Widget) => {
      const current = await api<Dashboard>(`/api/dashboards/${id}`);
      return update(id, { widgets: [...current.widgets, widget] });
    },
    [update]
  );

  const value = useMemo(
    () => ({ dashboards, status, error, refresh, create, update, remove, duplicate, setSharing, addWidget, upsertLocal }),
    [dashboards, status, error, refresh, create, update, remove, duplicate, setSharing, addWidget, upsertLocal]
  );
  return <DashboardsContext.Provider value={value}>{children}</DashboardsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboards(): DashboardsContextValue {
  const ctx = useContext(DashboardsContext);
  if (!ctx) throw new Error("useDashboards must be used within DashboardsProvider");
  return ctx;
}
