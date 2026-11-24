/**
 * Manages the Express backend lifecycle for the Electron desktop app.
 * Uses Electron's embedded Node (ELECTRON_RUN_AS_NODE) so schools do not need Node in PATH.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const DEFAULT_PORT = 5000;
const HEALTH_PATH = "/";
const HEALTH_HOST = "127.0.0.1";
const HEALTH_POLL_MS = 400;
const HEALTH_TIMEOUT_MS = 90000;
const LOG_PREFIX = "[backend]";

let managedChild = null;
let weStartedBackend = false;
let resolvedBackendRoot = null;
let resolvedPort = DEFAULT_PORT;

function log(line) {
  // eslint-disable-next-line no-console
  console.log(`${LOG_PREFIX} ${line}`);
}

function logError(line) {
  // eslint-disable-next-line no-console
  console.error(`${LOG_PREFIX} ${line}`);
}

/**
 * @param {{ appRoot: string, isPackaged: boolean, resourcesPath?: string }} opts
 */
function resolveBackendRoot(opts) {
  const { appRoot, isPackaged, resourcesPath } = opts;

  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, "backend");
  }

  return path.join(appRoot, "..", "backend");
}

function readBackendPort(backendRoot) {
  const envPath = path.join(backendRoot, ".env");
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const match = text.match(/^PORT\s*=\s*(\d+)\s*$/m);
    if (match) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        return port;
      }
    }
  } catch {
    // .env optional at read time; server.js still loads dotenv from cwd
  }
  return DEFAULT_PORT;
}

function validateBackendLayout(backendRoot) {
  const serverPath = path.join(backendRoot, "server.js");
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Backend entry not found: ${serverPath}`);
  }
  const srcPath = path.join(backendRoot, "src");
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Backend src folder not found: ${srcPath}`);
  }
  return serverPath;
}

function waitForHealth(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Backend did not respond on port ${port} within ${timeoutMs / 1000}s`));
        return;
      }

      const req = http.get(
        {
          host: HEALTH_HOST,
          port,
          path: HEALTH_PATH,
          timeout: 2500,
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
            return;
          }
          setTimeout(attempt, HEALTH_POLL_MS);
        }
      );

      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, HEALTH_POLL_MS);
      });

      req.on("error", () => {
        setTimeout(attempt, HEALTH_POLL_MS);
      });
    };

    attempt();
  });
}

function isPortInUseMessage(text) {
  return /EADDRINUSE|already in use/i.test(String(text || ""));
}

function attachChildLogging(child) {
  child.stdout?.on("data", (chunk) => {
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => log(line));
  });

  child.stderr?.on("data", (chunk) => {
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => logError(line));
  });

  child.on("error", (err) => {
    logError(`Process error: ${err.message}`);
  });

  child.on("exit", (code, signal) => {
    if (weStartedBackend && code !== 0 && code !== null) {
      logError(`Process exited (code=${code}, signal=${signal})`);
    }
    if (managedChild === child) {
      managedChild = null;
      weStartedBackend = false;
    }
  });
}

function spawnBackend(serverPath, backendRoot, port) {
  if (managedChild && !managedChild.killed) {
    return managedChild;
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_ERP_MANAGED: "1",
    PORT: String(port),
  };

  const child = spawn(process.execPath, [serverPath], {
    cwd: backendRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });

  managedChild = child;
  weStartedBackend = true;
  attachChildLogging(child);
  log(`Started (pid=${child.pid}, port=${port})`);
  return child;
}

function killProcessTree(child) {
  if (!child || child.killed) return;

  const pid = child.pid;
  if (!pid) return;

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 3000);
    }
  } catch (err) {
    logError(`Failed to stop process: ${err.message}`);
  } finally {
    managedChild = null;
    weStartedBackend = false;
  }
}

/**
 * Ensure backend is listening before the UI loads.
 * @param {{ appRoot: string, isPackaged: boolean, resourcesPath?: string }} opts
 */
async function ensureBackendReady(opts) {
  const backendRoot = path.resolve(resolveBackendRoot(opts));
  resolvedBackendRoot = backendRoot;
  resolvedPort = readBackendPort(backendRoot);

  log(`Root: ${backendRoot}`);
  log(`Expected port: ${resolvedPort}`);

  const serverPath = validateBackendLayout(backendRoot);

  try {
    await waitForHealth(resolvedPort, 1500);
    log(`Already running on port ${resolvedPort} (reusing existing server)`);
    weStartedBackend = false;
    managedChild = null;
    return { port: resolvedPort, reused: true, backendRoot };
  } catch {
    // Not up yet — start or wait for our child
  }

  if (!managedChild || managedChild.killed) {
    spawnBackend(serverPath, backendRoot, resolvedPort);
  }

  let portInUseDetected = false;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Backend startup timed out after ${HEALTH_TIMEOUT_MS / 1000}s`)));
    }, HEALTH_TIMEOUT_MS);

    const child = managedChild;
    if (!child) {
      clearTimeout(timeout);
      reject(new Error("Backend child process was not created"));
      return;
    }

    const onStderr = (chunk) => {
      if (isPortInUseMessage(chunk)) {
        portInUseDetected = true;
      }
    };
    child.stderr?.on("data", onStderr);

    const onReady = () => {
      clearTimeout(timeout);
      child.stderr?.off("data", onStderr);
      finish(resolve);
    };

    const onFailed = (err) => {
      clearTimeout(timeout);
      child.stderr?.off("data", onStderr);
      finish(() => reject(err));
    };

    waitForHealth(resolvedPort, HEALTH_TIMEOUT_MS)
      .then(onReady)
      .catch(async (err) => {
        if (portInUseDetected) {
          try {
            await waitForHealth(resolvedPort, 5000);
            log(`Port ${resolvedPort} in use by another process — reusing it`);
            weStartedBackend = false;
            if (managedChild === child) {
              managedChild = null;
            }
            onReady();
            return;
          } catch {
            onFailed(
              new Error(
                `Port ${resolvedPort} is in use but health check failed. Stop the other process or change PORT in backend/.env`
              )
            );
            return;
          }
        }
        onFailed(err);
      });

    child.once("exit", (code) => {
      if (settled || portInUseDetected) return;
      if (code !== 0 && code !== null) {
        onFailed(new Error(`Backend exited before ready (code=${code})`));
      }
    });
  });

  return { port: resolvedPort, reused: false, backendRoot };
}

function stopBackend() {
  if (!weStartedBackend || !managedChild) {
    log("Stop skipped (backend was not started by Electron)");
    return;
  }
  log("Stopping managed backend…");
  killProcessTree(managedChild);
}

function getBackendInfo() {
  return {
    port: resolvedPort,
    backendRoot: resolvedBackendRoot,
    weStartedBackend,
    pid: managedChild?.pid ?? null,
  };
}

module.exports = {
  ensureBackendReady,
  stopBackend,
  getBackendInfo,
  DEFAULT_PORT,
  HEALTH_HOST,
};
