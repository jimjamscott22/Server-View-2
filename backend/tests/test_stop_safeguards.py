"""Rate limiting, ownership refusals and the audit log for stop requests."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import audit, main, paths
from app.models import ProcessInfo
from app.scanner import ProcessNotFound, ProcessNotOwned
from app.security import StopRateLimiter, stop_rate_limiter

DASHBOARD_HEADERS = {"Origin": "http://127.0.0.1:5178"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app, base_url="http://127.0.0.1:8008")


def fake_info(pid: int) -> ProcessInfo:
    return ProcessInfo(
        pid=pid,
        name="node",
        command="npm run dev",
        cwd="/tmp/app",
        ports=[5173],
        cpu_usage=0.0,
        memory_mb=1.0,
        uptime_seconds=1,
        status="running",
    )


@pytest.fixture
def terminate_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls: list[int] = []

    def fake_terminate(pid: int, started_at: float) -> ProcessInfo:
        calls.append(pid)
        return fake_info(pid)

    monkeypatch.setattr(main, "terminate_process", fake_terminate)
    return calls


def stop(client: TestClient, pid: int = 123, headers: dict | None = None):
    return client.post(
        f"/api/processes/{pid}/kill",
        json={"started_at": 100.0},
        headers=DASHBOARD_HEADERS if headers is None else headers,
    )


def read_audit(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_kill_refuses_other_users_process(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_terminate(pid: int, started_at: float) -> None:
        raise ProcessNotOwned(f"Process {pid} belongs to another user. Server-View only stops your own processes.")

    monkeypatch.setattr(main, "terminate_process", fake_terminate)

    response = stop(client)

    assert response.status_code == 403
    assert "belongs to another user" in response.json()["detail"]


def test_kill_rate_limits_bursts(client: TestClient, terminate_calls: list[int]) -> None:
    for _ in range(stop_rate_limiter.max_requests):
        assert stop(client).status_code == 200

    response = stop(client)

    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 1
    assert len(terminate_calls) == stop_rate_limiter.max_requests


def test_foreign_origin_does_not_use_up_rate_limit(client: TestClient, terminate_calls: list[int]) -> None:
    for _ in range(stop_rate_limiter.max_requests * 2):
        assert stop(client, headers={"Origin": "https://evil.example"}).status_code == 403

    assert stop(client).status_code == 200


def test_rate_limiter_frees_slots_after_window() -> None:
    now = [0.0]
    limiter = StopRateLimiter(max_requests=2, window_seconds=10.0, clock=lambda: now[0])

    assert limiter.check() is None
    assert limiter.check() is None
    assert limiter.check() == pytest.approx(10.0)

    now[0] = 9.0
    assert limiter.check() == pytest.approx(1.0)

    now[0] = 10.0
    assert limiter.check() is None


def test_audit_logs_successful_stop(client: TestClient, terminate_calls: list[int], audit_log: Path) -> None:
    stop(client)

    [entry] = read_audit(audit_log)
    assert entry["event"] == "stop"
    assert entry["pid"] == 123
    assert entry["started_at"] == 100.0
    assert entry["outcome"] == "requested"
    assert entry["status"] == 200
    assert entry["origin"] == "http://127.0.0.1:5178"
    assert entry["name"] == "node"
    assert entry["command"] == "npm run dev"
    assert entry["cwd"] == "/tmp/app"
    assert "time" in entry


def test_audit_logs_refused_stop(client: TestClient, monkeypatch: pytest.MonkeyPatch, audit_log: Path) -> None:
    def fake_terminate(pid: int, started_at: float) -> None:
        raise ProcessNotFound(f"Process {pid} was not found")

    monkeypatch.setattr(main, "terminate_process", fake_terminate)

    stop(client, pid=404)

    [entry] = read_audit(audit_log)
    assert entry["pid"] == 404
    assert entry["outcome"] == "not_found"
    assert entry["status"] == 404
    assert entry["detail"] == "Process 404 was not found"


def test_audit_logs_foreign_origin(client: TestClient, terminate_calls: list[int], audit_log: Path) -> None:
    stop(client, headers={"Origin": "https://evil.example"})

    [entry] = read_audit(audit_log)
    assert entry["outcome"] == "foreign_origin"
    assert entry["status"] == 403
    assert entry["origin"] == "https://evil.example"
    assert entry["pid"] == 123


def test_audit_logs_rate_limited_stop(client: TestClient, terminate_calls: list[int], audit_log: Path) -> None:
    for _ in range(stop_rate_limiter.max_requests + 1):
        stop(client)

    entries = read_audit(audit_log)
    assert entries[-1]["outcome"] == "rate_limited"
    assert entries[-1]["status"] == 429


def test_stop_still_works_when_audit_log_cannot_be_written(
    client: TestClient, terminate_calls: list[int], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("")
    monkeypatch.setenv(audit.AUDIT_LOG_ENV, str(blocker / "audit.log"))

    response = stop(client)

    assert response.status_code == 200
    assert terminate_calls == [123]


@pytest.mark.parametrize(
    ("platform", "env", "expected_tail"),
    [
        ("linux", {"XDG_STATE_HOME": "/state"}, ("server-view", "audit.log")),
        ("darwin", {}, ("Library", "Logs", "Server-View", "audit.log")),
        ("win32", {"LOCALAPPDATA": "C:/Users/dev/AppData/Local"}, ("Server-View", "Logs", "audit.log")),
    ],
)
def test_default_audit_log_path_per_platform(
    monkeypatch: pytest.MonkeyPatch, platform: str, env: dict, expected_tail: tuple[str, ...]
) -> None:
    monkeypatch.setattr(paths.sys, "platform", platform)
    for name in ("XDG_STATE_HOME", "LOCALAPPDATA"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    path = audit.default_audit_log_path()

    assert path.parts[-len(expected_tail):] == expected_tail


def bulk_stop(client: TestClient, targets: list[dict], headers: dict | None = None):
    return client.post(
        "/api/processes/stop",
        json={"targets": targets},
        headers=DASHBOARD_HEADERS if headers is None else headers,
    )


def test_bulk_stop_reports_each_process(client: TestClient, monkeypatch: pytest.MonkeyPatch, audit_log: Path) -> None:
    def fake_terminate(pid: int, started_at: float) -> ProcessInfo:
        if pid == 2:
            raise ProcessNotOwned("Process 2 belongs to another user. Server-View only stops your own processes.")
        return fake_info(pid)

    monkeypatch.setattr(main, "terminate_process", fake_terminate)

    response = bulk_stop(client, [{"pid": 1, "started_at": 1.0}, {"pid": 2, "started_at": 2.0}, {"pid": 3, "started_at": 3.0}])

    assert response.status_code == 200
    results = response.json()["results"]
    assert [(r["pid"], r["status"], r["http_status"]) for r in results] == [
        (1, "requested", 200),
        (2, "failed", 403),
        (3, "requested", 200),
    ]
    assert "belongs to another user" in results[1]["message"]
    # One audit line per process, so the log reads the same as single stops.
    assert [(e["pid"], e["outcome"]) for e in read_audit(audit_log)] == [
        (1, "requested"),
        (2, "not_owned"),
        (3, "requested"),
    ]


def test_bulk_stop_counts_once_toward_rate_limit(client: TestClient, terminate_calls: list[int]) -> None:
    targets = [{"pid": pid, "started_at": 1.0} for pid in range(1, 21)]

    assert bulk_stop(client, targets).status_code == 200
    assert len(terminate_calls) == 20
    # Plenty of budget left for single stops.
    assert stop(client).status_code == 200


def test_bulk_stop_skips_duplicate_pids(client: TestClient, terminate_calls: list[int]) -> None:
    response = bulk_stop(client, [{"pid": 5, "started_at": 1.0}, {"pid": 5, "started_at": 1.0}])

    assert [r["pid"] for r in response.json()["results"]] == [5]
    assert terminate_calls == [5]


@pytest.mark.parametrize("count", [0, 26])
def test_bulk_stop_rejects_empty_or_oversized_requests(
    client: TestClient, terminate_calls: list[int], count: int
) -> None:
    targets = [{"pid": pid, "started_at": 1.0} for pid in range(1, count + 1)]

    assert bulk_stop(client, targets).status_code == 422
    assert terminate_calls == []


def test_bulk_stop_requires_dashboard_origin(client: TestClient, terminate_calls: list[int]) -> None:
    response = bulk_stop(client, [{"pid": 1, "started_at": 1.0}], headers={"Origin": "https://evil.example"})

    assert response.status_code == 403
    assert terminate_calls == []
