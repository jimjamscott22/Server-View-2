import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchProcesses, killProcess } from './api';
import { filterProcesses, formatUptime } from './processUtils';
import type { ProcessInfo, ProcessListResponse, ProcessSummary } from './types';
import './styles.css';

const EMPTY_SUMMARY: ProcessSummary = {
  process_count: 0,
  total_memory_mb: 0,
  active_ports: [],
};

type Theme = 'light' | 'dark';
type StopError = { pid: number; message: string };

function getInitialTheme(): Theme {
  const stored = window.localStorage?.getItem('serverview-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  return prefersDark?.matches ? 'dark' : 'light';
}

function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (value.includes('run')) {
    return 'status status-ok';
  }
  if (['zombie', 'dead', 'stopped'].some((flag) => value.includes(flag))) {
    return 'status status-bad';
  }
  return 'status';
}

function Summary({ summary }: { summary: ProcessSummary }) {
  return (
    <section className="summary-grid" aria-label="Process summary">
      <div className="metric">
        <span className="metric-label">Processes</span>
        <strong>{summary.process_count}</strong>
      </div>
      <div className="metric">
        <span className="metric-label">Memory</span>
        <strong>{summary.total_memory_mb.toFixed(1)} MB</strong>
      </div>
      <div className="metric">
        <span className="metric-label">Listening ports</span>
        <strong>{summary.active_ports.length}</strong>
      </div>
    </section>
  );
}

function Ports({ ports }: { ports: number[] }) {
  if (ports.length === 0) {
    return <span className="muted">None</span>;
  }

  return (
    <div className="port-list" aria-label="Listening ports">
      {ports.map((port) => (
        <span className="port" key={port}>
          {port}
        </span>
      ))}
    </div>
  );
}

function ProcessTable({
  processes,
  isStale,
  stopError,
  onStop,
}: {
  processes: ProcessInfo[];
  isStale: boolean;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
}) {
  return (
    <div className={`table-wrap${isStale ? ' is-stale' : ''}`}>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th className="col-ports">Ports</th>
            <th className="col-cpu">CPU</th>
            <th className="col-mem">Memory</th>
            <th className="col-uptime">Uptime</th>
            <th className="col-status">Status</th>
            <th className="col-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => {
            const isRestricted = !process.command && !process.cwd;
            const failedStop = stopError?.pid === process.pid ? stopError : null;
            return (
              <tr key={process.pid} className={isRestricted ? 'row-restricted' : undefined}>
                <td>
                  <div className="process-name">{process.name}</div>
                  <div className="process-meta">PID {process.pid}</div>
                  <code>{process.command || 'Command unavailable'}</code>
                  <div className="cwd">{process.cwd ?? 'Working directory unavailable'}</div>
                  {isRestricted ? <span className="tag-restricted">Limited access</span> : null}
                </td>
                <td>
                  <Ports ports={process.ports} />
                </td>
                <td className="num">{process.cpu_usage.toFixed(1)}%</td>
                <td className="num">{process.memory_mb.toFixed(1)} MB</td>
                <td className="num">{formatUptime(process.uptime_seconds)}</td>
                <td>
                  <span className={statusClass(process.status)}>{process.status}</span>
                </td>
                <td>
                  <button className="danger" type="button" onClick={() => onStop(process)}>
                    Stop
                  </button>
                  {failedStop ? <div className="stop-error">{failedStop.message}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmStopDialog({
  process,
  isStopping,
  error,
  onCancel,
  onConfirm,
}: {
  process: ProcessInfo;
  isStopping: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="stop-title">
        <h2 id="stop-title">Stop process?</h2>
        <p>
          Send <strong>SIGTERM</strong> to <strong>{process.name}</strong> with PID {process.pid}.
        </p>
        {error ? (
          <p className="dialog-error" role="alert">
            Couldn’t stop the process: {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={isStopping}>
            Cancel
          </button>
          <button className="danger" type="button" onClick={onConfirm} disabled={isStopping}>
            {isStopping ? 'Stopping...' : 'Send SIGTERM'}
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [data, setData] = useState<ProcessListResponse>({ processes: [], summary: EMPTY_SUMMARY });
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<StopError | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage?.setItem('serverview-theme', theme);
  }, [theme]);

  const loadProcesses = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) {
      setIsRefreshing(true);
    }

    try {
      const response = await fetchProcesses(signal);
      setData(response);
      setError(null);
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Unable to load processes');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;

    async function poll(quiet = false) {
      if (!ignore) {
        await loadProcesses(controller.signal, quiet);
      }
    }

    void poll(true);
    const intervalId = window.setInterval(() => {
      void poll(true);
    }, 2000);

    return () => {
      ignore = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [loadProcesses]);

  const visibleProcesses = useMemo(() => filterProcesses(data.processes, query), [data.processes, query]);

  const hasData = data.processes.length > 0;
  const isStale = Boolean(error) && hasData;
  const statusState = isStale ? 'stale' : isRefreshing ? 'refreshing' : 'live';
  const statusLabel = isStale ? 'Stale data' : isRefreshing ? 'Refreshing' : 'Live';

  async function handleConfirmStop() {
    if (!selectedProcess) {
      return;
    }

    const target = selectedProcess;
    setIsStopping(true);
    setStopError(null);
    try {
      await killProcess(target.pid);
      setSelectedProcess(null);
      await loadProcesses(undefined, true);
    } catch (caught) {
      setStopError({
        pid: target.pid,
        message: caught instanceof Error ? caught.message : 'Unable to stop process',
      });
    } finally {
      setIsStopping(false);
    }
  }

  return (
    <main className="app-shell">
      <header>
        <div className="header-titles">
          <h1>Server-View</h1>
          <p>Local development processes and listening ports.</p>
        </div>
        <div className="header-controls">
          <span className="status-pill" data-state={statusState} role="status" aria-live="polite">
            {statusLabel}
          </span>
          <button
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button type="button" onClick={() => void loadProcesses()} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <Summary summary={data.summary} />

      <section className="toolbar" aria-label="Process controls">
        <label htmlFor="process-search">Search</label>
        <input
          id="process-search"
          type="search"
          placeholder="Name, command, cwd, port, or PID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      {error ? <div className="alert">Error: {error}</div> : null}
      {isLoading ? <div className="state">Loading processes...</div> : null}
      {!isLoading && visibleProcesses.length === 0 ? (
        <div className="state">
          {query ? 'No processes match the current filter.' : 'No development processes detected.'}
        </div>
      ) : null}
      {!isLoading && visibleProcesses.length > 0 ? (
        <ProcessTable
          processes={visibleProcesses}
          isStale={isStale}
          stopError={stopError}
          onStop={(process) => {
            setStopError(null);
            setSelectedProcess(process);
          }}
        />
      ) : null}

      {selectedProcess ? (
        <ConfirmStopDialog
          process={selectedProcess}
          isStopping={isStopping}
          error={stopError?.pid === selectedProcess.pid ? stopError.message : null}
          onCancel={() => setSelectedProcess(null)}
          onConfirm={() => void handleConfirmStop()}
        />
      ) : null}
    </main>
  );
}

export default App;
