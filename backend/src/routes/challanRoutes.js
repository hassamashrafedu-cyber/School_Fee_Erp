const express = require("express");
const challanController = require("../controllers/challanController");

const router = express.Router();

router.post("/challans", challanController.createChallan);
router.post("/challans/generate-preview", challanController.generateChallanPreview);
router.get("/challans/:id", challanController.getChallanDetails);

router.post("/challan-items", challanController.addChallanItem);

router.post("/payments", challanController.addPayment);
router.get("/payments/student/:student_id", challanController.getStudentPayments);
router.get("/student-ledger/:student_id", challanController.getStudentLedger);
router.delete("/payments/:id", challanController.deletePayment);
router.post("/concessions", challanController.addConcession);

router.get("/student-summary/:student_id", challanController.getStudentSummary);

module.exports = router;
