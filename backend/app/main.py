from fastapi import Depends, FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.models import HealthResponse, KillRequest, KillResponse, ProcessListResponse
from app.scanner import (
    ProcessAccessDenied,
    ProcessChanged,
    ProcessNotFound,
    ProcessNotManaged,
    ProcessTerminationError,
    scan_processes,
    terminate_process,
)
from app.security import ALLOWED_HOSTS, ALLOWED_ORIGINS, require_dashboard_origin
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


@app.get("/api/processes", response_model=ProcessListResponse)
async def processes() -> ProcessListResponse:
    return scan_processes()


@app.post(
    "/api/processes/{pid}/kill",
    response_model=KillResponse,
    dependencies=[Depends(require_dashboard_origin)],
)
async def kill_process(pid: int, body: KillRequest) -> KillResponse:
    try:
        terminate_process(pid, started_at=body.started_at)
    except ProcessNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProcessChanged as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (ProcessAccessDenied, ProcessNotManaged) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProcessTerminationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

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
