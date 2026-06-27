import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import type { ProcessListResponse } from './types';

const emptyResponse: ProcessListResponse = {
  processes: [],
  summary: {
    process_count: 0,
    total_memory_mb: 0,
    active_ports: [],
  },
};

const populatedResponse: ProcessListResponse = {
  processes: [
    {
      pid: 101,
      name: 'node',
      command: 'npm run dev',
      cwd: '/workspace/frontend',
      ports: [5173],
      cpu_usage: 1.2,
      memory_mb: 128.4,
      uptime_seconds: 65,
      status: 'running',
    },
    {
      pid: 202,
      name: 'python',
      command: 'uvicorn app.main:app',
      cwd: '/workspace/backend',
      ports: [8000],
      cpu_usage: 0.5,
      memory_mb: 84.2,
      uptime_seconds: 5,
      status: 'sleeping',
    },
  ],
  summary: {
    process_count: 2,
    total_memory_mb: 212.6,
    active_ports: [5173, 8000],
  },
};

function mockFetch(response: ProcessListResponse | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }

    return {
      ok: true,
      json: async () => response,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App', () => {
  test('renders loading and then empty state', async () => {
    mockFetch(emptyResponse);

    render(<App />);

    expect(screen.getByText('Loading processes...')).toBeInTheDocument();
    expect(await screen.findByText('No development processes detected.')).toBeInTheDocument();
  });

  test('renders API errors', async () => {
    mockFetch(new Error('Backend unavailable'));

    render(<App />);

    expect(await screen.findByText('Error: Backend unavailable')).toBeInTheDocument();
  });

  test('renders populated table and filters by port and cwd', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);

    expect(await screen.findByText('npm run dev')).toBeInTheDocument();
    expect(screen.getByText('uvicorn app.main:app')).toBeInTheDocument();
    expect(screen.getByText('212.6 MB')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'uvicorn');

    expect(screen.queryByText('npm run dev')).not.toBeInTheDocument();
    expect(screen.getByText('uvicorn app.main:app')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), 'frontend');

    expect(screen.getByText('npm run dev')).toBeInTheDocument();
    expect(screen.queryByText('uvicorn app.main:app')).not.toBeInTheDocument();
  });

  test('opens confirmation before stop and calls kill only after confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => populatedResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pid: 101, signal: 'SIGTERM', status: 'requested', message: 'sent' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => emptyResponse,
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const row = await screen.findByText('npm run dev');
    await user.click(within(row.closest('tr') as HTMLElement).getByRole('button', { name: 'Stop' }));

    expect(screen.getByRole('dialog', { name: 'Stop process?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Send SIGTERM' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/processes/101/kill', { method: 'POST' });
    });
  });

  test('polls every two seconds and cleans up interval on unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(emptyResponse);

    const { unmount } = render(<App />);
    await vi.runOnlyPendingTimersAsync();
    expect(screen.getByText('No development processes detected.')).toBeInTheDocument();
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterInitialLoad + 1);

    unmount();
    const callsBeforeUnmountTick = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmountTick);
  });
});
