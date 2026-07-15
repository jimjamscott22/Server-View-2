from __future__ import annotations

import os
import shlex
import time
from collections.abc import Iterable
from pathlib import PurePath

import psutil

from app.models import PortConflict, ProcessGroup, ProcessInfo, ProcessListResponse, ProcessSummary


DEV_PROCESS_KEYWORDS = (
    "node",
    "npm",
    "vite",
    "next",
    "python",
    "uvicorn",
    "fastapi",
)

NODE_RUNTIME_NAMES = {"node", "npm", "npx", "pnpm", "yarn", "bun", "vite", "next"}
NODE_DEV_TOOL_NAMES = {"npm", "npx", "pnpm", "yarn", "bun", "vite", "next"}
PYTHON_RUNTIME_NAMES = {"python", "python3", "uvicorn", "fastapi"}
PYTHON_DEV_HINTS = {"uvicorn", "fastapi", "manage.py", "flask", "django"}
EXCLUDED_PROCESS_NAMES = {"bwrap", "codex-linux-sandbox"}
WINDOWS_EXECUTABLE_SUFFIXES = (".exe", ".bat", ".cmd", ".com")


class ProcessAccessDenied(Exception):
    """Raised when the current user cannot inspect or terminate a process."""


class ProcessNotFound(Exception):
    """Raised when a process no longer exists."""


class ProcessTerminationError(Exception):
    """Raised when a process exists but could not be terminated."""


def command_to_text(command: list[str] | tuple[str, ...] | str | None) -> str:
    if isinstance(command, str):
        return command
    if command:
        return " ".join(command)
    return ""


def command_tokens(command: str) -> list[str]:
    # POSIX shlex mishandles Windows paths with backslashes (e.g. C:\Users\...).
    if os.name == "nt":
        return command.split()
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


def executable_name(token: str) -> str:
    name = PurePath(token).name.lower()
    for suffix in WINDOWS_EXECUTABLE_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def is_dev_process(name: str, command: str) -> bool:
    process_name = executable_name(name)
    tokens = command_tokens(command)
    executables = [process_name, *(executable_name(token) for token in tokens)]
    token_text = " ".join(executables)

    if any(executable in NODE_DEV_TOOL_NAMES for executable in executables):
        return True

    if "uvicorn" in executables or "fastapi" in executables:
        return True

    if process_name in PYTHON_RUNTIME_NAMES or any(executable in {"python", "python3"} for executable in executables):
        return any(hint in token_text for hint in PYTHON_DEV_HINTS)

    return False


def has_dev_server_evidence(info: ProcessInfo) -> bool:
    if info.ports:
        return True
    return not executable_name(info.name).startswith("python")


def listening_ports_by_pid(connections: Iterable[object] | None = None) -> dict[int, list[int]]:
    ports_by_pid: dict[int, set[int]] = {}
    try:
        net_connections = connections if connections is not None else psutil.net_connections(kind="inet")
    except (psutil.AccessDenied, PermissionError):
        return {}

    for connection in net_connections:
        pid = getattr(connection, "pid", None)
        local_address = getattr(connection, "laddr", None)
        status = getattr(connection, "status", "")
        port = getattr(local_address, "port", None)
        if pid is None or port is None or status != psutil.CONN_LISTEN:
            continue
        ports_by_pid.setdefault(int(pid), set()).add(int(port))

    return {pid: sorted(ports) for pid, ports in ports_by_pid.items()}


def process_to_info(process: psutil.Process, ports: list[int], now: float | None = None) -> ProcessInfo | None:
    current_time = time.time() if now is None else now
    try:
        attrs = process.as_dict(
            attrs=["pid", "name", "cmdline", "cwd", "cpu_percent", "memory_info", "create_time", "status"]
        )
    except (psutil.AccessDenied, PermissionError):
        return None
    except (psutil.NoSuchProcess, psutil.ZombieProcess):
        return None

    name = attrs.get("name") or f"pid-{attrs['pid']}"
    command = command_to_text(attrs.get("cmdline"))
    if executable_name(name) in EXCLUDED_PROCESS_NAMES:
        return None

    runtime_with_port = bool(ports) and executable_name(name) in {*NODE_RUNTIME_NAMES, *PYTHON_RUNTIME_NAMES}
    if not is_dev_process(name, command) and not runtime_with_port:
        return None

    memory_info = attrs.get("memory_info")
    rss = getattr(memory_info, "rss", 0) if memory_info is not None else 0
    create_time = attrs.get("create_time") or current_time

    info = ProcessInfo(
        pid=int(attrs["pid"]),
        name=name,
        command=command,
        cwd=attrs.get("cwd"),
        ports=ports,
        cpu_usage=round(float(attrs.get("cpu_percent") or 0.0), 1),
        memory_mb=round(rss / 1024 / 1024, 1),
        uptime_seconds=max(0, int(current_time - float(create_time))),
        status=attrs.get("status") or "unknown",
    )
    return info if has_dev_server_evidence(info) else None


