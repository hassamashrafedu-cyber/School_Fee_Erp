const challanService = require("../services/challanService");
const challanGenerationService = require("../services/challanGenerationService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { ChallanValidationError } = challanService;
const { ChallanGenerationValidationError } = challanGenerationService;

const createChallan = async (req, res) => {
  try {
    const row = await challanService.createChallan(req.body);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to create challan" });
  }
};

const addChallanItem = async (req, res) => {
  try {
    const row = await challanService.addChallanItem(req.body);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to add challan item" });
  }
};

const getChallanDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await challanService.getChallanDetails(id);
    return res.json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch challan details" });
  }
};

const addPayment = async (req, res) => {
  try {
    const result = await challanService.addPayment(req.body);
    const studentId = result?.student_id || req.body?.student_id;
    if (studentId) dashboardSnapshotService.scheduleStudentLedgerChanged(studentId);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to add payment" });
  }
};

const getStudentSummary = async (req, res) => {
  try {
    const { student_id } = req.params;
    const row = await challanService.getStudentSummary(student_id);
    return res.json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch student summary" });
  }
};

const getStudentLedger = async (req, res) => {
  try {
    const { student_id } = req.params;
    const row = await challanService.getStudentLedger(student_id);
    return res.json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch student ledger" });
  }
};

const getStudentPayments = async (req, res) => {
  try {
    const { student_id } = req.params;
    let billingYear = null;
    if (req.query.year !== undefined && req.query.year !== null && String(req.query.year).trim() !== "") {
      const y = parseInt(String(req.query.year), 10);
      if (!Number.isNaN(y) && y >= 1900 && y <= 2100) billingYear = y;
    }
    const rows = await challanService.getStudentPayments(student_id, billingYear);
    return res.json(rows);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch student payments" });
  }
};

const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await challanService.deletePayment(id);
    if (deleted?.student_id) {
      dashboardSnapshotService.scheduleStudentLedgerChanged(deleted.student_id);
    }
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to delete payment" });
  }
};

const addConcession = async (req, res) => {
  try {
    const row = await challanService.addConcession(req.body);
    const studentId = row?.student_id || req.body?.student_id;
    if (studentId) dashboardSnapshotService.scheduleStudentLedgerChanged(studentId);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof ChallanValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to add concession" });
  }
};

const generateChallanPreview = async (req, res) => {
  try {
    const { issue_date, fee_month, fee_year, student_ids } = req.body || {};
    const payload = await challanGenerationService.generateChallanPreview({
      issue_date,
      fee_month,
      fee_year,
      student_ids,
    });
    return res.json(payload);
  } catch (error) {
    if (error instanceof ChallanGenerationValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to generate challan preview" });
  }
};

module.exports = {
  createChallan,
  addChallanItem,
  getChallanDetails,
  addPayment,
  getStudentLedger,
  getStudentSummary,
  getStudentPayments,
  deletePayment,
  addConcession,
  generateChallanPreview,
};
