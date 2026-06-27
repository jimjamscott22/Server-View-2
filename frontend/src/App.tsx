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
  onStop,
}: {
  processes: ProcessInfo[];
  onStop: (process: ProcessInfo) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th>Ports</th>
            <th>CPU</th>
            <th>Memory</th>
            <th>Uptime</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr key={process.pid}>
              <td>
                <div className="process-name">{process.name}</div>
                <div className="process-meta">PID {process.pid}</div>
                <code>{process.command || 'Command unavailable'}</code>
                <div className="cwd">{process.cwd ?? 'Working directory unavailable'}</div>
              </td>
              <td>
                <Ports ports={process.ports} />
              </td>
              <td>{process.cpu_usage.toFixed(1)}%</td>
              <td>{process.memory_mb.toFixed(1)} MB</td>
              <td>{formatUptime(process.uptime_seconds)}</td>
              <td>
                <span className="status">{process.status}</span>
              </td>
              <td>
                <button className="danger" type="button" onClick={() => onStop(process)}>
                  Stop
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmStopDialog({
  process,
  isStopping,
  onCancel,
  onConfirm,
}: {
  process: ProcessInfo;
  isStopping: boolean;
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

  async function handleConfirmStop() {
    if (!selectedProcess) {
      return;
    }

    setIsStopping(true);
    try {
      await killProcess(selectedProcess.pid);
      setSelectedProcess(null);
      await loadProcesses(undefined, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to stop process');
    } finally {
      setIsStopping(false);
    }
  }

  return (
    <main className="app-shell">
      <header>
        <div>
          <h1>Server-View</h1>
          <p>Local development processes and listening ports.</p>
        </div>
        <button type="button" onClick={() => void loadProcesses()} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
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
        <ProcessTable processes={visibleProcesses} onStop={setSelectedProcess} />
      ) : null}

      {selectedProcess ? (
        <ConfirmStopDialog
          process={selectedProcess}
          isStopping={isStopping}
          onCancel={() => setSelectedProcess(null)}
          onConfirm={() => void handleConfirmStop()}
        />
      ) : null}
    </main>
  );
}

export default App;
