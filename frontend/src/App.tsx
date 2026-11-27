import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateAlerts, loadAlertSettings, saveAlertSettings } from './alerts';
import type { AlertKind, AlertSettings, OverLimitCounts, ResourceAlert } from './alerts';
import {
  connectWebSocket,
  disconnectWebSocket,
  fetchHistoryEvents,
  fetchProcesses,
  isWebSocketConnected,
  killProcess,
  stopProcesses,
} from './api';
import { ActivityPanel } from './components/ActivityPanel';
import { BulkStopDialog } from './components/BulkStopDialog';
import {
  AppNavigation,
  DashboardHeader,
  ProcessToolbar,
  SummaryBand,
  WorkspaceHeader,
} from './components/DashboardChrome';
import type { ViewMode } from './components/DashboardChrome';
import { ConfirmStopDialog } from './components/ConfirmStopDialog';
import { DevPortBay } from './components/DevPortBay';
import { PortMap } from './components/PortMap';
import { ProcessTable, isStoppable } from './components/ProcessTable';
import { ProjectCards } from './components/ProjectCards';
import { ResourceAlerts } from './components/ResourceAlerts';
import { buildDevPortSlots, buildRenderGroups, filterProcesses } from './processUtils';
import type { HistoryEvent, ProcessInfo, ProcessListResponse, ProcessSummary, StopResult } from './types';

const EMPTY_SUMMARY: ProcessSummary = {
  process_count: 0,
  total_memory_mb: 0,
  active_ports: [],
};

type StopError = { pid: number; message: string };

const HISTORY_REFRESH_MS = 10_000;
const HISTORY_LIMIT = 15;

