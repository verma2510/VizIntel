import React, { useMemo, useState } from "react";
import { CalendarRange, Check, ListFilter, Plus, X } from "lucide-react";
import type { DateRange, Filter, FilterOp } from "../../types";
import { DATE_PRESETS, describeDateRange, describeFilter, newId } from "../../lib/data/filters";
import type { PreparedDataset } from "../../lib/data/prepare";
import { formatInteger } from "../../lib/format";
import { Popover } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Select, SearchInput, inputClass } from "../ui/Field";
import { Segmented } from "../ui/Surface";
import { RoleIcon } from "./DataTable";

const toDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Builds a filter for one column: value checklist, numeric range, date range, or text match. */
const FilterEditor: React.FC<{ ds: PreparedDataset; initial?: Filter; onApply: (f: Filter) => void; onCancel: () => void }> = ({ ds, initial, onApply, onCancel }) => {
  const filterable = ds.fields.filter((f) => f.role !== "text" || ds.distinctCount(f.name) <= 500);
  const [column, setColumn] = useState(initial?.column ?? filterable[0]?.name ?? "");
  const field = ds.field(column);
  const role = field?.role;
  const initialValues = initial && initial.column === column && Array.isArray(initial.value) ? initial.value.map(String) : [];
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.op === "in" || initial?.op === "nin" ? initialValues : []));
  const [exclude, setExclude] = useState(initial?.op === "nin");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<[string, string]>(() => {
    if (initial && Array.isArray(initial.value) && (initial.op === "between" || initial.op === "dateBetween")) {
      const [a, b] = initial.value;
      return initial.op === "dateBetween" ? [a ? toDateInput(Number(a)) : "", b ? toDateInput(Number(b)) : ""] : [String(a ?? ""), String(b ?? "")];
    }
    return ["", ""];
  });
  const [text, setText] = useState(initial?.op === "contains" ? String(initial.value ?? "") : "");

  const values = useMemo(() => (column && (role === "dimension" || role === "identifier" || role === "text") ? ds.entityOrder(column) : []), [ds, column, role]);
  const counts = useMemo(() => {
    if (!values.length) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const s of ds.str(column)) m.set(s, (m.get(s) || 0) + 1);
    return m;
  }, [ds, column, values]);
  const shown = values.filter((v) => v.toLowerCase().includes(search.toLowerCase())).slice(0, 200);

  const changeColumn = (c: string) => {
    setColumn(c);
    setSelected(new Set());
    setRange(["", ""]);
    setText("");
  };

  const apply = () => {
    const id = initial?.id ?? newId();
    if (role === "measure") return onApply({ id, column, op: "between", value: [range[0], range[1]] });
    if (role === "date") {
      const from = range[0] ? Date.parse(range[0]) : "";
      const to = range[1] ? Date.parse(range[1]) + 864e5 - 1 : "";
      return onApply({ id, column, op: "dateBetween", value: [from, to] });
    }
    if (values.length > 200 && text) return onApply({ id, column, op: "contains", value: text });
    const op: FilterOp = exclude ? "nin" : "in";
    onApply({ id, column, op, value: [...selected] });
  };

  const canApply = role === "measure" || role === "date" ? Boolean(range[0] || range[1]) : selected.size > 0 || Boolean(text);

  return (
    <div className="p-2">
      <Select
        size="sm"
        value={column}
        onChange={(e) => changeColumn(e.target.value)}
        options={filterable.map((f) => ({ value: f.name, label: f.label }))}
        aria-label="Column to filter"
      />
      <div className="mt-2.5">
        {role === "measure" && (
          <div className="flex items-center gap-2">
            <input className={`${inputClass} h-8 text-[13px]`} inputMode="decimal" placeholder="Min" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} aria-label="Minimum" />
            <span className="text-ink-3">–</span>
            <input className={`${inputClass} h-8 text-[13px]`} inputMode="decimal" placeholder="Max" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} aria-label="Maximum" />
          </div>
        )}
        {role === "date" && (
          <div className="flex items-center gap-2">
            <input type="date" className={`${inputClass} h-8 text-[13px]`} value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} aria-label="From date" />
            <span className="text-ink-3">–</span>
            <input type="date" className={`${inputClass} h-8 text-[13px]`} value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} aria-label="To date" />
          </div>
        )}
        {role && role !== "measure" && role !== "date" && (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Segmented
                size="sm"
                ariaLabel="Include or exclude"
                value={exclude ? "nin" : "in"}
                onChange={(v) => setExclude(v === "nin")}
                options={[
                  { value: "in", label: "Include" },
                  { value: "nin", label: "Exclude" },
                ]}
              />
              <span className="text-xs text-ink-3">{selected.size} selected</span>
            </div>
            <SearchInput value={values.length > 200 ? text || search : search} onChange={(v) => (values.length > 200 ? (setText(v), setSearch(v)) : setSearch(v))} placeholder={values.length > 200 ? "Contains text…" : "Search values"} />
            <ul className="mt-2 max-h-52 overflow-y-auto">
              {shown.map((v) => {
                const on = selected.has(v);
                return (
                  <li key={v}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (on) next.delete(v);
                          else next.add(v);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-surface-3"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-line-strong"}`}>{on && <Check size={11} />}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{v}</span>
                      <span className="vz-num text-xs text-ink-3">{formatInteger(counts.get(v) ?? 0)}</span>
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-ink-3">No matching values</li>}
            </ul>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-1.5 border-t border-line pt-2.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={apply} disabled={!canApply} data-track="filter_apply" data-track-column={column}>
          Apply filter
        </Button>
      </div>
    </div>
  );
};

/** One row of filter chips + "Add filter", scoped to everything below it. */
export const FilterBar: React.FC<{
  ds: PreparedDataset | null;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  children?: React.ReactNode;
  className?: string;
}> = ({ ds, filters, onChange, children, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>
    {children}
    {filters.map((f) => {
      const field = ds?.field(f.column);
      return (
        <span key={f.id} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 pr-1 text-[13px] ${field ? "border-brand/30 bg-brand-soft text-brand-ink" : "border-line bg-surface-2 text-ink-3 line-through"}`} title={field ? undefined : "This dataset has no such column"}>
          {field && <RoleIcon role={field.role} size={12} />}
          {ds ? (
            <Popover
              width={300}
              trigger={({ toggle, ref }) => (
                <button ref={ref} type="button" onClick={toggle} className="max-w-[260px] truncate font-medium">
                  {describeFilter(f, field?.label)}
                </button>
              )}
            >
              {(close) => (
                <FilterEditor
                  ds={ds}
                  initial={f}
                  onCancel={close}
                  onApply={(next) => {
                    onChange(filters.map((x) => (x.id === f.id ? next : x)));
                    close();
                  }}
                />
              )}
            </Popover>
          ) : (
            <span className="max-w-[260px] truncate font-medium">{describeFilter(f)}</span>
          )}
          <button type="button" onClick={() => onChange(filters.filter((x) => x.id !== f.id))} className="rounded p-0.5 hover:bg-brand/10" aria-label={`Remove filter ${describeFilter(f, field?.label)}`}>
            <X size={13} />
          </button>
        </span>
      );
    })}
    {ds && (
      <Popover
        width={300}
        trigger={({ toggle, ref }) => (
          <Button ref={ref} variant="secondary" size="sm" onClick={toggle} data-track="filter_add">
            {filters.length ? <Plus size={14} /> : <ListFilter size={14} />}
            {filters.length ? "Filter" : "Add filter"}
          </Button>
        )}
      >
        {(close) => (
          <FilterEditor
            ds={ds}
            onCancel={close}
            onApply={(f) => {
              onChange([...filters, f]);
              close();
            }}
          />
        )}
      </Popover>
    )}
    {filters.length > 1 && (
      <button type="button" onClick={() => onChange([])} className="text-[13px] text-ink-3 hover:text-ink hover:underline">
        Clear all
      </button>
    )}
  </div>
);

