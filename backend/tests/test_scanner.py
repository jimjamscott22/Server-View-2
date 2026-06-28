from __future__ import annotations

from collections import namedtuple
from types import SimpleNamespace

import psutil
import pytest

from app.models import ProcessInfo
from app.scanner import (
    build_groups,
    detect_port_conflicts,
    is_dev_process,
    listening_ports_by_pid,
    process_to_info,
    select_primary_pid,
    terminate_process,
)


def make_info(pid: int, *, cwd: str | None, ports: list[int] | None = None, memory_mb: float = 1.0) -> ProcessInfo:
    return ProcessInfo(
        pid=pid,
        name="node",
        command="npm run dev",
        cwd=cwd,
        ports=ports or [],
        cpu_usage=0.0,
        memory_mb=memory_mb,
        uptime_seconds=0,
        status="running",
    )


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


def test_build_groups_clusters_by_cwd_and_tags_members() -> None:
    server = make_info(1, cwd="/work/app", ports=[5173], memory_mb=120.0)
    helper = make_info(2, cwd="/work/app", memory_mb=8.0)
    other = make_info(3, cwd="/work/api", ports=[8000], memory_mb=64.0)
    processes = [server, helper, other]

    groups = build_groups(processes)

    assert [group.label for group in groups] == ["api", "app"]
    app_group = next(group for group in groups if group.key == "/work/app")
    assert app_group.pids == [1, 2]
    assert app_group.ports == [5173]
    assert app_group.primary_pid == 1
    assert app_group.process_count == 2
    assert app_group.total_memory_mb == 128.0
    # Port owner and the helper are tagged distinctly on the shared list.
    assert server.is_primary is True
    assert helper.is_primary is False
    assert helper.group_key == "/work/app"


def test_build_groups_keeps_cwdless_processes_separate() -> None:
    a = make_info(10, cwd=None)
    b = make_info(11, cwd=None)

    groups = build_groups([a, b])

    assert len(groups) == 2
    assert {group.key for group in groups} == {"pid:10", "pid:11"}
    assert all(group.project_path is None and group.label == "Ungrouped" for group in groups)


def test_select_primary_prefers_port_owner_then_heaviest() -> None:
    owner = make_info(1, cwd="/p", ports=[8080], memory_mb=5.0)
    heavy = make_info(2, cwd="/p", memory_mb=200.0)

    assert select_primary_pid([owner, heavy]) == 1
    assert select_primary_pid([heavy]) == 2
    assert select_primary_pid([]) is None


def test_detect_port_conflicts_flags_shared_ports_only() -> None:
    a = make_info(1, cwd="/a", ports=[3000, 5173])
    b = make_info(2, cwd="/b", ports=[3000])

    conflicts = detect_port_conflicts([a, b])

    assert len(conflicts) == 1
    assert conflicts[0].port == 3000
    assert conflicts[0].pids == [1, 2]


def test_terminate_process_reports_missing_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing_process(pid: int) -> object:
        raise psutil.NoSuchProcess(pid=pid)

    monkeypatch.setattr(psutil, "Process", missing_process)

    with pytest.raises(Exception, match="Process 999 was not found"):
        terminate_process(999)
