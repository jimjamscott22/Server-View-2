import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
      started_at: 1700000000.25,
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
      started_at: 1700000060.5,
    },
  ],
  summary: {
    process_count: 2,
    total_memory_mb: 212.6,
    active_ports: [5173, 8000],
  },
};

const dockerAndDatabaseResponse: ProcessListResponse = {
  processes: [
    {
      pid: 301,
      name: 'docker-proxy',
      command: '/usr/bin/docker-proxy -proto tcp -host-port 8080 -container-port 80',
      cwd: null,
      ports: [8080],
      cpu_usage: 0,
      memory_mb: 4.1,
      uptime_seconds: 120,
      status: 'sleeping',
      started_at: 1700000100,
      category: 'docker',
    },
    {
      pid: 302,
      name: 'postgres',
      command: '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main',
      cwd: '/var/lib/postgresql/16/main',
      ports: [5432],
      cpu_usage: 0.1,
      memory_mb: 30.5,
      uptime_seconds: 600,
      status: 'sleeping',
      started_at: 1700000200,
      category: 'database',
    },
  ],
  summary: {
    process_count: 2,
    total_memory_mb: 34.6,
    active_ports: [5432, 8080],
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

/**
 * Answer the activity panel's history requests with an empty list and pass
 * every other request to `processFetch`, so tests can count and order those.
 */
function stubFetchExceptHistory<T extends (url: string, init?: RequestInit) => unknown>(processFetch: T): T {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url.startsWith('/api/history')
      ? Promise.resolve({ ok: true, json: async () => ({ events: [] }) } as Response)
      : processFetch(url, init),
  );
  return processFetch;
}

/** Keep tests on the HTTP polling path; a real WebSocket overwrites fetch errors. */
class SilentWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = SilentWebSocket.CLOSED;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(_url: string) {}
  close() {}
  send(_data: string) {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', SilentWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App', () => {
  test('renders functional navigation and toggles compact density', async () => {
    const user = userEvent.setup();
    mockFetch(emptyResponse);

    render(<App />);
    await screen.findByText('No development processes detected.');

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#overview');
    expect(screen.getByRole('link', { name: 'Dev ports' })).toHaveAttribute('href', '#dev-ports');
    expect(screen.getByRole('link', { name: 'Processes' })).toHaveAttribute('href', '#workspace');

    expect(screen.getByRole('heading', { name: 'Common dev ports' })).toBeInTheDocument();
    const portBay = screen.getByRole('region', { name: 'Common development ports' });
    expect(within(portBay).getByText('0')).toBeInTheDocument();
    expect(within(portBay).getByText(/of 4 claimed/i)).toBeInTheDocument();
    expect(within(portBay).getAllByText('available')).toHaveLength(4);
    const compactButton = screen.getByRole('button', { name: 'Compact' });
    await user.click(compactButton);

    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.dashboard-shell')).toHaveClass('is-compact');
  });

  test('switches between grouped table, project cards, and port map', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);
    expect(await screen.findByText('npm run dev')).toBeInTheDocument();

    const portBay = screen.getByRole('region', { name: 'Common development ports' });
    expect(within(portBay).getByText('2')).toBeInTheDocument();
    expect(within(portBay).getByRole('button', { name: /TCP 5173 node/i })).toBeInTheDocument();
    expect(within(portBay).getByRole('button', { name: /TCP 8000 python/i })).toBeInTheDocument();
    expect(within(portBay).getAllByText('available')).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: 'Project cards' }));
    expect(screen.getByRole('heading', { name: 'See services in their project context' })).toBeInTheDocument();
    expect(screen.getByText('/workspace/frontend')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Port map' }));
    expect(screen.getByRole('heading', { name: 'Follow ports back to their owners' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5173 frontend node/i })).toBeInTheDocument();
  });

  test('opens stop confirmation from an occupied port bay slot', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);
    expect(await screen.findByText('npm run dev')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /TCP 5173 node/i }));
    const dialog = screen.getByRole('dialog', { name: 'Stop process?' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/PID 101/i)).toBeInTheDocument();
  });

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

  test('keeps prior rows visible and marks them stale after a refresh error', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => populatedResponse,
      } as Response)
      .mockRejectedValueOnce(new Error('Backend unavailable'));
    stubFetchExceptHistory(fetchMock);

    render(<App />);

    const process = await screen.findByText('npm run dev');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Error: Backend unavailable')).toBeInTheDocument();
    expect(process).toBeInTheDocument();
    expect(screen.getByText('Stale data')).toHaveAttribute('data-state', 'stale');
    expect(process.closest('.table-wrap')).toHaveClass('is-stale');
  });

  test('renders populated table and filters by port and cwd', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);

    expect(await screen.findByText('npm run dev')).toBeInTheDocument();
    expect(screen.getByText('uvicorn app.main:app')).toBeInTheDocument();
    expect(screen.getByText('212.6 MB')).toBeInTheDocument();

    const processRow = screen.getByText('npm run dev').closest('tr') as HTMLElement;
    expect(within(processRow).getByText('npm run dev').closest('td')).toHaveClass('process-cell');
    expect(within(processRow).getByText('5173').closest('td')).toHaveClass('ports-cell');
    expect(within(processRow).getByText('1.2%').closest('td')).toHaveClass('cpu-cell');
    expect(within(processRow).getByText('128.4 MB').closest('td')).toHaveClass('memory-cell');
    expect(within(processRow).getByText('1m 5s').closest('td')).toHaveClass('uptime-cell');
    expect(within(processRow).getByText('running').closest('td')).toHaveClass('status-cell');
    expect(within(processRow).getByRole('button', { name: 'Stop' }).closest('td')).toHaveClass('action-cell');

    await user.type(screen.getByLabelText('Search'), 'uvicorn');

    expect(screen.queryByText('npm run dev')).not.toBeInTheDocument();
    expect(screen.getByText('uvicorn app.main:app')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), 'frontend');

    expect(screen.getByText('npm run dev')).toBeInTheDocument();
    expect(screen.queryByText('uvicorn app.main:app')).not.toBeInTheDocument();
  });

  test('groups processes by project, collapses helpers, and flags port conflicts', async () => {
    const user = userEvent.setup();
    const groupedResponse: ProcessListResponse = {
      processes: [
        {
          pid: 101,
          name: 'node',
          command: 'npm run dev',
          cwd: '/work/app',
          ports: [3000],
          cpu_usage: 1.2,
          memory_mb: 128,
          uptime_seconds: 60,
          status: 'running',
          started_at: 1700000000,
          group_key: '/work/app',
          is_primary: true,
        },
        {
          pid: 102,
          name: 'node',
          command: 'node esbuild-service',
          cwd: '/work/app',
          ports: [],
          cpu_usage: 0.1,
          memory_mb: 12,
          uptime_seconds: 60,
          status: 'running',
          started_at: 1700000000,
          group_key: '/work/app',
          is_primary: false,
        },
      ],
      groups: [],
      port_conflicts: [{ port: 3000, pids: [101, 999] }],
      summary: { process_count: 2, total_memory_mb: 140, active_ports: [3000] },
    };
    mockFetch(groupedResponse);

    render(<App />);

    // Conflict surfaces in the banner and a group badge.
    expect(await screen.findByText('Port 3000 claimed by 2 processes')).toBeInTheDocument();
    expect(screen.getByText('Port conflict')).toBeInTheDocument();

    // Primary command shows; the helper is collapsed by default.
    expect(screen.getByText('npm run dev')).toBeInTheDocument();
    expect(screen.queryByText('node esbuild-service')).not.toBeInTheDocument();

    // Expanding the group reveals the helper.
    await user.click(screen.getByRole('button', { name: /Expand app helper processes/i }));
    expect(screen.getByText('node esbuild-service')).toBeInTheDocument();
  });

  test('labels database and Docker processes and only offers Stop for the database', async () => {
    mockFetch(dockerAndDatabaseResponse);

    render(<App />);

    const proxyRow = (await screen.findByText(/docker-proxy -proto tcp/)).closest('tr') as HTMLElement;
    expect(within(proxyRow).getByText('Docker')).toBeInTheDocument();
    expect(within(proxyRow).getByText('Managed by Docker')).toBeInTheDocument();
    expect(within(proxyRow).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    const dbRow = screen.getByText(/postgresql\/16\/bin\/postgres/).closest('tr') as HTMLElement;
    expect(within(dbRow).getByText('Database')).toBeInTheDocument();
    expect(within(dbRow).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  test('explains docker stop instead of offering to stop a Docker port owner', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(dockerAndDatabaseResponse);

    render(<App />);
    await screen.findByText(/docker-proxy -proto tcp/);

    await user.click(screen.getByRole('tab', { name: 'Port map' }));
    await user.click(screen.getByRole('button', { name: /8080 .*docker-proxy/i }));

    const dialog = screen.getByRole('dialog', { name: 'Managed by Docker' });
    expect(within(dialog).getByText('docker stop')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Stop process' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/kill'), expect.anything());
  });

  test('warns before stopping a database server', async () => {
    const user = userEvent.setup();
    mockFetch(dockerAndDatabaseResponse);

    render(<App />);
    const dbRow = (await screen.findByText(/postgresql\/16\/bin\/postgres/)).closest('tr') as HTMLElement;
    await user.click(within(dbRow).getByRole('button', { name: 'Stop' }));

    const dialog = screen.getByRole('dialog', { name: 'Stop process?' });
    expect(within(dialog).getByText(/This is a database server/)).toBeInTheDocument();
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
        json: async () => ({ pid: 101, signal: 'terminate', status: 'requested', message: 'sent' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => emptyResponse,
      } as Response);
    stubFetchExceptHistory(fetchMock);

    render(<App />);

    const row = await screen.findByText('npm run dev');
    await user.click(within(row.closest('tr') as HTMLElement).getByRole('button', { name: 'Stop' }));

    expect(screen.getByRole('dialog', { name: 'Stop process?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Stop process' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/processes/101/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ started_at: 1700000000.25 }),
      });
    });
  });

  test('marks the process row selected while its stop dialog is open', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);

    const processRow = (await screen.findByText('npm run dev')).closest('tr') as HTMLElement;
    expect(processRow).not.toHaveClass('row-selected');

    await user.click(within(processRow).getByRole('button', { name: 'Stop' }));

    expect(processRow).toHaveClass('row-selected');
    expect(screen.getByRole('dialog', { name: 'Stop process?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Stop process?' })).not.toBeInTheDocument();
    expect(processRow).not.toHaveClass('row-selected');
  });

  test('focuses Cancel when the stop dialog opens and returns focus to Stop when it closes', async () => {
    const user = userEvent.setup();
    mockFetch(populatedResponse);

    render(<App />);

    const processRow = (await screen.findByText('npm run dev')).closest('tr') as HTMLElement;
    const stopButton = within(processRow).getByRole('button', { name: 'Stop' });
    await user.click(stopButton);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(stopButton).toHaveFocus();
  });

  test('closes the stop dialog on Escape without stopping the process', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(populatedResponse);

    render(<App />);

    const processRow = (await screen.findByText('npm run dev')).closest('tr') as HTMLElement;
    await user.click(within(processRow).getByRole('button', { name: 'Stop' }));
    const dialog = screen.getByRole('dialog', { name: 'Stop process?' });

    // Browsers turn Escape on a modal <dialog> into a cancelable `cancel` event; jsdom doesn't.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(screen.queryByRole('dialog', { name: 'Stop process?' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/kill'), expect.anything());
  });

  test('polls every two seconds and cleans up interval on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockFetch(emptyResponse);

    const { unmount } = render(<App />);
    expect(await screen.findByText('No development processes detected.')).toBeInTheDocument();
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterInitialLoad);

    unmount();
    const callsBeforeUnmountTick = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmountTick);
  });

  describe('bulk stop', () => {
    function routes(stopResponse: unknown | Error = { results: [] }) {
      const calls: Array<{ url: string; body?: unknown }> = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url === '/api/processes/stop') {
          if (stopResponse instanceof Error) {
            return { ok: false, statusText: 'Too Many Requests', json: async () => ({ detail: stopResponse.message }) } as Response;
          }
          return { ok: true, json: async () => stopResponse } as Response;
        }
        if (url.startsWith('/api/history')) {
          return { ok: true, json: async () => ({ events: [] }) } as Response;
        }
        return { ok: true, json: async () => populatedResponse } as Response;
      });
      return calls;
    }

    test('stops every ticked process in one request', async () => {
      const user = userEvent.setup();
      const calls = routes({
        results: [
          { pid: 101, status: 'requested', http_status: 200, message: 'ok' },
          { pid: 202, status: 'requested', http_status: 200, message: 'ok' },
        ],
      });
      render(<App />);
      await screen.findByText('npm run dev');

      await user.click(screen.getByRole('checkbox', { name: 'Select node (PID 101)' }));
      await user.click(screen.getByRole('checkbox', { name: 'Select python (PID 202)' }));
      const bar = screen.getByRole('region', { name: 'Selected processes' });
      expect(within(bar).getByText('2')).toBeInTheDocument();

      await user.click(within(bar).getByRole('button', { name: 'Stop selected' }));
      const dialog = screen.getByRole('dialog', { name: 'Stop 2 processes?' });
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      expect(calls.some((call) => call.url === '/api/processes/stop')).toBe(false);

      await user.click(within(dialog).getByRole('button', { name: 'Stop 2 processes' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(calls.find((call) => call.url === '/api/processes/stop')?.body).toEqual({
        targets: [
          { pid: 101, started_at: 1700000000.25 },
          { pid: 202, started_at: 1700000060.5 },
        ],
      });
      expect(screen.queryByRole('region', { name: 'Selected processes' })).not.toBeInTheDocument();
    });

    test('keeps failed processes in the dialog with their reasons', async () => {
      const user = userEvent.setup();
      routes({
        results: [
          { pid: 101, status: 'requested', http_status: 200, message: 'ok' },
          { pid: 202, status: 'failed', http_status: 403, message: 'Process 202 belongs to another user.' },
        ],
      });
      render(<App />);
      await screen.findByText('npm run dev');

      await user.click(screen.getByRole('checkbox', { name: 'Select all shown processes' }));
      await user.click(screen.getByRole('button', { name: 'Stop selected' }));
      await user.click(screen.getByRole('button', { name: 'Stop 2 processes' }));

      const dialog = await screen.findByRole('dialog', { name: '1 process didn’t stop' });
      expect(within(dialog).getByText('Process 202 belongs to another user.')).toBeInTheDocument();
      expect(within(dialog).queryByText('PID 101')).not.toBeInTheDocument();
      // The stopped one is unticked; the failed one stays ticked for another try.
      expect(screen.getByRole('checkbox', { name: 'Select node (PID 101)' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Select python (PID 202)' })).toBeChecked();
    });

    test('shows a request-level error such as the rate limit', async () => {
      const user = userEvent.setup();
      routes(new Error('Too many stop requests. Try again in 4 seconds.'));
      render(<App />);
      await screen.findByText('npm run dev');

      await user.click(screen.getByRole('checkbox', { name: 'Select node (PID 101)' }));
      await user.click(screen.getByRole('button', { name: 'Stop selected' }));
      await user.click(screen.getByRole('button', { name: 'Stop 1 process' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many stop requests. Try again in 4 seconds.');
    });

    function manyProcesses(count: number): ProcessListResponse {
      const processes = Array.from({ length: count }, (_, i) => ({
        pid: 1000 + i,
        name: 'node',
        command: `npx vite --port ${4000 + i}`,
        cwd: `/work/app-${i}`,
        ports: [4000 + i],
        cpu_usage: 0,
        memory_mb: 10,
        uptime_seconds: 5,
        status: 'running',
        started_at: 1700000000 + i,
      }));
      return { processes, summary: { process_count: count, total_memory_mb: count * 10, active_ports: [] } };
    }

    function batchRoutes(response: ProcessListResponse, failBatch?: number) {
      const batches: number[][] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url === '/api/processes/stop') {
          const pids = (JSON.parse(String(init?.body)) as { targets: { pid: number }[] }).targets.map((t) => t.pid);
          batches.push(pids);
          if (batches.length === failBatch) {
            return { ok: false, statusText: 'Too Many Requests', json: async () => ({ detail: 'Too many stop requests. Try again in 3 seconds.' }) } as Response;
          }
          return { ok: true, json: async () => ({ results: pids.map((pid) => ({ pid, status: 'requested', http_status: 200, message: 'ok' })) }) } as Response;
        }
        if (url.startsWith('/api/history')) {
          return { ok: true, json: async () => ({ events: [] }) } as Response;
        }
        return { ok: true, json: async () => response } as Response;
      });
      return batches;
    }

    test('splits selections larger than the API limit into batches of 25', async () => {
      const user = userEvent.setup();
      const batches = batchRoutes(manyProcesses(30));
      render(<App />);
      await screen.findByText('npx vite --port 4000');

      await user.click(screen.getByRole('checkbox', { name: 'Select all shown processes' }));
      await user.click(screen.getByRole('button', { name: 'Stop selected' }));
      await user.click(screen.getByRole('button', { name: 'Stop 30 processes' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(batches.map((batch) => batch.length)).toEqual([25, 5]);
      expect(new Set(batches.flat()).size).toBe(30);
    });

    test('reports the processes of a rejected batch as failed and keeps them for a retry', async () => {
      const user = userEvent.setup();
      batchRoutes(manyProcesses(30), 2);
      render(<App />);
      await screen.findByText('npx vite --port 4000');

      await user.click(screen.getByRole('checkbox', { name: 'Select all shown processes' }));
      await user.click(screen.getByRole('button', { name: 'Stop selected' }));
      await user.click(screen.getByRole('button', { name: 'Stop 30 processes' }));

      const dialog = await screen.findByRole('dialog', { name: '5 processes didn’t stop' });
      expect(within(dialog).getAllByText('Too many stop requests. Try again in 3 seconds.')).toHaveLength(5);
      expect(within(screen.getByRole('region', { name: 'Selected processes' })).getByText('5')).toBeInTheDocument();
    });

    test('select all skips Docker port owners', async () => {
      const user = userEvent.setup();
      mockFetch(dockerAndDatabaseResponse);
      render(<App />);
      await screen.findByText('postgres');

      expect(screen.queryByRole('checkbox', { name: /docker-proxy/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'Select all shown processes' }));

      expect(screen.getByRole('checkbox', { name: 'Select postgres (PID 302)' })).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Stop selected' }));
      const dialog = screen.getByRole('dialog', { name: 'Stop 1 process?' });
      expect(within(dialog).getByText(/database server/)).toBeInTheDocument();
    });
  });

  describe('resource alerts', () => {
    afterEach(() => window.localStorage.clear());

    test('flags a process over the limit and highlights its row', async () => {
      window.localStorage.setItem(
        'server-view.alert-settings',
        JSON.stringify({ enabled: true, cpuPercent: 1, memoryMb: 100000, sustainSeconds: 0 }),
      );
      mockFetch(populatedResponse);
      render(<App />);

      expect(await screen.findByText('node (PID 101) is using 1% CPU (limit 1%)')).toBeInTheDocument();
      expect(screen.queryByText(/python \(PID 202\)/)).not.toBeInTheDocument();
      const row = screen.getByText('npm run dev').closest('tr') as HTMLElement;
      expect(row).toHaveClass('row-alert');
      expect(row.querySelector('.cpu-cell')).toHaveClass('is-over-limit');
    });

    test('restarts alert timers when the limits change', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      window.localStorage.setItem(
        'server-view.alert-settings',
        JSON.stringify({ enabled: true, cpuPercent: 100000, memoryMb: 100, sustainSeconds: 6 }),
      );
      // node (PID 101) uses 128.4 MB on every poll. A fresh copy each time, as real fetch returns.
      vi.stubGlobal('fetch', async (url: string) => ({
        ok: true,
        json: async () => (url.startsWith('/api/history') ? { events: [] } : structuredClone(populatedResponse)),
      }));
      render(<App />);
      await screen.findByText('npm run dev');

      // Over the 100 MB limit for 8 s of polls: it alerts.
      await vi.advanceTimersByTimeAsync(8000);
      expect(await screen.findByText(/node \(PID 101\) is using 128 MB/)).toBeInTheDocument();

      // Raise the limit to 120 MB, which it is still over: the old timer must not carry over.
      fireEvent.click(screen.getByRole('button', { name: 'Alert settings' }));
      fireEvent.change(screen.getByLabelText('Memory above (MB)'), { target: { value: '120' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText('Alerts at 100000% CPU or 120 MB for 6s')).toBeInTheDocument();
      expect(screen.queryByText(/node \(PID 101\) is using/)).not.toBeInTheDocument();

      // Six more seconds over the new limit and it alerts again.
      await vi.advanceTimersByTimeAsync(8000);
      expect(await screen.findByText(/node \(PID 101\) is using 128 MB of memory \(limit 120 MB\)/)).toBeInTheDocument();
    });

    test('saves edited limits', async () => {
      const user = userEvent.setup();
      mockFetch(emptyResponse);
      render(<App />);
      await screen.findByText('No development processes detected.');

      await user.click(screen.getByRole('button', { name: 'Alert settings' }));
      const form = screen.getByRole('form', { name: 'Alert settings' });
      const cpu = within(form).getByLabelText('CPU above (%)');
      await user.clear(cpu);
      await user.type(cpu, '150');
      await user.click(within(form).getByRole('button', { name: 'Save' }));

      expect(screen.getByText('Alerts at 150% CPU or 1024 MB for 6s')).toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem('server-view.alert-settings') ?? '{}')).toMatchObject({ cpuPercent: 150 });
    });
  });

  test('lists recent starts and stops from the agent history', async () => {
    const now = Date.now() / 1000;
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/history/events')
          ? {
              events: [
                { time: now - 120, kind: 'stopped', pid: 9, started_at: now - 600, name: 'vite', command: 'npx vite', cwd: '/work/shop', ports: [5173], category: 'app' },
                { time: now - 600, kind: 'started', pid: 9, started_at: now - 600, name: 'vite', command: 'npx vite', cwd: '/work/shop', ports: [5173], category: 'app' },
              ],
            }
          : emptyResponse,
    }));

    render(<App />);

    const panel = screen.getByRole('region', { name: 'Recent activity' });
    const items = await within(panel).findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('vite stopped on :5173 · shop');
    expect(items[0]).toHaveTextContent('2 min ago');
    expect(items[1]).toHaveTextContent('vite started on :5173');
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '#activity');
  });

  test('explains when history is unavailable', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.startsWith('/api/history')
        ? ({ ok: false, statusText: 'Service Unavailable', json: async () => ({ detail: 'Process history is unavailable.' }) } as Response)
        : ({ ok: true, json: async () => emptyResponse } as Response),
    );

    render(<App />);

    expect(await screen.findByText('History unavailable: Process history is unavailable.')).toBeInTheDocument();
  });
});
