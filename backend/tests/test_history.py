"""Process history: start/stop events, resource samples, and the history API."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import history, main
from app.history import HistoryRecorder, HistoryStore
from app.models import ProcessInfo, ProcessListResponse, ProcessSummary


def proc(pid: int, started_at: float = 100.0, cpu: float = 1.0, memory: float = 50.0, ports=(5173,)) -> ProcessInfo:
    return ProcessInfo(
        pid=pid,
        name="node",
        command="npm run dev",
        cwd="/work/app",
        ports=list(ports),
        cpu_usage=cpu,
        memory_mb=memory,
        uptime_seconds=1,
        status="running",
        started_at=started_at,
    )


def snapshot(*processes: ProcessInfo) -> ProcessListResponse:
    return ProcessListResponse(
        processes=list(processes),
        summary=ProcessSummary(process_count=len(processes), total_memory_mb=0.0),
    )


class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def store(tmp_path: Path):
    store = HistoryStore(tmp_path / "history.db")
    yield store
    store.close()


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def alive() -> set[tuple[int, float]]:
    """Processes the recorder should treat as still running when they leave the list."""
    return set()


@pytest.fixture
def recorder(store: HistoryStore, clock: Clock, alive: set) -> HistoryRecorder:
    return HistoryRecorder(store, clock=clock, alive=lambda key: key in alive)


def kinds(store: HistoryStore) -> list[tuple[str, int]]:
    return [(event.kind, event.pid) for event in store.recent_events()]


def test_records_start_at_the_process_start_time(recorder: HistoryRecorder, store: HistoryStore) -> None:
    recorder.record(snapshot(proc(1, started_at=900.0)))

    [event] = store.recent_events()
    assert event.kind == "started"
    assert event.time == 900.0
    assert event.ports == [5173]
    assert event.cwd == "/work/app"


def test_records_stop_when_process_exits(recorder: HistoryRecorder, store: HistoryStore, clock: Clock) -> None:
    recorder.record(snapshot(proc(1)))
    clock.now = 1010.0
    recorder.record(snapshot())

    [stopped, started] = store.recent_events()
    assert (stopped.kind, stopped.time) == ("stopped", 1010.0)
    # The last ports we saw, since an exited process has none.
    assert stopped.ports == [5173]
    assert started.kind == "started"


def test_process_still_running_off_the_list_is_not_stopped(
    recorder: HistoryRecorder, store: HistoryStore, alive: set
) -> None:
    recorder.record(snapshot(proc(1)))
    alive.add((1, 100.0))
    recorder.record(snapshot())
    assert kinds(store) == [("started", 1)]

    # It really exits later: now it's recorded.
    alive.clear()
    recorder.record(snapshot())
    assert kinds(store) == [("stopped", 1), ("started", 1)]


def test_reused_pid_counts_as_a_new_process(recorder: HistoryRecorder, store: HistoryStore, clock: Clock) -> None:
    recorder.record(snapshot(proc(1, started_at=100.0)))
    clock.now = 1100.0
    recorder.record(snapshot(proc(1, started_at=1050.0)))

    events = store.recent_events()
    # Newest first: old process stopped (1100), new one started (1050), old one started (100).
    assert [(e.kind, e.started_at) for e in events] == [("stopped", 100.0), ("started", 1050.0), ("started", 100.0)]


def test_agent_restart_does_not_duplicate_start_events(store: HistoryStore, clock: Clock) -> None:
    HistoryRecorder(store, clock=clock).record(snapshot(proc(1)))
    HistoryRecorder(store, clock=clock).record(snapshot(proc(1)))

    assert kinds(store) == [("started", 1)]


def test_samples_every_interval(recorder: HistoryRecorder, store: HistoryStore, clock: Clock) -> None:
    recorder.record(snapshot(proc(1, cpu=5.0)))
    clock.now += 10
    recorder.record(snapshot(proc(1, cpu=6.0)))  # too soon, skipped
    clock.now += history.SAMPLE_INTERVAL_SECONDS
    recorder.record(snapshot(proc(1, cpu=7.0, memory=60.0)))

    samples = store.samples_for((1, 100.0), since=0)
    assert [(s.cpu_usage, s.memory_mb) for s in samples] == [(5.0, 50.0), (7.0, 60.0)]


def test_reused_snapshot_is_not_recorded_twice(recorder: HistoryRecorder, store: HistoryStore, clock: Clock) -> None:
    shared = snapshot(proc(1))
    recorder.record(shared)
    clock.now += history.SAMPLE_INTERVAL_SECONDS
    recorder.record(shared)

    assert len(store.samples_for((1, 100.0), since=0)) == 1


def test_prunes_rows_past_retention(recorder: HistoryRecorder, store: HistoryStore, clock: Clock) -> None:
    clock.now = 10.0
    recorder.record(snapshot(proc(1, started_at=5.0)))
    clock.now = 10.0 + history.RETENTION_DAYS * 86400 + history.PRUNE_INTERVAL_SECONDS
    recorder.record(snapshot(proc(1, started_at=5.0), proc(2, started_at=clock.now - 1)))

    # Process 1's week-old start and samples are gone; it's still running, so no stop.
    assert kinds(store) == [("started", 2)]
    assert len(store.samples_for((1, 5.0), since=0)) == 1


def test_unwritable_database_turns_history_off(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("")
    monkeypatch.setenv(history.HISTORY_DB_ENV, str(blocker / "history.db"))

    assert history.open_recorder() is None


@pytest.fixture
def api(recorder: HistoryRecorder):
    main.app.state.history = recorder
    yield TestClient(main.app, base_url="http://127.0.0.1:8008")
    main.app.state.history = None


def test_events_endpoint_returns_newest_first(api: TestClient, recorder: HistoryRecorder, clock: Clock) -> None:
    recorder.record(snapshot(proc(1, started_at=100.0), proc(2, started_at=200.0)))

    response = api.get("/api/history/events", params={"limit": 1})

    assert response.status_code == 200
    assert [event["pid"] for event in response.json()["events"]] == [2]


def test_samples_endpoint_returns_one_process(api: TestClient, recorder: HistoryRecorder, clock: Clock) -> None:
    clock.now = history.time.time()
    recorder.record(snapshot(proc(1, cpu=3.0), proc(2, cpu=9.0)))

    response = api.get("/api/history/samples", params={"pid": 1, "started_at": 100.0})

    assert response.status_code == 200
    assert [s["cpu_usage"] for s in response.json()["samples"]] == [3.0]


def test_history_endpoints_report_unavailable_history() -> None:
    client = TestClient(main.app, base_url="http://127.0.0.1:8008")

    assert client.get("/api/history/events").status_code == 503


def test_agent_records_history_while_running(monkeypatch: pytest.MonkeyPatch, history_db: Path) -> None:
    from app import scanner

    monkeypatch.setattr(scanner, "scan_processes", lambda: snapshot(proc(42)))
    # Entering the TestClient runs the app lifespan, which starts the recorder.
    with TestClient(main.app, base_url="http://127.0.0.1:8008") as client:
        for _ in range(50):
            events = client.get("/api/history/events").json()["events"]
            if events:
                break
            history.time.sleep(0.02)

    assert [(e["kind"], e["pid"]) for e in events] == [("started", 42)]
    assert history_db.exists()
