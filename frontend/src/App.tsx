import { useCallback, useEffect, useMemo, useState } from 'react';
import { connectWebSocket, disconnectWebSocket, fetchProcesses, isWebSocketConnected, killProcess } from './api';
import {
  AppNavigation,
  DashboardHeader,
  ProcessToolbar,
  SummaryBand,
  WorkspaceHeader,
} from './components/DashboardChrome';
import type { ViewMode } from './components/DashboardChrome';
import { ConfirmStopDialog } from './components/ConfirmStopDialog';
import { PortMap } from './components/PortMap';
import { ProcessTable } from './components/ProcessTable';
import { ProjectCards } from './components/ProjectCards';
import { buildRenderGroups, filterProcesses } from './processUtils';
import type { ProcessInfo, ProcessListResponse, ProcessSummary } from './types';

const EMPTY_SUMMARY: ProcessSummary = {
  process_count: 0,
  total_memory_mb: 0,
  active_ports: [],
};

type StopError = { pid: number; message: string };

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

  const visibleProcesses = useMemo(() => filterProcesses(data.processes, query), [data.processes, query]);
  const groups = useMemo(() => buildRenderGroups(visibleProcesses), [visibleProcesses]);
  const conflictPorts = useMemo(
    () => new Set((data.port_conflicts ?? []).map((conflict) => conflict.port)),
    [data.port_conflicts],
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
      await killProcess(target.pid);
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
        <section id="workspace" className="process-section" aria-label="Processes">
          <WorkspaceHeader mode={viewMode} onModeChange={setViewMode} />
          <ProcessToolbar query={query} showing={visibleProcesses.length} total={data.processes.length} onQueryChange={setQuery} />
          {error ? <div className="alert">Error: {error}</div> : null}
          {data.port_conflicts && data.port_conflicts.length > 0 ? <div className="conflict-banner" role="status">{data.port_conflicts.map((conflict) => `Port ${conflict.port} claimed by ${conflict.pids.length} processes`).join(' \u00b7 ')}</div> : null}
          {isLoading ? <div className="state">Loading processes...</div> : null}
          {!isLoading && visibleProcesses.length === 0 ? <div className="state">{query ? 'No processes match the current filter.' : 'No development processes detected.'}</div> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'table' ? <ProcessTable groups={groups} conflictPorts={conflictPorts} expandedGroups={expandedGroups} onToggleGroup={toggleGroup} isStale={isStale} selectedPid={selectedProcess?.pid ?? null} stopError={stopError} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'cards' ? <ProjectCards groups={groups} isStale={isStale} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
          {!isLoading && visibleProcesses.length > 0 && viewMode === 'ports' ? <PortMap groups={groups} hostName={hostName} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
        </section>
        {selectedProcess ? <ConfirmStopDialog process={selectedProcess} isStopping={isStopping} error={stopError?.pid === selectedProcess.pid ? stopError.message : null} onCancel={() => setSelectedProcess(null)} onConfirm={() => void handleConfirmStop()} /> : null}
      </main>
    </div>
  );
}

export default App;
