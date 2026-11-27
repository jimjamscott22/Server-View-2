"""Per-user folders where the agent keeps its files."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def log_dir() -> Path:
    """Where logs go: the platform's per-user log folder."""
    home = Path.home()
    if sys.platform == "win32":
        return _local_app_data() / "Server-View" / "Logs"
    if sys.platform == "darwin":
        return home / "Library" / "Logs" / "Server-View"
    return _xdg_state_home() / "server-view"


def data_dir() -> Path:
    """Where data the agent builds up over time goes (the history database)."""
    home = Path.home()
    if sys.platform == "win32":
        return _local_app_data() / "Server-View"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Server-View"
    return _xdg_state_home() / "server-view"


def _local_app_data() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")


def _xdg_state_home() -> Path:
    return Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
