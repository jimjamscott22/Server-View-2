import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import audit, history
from app.history import HistoryEventsResponse, HistoryRecorder, ResourceSamplesResponse
from app.models import (
    BulkStopRequest,
    BulkStopResponse,
    HealthResponse,
    KillRequest,
    KillResponse,
    ProcessInfo,
    ProcessListResponse,
    StopResult,
)
from app.scanner import (
    ProcessAccessDenied,
    ProcessChanged,
    ProcessNotFound,
    ProcessNotManaged,
    ProcessNotOwned,
    ProcessTerminationError,
    terminate_process,
)
from app.security import ALLOWED_HOSTS, ALLOWED_ORIGINS, limit_stop_rate, require_dashboard_origin
from app.snapshot import scan_cache
from app.websocket import websocket_health, websocket_processes

logger = logging.getLogger(__name__)


async def record_history(recorder: HistoryRecorder) -> None:
    """Feed the history recorder, reusing the dashboard's scans when one is open."""
    while True:
        try:
            snapshot = await asyncio.to_thread(scan_cache.get, history.RECORD_INTERVAL_SECONDS)
            await asyncio.to_thread(recorder.record, snapshot)
        except Exception:
            logger.exception("Could not record process history")
        await asyncio.sleep(history.RECORD_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    recorder = await asyncio.to_thread(history.open_recorder)
    app.state.history = recorder
    task = asyncio.create_task(record_history(recorder)) if recorder else None
    try:
        yield
    finally:
        if task:
            task.cancel()
        if recorder:
            recorder.store.close()
        app.state.history = None


app = FastAPI(title="Server-View Local Agent", lifespan=lifespan)
# Set by lifespan; None while history is off or unavailable.
app.state.history = None

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
    return scan_cache.get()


# Each stop failure maps to an HTTP status and an audit-log outcome.
STOP_ERRORS: tuple[tuple[type[Exception], int, str], ...] = (
    (ProcessNotFound, 404, "not_found"),
    (ProcessChanged, 409, "changed"),
    (ProcessAccessDenied, 403, "access_denied"),
    (ProcessNotManaged, 403, "not_managed"),
    (ProcessNotOwned, 403, "not_owned"),
    (ProcessTerminationError, 500, "error"),
)


def stop_one(pid: int, started_at: float, origin: str | None) -> tuple[int, str, ProcessInfo | None]:
    """Stop one process and audit it. Returns (HTTP status, message, process details)."""
    try:
        info = terminate_process(pid, started_at=started_at)
    except tuple(error for error, _, _ in STOP_ERRORS) as exc:
        status_code, outcome = next((code, name) for error, code, name in STOP_ERRORS if isinstance(exc, error))
        audit.log_stop(
            pid=pid,
            started_at=started_at,
            outcome=outcome,
            status_code=status_code,
            origin=origin,
            detail=str(exc),
        )
        return status_code, str(exc), None

    audit.log_stop(
        pid=pid,
        started_at=started_at,
        outcome="requested",
        status_code=200,
        origin=origin,
        process=info,
    )
    return 200, f"Terminate requested for process {pid}", info


# Origin first, so requests from other sites don't use up the rate limit.
STOP_GUARDS = [Depends(require_dashboard_origin), Depends(limit_stop_rate)]


@app.post("/api/processes/{pid}/kill", response_model=KillResponse, dependencies=STOP_GUARDS)
def kill_process(pid: int, body: KillRequest, request: Request) -> KillResponse:
    status_code, message, _ = stop_one(pid, body.started_at, request.headers.get("origin"))
    if status_code != 200:
        raise HTTPException(status_code=status_code, detail=message)
    return KillResponse(pid=pid, signal="terminate", status="requested", message=message)


@app.post("/api/processes/stop", response_model=BulkStopResponse, dependencies=STOP_GUARDS)
def stop_processes(body: BulkStopRequest, request: Request) -> BulkStopResponse:
    """Stop several processes in one request.

    Each target gets the same checks as a single stop and its own audit entry.
    The request counts once toward the rate limit, so stopping a whole
    selection doesn't run into it. One failure doesn't stop the rest.
    """
    origin = request.headers.get("origin")
    results: list[StopResult] = []
    seen: set[int] = set()
    for target in body.targets:
        if target.pid in seen:
            continue
        seen.add(target.pid)
        status_code, message, _ = stop_one(target.pid, target.started_at, origin)
        results.append(
            StopResult(
                pid=target.pid,
                status="requested" if status_code == 200 else "failed",
                http_status=status_code,
                message=message,
            )
        )
    return BulkStopResponse(results=results)


def require_history(request: Request) -> HistoryRecorder:
    recorder = request.app.state.history
    if recorder is None:
        raise HTTPException(status_code=503, detail="Process history is unavailable. Check the agent log.")
    return recorder


@app.get("/api/history/events", response_model=HistoryEventsResponse)
def history_events(
    limit: int = Query(50, ge=1, le=history.MAX_EVENTS),
    recorder: HistoryRecorder = Depends(require_history),
) -> HistoryEventsResponse:
    """Recent process starts and stops, newest first."""
    return HistoryEventsResponse(events=recorder.store.recent_events(limit))


@app.get("/api/history/samples", response_model=ResourceSamplesResponse)
def history_samples(
    pid: int,
    started_at: float,
    minutes: int = Query(60, ge=1, le=history.RETENTION_DAYS * 24 * 60),
    recorder: HistoryRecorder = Depends(require_history),
) -> ResourceSamplesResponse:
    """CPU and memory samples for one process over the last ``minutes``."""
    since = time.time() - minutes * 60
    samples = recorder.store.samples_for((pid, started_at), since)
    return ResourceSamplesResponse(pid=pid, started_at=started_at, samples=samples)


# WebSocket endpoints for real-time updates
@app.websocket("/ws/processes")
async def ws_processes(websocket: WebSocket):
    await websocket_processes(websocket)


@app.websocket("/ws/health")
async def ws_health(websocket: WebSocket):
    await websocket_health(websocket)
