import type { ProcessInfo } from './types';

export interface RenderGroup {
  key: string;
  label: string;
  projectPath: string | null;
  /** Primary process(es) first, then collapsible helpers. */
  processes: ProcessInfo[];
  primaryCount: number;
  helperCount: number;
  ports: number[];
  totalMemoryMb: number;
}

function groupKeyOf(process: ProcessInfo): string {
  if (process.group_key) {
    return process.group_key;
  }
  if (process.cwd) {
    return process.cwd;
  }
  return `pid:${process.pid}`;
}

function isPrimary(process: ProcessInfo): boolean {
  return process.is_primary ?? process.ports.length > 0;
}

function labelOf(path: string | null): string {
  if (!path) {
    return 'Ungrouped';
  }
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * Cluster processes into project groups by working directory, preserving the
 * incoming order. Primary processes (port owners or the backend's chosen
 * representative) lead each group; helpers follow and can be collapsed. If a
 * group has no primary — possible while filtering hides the owner — the first
 * member is promoted so a group never renders empty.
 */
export function buildRenderGroups(processes: ProcessInfo[]): RenderGroup[] {
  const membersByKey = new Map<string, ProcessInfo[]>();
  const order: string[] = [];

  for (const process of processes) {
    const key = groupKeyOf(process);
    if (!membersByKey.has(key)) {
      membersByKey.set(key, []);
      order.push(key);
    }
    membersByKey.get(key)!.push(process);
  }

  const groups = order.map((key): RenderGroup => {
    const members = membersByKey.get(key)!;
    const primary = members.filter(isPrimary);
    const helpers = members.filter((member) => !isPrimary(member));
    if (primary.length === 0 && helpers.length > 0) {
      primary.push(helpers.shift()!);
    }
    const projectPath = members[0].cwd ?? null;
    const ports = Array.from(new Set(members.flatMap((member) => member.ports))).sort(
      (a, b) => a - b,
    );
    const totalMemoryMb = Math.round(members.reduce((sum, m) => sum + m.memory_mb, 0) * 10) / 10;
    return {
      key,
      label: labelOf(projectPath),
      projectPath,
      processes: [...primary, ...helpers],
      primaryCount: primary.length,
      helperCount: helpers.length,
      ports,
      totalMemoryMb,
    };
  });

  groups.sort((a, b) => {
    const aUngrouped = a.projectPath === null;
    const bUngrouped = b.projectPath === null;
    if (aUngrouped !== bUngrouped) {
      return aUngrouped ? 1 : -1;
    }
    return a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.key.localeCompare(b.key);
  });

  return groups;
}

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
