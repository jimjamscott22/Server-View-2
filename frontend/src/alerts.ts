import type { ProcessInfo } from './types';

/** When a process counts as using too much. Saved per browser. */
export interface AlertSettings {
  enabled: boolean;
  /** CPU percent of one core (the same number the table shows). */
  cpuPercent: number;
  memoryMb: number;
  /** How long a process must stay over a limit before it alerts (0: on the first measurement). */
  sustainSeconds: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  cpuPercent: 80,
  memoryMb: 1024,
  sustainSeconds: 6,
};

const STORAGE_KEY = 'server-view.alert-settings';

export type AlertKind = 'cpu' | 'memory';

export interface ResourceAlert {
  pid: number;
  name: string;
  kind: AlertKind;
  value: number;
  limit: number;
}

/**
 * When each process was first measured over each limit (epoch ms), keyed by
 * process identity (pid + start time). Only processes currently over a limit are kept.
 */
export type OverLimitSince = Map<string, { cpu: number | null; memory: number | null }>;

export function processKey(process: Pick<ProcessInfo, 'pid' | 'started_at'>): string {
  return `${process.pid}:${process.started_at}`;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function loadAlertSettings(): AlertSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ALERT_SETTINGS;
    }
    const saved = JSON.parse(raw) as Partial<AlertSettings>;
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_ALERT_SETTINGS.enabled,
      cpuPercent: positiveNumber(saved.cpuPercent, DEFAULT_ALERT_SETTINGS.cpuPercent),
      memoryMb: positiveNumber(saved.memoryMb, DEFAULT_ALERT_SETTINGS.memoryMb),
      sustainSeconds: nonNegativeNumber(saved.sustainSeconds, DEFAULT_ALERT_SETTINGS.sustainSeconds),
    };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export function saveAlertSettings(settings: AlertSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can refuse storage; the settings still apply until reload.
  }
}

/**
 * Fold one measurement into the over-limit timers and return the alerts active
 * now. A process alerts once it has been over a limit in every measurement for
 * at least `sustainSeconds`, so a short spike (a rebuild) stays quiet.
 *
 * `measuredAt` is when this process list arrived. Timing is by clock, not by
 * how often this runs, so extra refreshes or re-renders can't make an alert
 * fire early.
 */
export function evaluateAlerts(
  previous: OverLimitSince,
  processes: ProcessInfo[],
  settings: AlertSettings,
  measuredAt: number,
): { since: OverLimitSince; alerts: ResourceAlert[] } {
  const since: OverLimitSince = new Map();
  const alerts: ResourceAlert[] = [];
  if (!settings.enabled) {
    return { since, alerts };
  }
  const sustainMs = settings.sustainSeconds * 1000;

  for (const process of processes) {
    const key = processKey(process);
    const before = previous.get(key);
    const now = {
      cpu: process.cpu_usage >= settings.cpuPercent ? (before?.cpu ?? measuredAt) : null,
      memory: process.memory_mb >= settings.memoryMb ? (before?.memory ?? measuredAt) : null,
    };
    if (now.cpu !== null || now.memory !== null) {
      since.set(key, now);
    }
    if (now.cpu !== null && measuredAt - now.cpu >= sustainMs) {
      alerts.push({ pid: process.pid, name: process.name, kind: 'cpu', value: process.cpu_usage, limit: settings.cpuPercent });
    }
    if (now.memory !== null && measuredAt - now.memory >= sustainMs) {
      alerts.push({ pid: process.pid, name: process.name, kind: 'memory', value: process.memory_mb, limit: settings.memoryMb });
    }
  }

  return { since, alerts };
}

export function describeAlert(alert: ResourceAlert): string {
  return alert.kind === 'cpu'
    ? `${alert.name} (PID ${alert.pid}) is using ${alert.value.toFixed(0)}% CPU (limit ${alert.limit}%)`
    : `${alert.name} (PID ${alert.pid}) is using ${alert.value.toFixed(0)} MB of memory (limit ${alert.limit} MB)`;
}
