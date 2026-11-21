# TAA – Inspection Management System (IFM Checksheet & Batch Quality Platform)
**Version:** 2.0 (Development-Ready Blueprint)  
**Authors / Stakeholders:** Shiva Datta, Yuvraj, Sheetal  
**UI & Print Theme:** High-Contrast Monochrome White & Black (`#FFFFFF` pure white surfaces, `#000000` pitch black borders, typography, and controls)

---

## 1. Overview & Architecture

The **TAA – Inspection Management System** digitizes manufacturing **Initial Flow Management (IFM) Control Items Monitoring Checksheets** and batch quality inspections performed on the shop floor.

- **Frontend:** React (Vite + TypeScript + IndexedDB Offline Sync + Tailwind / High-Contrast Monochrome CSS)
- **Backend:** Python (FastAPI + SQLAlchemy + ReportLab + OpenPyXL + python-barcode + qrcode + Pillow)
- **Database:** PostgreSQL (with SQLAlchemy models mirroring Section 7 `DR-001`, plus SQLite fallback for local development)
- **TFT Hardware Integration:** Wired (USB HID) and Wireless (Bluetooth/2.4GHz HID) scanner wedge listener, plus HTML5 device camera barcode/QR scanner.

---

## 2. Default Demo Accounts

| Role | Username | Password | Capabilities |
|---|---|---|---|
| **Admin (Primary)** | `admin` | `admin123` | Full system configuration, Checksheet builder, QR engine, progress dashboard, user lifecycle, PDF/Excel export |
| **Admin (Backup)** | `admin2` | `admin123` | Backup Admin account with full configuration, user management, and report export permissions |
| **Supervisor** | `supervisor` | `super123` | Read-only Operator review, batch approval, quarantine hold with validation reason, override vs continue rejection |
| **Operator** | `operator` | `oper123` | TFT QR scanning, full-sheet completion (FR-025A), tolerance validation, photo evidence capture, approve/reject |

---

## 3. Quick Start & Execution

### Running the Application

```powershell
# 1. Run the unified FastAPI server (serves API and compiled React frontend):
python run.py
```
Open your browser at: **`http://localhost:8000`**

### Running Frontend in Dev Mode (with Hot Reloading)
```powershell
cd frontend
npm run dev
```

### Running the Pytest Suite
```powershell
python -m pytest backend/tests/test_api.py -v
```

---

## 4. Key Functional Features Implemented

### 1. High-Contrast Monochrome Industrial Design System (Section 2)
- **#FFFFFF Pure White** base canvas and table surfaces.
- **#F4F4F5 Soft Cool Tint** table headers with `1.5px solid #000000` grid borders.
- **Role Field Emphasis:**
  - Assigned to logged-in role: `2.5px solid #000000` border, `#FFFFFF` background, bold black label, and **bold high-contrast tickbox (`☑`)**.
  - Unassigned / other role: `1px solid #D4D4D8` border, `opacity: 0.45` (semi-transparent), locked.
- **Out-of-Tolerance Numeric Cells:** Thick `2px dashed #000000` border with inverted black tag (`OUT OF SPEC`).
- **Rescanned / Saved Read-Only Banner:** Top full-width banner (`#000000` background, `#FFFFFF` text):
  `LOCKED RECORD — READ-ONLY SUMMARY MODE`

### 2. User Lifecycle & FR-005 Audit Purge
- Admin can create, activate, deactivate, and delete user accounts.
- **FR-005 Compliance:** When an Admin deactivates (`PATCH /api/admin/users/{id}/deactivate`) or deletes (`DELETE /api/admin/users/{id}`) any user, the system automatically detects all `audit_logs` associated with that `user_id` and removes them from the database while preserving anonymized historical batch records.

### 3. Checksheet Template Builder & QR Engine
- Reference IFM template pre-loaded: `18351M62Q50-IFM` (*PIPE, PURGE LINE (RH)* for *YTA MC26 Fuel Line*).
- Admin can create blank or custom sheets, configure row modes (`SERIAL_TICKBOX` vs `NUMERIC_SAMPLE`), set numeric min/max tolerances, and generate built-in QR codes (`TAA:SHEET:{id}`) and 1D Code128 barcodes.
- Printable high-contrast label dialog for physical shop-floor placement.

### 4. TFT Device Scanning & Rescan Rules
- Supports wired USB HID and wireless Bluetooth scanners (instant `< 500 ms` keyboard wedge routing).
- Camera QR / Barcode scanner fallback.
- **FR-021A (Rescan Read-Only Rule):** Once an Operator submits or a Supervisor finalizes a batch, rescanning the QR code opens the sheet strictly in **Read-Only Summary Mode**.

### 5. Operator Full-Sheet Completion Enforcement (FR-025A)
- Operators cannot submit early: all required fields across all stages must be completed before submitting either `Approve` or `Reject`.
- Rejections mandate multi-select identification of failed control items (`FR-027`).

### 6. Supervisor Review & Immutability Locks
- Supervisors cannot edit Operator-saved cells (`HTTP 403 Forbidden` enforced on server).
- Supervisor decision choices:
  - `Approve`: finalizes batch.
  - `Hold Batch`: mandates non-empty validation reason (`FR-036`).
  - `Accept (Override Rejection)`: authorizes engineering concession.
  - `Continue Rejection`: permanently finalizes entire lot as `REJECTED`.

### 7. Factory Wi-Fi Resilience (FR-041A)
- Continuous IndexedDB persistence on every tickbox and numeric cell input.
- Offline banner (`OFFLINE — SAVED LOCALLY`) in header.
- Background sync worker replays queued mutations with UUID idempotency keys upon reconnection.

### 8. Exact IFM Report Exports (PDF & Excel)
- `GET /api/admin/batches/{id}/export?format=pdf`: Landscape A4 ReportLab export matching exact physical IFM checksheet format with embedded QR/Barcode, stage matrix, tolerance highlights, photo evidence appendix, and sign-off blocks.
- `GET /api/admin/batches/{id}/export?format=xlsx`: OpenPyXL workbook with formatted checksheet grid and decisions tab.

##### Sheetal, Yuvraj, ShivaDatta
