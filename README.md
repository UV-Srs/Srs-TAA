# AI-Smart Scan – Inspection Management System (IFM Checksheet & Batch Quality Platform)
**Version:** 2.0 (Development-Ready Blueprint)  
**Authors / Stakeholders:** Shiva Datta, Yuvraj, Sheetal  
**UI & Print Theme:** High-Contrast Monochrome White & Black (`#FFFFFF` pure white surfaces, `#000000` pitch black borders, typography, and controls)

---

## 1. Overview & Architecture

The **AI-Smart Scan – Inspection Management System** digitizes manufacturing **Initial Flow Management (IFM) Control Items Monitoring Checksheets** and batch quality inspections performed on the shop floor.

- **Frontend:** React (Vite + TypeScript + IndexedDB Offline Sync + Tailwind / High-Contrast Monochrome CSS)
- **Backend:** Python (FastAPI + SQLAlchemy + ReportLab + OpenPyXL + python-barcode + qrcode + Pillow)
- **Database:** PostgreSQL (with SQLAlchemy models mirroring Section 7 `DR-001`)
- **Live Sync:** WebSocket channel (`/ws/live`) pushes sheet, batch, cell and scan events to every connected client, with an HTTP polling fallback.
- **TFT Hardware Integration:** Wired (USB HID) and Wireless (Bluetooth/2.4GHz HID) scanner wedge listener, plus HTML5 device camera barcode/QR scanner (`jsqr`, `@zxing/browser`).

The FastAPI server serves both the REST API (`/api/...`) and the compiled React app (`frontend/dist`), so production runs as a **single process on one port**.

### Project Structure

```
Srs-TAA/
├── run.py                    # Entry point – starts uvicorn on HOST:PORT (default 0.0.0.0:8000)
├── Dockerfile                # Multi-stage build: Node builds the frontend, Python runs the app
├── docker-compose.yml        # App + PostgreSQL 16 stack
├── alembic.ini               # Alembic (database migrations) configuration
├── .env.docker.example       # Template for the Docker .env
├── backend/
│   ├── .env.example          # Template for backend/.env (local runs)
│   ├── requirements.txt      # runtime dependencies (requirements-dev.txt adds the test tools)
│   ├── migrations/           # Alembic: env.py and versions/ (0001 = baseline schema)
│   ├── scripts/              # migrate.py, check_schema_drift.py
│   ├── app/
│   │   ├── main.py           # FastAPI app, WebSocket, health check, SPA serving
│   │   ├── config.py         # Reads .env (DB_TYPE, DB_*, SECRET_KEY, ...)
│   │   ├── models.py / schemas.py / database.py
│   │   ├── db_base.py        # the SQLAlchemy Base, free of side effects (used by Alembic)
│   │   ├── migrations_check.py  # read-only schema version / drift checks
│   │   ├── seed_data.py      # Demo users + reference IFM template
│   │   ├── live_sync.py      # WebSocket connection manager
│   │   ├── export_pdf.py / export_excel.py / checksheet_report.py
│   │   └── routes/           # auth, admin, batch, operator, supervisor, qr, sync, notification
│   ├── tests/                # API tests and migration tests (need a disposable test database)
│   └── uploads/              # Photo evidence + pending-scan store (created at runtime)
└── frontend/
    ├── package.json
    ├── vite.config.ts        # Dev server on :5173, proxies /api and /uploads to :8000
    └── src/
        ├── api.ts            # API client (JWT auth, authenticated downloads)
        ├── db.ts             # IndexedDB offline store
        ├── liveSync.ts       # WebSocket client
        ├── pages/            # Admin dashboard, sheet builder, checksheet, mobile scanner, ...
        └── components/       # Scanner, modals, sidebar, header, ...
```

---

## 2. Default Demo Accounts

Seeded automatically on first start.

