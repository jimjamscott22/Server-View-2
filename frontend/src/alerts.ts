import type { ProcessInfo } from './types';

/** When a process counts as using too much. Saved per browser. */
export interface AlertSettings {
  enabled: boolean;
  /** CPU percent of one core (the same number the table shows). */
  cpuPercent: number;
  memoryMb: number;
  /** Consecutive updates over the limit before alerting (updates arrive every 2 s). */
  sustainUpdates: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  cpuPercent: 80,
  memoryMb: 1024,
  sustainUpdates: 3,
};

export const UPDATE_INTERVAL_SECONDS = 2;

const STORAGE_KEY = 'server-view.alert-settings';

export type AlertKind = 'cpu' | 'memory';

export interface ResourceAlert {
  pid: number;
  name: string;
  kind: AlertKind;
  value: number;
  limit: number;
}

/** Consecutive over-limit update counts, keyed by process identity (pid + start time). */
export type OverLimitCounts = Map<string, { cpu: number; memory: number }>;

export function processKey(process: Pick<ProcessInfo, 'pid' | 'started_at'>): string {
  return `${process.pid}:${process.started_at}`;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
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
      sustainUpdates: Math.round(positiveNumber(saved.sustainUpdates, DEFAULT_ALERT_SETTINGS.sustainUpdates)),
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
 * Advance the over-limit counters with one update and return the alerts that
 * are active now. A process alerts once it has been over a limit for
 * `sustainUpdates` updates in a row, so a short spike (a rebuild) stays quiet.
 */
export function evaluateAlerts(
  previous: OverLimitCounts,
  processes: ProcessInfo[],
  settings: AlertSettings,
): { counts: OverLimitCounts; alerts: ResourceAlert[] } {
  const counts: OverLimitCounts = new Map();
  const alerts: ResourceAlert[] = [];
  if (!settings.enabled) {
    return { counts, alerts };
  }

  for (const process of processes) {
    const key = processKey(process);
    const before = previous.get(key) ?? { cpu: 0, memory: 0 };
    const now = {
      cpu: process.cpu_usage >= settings.cpuPercent ? before.cpu + 1 : 0,
      memory: process.memory_mb >= settings.memoryMb ? before.memory + 1 : 0,
    };
    // Only processes over a limit need tracking; the rest drop out of the map.
    if (now.cpu > 0 || now.memory > 0) {
      counts.set(key, now);
    }
    if (now.cpu >= settings.sustainUpdates) {
      alerts.push({ pid: process.pid, name: process.name, kind: 'cpu', value: process.cpu_usage, limit: settings.cpuPercent });
    }
    if (now.memory >= settings.sustainUpdates) {
      alerts.push({ pid: process.pid, name: process.name, kind: 'memory', value: process.memory_mb, limit: settings.memoryMb });
    }
  }

  return { counts, alerts };
}

export function describeAlert(alert: ResourceAlert): string {
  return alert.kind === 'cpu'
    ? `${alert.name} (PID ${alert.pid}) is using ${alert.value.toFixed(0)}% CPU (limit ${alert.limit}%)`
    : `${alert.name} (PID ${alert.pid}) is using ${alert.value.toFixed(0)} MB of memory (limit ${alert.limit} MB)`;
}
