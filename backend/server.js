require("dotenv").config();

const http = require("http");
const app = require("./src/app");
const { ensureSystemUsers } = require("./src/services/authService");
const dashboardSnapshotService = require("./src/services/dashboardSnapshotService");

const port = Number(process.env.PORT) || 5000;

const server = http.createServer(app);

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `Port ${port} is already in use. Stop the existing backend process or set a different PORT.`
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.error("Server failed to start:", error?.message || error);
  process.exit(1);
});

server.listen(port, async () => {
  try {
    await ensureSystemUsers();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to ensure system users:", error?.message || error);
  }
  try {
    await dashboardSnapshotService.ensureSchema();
    dashboardSnapshotService.scheduleWarmDefaultSnapshots();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start dashboard snapshot warm:", error?.message || error);
  }
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${port}`);
});