| Role | Username | Password | Capabilities |
|---|---|---|---|
| **Admin (Primary)** | `admin` | `admin123` | Full system configuration, Checksheet builder, QR engine, progress dashboard, user lifecycle, PDF/Excel/CSV export |
| **Admin (Backup)** | `admin2` | `admin123` | Backup Admin account with full configuration, user management, and report export permissions |
| **Supervisor** | `supervisor` | `super123` | Read-only Operator review, batch approval, quarantine hold with validation reason, override vs continue rejection |
| **Operator** | `operator` | `oper123` | TFT QR scanning, full-sheet completion (FR-025A), tolerance validation, photo evidence capture, approve/reject |

> Change these passwords before deploying anywhere other than a local machine.

---

## 3. Quick Start & Execution

### Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Python | 3.11 – 3.12 recommended (3.11 is used in Docker) | Backend |
| Node.js + npm | 20+ | Building / developing the frontend |
| PostgreSQL | 14+ | Required for database storage |
| Docker Desktop | latest (optional) | Docker deployment |

All commands below are for **Windows PowerShell**, run from the `Srs-TAA` folder. On macOS/Linux use `source .venv/bin/activate` instead of `.\.venv\Scripts\Activate.ps1`.

### Option A – Local Run (single server)

**1. One-time setup**

```powershell
# Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

# Configuration
Copy-Item backend\.env.example backend\.env
# Edit backend\.env with your PostgreSQL credentials (see Section 4)

# Create the database tables (new, EMPTY database only - see Section 6)
alembic upgrade head

# Frontend
cd frontend
npm install
npm run build        # produces frontend\dist, which the backend serves
cd ..
```

> If PowerShell blocks `Activate.ps1`, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**2. Start the app**

```powershell
.\.venv\Scripts\Activate.ps1
python run.py
```

Open your browser at: **`http://localhost:8000`**

Phones and tablets on the same network can reach it at `http://<your-PC-IP>:8000` and get the simplified **Mobile Scanner** screen automatically.

### Option B – Development Mode (hot reloading)

Run the backend and the Vite dev server in two terminals.

```powershell
# Terminal 1 – backend API on :8000
.\.venv\Scripts\Activate.ps1
python run.py
```

```powershell
# Terminal 2 – frontend on :5173 (proxies /api and /uploads to :8000)
cd frontend
npm run dev
```

Open: **`http://localhost:5173`**

### Option C – Docker (App + PostgreSQL)

```powershell
Copy-Item .env.docker.example .env
# Edit .env – set a strong DB_PASSWORD and a random SECRET_KEY (both are required)

docker compose up -d --build
```

Open: **`http://localhost:8020`** (change the host port with `APP_PORT` in `.env`).

| Command | Purpose |
|---|---|
| `docker compose logs -f app` | Follow application logs |
| `docker compose ps` | Show container status and health |
| `docker compose down` | Stop the stack (data is kept) |
| `docker compose down -v` | Stop and **delete** the database and uploads volumes |

On start the container runs the database migrations before the app (`backend/scripts/migrate.py`). If they fail, or the database is an existing one that has not been adopted yet (Section 6), the container exits and the app does not start.

PostgreSQL is internal to the compose network (no host port). Database data lives in the `pgdata` volume and photo uploads in the `uploads` volume.

### Running the Pytest Suite

The tests create templates, batches and scratch databases, so they only run against a **disposable** PostgreSQL server that you name explicitly. Without `TAA_TEST_DATABASE_URL` they are skipped, so they can never write into a real database.

```powershell
docker run -d --name taa-test-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=taa_test -p 55432:5432 postgres:16-alpine
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements-dev.txt
$env:TAA_TEST_DATABASE_URL = "postgresql+psycopg2://postgres:testpw@localhost:55432/taa_test"
python -m pytest backend/tests -v
docker rm -f taa-test-pg
```

### Health Check

`GET /api/health` – used by the Docker `HEALTHCHECK`; handy for confirming the server is up.

---

