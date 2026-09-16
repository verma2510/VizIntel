const Dataset = require("../models/Dataset");
const { analyzeData, buildKpisAndCharts } = require("../utils/dataAnalyzer");
const { classifyColumns } = require("../utils/columnClassifier");
const { generateInsights } = require("../utils/aiInsights");

exports.uploadDataset = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    // 1. Parse the uploaded Excel/CSV file and detect structural column types (numeric/date/categorical)
    const { data, columns: structuralColumns } = analyzeData(req.file.buffer);

    // 2. Use the LLM to determine each column's real business meaning (currency, quantity,
    //    percentage, date, identifier, category, text) instead of generic numeric/categorical
    const semanticInfo = await classifyColumns(structuralColumns, data);
    const columns = structuralColumns.map((col, idx) => ({
      ...col,
      semanticType: semanticInfo[idx].semanticType,
      label: semanticInfo[idx].label,
    }));

    // 3. Build KPIs and charts using the semantic types (e.g. skips identifier columns for grouping)
    const { kpis, charts } = buildKpisAndCharts(data, columns);

    // 4. Generate AI Insights based on extracted KPIs and enriched column info
    const insights = await generateInsights(kpis, columns);

    // 5. Save to database for the authenticated user
    const newDataset = new Dataset({
      user: req.user.id,
      name: req.file.originalname,
      originalData: data,
      columns,
      kpis,
      charts,
      insights
    });

    const savedDataset = await newDataset.save();
    
    res.json(savedDataset);
  } catch (err) {
    console.error("Dataset Upload Error:", err.message);
    res.status(500).send("Error reading or analyzing the file " + err.message);
  }
};

exports.getDatasets = async (req, res) => {
  try {
    const datasets = await Dataset.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(datasets);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

exports.getDatasetById = async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) return res.status(404).json({ msg: "Dataset not found" });

    if (dataset.user.toString() !== req.user.id) {
       return res.status(401).json({ msg: "User not authorized" });
    }

    res.json(dataset);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};
