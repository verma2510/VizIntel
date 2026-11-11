import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/Auth";
import { Navbar } from "../components/Navbar";
import { Kpi } from "../components/Kpi";
import { Aisummary } from "../components/Aisummary";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ActivityPanel } from "../components/ActivityPanel";
import { InsightsFailed, InsightsPending } from "../components/InsightsStatus";
import { UploadCloud, FileSpreadsheet, Loader2, Search, X } from "lucide-react";
import { Bar, Line } from "react-chartjs-2";
import type { ActiveElement, ChartEvent } from "chart.js";
import { getChartConfig } from "../utils/chartSelector";
import { API_URL, authHeaders } from "../lib/api";
import { trackClick, trackSearch } from "../lib/tracker";

type InsightsStatus = "pending" | "ready" | "failed";

interface Dataset {
  _id: string;
  name: string;
  originalData?: any[]; // omitted by the list endpoint, loaded on demand when a dataset is opened
  kpis: Record<string, any>;
  charts: any[];
  insights: string;
  insightsStatus?: InsightsStatus;
  rowCount?: number;
  createdAt: string;
}

const SEARCH_DEBOUNCE_MS = 350;
const INSIGHTS_POLL_MS = 4000;
const INSIGHTS_POLL_MAX_ATTEMPTS = 45; // ~3 minutes