## 4. Configuration (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DB_TYPE` | `postgresql` | PostgreSQL database type (`postgresql`) |
| `DB_USER` / `DB_PASSWORD` | `postgres` / `postgres` | PostgreSQL credentials |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | PostgreSQL server |
| `DB_NAME` | `TAA` | PostgreSQL database name |
| `DATABASE_URL` | – | Optional full connection URL; when set it overrides `DB_TYPE` and the `DB_*` values |
| `SECRET_KEY` | – | JWT signing key – use a long random value in any shared environment |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Login session length (24 h) |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Server bind address (environment variables read by `run.py`) |

**Using PostgreSQL locally:** create the database first, then set `DB_TYPE=postgresql` and the `DB_*` values.

```powershell
createdb -U postgres taa_inspection
```

Tables are created by migrations (`alembic upgrade head`, see **Section 6**). The application no longer creates or alters tables itself. The demo users are added automatically on startup, after the schema check passes.

> **Already have a database with data?** Do not run `alembic upgrade head` on it. Follow *Adopting an existing database* in Section 6 first. The app refuses to start on an unmarked database.

---

## 5. Key Functional Features Implemented

### 1. High-Contrast Monochrome Industrial Design System (Section 2)
- **#FFFFFF Pure White** base canvas and table surfaces.
- **#F4F4F5 Soft Cool Tint** table headers with `1.5px solid #000000` grid borders.
- **Role Field Emphasis:**
  - Assigned to logged-in role: `2.5px solid #000000` border, `#FFFFFF` background, bold black label, and **bold high-contrast tickbox (`☑`)**.
  - Unassigned / other role: `1px solid #D4D4D8` border, `opacity: 0.45` (semi-transparent), locked.
- **Out-of-Tolerance Numeric Cells:** Thick `2px dashed #000000` border with inverted black tag (`OUT OF SPEC`).
- **Rescanned / Saved Read-Only Banner:** Top full-width banner (`#000000` background, `#FFFFFF` text):
  `LOCKED RECORD — READ-ONLY SUMMARY MODE`
- **Responsive Layout:** On tablets and phones the batch queue collapses above the checksheet, secondary table columns (Stage, Method, Owner) fold into the item cell, and touch targets are enlarged.

### 2. User Lifecycle & FR-005 Audit Purge
- Admin can create, activate, deactivate, and delete user accounts.
- **FR-005 Compliance:** When an Admin deactivates (`PATCH /api/admin/users/{id}/deactivate`) or deletes (`DELETE /api/admin/users/{id}`) any user, the system automatically detects all `audit_logs` associated with that `user_id` and removes them from the database while preserving anonymized historical batch records.

### 3. Checksheet Template Builder & QR Engine
- Reference IFM template pre-loaded: `18351M62Q50-IFM` (*PIPE, PURGE LINE (RH)* for *YTA MC26 Fuel Line*).
- Admin can create blank or custom sheets, configure row modes (`SERIAL_TICKBOX` vs `NUMERIC_SAMPLE`), set numeric min/max tolerances, and generate built-in QR codes (`TAA:SHEET:{id}`) and 1D Code128 barcodes.
- Printable high-contrast label dialog for physical shop-floor placement (Admin Dashboard and Sheet Builder).

### 4. TFT Device Scanning & Rescan Rules
- Supports wired USB HID and wireless Bluetooth scanners (instant `< 500 ms` keyboard wedge routing).
- Camera QR / Barcode scanner fallback.
- **FR-021A (Rescan Read-Only Rule):** Once an Operator submits or a Supervisor finalizes a batch, rescanning the QR code opens the sheet strictly in **Read-Only Summary Mode**.

### 5. Mobile Scanner & Live Scan Hand-off
- Phones are detected automatically and get a dedicated **Mobile Scanner** page with camera scanning and a scan history.
- A scan made on the phone is pushed over WebSocket to the same user's desktop session, which opens the matching batch and shows a confirmation toast.
- **Unregistered barcodes:** scanning an unknown lot opens a **Create Batch** dialog on the desktop so the batch can be registered on the spot.
- **Polling fallback:** when the WebSocket is not connected, the desktop picks up the latest scan from `GET /api/qr/pending-scan`.

