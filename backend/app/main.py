from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import audit
from app.models import HealthResponse, KillRequest, KillResponse, ProcessListResponse
from app.scanner import (
    ProcessAccessDenied,
    ProcessChanged,
    ProcessNotFound,
    ProcessNotManaged,
    ProcessNotOwned,
    ProcessTerminationError,
    scan_processes,
    terminate_process,
)
from app.security import ALLOWED_HOSTS, ALLOWED_ORIGINS, limit_stop_rate, require_dashboard_origin
from app.websocket import websocket_health, websocket_processes

app = FastAPI(title="Server-View Local Agent")

app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


# Plain ``def``: psutil calls block, so FastAPI runs this in its thread pool
# instead of stalling the event loop (WebSocket pushes, stop requests).
@app.get("/api/processes", response_model=ProcessListResponse)
def processes() -> ProcessListResponse:
    return scan_processes()


# Each stop failure maps to an HTTP status and an audit-log outcome.
STOP_ERRORS: tuple[tuple[type[Exception], int, str], ...] = (
    (ProcessNotFound, 404, "not_found"),
    (ProcessChanged, 409, "changed"),
    (ProcessAccessDenied, 403, "access_denied"),
    (ProcessNotManaged, 403, "not_managed"),
    (ProcessNotOwned, 403, "not_owned"),
    (ProcessTerminationError, 500, "error"),
)


@app.post(
    "/api/processes/{pid}/kill",
    response_model=KillResponse,
    # Origin first, so requests from other sites don't use up the rate limit.
    dependencies=[Depends(require_dashboard_origin), Depends(limit_stop_rate)],
)
def kill_process(pid: int, body: KillRequest, request: Request) -> KillResponse:
    origin = request.headers.get("origin")
    try:
        info = terminate_process(pid, started_at=body.started_at)
    except tuple(error for error, _, _ in STOP_ERRORS) as exc:
        status_code, outcome = next((code, name) for error, code, name in STOP_ERRORS if isinstance(exc, error))
        audit.log_stop(
            pid=pid,
            started_at=body.started_at,
            outcome=outcome,
            status_code=status_code,
            origin=origin,
            detail=str(exc),
        )
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    audit.log_stop(
        pid=pid,
        started_at=body.started_at,
        outcome="requested",
        status_code=200,
        origin=origin,
        process=info,
    )
    return KillResponse(
        pid=pid,
        signal="terminate",
        status="requested",
        message=f"Terminate requested for process {pid}",
    )


# WebSocket endpoints for real-time updates
@app.websocket("/ws/processes")
async def ws_processes(websocket: WebSocket):
    await websocket_processes(websocket)


@app.websocket("/ws/health")
async def ws_health(websocket: WebSocket):
    await websocket_health(websocket)
