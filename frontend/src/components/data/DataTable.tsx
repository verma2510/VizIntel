import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import type { FieldRole, PreparedDataset } from "../../lib/data/prepare";
import { formatCell, sortIndices } from "../../lib/data/display";
import { formatInteger } from "../../lib/format";
import { ROLE_META } from "./roleMeta";
import { usePrefs } from "../../lib/prefs";

export const RoleIcon: React.FC<{ role: FieldRole; size?: number }> = ({ role, size = 13 }) => {
  const { icon: Icon, tone, label } = ROLE_META[role];
  return (
    <span title={label} className={`inline-flex ${tone}`}>
      <Icon size={size} />
    </span>
  );
};

interface DataTableProps {
  ds: PreparedDataset;
  idx: Uint32Array;
  columns?: string[];
  pageSize?: number;
  highlight?: string;
  onColumnClick?: (column: string) => void;
  maxHeight?: number | string;
  dense?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({ ds, idx, columns, pageSize = 50, highlight, onColumnClick, maxHeight = 560, dense }) => {
  usePrefs();
  const cols = columns?.length ? columns.filter((c) => ds.has(c)) : ds.fields.map((f) => f.name);
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => (sort ? sortIndices(ds, idx, sort.column, sort.dir) : idx), [ds, idx, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = sorted.subarray(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (column: string) => {
    setPage(0);
    setSort((s) => (s?.column !== column ? { column, dir: "desc" } : s.dir === "desc" ? { column, dir: "asc" } : null));
  };

  if (!idx.length) return <p className="px-4 py-10 text-center text-sm text-ink-3">No rows match the current filters.</p>;

  return (
    <div className="flex flex-col">
      <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-20 w-12 border-b border-r border-line bg-surface-2 px-3 py-2 text-right font-mono text-[11px] font-normal text-ink-3">
                #
              </th>
              {cols.map((c) => {
                const f = ds.field(c)!;
                const active = sort?.column === c;
                return (
                  <th
                    key={c}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 py-0 font-medium ${highlight === c ? "bg-brand-soft" : ""} ${f.role === "measure" ? "text-right" : "text-left"}`}
                  >
                    <span className={`flex items-center gap-1.5 ${f.role === "measure" ? "justify-end" : ""}`}>
                      <RoleIcon role={f.role} size={12} />
                      <button type="button" onClick={() => (onColumnClick ? onColumnClick(c) : toggleSort(c))} className="py-2 text-ink-2 hover:text-ink" title={onColumnClick ? `Profile ${f.label}` : `Sort by ${f.label}`}>
                        {f.label}
                      </button>
                      <button type="button" onClick={() => toggleSort(c)} aria-label={`Sort by ${f.label}`} className={`rounded p-0.5 ${active ? "text-brand" : "text-ink-3 opacity-50 hover:opacity-100"}`}>
                        {active && sort!.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                      </button>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from(slice, (rowIdx, k) => (
              <tr key={rowIdx} className="group">
                <td className="sticky left-0 border-b border-r border-line bg-surface px-3 text-right font-mono text-[11px] text-ink-3 group-hover:bg-surface-2">{formatInteger(current * pageSize + k + 1)}</td>
                {cols.map((c) => {
                  const f = ds.field(c)!;
                  const text = formatCell(ds, c, rowIdx);
                  return (
                    <td
                      key={c}
                      className={`max-w-[280px] truncate whitespace-nowrap border-b border-line px-3 ${dense ? "py-1" : "py-1.5"} group-hover:bg-surface-2 ${f.role === "measure" ? "vz-num text-right text-ink" : "text-ink-2"} ${highlight === c ? "bg-brand-soft/50" : ""}`}
                      title={text}
                    >
                      {text || <span className="text-ink-3/60">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-ink-3">
        <span className="vz-num">
          {formatInteger(current * pageSize + 1)}–{formatInteger(Math.min(sorted.length, (current + 1) * pageSize))} of {formatInteger(sorted.length)} rows
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded-md p-1 hover:bg-surface-3 disabled:opacity-40" aria-label="Previous page">
              <ChevronLeft size={15} />
            </button>
            <span className="vz-num px-1">
              {current + 1} / {pages}
            </span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded-md p-1 hover:bg-surface-3 disabled:opacity-40" aria-label="Next page">
              <ChevronRight size={15} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
};
