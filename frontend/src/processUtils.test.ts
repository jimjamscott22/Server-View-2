import { describe, expect, test } from 'vitest';
import { buildRenderGroups } from './processUtils';
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
});
