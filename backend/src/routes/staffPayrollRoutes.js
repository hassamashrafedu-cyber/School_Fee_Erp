const express = require("express");
const staffPayrollController = require("../controllers/staffPayrollController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();
const adminOnly = authorize(["admin"]);

// View: any authenticated user (expenses page). Mutations: admin.
router.get("/staff-members", staffPayrollController.listStaff);
router.post("/staff-members", adminOnly, staffPayrollController.createStaff);
router.patch("/staff-members/:id", adminOnly, staffPayrollController.updateStaff);
router.delete("/staff-members/:id", adminOnly, staffPayrollController.deactivateStaff);

router.get("/staff-payroll/month", staffPayrollController.getMonthPayroll);
router.put("/staff-payroll/month/absences", adminOnly, staffPayrollController.saveMonthAbsences);
router.post("/staff-payroll/pay-all", adminOnly, staffPayrollController.payAll);
router.post("/staff-payroll/:staffId/pay", adminOnly, staffPayrollController.payStaff);
router.post("/staff-payroll/:staffId/reverse", adminOnly, staffPayrollController.reversePay);

module.exports = router;
