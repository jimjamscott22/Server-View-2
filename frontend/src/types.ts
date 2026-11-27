export type ProcessCategory = 'app' | 'database' | 'docker';

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cwd: string | null;
  ports: number[];
  cpu_usage: number;
  memory_mb: number;
  uptime_seconds: number;
  status: string;
  /** Process start time (epoch seconds); sent with a stop request so the agent can detect a reused PID. */
  started_at: number;
  /** "database" for local DB servers, "docker" for processes that own a container's published port. */
  category?: ProcessCategory;
  /** Working-directory group this process belongs to. */
  group_key?: string;
  /** Owns a port or is its group's representative; helpers are collapsible. */
  is_primary?: boolean;
}

/** A set of processes that share a working directory (a "project"). */
export interface ProcessGroup {
  key: string;
  project_path: string | null;
  label: string;
  pids: number[];
  ports: number[];
  process_count: number;
  total_memory_mb: number;
  primary_pid: number | null;
}

/** A listening port claimed by more than one process. */
export interface PortConflict {
  port: number;
  pids: number[];
}

export interface ProcessSummary {
  process_count: number;
  total_memory_mb: number;
  active_ports: number[];
  group_count?: number;
  conflict_count?: number;
  host_name?: string;
  memory_percent?: number;
}

export interface ProcessListResponse {
  processes: ProcessInfo[];
  groups?: ProcessGroup[];
  port_conflicts?: PortConflict[];
  summary: ProcessSummary;
}

export interface KillResponse {
  pid: number;
  signal: string;
  status: string;
  message: string;
}

/** One process the bulk stop request should stop. */
export interface StopTarget {
  pid: number;
  started_at: number;
}

export interface StopResult {
  pid: number;
  /** "requested": terminate was sent. "failed": see http_status and message. */
  status: 'requested' | 'failed';
  http_status: number;
  message: string;
}

export interface BulkStopResponse {
  results: StopResult[];
}

/** A process start or stop, from the agent's history database. */
export interface HistoryEvent {
  /** Epoch seconds. For "started" this is when the process really started. */
  time: number;
  kind: 'started' | 'stopped';
  pid: number;
  started_at: number;
  name: string;
  command: string;
  cwd: string | null;
  ports: number[];
  category: string;
}
