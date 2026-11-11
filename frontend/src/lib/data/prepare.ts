/**
 * PreparedDataset: a column-oriented, lazily-typed view over a dataset's rows.
 *
 * Every chart, filter, table and analysis works on index arrays (Uint32Array) into the same prepared
 * dataset instead of copying rows, and each column is parsed (numbers / timestamps / strings) at most
 * once. Instances are memoised per row array, so all components viewing a dataset share one.
 */
import type { Column, Dataset, Row, SemanticType } from "../../types";

export type FieldRole = "measure" | "dimension" | "date" | "identifier" | "text";

export interface Field extends Column {
  role: FieldRole;
  label: string;
}

export const BLANK = "(blank)";

const NUMERIC_STRING = /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i;

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[\s$€£₹¥%]/g, "");
    if (!cleaned || !NUMERIC_STRING.test(cleaned)) return NaN;
    return Number(cleaned.replace(/,/g, ""));
  }
  if (typeof value === "boolean") return NaN;
  return NaN;
}

export function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    if (value >= 1900 && value <= 2100 && Number.isInteger(value)) return Date.UTC(value, 0, 1); // a bare year
    if (value > 1e11) return value; // epoch ms
    return NaN;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return NaN;
    // Date-only ISO strings are parsed as UTC by the spec; keep everything in UTC for stable bucketing.
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

function inferRole(col: Column): FieldRole {
  const sem = col.semanticType;
  if (sem === "identifier") return "identifier";
  if (sem === "text") return "text";
  if (col.type === "date" || sem === "date") return "date";
  if (sem === "currency" || sem === "quantity" || sem === "percentage") return "measure";
  if (col.type === "numeric") return sem === "category" ? "dimension" : "measure";
  return "dimension";
}

/** Fallback for datasets without column metadata: infer from the first non-empty values. */
function inferColumns(rows: Row[]): Column[] {
  const names = rows.length ? Object.keys(rows[0]) : [];
  return names.map((name) => {
    const sample = rows.slice(0, 50).map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== "");
    const numeric = sample.filter((v) => typeof v === "number").length;
    const dates = sample.filter((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)).length;
    const type = sample.length && dates / sample.length > 0.8 ? "date" : sample.length && numeric / sample.length > 0.8 ? "numeric" : "categorical";
    return { name, type };
  });
}

export class PreparedDataset {
  readonly id: string;
  readonly name: string;
  readonly rows: Row[];
  readonly n: number;
  readonly fields: Field[];
  private readonly byName = new Map<string, Field>();
  private readonly numCache = new Map<string, Float64Array>();
  private readonly timeCache = new Map<string, Float64Array>();
  private readonly strCache = new Map<string, string[]>();
  private readonly entityCache = new Map<string, string[]>();
  private readonly fractionCache = new Map<string, boolean>();
  private all?: Uint32Array;

  constructor(dataset: Dataset) {
    this.id = dataset._id;
    this.name = dataset.name;
    this.rows = dataset.originalData ?? [];
    this.n = this.rows.length;
    const columns = dataset.columns?.length ? dataset.columns : inferColumns(this.rows);
    this.fields = columns.map((c) => ({ ...c, role: inferRole(c), label: c.label || c.name }));
    for (const f of this.fields) this.byName.set(f.name, f);
  }

  field(name: string | undefined): Field | undefined {
    return name ? this.byName.get(name) : undefined;
  }

  has(name: string | undefined): boolean {
    return Boolean(name && this.byName.has(name));
  }

  get measures(): Field[] {
    return this.fields.filter((f) => f.role === "measure");
  }
  get dimensions(): Field[] {
    return this.fields.filter((f) => f.role === "dimension");
  }
  get dates(): Field[] {
    return this.fields.filter((f) => f.role === "date");
  }
  get primaryDate(): Field | undefined {
    return this.dates[0];
  }

  allIndices(): Uint32Array {
    if (!this.all) {
      this.all = new Uint32Array(this.n);
      for (let i = 0; i < this.n; i++) this.all[i] = i;
    }
    return this.all;
  }

  num(name: string): Float64Array {
    let arr = this.numCache.get(name);
    if (!arr) {
      arr = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) arr[i] = toNumber(this.rows[i][name]);
      this.numCache.set(name, arr);
    }
    return arr;
  }

  time(name: string): Float64Array {
    let arr = this.timeCache.get(name);
    if (!arr) {
      arr = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) arr[i] = toTime(this.rows[i][name]);
      this.timeCache.set(name, arr);
    }
    return arr;
  }

  str(name: string): string[] {
    let arr = this.strCache.get(name);
    if (!arr) {
      const isDate = this.field(name)?.role === "date";
      arr = new Array<string>(this.n);
      for (let i = 0; i < this.n; i++) {
        const v = this.rows[i][name];
        if (v === null || v === undefined || (typeof v === "string" && !v.trim())) arr[i] = BLANK;
        else if (isDate && typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(v)) arr[i] = v.slice(0, 10);
        else arr[i] = String(v).trim();
      }
      this.strCache.set(name, arr);
    }
    return arr;
  }

  /**
   * Stable entity order for a column (most frequent first, over ALL rows). Colors are assigned from this
   * order, so filtering never repaints a surviving series.
   */
  entityOrder(name: string): string[] {
    let order = this.entityCache.get(name);
    if (!order) {
      const counts = new Map<string, number>();
      const values = this.str(name);
      for (let i = 0; i < this.n; i++) counts.set(values[i], (counts.get(values[i]) || 0) + 1);
      order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
      this.entityCache.set(name, order);
    }
    return order;
  }

  distinctCount(name: string): number {
    return this.entityOrder(name).length;
  }

  /** Percentage columns stored as 0-1 fractions are displayed ×100. */
  percentIsFraction(name: string): boolean {
    let v = this.fractionCache.get(name);
    if (v === undefined) {
      const nums = this.num(name);
      let max = 0;
      for (let i = 0; i < nums.length; i++) if (Number.isFinite(nums[i])) max = Math.max(max, Math.abs(nums[i]));
      v = max > 0 && max <= 1.5;
      this.fractionCache.set(name, v);
    }
    return v;
  }

  semantic(name: string | undefined): SemanticType | undefined {
    return this.field(name)?.semanticType;
  }

  /** [min, max] timestamps of a date column (finite values only), or null. */
  timeExtent(name: string, idx?: Uint32Array): [number, number] | null {
    const t = this.time(name);
    let min = Infinity;
    let max = -Infinity;
    const indices = idx ?? this.allIndices();
    for (let k = 0; k < indices.length; k++) {
      const v = t[indices[k]];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return Number.isFinite(min) ? [min, max] : null;
  }
}

const preparedCache = new WeakMap<Row[], PreparedDataset>();
const emptyRows: Row[] = [];

/** Memoised per row array: every view of the same loaded dataset shares one PreparedDataset. */
export function getPrepared(dataset: Dataset): PreparedDataset {
  const rows = dataset.originalData ?? emptyRows;
  let prepared = preparedCache.get(rows);
  if (!prepared || prepared.id !== dataset._id) {
    prepared = new PreparedDataset(dataset);
    if (rows !== emptyRows) preparedCache.set(rows, prepared);
  }
  return prepared;
}
