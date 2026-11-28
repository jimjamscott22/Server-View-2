from typing import Literal

from pydantic import BaseModel, Field


# "app": a dev server or tool. "database": a local database server.
# "docker": a Docker process that owns a port a container publishes.
ProcessCategory = Literal["app", "database", "docker"]


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
    # Process start time (epoch seconds). Sent back with a stop request so the
    # agent can tell a reused PID from the process the user selected.
    started_at: float = 0.0
    category: ProcessCategory = "app"
    # Grouping metadata, populated after a scan. Defaults keep ProcessInfo
    # constructible on its own (tests, fixtures) before grouping runs.
    group_key: str = ""
    is_primary: bool = False


class ProcessGroup(BaseModel):
    """A set of processes that share a working directory (a "project").

    Members are referenced by PID so process detail is never duplicated; the
    flat ``ProcessListResponse.processes`` list remains the single source of
    truth for per-process fields.
    """

    key: str
    project_path: str | None
    label: str
    pids: list[int] = Field(default_factory=list)
    ports: list[int] = Field(default_factory=list)
    process_count: int
    total_memory_mb: float
    primary_pid: int | None


class PortConflict(BaseModel):
    """A listening port claimed by more than one process."""

    port: int
    pids: list[int] = Field(default_factory=list)


class ProcessSummary(BaseModel):
    process_count: int
    total_memory_mb: float
    active_ports: list[int] = Field(default_factory=list)
    group_count: int = 0
    conflict_count: int = 0
    host_name: str = "localhost"
    memory_percent: float = 0.0


class ProcessListResponse(BaseModel):
    processes: list[ProcessInfo]
    groups: list[ProcessGroup] = Field(default_factory=list)
    port_conflicts: list[PortConflict] = Field(default_factory=list)
    summary: ProcessSummary


class HealthResponse(BaseModel):
    status: str


class KillRequest(BaseModel):
    started_at: float


class KillResponse(BaseModel):
    pid: int
    signal: str
    status: str
    message: str


# Upper bound on one bulk stop request; the dashboard sends what's selected.
MAX_BULK_STOP = 25


class StopTarget(BaseModel):
    pid: int
    started_at: float


class BulkStopRequest(BaseModel):
    targets: list[StopTarget] = Field(min_length=1, max_length=MAX_BULK_STOP)


class StopResult(BaseModel):
    pid: int
    # "requested": terminate was sent. "failed": see http_status and message.
    status: Literal["requested", "failed"]
    http_status: int
    message: str


class BulkStopResponse(BaseModel):
    results: list[StopResult]
