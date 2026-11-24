# School Fee ERP

A React and Express school fee management system with a PostgreSQL database and an Electron desktop application.

## Overview

School Fee ERP keeps student, class, fee, payment, and expense records in one application.
It supports fee billing and collection workflows, including monthly challans, partial payments, concessions, and outstanding balances.
Administrators manage academic and system settings, while accountants can access day-to-day student and finance workflows.
The frontend can also be packaged with Electron for a Windows desktop installation; the application uses a locally configured PostgreSQL database.

## Demo

[Watch the demo video](ADD_VIDEO_LINK_HERE)

## Screenshots

Add images to the `/screenshots` folder and update these paths when available.

| Dashboard | Student list |
| --- | --- |
| ![Dashboard](screenshots/dashboard.png) | ![Student list](screenshots/student-list.png) |

| Fee challan | Reports |
| --- | --- |
| ![Fee challan](screenshots/fee-challan.png) | ![Reports](screenshots/reports.png) |

## Key Features

### Students and Classes
- Manage student records, classes, and sections.
- Maintain academic years, enrollment history, promotions, and alumni records.

### Fees and Challans
- Configure fee structures, billing periods, and additional class fee components.
- Generate and print challans; track due dates, balances, and outstanding fees.
- Configure concessions and optional advance-fee links.

### Payments and Receipts
- Record payments by cash, bank, or online method, including partial payments.
- View student payment history and fee ledger; print challans and payment records where supported by the interface.

### Expenses and Reports
- Record expenses and categories, and review fee registers, defaulters, class collections, expenses, and profit reports.
- Manage staff records and monthly salary processing.

### Users and Roles
- Authenticate as an administrator or accountant, with role-specific access to selected screens and operations.
- Administrators can update settings and credentials, manage academic-year actions, and access administration-only functions.

### WhatsApp
- Check WhatsApp integration status and send fee reminders through the configured Meta WhatsApp Cloud API.
- This integration requires valid credentials and a matching message template configured outside the frontend.

## Tech Stack

| Layer | Technologies used |
| --- | --- |
| Frontend | React 18, React Router, Axios, Recharts, CSS |
| Backend | Node.js, Express, `pg`, `bcrypt`, `jsonwebtoken`, `dotenv`, `cors` |
| Database | PostgreSQL, SQL schema and patch scripts, `pgcrypto` extension |
| Desktop | Electron, Electron Builder (Windows NSIS installer configuration) |
| Tools | npm, Create React App (`react-scripts`), `concurrently`, `wait-on`, `cross-env` |

## Project Structure

```text
.
├── backend/       Express API, authentication, and business logic
├── database/      PostgreSQL schema and SQL patch files
├── docs/          Installation and upgrade guidance
└── frontend/      React application, Electron entry points, and packaging scripts
```

## Getting Started

### Prerequisites

- Node.js and npm: [TODO: confirm supported versions; package files do not declare an `engines` range].
- PostgreSQL: [TODO: confirm supported version; no minimum version is declared]. The schema enables PostgreSQL's `pgcrypto` extension.
- For the packaged desktop app, the repository configures a Windows x64 NSIS installer. A running PostgreSQL service is required for application data.

### Clone the repository

```bash
git clone https://github.com/hassamashrafedu-cyber/School_Fee_Erp.git
cd School_Fee_Erp
```

### Database setup

Create a PostgreSQL database matching `DB_NAME` in `backend/.env` (the example uses `school_management_db`). For example:

```bash
createdb school_management_db
psql -d school_management_db -f database/schema.sql
```

`database/schema.sql` is the full schema for a fresh database. The repository also contains `database/patch_*.sql` scripts for changes and upgrades. For an existing installation, back up the database first and apply only the patches needed for that database version; do not blindly rerun every patch. See `docs/SCHOOL_INSTALL_AND_VERSION_UPGRADE_GUIDE.txt`.

### Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` for the local PostgreSQL connection and set a strong `JWT_SECRET`. The backend reads these variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the API (defaults to `5000` in the server code). |
| `DB_USER` | PostgreSQL user. |
| `DB_HOST` | PostgreSQL host. |
| `DB_NAME` | PostgreSQL database name. |
| `DB_PASSWORD` | PostgreSQL user password. |
| `DB_PORT` | PostgreSQL port (defaults to `5432` in the database connection). |
| `JWT_SECRET` | Secret used to sign and verify authentication tokens; set a strong private value. |
| `JWT_EXPIRES_IN` | Token lifetime (the code defaults to `1d`). |
| `DEFAULT_ADMIN_PASSWORD` | Initial administrator password when the system administrator is first created. |
| `DEFAULT_ACCOUNTANT_PASSWORD` | Initial accountant password when the system accountant is first created. |
| `WHATSAPP_ACCESS_TOKEN` | Optional Meta WhatsApp Cloud API access token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional WhatsApp Cloud API phone-number ID. |
| `WHATSAPP_WABA_ID` | Optional WhatsApp Business Account ID. |
| `WHATSAPP_TEMPLATE_NAME` | WhatsApp message template name. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code. |
| `WHATSAPP_API_VERSION` | WhatsApp Graph API version. |
| `WHATSAPP_BODY_VARS` | Names of the configured message body variables. |
| `WHATSAPP_HEADER_VAR` | Name of the configured message header variable. |
| `WHATSAPP_SEND_DELAY_MS` | Delay between reminder send requests, in milliseconds. |

Keep `.env` private and never commit real credentials. Start the API with:

```bash
npm start
```

### Frontend setup

In another terminal:

```bash
cd frontend
npm install
cp .env.example .env
npm start
```

Frontend environment variables in `frontend/.env.example`:

| Variable | Purpose |
| --- | --- |
| `BROWSER` | Controls browser launching during local React development. |
| `HOST` | Development server host. |
| `WDS_SOCKET_HOST` | Webpack development-server socket host. |
| `PUBLIC_URL` | Public path for the built frontend. |
| `REACT_APP_API_BASE_URL` | API base URL; the example points to `http://localhost:5000/api`. |

### Electron desktop app and installer

Install backend and frontend dependencies as above. The Electron desktop process starts the packaged backend; configure the backend `.env` and PostgreSQL connection as described above. Run the combined development workflow from `frontend/`:

```bash
npm run dev
```

Build the Windows installer from `frontend/`:

```bash
npm run dist
```

The configured installer output is under `frontend/release/0.1.0/`. To produce an unpacked build instead, run `npm run dist:dir`. Packaging preflight and output checks are available with `npm run pack:verify` and `npm run pack:verify-out`; see `frontend/PACKAGING.md` for the packaging flow and deployment notes.

## Roles and Permissions

| Role | Verified access in the code |
| --- | --- |
| Administrator | Access to dashboard and settings screens; can manage settings and passwords, academic-year changes and student promotions, staff payroll mutations, and administrative purge actions. Also has access to the shared operational workflows. |
| Accountant | Access to shared student, class, fee, challan, payment, expense, and reporting workflows, plus WhatsApp reminders. The dashboard and settings screens and the explicitly admin-only operations are restricted. |

Most operational API routes require authentication. Specific operations are additionally restricted in backend routes; the frontend also hides or blocks selected admin-only screens. See `backend/src/routes/` for the current route-level rules.

## Security Notes

- `.env` files are ignored by Git; commit only the `.env.example` templates. Never include real credentials in source control or installer builds.
- User passwords are hashed with `bcrypt` before storage and checked against the stored hash at login.
- The API uses JWT authentication and role checks. Set a strong `JWT_SECRET` and change initial role passwords for a real deployment.
- WhatsApp credentials belong only in the backend environment, never in the frontend.

## Roadmap

These are potential improvements, not claims about existing functionality:

- Add automated test coverage for key fee, payment, and promotion workflows.
- Document and validate a supported Node.js and PostgreSQL version matrix.
- Add a repeatable, automated migration workflow for upgrading existing databases.

## Author

**Hassam Ashraf** — Software Engineer  
[LinkedIn](https://www.linkedin.com/in/hassamashraf-ai/) · [GitHub](https://github.com/hassamashrafedu-cyber)
