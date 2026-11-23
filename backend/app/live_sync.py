import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("taa.live_sync")

class LiveConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        # Maps WebSocket → user_id so we can send targeted events
        self._user_map: Dict[WebSocket, int] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    async def connect(self, websocket: WebSocket, user_id: int | None = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        if user_id is not None:
            self._user_map[websocket] = user_id
        logger.info(f"[LiveSync] Client connected (user_id={user_id}). Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            self._user_map.pop(websocket, None)
            logger.info(f"[LiveSync] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, data: Any):
        if not self.active_connections:
            return
        message = json.dumps({"type": event_type, "data": data})
        stale = []
        for conn in list(self.active_connections):
            try:
                await conn.send_text(message)
            except Exception as e:
                logger.warning(f"[LiveSync] Send failed: {e}")
                stale.append(conn)
        for s in stale:
            self.disconnect(s)

    async def send_to_user(self, user_id: int, event_type: str, data: Any):
        """Send an event only to connections belonging to a specific user."""
        message = json.dumps({"type": event_type, "data": data})
        stale = []
        for conn, uid in list(self._user_map.items()):
            if uid == user_id:
                try:
                    await conn.send_text(message)
                except Exception:
                    stale.append(conn)
        for s in stale:
            self.disconnect(s)

    def _run_coroutine(self, coro):
        try:
            loop = self._loop
            if not loop or loop.is_closed():
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    loop = None
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(coro, loop)
            else:
                asyncio.run(coro)
        except Exception as err:
            logger.warning(f"[LiveSync] Dispatch error: {err}")

    def dispatch(self, event_type: str, data: Any):
        """Thread-safe broadcast to all connected clients."""
        self._run_coroutine(self.broadcast(event_type, data))

    def dispatch_to_user(self, user_id: int, event_type: str, data: Any):
        """Thread-safe targeted send to one user's connections."""
        self._run_coroutine(self.send_to_user(user_id, event_type, data))

# Singleton instance
live_manager = LiveConnectionManager()

def notify_live(event_type: str, data: Any):
    """Broadcast an event to all connected clients."""
    live_manager.dispatch(event_type, data)

def notify_user(user_id: int, event_type: str, data: Any):
    """Send an event only to a specific user's connections."""
    live_manager.dispatch_to_user(user_id, event_type, data)
