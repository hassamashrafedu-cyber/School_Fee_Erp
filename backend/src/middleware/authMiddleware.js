const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  let token = req.headers.authorization || "";

  if (!token) {
    return res.status(401).json({ message: "Token invalid" });
  }

  if (token.startsWith("Bearer ")) {
    token = token.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Token invalid" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ message: "JWT_SECRET is not configured" });
  }

  try {
    const payload = jwt.verify(token, secret);
    const role = String(payload.role || "").toLowerCase();
    req.user = {
      id: payload.id,
      role: role === "staff" ? "accountant" : role,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Token invalid" });
  }
};

const authorize = (roles) => (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  return next();
};

module.exports = {
  authenticate,
  authorize,
};
