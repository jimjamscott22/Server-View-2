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
