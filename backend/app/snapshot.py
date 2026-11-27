"""One recent process scan, shared by everything that needs one.

The REST endpoint, the WebSocket broadcast and the history recorder all ask
for process data. Without sharing, two open dashboards plus the recorder
would each scan the machine on their own schedule. ``ScanCache.get`` returns
the last scan while it is fresh enough for the caller, and when several
threads ask at once, only one of them scans and the rest reuse its result.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from app import scanner
from app.models import ProcessListResponse

# The dashboard refreshes every 2 seconds, so a scan up to 1 second old is current.
DEFAULT_MAX_AGE_SECONDS = 1.0


class ScanCache:
    def __init__(
        self,
        scan: Callable[[], ProcessListResponse],
        clock: Callable[[], float] = time.monotonic,
    ):
        self._scan = scan
        self._clock = clock
        self._lock = threading.Lock()
        self._value: ProcessListResponse | None = None
        self._taken_at = 0.0

    def get(self, max_age: float = DEFAULT_MAX_AGE_SECONDS) -> ProcessListResponse:
        """Return a scan at most ``max_age`` seconds old, scanning if needed. Blocks; call from a thread."""
        with self._lock:
            if self._value is not None and self._clock() - self._taken_at < max_age:
                return self._value
            # Holding the lock while scanning makes concurrent callers wait for this scan.
            self._value = self._scan()
            self._taken_at = self._clock()
            return self._value

    def clear(self) -> None:
        with self._lock:
            self._value = None


# Look the scanner up at call time so tests can replace scanner.scan_processes.
scan_cache = ScanCache(lambda: scanner.scan_processes())
