import pytest
from httpx import ASGITransport, AsyncClient

from app import main
from app.models import ProcessInfo, ProcessListResponse, ProcessSummary
from app.scanner import ProcessAccessDenied, ProcessNotFound


pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def request(method: str, url: str):
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, url)


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

    monkeypatch.setattr(main, "scan_processes", fake_scan_processes)

    response = await request("GET", "/api/processes")

    assert response.status_code == 200
    assert response.json()["summary"]["process_count"] == 1
    assert response.json()["processes"][0]["pid"] == 123


async def test_kill_process_success(monkeypatch) -> None:
    called = {}

    def fake_terminate_process(pid: int) -> None:
        called["pid"] = pid

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await request("POST", "/api/processes/123/kill")

    assert response.status_code == 200
    assert called["pid"] == 123
    assert response.json()["signal"] == "terminate"
    assert response.json()["status"] == "requested"


async def test_kill_process_missing_pid(monkeypatch) -> None:
    def fake_terminate_process(pid: int) -> None:
        raise ProcessNotFound("Process 404 was not found")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await request("POST", "/api/processes/404/kill")

    assert response.status_code == 404
    assert response.json()["detail"] == "Process 404 was not found"


async def test_kill_process_permission_denied(monkeypatch) -> None:
    def fake_terminate_process(pid: int) -> None:
        raise ProcessAccessDenied("Permission denied for process 1")

    monkeypatch.setattr(main, "terminate_process", fake_terminate_process)

    response = await request("POST", "/api/processes/1/kill")

    assert response.status_code == 403
    assert response.json()["detail"] == "Permission denied for process 1"
