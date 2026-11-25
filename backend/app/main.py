import os
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
import jwt as _jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.config import UPLOAD_DIR, BASE_DIR, SECRET_KEY, ALGORITHM
from backend.app.database import engine, SessionLocal
from backend.app.migrations_check import verify_database_is_current
from backend.app import models
from backend.app.seed_data import seed_database
from backend.app.live_sync import live_manager

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

def init_db():
    """Startup no longer creates or alters any table: the schema is owned by Alembic migrations.

    It only VERIFIES that the database is at the migration this code expects (and raises, so the
    app does not start, if not), then seeds the default users. See "Database migrations" in README.md.
    """
    revision = verify_database_is_current(engine)
    print(f"[DB] Schema is at migration {revision}")
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()

# Initialize DB synchronously on import
init_db()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Set running event loop for live WebSocket broadcasts
    loop = asyncio.get_running_loop()
    live_manager.set_event_loop(loop)
    yield

# Initialize FastAPI application
app = FastAPI(
    title="AI-Smart Scan – Inspection Management System",
    description="IFM Checksheet & Batch Quality Platform (Version 2.0)",
    version="2.0.0",
    lifespan=lifespan
)

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """422 with {detail: [{loc, msg, type}]}, the standard shape, minus the echoed request values.

    FastAPI's default body repeats the submitted `input`. For a value such as NaN that makes the
    error response itself fail to serialise (a 500), and for a malformed login it echoes the
    password back. Only the location, message and type are needed to show the error.
    """
    errors = [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "")), "type": e.get("type", "value_error")}
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let browser fetch() read the server-provided filename on report downloads.
    expose_headers=["Content-Disposition"],
)

# WebSocket Endpoint for Live Real-Time Collaboration
@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket, token: str = Query(default="")):
    # Validate JWT before accepting the connection
    user_id: int | None = None
    try:
        if not token:
            raise ValueError("no token")
        payload = _jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise ValueError("no sub")
        db = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.username == username).first()
            if not user or not user.is_active:
                raise ValueError("invalid user")
            user_id = user.user_id
        finally:
            db.close()
    except Exception:
        # Accept first so the close is a proper WS close frame, not a TCP reset.
        # Without accept(), Vite's proxy sees ECONNRESET and logs a noisy error.
        await websocket.accept()
        await websocket.close(code=4001)
        return

    await live_manager.connect(websocket, user_id=user_id)
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
        "service": "AI-Smart Scan Inspection Management System",
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
        return {"error": "Not Found"}

    # Real files from the frontend build (the logo / tab icon in public/ end up in the dist root).
    # Without this they fell through to index.html and the logo showed as a broken image.
    if full_path:
        root = DIST_DIR.resolve()
        candidate = (DIST_DIR / full_path).resolve()
        if candidate.is_file() and root in candidate.parents:  # never serve anything outside dist
            return FileResponse(candidate)

    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "app": "AI-Smart Scan – Inspection Management System",
        "version": "2.0.0",
        "docs": "/docs"
    }
