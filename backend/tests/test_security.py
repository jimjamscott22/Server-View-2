"""Requests that don't come from the dashboard must not reach the agent."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main

DASHBOARD_ORIGIN = "http://127.0.0.1:5178"
LOCAL_BASE_URL = "http://127.0.0.1:8008"
# TestClient defaults WebSocket URLs to host "testserver", which the Host check rejects.
WS_BASE = "ws://127.0.0.1:8008"


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app, base_url=LOCAL_BASE_URL)


@pytest.fixture
def terminate_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls: list[int] = []
    monkeypatch.setattr(main, "terminate_process", lambda pid, started_at: calls.append(pid))
    return calls


def test_kill_rejects_foreign_origin(client: TestClient, terminate_calls: list[int]) -> None:
    response = client.post(
        "/api/processes/123/kill",
        json={"started_at": 100.0},
        headers={"Origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert terminate_calls == []


def test_kill_rejects_missing_origin(client: TestClient, terminate_calls: list[int]) -> None:
    response = client.post("/api/processes/123/kill", json={"started_at": 100.0})

    assert response.status_code == 403
    assert terminate_calls == []


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5178", "http://localhost:5178"])
def test_kill_accepts_dashboard_origins(client: TestClient, terminate_calls: list[int], origin: str) -> None:
    response = client.post(
        "/api/processes/123/kill",
        json={"started_at": 100.0},
        headers={"Origin": origin},
    )

    assert response.status_code == 200
    assert terminate_calls == [123]


def test_rejects_foreign_host_header(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Host": "attacker.example"})

    assert response.status_code == 400


@pytest.mark.parametrize("host", ["127.0.0.1:8008", "localhost:8008"])
def test_accepts_local_host_headers(client: TestClient, host: str) -> None:
    response = client.get("/api/health", headers={"Host": host})

    assert response.status_code == 200


def test_process_websocket_rejects_foreign_origin(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(WS_BASE + "/ws/processes", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_text()

    assert excinfo.value.code == 1008


def test_process_websocket_rejects_missing_origin(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(WS_BASE + "/ws/processes") as ws:
            ws.receive_text()

    assert excinfo.value.code == 1008


def test_process_websocket_accepts_dashboard_origin(client: TestClient) -> None:
    with client.websocket_connect(WS_BASE + "/ws/processes", headers={"Origin": DASHBOARD_ORIGIN}) as ws:
        assert "processes" in ws.receive_text()
