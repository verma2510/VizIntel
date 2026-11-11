import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChartColumn, CloudUpload, Columns3, CornerDownLeft, FileSpreadsheet, LayoutDashboard, Moon, Plus, Search, Sparkles } from "lucide-react";
import { useData } from "../../context/Data";
import { useDashboards } from "../../context/Dashboards";
import { api } from "../../lib/api";
import { trackSearch } from "../../lib/tracker";
import { getResolvedTheme, setPrefs } from "../../lib/prefs";
import { formatRelative } from "../../lib/format";
import type { Dataset } from "../../types";
import { NAV_ITEMS } from "./nav";
import { Kbd } from "../ui/Surface";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
  track?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export const CommandPalette: React.FC<{ open: boolean; onClose: () => void; onUpload: () => void }> = ({ open, onClose, onUpload }) => {
  const navigate = useNavigate();
  const { datasets } = useData();
  const { dashboards, create } = useDashboards();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Dataset[] | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRemote(null);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Server-side dataset search (Redis-cached), tracked as a search event once the query settles.
  useEffect(() => {
    const term = query.trim();
    if (!open || !term) {
      setRemote(null);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const results = await api<Dataset[]>(`/api/datasets?q=${encodeURIComponent(term)}&limit=8`, { signal: controller.signal });
        setRemote(results);
        if (term.length >= 2) trackSearch(term, results.length);
      } catch {
        // aborted or offline: local results still show
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [query, open]);

  const go = (to: string) => () => {
    navigate(to);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Item[] = [];

    const actions: Item[] = [
      { id: "a-upload", group: "Actions", label: "Upload a dataset", icon: <CloudUpload size={16} />, run: () => { onClose(); onUpload(); }, track: "cmd_upload" },
      {
        id: "a-dash",
        group: "Actions",
        label: "Create a dashboard",
        icon: <Plus size={16} />,
        run: async () => {
          onClose();
          const d = await create({ name: "Untitled dashboard" });
          navigate(`/app/dashboards/${d._id}?edit=1`);
        },
        track: "cmd_new_dashboard",
      },
      { id: "a-chart", group: "Actions", label: "Build a chart", icon: <ChartColumn size={16} />, run: go("/app/builder"), track: "cmd_new_chart" },
      { id: "a-ask", group: "Actions", label: "Ask AI about your data", icon: <Sparkles size={16} />, run: go("/app/insights#ask"), track: "cmd_ask_ai" },
      {
        id: "a-theme",
        group: "Actions",
        label: `Switch to ${getResolvedTheme() === "dark" ? "light" : "dark"} theme`,
        icon: <Moon size={16} />,
        run: () => {
          setPrefs({ theme: getResolvedTheme() === "dark" ? "light" : "dark" });
          onClose();
        },
      },
    ];
    out.push(...actions.filter((a) => match(a.label)));

    out.push(
      ...NAV_ITEMS.filter((n) => match(n.label) || match(n.description)).map((n) => ({
        id: `p-${n.to}`,
        group: "Pages",
        label: n.label,
        hint: n.description,
        icon: <n.icon size={16} />,
        run: go(n.to),
      }))
    );

    const dsList = (remote ?? datasets.filter((d) => match(d.name))).slice(0, 6);
    out.push(
      ...dsList.map((d) => ({
        id: `d-${d._id}`,
        group: "Datasets",
        label: d.name,
        hint: `${d.rowCount?.toLocaleString() ?? "?"} rows · ${formatRelative(d.createdAt)}`,
        icon: <FileSpreadsheet size={16} />,
        run: go(`/app/insights/${d._id}`),
        track: "cmd_open_dataset",
      }))
    );

    out.push(
      ...dashboards
        .filter((d) => match(d.name))
        .slice(0, 5)
        .map((d) => ({
          id: `b-${d._id}`,
          group: "Dashboards",
          label: d.name,
          hint: `${d.widgets.length} widgets`,
          icon: <LayoutDashboard size={16} />,
          run: go(`/app/dashboards/${d._id}`),
        }))
    );

    if (q.length >= 2) {
      const cols: Item[] = [];
      for (const d of datasets) {
        for (const c of d.columns ?? []) {
          if (cols.length >= 6) break;
          if (c.name.toLowerCase().includes(q) || (c.label ?? "").toLowerCase().includes(q)) {
            cols.push({
              id: `c-${d._id}-${c.name}`,
              group: "Columns",
              label: c.label && c.label !== c.name ? `${c.label} (${c.name})` : c.name,
              hint: `in ${d.name}`,
              icon: <Columns3 size={16} />,
              run: go(`/app/explore/${d._id}?column=${encodeURIComponent(c.name)}`),
            });
          }
        }
      }
      out.push(...cols);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, remote, datasets, dashboards]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";
  return createPortal(
    <div className="no-print fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(8_10_14/0.5)] backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="relative w-full max-w-xl animate-pop overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search datasets, dashboards, columns or type a command…"
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
            maxLength={100}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="cmdk-list" role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
          {items.length === 0 && <p className="px-3 py-10 text-center text-sm text-ink-3">No results for “{query}”.</p>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <React.Fragment key={item.id}>
                {header && <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">{header}</p>}
                <button
                  id={`cmdk-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  data-track={item.track}
                  onMouseMove={() => setActive(i)}
                  onClick={() => item.run()}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === active ? "bg-surface-3" : ""}`}
                >
                  <span className={i === active ? "text-brand" : "text-ink-3"}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{item.label}</span>
                    {item.hint && <span className="block truncate text-xs text-ink-3">{item.hint}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={14} className="text-ink-3" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
