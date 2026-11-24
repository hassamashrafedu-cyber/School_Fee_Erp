const feeService = require("../services/feeService");
const feeAdvanceLinkService = require("../services/feeAdvanceLinkService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { FeeValidationError } = feeService;
const { FeeAdvanceLinkValidationError } = feeAdvanceLinkService;

const handleFeeError = (res, error, fallbackMessage) => {
  if (error instanceof FeeValidationError || error instanceof FeeAdvanceLinkValidationError) {
    return res.status(400).json({ message: error.message });
  }
  const devHint =
    process.env.NODE_ENV !== "production" && (error?.code || error?.message)
      ? ` [${error.code || "ERR"}] ${error.message}`
      : "";
  return res.status(500).json({ message: `${fallbackMessage}${devHint}` });
};

const getFeeConfig = async (req, res) => {
  try {
    const { year, class_id } = req.query;
    const row = await feeService.readFeeConfigForClass(year, class_id);
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to fetch fee config");
  }
};

const saveFeeConfig = async (req, res) => {
  try {
    const row = await feeService.saveFeeConfig(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to save fee config");
  }
};

const deleteClassFeeBilling = async (req, res) => {
  try {
    const { year, class_id } = req.query;
    const row = await feeService.deleteClassFeeBillingConfig(year, class_id);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to clear class billing range");
  }
};

const listClassFeeStructure = async (req, res) => {
  try {
    const { class_id, year } = req.query;
    const row = await feeService.getMonthlyFeeStructure(class_id, year);
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to fetch class fee structure");
  }
};

const upsertClassFeeStructure = async (req, res) => {
  try {
    const row = await feeService.upsertMonthlyFeeStructure({
      class_id: req.body.class_id,
      year: req.body.year,
      month: req.body.month,
      fee: req.body.fee,
    });
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to save class fee structure");
  }
};

const assignFeeToStudent = async (req, res) => {
  try {
    const row = await feeService.assignStudentFeeOverrideByYear(req.body);
    const studentId = row?.student_id || req.body?.student_id;
    if (studentId) dashboardSnapshotService.scheduleStudentLedgerChanged(studentId);
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to assign fee override");
  }
};

const getStudentFee = async (req, res) => {
  try {
    const { student_id, year } = req.query;
    const row = await feeService.getStudentFee(student_id, null, year);
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to fetch student fee assignment");
  }
};

/** Challan fee table rows with student overrides applied (matches Fee Collection billing). */
const getChallanFeeLines = async (req, res) => {
  try {
    const { student_id, year, month } = req.query;
    const row = await feeService.getChallanFeeLines({ student_id, year, month });
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to fetch challan fee lines");
  }
};

const createFeeComponent = async (req, res) => {
  try {
    const row = await feeService.createClassFeeComponent(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to create fee column");
  }
};

const updateFeeComponent = async (req, res) => {
  try {
    const row = await feeService.updateClassFeeComponent(req.params.id, req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to update fee column");
  }
};

const deleteFeeComponent = async (req, res) => {
  try {
    await feeService.deleteClassFeeComponent(req.params.id);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(204).send();
  } catch (error) {
    return handleFeeError(res, error, "Failed to delete fee column");
  }
};

const upsertComponentMonthAmount = async (req, res) => {
  try {
    const row = await feeService.upsertComponentMonthAmount(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to save fee column amount");
  }
};

const listAdvanceLinks = async (req, res) => {
  try {
    const { class_id, year } = req.query;
    const rows = await feeAdvanceLinkService.listForClassYear(class_id, year);
    return res.json(rows);
  } catch (error) {
    return handleFeeError(res, error, "Failed to list advance links");
  }
};

const createAdvanceLink = async (req, res) => {
  try {
    const row = await feeAdvanceLinkService.createLink(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(row);
  } catch (error) {
    return handleFeeError(res, error, "Failed to save advance link");
  }
};

const deleteAdvanceLink = async (req, res) => {
  try {
    await feeAdvanceLinkService.deleteLink(req.params.id);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(204).send();
  } catch (error) {
    return handleFeeError(res, error, "Failed to delete advance link");
  }
};

module.exports = {
  getFeeConfig,
  saveFeeConfig,
  deleteClassFeeBilling,
  listClassFeeStructure,
  upsertClassFeeStructure,
  createFeeComponent,
  updateFeeComponent,
  deleteFeeComponent,
  upsertComponentMonthAmount,
  assignFeeToStudent,
  getStudentFee,
  getChallanFeeLines,
  listAdvanceLinks,
  createAdvanceLink,
  deleteAdvanceLink,
};
