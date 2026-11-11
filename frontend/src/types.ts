/* Domain types shared across the app. Shapes mirror the Express API responses. */

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
}

// ---- Datasets ---------------------------------------------------------------------------------

export type ColumnType = "numeric" | "categorical" | "date";
export type SemanticType = "currency" | "quantity" | "percentage" | "date" | "identifier" | "category" | "text";

export interface Column {
  name: string;
  type: ColumnType;
  semanticType?: SemanticType;
  label?: string;
}

export type CellValue = string | number | boolean | null | undefined;
export type Row = Record<string, CellValue>;
export type InsightsStatus = "pending" | "ready" | "failed";

/** KPI block computed server-side at upload (utils/dataAnalyzer.js). */
export interface KpiStat {
  sum: number;
  avg: string | number;
  count: number;
  semanticType?: SemanticType;
}

/** Chart definitions selected server-side at upload. */
export interface LegacyChartDef {
  type: "BarChart" | "LineChart";
  xAxis: string;
  yAxis: string;
  title: string;
}

export interface Dataset {
  _id: string;
  name: string;
  columns?: Column[];
  /** Omitted by the list endpoint; loaded on demand. */
  originalData?: Row[];
  kpis?: Record<string, KpiStat>;
  charts?: LegacyChartDef[];
  insights?: string;
  insightsStatus?: InsightsStatus;
  rowCount?: number;
  columnCount?: number;
  createdAt: string;
  updatedAt?: string;
}

// ---- Charts & filters --------------------------------------------------------------------------

export type ChartType =
  | "bar"
  | "hbar"
  | "line"
  | "area"
  | "pie"
  | "doughnut"
  | "polarArea"
  | "radar"
  | "scatter"
  | "bubble"
  | "histogram";

export type Aggregation = "sum" | "avg" | "count" | "min" | "max" | "median" | "distinct";
export type DateBucket = "auto" | "day" | "week" | "month" | "quarter" | "year";
export type SortMode = "none" | "asc" | "desc" | "label";
export type LegendPosition = "top" | "bottom" | "right" | "none";
export type PaletteName = "signal" | "cool" | "warm" | "mono";

export type FilterOp = "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "contains" | "dateBetween";
export type FilterValue = string | number | (string | number)[] | null;

export interface Filter {
  id: string;
  column: string;
  op: FilterOp;
  value: FilterValue;
}

export interface ChartStyle {
  palette?: PaletteName;
  /** Per-series color overrides, keyed by series name. */
  colors?: Record<string, string>;
  legend?: LegendPosition;
  dataLabels?: boolean;
  grid?: boolean;
  smooth?: boolean;
  xLabel?: string;
  yLabel?: string;
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  x?: string;
  y: string[];
  agg: Aggregation;
  groupBy?: string;
  bucket?: DateBucket;
  sort?: SortMode;
  limit?: number;
  stacked?: boolean;
  size?: string;
  bins?: number;
  filters?: Filter[];
  style?: ChartStyle;
}

export type DateRangePreset = "all" | "7d" | "30d" | "90d" | "180d" | "365d" | "ytd" | "custom";
export interface DateRange {
  preset: DateRangePreset;
  /** ISO dates (yyyy-mm-dd), only for "custom". */
  from?: string;
  to?: string;
}

// ---- Dashboards --------------------------------------------------------------------------------

export interface KpiSpec {
  /** Undefined => row count. */
  column?: string;
  agg: Aggregation;
  filters?: Filter[];
}

export interface TableSpec {
  columns?: string[];
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: Filter[];
}

export interface TextSpec {
  text: string;
}

interface WidgetBase {
  id: string;
  title: string;
  datasetId: string | null;
  /** Grid columns (2-12) */
  w: number;
  /** Grid rows (2-10) */
  h: number;
}

export type Widget =
  | (WidgetBase & { kind: "chart"; spec: ChartSpec })
  | (WidgetBase & { kind: "kpi"; spec: KpiSpec })
  | (WidgetBase & { kind: "table"; spec: TableSpec })
  | (WidgetBase & { kind: "insights"; spec: Record<string, never> })
  | (WidgetBase & { kind: "text"; spec: TextSpec });

export type WidgetKind = Widget["kind"];

export interface DashboardFilters {
  dateRange?: DateRange;
  filters?: Filter[];
}

export interface Dashboard {
  _id: string;
  name: string;
  description: string;
  widgets: Widget[];
  filters: DashboardFilters;
  isShared: boolean;
  shareToken: string | null;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedDashboardPayload {
  dashboard: Omit<Dashboard, "isShared" | "shareToken">;
  datasets: Dataset[];
}

// ---- Activity & analytics ---------------------------------------------------------------------

export interface ActivityTotals {
  pageViews: number;
  clicks: number;
  searches: number;
  uploads: number;
  sessions: number;
}

export interface ActivitySummary {
  days: number;
  from?: string;
  to?: string;
  totals: ActivityTotals;
  series?: { day: string; pageViews: number; clicks: number; searches: number; uploads: number }[];
  topSearches: { key: string; count: number }[];
  topPages?: { key: string; count: number }[];
  lastEventAt: string | null;
}

export interface ActivityEvent {
  id: string;
  type: "page_view" | "click" | "search" | "dataset_uploaded";
  key: string | null;
  path: string | null;
  properties: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface WorkspaceSummary {
  totalDatasets: number;
  totalRowsProcessed: number;
  recentDatasets: { id: string; name: string; uploadedAt: string }[];
}

export interface AskResponse {
  question: string;
  answer: string;
  chart: Partial<ChartSpec> | null;
  followUps: string[];
}

export interface SystemStatus {
  status: "ok" | "unavailable";
  uptimeSec: number;
  mongo: { ready: boolean };
  redis: { enabled?: boolean; status?: string } & Record<string, unknown>;
  kafka: { mode: string; healthy: boolean; producerReady?: boolean; outboxSize?: number; lastError?: string | null };
  cache: { hitRatio: number | null } & Record<string, unknown>;
  insightsMode: "sync" | "async";
}
