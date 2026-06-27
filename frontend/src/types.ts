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
}

export interface ProcessSummary {
  process_count: number;
  total_memory_mb: number;
  active_ports: number[];
}

export interface ProcessListResponse {
  processes: ProcessInfo[];
  summary: ProcessSummary;
}

export interface KillResponse {
  pid: number;
  signal: string;
  status: string;
  message: string;
}