export const DateRangePicker: React.FC<{ value: DateRange | undefined; onChange: (r: DateRange) => void; disabled?: boolean; hint?: string }> = ({ value, onChange, disabled, hint }) => {
  const current = value ?? { preset: "all" };
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");
  return (
    <Popover
      width={260}
      trigger={({ toggle, ref }) => (
        <Button ref={ref} variant="secondary" size="sm" onClick={toggle} disabled={disabled} title={disabled ? "This data has no date column" : hint} data-track="date_range_open">
          <CalendarRange size={14} />
          {describeDateRange(current)}
        </Button>
      )}
    >
      {(close) => (
        <div className="py-1">
          {DATE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                onChange({ preset: p.value });
                close();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-surface-3"
            >
              <span className="w-4">{current.preset === p.value && <Check size={15} strokeWidth={2.5} className="text-brand" />}</span>
              {p.label}
            </button>
          ))}
          <div className="mt-1 border-t border-line px-2.5 pt-2.5">
            <p className="mb-1.5 text-xs font-medium text-ink-2">Custom range</p>
            <div className="space-y-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} h-8 text-[13px]`} aria-label="From" />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} h-8 text-[13px]`} aria-label="To" />
            </div>
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!from && !to}
              onClick={() => {
                onChange({ preset: "custom", from: from || undefined, to: to || undefined });
                close();
              }}
            >
              Apply range
            </Button>
            <p className="mt-2 pb-1 text-[11px] leading-snug text-ink-3">“Latest” ranges count back from the most recent date in your data.</p>
          </div>
        </div>
      )}
    </Popover>
  );
};

/** Chips for page-level cross-filters (which can span datasets). */
export const FilterChips: React.FC<{ filters: Filter[]; onRemove: (id: string) => void; onClear: () => void }> = ({ filters, onRemove, onClear }) =>
  filters.length ? (
    <>
      {filters.map((f) => (
        <span key={f.id} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-soft pl-2.5 pr-1 text-[13px] font-medium text-brand-ink">
          <span className="max-w-[260px] truncate">{describeFilter(f)}</span>
          <button type="button" onClick={() => onRemove(f.id)} className="rounded p-0.5 hover:bg-brand/10" aria-label={`Remove filter ${describeFilter(f)}`}>
            <X size={13} />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-[13px] text-ink-3 hover:text-ink hover:underline">
        Clear filters
      </button>
    </>
  ) : null;

