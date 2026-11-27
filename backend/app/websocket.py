"""WebSocket support for real-time process updates."""

import asyncio
import json
import logging
from typing import Set

from fastapi import WebSocket, WebSocketDisconnect

from app.snapshot import scan_cache
from app.security import reject_foreign_websocket

logger = logging.getLogger(__name__)

# Global set of active WebSocket connections
active_connections: Set[WebSocket] = set()

# Background task for broadcasting updates
_broadcast_task: asyncio.Task | None = None

# Most recent serialized scan, sent to newly connected clients so a connect
# doesn't trigger an extra full scan while the broadcast loop is running.
_latest_payload: str | None = None


async def scan_payload() -> str:
    """Scan in a worker thread (psutil blocks) and cache the serialized result."""
    global _latest_payload
    response = await asyncio.to_thread(scan_cache.get)
    _latest_payload = json.dumps(response.model_dump())
    return _latest_payload


async def broadcast_processes():
    """Background task that periodically broadcasts process updates to all connected clients."""
    while True:
        try:
            payload = await scan_payload()

            # Broadcast to all connected clients (iterate a copy: clients can
            # connect or disconnect while we await each send).
            disconnected = set()
            for connection in list(active_connections):
                try:
                    await connection.send_text(payload)
                except Exception as e:
                    logger.warning(f"Error sending to WebSocket client: {e}")
                    disconnected.add(connection)
            
            # Remove disconnected clients
            for connection in disconnected:
                active_connections.discard(connection)
                try:
                    await connection.close()
                except Exception:
                    pass
            
        except Exception as e:
            logger.error(f"Error in broadcast loop: {e}")
        
        # Wait before next broadcast (2 seconds to match original polling interval)
        await asyncio.sleep(2)


def start_broadcast_task():
    """Start the background broadcast task if not already running."""
    global _broadcast_task
    if _broadcast_task is None or _broadcast_task.done():
        _broadcast_task = asyncio.create_task(broadcast_processes())
        logger.info("Started WebSocket broadcast task")


def stop_broadcast_task():
    """Stop the background broadcast task."""
    global _broadcast_task, _latest_payload
    if _broadcast_task is not None:
        _broadcast_task.cancel()
        _broadcast_task = None
        logger.info("Stopped WebSocket broadcast task")
    # Nobody is listening, so the snapshot would only go stale.
    _latest_payload = None


async def websocket_processes(websocket: WebSocket):
    """WebSocket endpoint for real-time process updates.
    
    Clients connect to this endpoint to receive periodic process updates
    without needing to poll the API.
    """
    if await reject_foreign_websocket(websocket):
        logger.warning("Rejected process WebSocket from origin %r", websocket.headers.get("origin"))
        return
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"WebSocket client connected (total: {len(active_connections)})")
    
    # Start broadcast task if not already running
    start_broadcast_task()
    
    try:
        # Send initial data immediately, reusing the latest broadcast if there is one
        await websocket.send_text(_latest_payload or await scan_payload())
        
        # Keep connection alive
        while True:
            # Just wait for disconnect - actual updates come from broadcast task
            await websocket.receive_text()
    
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    
    finally:
        active_connections.discard(websocket)
        logger.info(f"WebSocket client removed (total: {len(active_connections)})")
        
        # Stop broadcast task if no more connections
        if len(active_connections) == 0:
            stop_broadcast_task()


async def websocket_health(websocket: WebSocket):
    """WebSocket endpoint for health check pings.
    
    Simple endpoint for testing WebSocket connectivity.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            else:
                await websocket.send_text(f"echo: {data}")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Health WebSocket error: {e}")
