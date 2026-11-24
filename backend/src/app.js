const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const testRoutes = require("./routes/testRoutes");
const studentRoutes = require("./routes/studentRoutes");
const classRoutes = require("./routes/classRoutes");
const sectionRoutes = require("./routes/sectionRoutes");
const configRoutes = require("./routes/configRoutes");
const feeRoutes = require("./routes/feeRoutes");
const challanRoutes = require("./routes/challanRoutes");
const reportRoutes = require("./routes/reportRoutes");
const academicRoutes = require("./routes/academicRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const additionalAmountRoutes = require("./routes/additionalAmountRoutes");
const purgeRoutes = require("./routes/purgeRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const staffPayrollRoutes = require("./routes/staffPayrollRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const { authenticate } = require("./middleware/authMiddleware");
const settingsService = require("./services/settingsService");
const staffPayrollService = require("./services/staffPayrollService");

const app = express();

// Core middleware
app.use(cors());
app.use(express.json({ limit: "12mb" }));

// Health / connectivity check
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send("Backend is running 🚀");
});

app.use("/api", authRoutes);

app.use("/api", authenticate, testRoutes);
app.use("/api", authenticate, studentRoutes);
app.use("/api", authenticate, classRoutes);
app.use("/api", authenticate, sectionRoutes);
app.use("/api", authenticate, configRoutes);
app.use("/api", authenticate, feeRoutes);
app.use("/api", authenticate, challanRoutes);
app.use("/api", authenticate, reportRoutes);
app.use("/api", authenticate, academicRoutes);
app.use("/api", authenticate, expenseRoutes);
app.use("/api", authenticate, additionalAmountRoutes);
app.use("/api", authenticate, purgeRoutes);
app.use("/api", authenticate, settingsRoutes);
app.use("/api", authenticate, staffPayrollRoutes);
app.use("/api", authenticate, whatsappRoutes);

settingsService.ensureSchema().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to ensure app_settings schema:", error?.message || error);
});

staffPayrollService.ensureSchema().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to ensure staff payroll schema:", error?.message || error);
});

module.exports = app;
