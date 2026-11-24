const express = require("express");
const additionalAmountController = require("../controllers/additionalAmountController");

const router = express.Router();

router.get("/additional-amounts", additionalAmountController.listAdditionalAmounts);
router.post("/additional-amounts", additionalAmountController.createAdditionalAmount);
router.patch("/additional-amounts/:id", additionalAmountController.updateAdditionalAmount);
router.delete("/additional-amounts/:id", additionalAmountController.deleteAdditionalAmount);

module.exports = router;
