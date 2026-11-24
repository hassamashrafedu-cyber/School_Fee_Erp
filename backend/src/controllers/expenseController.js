const expenseService = require("../services/expenseService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { ExpenseValidationError, ExpenseNotFoundError } = expenseService;

const createExpense = async (req, res) => {
  try {
    const row = await expenseService.createExpense(req.body);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof ExpenseValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to save expense" });
  }
};

const listExpenses = async (req, res) => {
  try {
    const rows = await expenseService.listExpenses(req.query);
    return res.json(rows);
  } catch (error) {
    if (error instanceof ExpenseValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to fetch expenses" });
  }
};

const updateExpense = async (req, res) => {
  try {
    const row = await expenseService.updateExpense(req.params.id, req.body);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    if (error instanceof ExpenseValidationError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof ExpenseNotFoundError) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to update expense" });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const row = await expenseService.deleteExpense(req.params.id);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    if (error instanceof ExpenseValidationError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof ExpenseNotFoundError) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to delete expense" });
  }
};

module.exports = {
  createExpense,
  updateExpense,
  deleteExpense,
  listExpenses,
};
