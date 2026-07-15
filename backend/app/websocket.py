"""WebSocket support for real-time process updates."""

import asyncio
import json
import logging
from typing import Set

from fastapi import WebSocket, WebSocketDisconnect

from app.scanner import scan_processes

logger = logging.getLogger(__name__)

# Global set of active WebSocket connections
active_connections: Set[WebSocket] = set()

# Background task for broadcasting updates
_broadcast_task: asyncio.Task | None = None


async def broadcast_processes():
    """Background task that periodically broadcasts process updates to all connected clients."""
    while True:
        try:
            # Scan processes
            response = scan_processes()
            data = response.model_dump()
            
            # Broadcast to all connected clients
            disconnected = set()
            for connection in active_connections:
                try:
                    await connection.send_text(json.dumps(data))
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
    global _broadcast_task
    if _broadcast_task is not None:
        _broadcast_task.cancel()
        _broadcast_task = None
        logger.info("Stopped WebSocket broadcast task")


async def websocket_processes(websocket: WebSocket):
    """WebSocket endpoint for real-time process updates.
    
    Clients connect to this endpoint to receive periodic process updates
    without needing to poll the API.
    """
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"WebSocket client connected (total: {len(active_connections)})")
    
    # Start broadcast task if not already running
    start_broadcast_task()
    
    try:
        # Send initial data immediately
        response = scan_processes()
        await websocket.send_text(json.dumps(response.model_dump()))
        
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
