from __future__ import annotations

import signal
import shlex
import time
from collections.abc import Iterable
from pathlib import PurePath

import psutil

from app.models import ProcessInfo, ProcessSummary


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


class ProcessAccessDenied(Exception):
    """Raised when the current user cannot inspect or terminate a process."""


class ProcessNotFound(Exception):
    """Raised when a process no longer exists."""


class ProcessTerminationError(Exception):
    """Raised when a process exists but SIGTERM could not be sent."""


def command_to_text(command: list[str] | tuple[str, ...] | str | None) -> str:
    if isinstance(command, str):
        return command
    if command:
        return " ".join(command)
    return ""


def command_tokens(command: str) -> list[str]:
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


def executable_name(token: str) -> str:
    return PurePath(token).name.lower()


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


def scan_processes() -> tuple[list[ProcessInfo], ProcessSummary]:
    ports_by_pid = listening_ports_by_pid()
    processes: list[ProcessInfo] = []
    now = time.time()

    for process in psutil.process_iter():
        info = process_to_info(process, ports_by_pid.get(process.pid, []), now=now)
        if info is not None:
            processes.append(info)

    processes.sort(key=lambda item: (item.name.lower(), item.pid))
    active_ports = sorted({port for process in processes for port in process.ports})
    total_memory_mb = round(sum(process.memory_mb for process in processes), 1)
    summary = ProcessSummary(
        process_count=len(processes),
        total_memory_mb=total_memory_mb,
        active_ports=active_ports,
    )
    return processes, summary


def terminate_process(pid: int) -> None:
    try:
        process = psutil.Process(pid)
    except psutil.NoSuchProcess as exc:
        raise ProcessNotFound(f"Process {pid} was not found") from exc

    try:
        process.send_signal(signal.SIGTERM)
    except psutil.NoSuchProcess as exc:
        raise ProcessNotFound(f"Process {pid} was not found") from exc
    except (psutil.AccessDenied, PermissionError) as exc:
        raise ProcessAccessDenied(f"Permission denied for process {pid}") from exc
    except Exception as exc:  # pragma: no cover - defensive wrapper for OS errors
        raise ProcessTerminationError(f"Could not terminate process {pid}") from exc