def project_label(path: str | None) -> str:
    if not path:
        return "Ungrouped"
    return PurePath(path).name or path


def group_key_for(info: ProcessInfo) -> str:
    """Stable group identity: the working directory when known, otherwise a
    per-PID key so a process with no cwd stands alone instead of pooling with
    unrelated cwd-less processes."""
    if info.cwd:
        return info.cwd
    return f"pid:{info.pid}"


def select_primary_pid(members: list[ProcessInfo]) -> int | None:
    """Pick the process that best represents a project group. A port owner is
    the real dev server; with several, the lowest port wins. With no port
    owner, the heaviest process is the runtime rather than a thin wrapper."""
    if not members:
        return None
    port_owners = [member for member in members if member.ports]
    if port_owners:
        return min(port_owners, key=lambda member: (min(member.ports), member.pid)).pid
    return max(members, key=lambda member: (member.memory_mb, member.pid)).pid


def build_groups(processes: list[ProcessInfo]) -> list[ProcessGroup]:
    """Group processes by working directory and tag each member's
    ``group_key``/``is_primary`` in place. A member is primary if it owns a
    listening port or is the group's chosen representative; everything else is
    a helper a project view can collapse."""
    members_by_key: dict[str, list[ProcessInfo]] = {}
    order: list[str] = []
    for info in processes:
        key = group_key_for(info)
        info.group_key = key
        if key not in members_by_key:
            members_by_key[key] = []
            order.append(key)
        members_by_key[key].append(info)

    groups: list[ProcessGroup] = []
    for key in order:
        members = members_by_key[key]
        primary_pid = select_primary_pid(members)
        for member in members:
            member.is_primary = bool(member.ports) or member.pid == primary_pid
        project_path = members[0].cwd
        groups.append(
            ProcessGroup(
                key=key,
                project_path=project_path,
                label=project_label(project_path),
                pids=[member.pid for member in members],
                ports=sorted({port for member in members for port in member.ports}),
                process_count=len(members),
                total_memory_mb=round(sum(member.memory_mb for member in members), 1),
                primary_pid=primary_pid,
            )
        )

    # Named projects first (alphabetical), then cwd-less singletons.
    groups.sort(key=lambda group: (group.project_path is None, group.label.lower(), group.key))
    return groups


def detect_port_conflicts(processes: list[ProcessInfo]) -> list[PortConflict]:
    """A conflict is one listening port claimed by more than one process."""
    pids_by_port: dict[int, list[int]] = {}
    for info in processes:
        for port in info.ports:
            owners = pids_by_port.setdefault(port, [])
            if info.pid not in owners:
                owners.append(info.pid)
    return [
        PortConflict(port=port, pids=sorted(pids))
        for port, pids in sorted(pids_by_port.items())
        if len(pids) > 1
    ]


def scan_processes() -> ProcessListResponse:
    ports_by_pid = listening_ports_by_pid()
    processes: list[ProcessInfo] = []
    now = time.time()

    for process in psutil.process_iter():
        info = process_to_info(process, ports_by_pid.get(process.pid, []), now=now)
        if info is not None:
            processes.append(info)

    processes.sort(key=lambda item: (item.name.lower(), item.pid))
    groups = build_groups(processes)
    port_conflicts = detect_port_conflicts(processes)
    active_ports = sorted({port for process in processes for port in process.ports})
    total_memory_mb = round(sum(process.memory_mb for process in processes), 1)
    summary = ProcessSummary(
        process_count=len(processes),
        total_memory_mb=total_memory_mb,
        active_ports=active_ports,
        group_count=len(groups),
        conflict_count=len(port_conflicts),
    )
    return ProcessListResponse(
        processes=processes,
        groups=groups,
        port_conflicts=port_conflicts,
        summary=summary,
    )


def terminate_process(pid: int) -> None:
    try:
        process = psutil.Process(pid)
    except psutil.NoSuchProcess as exc:
        raise ProcessNotFound(f"Process {pid} was not found") from exc

    try:
        # terminate() is SIGTERM on Unix and TerminateProcess on Windows.
        process.terminate()
    except psutil.NoSuchProcess as exc:
        raise ProcessNotFound(f"Process {pid} was not found") from exc
    except (psutil.AccessDenied, PermissionError) as exc:
        raise ProcessAccessDenied(f"Permission denied for process {pid}") from exc
    except Exception as exc:  # pragma: no cover - defensive wrapper for OS errors
        raise ProcessTerminationError(f"Could not terminate process {pid}") from exc
