/**
 * FEE ERP — production Electron Builder configuration (standalone, no CRA preset).
 * @see https://www.electron.build/configuration
 */
const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

const version = pkg.version || "0.0.0";
const productName = "FEE ERP";

/**
 * electron-builder omits node_modules from extraResources by default.
 * Copy staged backend dependencies after the pack step.
 */
async function afterPack(context) {
  const stagingModules = path.join(__dirname, "staging", "backend", "node_modules");
  const destModules = path.join(context.appOutDir, "resources", "backend", "node_modules");

  if (!fs.existsSync(stagingModules)) {
    throw new Error(
      "afterPack: staging/backend/node_modules missing. Run: npm run predist (includes stage-backend)"
    );
  }

  fs.mkdirSync(path.dirname(destModules), { recursive: true });
  fs.cpSync(stagingModules, destModules, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log("[electron-builder] Copied backend node_modules → resources/backend/node_modules");
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  extends: null,

  appId: "com.school.feeerp",
  productName,
  copyright: `Copyright © ${new Date().getFullYear()}`,

  directories: {
    output: path.join("release", version),
    buildResources: "build-resources",
  },

  extraMetadata: {
    main: "electron-main.cjs",
  },

  /**
   * Only ship the compiled UI + Electron main process files.
   * Never bundle frontend node_modules into app.asar.
   */
  files: [
    "build/**/*",
    "electron-main.cjs",
    "backend-manager.cjs",
    "preload.cjs",
    "package.json",
    "!**/*.map",
    "!**/node_modules/**/*",
    "!src/**/*",
    "!public/**/*",
    "!scripts/**/*",
    "!release/**/*",
    "!dist/**/*",
    "!build-resources/**/*",
    "!electron-builder.config.cjs",
    "!**/.env*",
    "!**/{test,tests,__tests__}/**/*",
  ],

  asar: true,
  asarUnpack: [],

  compression: "maximum",

  extraResources: [
    {
      from: "staging/backend",
      to: "backend",
    },
  ],

  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    executableName: "FEE-ERP",
    artifactName: "${productName}-Setup-${version}.${ext}",
    requestedExecutionLevel: "asInvoker",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
    menuCategory: productName,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    uninstallDisplayName: productName,
    installerLanguages: ["en_US"],
    language: "1033",
    displayLanguageSelector: false,
    /** Stable GUID — required for in-place upgrades */
    guid: "7F4E9A2B-8C1D-4E6F-9A3B-2D5E8F1C4A6B",
    artifactName: "${productName}-Setup-${version}.${ext}",
  },

  npmRebuild: false,
  nodeGypRebuild: false,
  publish: null,

  afterPack,
};
