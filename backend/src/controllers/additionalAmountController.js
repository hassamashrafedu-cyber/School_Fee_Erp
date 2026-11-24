const additionalAmountService = require("../services/additionalAmountService");
const dashboardSnapshotService = require("../services/dashboardSnapshotService");
const { AdditionalAmountValidationError, AdditionalAmountNotFoundError } = additionalAmountService;

const createAdditionalAmount = async (req, res) => {
  try {
    const row = await additionalAmountService.createAdditionalAmount(req.body);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.status(201).json(row);
  } catch (error) {
    if (error instanceof AdditionalAmountValidationError) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to save additional amount" });
  }
};

const listAdditionalAmounts = async (req, res) => {
  try {
    const rows = await additionalAmountService.listAdditionalAmounts();
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch additional amounts" });
  }
};

const updateAdditionalAmount = async (req, res) => {
  try {
    const row = await additionalAmountService.updateAdditionalAmount(req.params.id, req.body);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    if (error instanceof AdditionalAmountValidationError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof AdditionalAmountNotFoundError) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to update additional amount" });
  }
};

const deleteAdditionalAmount = async (req, res) => {
  try {
    const row = await additionalAmountService.deleteAdditionalAmount(req.params.id);
    dashboardSnapshotService.scheduleFinanceRefresh();
    return res.json(row);
  } catch (error) {
    if (error instanceof AdditionalAmountValidationError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof AdditionalAmountNotFoundError) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to delete additional amount" });
  }
};

module.exports = {
  createAdditionalAmount,
  listAdditionalAmounts,
  updateAdditionalAmount,
  deleteAdditionalAmount,
};
