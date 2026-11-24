const express = require("express");
const academicController = require("../controllers/academicController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();
const adminOnly = authorize(["admin"]);

router.post("/academic-years", adminOnly, academicController.createAcademicYear);
router.put("/academic-years/:id/activate", adminOnly, academicController.setActiveYear);
router.get("/academic-years/active", academicController.getActiveYear);
router.get("/academic-years", academicController.getAcademicYears);

router.post("/promote-students", adminOnly, academicController.promoteStudents);
router.post("/promotions/preview", adminOnly, academicController.previewPromotion);
router.post("/promotions/execute", adminOnly, academicController.executePromotion);
router.get("/promotions/candidates", adminOnly, academicController.listPromotionCandidates);
router.get("/students/:student_id/enrollment", academicController.getStudentEnrollmentForYear);
router.get("/alumni/years", academicController.getAlumniYears);
router.get("/alumni/students", academicController.getAlumniStudents);
router.post("/fail-student", adminOnly, academicController.failStudent);
router.post("/leave-student", adminOnly, academicController.markStudentLeft);

module.exports = router;