### 6. Operator Full-Sheet Completion Enforcement (FR-025A)
- Operators cannot submit early: all required fields across all stages must be completed before submitting either `Approve` or `Reject`.
- Rejections mandate multi-select identification of failed control items (`FR-027`).

### 7. Supervisor Review & Immutability Locks
- Supervisors cannot edit Operator-saved cells (`HTTP 403 Forbidden` enforced on server).
- Supervisor decision choices:
  - `Approve`: finalizes batch.
  - `Hold Batch`: mandates non-empty validation reason (`FR-036`).
  - `Accept (Override Rejection)`: authorizes engineering concession.
  - `Continue Rejection`: permanently finalizes entire lot as `REJECTED`.

### 8. Factory Wi-Fi Resilience (FR-041A)
- Continuous IndexedDB persistence on every tickbox and numeric cell input.
- Offline banner (`OFFLINE — SAVED LOCALLY`) in header.
- Background sync worker replays queued mutations with UUID idempotency keys upon reconnection.

### 9. Exact IFM Report Exports (PDF, Excel & CSV)
- `GET /api/admin/batches/{id}/export?format=pdf`: Landscape A4 ReportLab export matching exact physical IFM checksheet format with embedded QR/Barcode, stage matrix, tolerance highlights, photo evidence appendix, and sign-off blocks.
- `GET /api/admin/batches/{id}/export?format=xlsx`: OpenPyXL workbook with formatted checksheet grid and decisions tab.
- `GET /api/admin/batches/{id}/export?format=csv`: Single-batch CSV export.
- `GET /api/admin/export-csv`: Full inspection ledger (batch, sheet, product, line, qty, status, round, inspection and review decisions, hold details, field values).
- Export endpoints require the admin's JWT. The frontend downloads them through an authenticated `fetch` and saves the file from a Blob, so plain links don't fail with `401`.

---

## 6. Database Migrations (Alembic)

The database structure is owned by **Alembic migrations**, not by the application. Every schema change is a small, reviewed, versioned file in `backend/migrations/versions/`.

### How it works

| Piece | What it does |
|---|---|
| `alembic.ini`, `backend/migrations/` | Alembic configuration, `env.py`, and the migration files. `0001_baseline.py` is the complete schema as it exists today. |
| `backend/app/db_base.py` | The SQLAlchemy `Base`, on its own. Alembic loads the models through it, so it never imports `main.py`, opens the app's engine, creates tables or seeds data. |
| `backend/app/migrations_check.py` | Read-only checks: which version the database is at, and whether its schema matches the models. |
| `backend/scripts/migrate.py` | What Docker runs: `alembic upgrade head`, but it refuses to touch a database that has tables and no version. |
| `backend/scripts/check_schema_drift.py` | The read-only check that must pass before an existing database is stamped. |

- **The app never creates or changes tables.** At startup it only verifies the database is at the current migration, and **refuses to start** (with the exact next step) if it is not. Only after that check passes does it add the default demo users.
- **Which database an Alembic command acts on:** `ALEMBIC_DATABASE_URL` if you set it, otherwise the same settings the app uses (`backend/.env`). The target host and database name are **printed on every command**. Read that line before continuing.
- Run every `alembic` command from the project root (the folder containing `alembic.ini`).
- Migration `0001` cannot be downgraded: the generated downgrade would drop every table, so it is blocked on purpose. Restoring the backup is the way back from the baseline.

### Fresh database (new, empty)

```powershell
.\.venv\Scripts\Activate.ps1
# backend\.env (or $env:ALEMBIC_DATABASE_URL) must point at the NEW, EMPTY database
alembic upgrade head      # creates every table; prints "Running upgrade  -> 0001, baseline"
alembic current           # expect: 0001 (head)
python run.py             # starts; adds the demo users on first start
```

Docker does this for you: the container runs `backend/scripts/migrate.py` before the app, and if that fails the container exits and the app never starts.

### Adopting an existing database (has tables and data, never migrated)

