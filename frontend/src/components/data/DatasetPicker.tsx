import React, { useState } from "react";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import { useData } from "../../context/Data";
import { formatInteger, formatRelative } from "../../lib/format";
import { Popover } from "../ui/Overlay";
import { SearchInput } from "../ui/Field";
import { InsightsDot } from "../insights/InsightsStatus";

export const DatasetPicker: React.FC<{ value: string | undefined; onChange: (id: string) => void; className?: string; label?: string }> = ({ value, onChange, className = "", label = "Dataset" }) => {
  const { datasets } = useData();
  const [q, setQ] = useState("");
  const current = datasets.find((d) => d._id === value);
  const list = datasets.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover
      width={340}
      trigger={({ toggle, ref, open }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${label}: ${current?.name ?? "none selected"}`}
          className={`flex h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-line bg-surface pl-2.5 pr-2 text-left shadow-card-sm hover:border-line-strong ${className}`}
        >
          <FileSpreadsheet size={15} className="shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{current?.name ?? "Choose a dataset"}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <SearchInput value={q} onChange={setQ} placeholder="Find a dataset" autoFocus />
          <ul className="mt-1.5 max-h-72 overflow-y-auto" role="listbox">
            {list.map((d) => (
              <li key={d._id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={d._id === value}
                  onClick={() => {
                    onChange(d._id);
                    close();
                  }}
                  data-track="dataset_select"
                  data-track-dataset-id={d._id}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${d._id === value ? "bg-brand-soft" : "hover:bg-surface-3"}`}
                >
                  <InsightsDot status={d.insightsStatus} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{d.name}</span>
                    <span className="block text-xs text-ink-3">
                      {formatInteger(d.rowCount ?? 0)} rows · {formatRelative(d.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-6 text-center text-[13px] text-ink-3">{datasets.length ? "No datasets match." : "No datasets yet."}</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
};
