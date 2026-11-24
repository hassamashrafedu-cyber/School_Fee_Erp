# FEE ERP — Desktop packaging (clean build)

## One-time setup

```powershell
cd backend
npm install
copy .env.example .env
# Edit .env with PostgreSQL credentials

cd ..\frontend
npm install
# Ensure frontend\.env has:
# REACT_APP_API_BASE_URL=http://localhost:5000/api
```

## Build commands

| Command | Output |
|---------|--------|
| `npm run pack:clean` | Stop FEE-ERP, clear `release/`, `staging/`, `dist/` |
| `npm run pack:verify` | Pre-flight checks |
| `npm run dist:dir` | Unpacked app → `release/0.1.0/win-unpacked/` |
| `npm run dist` | NSIS installer + unpacked |
| `npm run pack:verify-out` | Validate `app.asar` + backend resources |

**Full installer (recommended for schools):**

```powershell
cd frontend
npm run dist
```

**Test unpacked build without installer:**

```powershell
npm run dist:dir
.\release\0.1.0\win-unpacked\FEE-ERP.exe
```

## Output layout

```
frontend/release/0.1.0/
├── FEE ERP-Setup-0.1.0.exe     # NSIS installer (npm run dist)
└── win-unpacked/
    ├── FEE-ERP.exe
    └── resources/
        ├── app.asar            # UI only (~1 MB) — main: electron-main.cjs
        └── backend/            # Express API + node_modules (outside asar)
            ├── server.js
            ├── src/
            ├── node_modules/
            └── .env              # included if present at build time
```

## Architecture

- **Entry:** `electron-main.cjs` only (never `electron.js` — Windows Script Host conflict)
- **Config:** `electron-builder.config.cjs` with `extends: null` (no CRA preset)
- **Backend:** staged to `frontend/staging/backend`, copied to `resources/backend`
- **node_modules:** copied in `afterPack` hook (electron-builder strips them from extraResources)
- **Runtime:** Electron starts backend via `backend-manager.cjs`, health-checks port 5000, then loads UI

## School deployment

1. Install **PostgreSQL**, create database from `database/schema.sql` (+ patches).
2. Run **FEE ERP Setup** installer.
3. If `.env` was not bundled: copy  
   `install-dir\resources\backend\.env.example` → `.env` and set DB password.
4. Ensure PostgreSQL Windows service is running.
5. Launch **FEE ERP** from desktop shortcut.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| JScript error on double-click | Use shortcut or `FEE-ERP.exe`, not `.cjs` files |
| Build fails "file locked" | `npm run pack:clean`, close FEE-ERP.exe |
| Blank white window | Rebuild React: `npm run build` (needs `homepage: "."`) |
| Backend failed | Start PostgreSQL; check `resources\backend\.env` |
| Missing backend modules | `cd backend && npm install`, then `npm run dist` |
