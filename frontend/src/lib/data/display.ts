import { BLANK, type PreparedDataset } from "./prepare";
import { formatDate, formatMeasure } from "../format";

/** Formats a raw cell for display according to its column role. */
export function formatCell(ds: PreparedDataset, column: string, rowIndex: number): string {
  const f = ds.field(column);
  if (!f) return "";
  const s = ds.str(column)[rowIndex];
  if (s === BLANK) return "";
  if (f.role === "measure") {
    const v = ds.num(column)[rowIndex];
    return Number.isFinite(v) ? formatMeasure(v, f.semanticType, { compact: false, percentIsFraction: f.semanticType === "percentage" && ds.percentIsFraction(column) }) : s;
  }
  if (f.role === "date") {
    const t = ds.time(column)[rowIndex];
    return Number.isFinite(t) ? formatDate(t) : s;
  }
  return s;
}

export function sortIndices(ds: PreparedDataset, idx: Uint32Array, column: string, dir: "asc" | "desc"): Uint32Array {
  const f = ds.field(column);
  if (!f) return idx;
  const out = Uint32Array.from(idx);
  const sign = dir === "asc" ? 1 : -1;
  if (f.role === "measure" || f.role === "date") {
    const vals = f.role === "measure" ? ds.num(column) : ds.time(column);
    out.sort((a, b) => {
      const va = vals[a];
      const vb = vals[b];
      if (!Number.isFinite(va)) return Number.isFinite(vb) ? 1 : 0;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * sign;
    });
  } else {
    const strs = ds.str(column);
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    out.sort((a, b) => {
      if (strs[a] === BLANK) return strs[b] === BLANK ? 0 : 1;
      if (strs[b] === BLANK) return -1;
      return collator.compare(strs[a], strs[b]) * sign;
    });
  }
  return out;
}
