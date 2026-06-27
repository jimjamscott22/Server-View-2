from pydantic import BaseModel, Field


class ProcessInfo(BaseModel):
    pid: int
    name: str
    command: str
    cwd: str | None
    ports: list[int] = Field(default_factory=list)
    cpu_usage: float
    memory_mb: float
    uptime_seconds: int
    status: str


class ProcessSummary(BaseModel):
    process_count: int
    total_memory_mb: float
    active_ports: list[int] = Field(default_factory=list)


class ProcessListResponse(BaseModel):
    processes: list[ProcessInfo]
    summary: ProcessSummary


class HealthResponse(BaseModel):
    status: str


class KillResponse(BaseModel):
    pid: int
    signal: str
    status: str
    message: str
