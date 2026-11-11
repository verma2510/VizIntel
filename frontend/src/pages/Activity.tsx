import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CloudUpload, Eye, History, MousePointerClick, Search, Users } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { getPrepared } from "../lib/data/prepare";
import { formatDate, formatInteger, formatRelative } from "../lib/format";
import { NAV_ITEMS } from "../components/layout/nav";
import { useData } from "../context/Data";
import type { ActivityEvent, ActivitySummary, Dataset } from "../types";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from "../components/ui/Surface";
import { Button } from "../components/ui/Button";
import { ChartCard } from "../components/charts/ChartCard";

const DAYS = [7, 30, 90] as const;
type EventFilter = "all" | ActivityEvent["type"];

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function pageLabel(path: string | null): string {
  if (!path) return "a page";
  if (path.startsWith("/share/")) return "a shared dashboard";
  const match = NAV_ITEMS.filter((n) => (n.end ? path === n.to : path.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  if (path === "/") return "the landing page";
  if (path === "/login" || path === "/register") return humanize(path.slice(1));
  return path;
}

const EVENT_META: Record<ActivityEvent["type"], { icon: React.ComponentType<{ size?: number }>; label: string }> = {
  page_view: { icon: Eye, label: "Page view" },
  click: { icon: MousePointerClick, label: "Click" },
  search: { icon: Search, label: "Search" },
  dataset_uploaded: { icon: CloudUpload, label: "Upload" },
};

function describeEvent(e: ActivityEvent): string {
  switch (e.type) {
    case "page_view":
      return `Viewed ${pageLabel(e.path)}`;
    case "search":
      return `Searched “${e.properties.query ?? e.key ?? ""}”${typeof e.properties.resultCount === "number" ? ` · ${e.properties.resultCount} results` : ""}`;
    case "dataset_uploaded":
      return `Uploaded a dataset${typeof e.properties.rowCount === "number" ? ` · ${formatInteger(e.properties.rowCount)} rows` : ""}`;
    default: {
      const target = humanize(String(e.properties.target ?? e.key ?? "element"));
      const detail = e.properties.label ?? e.properties.kind ?? e.properties.type ?? e.properties.to ?? null;
      return `${target}${detail ? ` · ${detail}` : ""} on ${pageLabel(e.path)}`;
    }
  }
}

/** The activity series as an in-memory dataset, so the standard chart engine can plot it. */
function activityDataset(summary: ActivitySummary): Dataset {
  return {
    _id: "activity",
    name: "Activity",
    createdAt: new Date().toISOString(),
    columns: [
      { name: "day", type: "date", semanticType: "date", label: "Day" },
      { name: "pageViews", type: "numeric", semanticType: "quantity", label: "Page views" },
      { name: "clicks", type: "numeric", semanticType: "quantity", label: "Clicks" },
      { name: "searches", type: "numeric", semanticType: "quantity", label: "Searches" },
      { name: "uploads", type: "numeric", semanticType: "quantity", label: "Uploads" },
    ],
    originalData: summary.series ?? [],
  };
}

const RankedList: React.FC<{ items: { key: string; count: number }[]; format?: (k: string) => string; empty: string }> = ({ items, format = (k) => k, empty }) => {
  if (!items.length) return <p className="py-6 text-center text-[13px] text-ink-3">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key} className="text-[13px]">
          <div className="mb-1 flex justify-between gap-3">
            <span className="truncate text-ink">{format(i.key)}</span>
            <span className="vz-num text-ink-3">{formatInteger(i.count)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

export const Activity: React.FC = () => {
  const { datasets } = useData();
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [filter, setFilter] = useState<EventFilter>("all");
  const [feed, setFeed] = useState<{ key: string; items: ActivityEvent[]; nextBefore: string | null; error: boolean } | null>(null);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<ActivitySummary>(`/api/activity/summary?days=${days}`, { signal: controller.signal }).then(
      (s) => {
        setSummary(s);
        setSummaryError(null);
      },
      (err) => {
        if ((err as Error).name !== "AbortError") setSummaryError(errorMessage(err));
      }
    );
    return () => controller.abort();
  }, [days, summaryAttempt]);

  const fetchEvents = useCallback(
    (before?: string, signal?: AbortSignal) => {
      const qs = new URLSearchParams({ limit: "40" });
      if (before) qs.set("before", before);
      if (filter !== "all") qs.set("type", filter);
      return api<{ items: ActivityEvent[]; nextBefore: string | null }>(`/api/activity/events?${qs}`, { signal });
    },
    [filter]
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = `${filter}:${feedAttempt}`;
    fetchEvents(undefined, controller.signal).then(
      (res) => setFeed({ key, items: res.items, nextBefore: res.nextBefore, error: false }),
      (err) => {
        if ((err as Error).name !== "AbortError") setFeed({ key, items: [], nextBefore: null, error: true });
      }
    );
    return () => controller.abort();
  }, [fetchEvents, filter, feedAttempt]);

  const feedCurrent = feed && feed.key === `${filter}:${feedAttempt}` ? feed : null;
  const events = feedCurrent?.items ?? [];
  const nextBefore = feedCurrent?.nextBefore ?? null;
  const eventsState: "loading" | "ready" | "error" = !feedCurrent || loadingMore ? "loading" : feedCurrent.error ? "error" : "ready";

  const loadMore = async () => {
    if (!feedCurrent?.nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await fetchEvents(feedCurrent.nextBefore);
      setFeed((f) => (f && f.key === feedCurrent.key ? { ...f, items: [...f.items, ...res.items], nextBefore: res.nextBefore } : f));
    } catch {
      // keep what we have; the button stays available to retry
    } finally {
      setLoadingMore(false);
    }
  };

  const ds = useMemo(() => (summary?.series?.length ? getPrepared(activityDataset(summary)) : null), [summary]);
  const datasetName = useMemo(() => new Map(datasets.map((d) => [d._id, d.name])), [datasets]);

  const tiles = summary
    ? [
        { label: "Page views", value: summary.totals.pageViews, icon: Eye },
        { label: "Clicks", value: summary.totals.clicks, icon: MousePointerClick },
        { label: "Searches", value: summary.totals.searches, icon: Search },
        { label: "Uploads", value: summary.totals.uploads, icon: CloudUpload },
        { label: "Sessions", value: summary.totals.sessions, icon: Users },
      ]
    : [];

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Account"
        title="Activity"
        description="Your interactions, streamed through Kafka and rolled up per day. New events appear within a few seconds."
        actions={<Segmented ariaLabel="Period" value={String(days)} onChange={(v) => setDays(Number(v) as (typeof DAYS)[number])} options={DAYS.map((d) => ({ value: String(d), label: `${d} days` }))} />}
      />

      {summaryError ? (
        <Card className="mb-6">
          <ErrorState compact message={summaryError} onRetry={() => setSummaryAttempt((a) => a + 1)} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summary
            ? tiles.map((t) => (
                <Card key={t.label} className="p-4">
                  <p className="flex items-center justify-between text-[13px] text-ink-2">
                    {t.label}
                    <span className="text-ink-3">
                      <t.icon size={15} />
                    </span>
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatInteger(t.value)}</p>
                </Card>
              ))
            : [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)}
        </div>
      )}

      {ds && (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(["pageViews", "clicks", "searches", "uploads"] as const).map((m) => (
            <ChartCard key={m} ds={ds} idx={ds.allIndices()} spec={{ type: "bar", x: "day", y: [m], agg: "sum", bucket: days > 45 ? "week" : "day" }} title={ds.field(m)?.label} height={150} compact readOnly />
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false}>
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">Recent activity</h2>
            <Segmented
              size="sm"
              ariaLabel="Event type"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "page_view", label: "Views" },
                { value: "click", label: "Clicks" },
                { value: "search", label: "Searches" },
                { value: "dataset_uploaded", label: "Uploads" },
              ]}
            />
          </div>
          {eventsState === "error" && !events.length ? (
            <ErrorState compact message="Couldn't load your activity timeline." onRetry={() => setFeedAttempt((a) => a + 1)} />
          ) : eventsState === "ready" && !events.length ? (
            <EmptyState compact icon={<History size={18} />} title="No activity recorded yet" description="Events appear here once they've been processed by the activity pipeline. Tracking can be turned off in Settings." />
          ) : (
            <ol className="divide-y divide-line">
              {events.map((e) => {
                const meta = EVENT_META[e.type] ?? EVENT_META.click;
                const dsId = typeof e.properties.datasetId === "string" ? e.properties.datasetId : null;
                return (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2" title={meta.label}>
                      <meta.icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{describeEvent(e)}</p>
                      {dsId && datasetName.get(dsId) && (
                        <Link to={`/app/insights/${dsId}`} className="text-xs text-brand-ink hover:underline">
                          {datasetName.get(dsId)}
                        </Link>
                      )}
                    </div>
                    <time className="shrink-0 text-xs text-ink-3" dateTime={e.occurredAt} title={formatDate(e.occurredAt, "datetime")}>
                      {formatRelative(e.occurredAt)}
                    </time>
                  </li>
                );
              })}
              {eventsState === "loading" &&
                [0, 1, 2].map((i) => (
                  <li key={`s${i}`} className="px-5 py-3">
                    <Skeleton className="h-4 w-2/3" />
                  </li>
                ))}
            </ol>
          )}
          {nextBefore && eventsState === "ready" && (
            <div className="border-t border-line p-3 text-center">
              <Button variant="ghost" size="sm" onClick={loadMore}>
                Load older activity
              </Button>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Most visited" description={`Last ${days} days`} />
            {summary ? <RankedList items={summary.topPages ?? []} format={pageLabel} empty="No page views yet." /> : <Skeleton className="h-24" />}
          </Card>
          <Card>
            <CardHeader title="Top searches" description={`Last ${days} days`} />
            {summary ? <RankedList items={summary.topSearches} format={(k) => `“${k}”`} empty="No searches yet." /> : <Skeleton className="h-24" />}
          </Card>
          <Card>
            <CardHeader title="Upload history" description={`${datasets.length} datasets`} />
            {datasets.length ? (
              <ol className="relative space-y-3 border-l border-line pl-4">
                {datasets.slice(0, 8).map((d) => (
                  <li key={d._id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" />
                    <Link to={`/app/insights/${d._id}`} className="block truncate text-[13px] font-medium text-ink hover:underline">
                      {d.name}
                    </Link>
                    <p className="text-xs text-ink-3">
                      {formatInteger(d.rowCount ?? 0)} rows · {formatDate(d.createdAt, "datetime")}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-ink-3">No uploads yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
