const express = require("express");
const feeController = require("../controllers/feeController");

const router = express.Router();

router.get("/fees/config", feeController.getFeeConfig);
router.post("/fees/config", feeController.saveFeeConfig);
router.delete("/fees/config/class", feeController.deleteClassFeeBilling);

router.get("/fees/structure", feeController.listClassFeeStructure);
router.post("/fees/structure", feeController.upsertClassFeeStructure);

router.get("/fees/challan-lines", feeController.getChallanFeeLines);

router.post("/fees/components", feeController.createFeeComponent);
router.patch("/fees/components/:id", feeController.updateFeeComponent);
router.delete("/fees/components/:id", feeController.deleteFeeComponent);
router.post("/fees/component-month-amount", feeController.upsertComponentMonthAmount);

router.get("/fees/advance-links", feeController.listAdvanceLinks);
router.post("/fees/advance-links", feeController.createAdvanceLink);
router.delete("/fees/advance-links/:id", feeController.deleteAdvanceLink);

router.post("/fees/assign", feeController.assignFeeToStudent);
router.get("/student-fee", feeController.getStudentFee);

module.exports = router;
