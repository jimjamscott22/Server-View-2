from pathlib import Path

import pytest

from app import audit, history
from app.security import stop_rate_limiter
from app.snapshot import scan_cache


@pytest.fixture(autouse=True)
def audit_log(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Send audit entries to a temp file instead of the real user log folder."""
    path = tmp_path / "audit.log"
    monkeypatch.setenv(audit.AUDIT_LOG_ENV, str(path))
    return path


@pytest.fixture(autouse=True)
def fresh_stop_rate_limit() -> None:
    stop_rate_limiter.reset()


@pytest.fixture(autouse=True)
def fresh_scan_cache() -> None:
    """Each test sees its own scanner, not a scan cached by an earlier test."""
    scan_cache.clear()


@pytest.fixture(autouse=True)
def history_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Keep any history database the app opens out of the real user data folder."""
    path = tmp_path / "history.db"
    monkeypatch.setenv(history.HISTORY_DB_ENV, str(path))
    return path
