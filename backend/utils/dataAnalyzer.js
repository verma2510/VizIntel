const xlsx = require("xlsx");

// How many rows to sample when inferring a column's type (first row alone is unreliable
// if that cell happens to be blank or an outlier).
const TYPE_SAMPLE_SIZE = 20;

// Recognizable date shapes only (ISO, slash/dash-separated, or "Jan 1 2024"-style).
// Date.parse() alone is too lenient — it happily parses non-date strings like "ORD-1001"
// or "Widget-5" as dates, which would misclassify identifier/category columns.
const DATE_STRING_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}([ t].*)?$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/i;

const isDateValue = (value) => {
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!DATE_STRING_PATTERN.test(trimmed)) return false;
    return !isNaN(Date.parse(trimmed));
  }
  return false;
};

const detectColumnType = (values) => {
  const sample = values.filter(v => v !== null && v !== undefined && v !== "").slice(0, TYPE_SAMPLE_SIZE);
  if (sample.length === 0) return "categorical";

  const dateCount = sample.filter(isDateValue).length;
  if (dateCount / sample.length >= 0.8) return "date";

  const numericCount = sample.filter(v => typeof v === "number" && !isDateValue(v)).length;
  if (numericCount / sample.length >= 0.8) return "numeric";

  return "categorical";
};

const analyzeData = (buffer) => {
  // Read workbook (cellDates converts Excel date serials into JS Date objects)
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON
  const data = xlsx.utils.sheet_to_json(sheet);

  if (!data || data.length === 0) {
    throw new Error("Dataset is empty");
  }

  // Detect columns & structural types by sampling multiple rows per column, not just the first row.
  // This is deliberately fast/local (no LLM) so upload never blocks on or depends on an external call.
  // Business meaning (currency vs quantity vs identifier, etc.) is layered on afterwards via
  // classifyColumns() + buildKpisAndCharts(), once semantic types are known.
  const columnNames = Object.keys(data[0]);
  const columns = columnNames.map(name => ({
    name,
    type: detectColumnType(data.map(row => row[name])),
  }));

  return { data, columns };
};

/**
 * Builds KPIs and chart definitions using semantic column types (currency/quantity/percentage/
 * date/identifier/category/text) so that, e.g., identifier columns are excluded from grouping
 * and every numeric column (Amount, Quantity, ...) is still surfaced as its own KPI.
 *
 * `columns` here must already carry a `semanticType` (see columnClassifier.classifyColumns).
 */
const buildKpisAndCharts = (data, columns) => {
  const measureCols = columns.filter(c => ["currency", "quantity", "percentage"].includes(c.semanticType));
  const dateCols = columns.filter(c => c.semanticType === "date");
  const groupCols = columns.filter(c => c.semanticType === "category");

  // Generate a KPI for every measure column (Amount, Quantity, etc. each get their own)
  const kpis = {};
  measureCols.forEach(col => {
    const values = data.map(row => row[col.name]).filter(val => typeof val === "number");
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = values.length ? sum / values.length : 0;
    kpis[col.name] = {
      sum,
      avg: avg.toFixed(2),
      count: values.length,
      semanticType: col.semanticType,
    };
  });

  // Automatic Chart Selection Logic — build one chart per meaningful pairing instead of
  // only ever looking at the first categorical/numeric column. Identifier/text columns are
  // excluded entirely since grouping by an ID produces a useless one-bar-per-row chart.
  const charts = [];

  // Trend chart per measure column against the first date column, if one exists
  if (dateCols.length > 0) {
    const dateCol = dateCols[0];
    measureCols.forEach(measureCol => {
      charts.push({
        type: "LineChart",
        xAxis: dateCol.name,
        yAxis: measureCol.name,
        title: `${measureCol.name} over ${dateCol.name}`,
      });
    });
  }

  // Bar chart per category x measure combination (capped to avoid chart overload)
  const MAX_BAR_CHARTS = 6;
  let barChartCount = 0;
  for (const groupCol of groupCols) {
    for (const measureCol of measureCols) {
      if (barChartCount >= MAX_BAR_CHARTS) break;
      charts.push({
        type: "BarChart",
        xAxis: groupCol.name,
        yAxis: measureCol.name,
        title: `${measureCol.name} by ${groupCol.name}`,
      });
      barChartCount++;
    }
  }

  // Fallback: if no date/category columns were found but there are 2+ measure columns,
  // chart them against each other so the dataset isn't left without any visualization.
  if (dateCols.length === 0 && groupCols.length === 0 && measureCols.length > 1) {
    for (let i = 1; i < measureCols.length; i++) {
      charts.push({
        type: "LineChart",
        xAxis: measureCols[0].name,
        yAxis: measureCols[i].name,
        title: `${measureCols[i].name} vs ${measureCols[0].name} Trend`,
      });
    }
  }

  return { kpis, charts };
};

module.exports = { analyzeData, buildKpisAndCharts };
