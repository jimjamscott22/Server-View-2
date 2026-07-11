import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchProcesses, killProcess } from './api';
import { buildRenderGroups, filterProcesses, formatUptime } from './processUtils';
import type { RenderGroup } from './processUtils';
import type { ProcessInfo, ProcessListResponse, ProcessSummary } from './types';
import './styles.css';

const EMPTY_SUMMARY: ProcessSummary = {
  process_count: 0,
  total_memory_mb: 0,
  active_ports: [],
};

type Theme = 'light' | 'dark';
type StopError = { pid: number; message: string };
type ThemeStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const THEME_STORAGE_KEY = 'serverview-theme';

function isThemeStorage(value: unknown): value is ThemeStorage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getItem' in value &&
    'setItem' in value &&
    typeof value.getItem === 'function' &&
    typeof value.setItem === 'function'
  );
}

function getThemeStorage(): ThemeStorage | null {
  const storage = window.localStorage;
  return isThemeStorage(storage) ? storage : null;
}

function getInitialTheme(): Theme {
  const stored = getThemeStorage()?.getItem(THEME_STORAGE_KEY);
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

function Ports({ ports, conflictPorts }: { ports: number[]; conflictPorts: Set<number> }) {
  if (ports.length === 0) {
    return <span className="muted">None</span>;
  }

  return (
    <div className="port-list" aria-label="Listening ports">
      {ports.map((port) => {
        const inConflict = conflictPorts.has(port);
        return (
          <span
            className={inConflict ? 'port port-conflict' : 'port'}
            key={port}
            title={inConflict ? 'Claimed by more than one process' : undefined}
          >
            {port}
          </span>
        );
      })}
    </div>
  );
}

function ProcessRow({
  process,
  isChild,
  conflictPorts,
  stopError,
  onStop,
}: {
  process: ProcessInfo;
  isChild: boolean;
  conflictPorts: Set<number>;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
}) {
  const isRestricted = !process.command && !process.cwd;
  const failedStop = stopError?.pid === process.pid ? stopError : null;
  const rowClass = [isChild ? 'row-child' : '', isRestricted ? 'row-restricted' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={rowClass || undefined}>
      <td>
        <div className="process-name">{process.name}</div>
        <div className="process-meta">PID {process.pid}</div>
        <code>{process.command || 'Command unavailable'}</code>
        {isChild ? null : (
          <div className="cwd">{process.cwd ?? 'Working directory unavailable'}</div>
        )}
        {isRestricted ? <span className="tag-restricted">Limited access</span> : null}
      </td>
      <td>
        <Ports ports={process.ports} conflictPorts={conflictPorts} />
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
}

function GroupHeader({
  group,
  expanded,
  hasConflict,
  onToggle,
}: {
  group: RenderGroup;
  expanded: boolean;
  hasConflict: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="group-row">
      <td colSpan={7}>
        <div className="group-head">
          <button
            type="button"
            className="disclosure"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label} helper processes`}
            onClick={onToggle}
          >
            <span className="chevron" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
            <span className="group-label">{group.label}</span>
          </button>
          {group.projectPath ? <span className="group-path">{group.projectPath}</span> : null}
          <div className="group-meta">
            {hasConflict ? <span className="conflict-badge">Port conflict</span> : null}
            <span className="group-stat">{group.processes.length} processes</span>
            <span className="group-stat">{group.totalMemoryMb.toFixed(1)} MB</span>
            {group.helperCount > 0 ? (
              <span className="group-stat group-helpers">
                {expanded
                  ? 'Hide helpers'
                  : `+${group.helperCount} helper${group.helperCount === 1 ? '' : 's'}`}
              </span>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ProcessTable({
  groups,
  conflictPorts,
  expandedGroups,
  onToggleGroup,
  isStale,
  stopError,
  onStop,
}: {
  groups: RenderGroup[];
  conflictPorts: Set<number>;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
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
        {groups.map((group) => {
          const isGrouped = group.processes.length > 1;
          const hasConflict = group.ports.some((port) => conflictPorts.has(port));

          if (!isGrouped) {
            return (
              <tbody key={group.key}>
                <ProcessRow
                  process={group.processes[0]}
                  isChild={false}
                  conflictPorts={conflictPorts}
                  stopError={stopError}
                  onStop={onStop}
                />
              </tbody>
            );
          }

          const expanded = expandedGroups.has(group.key);
          const visible = expanded
            ? group.processes
            : group.processes.slice(0, group.primaryCount);

          return (
            <tbody key={group.key} className="group">
              <GroupHeader
                group={group}
                expanded={expanded}
                hasConflict={hasConflict}
                onToggle={() => onToggleGroup(group.key)}
              />
              {visible.map((process, index) => (
                <ProcessRow
                  key={process.pid}
                  process={process}
                  isChild={index >= group.primaryCount}
                  conflictPorts={conflictPorts}
                  stopError={stopError}
                  onStop={onStop}
                />
              ))}
            </tbody>
          );
        })}
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    getThemeStorage()?.setItem(THEME_STORAGE_KEY, theme);
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
  const groups = useMemo(() => buildRenderGroups(visibleProcesses), [visibleProcesses]);
  const conflictPorts = useMemo(
    () => new Set((data.port_conflicts ?? []).map((conflict) => conflict.port)),
    [data.port_conflicts],
  );

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
      {data.port_conflicts && data.port_conflicts.length > 0 ? (
        <div className="conflict-banner" role="status">
          {data.port_conflicts
            .map(
              (conflict) =>
                `Port ${conflict.port} claimed by ${conflict.pids.length} processes`,
            )
            .join(' · ')}
        </div>
      ) : null}
      {isLoading ? <div className="state">Loading processes...</div> : null}
      {!isLoading && visibleProcesses.length === 0 ? (
        <div className="state">
          {query ? 'No processes match the current filter.' : 'No development processes detected.'}
        </div>
      ) : null}
      {!isLoading && visibleProcesses.length > 0 ? (
        <ProcessTable
          groups={groups}
          conflictPorts={conflictPorts}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
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
