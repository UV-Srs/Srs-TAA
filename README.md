# TAA – Inspection Management System

Production-grade IFM checksheet and batch quality inspection platform.
Role-based access control for Admin, Supervisor, and Operator workflows.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [1 — Generate a Secret Key](#1--generate-a-secret-key)
- [2 — Configure Environment](#2--configure-environment)
- [3 — PostgreSQL Database Setup](#3--postgresql-database-setup)
- [4 — Backend Setup](#4--backend-setup)
- [5 — Frontend Setup](#5--frontend-setup)
- [6 — Running in Development](#6--running-in-development)
- [7 — Production Build](#7--production-build)
- [Switching to a New Database](#switching-to-a-new-database)
- [RBAC — Role Permissions](#rbac--role-permissions)
- [Workflow Overview](#workflow-overview)
- [Default Seed Accounts](#default-seed-accounts)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2.0 · Uvicorn |
| Database | PostgreSQL 14+ |
| Auth | JWT (PyJWT · HS256) · bcrypt |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS |
| Realtime | WebSocket (FastAPI native) |
| Offline | IndexedDB (idb) |
| PDF/Excel | ReportLab · openpyxl |

---

## Prerequisites

- **Python 3.11+** — `python --version`
- **Node.js 18+** — `node --version`
- **PostgreSQL 14+** running locally or remotely
- **pip** and **npm** / **pnpm**

---

## Project Structure

```
TAA/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app — auto-creates all DB tables on startup
│   │   ├── models.py        # SQLAlchemy ORM models
│   │   ├── auth.py          # JWT auth + role guards
│   │   ├── config.py        # Env-var loader
│   │   ├── database.py      # PostgreSQL engine + session
│   │   ├── seed_data.py     # First-run admin bootstrap + example sheet templates
│   │   └── routes/          # Auth · Admin · Operator · Supervisor · Batch · QR · Sync
│   ├── requirements.txt
│   └── .env                 # ← you create this (see Step 2)
└── frontend/
    ├── src/
    │   ├── pages/           # LoginPage · ChecksheetView · AdminDashboard · …
    │   ├── components/      # Modals · Scan bar · Sidebar · …
    │   └── api.ts           # Typed API client
    ├── package.json
    └── vite.config.ts
```

---

## 1 — Generate a Secret Key

The backend **will not start** without a `SECRET_KEY`. Generate a cryptographically secure one with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"

---

## 2 — Configure Environment

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Then open `backend/.env` and fill in your values:

```env
# ── Database ──────────────────────────────────────────────
DB_TYPE=postgresql
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=taa_inspection          # ← change to any name you like

# ── Security ──────────────────────────────────────────────
SECRET_KEY=paste_your_generated_key_here   # ← from Step 1
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440           # 24 hours

# ── CORS (comma-separated origins for LAN access) ─────────
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.100:5173
```

> **Never commit `backend/.env` to version control.**
> The `.gitignore` already excludes it.

---

## 3 — PostgreSQL Database Setup

### Create the database

Connect to PostgreSQL and create an empty database with the name you set in `.env`:

```sql
-- Connect as superuser (psql / pgAdmin / DBeaver)
CREATE DATABASE taa_inspection;
-- (Or whatever name you used for DB_NAME)
```

```bash
# Or from the terminal:
psql -U postgres -c "CREATE DATABASE taa_inspection;"
```

### Tables are created automatically

You do **not** need to run any migration scripts.

When the backend starts for the first time it calls `Base.metadata.create_all()`, which creates every table, index, and default column. Any new columns added in updates are also applied automatically via the startup migration runner in `main.py`.

> **To use a completely new database:** create the empty database in PostgreSQL, change `DB_NAME` in `backend/.env`, and restart the backend. All tables and seed data will be created fresh.

---

## 4 — Backend Setup

```bash
# From the project root (TAA/)

# Create and activate a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

# Install Python dependencies (includes psycopg2-binary and all other dependencies)
pip install -r backend/requirements.txt
```

---

## 5 — Frontend Setup

```bash
# From the project root (TAA/)
cd frontend
npm install
```

---

## 6 — Running in Development

Open **two terminals**:

**Terminal 1 — Backend**
```bash
# From TAA/ root (with venv activated)
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend starts at `http://localhost:8000`.
Interactive API docs at `http://localhost:8000/docs`.

On first start you will see:
```
[DB SUCCESS] Connected to PostgreSQL 'taa_inspection' successfully on localhost:5432!
[SEED] Admin account ready.
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
```

The frontend starts at `https://localhost:5173` (HTTPS for camera/mobile access).

**Mobile / LAN access**

The Vite dev server binds to `0.0.0.0`. From a phone or tablet on the same Wi-Fi:
```
https://<your-laptop-IP>:5173
```

Accept the self-signed certificate warning on mobile (development only).

---

## 7 — Production Build

```bash
# Build the frontend
cd frontend
npm run build
# Output is written to frontend/dist/

# Serve everything from the backend
cd ..
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

The FastAPI backend automatically serves the built frontend from `frontend/dist/`.
Access the full app at `http://your-server-ip:8000`.

For a production server, run behind **nginx + gunicorn**:

```bash
pip install gunicorn
gunicorn backend.app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## Switching to a New Database

If you want to use a different PostgreSQL database (e.g. `taa_production` or `taa_client_xyz`):

**Step 1 — Create the database in PostgreSQL**
```sql
CREATE DATABASE taa_production;
```

**Step 2 — Update `backend/.env`**
```env
DB_NAME=taa_production
```

**Step 3 — Restart the backend**
```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend will:
1. Connect to the new database
2. Run `Base.metadata.create_all()` — creates all tables
3. Run the column migration runner — adds any extra columns
4. Run `seed_database()` — bootstraps the first admin account if none exists

No manual SQL scripts needed.

---

## RBAC — Role Permissions

| Action | Admin | Supervisor | Operator |
|--------|-------|-----------|----------|
| Create sheet templates | ✓ | — | — |
| Create user accounts | ✓ | — | — |
| Register batches / QR | ✓ | — | — |
| Reset any user's password | ✓ | — | — |
| Download PDF / Excel report | ✓ | — | — |
| View all batches | ✓ | — | — |
| Fill operator-assigned fields | — | — | ✓ |
| Submit & Approve / Flag batch | — | — | ✓ |
| Fill supervisor-assigned rows | — | ✓ | — |
| Pass All (bulk approve) | — | ✓ | ✓ |
| Approve / Reject batch (final) | — | ✓ | — |
| Put batch On Hold | — | ✓ | — |
| Release Hold (Approve/Reject/Reinspect) | — | ✓ | — |
| View audit log | ✓ | — | — |
| Export CSV all batches | ✓ | — | — |

**Key rules:**
- Operator-assigned fields are **read-only** to supervisor and admin during operator inspection.
- Supervisor-assigned fields are **read-only** to operator at all times.
- Operator rejection is **non-terminal** — batch always routes to supervisor for final decision.
- Once a batch is submitted by the operator, their fields are **permanently locked**.
- Approved / Rejected batches are **fully read-only** to everyone.

---

## Workflow Overview

```
Admin creates Sheet Template
  └─► Assign each row to operator or supervisor
Admin registers Batch → QR label printed

Operator scans QR → OPERATOR_IN_PROGRESS
  └─► Fills operator-assigned fields (or uses Pass All)
  └─► Submit & Approve  ──┐
  └─► Flag for Rejection ─┘─► OPERATOR_APPROVED (always routes to supervisor)

Supervisor opens from review queue → SUPERVISOR_IN_PROGRESS
  └─► Reviews operator data (read-only)
  └─► Fills supervisor-assigned rows (checkboxes / P·F)
  └─► Approve ─────────────► APPROVED  (sealed record)
  └─► Reject ──────────────► REJECTED  (fields + reason recorded)
  └─► Hold ────────────────► ON_HOLD
        └─► Release: Approve ─► APPROVED
        └─► Release: Reject ──► REJECTED
        └─► Reinspect ────────► new round, cells cleared, back to operator

Admin downloads PDF / Excel at any time
Audit log records every action with user, role, timestamp
```

---

## Default Seed Accounts

On first startup the backend creates **one** admin account if no active admin exists:

| Username | Password | Role |
|----------|----------|------|
| `admin` | value of `ADMIN_INITIAL_PASSWORD` env var — or a random one-time token printed to the console | Admin |

All other user accounts (supervisors, operators, additional admins) are created through the **Admin → User Management** UI.

> **Change the initial admin password immediately** after first login.
> Use the Admin → User Management → Reset Password (🔑) button, or the `/api/auth/change-password` endpoint.
>
> To set a known password for first login, add `ADMIN_INITIAL_PASSWORD=your_password` to `backend/.env` before starting the backend.

---

## API Reference

Full interactive docs available at `http://localhost:8000/docs` when the backend is running.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | — | Login · returns JWT |
| GET | `/api/auth/me` | Any | Current user info |
| POST | `/api/auth/change-password` | Any | Change own password |
| GET | `/api/admin/users` | Admin | List users |
| POST | `/api/admin/users` | Admin | Create user |
| PATCH | `/api/admin/users/{id}/reset-password` | Admin | Reset any user's password |
| PATCH | `/api/admin/users/{id}/deactivate` | Admin | Deactivate + purge audit logs |
| PATCH | `/api/admin/users/{id}/activate` | Admin | Activate account |
| DELETE | `/api/admin/users/{id}` | Admin | Delete user |
| GET | `/api/admin/sheets` | Admin | List sheet templates |
| POST | `/api/admin/sheets` | Admin | Create sheet template |
| POST | `/api/admin/batches` | Admin | Register batch |
| GET | `/api/admin/batches/{id}/export?format=pdf\|xlsx` | Admin | Download inspection report |
| GET | `/api/admin/export-csv` | Admin | Export all batches as CSV |
| GET | `/api/batches` | Any | List batches (role-scoped) |
| GET | `/api/batches/{id}` | Any | Batch detail + cells |
| POST | `/api/batches/{id}/open` | Any | Open / claim batch |
| PATCH | `/api/batches/{id}/cell` | Any | Save a single cell value |
| POST | `/api/batches/{id}/attachments` | Any | Upload photo attachment |
| POST | `/api/batches/{id}/release-hold` | Supervisor | Release ON_HOLD batch |
| POST | `/api/operator/batches/{id}/submit` | Operator | Submit operator inspection |
| POST | `/api/supervisor/batches/{id}/review` | Supervisor | Supervisor decision |
| POST | `/api/supervisor/batches/{id}/review-field` | Supervisor | Field-level review |
| POST | `/api/sync/offline-queue` | Any | Sync offline mutations |
| WS | `/ws/live?token=<jwt>` | Any | Live WebSocket channel |

---

## Troubleshooting

### `RuntimeError: SECRET_KEY environment variable is not set`
Generate a key (see [Step 1](#1--generate-a-secret-key)) and add it to `backend/.env`.

### `FATAL DATABASE ERROR: Failed to connect to PostgreSQL`
- Check PostgreSQL is running: `pg_isready` or `services.msc` on Windows.
- Verify `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` in `backend/.env`.
- Ensure the database exists: `psql -U postgres -l`.

### Tables are missing after changing `DB_NAME`
You must create the new empty database in PostgreSQL first, then start the backend:
```sql
CREATE DATABASE your_new_db_name;
```
The backend creates all tables automatically on the next startup.

### `ModuleNotFoundError: No module named 'psycopg2'`
```bash
pip install psycopg2-binary
```

### Mobile camera not working on the scan page
The browser requires HTTPS for camera access. The Vite dev server uses a self-signed certificate — accept the warning in the mobile browser. For production, serve behind nginx with a real TLS certificate.

### `401 Session expired after password change`
This is intentional. The system invalidates all existing JWT tokens when a password is changed. Log in again with the new password.

### Frontend shows blank page after production build
Ensure you ran `npm run build` from the `frontend/` directory, and that `frontend/dist/assets/` exists before starting the backend.