An existing database already contains the baseline schema, so it is **stamped** (marked as being at `0001`) rather than upgraded. Stamping writes one row to a new `alembic_version` table and changes no table and no data. The app will not start on an unmarked database, and neither `alembic upgrade` through Docker nor the app will ever stamp one for you.

**Never stamp the live database first. Never skip the drift check.** Replace the `<...>` values. If the password contains special characters, URL-encode them (for example `@` becomes `%40`).

**1. Back up the live database** (read-only, safe to run while the app is running):

```powershell
pg_dump -h <LIVE_HOST> -p <LIVE_PORT> -U <USER> -d <LIVE_DBNAME> -Fc -f taa_backup_2026-11-24.dump
```

Keep this file. It is the rollback for everything below. Check it exists and is not empty. If the PostgreSQL client tools are not installed, run the same command inside the database's container, for example `docker exec <db-container> pg_dump -U <USER> -d <LIVE_DBNAME> -Fc -f /tmp/taa_backup.dump`, then `docker cp <db-container>:/tmp/taa_backup.dump .`

**2. Restore it into a separate verification database** (a different database name, ideally on a different or throwaway server, never over the live one):

```powershell
createdb -h <VERIFY_HOST> -p <VERIFY_PORT> -U <USER> taa_verify
pg_restore -h <VERIFY_HOST> -p <VERIFY_PORT> -U <USER> -d taa_verify --no-owner taa_backup_2026-11-24.dump
```

**3. Run the schema drift check against the copy** (read-only; the connection itself is opened read-only):

```powershell
python backend/scripts/check_schema_drift.py "postgresql+psycopg2://<USER>:<PASSWORD>@<VERIFY_HOST>:<VERIFY_PORT>/taa_verify"
echo $LASTEXITCODE
```

**4. Expected result before stamping:**

```
Differences found: 0
RESULT: SAFE TO STAMP. The schema matches the baseline exactly.
```

and exit code `0`. Anything else means **do not stamp**:

| Output | Meaning | What to do |
|---|---|---|
| `MISSING` (table, column, index) | The models expect something the database lacks. The most likely case: an older database missing `supervisor_lot_reviews.spot_checks` / `.comment`. | Do not stamp. Tell the team. For that known case, start the *previous* application version once against the copy (its old startup added those two columns), then run the check again. |
| `DIFFERENT` (type, nullability) | A column exists but is not the same. | Do not stamp. Investigate. |
| `EXTRA` / `EXTRA!` | The database has something the app does not know about. Nothing is ever dropped automatically. | Review it. If it is harmless, re-run with `--allow-extra` to accept it (`EXTRA!`, a required column with no default, always blocks, because the app could not insert rows). |

**5. Rehearse on the verification copy first:**

```powershell
$env:ALEMBIC_DATABASE_URL = "postgresql+psycopg2://<USER>:<PASSWORD>@<VERIFY_HOST>:<VERIFY_PORT>/taa_verify"
alembic stamp 0001        # the target line printed above it must say taa_verify
alembic current           # expect: 0001 (head)
```

Optionally point the app at the copy (`DATABASE_URL`) and confirm it starts and your data is there.

**6. Stamp the live database** (only after steps 1 to 5 passed, and with explicit approval):

```powershell
$env:ALEMBIC_DATABASE_URL = "postgresql+psycopg2://<USER>:<PASSWORD>@<LIVE_HOST>:<LIVE_PORT>/<LIVE_DBNAME>"
alembic stamp 0001        # the target line printed above it must say the LIVE database
alembic current           # expect: 0001 (head)
Remove-Item Env:ALEMBIC_DATABASE_URL
```

Then deploy the new application version. It verifies the version (and that every table exists) at startup and starts normally.

> **If you stamped the wrong database by mistake**, `alembic stamp base` removes the version marker again. It changes only the `alembic_version` table, never your data.

### Everyday commands

