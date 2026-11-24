const express = require("express");
const settingsController = require("../controllers/settingsController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();
const adminOnly = authorize(["admin"]);

router.get("/settings", settingsController.getSettings);
router.get("/settings/about", settingsController.getAbout);
router.put("/settings", adminOnly, settingsController.updateSettings);
router.put("/settings/logo", adminOnly, settingsController.updateLogo);
router.delete("/settings/logo", adminOnly, settingsController.clearLogo);
router.post("/settings/backup", adminOnly, settingsController.createBackup);
router.post("/settings/restore", adminOnly, settingsController.restoreBackup);

module.exports = router;
