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


class ProcessListResponse(BaseModel):
    processes: list[ProcessInfo]
    groups: list[ProcessGroup] = Field(default_factory=list)
    port_conflicts: list[PortConflict] = Field(default_factory=list)
    summary: ProcessSummary


class HealthResponse(BaseModel):
    status: str


class KillResponse(BaseModel):
    pid: int
    signal: str
    status: str
    message: str
