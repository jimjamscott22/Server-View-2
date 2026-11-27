import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, describeAlert, evaluateAlerts, loadAlertSettings, saveAlertSettings } from './alerts';
import type { AlertSettings, OverLimitCounts } from './alerts';
import type { ProcessInfo } from './types';

function proc(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid: 1,
    name: 'node',
    command: 'npm run dev',
    cwd: '/work/app',
    ports: [5173],
    cpu_usage: 0,
    memory_mb: 100,
    uptime_seconds: 10,
    status: 'running',
    started_at: 1000,
    ...overrides,
  };
}

const settings: AlertSettings = { enabled: true, cpuPercent: 80, memoryMb: 1000, sustainUpdates: 3 };

/** Feed a series of updates through the evaluator, as App does. */
function run(updates: ProcessInfo[][], using: AlertSettings = settings) {
  let counts: OverLimitCounts = new Map();
  let alerts: ReturnType<typeof evaluateAlerts>['alerts'] = [];
  for (const processes of updates) {
    ({ counts, alerts } = evaluateAlerts(counts, processes, using));
  }
  return alerts;
}

describe('evaluateAlerts', () => {
  test('alerts only after the limit is exceeded for the sustained number of updates', () => {
    const hot = [proc({ cpu_usage: 95 })];

    expect(run([hot, hot])).toEqual([]);
    expect(run([hot, hot, hot])).toEqual([{ pid: 1, name: 'node', kind: 'cpu', value: 95, limit: 80 }]);
  });

  test('a dip below the limit restarts the count', () => {
    const hot = [proc({ cpu_usage: 95 })];
    const cool = [proc({ cpu_usage: 10 })];

    expect(run([hot, hot, cool, hot, hot])).toEqual([]);
  });

  test('tracks memory separately from CPU', () => {
    const big = [proc({ memory_mb: 2048 })];

    expect(run([big, big, big]).map((alert) => alert.kind)).toEqual(['memory']);
  });

  test('a reused PID starts from zero', () => {
    const before = [proc({ cpu_usage: 95, started_at: 1000 })];
    const reused = [proc({ cpu_usage: 95, started_at: 2000 })];

    expect(run([before, before, reused])).toEqual([]);
  });

  test('raises nothing when alerts are off', () => {
    const hot = [proc({ cpu_usage: 95 })];

    expect(run([hot, hot, hot], { ...settings, enabled: false })).toEqual([]);
  });
});

describe('alert settings storage', () => {
  afterEach(() => window.localStorage.clear());

  test('round-trips through localStorage', () => {
    saveAlertSettings({ enabled: false, cpuPercent: 50, memoryMb: 512, sustainUpdates: 5 });

    expect(loadAlertSettings()).toEqual({ enabled: false, cpuPercent: 50, memoryMb: 512, sustainUpdates: 5 });
  });

  test('falls back to defaults for missing, corrupt, or invalid values', () => {
    expect(loadAlertSettings()).toEqual(DEFAULT_ALERT_SETTINGS);

    window.localStorage.setItem('server-view.alert-settings', '{not json');
    expect(loadAlertSettings()).toEqual(DEFAULT_ALERT_SETTINGS);

    window.localStorage.setItem('server-view.alert-settings', JSON.stringify({ cpuPercent: -5, memoryMb: 'lots' }));
    expect(loadAlertSettings()).toEqual(DEFAULT_ALERT_SETTINGS);
  });
});

test('describes alerts in words', () => {
  expect(describeAlert({ pid: 7, name: 'vite', kind: 'cpu', value: 91.6, limit: 80 })).toBe(
    'vite (PID 7) is using 92% CPU (limit 80%)',
  );
  expect(describeAlert({ pid: 7, name: 'vite', kind: 'memory', value: 1500.2, limit: 1024 })).toBe(
    'vite (PID 7) is using 1500 MB of memory (limit 1024 MB)',
  );
});
