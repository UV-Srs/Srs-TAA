import os
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
import jwt as _jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.config import UPLOAD_DIR, BASE_DIR, SECRET_KEY, ALGORITHM
from backend.app.database import engine, Base, SessionLocal
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
    Base.metadata.create_all(bind=engine)
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
    title="TAA – Inspection Management System",
    description="IFM Checksheet & Batch Quality Platform (Version 2.0)",
    version="2.0.0",
    lifespan=lifespan
)

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
        "service": "TAA Inspection Management System",
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
    index_file = DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "app": "TAA – Inspection Management System",
        "version": "2.0.0",
        "docs": "/docs"
    }
