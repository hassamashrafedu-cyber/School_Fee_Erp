const reportService = require("../services/reportService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { ReportValidationError } = reportService;

const getMonthlyProfit = async (req, res) => {
  try {
    const { month, year } = req.query;
    const result = await reportService.getMonthlyProfit(month, year);
    return res.json(result);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to fetch monthly profit" });
  }
};

const getTotalProfit = async (req, res) => {
  try {
    const result = await reportService.getTotalProfit();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch total profit" });
  }
};

const getExpenseBreakdown = async (req, res) => {
  try {
    const result = await reportService.getExpenseBreakdown();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch expense breakdown" });
  }
};

const getClassWiseCollection = async (req, res) => {
  try {
    const { class_id: classId } = req.params;
    const result = await reportService.getClassWiseCollection(classId);
    return res.json(result);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to fetch class-wise collection" });
  }
};

const getFeeRegister = async (req, res) => {
  try {
    const data = await reportService.getFeeRegister(req.query);
    return res.json(data);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to fetch fee register" });
  }
};

const getDefaulters = async (req, res) => {
  try {
    const data = await reportService.getDefaulters(req.query);
    return res.json(data);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to fetch defaulters" });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const data = await dashboardSnapshotService.getDashboardSummary(req.query);
    return res.json(data);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch dashboard summary" });
  }
};

const getDashboardAnalytics = async (req, res) => {
  try {
    const data = await reportService.getDashboardAnalytics(req.query);
    return res.json(data);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch dashboard analytics" });
  }
};

module.exports = {
  getFeeRegister,
  getDefaulters,
  getMonthlyProfit,
  getTotalProfit,
  getExpenseBreakdown,
  getClassWiseCollection,
  getDashboardSummary,
  getDashboardAnalytics,
};
