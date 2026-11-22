import { describe, expect, test } from 'vitest';
import { buildDevPortSlots, buildRenderGroups, COMMON_DEV_PORTS } from './processUtils';
import type { ProcessInfo } from './types';

function makeProcess(overrides: Partial<ProcessInfo> & { pid: number }): ProcessInfo {
  return {
    name: 'node',
    command: 'npm run dev',
    cwd: null,
    ports: [],
    cpu_usage: 0,
    memory_mb: 1,
    uptime_seconds: 0,
    status: 'running',
    started_at: 0,
    ...overrides,
  };
}

describe('buildRenderGroups', () => {
  test('clusters by working directory with primaries before helpers', () => {
    const server = makeProcess({ pid: 1, cwd: '/work/app', ports: [5173], is_primary: true });
    const helper = makeProcess({ pid: 2, cwd: '/work/app', is_primary: false, memory_mb: 4 });
    const groups = buildRenderGroups([helper, server]);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.label).toBe('app');
    expect(group.projectPath).toBe('/work/app');
    expect(group.processes.map((p) => p.pid)).toEqual([1, 2]);
    expect(group.primaryCount).toBe(1);
    expect(group.helperCount).toBe(1);
    expect(group.ports).toEqual([5173]);
    expect(group.totalMemoryMb).toBe(5);
  });

  test('falls back to ports when is_primary is absent', () => {
    const owner = makeProcess({ pid: 1, cwd: '/p', ports: [8000] });
    const child = makeProcess({ pid: 2, cwd: '/p' });
    const [group] = buildRenderGroups([owner, child]);

    expect(group.primaryCount).toBe(1);
    expect(group.processes[0].pid).toBe(1);
  });

  test('promotes a member so a group is never empty', () => {
    const a = makeProcess({ pid: 1, cwd: '/p' });
    const b = makeProcess({ pid: 2, cwd: '/p' });
    const [group] = buildRenderGroups([a, b]);

    expect(group.primaryCount).toBe(1);
    expect(group.helperCount).toBe(1);
  });

  test('sorts named projects before cwd-less singletons', () => {
    const named = makeProcess({ pid: 1, cwd: '/work/zeta', ports: [3000] });
    const orphan = makeProcess({ pid: 2, cwd: null });
    const groups = buildRenderGroups([orphan, named]);

    expect(groups.map((g) => g.label)).toEqual(['zeta', 'Ungrouped']);
    expect(groups[1].key).toBe('pid:2');
  });

  test('labels the pooled Docker group "Docker" instead of a proxy cwd', () => {
    const v4 = makeProcess({ pid: 1, name: 'docker-proxy', cwd: '/', ports: [8080], category: 'docker', group_key: 'docker' });
    const v6 = makeProcess({ pid: 2, name: 'docker-proxy', cwd: '/', ports: [8080], category: 'docker', group_key: 'docker' });
    const app = makeProcess({ pid: 3, cwd: '/work/web', ports: [5173], group_key: '/work/web' });

    const groups = buildRenderGroups([v4, v6, app]);

    const docker = groups.find((group) => group.key === 'docker');
    expect(docker?.label).toBe('Docker');
    expect(docker?.projectPath).toBeNull();
    expect(docker?.processes.map((process) => process.pid)).toEqual([1, 2]);
  });

  test('extracts project labels from Windows paths', () => {
    const process = makeProcess({
      pid: 1,
      cwd: 'C:\\Users\\jamie\\repos\\Server-View-2\\frontend',
      ports: [5178],
    });

    expect(buildRenderGroups([process])[0].label).toBe('frontend');
  });
});

describe('buildDevPortSlots', () => {
  test('returns a fixed slot for every common port including free ones', () => {
    const slots = buildDevPortSlots([]);

    expect(slots.map((slot) => slot.port)).toEqual([...COMMON_DEV_PORTS]);
    expect(slots.every((slot) => slot.process === null)).toBe(true);
    expect(slots.every((slot) => !slot.conflict)).toBe(true);
  });

  test('maps occupants and project labels for claimed ports', () => {
    const vite = makeProcess({ pid: 10, name: 'node', cwd: '/work/frontend', ports: [5173] });
    const api = makeProcess({ pid: 20, name: 'uvicorn', cwd: '/work/backend', ports: [8000] });
    const slots = buildDevPortSlots([vite, api]);

    const byPort = Object.fromEntries(slots.map((slot) => [slot.port, slot]));
    expect(byPort[5173].process?.pid).toBe(10);
    expect(byPort[5173].projectLabel).toBe('frontend');
    expect(byPort[5173].role).toBe('Vite');
    expect(byPort[8000].process?.pid).toBe(20);
    expect(byPort[8000].projectLabel).toBe('backend');
    expect(byPort[3000].process).toBeNull();
    expect(byPort[3006].process).toBeNull();
  });

  test('flags conflicts from API conflicts or multiple owners', () => {
    const a = makeProcess({ pid: 1, cwd: '/a', ports: [3000] });
    const b = makeProcess({ pid: 2, cwd: '/b', ports: [3000] });
    const multi = buildDevPortSlots([a, b]);
    expect(multi.find((slot) => slot.port === 3000)?.conflict).toBe(true);
    expect(multi.find((slot) => slot.port === 3000)?.owners).toHaveLength(2);

    const flagged = buildDevPortSlots([a], [{ port: 3000, pids: [1, 99] }]);
    expect(flagged.find((slot) => slot.port === 3000)?.conflict).toBe(true);
  });

  test('does not flag the IPv4/IPv6 docker-proxy pair for one port as a conflict', () => {
    const v4 = makeProcess({ pid: 1, name: 'docker-proxy', cwd: '/', ports: [3000], category: 'docker' });
    const v6 = makeProcess({ pid: 2, name: 'docker-proxy', cwd: '/', ports: [3000], category: 'docker' });

    const slot = buildDevPortSlots([v4, v6]).find((candidate) => candidate.port === 3000);
    expect(slot?.conflict).toBe(false);
    expect(slot?.projectLabel).toBe('Docker');

    const node = makeProcess({ pid: 3, cwd: '/work', ports: [3000] });
    expect(buildDevPortSlots([v4, v6, node]).find((candidate) => candidate.port === 3000)?.conflict).toBe(true);
  });

  test('ignores processes on non-common ports', () => {
    const other = makeProcess({ pid: 3, ports: [5178, 8080] });
    const slots = buildDevPortSlots([other]);
    expect(slots.every((slot) => slot.process === null)).toBe(true);
  });
});
