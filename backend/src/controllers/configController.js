const configService = require("../services/configService");
const { DuplicateConfigError, ConfigInUseError } = configService;

const createFeeType = async (req, res) => {
  try {
    const row = await configService.createFeeType(req.body.name);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof DuplicateConfigError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to create fee type" });
  }
};

const getFeeTypes = async (req, res) => {
  try {
    const rows = await configService.getFeeTypes();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch fee types" });
  }
};

const updateFeeType = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await configService.updateFeeType(id, req.body.name);
    return res.json(row);
  } catch (error) {
    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ message: error.message });
    }
    if (error instanceof DuplicateConfigError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to update fee type" });
  }
};

const deleteFeeType = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await configService.deleteFeeType(id);
    return res.json(result);
  } catch (error) {
    if (error instanceof ConfigInUseError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to delete fee type" });
  }
};

const createExpenseCategory = async (req, res) => {
  try {
    const row = await configService.createExpenseCategory(req.body.name);
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof DuplicateConfigError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to create expense category" });
  }
};

const getExpenseCategories = async (req, res) => {
  try {
    const rows = await configService.getExpenseCategories();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch expense categories" });
  }
};

const deleteExpenseCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await configService.deleteExpenseCategory(id);
    return res.json(result);
  } catch (error) {
    if (error instanceof ConfigInUseError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to delete expense category" });
  }
};

const getCampuses = async (req, res) => {
  try {
    const rows = await configService.getCampuses();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch campuses" });
  }
};

module.exports = {
  createFeeType,
  getFeeTypes,
  updateFeeType,
  deleteFeeType,
  createExpenseCategory,
  getExpenseCategories,
  deleteExpenseCategory,
  getCampuses,
};
