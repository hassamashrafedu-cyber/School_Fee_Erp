const express = require("express");
const expenseController = require("../controllers/expenseController");

const router = express.Router();

router.get("/expenses", expenseController.listExpenses);
router.post("/expenses", expenseController.createExpense);
router.patch("/expenses/:id", expenseController.updateExpense);
router.delete("/expenses/:id", expenseController.deleteExpense);

module.exports = router;
