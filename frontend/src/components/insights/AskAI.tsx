import React, { useMemo, useState } from "react";
import { ArrowUp, Bot, CircleAlert, Sparkles } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { buildChart, type DrillTarget } from "../../lib/chart/engine";
import { naturalAgg } from "../../lib/analysis";
import type { PreparedDataset } from "../../lib/data/prepare";
import { useResolvedTheme } from "../../lib/prefs";
import type { AskResponse, ChartSpec } from "../../types";
import { ChartCard } from "../charts/ChartCard";
import { Badge } from "../ui/Surface";

interface Turn {
  question: string;
  status: "loading" | "done" | "error";
  answer?: AskResponse;
  error?: string;
}

const toSpec = (partial: Partial<ChartSpec>): ChartSpec => ({
  type: partial.type ?? "bar",
  title: partial.title,
  x: partial.x,
  y: partial.y ?? [],
  agg: partial.agg ?? "sum",
  groupBy: partial.groupBy,
  bucket: partial.bucket,
  sort: partial.sort,
  limit: partial.limit,
  size: partial.size,
});

/** Starter questions derived from the dataset's own columns. */
function suggestions(ds: PreparedDataset): string[] {
  const m = ds.measures[0];
  const m2 = ds.measures[1];
  const d = ds.dimensions.find((f) => ds.distinctCount(f.name) <= 50);
  const t = ds.primaryDate;
  const out: string[] = [];
  if (m && d) out.push(`Which ${d.label} has the highest ${m.label}?`);
  if (m && t) out.push(`How has ${m.label} changed over time?`);
  if (m && d && naturalAgg(m) === "sum") out.push(`What share of ${m.label} comes from each ${d.label}?`);
  if (m && m2) out.push(`Is ${m.label} related to ${m2.label}?`);
  if (m) out.push(`What does the distribution of ${m.label} look like?`);
  if (!m && d) out.push(`How many rows are there per ${d.label}?`);
  return out.slice(0, 4);
}

const Facts: React.FC<{ ds: PreparedDataset; idx: Uint32Array; spec: ChartSpec }> = ({ ds, idx, spec }) => {
  const theme = useResolvedTheme();
  const facts = useMemo(() => buildChart({ ds, idx, spec, theme }).facts, [ds, idx, spec, theme]);
  if (!facts.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {facts.map((f) => (
        <li key={f} className="flex gap-2 text-[13px] text-ink">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
          {f}
        </li>
      ))}
    </ul>
  );
};

/**
 * Ask-your-data: the LLM proposes an answer + chart spec from column metadata; the chart and the "computed
 * facts" are calculated locally from the (filtered) rows, so the numbers are always exact.
 */
export const AskAI: React.FC<{ ds: PreparedDataset; idx: Uint32Array; onDrill?: (t: DrillTarget) => void }> = ({ ds, idx, onDrill }) => {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => t.status === "loading");

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setQuestion("");
    setTurns((t) => [{ question: text, status: "loading" } as Turn, ...t].slice(0, 6));
    try {
      const answer = await api<AskResponse>(`/api/datasets/${ds.id}/ask`, { method: "POST", body: { question: text } });
      setTurns((t) => t.map((x, i): Turn => (i === 0 ? { ...x, status: "done", answer } : x)));
    } catch (err) {
      setTurns((t) => t.map((x, i): Turn => (i === 0 ? { ...x, status: "error", error: errorMessage(err, "The AI could not answer that.") } : x)));
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="relative"
      >
        <Sparkles size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about ${ds.name}…`}
          maxLength={500}
          aria-label="Ask a question about this dataset"
          className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-14 text-[14.5px] text-ink shadow-card-sm outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-brand focus:ring-4 focus:ring-brand-soft"
        />
        <button
          type="submit"
          disabled={question.trim().length < 3 || busy}
          data-track="ask_ai_submit"
          aria-label="Ask"
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-volt text-volt-ink transition-opacity disabled:opacity-40"
        >
          <ArrowUp size={16} />
        </button>
      </form>
      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions(ds).map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} data-track="ask_ai_suggestion" className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {turns.map((t, i) => (
          <div key={`${t.question}-${i}`} className="animate-rise">
            <p className="flex items-start gap-2 text-[13.5px] font-medium text-ink">
              <span className="mt-0.5 rounded bg-surface-3 px-1 font-mono text-[10px] text-ink-3">Q</span>
              {t.question}
            </p>
            {t.status === "loading" && (
              <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-3">
                <Bot size={15} className="animate-pulse" /> Thinking…
              </p>
            )}
            {t.status === "error" && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                <CircleAlert size={15} className="mt-0.5 shrink-0" /> {t.error}
              </p>
            )}
            {t.status === "done" && t.answer && (
              <div className="mt-2">
                {t.answer.answer && <p className="text-[13.5px] leading-relaxed text-ink-2">{t.answer.answer}</p>}
                {t.answer.chart && (
                  <>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge tone="neutral">Computed from {idx.length.toLocaleString()} rows</Badge>
                    </div>
                    <Facts ds={ds} idx={idx} spec={toSpec(t.answer.chart)} />
                    <ChartCard ds={ds} idx={idx} spec={toSpec(t.answer.chart)} height={240} className="mt-3" onDrill={onDrill} />
                  </>
                )}
                {t.answer.followUps.length > 0 && i === 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.answer.followUps.map((f) => (
                      <button key={f} type="button" onClick={() => void ask(f)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
