"""Append-only log of every stop request the agent receives.

Each line is one JSON object, so the file is easy to read and to grep or
parse later. The file lives in the user's local data folder:

- Linux: ``$XDG_STATE_HOME/server-view/audit.log`` (default ``~/.local/state``)
- macOS: ``~/Library/Logs/Server-View/audit.log``
- Windows: ``%LOCALAPPDATA%\\Server-View\\Logs\\audit.log``

Set ``SERVER_VIEW_AUDIT_LOG`` to use another path. The file rotates at
1 MB and keeps 3 old copies.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.models import ProcessInfo

AUDIT_LOG_ENV = "SERVER_VIEW_AUDIT_LOG"
MAX_BYTES = 1_000_000
BACKUP_COUNT = 3

logger = logging.getLogger(__name__)

_audit_logger = logging.getLogger("server_view.audit")
_audit_logger.propagate = False
_audit_logger.setLevel(logging.INFO)
_configured_path: Path | None = None
_lock = threading.Lock()


def default_audit_log_path() -> Path:
    home = Path.home()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
        return base / "Server-View" / "Logs" / "audit.log"
    if sys.platform == "darwin":
        return home / "Library" / "Logs" / "Server-View" / "audit.log"
    base = Path(os.environ.get("XDG_STATE_HOME") or home / ".local" / "state")
    return base / "server-view" / "audit.log"


def audit_log_path() -> Path:
    override = os.environ.get(AUDIT_LOG_ENV)
    return Path(override) if override else default_audit_log_path()


def _ensure_handler() -> bool:
    """Point the audit logger at the current path. Returns False if the file can't be opened."""
    global _configured_path
    path = audit_log_path()
    with _lock:
        if _configured_path == path:
            return True
        for handler in list(_audit_logger.handlers):
            _audit_logger.removeHandler(handler)
            handler.close()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8")
        except OSError as exc:
            # Never block a stop because the log can't be written; say so instead.
            _configured_path = None
            logger.warning("Could not open audit log at %s: %s", path, exc)
            return False
        handler.setFormatter(logging.Formatter("%(message)s"))
        _audit_logger.addHandler(handler)
        _configured_path = path
        return True


def log_stop(
    *,
    pid: int | str | None,
    outcome: str,
    status_code: int,
    origin: str | None,
    started_at: float | None = None,
    process: ProcessInfo | None = None,
    detail: str | None = None,
) -> None:
    """Record one stop request and what happened to it."""
    entry: dict[str, object] = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": "stop",
        "pid": int(pid) if isinstance(pid, str) and pid.isdigit() else pid,
        "started_at": started_at,
        "outcome": outcome,
        "status": status_code,
        "origin": origin,
    }
    if process is not None:
        entry["name"] = process.name
        entry["command"] = process.command
        entry["cwd"] = process.cwd
    if detail:
        entry["detail"] = detail

    line = json.dumps(entry)
    # Also in the console, so it shows up next to uvicorn's own log.
    logger.info("audit %s", line)
    if _ensure_handler():
        _audit_logger.info(line)
