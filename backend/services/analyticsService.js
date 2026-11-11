const Dataset = require("../models/Dataset");
const { NotFoundError } = require("../lib/errors");
const { toObjectId, rowCountExpr } = require("../lib/mongoHelpers");

/**
 * Service to handle complex analytics business logic
 * This isolates business rules from controllers.
 *
 * Both functions used to load complete documents (every spreadsheet row) into Node just to count rows.
 * They now push the work into MongoDB aggregation pipelines and only transfer the fields they return.
 * Response shapes are unchanged. Results are cached per user in Redis by the controller.
 */

exports.generateAdvancedAnalytics = async (datasetId, userId) => {
  const datasetOid = toObjectId(datasetId);
  const userOid = toObjectId(userId);
  if (!datasetOid || !userOid) throw new NotFoundError("Dataset not found or unauthorized");

  const [dataset] = await Dataset.aggregate([
    { $match: { _id: datasetOid, user: userOid } },
    { $project: { kpis: 1, insights: 1, columns: 1, rowCount: rowCountExpr } },
  ]);
  if (!dataset) {
    throw new NotFoundError("Dataset not found or unauthorized");
  }

  const columns = dataset.columns || [];
  const summary = {
    totalRows: dataset.rowCount || 0,
    totalColumns: columns.length,
    numericColumnsCount: columns.filter(c => c.type === "numeric").length,
    categoricalColumnsCount: columns.filter(c => c.type === "categorical").length,
    timestamp: new Date()
  };

  return { summary, kpis: dataset.kpis, insights: dataset.insights };
};

exports.getDashboardSummary = async (userId) => {
  const userOid = toObjectId(userId);
  if (!userOid) return { totalDatasets: 0, totalRowsProcessed: 0, recentDatasets: [] };

  // Project away the row arrays FIRST so the $facet stages only ever hold small documents.
  const [result] = await Dataset.aggregate([
    { $match: { user: userOid } },
    { $project: { name: 1, createdAt: 1, rows: rowCountExpr } },
    {
      $facet: {
        totals: [{ $group: { _id: null, totalDatasets: { $sum: 1 }, totalRowsProcessed: { $sum: "$rows" } } }],
        recent: [
          { $sort: { createdAt: -1 } },
          { $limit: 5 },
          { $project: { _id: 0, id: "$_id", name: 1, uploadedAt: "$createdAt" } },
        ],
      },
    },
  ]);

  const totals = result?.totals?.[0] || { totalDatasets: 0, totalRowsProcessed: 0 };
  return {
    totalDatasets: totals.totalDatasets,
    totalRowsProcessed: totals.totalRowsProcessed,
    recentDatasets: result?.recent || [],
  };
};
