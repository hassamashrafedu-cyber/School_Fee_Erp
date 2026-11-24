const authService = require("../services/authService");
const { AuthValidationError } = authService;

const login = async (req, res) => {
  try {
    const { role, password } = req.body;
    const result = await authService.loginByRole(role, password);
    return res.json(result);
  } catch (error) {
    if (error instanceof AuthValidationError) {
      const status = error.statusCode || 400;
      return res.status(status).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to login" });
  }
};

const changeRolePassword = async (req, res) => {
  try {
    const { admin_current_password, target_role, new_password } = req.body;
    const result = await authService.changeRolePassword({
      adminUserId: req.user?.id,
      adminCurrentPassword: admin_current_password,
      targetRole: target_role,
      newPassword: new_password,
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof AuthValidationError) {
      const status = error.statusCode || 400;
      return res.status(status).json({ message: error.message });
    }
    return res.status(500).json({ message: "Failed to change password" });
  }
};

module.exports = {
  login,
  changeRolePassword,
};