| Task | Command |
|---|---|
| Which version is the database at? | `alembic current` |
| What versions exist? | `alembic history` |
| Apply all new migrations | `alembic upgrade head` |
| Undo the most recent migration | `alembic downgrade -1` |
| Preview the SQL without running it | `alembic upgrade head --sql` |
| Check a database against the models (read-only) | `python backend/scripts/check_schema_drift.py "<url>"` |

### Rolling back

1. **Always back up first** (step 1 above) before any migration on a database that holds data.
2. **A later migration** (`0002` and up) can be undone with `alembic downgrade -1`. Check `alembic current` afterwards. A migration that changes data is only as reversible as it was written to be, so the backup is the real safety net.
3. **Past the baseline** is not possible with Alembic (blocked on purpose). Restore the backup into a new database:

```powershell
createdb -h <HOST> -p <PORT> -U <USER> taa_restored
pg_restore -h <HOST> -p <PORT> -U <USER> -d taa_restored --no-owner taa_backup_2026-11-24.dump
```

Then point the app at `taa_restored`. Never restore over a database you are still using.

### Deploying a new version that has new migrations

1. Back up. 2. Deploy the code (the app refuses to start until the database is migrated, which protects you from running new code on an old schema). 3. `alembic upgrade head` (Docker does this on start). 4. `alembic current` should show the new head.

### Changing the database structure (for developers)

1. Edit the models in `backend/app/models.py`.
2. Against a **disposable** database that is at the current head, generate a draft: `alembic revision --autogenerate -m "short description"`.
3. **Read and edit the generated file.** Autogenerate is a draft: check it does exactly what you intend, and write the `downgrade`.
4. Test `alembic upgrade head`, then `alembic downgrade -1`, then `alembic upgrade head` again on a restored copy that holds data, and confirm the data is unchanged.
5. Commit the migration with the model change. Never edit a migration that has already been applied anywhere. Add a new one.

Prefer additive changes (a new nullable column, a new table). Dropping or retyping something that holds data needs its own plan and a backup.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Vite: `Failed to resolve import "jsqr"` (or `@zxing/...`) | Dependencies changed – run `npm install` in `frontend`, then restart `npm run dev`. If it persists, delete `frontend\node_modules\.vite` and restart. |
| `http://localhost:8000` shows an old UI or a blank page | Rebuild the frontend: `cd frontend; npm run build` |
| `ModuleNotFoundError` when starting the backend | Activate the venv and run `pip install -r backend\requirements.txt` |
| `pip install` fails on a very new Python (3.13+) | Use Python 3.11 or 3.12: `py -3.12 -m venv .venv` |
| Cannot connect to PostgreSQL | Check the `DB_*` values in `backend\.env` and verify PostgreSQL service is running on port 5432 |
| Port 8000 already in use | `$env:PORT=8001; python run.py` (and update the proxy target in `vite.config.ts` for dev mode) |
| Docker: `set DB_PASSWORD in .env` | Create `.env` from `.env.docker.example` next to `docker-compose.yml` |
| App or container stops with `DATABASE NOT INITIALISED` | The database is empty. Run `alembic upgrade head` (Section 6). |
| App or container stops with `NOT UNDER MIGRATION CONTROL` | The database has tables but was never adopted. Follow *Adopting an existing database* in Section 6. Do not stamp it blindly. |
| `SCHEMA INCOMPLETE` | The database is marked as migrated but some tables are missing. It was probably stamped without the drift check. Nothing was changed. Restore the backup. If the database is empty/new, clear the mistaken stamp with `alembic stamp base` (changes only the version table), then run `alembic upgrade head`. |
| `DATABASE NEEDS MIGRATION` | The code is newer than the database. Back up, then `alembic upgrade head`. |
| `DATABASE IS NEWER THAN THIS CODE` | The database was migrated by a newer release. Deploy the matching application version. |
| `alembic` runs against the wrong database | Read the `[alembic] target database:` line it prints. Set `$env:ALEMBIC_DATABASE_URL` to choose the database explicitly. |

---

##### Sheetal, Yuvraj, ShivaDatta
