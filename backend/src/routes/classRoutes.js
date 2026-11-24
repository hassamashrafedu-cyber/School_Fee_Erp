const express = require("express");
const classController = require("../controllers/classController");

const router = express.Router();

router.post("/classes", classController.createClass);
router.get("/classes", classController.getClasses);
router.put("/classes/:id", classController.updateClass);
router.delete("/classes/:id", classController.deleteClass);

module.exports = router;
