from __future__ import annotations

from collections import namedtuple
from types import SimpleNamespace

import psutil
import pytest

from app.scanner import is_dev_process, listening_ports_by_pid, process_to_info, terminate_process


class FakeProcess:
    def __init__(self, attrs: dict, error: Exception | None = None):
        self.pid = attrs.get("pid", 0)
        self._attrs = attrs
        self._error = error

    def as_dict(self, attrs: list[str]) -> dict:
        if self._error:
            raise self._error
        return {attr: self._attrs.get(attr) for attr in attrs}


def test_filters_dev_processes_and_excludes_system_processes() -> None:
    assert is_dev_process("node", "npm run dev")
    assert is_dev_process("python", "uvicorn app.main:app")
    assert not is_dev_process("sshd", "/usr/sbin/sshd")
    assert not is_dev_process("fusermount3", "fusermount3 -o rw,nodev -- /run/user/1000/doc")
    assert not is_dev_process("Typora", "/proc/self/exe --node-integration-in-worker")
    assert not is_dev_process("MainThread", "node /home/user/.nvm/bin/codex")
    assert not is_dev_process("python3", "/usr/bin/python3 /usr/bin/wsdd")


def test_process_to_info_handles_missing_cwd() -> None:
    process = FakeProcess(
        {
            "pid": 42,
            "name": "node",
            "cmdline": ["npm", "run", "dev"],
            "cwd": None,
            "cpu_percent": 3.25,
            "memory_info": SimpleNamespace(rss=10485760),
            "create_time": 90.0,
            "status": "running",
        }
    )

    info = process_to_info(process, [5173], now=100.0)

    assert info is not None
    assert info.pid == 42
    assert info.cwd is None
    assert info.ports == [5173]
    assert info.memory_mb == 10.0
    assert info.uptime_seconds == 10


def test_process_to_info_excludes_sandbox_wrappers() -> None:
    process = FakeProcess(
        {
            "pid": 44,
            "name": "bwrap",
            "cmdline": ["bwrap", "--", "npm", "run", "dev"],
            "cwd": "/tmp/frontend",
            "cpu_percent": 0.0,
            "memory_info": SimpleNamespace(rss=1048576),
            "create_time": 90.0,
            "status": "sleeping",
        }
    )

    assert process_to_info(process, [5173], now=100.0) is None


def test_process_to_info_keeps_runtime_process_with_listening_port() -> None:
    process = FakeProcess(
        {
            "pid": 43,
            "name": "python3",
            "cmdline": ["python3", "-c", "from multiprocessing.spawn import spawn_main"],
            "cwd": "/tmp/backend",
            "cpu_percent": 0.0,
            "memory_info": SimpleNamespace(rss=1048576),
            "create_time": 90.0,
            "status": "running",
        }
    )

    info = process_to_info(process, [8000], now=100.0)

    assert info is not None
    assert info.pid == 43
    assert info.ports == [8000]


def test_process_to_info_skips_permission_errors() -> None:
    process = FakeProcess({"pid": 7}, error=psutil.AccessDenied(pid=7))

    assert process_to_info(process, []) is None


def test_listening_ports_by_pid_maps_listening_ports_only() -> None:
    Address = namedtuple("Address", ["ip", "port"])
    Connection = namedtuple("Connection", ["pid", "laddr", "status"])
    connections = [
        Connection(10, Address("127.0.0.1", 8000), psutil.CONN_LISTEN),
        Connection(10, Address("127.0.0.1", 5173), psutil.CONN_LISTEN),
        Connection(11, Address("127.0.0.1", 5432), "ESTABLISHED"),
        Connection(None, Address("127.0.0.1", 9000), psutil.CONN_LISTEN),
    ]

    assert listening_ports_by_pid(connections) == {10: [5173, 8000]}


def test_terminate_process_reports_missing_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing_process(pid: int) -> object:
        raise psutil.NoSuchProcess(pid=pid)

    monkeypatch.setattr(psutil, "Process", missing_process)

    with pytest.raises(Exception, match="Process 999 was not found"):
        terminate_process(999)
