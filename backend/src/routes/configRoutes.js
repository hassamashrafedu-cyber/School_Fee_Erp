const express = require("express");
const configController = require("../controllers/configController");

const router = express.Router();

router.post("/fee-types", configController.createFeeType);
router.get("/fee-types", configController.getFeeTypes);
router.patch("/fee-types/:id", configController.updateFeeType);
router.delete("/fee-types/:id", configController.deleteFeeType);

router.post("/expense-categories", configController.createExpenseCategory);
router.get("/expense-categories", configController.getExpenseCategories);
router.delete("/expense-categories/:id", configController.deleteExpenseCategory);

router.get("/campuses", configController.getCampuses);

module.exports = router;
