import React from "react";
import { Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";

const Heading: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 mb-2 flex items-center gap-2">
    AI-Powered Insights
    {children}
  </h2>
);

/** Shown while insights are generated in the background (async mode). */
export const InsightsPending: React.FC = () => (
  <Card className="relative overflow-hidden bg-gradient-to-br from-indigo-900/30 via-purple-900/10 to-slate-900 border-indigo-500/30">
    <div className="relative z-10 flex items-start gap-4">
      <div className="p-3 bg-indigo-500/20 rounded-xl mt-1 ring-1 ring-indigo-500/50">
        <Sparkles className="text-indigo-400" size={24} />
      </div>
      <div className="flex-1">
        <Heading>
          <Loader2 className="animate-spin text-indigo-400" size={18} />
        </Heading>
        <p className="text-slate-400 text-sm mb-5">
          Generating insights in the background. Your KPIs and charts are ready to explore in the meantime.
        </p>
        <div className="space-y-3 animate-pulse" aria-hidden="true">
          {[92, 78, 85, 64].map((width) => (
            <div key={width} className="h-3 bg-slate-700/60 rounded" style={{ width: `${width}%` }} />
          ))}
        </div>
      </div>
    </div>
  </Card>
);

interface InsightsFailedProps {
  onRetry: () => void;
  retrying: boolean;
}

/** Shown when generation failed; the backend (and n8n's sweeper) can retry it. */
export const InsightsFailed: React.FC<InsightsFailedProps> = ({ onRetry, retrying }) => (
  <Card className="bg-slate-900 border-amber-500/30">
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="p-3 bg-amber-500/10 rounded-xl ring-1 ring-amber-500/30 self-start">
        <TriangleAlert className="text-amber-400" size={24} />
      </div>
      <div className="flex-1">
        <Heading />
        <p className="text-slate-400 text-sm">
          We couldn't generate insights for this dataset yet. Failed generations are retried automatically, or you can retry now.
        </p>
      </div>
      <Button variant="secondary" onClick={onRetry} isLoading={retrying} data-track="insights_retry" className="flex items-center gap-2">
        {!retrying && <RefreshCw size={16} />}
        Retry
      </Button>
    </div>
  </Card>
);
