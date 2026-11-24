const express = require("express");
const authController = require("../controllers/authController");
const { authenticate, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", authController.login);
router.post(
  "/auth/change-role-password",
  authenticate,
  authorize(["admin"]),
  authController.changeRolePassword
);

module.exports = router;
