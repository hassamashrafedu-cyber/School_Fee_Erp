const academicService = require("../services/academicService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { AcademicValidationError } = academicService;

const createAcademicYear = async (req, res) => {
  try {
    const row = await academicService.createAcademicYear(req.body);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to create academic year" });
  }
};

const setActiveYear = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await academicService.setActiveYear(id);
    return res.json(row);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to activate academic year" });
  }
};

const getActiveYear = async (req, res) => {
  try {
    const row = await academicService.getActiveYear();
    return res.json(row);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch active academic year" });
  }
};

const getAcademicYears = async (req, res) => {
  try {
    const rows = await academicService.getAcademicYears();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch academic years" });
  }
};

const promoteStudents = async (req, res) => {
  try {
    const result = await academicService.promoteStudents(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to promote students" });
  }
};

const previewPromotion = async (req, res) => {
  try {
    const result = await academicService.previewPromotion(req.body);
    return res.json(result);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to preview promotion" });
  }
};

const executePromotion = async (req, res) => {
  try {
    const result = await academicService.executePromotion(req.body);
    dashboardSnapshotService.scheduleFullRebuild();
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to execute promotion" });
  }
};

const getStudentEnrollmentForYear = async (req, res) => {
  try {
    const { student_id } = req.params;
    const { year } = req.query;
    const row = await academicService.resolveStudentEnrollmentForYear(student_id, year);
    return res.json(row);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to resolve student enrollment" });
  }
};

const listPromotionCandidates = async (req, res) => {
  try {
    const { from_class_id, from_section_id } = req.query;
    const rows = await academicService.listPromotionCandidates({ from_class_id, from_section_id });
    return res.json(rows);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch promotion candidates" });
  }
};

const getAlumniYears = async (req, res) => {
  try {
    const rows = await academicService.listAlumniYears();
    return res.json(rows);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch alumni years" });
  }
};

const getAlumniStudents = async (req, res) => {
  try {
    const { year } = req.query;
    const rows = await academicService.getAlumniStudentsByYear(year);
    return res.json(rows);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch alumni students" });
  }
};

const failStudent = async (req, res) => {
  try {
    const { student_id, academic_year_id } = req.body;
    const result = await academicService.failStudent(student_id, academic_year_id);
    // Failed students remain active in cohort; dues may still change via year history.
    if (student_id) dashboardSnapshotService.scheduleStudentLedgerChanged(student_id);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to mark student as failed" });
  }
};

const markStudentLeft = async (req, res) => {
  try {
    const { student_id, academic_year_id } = req.body;
    const result = await academicService.markStudentLeft(student_id, academic_year_id);
    if (student_id) dashboardSnapshotService.scheduleStudentLedgerChanged(student_id, { removed: true });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AcademicValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to mark student as left" });
  }
};

module.exports = {
  createAcademicYear,
  setActiveYear,
  getActiveYear,
  getAcademicYears,
  promoteStudents,
  previewPromotion,
  executePromotion,
  getStudentEnrollmentForYear,
  listPromotionCandidates,
  getAlumniYears,
  getAlumniStudents,
  failStudent,
  markStudentLeft,
};
