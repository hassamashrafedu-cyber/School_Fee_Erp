/**
 * Pre-build verification — fails fast before electron-builder runs.
 */
const fs = require("fs");
const path = require("path");

const FRONTEND_ROOT = path.join(__dirname, "..");
const BACKEND_ROOT = path.join(FRONTEND_ROOT, "..", "backend");

const REQUIRED_MAIN = "electron-main.cjs";
const FORBIDDEN = [
  path.join(FRONTEND_ROOT, "electron.js"),
  path.join(FRONTEND_ROOT, "build", "electron.js"),
];

let failed = 0;

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(`[verify-packaging] FAIL: ${msg}`);
  failed += 1;
}

function ok(msg) {
  // eslint-disable-next-line no-console
  console.log(`[verify-packaging] OK: ${msg}`);
}

function fileExists(p) {
  return fs.existsSync(p);
}

function main() {
  const pkgPath = path.join(FRONTEND_ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  if (pkg.main !== REQUIRED_MAIN) {
    fail(`package.json "main" must be "${REQUIRED_MAIN}" (got "${pkg.main || ""}")`);
  } else {
    ok(`package.json main → ${REQUIRED_MAIN}`);
  }

  if (pkg.build && Object.keys(pkg.build).length > 0) {
    fail('Remove legacy "build" block from package.json — use electron-builder.config.cjs only');
  } else {
    ok("No duplicate electron-builder config in package.json");
  }

  const configPath = path.join(FRONTEND_ROOT, "electron-builder.config.cjs");
  if (!fileExists(configPath)) {
    fail("Missing electron-builder.config.cjs");
  } else {
    const config = require(configPath);
    if (config.extends != null) {
      fail('electron-builder.config.cjs must set extends: null (no CRA preset)');
    } else {
      ok("electron-builder.config.cjs extends: null");
    }
    if (config.extraMetadata?.main !== REQUIRED_MAIN) {
      fail(`extraMetadata.main must be ${REQUIRED_MAIN}`);
    } else {
      ok("extraMetadata.main correct");
    }
  }

  for (const forbidden of FORBIDDEN) {
    if (fileExists(forbidden)) {
      fail(`Stale file must be removed: ${path.relative(FRONTEND_ROOT, forbidden)}`);
    }
  }
  ok("No stale electron.js entry files");

  const required = [
    [path.join(FRONTEND_ROOT, "build", "index.html"), "React production build"],
    [path.join(FRONTEND_ROOT, REQUIRED_MAIN), "Electron main"],
    [path.join(FRONTEND_ROOT, "backend-manager.cjs"), "Backend manager"],
    [path.join(FRONTEND_ROOT, "preload.cjs"), "Preload script"],
    [path.join(BACKEND_ROOT, "server.js"), "Backend entry"],
    [path.join(BACKEND_ROOT, "node_modules"), "Backend node_modules"],
    [path.join(FRONTEND_ROOT, "staging", "backend", "server.js"), "Staged backend"],
    [path.join(FRONTEND_ROOT, "staging", "backend", "node_modules"), "Staged backend node_modules"],
  ];

  for (const [p, label] of required) {
    if (!fileExists(p)) {
      fail(`Missing ${label}: ${p}`);
    } else {
      ok(label);
    }
  }

  const indexHtml = fs.readFileSync(path.join(FRONTEND_ROOT, "build", "index.html"), "utf8");
  if (indexHtml.includes('src="/static/')) {
    fail('build/index.html uses absolute /static paths — set "homepage": "." in package.json and rebuild');
  } else {
    ok("build/index.html uses relative asset paths");
  }

  if (!fileExists(path.join(BACKEND_ROOT, ".env"))) {
    // eslint-disable-next-line no-console
    console.warn(
      "[verify-packaging] WARN: backend/.env not found — installer will ship .env.example; configure on target PC"
    );
  } else {
    ok("backend/.env present for packaging");
  }

  if (failed > 0) {
    process.exit(1);
  }

  ok("All pre-packaging checks passed");
}

main();
