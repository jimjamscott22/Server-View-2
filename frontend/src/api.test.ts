import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectWebSocket, disconnectWebSocket } from './api';

/**
 * Records every socket the client creates. close() fires nothing by itself:
 * real close events arrive later, so each test fires them when it wants them.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
  }

  fireDropped() {
    this.onerror?.({});
    this.onclose?.({ code: 1006, reason: '' });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  disconnectWebSocket();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('process WebSocket', () => {
  test('creates no socket for a connection cancelled right away (StrictMode remount)', () => {
    connectWebSocket(vi.fn());
    disconnectWebSocket();
    connectWebSocket(vi.fn());
    vi.runOnlyPendingTimers();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closeCalls).toBe(0);
  });

  test('ignores late events from a socket that was disconnected', () => {
    connectWebSocket(vi.fn());
    vi.runOnlyPendingTimers();
    const [oldSocket] = FakeWebSocket.instances;
    const onError = vi.fn();
    const onClose = vi.fn();
    connectWebSocket(vi.fn(), onError, onClose);
    vi.runOnlyPendingTimers();

    oldSocket.fireDropped();
    vi.advanceTimersByTime(10_000);

    expect(oldSocket.closeCalls).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test('disconnecting cancels a pending reconnect', () => {
    connectWebSocket(vi.fn());
    vi.runOnlyPendingTimers();
    FakeWebSocket.instances[0].fireDropped();

    disconnectWebSocket();
    vi.advanceTimersByTime(10_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test('still reconnects after an unexpected drop', () => {
    const onClose = vi.fn();
    connectWebSocket(vi.fn(), undefined, onClose);
    vi.runOnlyPendingTimers();

    FakeWebSocket.instances[0].fireDropped();
    vi.advanceTimersByTime(3000);

    expect(onClose).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
