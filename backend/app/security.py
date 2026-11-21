"""Keep the local agent reachable only from the Server-View dashboard.

CORS only stops other sites from *reading* responses; it does not stop a page
from *sending* a POST, and it does not apply to WebSockets at all. So the
agent checks the request itself:

- ``Host`` must name this machine, which defeats DNS-rebinding pages.
- ``Origin`` must be the dashboard for anything that stops a process or
  streams process details. Browsers always send ``Origin`` on POST requests
  and WebSocket handshakes, and the Vite dev proxy passes it through.
"""

from fastapi import HTTPException, Request, WebSocket

DASHBOARD_PORT = 5178
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
ALLOWED_ORIGINS = frozenset(f"http://{host}:{DASHBOARD_PORT}" for host in ALLOWED_HOSTS)

# WebSocket close code for "policy violation" (RFC 6455).
WS_POLICY_VIOLATION = 1008


def is_dashboard_origin(origin: str | None) -> bool:
    return origin in ALLOWED_ORIGINS


def require_dashboard_origin(request: Request) -> None:
    """FastAPI dependency for routes that change state on this machine."""
    if not is_dashboard_origin(request.headers.get("origin")):
        raise HTTPException(status_code=403, detail="Requests must come from the Server-View dashboard")


async def reject_foreign_websocket(websocket: WebSocket) -> bool:
    """Close the handshake if it didn't come from the dashboard. Returns True if rejected."""
    if is_dashboard_origin(websocket.headers.get("origin")):
        return False
    await websocket.close(code=WS_POLICY_VIOLATION)
    return True