export const Dashboard: React.FC = () => {
  const { token, user, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Dataset[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [retryingInsights, setRetryingInsights] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const rowsCache = useRef(new Map<string, NonNullable<Dataset["originalData"]>>());
  const activeIdRef = useRef<string | null>(null);

  // Applies a partial update everywhere a dataset is held (list, search results, active selection).
  const patchDataset = useCallback((id: string, patch: Partial<Dataset>) => {
    const apply = (ds: Dataset) => (ds._id === id ? { ...ds, ...patch } : ds);
    setDatasets(prev => prev.map(apply));
    setSearchResults(prev => (prev ? prev.map(apply) : prev));
    setActiveDataset(prev => (prev && prev._id === id ? { ...prev, ...patch } : prev));
  }, []);

  const loadDatasetRows = useCallback(async (id: string) => {
    if (!token) return;
    setLoadingRows(true);
    try {
      const resp = await fetch(`${API_URL}/api/datasets/${id}`, { headers: authHeaders(token) });
      if (resp.status === 401) {
        logout();
        return;
      }
      if (!resp.ok) return;
      const full: Dataset = await resp.json();
      if (full.originalData) rowsCache.current.set(id, full.originalData);
      patchDataset(id, full);
    } catch (error) {
      console.error("Error loading dataset:", error);
    } finally {
      if (activeIdRef.current === id) setLoadingRows(false);
    }
  }, [token, logout, patchDataset]);

  const selectDataset = useCallback((ds: Dataset) => {
    activeIdRef.current = ds._id;
    const rows = ds.originalData ?? rowsCache.current.get(ds._id);
    setActiveDataset(rows ? { ...ds, originalData: rows } : ds);
    if (rows) {
      setLoadingRows(false);
    } else {
      void loadDatasetRows(ds._id);
    }
  }, [loadDatasetRows]);

  useEffect(() => {
    if (token) {
      fetchDatasets();
    }
  }, [token]);

  const fetchDatasets = async () => {
    if (!token) return;
    try {
      const resp = await fetch(`${API_URL}/api/datasets`, {
        headers: authHeaders(token)
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      const data = await resp.json();
      if (resp.ok) {
        setDatasets(data);
        if (data.length > 0) {
          // ?dataset=<id> deep links (used by the n8n notification emails)
          const requested = searchParams.get("dataset");
          selectDataset(data.find((d: Dataset) => d._id === requested) ?? data[0]);
        }
      }
    } catch (error) {
      console.error("Error fetching datasets:", error);
    } finally {
      setLoading(false);
    }
  };

  // Debounced server-side search (cached in Redis); each settled query is tracked as a search event.
  useEffect(() => {
    const term = query.trim();
    if (!token || term.length === 0) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetch(`${API_URL}/api/datasets?q=${encodeURIComponent(term)}`, {
          headers: authHeaders(token),
          signal: controller.signal,
        });
        // An expired token (401) is handled by the list/detail requests, which log the user out.
        if (!resp.ok) return;
        const results: Dataset[] = await resp.json();
        setSearchResults(results);
        if (term.length >= 2) trackSearch(term, results.length);
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error("Search failed:", error);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, token]);

  // While insights are generated in the background, poll the lightweight status endpoint.
  const activeId = activeDataset?._id;
  const activeInsightsStatus = activeDataset?.insightsStatus;
  useEffect(() => {
    if (!token || !activeId || activeInsightsStatus !== "pending") return;
    let attempts = 0;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      attempts += 1;
      if (attempts > INSIGHTS_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      try {
        const resp = await fetch(`${API_URL}/api/datasets/${activeId}/insights`, { headers: authHeaders(token) });
        if (!resp.ok || cancelled) return;
        const status: { insightsStatus: InsightsStatus; insights: string } = await resp.json();
        if (status.insightsStatus !== "pending" && !cancelled) {
          window.clearInterval(timer);
          patchDataset(activeId, { insightsStatus: status.insightsStatus, insights: status.insights });
        }
      } catch {
        // transient network error: keep polling
      }
    }, INSIGHTS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, activeId, activeInsightsStatus, patchDataset]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await fetch(`${API_URL}/api/datasets/upload`, {
        method: "POST",
        headers: authHeaders(token),
        body: formData
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      const newDataset = await resp.json();
      if (resp.ok) {
        // Append dynamically to front and set active
        if (newDataset.originalData) rowsCache.current.set(newDataset._id, newDataset.originalData);
        setDatasets(prev => [newDataset, ...prev]);
        setQuery("");
        selectDataset(newDataset);
        setActivityRefreshKey(k => k + 1);
      } else {
        alert(newDataset.msg || "Error uploading file");
      }
    } catch (error) {
      console.error(error);
      alert("Error parsing document");
    } finally {
      setUploading(false);
      // reset file input
      e.target.value = "";
    }
  };

  const regenerateInsights = async () => {
    if (!token || !activeDataset) return;
    const id = activeDataset._id;
    setRetryingInsights(true);
    try {
      const resp = await fetch(`${API_URL}/api/datasets/${id}/insights/regenerate`, {
        method: "POST",
        headers: authHeaders(token),
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      if (resp.ok) {
        patchDataset(id, { insightsStatus: "pending", insights: "" });
      } else {
        const body = await resp.json().catch(() => ({}));
        alert(body.msg || "Could not restart insight generation");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setRetryingInsights(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Loader2 className="animate-spin text-indigo-500 w-12 h-12" />
    </div>
  );

  const visibleDatasets = searchResults ?? datasets;
  const activeRows = activeDataset?.originalData;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Hello, {user?.name ? user.name.split(' ')[0] : 'User'} 👋</h1>
            <p className="text-slate-400">Here's the intelligent breakdown of your dynamic datasets.</p>
          </div>

          <div className="relative">
            <input
              type="file"
              accept=".xlsx,.csv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              onChange={handleFileUpload}
              disabled={uploading}
              data-track="upload_dataset"
              aria-label="Upload dataset"
            />
            <Button variant="primary" className="flex items-center gap-2 pointer-events-none" isLoading={uploading}>
              {!uploading && <UploadCloud size={20} />}
              {uploading ? "Analyzing & Generating..." : "Upload Dataset"}
            </Button>
          </div>
        </div>

        <ActivityPanel token={token} refreshKey={activityRefreshKey} />

        {datasets.length === 0 ? (
          <Card className="text-center py-20 bg-slate-900/50 border-dashed border-slate-700">
            <div className="bg-slate-800/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileSpreadsheet className="text-indigo-400 w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No Datasets Found</h3>
            <p className="text-slate-400 max-w-sm mx-auto">Upload an Excel (.xlsx) or CSV file to immediately generate KPIs, interactive charts, and AI-powered insights.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar list of old datasets */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Recent Datasets</h3>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search datasets..."
                  aria-label="Search datasets"
                  maxLength={100}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10 text-sm text-slate-200 placeholder-slate-500 rounded-xl pl-9 pr-9 py-2.5 outline-none transition-all"
                />
                {searching ? (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" size={16} />
                ) : query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    data-track="search_clear"
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-300"
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>

              {visibleDatasets.length === 0 && (
                <p className="text-sm text-slate-500 px-1">No datasets match "{query.trim()}".</p>
              )}
              {visibleDatasets.map(ds => (
                <button
                  key={ds._id}
                  onClick={() => selectDataset(ds)}
                  data-track="dataset_select"
                  data-track-dataset-id={ds._id}
                  data-track-source={searchResults ? "search" : "list"}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    activeDataset?._id === ds._id
                      ? "bg-indigo-600/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                      : "bg-slate-900 border-slate-800 hover:bg-slate-800"
                  }`}
                >
                  <p className="font-medium text-white line-clamp-1">{ds.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(ds.createdAt).toLocaleDateString()}
                    {typeof ds.rowCount === "number" && ` · ${ds.rowCount.toLocaleString()} rows`}
                  </p>
                </button>
              ))}
            </div>

            {/* Main Visualizations per dataset */}
            <div className="lg:col-span-3 space-y-8 animate-in fade-in zoom-in-95 duration-500">
              {activeDataset && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Object.entries(activeDataset.kpis || {}).map(([key, metrics]: any) => (
                      <Kpi
                        key={key}
                        title={`Total ${key}`}
                        value={metrics.sum}
                        trend={`Avg / row: ${metrics.avg}`}
                        type="sum"
                      />
                    ))}
                  </div>
                  {activeDataset.charts && activeDataset.charts.length > 0 && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      {activeRows ? (
                        activeDataset.charts.map((chartDef, idx) => {
                          const { data, options, componentType } = getChartConfig(chartDef, activeRows);
                          const interactiveOptions = {
                            ...options,
                            onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
                              if (!elements.length) return;
                              const label = data.labels?.[elements[0].index];
                              trackClick("chart_point", { chart: chartDef.title, label: label == null ? null : String(label) });
                            },
                          };
                          return (
                            <Card key={idx} className="h-80 flex flex-col justify-center bg-slate-900 border-slate-800/80">
                              <div className="h-full w-full">
                                {componentType === 'Bar' ? (
                                  <Bar data={data} options={interactiveOptions} />
                                ) : (
                                  <Line data={data} options={interactiveOptions} />
                                )}
                              </div>
                            </Card>
                          )
                        })
                      ) : (
                        activeDataset.charts.map((_, idx) => (
                          <Card key={idx} className="h-80 flex items-center justify-center bg-slate-900 border-slate-800/80">
                            {loadingRows ? (
                              <Loader2 className="animate-spin text-indigo-500/70 w-8 h-8" />
                            ) : (
                              <p className="text-sm text-slate-500">Chart data could not be loaded.</p>
                            )}
                          </Card>
                        ))
                      )}
                    </div>
                  )}

                  {activeDataset.insightsStatus === "pending" ? (
                    <InsightsPending />
                  ) : activeDataset.insightsStatus === "failed" ? (
                    <InsightsFailed onRetry={regenerateInsights} retrying={retryingInsights} />
                  ) : (
                    activeDataset.insights && <Aisummary insights={activeDataset.insights} />
                  )}

                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
