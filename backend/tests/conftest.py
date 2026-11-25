from pathlib import Path

import pytest

from app import audit
from app.security import stop_rate_limiter


@pytest.fixture(autouse=True)
def audit_log(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Send audit entries to a temp file instead of the real user log folder."""
    path = tmp_path / "audit.log"
    monkeypatch.setenv(audit.AUDIT_LOG_ENV, str(path))
    return path


@pytest.fixture(autouse=True)
def fresh_stop_rate_limit() -> None:
    stop_rate_limiter.reset()
