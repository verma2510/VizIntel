import React from "react";
import ReactMarkdown from "react-markdown";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { InsightsStatus } from "../../types";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Surface";

export const InsightsDot: React.FC<{ status?: InsightsStatus }> = ({ status = "ready" }) => (
  <span
    className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === "pending" ? "animate-pulse bg-warn" : status === "failed" ? "bg-bad" : "bg-good"}`}
    title={status === "pending" ? "AI insights generating" : status === "failed" ? "AI insights failed" : "AI insights ready"}
    aria-label={status === "pending" ? "AI insights generating" : status === "failed" ? "AI insights failed" : "AI insights ready"}
  />
);

/** The Groq-generated narrative, restyled: each bullet becomes a scannable insight row. */
export const AiNarrative: React.FC<{ insights: string; compact?: boolean }> = ({ insights, compact }) => (
  <div className={`vz-prose text-[14px] text-ink-2 ${compact ? "text-[13px]" : ""}`}>
    <ReactMarkdown
      components={{
        ul: ({ children }) => <ul className="mb-0 space-y-2.5">{children}</ul>,
        li: ({ children }) => (
          <li className="flex gap-2.5 leading-relaxed">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-volt ring-2 ring-volt/30" aria-hidden="true" />
            <span className="min-w-0">{children}</span>
          </li>
        ),
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-brand-ink underline">
            {children}
          </a>
        ),
      }}
    >
      {insights}
    </ReactMarkdown>
  </div>
);

/** Shown while insights are generated in the background (async mode). */
export const InsightsPending: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <div>
    <p className="mb-4 flex items-center gap-2 text-[13px] text-ink-2">
      <Sparkles size={15} className="animate-pulse text-ink" />
      Writing insights in the background — KPIs, charts and signals below are already live.
    </p>
    <div className="space-y-3" aria-hidden="true">
      {(compact ? [88, 72] : [94, 81, 88, 67]).map((w) => (
        <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />
      ))}
    </div>
  </div>
);

/** Shown when generation failed; the backend (and n8n's sweeper) can retry it. */
export const InsightsFailed: React.FC<{ onRetry: () => void; retrying: boolean }> = ({ onRetry, retrying }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
    <TriangleAlert className="shrink-0 text-warn" size={20} />
    <p className="flex-1 text-[13px] leading-relaxed text-ink-2">
      The AI narrative couldn't be generated yet. Failed generations are retried automatically, or you can retry now. Statistical signals are unaffected.
    </p>
    <Button variant="secondary" size="sm" onClick={onRetry} isLoading={retrying} data-track="insights_retry">
      {!retrying && <RefreshCw size={14} />}
      Retry
    </Button>
  </div>
);
