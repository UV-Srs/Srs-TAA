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
├── .env.docker.example       # Template for the Docker .env
├── backend/
│   ├── .env.example          # Template for backend/.env (local runs)
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py           # FastAPI app, WebSocket, health check, SPA serving
│   │   ├── config.py         # Reads .env (DB_TYPE, DB_*, SECRET_KEY, ...)
│   │   ├── models.py / schemas.py / database.py
│   │   ├── seed_data.py      # Demo users + reference IFM template
│   │   ├── live_sync.py      # WebSocket connection manager
│   │   ├── export_pdf.py / export_excel.py / checksheet_report.py
│   │   └── routes/           # auth, admin, batch, operator, supervisor, qr, sync, notification
│   ├── tests/test_api.py
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

PostgreSQL is internal to the compose network (no host port). Database data lives in the `pgdata` volume and photo uploads in the `uploads` volume.

### Running the Pytest Suite

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest backend/tests/test_api.py -v
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

Tables and demo data are created automatically on startup.

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

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Vite: `Failed to resolve import "jsqr"` (or `@zxing/...`) | Dependencies changed – run `npm install` in `frontend`, then restart `npm run dev`. If it persists, delete `frontend\node_modules\.vite` and restart. |
| `http://localhost:8000` shows an old UI or a blank page | Rebuild the frontend: `cd frontend; npm run build` |
| `ModuleNotFoundError` when starting the backend | Activate the venv and run `pip install -r backend\requirements.txt` |
| `pip install` fails on a very new Python (3.13+) | Use Python 3.11 or 3.12: `py -3.12 -m venv .venv` |
| Cannot connect to PostgreSQL | Check the `DB_*` values in `backend\.env` and verify PostgreSQL service is running on port 5432 |
| Port 8000 already in use | `$env:PORT=8001; python run.py` (and update the proxy target in `vite.config.ts` for dev mode) |
| Docker: `set DB_PASSWORD in .env` | Create `.env` from `.env.docker.example` next to `docker-compose.yml` |

---

##### Sheetal, Yuvraj, ShivaDatta
