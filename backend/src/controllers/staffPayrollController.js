const staffPayrollService = require("../services/staffPayrollService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const {
  StaffPayrollValidationError,
  StaffPayrollNotFoundError,
  StaffPayrollConflictError,
} = staffPayrollService;

const handleError = (res, error, fallback) => {
  if (error instanceof StaffPayrollValidationError) {
    return res.status(400).json({ message: error.message });
  }
  if (error instanceof StaffPayrollNotFoundError) {
    return res.status(404).json({ message: error.message });
  }
  if (error instanceof StaffPayrollConflictError) {
    return res.status(409).json({ message: error.message });
  }
  // eslint-disable-next-line no-console
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
};

const listStaff = async (req, res) => {
  try {
    const includeInactive =
      String(req.query.include_inactive || "").toLowerCase() === "true" ||
      req.query.include_inactive === "1";
    const rows = await staffPayrollService.listStaffMembers({ includeInactive });
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, "Failed to fetch staff members");
  }
};

const createStaff = async (req, res) => {
  try {
    const row = await staffPayrollService.createStaffMember(req.body);
    return res.status(201).json(row);
  } catch (error) {
    return handleError(res, error, "Failed to create staff member");
  }
};

const updateStaff = async (req, res) => {
  try {
    const row = await staffPayrollService.updateStaffMember(req.params.id, req.body);
    return res.json(row);
  } catch (error) {
    return handleError(res, error, "Failed to update staff member");
  }
};

const deactivateStaff = async (req, res) => {
  try {
    const row = await staffPayrollService.deactivateStaffMember(req.params.id);
    return res.json(row);
  } catch (error) {
    return handleError(res, error, "Failed to deactivate staff member");
  }
};

const getMonthPayroll = async (req, res) => {
  try {
    const data = await staffPayrollService.getMonthPayroll(req.query);
    return res.json(data);
  } catch (error) {
    return handleError(res, error, "Failed to fetch month payroll");
  }
};

const saveMonthAbsences = async (req, res) => {
  try {
    const data = await staffPayrollService.saveMonthAbsences(req.body);
    return res.json(data);
  } catch (error) {
    return handleError(res, error, "Failed to save absences");
  }
};

const payStaff = async (req, res) => {
  try {
    const row = await staffPayrollService.payStaffMonth({
      staffId: req.params.staffId,
      month: req.body.month,
      year: req.body.year,
      paymentDate: req.body.payment_date,
      absentDays: req.body.absent_days,
      userId: req.user?.id,
    });
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    return handleError(res, error, "Failed to pay salary");
  }
};

const payAll = async (req, res) => {
  try {
    const data = await staffPayrollService.payAllDraftForMonth({
      month: req.body.month,
      year: req.body.year,
      paymentDate: req.body.payment_date,
      userId: req.user?.id,
    });
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(data);
  } catch (error) {
    return handleError(res, error, "Failed to pay salaries");
  }
};

const reversePay = async (req, res) => {
  try {
    const row = await staffPayrollService.reverseStaffMonthPayment({
      staffId: req.params.staffId,
      month: req.body.month,
      year: req.body.year,
    });
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    return handleError(res, error, "Failed to reverse salary payment");
  }
};

module.exports = {
  listStaff,
  createStaff,
  updateStaff,
  deactivateStaff,
  getMonthPayroll,
  saveMonthAbsences,
  payStaff,
  payAll,
  reversePay,
};
