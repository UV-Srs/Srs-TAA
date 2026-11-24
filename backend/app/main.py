import os
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.config import UPLOAD_DIR, BASE_DIR
from backend.app.database import engine, Base, SessionLocal
from backend.app import models
from backend.app.seed_data import seed_database
from backend.app.live_sync import live_manager

from backend.app.auth import get_current_user

from backend.app.routes import (
    auth_routes,
    admin_routes,
    operator_routes,
    supervisor_routes,
    qr_routes,
    sync_routes,
    batch_routes,
    notification_routes,
)

def _apply_column_migrations():
    """Add any new columns to existing tables that create_all won't auto-add."""
    from sqlalchemy import text as _text
    migrations = [
        # external_barcode — added for physical part barcode assignment feature
        "ALTER TABLE sheet_templates ADD COLUMN IF NOT EXISTS external_barcode VARCHAR(500)",
        "CREATE INDEX IF NOT EXISTS ix_sheet_templates_external_barcode ON sheet_templates (external_barcode) WHERE external_barcode IS NOT NULL",
        # is_default — active/default template for new batch creation
        "ALTER TABLE sheet_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE",
        # password_version — incremented on password change to invalidate all old JWTs
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_version INTEGER NOT NULL DEFAULT 1",
    ]
    with engine.connect() as conn:
        for stmt in migrations:
            try:
                conn.execute(_text(stmt))
            except Exception as e:
                print(f"[DB MIGRATION] Warning: {stmt[:60]}... -> {e}")
        conn.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _apply_column_migrations()
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB on startup (not at import time so unit tests can import safely)
    init_db()
    # Set running event loop for live WebSocket broadcasts
    loop = asyncio.get_running_loop()
    live_manager.set_event_loop(loop)
    yield

# Initialize FastAPI application
app = FastAPI(
    title="Smart Scan – Inspection Management System",
    description="IFM Checksheet & Batch Quality Platform (Version 2.0)",
    version="2.0.0",
    lifespan=lifespan
)

# CORS configuration — allow both http and https, localhost and LAN IPs
_allowed_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket Endpoint for Live Real-Time Collaboration
@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket, token: str = ""):
    """
    Auth strategy: token may arrive via query param (legacy) OR as the first
    message payload {"type":"auth","token":"..."} (preferred — keeps JWT out of
    server logs and browser history). Both paths are accepted so the client can
    migrate incrementally; query-param support can be dropped once liveSync.ts
    is updated to send the auth message.
    """
    await websocket.accept()

    auth_token = token  # may be empty if client uses first-message auth

    if not auth_token:
        # Wait up to 5 seconds for the client to send {"type":"auth","token":"..."}
        try:
            first = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            import json as _json
            msg = _json.loads(first)
            if msg.get("type") == "auth":
                auth_token = msg.get("token", "")
            elif first == "ping":
                auth_token = ""  # fall through to reject below
        except Exception:
            await websocket.close(code=4001)
            return

    if not auth_token:
        await websocket.close(code=4001)
        return

    db = SessionLocal()
    try:
        get_current_user(token=auth_token, db=db)
    except Exception:
        await websocket.close(code=4001)
        db.close()
        return
    db.close()

    await live_manager.connect(websocket, already_accepted=True)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        live_manager.disconnect(websocket)
    except Exception:
        live_manager.disconnect(websocket)

# Mount static uploads
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Include Routers
app.include_router(auth_routes.router)
app.include_router(admin_routes.router)
app.include_router(operator_routes.router)
app.include_router(supervisor_routes.router)
app.include_router(qr_routes.router)
app.include_router(sync_routes.router)
app.include_router(batch_routes.router)
app.include_router(notification_routes.router)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Smart Scan – Inspection Management System",
        "version": "2.0.0",
        "theme": "High-Contrast Monochrome"
    }

# Mount Frontend Static Build if present
DIST_DIR = BASE_DIR.parent / "frontend" / "dist"
if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

@app.get("/{full_path:path}")
def serve_frontend(full_path: str):
    # If API, Uploads, or WS route was not matched, return 404 for API
    if full_path.startswith("api/") or full_path.startswith("uploads/") or full_path.startswith("ws/"):
        raise HTTPException(status_code=404, detail="Not Found")
    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "app": "Smart Scan – Inspection Management System",
        "version": "2.0.0",
        "docs": "/docs"
    }
