/**
 * Post-build verification of packaged win-unpacked output.
 */
const fs = require("fs");
const path = require("path");

const FRONTEND_ROOT = path.join(__dirname, "..");
const pkg = require(path.join(FRONTEND_ROOT, "package.json"));
const version = pkg.version || "0.0.0";
const REQUIRED_MAIN = "electron-main.cjs";

const RELEASE_DIR = path.join(FRONTEND_ROOT, "release", version);
const WIN_UNPACKED = path.join(RELEASE_DIR, "win-unpacked");
const ASAR_PATH = path.join(WIN_UNPACKED, "resources", "app.asar");
const BACKEND_ROOT = path.join(WIN_UNPACKED, "resources", "backend");
const EXE_PATH = path.join(WIN_UNPACKED, "FEE-ERP.exe");

let failed = 0;

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[verify-packaged-main] FAIL: ${msg}`);
  failed += 1;
}

function ok(msg) {
  // eslint-disable-next-line no-console
  console.log(`[verify-packaged-main] OK: ${msg}`);
}

function readAsarPackageJson() {
  let asar;
  try {
    asar = require("@electron/asar");
  } catch {
    try {
      asar = require("asar");
    } catch {
      fail("Install @electron/asar or run from frontend (electron-builder bundles asar)");
      return null;
    }
  }

  if (!fs.existsSync(ASAR_PATH)) {
    fail(`Missing app.asar: ${ASAR_PATH}`);
    return null;
  }

  try {
    const buf = asar.extractFile(ASAR_PATH, "package.json");
    return JSON.parse(buf.toString("utf8"));
  } catch (err) {
    fail(`Could not read package.json from app.asar: ${err.message}`);
    return null;
  }
}

function main() {
  // eslint-disable-next-line no-console
  console.log(`[verify-packaged-main] Release: ${RELEASE_DIR}`);

  if (!fs.existsSync(WIN_UNPACKED)) {
    fail(`Missing win-unpacked folder. Run: npm run dist:dir`);
    process.exit(1);
  }

  if (!fs.existsSync(EXE_PATH)) {
    fail(`Missing executable: ${EXE_PATH}`);
  } else {
    ok("FEE-ERP.exe present");
  }

  const asarPkg = readAsarPackageJson();
  if (asarPkg) {
    if (asarPkg.main !== REQUIRED_MAIN) {
      fail(`app.asar package.json main="${asarPkg.main}" expected "${REQUIRED_MAIN}"`);
    } else {
      ok(`app.asar main → ${REQUIRED_MAIN}`);
    }

    const entries = fs.readdirSync(path.dirname(ASAR_PATH));
    if (entries.some((e) => e === "app" && fs.statSync(path.join(path.dirname(ASAR_PATH), e)).isDirectory())) {
      fail("Unpackaged app/ folder detected alongside app.asar (duplicate layout)");
    }
  }

  const backendServer = path.join(BACKEND_ROOT, "server.js");
  const backendModules = path.join(BACKEND_ROOT, "node_modules");
  if (!fs.existsSync(backendServer)) {
    fail(`Backend not in extraResources: ${backendServer}`);
  } else {
    ok("resources/backend/server.js");
  }

  if (!fs.existsSync(backendModules)) {
    fail("Backend node_modules missing in resources/backend — run npm install in backend/");
  } else {
    ok("resources/backend/node_modules");
  }

  const setupGlob = fs
    .readdirSync(RELEASE_DIR)
    .filter((f) => f.endsWith(".exe") && f.includes("Setup"));
  if (setupGlob.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[verify-packaged-main] WARN: NSIS Setup .exe not found (dist:dir skips installer)");
  } else {
    ok(`Installer: ${setupGlob.join(", ")}`);
  }

  if (failed > 0) {
    process.exit(1);
  }

  ok("Packaged output verification passed");
}

main();
