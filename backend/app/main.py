from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import HealthResponse, KillResponse, ProcessListResponse
from app.scanner import ProcessAccessDenied, ProcessNotFound, ProcessTerminationError, scan_processes, terminate_process

app = FastAPI(title="Server-View Local Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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


@app.post("/api/processes/{pid}/kill", response_model=KillResponse)
async def kill_process(pid: int) -> KillResponse:
    try:
        terminate_process(pid)
    except ProcessNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProcessAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProcessTerminationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return KillResponse(
        pid=pid,
        signal="SIGTERM",
        status="requested",
        message=f"SIGTERM sent to process {pid}",
    )
