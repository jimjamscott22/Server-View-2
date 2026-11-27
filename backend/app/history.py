"""Process history: when dev servers started and stopped, and what they used.

Stored in SQLite (Python's built-in ``sqlite3``), so there is nothing extra
to install or run. The database lives in the user's data folder:

- Linux: ``$XDG_STATE_HOME/server-view/history.db`` (default ``~/.local/state``)
- macOS: ``~/Library/Application Support/Server-View/history.db``
- Windows: ``%LOCALAPPDATA%\\Server-View\\history.db``

Set ``SERVER_VIEW_HISTORY_DB`` to use another path. Rows older than
``RETENTION_DAYS`` are deleted, so the file stays small.

Two tables:

- ``events``: one ``started`` and one ``stopped`` row per process. A process
  is identified by ``(pid, started_at)``, because PIDs get reused.
- ``samples``: CPU and memory per process, every ``SAMPLE_INTERVAL_SECONDS``.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from collections.abc import Callable
from pathlib import Path

import psutil
from pydantic import BaseModel

from app import paths
from app.models import ProcessInfo, ProcessListResponse

HISTORY_DB_ENV = "SERVER_VIEW_HISTORY_DB"
RETENTION_DAYS = 7
SAMPLE_INTERVAL_SECONDS = 30.0
PRUNE_INTERVAL_SECONDS = 3600.0
# How often the background recorder looks at the process list when no dashboard is open.
RECORD_INTERVAL_SECONDS = 5.0
MAX_EVENTS = 500

logger = logging.getLogger(__name__)

ProcessKey = tuple[int, float]

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    time REAL NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('started', 'stopped')),
    pid INTEGER NOT NULL,
    started_at REAL NOT NULL,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT,
    ports TEXT NOT NULL,
    category TEXT NOT NULL,
    -- A restarted agent sees the same running processes again; this keeps one row each.
    UNIQUE (kind, pid, started_at)
);
CREATE INDEX IF NOT EXISTS events_by_time ON events (time);

CREATE TABLE IF NOT EXISTS samples (
    time REAL NOT NULL,
    pid INTEGER NOT NULL,
    started_at REAL NOT NULL,
    cpu_usage REAL NOT NULL,
    memory_mb REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_by_process ON samples (pid, started_at, time);
CREATE INDEX IF NOT EXISTS samples_by_time ON samples (time);
"""


class HistoryEvent(BaseModel):
    time: float
    kind: str
    pid: int
    started_at: float
    name: str
    command: str
    cwd: str | None
    ports: list[int]
    category: str


class ResourceSample(BaseModel):
    time: float
    cpu_usage: float
    memory_mb: float


class HistoryEventsResponse(BaseModel):
    events: list[HistoryEvent]


class ResourceSamplesResponse(BaseModel):
    pid: int
    started_at: float
    samples: list[ResourceSample]


def default_history_db_path() -> Path:
    return paths.data_dir() / "history.db"


def history_db_path() -> Path:
    override = os.environ.get(HISTORY_DB_ENV)
    return Path(override) if override else default_history_db_path()


def key_of(process: ProcessInfo) -> ProcessKey:
    return (process.pid, process.started_at)


def is_alive(key: ProcessKey) -> bool:
    """True if the process with this PID and start time is still running."""
    pid, started_at = key
    try:
        return abs(psutil.Process(pid).create_time() - started_at) < 0.01
    except psutil.NoSuchProcess:
        return False
    except psutil.Error:
        # Can't tell (access denied); assume it's still there rather than log a false stop.
        return True


class HistoryStore:
    """Thread-safe access to the history database."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        # One shared connection guarded by a lock: writes are tiny and infrequent.
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._conn:
            self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def add_event(self, kind: str, process: ProcessInfo, at: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO events (time, kind, pid, started_at, name, command, cwd, ports, category)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    at,
                    kind,
                    process.pid,
                    process.started_at,
                    process.name,
                    process.command,
                    process.cwd,
                    json.dumps(process.ports),
                    process.category,
                ),
            )

    def add_samples(self, processes: list[ProcessInfo], at: float) -> None:
        if not processes:
            return
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO samples (time, pid, started_at, cpu_usage, memory_mb) VALUES (?, ?, ?, ?, ?)",
                [(at, p.pid, p.started_at, p.cpu_usage, p.memory_mb) for p in processes],
            )

    def recent_events(self, limit: int = 50) -> list[HistoryEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM events ORDER BY time DESC, id DESC LIMIT ?", (min(limit, MAX_EVENTS),)
            ).fetchall()
        return [
            HistoryEvent(
                time=row["time"],
                kind=row["kind"],
                pid=row["pid"],
                started_at=row["started_at"],
                name=row["name"],
                command=row["command"],
                cwd=row["cwd"],
                ports=json.loads(row["ports"]),
                category=row["category"],
            )
            for row in rows
        ]

    def samples_for(self, key: ProcessKey, since: float) -> list[ResourceSample]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT time, cpu_usage, memory_mb FROM samples"
                " WHERE pid = ? AND started_at = ? AND time >= ? ORDER BY time",
                (*key, since),
            ).fetchall()
        return [ResourceSample(time=r["time"], cpu_usage=r["cpu_usage"], memory_mb=r["memory_mb"]) for r in rows]

    def prune(self, before: float) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM events WHERE time < ?", (before,))
            self._conn.execute("DELETE FROM samples WHERE time < ?", (before,))


class HistoryRecorder:
    """Turns a stream of process lists into start/stop events and samples."""

    def __init__(
        self,
        store: HistoryStore,
        clock: Callable[[], float] = time.time,
        alive: Callable[[ProcessKey], bool] = is_alive,
    ):
        self.store = store
        self._clock = clock
        self._alive = alive
        self._running: dict[ProcessKey, ProcessInfo] = {}
        self._last_sample: dict[ProcessKey, float] = {}
        self._last_prune = 0.0
        self._last_snapshot: ProcessListResponse | None = None

    def record(self, snapshot: ProcessListResponse) -> None:
        if snapshot is self._last_snapshot:
            # The shared scan was reused; nothing new to record.
            return
        self._last_snapshot = snapshot
        now = self._clock()
        current = {key_of(p): p for p in snapshot.processes}

        for key, process in current.items():
            if key not in self._running:
                # Time it really started, not when we noticed. INSERT OR IGNORE
                # skips processes a previous agent run already recorded.
                self.store.add_event("started", process, at=process.started_at)

        for key, process in list(self._running.items()):
            if key in current:
                continue
            if self._alive(key):
                # Off the list but still running (a Python server between ports, say).
                # Keep watching it so its real exit is recorded later.
                current[key] = process
                continue
            # Keep the last details we saw (ports are gone once it exits).
            self.store.add_event("stopped", process, at=now)
            self._last_sample.pop(key, None)

        due = [
            p for p in snapshot.processes
            if now - self._last_sample.get(key_of(p), 0.0) >= SAMPLE_INTERVAL_SECONDS
        ]
        self.store.add_samples(due, at=now)
        for process in due:
            self._last_sample[key_of(process)] = now

        self._running = current

        if now - self._last_prune >= PRUNE_INTERVAL_SECONDS:
            self.store.prune(before=now - RETENTION_DAYS * 86400)
            self._last_prune = now


def open_recorder() -> HistoryRecorder | None:
    """Open the history database, or return None (and log why) if it can't be used."""
    path = history_db_path()
    try:
        return HistoryRecorder(HistoryStore(path))
    except (OSError, sqlite3.Error) as exc:
        logger.warning("Process history is off: could not open %s: %s", path, exc)
        return None
