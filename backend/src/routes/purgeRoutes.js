const express = require("express");
const purgeController = require("../controllers/purgeController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();
const adminOnly = authorize(["admin"]);

router.get("/admin/purge/students", adminOnly, purgeController.listStudents);
router.get("/admin/purge/students/:id/preview", adminOnly, purgeController.previewStudent);
router.post("/admin/purge/students/:id", adminOnly, purgeController.purgeStudent);
router.post("/admin/purge/soft-deleted-students", adminOnly, purgeController.purgeSoftDeletedStudents);

router.get("/admin/purge/classes", adminOnly, purgeController.listClasses);
router.post("/admin/purge/classes/:id", adminOnly, purgeController.purgeClass);

router.get("/admin/purge/sections", adminOnly, purgeController.listSections);
router.post("/admin/purge/sections/:id", adminOnly, purgeController.purgeSection);

module.exports = router;
