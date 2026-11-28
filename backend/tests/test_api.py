import pytest
from httpx import ASGITransport, AsyncClient

from app import main, scanner
from app.models import ProcessInfo, ProcessListResponse, ProcessSummary
from app.scanner import ProcessAccessDenied, ProcessChanged, ProcessNotFound, ProcessNotManaged


pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


DASHBOARD_HEADERS = {"Origin": "http://127.0.0.1:5178"}


async def request(method: str, url: str, **kwargs):
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8008") as client:
        return await client.request(method, url, **kwargs)


async def kill(pid: int, body: dict | None = None):
    return await request(
        "POST",
        f"/api/processes/{pid}/kill",
        json={"started_at": 100.0} if body is None else body,
        headers=DASHBOARD_HEADERS,
    )


async def test_health_response() -> None:
    response = await request("GET", "/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_processes_response_shape(monkeypatch) -> None:
    def fake_scan_processes() -> ProcessListResponse:
        processes = [
            ProcessInfo(
                pid=123,
                name="node",
                command="npm run dev",
                cwd="/tmp/app",
                ports=[5173],
                cpu_usage=1.5,
                memory_mb=64.0,
                uptime_seconds=30,
                status="running",
            )
        ]
        summary = ProcessSummary(process_count=1, total_memory_mb=64.0, active_ports=[5173])
        return ProcessListResponse(processes=processes, summary=summary)

    monkeypatch.setattr(scanner, "scan_processes", fake_scan_processes)

    response = await request("GET", "/api/processes")

    assert response.status_code == 200
    assert response.json()["summary"]["process_count"] == 1
    assert response.json()["processes"][0]["pid"] == 123


async def test_kill_process_success(monkeypatch) -> None:
    called = {}

    def fake_terminate_process(pid: int, started_at: float) -> None:
        called["pid"] = pid
        called["started_at"] = started_at

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await kill(123)

    assert response.status_code == 200
    assert called["pid"] == 123
    assert called["started_at"] == 100.0
    assert response.json()["signal"] == "terminate"
    assert response.json()["status"] == "requested"


async def test_kill_process_missing_pid(monkeypatch) -> None:
    def fake_terminate_process(pid: int, started_at: float) -> None:
        raise ProcessNotFound("Process 404 was not found")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await kill(404)

    assert response.status_code == 404
    assert response.json()["detail"] == "Process 404 was not found"


async def test_kill_process_permission_denied(monkeypatch) -> None:
    def fake_terminate_process(pid: int, started_at: float) -> None:
        raise ProcessAccessDenied("Permission denied for process 1")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await kill(1)

    assert response.status_code == 403
    assert response.json()["detail"] == "Permission denied for process 1"


async def test_kill_process_requires_start_time() -> None:
    response = await kill(123, body={})

    assert response.status_code == 422


async def test_kill_process_rejects_changed_process(monkeypatch) -> None:
    def fake_terminate_process(pid: int, started_at: float) -> None:
        raise ProcessChanged("Process 123 changed since it was selected")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await kill(123)

    assert response.status_code == 409
    assert response.json()["detail"] == "Process 123 changed since it was selected"


async def test_kill_process_rejects_unmanaged_process(monkeypatch) -> None:
    def fake_terminate_process(pid: int, started_at: float) -> None:
        raise ProcessNotManaged("Process 123 is not a detected development process")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await kill(123)

    assert response.status_code == 403
    assert response.json()["detail"] == "Process 123 is not a detected development process"
