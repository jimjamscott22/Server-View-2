import type { PortConflict, ProcessInfo } from './types';

/** Common local-dev ports surfaced in the always-visible port bay. */
export const COMMON_DEV_PORTS = [3000, 5173, 8000, 3006] as const;

export type CommonDevPort = (typeof COMMON_DEV_PORTS)[number];

const DEV_PORT_META: Record<CommonDevPort, { role: string; hint: string }> = {
  3000: { role: 'Next / CRA', hint: 'Frontend' },
  5173: { role: 'Vite', hint: 'Frontend' },
  8000: { role: 'API', hint: 'Backend' },
  3006: { role: 'Custom', hint: 'Tooling' },
};

export interface DevPortSlot {
  port: CommonDevPort;
  role: string;
  hint: string;
  /** Processes currently listening on this port (may be >1 on conflict). */
  owners: ProcessInfo[];
  conflict: boolean;
  /** Primary owner for stop actions — first occupant, if any. */
  process: ProcessInfo | null;
  projectLabel: string | null;
}

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
  if (isDocker(process)) {
    return DOCKER_GROUP_KEY;
  }
  if (process.cwd) {
    return process.cwd;
  }
  return `pid:${process.pid}`;
}

/** Docker port owners share one group; their cwd says nothing about the container's project. */
const DOCKER_GROUP_KEY = 'docker';
const DOCKER_LABEL = 'Docker';

function isDocker(process: ProcessInfo): boolean {
  return process.category === 'docker';
}

function isPrimary(process: ProcessInfo): boolean {
  return process.is_primary ?? process.ports.length > 0;
}

function labelOf(path: string | null): string {
  if (!path) {
    return 'Ungrouped';
  }
  const segments = path.split(/[\\/]+/).filter(Boolean);
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
    const isDockerGroup = members.every(isDocker);
    const projectPath = isDockerGroup ? null : members[0].cwd ?? null;
    const ports = Array.from(new Set(members.flatMap((member) => member.ports))).sort(
      (a, b) => a - b,
    );
    const totalMemoryMb = Math.round(members.reduce((sum, m) => sum + m.memory_mb, 0) * 10) / 10;
    return {
      key,
      label: isDockerGroup ? DOCKER_LABEL : labelOf(projectPath),
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

/**
 * Build fixed occupancy slots for the common-dev-port bay. Free ports still
 * appear so the bay answers "is :3000 taken?" at a glance.
 */
export function buildDevPortSlots(
  processes: ProcessInfo[],
  conflicts: PortConflict[] = [],
): DevPortSlot[] {
  const conflictPorts = new Set(conflicts.map((c) => c.port));
  const ownersByPort = new Map<number, ProcessInfo[]>();

  for (const process of processes) {
    for (const port of process.ports) {
      if (!(COMMON_DEV_PORTS as readonly number[]).includes(port)) {
        continue;
      }
      const owners = ownersByPort.get(port) ?? [];
      owners.push(process);
      ownersByPort.set(port, owners);
    }
  }

  return COMMON_DEV_PORTS.map((port) => {
    const owners = ownersByPort.get(port) ?? [];
    const process = owners[0] ?? null;
    const meta = DEV_PORT_META[port];
    return {
      port,
      role: meta.role,
      hint: meta.hint,
      owners,
      // Docker runs one proxy per address family for a published port; that pair is not a conflict.
      conflict: conflictPorts.has(port) || (owners.length > 1 && !owners.every(isDocker)),
      process,
      projectLabel: process ? (isDocker(process) ? DOCKER_LABEL : labelOf(process.cwd)) : null,
    };
  });
}
