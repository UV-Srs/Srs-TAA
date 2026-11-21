import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("taa.live_sync")

class LiveConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"[LiveSync] Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"[LiveSync] Client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, data: Any):
        if not self.active_connections:
            return

        message = json.dumps({
            "type": event_type,
            "data": data
        })

        stale_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"[LiveSync] Failed to send message to client: {e}")
                stale_connections.append(connection)

        for stale in stale_connections:
            self.disconnect(stale)

    def dispatch(self, event_type: str, data: Any):
        """
        Thread-safe broadcast dispatcher callable from both sync and async routes.
        """
        try:
            loop = self._loop
            if not loop or loop.is_closed():
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    loop = None

            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(self.broadcast(event_type, data), loop)
            else:
                # If no running loop yet, create one temporarily
                asyncio.run(self.broadcast(event_type, data))
        except Exception as err:
            logger.warning(f"[LiveSync] Broadcast dispatch error: {err}")

# Singleton instance
live_manager = LiveConnectionManager()

def notify_live(event_type: str, data: Any):
    """Public helper function for routes to trigger real-time updates."""
    live_manager.dispatch(event_type, data)
