/**
 * Electron main process (CommonJS .cjs — do NOT rename to .js on Windows;
 * .js can be opened by Windows Script Host instead of Electron).
 */
const { app, BrowserWindow, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

const { ensureBackendReady, stopBackend } = require("./backend-manager.cjs");

const isDev = process.env.ELECTRON_DEV === "1";

/** Packaged app lives in app.asar; dev runs from frontend folder */
function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : __dirname;
}

let mainWindow;
let backendStartupError = null;

function showFatalError(title, message) {
  dialog.showErrorBox(title, message);
  backendStartupError = message;
}

function createWindow() {
  const appRoot = getAppRoot();
  const buildIndexPath = path.join(appRoot, "build", "index.html");
  const preloadPath = path.join(appRoot, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    if (!fs.existsSync(buildIndexPath)) {
      const msg =
        "Production build missing.\n\nFrom the frontend folder run:\n  npm run build\n  npm run electron";
      showFatalError("FEE ERP — Build missing", msg);
      app.quit();
      return;
    }
    mainWindow.loadFile(buildIndexPath);
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    // eslint-disable-next-line no-console
    console.error("[electron] Page failed to load:", errorCode, errorDescription, validatedURL);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  try {
    await ensureBackendReady({
      appRoot: getAppRoot(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });
  } catch (err) {
    const message =
      err?.message ||
      "The API server could not start. Check PostgreSQL is running and backend/.env is configured.";
    // eslint-disable-next-line no-console
    console.error("[electron] Backend startup failed:", message);
    showFatalError("FEE ERP — Backend failed", message);
    app.quit();
    return;
  }

  createWindow();
}

app.whenReady().then(() => {
  bootstrap();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !backendStartupError) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("will-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
