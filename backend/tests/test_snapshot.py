"""The shared scan: reused while fresh, and scanned once for concurrent callers."""

import threading
import time

from app.snapshot import ScanCache


def test_reuses_scan_while_fresh() -> None:
    now = [0.0]
    calls = []
    cache = ScanCache(lambda: calls.append(1) or len(calls), clock=lambda: now[0])

    assert cache.get(max_age=1.0) == 1
    now[0] = 0.5
    assert cache.get(max_age=1.0) == 1
    now[0] = 1.0
    assert cache.get(max_age=1.0) == 2


def test_callers_choose_how_stale_is_acceptable() -> None:
    now = [0.0]
    calls = []
    cache = ScanCache(lambda: calls.append(1) or len(calls), clock=lambda: now[0])
    cache.get()
    now[0] = 3.0

    # The history recorder accepts a 5-second-old scan; the dashboard wants a fresh one.
    assert cache.get(max_age=5.0) == 1
    assert cache.get(max_age=1.0) == 2


def test_concurrent_callers_share_one_scan() -> None:
    calls = []

    def slow_scan() -> int:
        calls.append(1)
        time.sleep(0.05)
        return len(calls)

    cache = ScanCache(slow_scan)
    results = []
    threads = [threading.Thread(target=lambda: results.append(cache.get())) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == [1] * 5
    assert len(calls) == 1
