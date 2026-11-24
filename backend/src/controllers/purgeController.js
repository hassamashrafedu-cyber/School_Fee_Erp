const purgeService = require("../services/purgeService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { PurgeValidationError } = purgeService;

const handleError = (res, error, fallback) => {
  if (error instanceof PurgeValidationError) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
  return res.status(500).json({ message: fallback });
};

const listStudents = async (req, res) => {
  try {
    const includeDeleted = String(req.query.include_deleted || "true").toLowerCase() !== "false";
    const rows = await purgeService.listStudentsForPurge({ includeDeleted });
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, "Failed to list students");
  }
};

const previewStudent = async (req, res) => {
  try {
    const data = await purgeService.getStudentPurgePreview(req.params.id);
    return res.json(data);
  } catch (error) {
    return handleError(res, error, "Failed to load student purge preview");
  }
};

const purgeStudent = async (req, res) => {
  try {
    const { admin_current_password, confirm_name } = req.body;
    const result = await purgeService.purgeStudentPermanent({
      adminUserId: req.user?.id,
      adminCurrentPassword: admin_current_password,
      studentId: req.params.id,
      confirmName: confirm_name,
    });
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(result);
  } catch (error) {
    return handleError(res, error, "Failed to permanently delete student");
  }
};

const purgeSoftDeletedStudents = async (req, res) => {
  try {
    const { admin_current_password, confirm_phrase } = req.body;
    const result = await purgeService.purgeSoftDeletedStudents({
      adminUserId: req.user?.id,
      adminCurrentPassword: admin_current_password,
      confirmPhrase: confirm_phrase,
    });
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(result);
  } catch (error) {
    return handleError(res, error, "Failed to bulk delete students");
  }
};

const listClasses = async (req, res) => {
  try {
    const rows = await purgeService.listClassesForPurge();
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, "Failed to list classes");
  }
};

const purgeClass = async (req, res) => {
  try {
    const { admin_current_password, confirm_phrase } = req.body;
    const result = await purgeService.purgeClassPermanent({
      adminUserId: req.user?.id,
      adminCurrentPassword: admin_current_password,
      classId: req.params.id,
      confirmPhrase: confirm_phrase,
    });
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(result);
  } catch (error) {
    return handleError(res, error, "Failed to permanently delete class");
  }
};

const listSections = async (req, res) => {
  try {
    const rows = await purgeService.listSectionsForPurge(req.query.class_id);
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, "Failed to list sections");
  }
};

const purgeSection = async (req, res) => {
  try {
    const { admin_current_password, confirm_phrase } = req.body;
    const result = await purgeService.purgeSectionPermanent({
      adminUserId: req.user?.id,
      adminCurrentPassword: admin_current_password,
      sectionId: req.params.id,
      confirmPhrase: confirm_phrase,
    });
    dashboardSnapshotService.scheduleFullRebuild();
    return res.json(result);
  } catch (error) {
    return handleError(res, error, "Failed to permanently delete section");
  }
};

module.exports = {
  listStudents,
  previewStudent,
  purgeStudent,
  purgeSoftDeletedStudents,
  listClasses,
  purgeClass,
  listSections,
  purgeSection,
};
