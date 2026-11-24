"""Keep the local agent reachable only from the Server-View dashboard.

CORS only stops other sites from *reading* responses; it does not stop a page
from *sending* a POST, and it does not apply to WebSockets at all. So the
agent checks the request itself:

- ``Host`` must name this machine, which defeats DNS-rebinding pages.
- ``Origin`` must be the dashboard for anything that stops a process or
  streams process details. Browsers always send ``Origin`` on POST requests
  and WebSocket handshakes, and the Vite dev proxy passes it through.

Stop requests are also rate limited, so a runaway script can't stop
processes in bulk.
"""

import math
import threading
import time
from collections import deque

from fastapi import HTTPException, Request, WebSocket

from app import audit

DASHBOARD_PORT = 5178
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
ALLOWED_ORIGINS = frozenset(f"http://{host}:{DASHBOARD_PORT}" for host in ALLOWED_HOSTS)

# WebSocket close code for "policy violation" (RFC 6455).
WS_POLICY_VIOLATION = 1008


def is_dashboard_origin(origin: str | None) -> bool:
    return origin in ALLOWED_ORIGINS


def require_dashboard_origin(request: Request) -> None:
    """FastAPI dependency for the stop route (the only one that changes state)."""
    origin = request.headers.get("origin")
    if not is_dashboard_origin(origin):
        audit.log_stop(
            pid=request.path_params.get("pid"),
            outcome="foreign_origin",
            status_code=403,
            origin=origin,
        )
        raise HTTPException(status_code=403, detail="Requests must come from the Server-View dashboard")


async def reject_foreign_websocket(websocket: WebSocket) -> bool:
    """Close the handshake if it didn't come from the dashboard. Returns True if rejected."""
    if is_dashboard_origin(websocket.headers.get("origin")):
        return False
    await websocket.close(code=WS_POLICY_VIOLATION)
    return True


class StopRateLimiter:
    """Cap how many stop requests the agent accepts in a sliding time window.

    The dashboard sends one request per confirmed Stop, so a burst means a
    script or a stuck client. The agent only listens on localhost, so one
    shared budget is enough.
    """

    def __init__(self, max_requests: int = 10, window_seconds: float = 10.0, clock=time.monotonic):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._clock = clock
        self._hits: deque[float] = deque()
        self._lock = threading.Lock()

    def check(self) -> float | None:
        """Record a request. Returns None if allowed, else seconds until a slot frees up."""
        with self._lock:
            now = self._clock()
            while self._hits and now - self._hits[0] >= self.window_seconds:
                self._hits.popleft()
            if len(self._hits) >= self.max_requests:
                return self.window_seconds - (now - self._hits[0])
            self._hits.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


stop_rate_limiter = StopRateLimiter()


def limit_stop_rate(request: Request) -> None:
    """FastAPI dependency: reject stop requests over the limit with 429."""
    retry_after = stop_rate_limiter.check()
    if retry_after is None:
        return
    seconds = max(1, math.ceil(retry_after))
    audit.log_stop(
        pid=request.path_params.get("pid"),
        outcome="rate_limited",
        status_code=429,
        origin=request.headers.get("origin"),
    )
    raise HTTPException(
        status_code=429,
        detail=f"Too many stop requests. Try again in {seconds} seconds.",
        headers={"Retry-After": str(seconds)},
    )
