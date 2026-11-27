import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, describeAlert, evaluateAlerts, loadAlertSettings, saveAlertSettings } from './alerts';
import type { AlertSettings, OverLimitSince } from './alerts';
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

const settings: AlertSettings = { enabled: true, cpuPercent: 80, memoryMb: 1000, sustainSeconds: 6 };

/** Feed measurements, each `[seconds since start, processes]`, through the evaluator as App does. */
function run(measurements: Array<[number, ProcessInfo[]]>, using: AlertSettings = settings) {
  let since: OverLimitSince = new Map();
  let alerts: ReturnType<typeof evaluateAlerts>['alerts'] = [];
  for (const [seconds, processes] of measurements) {
    ({ since, alerts } = evaluateAlerts(since, processes, using, 1_000_000 + seconds * 1000));
  }
  return alerts;
}

describe('evaluateAlerts', () => {
  const hot = [proc({ cpu_usage: 95 })];
  const cool = [proc({ cpu_usage: 10 })];

  test('alerts once a process has stayed over the limit for the sustain time', () => {
    expect(run([[0, hot], [2, hot], [4, hot]])).toEqual([]);
    expect(run([[0, hot], [2, hot], [4, hot], [6, hot]])).toEqual([
      { pid: 1, name: 'node', kind: 'cpu', value: 95, limit: 80 },
    ]);
  });

  test('counts time, not measurements: rapid refreshes cannot fire it early', () => {
    const burst: Array<[number, ProcessInfo[]]> = Array.from({ length: 20 }, (_, i) => [i * 0.1, hot]);

    expect(run(burst)).toEqual([]);
  });

  test('a dip below the limit restarts the timer', () => {
    expect(run([[0, hot], [4, hot], [5, cool], [6, hot], [10, hot]])).toEqual([]);
    expect(run([[0, hot], [4, hot], [5, cool], [6, hot], [12, hot]])).toHaveLength(1);
  });

  test('tracks memory separately from CPU', () => {
    const big = [proc({ memory_mb: 2048 })];

    expect(run([[0, big], [6, big]]).map((alert) => alert.kind)).toEqual(['memory']);
  });

  test('a reused PID starts its own timer', () => {
    const reused = [proc({ cpu_usage: 95, started_at: 2000 })];

    expect(run([[0, hot], [5, hot], [7, reused]])).toEqual([]);
  });

  test('a sustain time of 0 alerts on the first measurement', () => {
    expect(run([[0, hot]], { ...settings, sustainSeconds: 0 })).toHaveLength(1);
  });

  test('raises nothing when alerts are off', () => {
    expect(run([[0, hot], [10, hot]], { ...settings, enabled: false })).toEqual([]);
  });
});

describe('alert settings storage', () => {
  afterEach(() => window.localStorage.clear());

  test('round-trips through localStorage', () => {
    saveAlertSettings({ enabled: false, cpuPercent: 50, memoryMb: 512, sustainSeconds: 10 });

    expect(loadAlertSettings()).toEqual({ enabled: false, cpuPercent: 50, memoryMb: 512, sustainSeconds: 10 });
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
