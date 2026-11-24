const studentService = require("../services/studentService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");

const createStudent = async (req, res) => {
  try {
    const student = await studentService.createStudent(req.body);
    if (student?.id) dashboardSnapshotService.scheduleStudentLedgerChanged(student.id);
    return res.status(201).json(student);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create student" });
  }
};

const getStudents = async (req, res) => {
  try {
    const filters = {
      current_class_id: req.query.current_class_id,
      gender: req.query.gender,
      include_inactive: req.query.include_inactive,
    };

    const students = await studentService.getStudents(filters);
    return res.json(students);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch students" });
  }
};

const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await studentService.updateStudent(id, req.body);

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Gender (and cohort fields) affect dashboard strength cards.
    dashboardSnapshotService.scheduleStudentLedgerChanged(id);
    return res.json(student);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update student" });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await studentService.deleteStudent(id);

    if (!deleted) {
      return res.status(404).json({ message: "Student not found" });
    }

    dashboardSnapshotService.scheduleStudentLedgerChanged(id, { removed: true });
    return res.json({ message: "Student permanently deleted" });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to delete student",
    });
  }
};

module.exports = {
  createStudent,
  getStudents,
  updateStudent,
  deleteStudent,
};
