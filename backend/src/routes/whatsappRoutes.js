const express = require("express");
const whatsappController = require("../controllers/whatsappController");
const { authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/whatsapp/status", authorize(["admin", "accountant"]), whatsappController.getStatus);
router.post(
  "/whatsapp/send-fee-reminders",
  authorize(["admin", "accountant"]),
  whatsappController.sendFeeReminders
);

module.exports = router;