type BulkStopState = {
  processes: ProcessInfo[];
  isStopping: boolean;
  error: string | null;
  failures: Map<number, StopResult>;
};

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
  const [wsConnected, setWsConnected] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [compact, setCompact] = useState(false);
  // Rows ticked for a bulk stop, by PID. Holds the process as it was when ticked.
  const [checked, setChecked] = useState<Map<number, ProcessInfo>>(new Map());
  const [bulkStop, setBulkStop] = useState<BulkStopState | null>(null);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(loadAlertSettings);
  const [alerts, setAlerts] = useState<ResourceAlert[]>([]);
  const overLimitCounts = useRef<OverLimitCounts>(new Map());
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  // Initialize WebSocket connection and fetch initial data
  useEffect(() => {
    let ignore = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Connect to WebSocket for real-time updates
    connectWebSocket(
      (newData: ProcessListResponse) => {
        if (!ignore) {
          setData(newData);
          setError(null);
          setIsLoading(false);
          setWsConnected(true);
          if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        }
      },
      (_err: Error) => {
        if (!ignore) {
          // Prefer HTTP polling over surfacing transient WebSocket failures.
          setWsConnected(false);
        }
      },
      () => {
        if (!ignore) {
          setWsConnected(false);
        }
      }
    );

    // Fetch initial data immediately (fallback if WebSocket is slow to connect)
    const fetchInitialData = async () => {
      try {
        const response = await fetchProcesses();
        if (!ignore) {
          setData(response);
          setError(null);
          setIsLoading(false);
        }
      } catch (caught) {
        if (!ignore) {
          setError(caught instanceof Error ? caught.message : 'Unable to load processes');
          setIsLoading(false);
        }
      }
    };

    void fetchInitialData();

    // Poll while WebSocket is disconnected so the UI stays fresh on Windows/local setups.
    pollTimer = setInterval(() => {
      if (!ignore && !isWebSocketConnected()) {
        void fetchProcesses()
          .then((response) => {
            if (!ignore) {
              setData(response);
              setError(null);
              setIsLoading(false);
            }
          })
          .catch((caught) => {
            if (!ignore) {
              setError(caught instanceof Error ? caught.message : 'Unable to load processes');
              setIsLoading(false);
            }
          });
      }
    }, 2000);

    return () => {
      ignore = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
      disconnectWebSocket();
    };
  }, []);

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

  // Each update advances the alert counters, so alerts need a sustained run over the limit.
  useEffect(() => {
    const result = evaluateAlerts(overLimitCounts.current, data.processes, alertSettings);
    overLimitCounts.current = result.counts;
    setAlerts(result.alerts);
  }, [data.processes, alertSettings]);

  // Drop ticked rows whose process has exited (or whose PID now belongs to another process).
  useEffect(() => {
    setChecked((current) => {
      if (current.size === 0) {
        return current;
      }
      const byPid = new Map(data.processes.map((process) => [process.pid, process]));
      const next = new Map<number, ProcessInfo>();
      for (const [pid, process] of current) {
        const latest = byPid.get(pid);
        if (latest && latest.started_at === process.started_at) {
          next.set(pid, latest);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [data.processes]);

  // Refresh the activity list on a timer, and soon after the set of processes changes.
  const processIdentity = useMemo(
    () => data.processes.map((process) => `${process.pid}:${process.started_at}`).sort().join(','),
    [data.processes],
  );
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    const load = () => {
      setNowMs(Date.now());
      fetchHistoryEvents(HISTORY_LIMIT, controller.signal)
        .then((events) => {
          if (!ignore) {
            setHistoryEvents(events);
            setHistoryError(null);
          }
        })
        .catch((caught: Error) => {
          if (!ignore && caught.name !== 'AbortError') {
            setHistoryError(caught.message);
          }
        });
    };
    load();
    const timer = setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      ignore = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [processIdentity]);

  const alertKinds = useMemo(() => {
    const byPid = new Map<number, Set<AlertKind>>();
    for (const alert of alerts) {
      byPid.set(alert.pid, (byPid.get(alert.pid) ?? new Set()).add(alert.kind));
    }
    return byPid;
  }, [alerts]);

  const checkedPids = useMemo(() => new Set(checked.keys()), [checked]);

  const setProcessesChecked = useCallback((processes: ProcessInfo[], isChecked: boolean) => {
    setChecked((current) => {
      const next = new Map(current);
      for (const process of processes) {
        if (isChecked && isStoppable(process)) {
          next.set(process.pid, process);
        } else {
          next.delete(process.pid);
        }
      }
      return next;
    });
  }, []);

  function handleAlertSettingsChange(settings: AlertSettings) {
    saveAlertSettings(settings);
    setAlertSettings(settings);
  }

  async function handleConfirmBulkStop() {
    if (!bulkStop) {
      return;
    }
    const targets = bulkStop.processes;
    setBulkStop({ ...bulkStop, isStopping: true, error: null });
    try {
      const { results } = await stopProcesses(targets.map(({ pid, started_at }) => ({ pid, started_at })));
      const failures = new Map(results.filter((result) => result.status === 'failed').map((result) => [result.pid, result]));
      const stopped = results.filter((result) => result.status === 'requested').map((result) => result.pid);
      setChecked((current) => {
        const next = new Map(current);
        stopped.forEach((pid) => next.delete(pid));
        return next;
      });
      if (failures.size === 0) {
        setBulkStop(null);
      } else {
        // Keep the dialog open on just the ones that failed, with their reasons.
        setBulkStop({
          processes: targets.filter((process) => failures.has(process.pid)),
          isStopping: false,
          error: null,
          failures,
        });
      }
    } catch (caught) {
      setBulkStop({
        ...bulkStop,
        isStopping: false,
        error: caught instanceof Error ? caught.message : 'Unable to stop processes',
      });
    }
  }

  const visibleProcesses = useMemo(() => filterProcesses(data.processes, query), [data.processes, query]);
  const groups = useMemo(() => buildRenderGroups(visibleProcesses), [visibleProcesses]);
  const conflictPorts = useMemo(
    () => new Set((data.port_conflicts ?? []).map((conflict) => conflict.port)),
    [data.port_conflicts],
  );
  const devPortSlots = useMemo(
    () => buildDevPortSlots(data.processes, data.port_conflicts),
    [data.processes, data.port_conflicts],
  );

  const hasData = data.processes.length > 0;
  const isStale = Boolean(error) && hasData;
  
  // Status is live if WebSocket is connected, refreshing if manually refreshing, stale if error
  const statusState = wsConnected ? 'live' : isRefreshing ? 'refreshing' : isStale ? 'stale' : 'live';
  const statusLabel = wsConnected ? 'Live · WebSocket' : isRefreshing ? 'Refreshing' : isStale ? 'Stale data' : 'Live · polling';
  const hostName = data.summary.host_name ?? 'localhost';

  async function handleConfirmStop() {
    if (!selectedProcess) {
      return;
    }

    const target = selectedProcess;
    setIsStopping(true);
    setStopError(null);
    try {
      await killProcess(target.pid, target.started_at);
      setSelectedProcess(null);
      // Data will be updated via WebSocket automatically
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
    <div className={`dashboard-shell${compact ? ' is-compact' : ''}`}>
      <AppNavigation summary={data.summary} isOnline={wsConnected || hasData} />
      <main className="app-shell">
        <section id="overview" className="overview-section">
          <DashboardHeader
            hostName={hostName}
            statusState={statusState}
            statusLabel={statusLabel}
            isRefreshing={isRefreshing}
            compact={compact}
            onToggleCompact={() => setCompact((current) => !current)}
            onRefresh={() => void loadProcesses()}
          />
          <SummaryBand summary={data.summary} isOnline={wsConnected || hasData} />
        </section>
        <DevPortBay
          slots={devPortSlots}
          onStop={(process) => {
            setStopError(null);
            setSelectedProcess(process);
          }}
        />
        <section id="workspace" className="process-section" aria-label="Processes">
          <WorkspaceHeader mode={viewMode} onModeChange={setViewMode} />
          <ProcessToolbar query={query} showing={visibleProcesses.length} total={data.processes.length} onQueryChange={setQuery} />
          <ResourceAlerts alerts={alerts} settings={alertSettings} onSettingsChange={handleAlertSettingsChange} />
          {checked.size > 0 ? (
            <div className="bulk-bar" role="region" aria-label="Selected processes">
              <span>
                <strong>{checked.size}</strong> selected
              </span>
              <button type="button" onClick={() => setChecked(new Map())}>
                Clear
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => setBulkStop({ processes: [...checked.values()], isStopping: false, error: null, failures: new Map() })}
              >
                Stop selected
              </button>
            </div>
          ) : null}
          {error ? <div className="alert">Error: {error}</div> : null}
          {data.port_conflicts && data.port_conflicts.length > 0 ? <div className="conflict-banner" role="status">{data.port_conflicts.map((conflict) => `Port ${conflict.port} claimed by ${conflict.pids.length} processes`).join(' \u00b7 ')}</div> : null}
          {isLoading ? <div className="state">Loading processes...</div> : null}
          {!isLoading && visibleProcesses.length === 0 ? <div className="state">{query ? 'No processes match the current filter.' : 'No development processes detected.'}</div> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'table' ? <ProcessTable groups={groups} conflictPorts={conflictPorts} expandedGroups={expandedGroups} onToggleGroup={toggleGroup} isStale={isStale} selectedPid={selectedProcess?.pid ?? null} stopError={stopError} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} checkedPids={checkedPids} onSetChecked={setProcessesChecked} alertKinds={alertKinds} /> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'cards' ? <ProjectCards groups={groups} isStale={isStale} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'ports' ? <PortMap groups={groups} hostName={hostName} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
        </section>
        <ActivityPanel events={historyEvents} error={historyError} nowMs={nowMs} />
        {bulkStop ? (
          <BulkStopDialog
            processes={bulkStop.processes}
            isStopping={bulkStop.isStopping}
            error={bulkStop.error}
            failures={bulkStop.failures}
            onCancel={() => setBulkStop(null)}
            onConfirm={() => void handleConfirmBulkStop()}
          />
        ) : null}
        {selectedProcess ? <ConfirmStopDialog process={selectedProcess} isStopping={isStopping} error={stopError?.pid === selectedProcess.pid ? stopError.message : null} onCancel={() => setSelectedProcess(null)} onConfirm={() => void handleConfirmStop()} /> : null}
      </main>
    </div>
  );
}

export default App;
