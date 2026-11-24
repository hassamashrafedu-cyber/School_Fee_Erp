/**
 * Pre-pack cleanup: stop stale ERP processes and remove old packaging artifacts.
 * Run automatically before dist via npm predist.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FRONTEND_ROOT = path.join(__dirname, "..");
const ROOT = path.join(FRONTEND_ROOT, "..");

const PROCESS_IMAGES = ["FEE-ERP.exe", "fee-erp.exe"];

const REMOVE_PATHS = [
  path.join(FRONTEND_ROOT, "release"),
  path.join(FRONTEND_ROOT, "dist"),
  path.join(FRONTEND_ROOT, "staging"),
  path.join(FRONTEND_ROOT, "release", "_asar-extract"),
  path.join(FRONTEND_ROOT, "release", "verify-packaging"),
];

const STALE_FILES = [
  path.join(FRONTEND_ROOT, "electron.js"),
  path.join(FRONTEND_ROOT, "preload.js"),
  path.join(FRONTEND_ROOT, "build", "electron.js"),
];

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[prepack-cleanup] ${msg}`);
}

function isWindows() {
  return process.platform === "win32";
}

function killProcessImage(imageName) {
  if (!isWindows()) return;
  try {
    execSync(`taskkill /IM ${imageName} /F /T`, {
      stdio: "ignore",
      windowsHide: true,
    });
    log(`Stopped ${imageName}`);
  } catch {
    // not running
  }
}

function killStaleNodeOnBackendPort() {
  if (!isWindows()) return;
  try {
    const out = execSync('netstat -ano | findstr ":5000"', {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore", windowsHide: true });
        log(`Stopped PID ${pid} (port 5000)`);
      } catch {
        // ignore
      }
    }
  } catch {
    // port free
  }
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait for Windows file lock release
  }
}

function removePath(target, attempt = 1) {
  if (!fs.existsSync(target)) return;

  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
    log(`Removed ${path.relative(FRONTEND_ROOT, target)}`);
  } catch (err) {
    if (attempt < 4) {
      log(`Retry remove (${attempt}/3): ${path.relative(FRONTEND_ROOT, target)}`);
      sleep(800);
      removePath(target, attempt + 1);
      return;
    }
    log(`WARN: Could not remove ${target}: ${err.message}`);
    log("Close FEE-ERP.exe / Electron and run cleanup again.");
  }
}

function removeStaleFiles() {
  for (const filePath of STALE_FILES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      fs.unlinkSync(filePath);
      log(`Removed stale file ${path.relative(FRONTEND_ROOT, filePath)}`);
    } catch (err) {
      log(`WARN: ${filePath}: ${err.message}`);
    }
  }
}

function main() {
  log("Starting cleanup…");
  log(`Frontend: ${FRONTEND_ROOT}`);

  for (const image of PROCESS_IMAGES) {
    killProcessImage(image);
  }
  killStaleNodeOnBackendPort();

  for (const dir of REMOVE_PATHS) {
    removePath(dir);
  }

  removeStaleFiles();

  log("Cleanup finished.");
}

main();
