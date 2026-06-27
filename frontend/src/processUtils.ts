import type { ProcessInfo } from './types';

export function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function filterProcesses(processes: ProcessInfo[], query: string): ProcessInfo[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return processes;
  }

  return processes.filter((process) => {
    const searchable = [
      process.pid.toString(),
      process.name,
      process.command,
      process.cwd ?? '',
      process.status,
      process.ports.join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return searchable.includes(normalized);
  });
}
