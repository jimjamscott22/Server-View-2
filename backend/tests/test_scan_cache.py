"""Repeat scans skip processes already known not to be dev servers."""

import pytest

from app import scanner


class CountingProcess:
    """A psutil.Process stand-in that counts how often its details are read."""

    def __init__(self, pid: int, name: str, cmdline: list[str], create_time: float = 100.0):
        self.pid = pid
        self._create_time = create_time
        self._attrs = {
            "pid": pid,
            "name": name,
            "cmdline": cmdline,
            "cwd": "/tmp/app",
            "cpu_percent": 0.0,
            "memory_info": None,
            "create_time": create_time,
            "status": "running",
        }
        self.detail_reads = 0

    def create_time(self) -> float:
        return self._create_time

    def name(self) -> str:
        return self._attrs["name"]

    def exec_into(self, name: str, cmdline: list[str]) -> None:
        """Replace the program, as exec() does: same PID and start time."""
        self._attrs["name"] = name
        self._attrs["cmdline"] = cmdline

    def as_dict(self, attrs: list[str]) -> dict:
        self.detail_reads += 1
        return {attr: self._attrs.get(attr) for attr in attrs}


@pytest.fixture(autouse=True)
def empty_cache() -> None:
    scanner._non_dev_processes.clear()


def install(monkeypatch: pytest.MonkeyPatch, processes: list[CountingProcess], ports: dict[int, list[int]] | None = None):
    monkeypatch.setattr(scanner.psutil, "process_iter", lambda: iter(processes))
    monkeypatch.setattr(scanner, "listening_ports_by_pid", lambda: ports or {})


def test_second_scan_skips_known_non_dev_process(monkeypatch: pytest.MonkeyPatch) -> None:
    sshd = CountingProcess(1, "sshd", ["/usr/sbin/sshd"])
    vite = CountingProcess(2, "node", ["npx", "vite"])
    install(monkeypatch, [sshd, vite], {2: [5173]})

    first = scanner.scan_processes()
    second = scanner.scan_processes()

    assert [p.pid for p in first.processes] == [2]
    assert [p.pid for p in second.processes] == [2]
    assert sshd.detail_reads == 1
    # Listed processes are read every scan: CPU and memory change.
    assert vite.detail_reads == 2


def test_reused_pid_is_classified_again(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, [CountingProcess(7, "sshd", ["/usr/sbin/sshd"], create_time=100.0)])
    scanner.scan_processes()

    # The OS gave PID 7 to a dev server after sshd exited.
    vite = CountingProcess(7, "node", ["npx", "vite"], create_time=200.0)
    install(monkeypatch, [vite], {7: [5173]})

    assert [p.pid for p in scanner.scan_processes().processes] == [7]


def test_bare_runtime_is_checked_again_once_it_owns_a_port(monkeypatch: pytest.MonkeyPatch) -> None:
    java = CountingProcess(3, "java", ["java", "-jar", "app.jar"])
    install(monkeypatch, [java])
    assert scanner.scan_processes().processes == []

    install(monkeypatch, [java], {3: [8080]})

    assert [p.pid for p in scanner.scan_processes().processes] == [3]


def test_unreadable_command_line_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    # psutil reports None when it may not read another user's command line; that can change.
    hidden = CountingProcess(4, "node", None)  # type: ignore[arg-type]
    install(monkeypatch, [hidden])

    scanner.scan_processes()
    scanner.scan_processes()

    assert hidden.detail_reads == 2


def test_exited_processes_leave_the_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, [CountingProcess(5, "sshd", ["/usr/sbin/sshd"])])
    scanner.scan_processes()
    assert (5, 100.0) in scanner._non_dev_processes

    install(monkeypatch, [])
    scanner.scan_processes()

    assert scanner._non_dev_processes == {}


def test_exec_into_a_dev_server_is_noticed(monkeypatch: pytest.MonkeyPatch) -> None:
    # `bash -c "... && exec uvicorn app:app"` keeps bash's PID and start time.
    launcher = CountingProcess(6, "bash", ["bash", "-c", "exec uvicorn app:app"])
    install(monkeypatch, [launcher], {6: [8000]})
    assert scanner.scan_processes().processes == []

    launcher.exec_into("uvicorn", ["uvicorn", "app:app"])

    assert [p.name for p in scanner.scan_processes().processes] == ["uvicorn"]


def test_cached_verdict_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    # An exec into a program with the same name isn't visible from the name alone.
    now = [1000.0]
    monkeypatch.setattr(scanner.time, "time", lambda: now[0])
    script = CountingProcess(8, "node", ["node", "scripts/prepare.js"])
    install(monkeypatch, [script])
    assert scanner.scan_processes().processes == []

    script.exec_into("node", ["node", "node_modules/.bin/vite"])
    now[0] += scanner.NON_DEV_RECHECK_SECONDS / 2
    assert scanner.scan_processes().processes == []

    now[0] += scanner.NON_DEV_RECHECK_SECONDS
    assert [p.pid for p in scanner.scan_processes().processes] == [8]
