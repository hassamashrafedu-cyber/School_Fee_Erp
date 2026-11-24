const express = require("express");
const sectionController = require("../controllers/sectionController");

const router = express.Router();

router.post("/sections", sectionController.createSection);
router.get("/sections/:class_id", sectionController.getSections);
router.delete("/sections/:id", sectionController.deleteSection);

module.exports = router;
