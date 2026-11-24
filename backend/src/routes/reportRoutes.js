const express = require("express");
const reportController = require("../controllers/reportController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/reports/fee-register", reportController.getFeeRegister);
router.get("/reports/defaulters", reportController.getDefaulters);
router.get("/reports/dashboard", authorize(["admin"]), reportController.getDashboardSummary);
router.get("/reports/dashboard-analytics", authorize(["admin"]), reportController.getDashboardAnalytics);

router.get("/monthly-profit", reportController.getMonthlyProfit);
router.get("/total-profit", reportController.getTotalProfit);
router.get("/expense-breakdown", reportController.getExpenseBreakdown);
router.get("/class-collection/:class_id", reportController.getClassWiseCollection);

module.exports = router;
