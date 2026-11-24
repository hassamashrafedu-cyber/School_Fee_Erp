const settingsService = require("../services/settingsService");

const handleError = (res, error) => {
  const status = error?.statusCode || 500;
  return res.status(status).json({
    message: error?.message || "Settings request failed",
  });
};

const getSettings = async (req, res) => {
  try {
    const settings = await settingsService.getSettings();
    return res.json(settings);
  } catch (error) {
    return handleError(res, error);
  }
};

const updateSettings = async (req, res) => {
  try {
    const settings = await settingsService.updateSettings(req.body || {});
    return res.json(settings);
  } catch (error) {
    return handleError(res, error);
  }
};

const updateLogo = async (req, res) => {
  try {
    const settings = await settingsService.updateLogo({
      logo_data: req.body?.logo_data,
      logo_mime: req.body?.logo_mime,
    });
    return res.json(settings);
  } catch (error) {
    return handleError(res, error);
  }
};

const clearLogo = async (req, res) => {
  try {
    const settings = await settingsService.clearLogo();
    return res.json(settings);
  } catch (error) {
    return handleError(res, error);
  }
};

const getAbout = async (req, res) => {
  try {
    return res.json(settingsService.getAbout());
  } catch (error) {
    return handleError(res, error);
  }
};

const createBackup = async (req, res) => {
  try {
    const backup = await settingsService.createBackup();
    return res.json(backup);
  } catch (error) {
    return handleError(res, error);
  }
};

const restoreBackup = async (req, res) => {
  try {
    const result = await settingsService.restoreBackup(req.body?.sql || req.body?.content);
    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  updateLogo,
  clearLogo,
  getAbout,
  createBackup,
  restoreBackup,
};
