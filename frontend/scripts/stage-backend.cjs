/**
 * Copies backend (including node_modules) into frontend/staging/backend
 * for deterministic electron-builder extraResources packaging.
 */
const fs = require("fs");
const path = require("path");

const FRONTEND_ROOT = path.join(__dirname, "..");
const BACKEND_ROOT = path.join(FRONTEND_ROOT, "..", "backend");
const STAGING_ROOT = path.join(FRONTEND_ROOT, "staging", "backend");

const COPY_ITEMS = ["server.js", "package.json", "package-lock.json", ".env.example", "src", "node_modules"];

function getCopyItems() {
  const items = [...COPY_ITEMS];
  const envPath = path.join(BACKEND_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    items.splice(items.indexOf(".env.example") + 1, 0, ".env");
  }
  return items;
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[stage-backend] ${msg}`);
}

function main() {
  if (!fs.existsSync(path.join(BACKEND_ROOT, "server.js"))) {
    console.error("[stage-backend] FAIL: backend/server.js not found");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(BACKEND_ROOT, "node_modules"))) {
    console.error("[stage-backend] FAIL: Run npm install in backend/ first");
    process.exit(1);
  }

  fs.rmSync(path.join(FRONTEND_ROOT, "staging"), { recursive: true, force: true });
  fs.mkdirSync(STAGING_ROOT, { recursive: true });

  for (const item of getCopyItems()) {
    const src = path.join(BACKEND_ROOT, item);
    const dest = path.join(STAGING_ROOT, item);
    if (!fs.existsSync(src)) {
      if (item === ".env.example") {
        log(`Skip missing ${item}`);
        continue;
      }
      console.error(`[stage-backend] FAIL: missing ${src}`);
      process.exit(1);
    }
    log(`Copying ${item}…`);
    fs.cpSync(src, dest, { recursive: true, force: true });
  }

  log(`Staged backend at ${STAGING_ROOT}`);
}

main();
