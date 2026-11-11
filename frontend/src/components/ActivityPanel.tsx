import React, { useEffect, useState } from "react";
import { Activity, Eye, MousePointerClick, Search, UploadCloud } from "lucide-react";
import { API_URL, authHeaders } from "../lib/api";

interface ActivitySummary {
  days: number;
  totals: { pageViews: number; clicks: number; searches: number; uploads: number; sessions: number };
  topSearches: { key: string; count: number }[];
  lastEventAt: string | null;
}

interface ActivityPanelProps {
  token: string | null;
  refreshKey?: number;
}

const REFRESH_MS = 30000;

/**
 * The user's own interaction metrics, as rolled up by the Kafka activity consumer. Numbers are
 * eventually consistent (events are batched, streamed and aggregated asynchronously), so the panel
 * refreshes periodically. It is non-critical: on any error it simply stays hidden.
 */
export const ActivityPanel: React.FC<ActivityPanelProps> = ({ token, refreshKey = 0 }) => {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/activity/summary?days=7`, { headers: authHeaders(token) });
        if (!resp.ok) return;
        const data: ActivitySummary = await resp.json();
        if (!cancelled) setSummary(data);
      } catch {
        // Activity is a nice-to-have; never surface errors for it.
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, refreshKey]);

  if (!summary) return null;

  const stats = [
    { label: "Page views", value: summary.totals.pageViews, icon: Eye },
    { label: "Clicks", value: summary.totals.clicks, icon: MousePointerClick },
    { label: "Searches", value: summary.totals.searches, icon: Search },
    { label: "Uploads", value: summary.totals.uploads, icon: UploadCloud },
  ];

  return (
    <section className="mb-10" aria-label="Your activity">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Activity size={14} />
          Your activity · last {summary.days} days
        </h3>
        {summary.topSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Top searches:</span>
            {summary.topSearches.slice(0, 3).map((s) => (
              <span key={s.key} className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {s.key}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Icon size={18} />
            </div>
            <div>
              <p className="text-xl font-bold text-white leading-tight">{value.toLocaleString()}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
