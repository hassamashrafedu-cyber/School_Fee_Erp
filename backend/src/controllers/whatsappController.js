const whatsappService = require("../services/whatsappService");
const { WhatsAppValidationError } = whatsappService;

const getStatus = async (req, res) => {
  try {
    return res.json(whatsappService.getStatus());
  } catch (error) {
    return res.status(500).json({ message: "Failed to read WhatsApp status" });
  }
};

const sendFeeReminders = async (req, res) => {
  try {
    const data = await whatsappService.sendFeeReminders(req.body || {});
    return res.json(data);
  } catch (error) {
    if (error instanceof WhatsAppValidationError) {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    return res.status(500).json({ message: error?.message || "Failed to send WhatsApp messages" });
  }
};

module.exports = {
  getStatus,
  sendFeeReminders,
};
