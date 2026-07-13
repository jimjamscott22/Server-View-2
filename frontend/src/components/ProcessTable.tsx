import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { formatUptime } from '../processUtils';
import type { RenderGroup } from '../processUtils';
import type { ProcessInfo } from '../types';

type StopError = { pid: number; message: string };

function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (value.includes('run')) {
    return 'status status-ok';
  }
  if (['zombie', 'dead', 'stopped'].some((flag) => value.includes(flag))) {
    return 'status status-bad';
  }
  return 'status';
}

function Ports({ ports, conflictPorts }: { ports: number[]; conflictPorts: Set<number> }) {
  if (ports.length === 0) {
    return <span className="muted">None</span>;
  }

  return (
    <div className="port-list" aria-label="Listening ports">
      {ports.map((port) => {
        const inConflict = conflictPorts.has(port);
        return (
          <span
            className={inConflict ? 'port port-conflict' : 'port'}
            key={port}
            title={inConflict ? 'Claimed by more than one process' : undefined}
          >
            {port}
          </span>
        );
      })}
    </div>
  );
}

function ProcessRow({
  process,
  isChild,
  conflictPorts,
  stopError,
  onStop,
}: {
  process: ProcessInfo;
  isChild: boolean;
  conflictPorts: Set<number>;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
}) {
  const isRestricted = !process.command && !process.cwd;
  const failedStop = stopError?.pid === process.pid ? stopError : null;
  const rowClass = [isChild ? 'row-child' : '', isRestricted ? 'row-restricted' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={rowClass || undefined}>
      <td>
        <div className="process-name">{process.name}</div>
        <div className="process-meta">PID {process.pid}</div>
        <code>{process.command || 'Command unavailable'}</code>
        {isChild ? null : (
          <div className="cwd">{process.cwd ?? 'Working directory unavailable'}</div>
        )}
        {isRestricted ? <span className="tag-restricted">Limited access</span> : null}
      </td>
      <td data-label="Ports"><Ports ports={process.ports} conflictPorts={conflictPorts} /></td>
      <td className="num" data-label="CPU">{process.cpu_usage.toFixed(1)}%</td>
      <td className="num" data-label="Memory">{process.memory_mb.toFixed(1)} MB</td>
      <td className="num" data-label="Uptime">{formatUptime(process.uptime_seconds)}</td>
      <td data-label="Status"><span className={statusClass(process.status)}>{process.status}</span></td>
      <td className="action-cell" data-label="Action">
        <button className="danger" type="button" onClick={() => onStop(process)}>
          Stop
        </button>
        {failedStop ? <div className="stop-error">{failedStop.message}</div> : null}
      </td>
    </tr>
  );
}

function GroupHeader({
  group,
  expanded,
  hasConflict,
  onToggle,
}: {
  group: RenderGroup;
  expanded: boolean;
  hasConflict: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <tr className="group-row">
      <td colSpan={7}>
        <div className="group-head">
          <button
            type="button"
            className="disclosure"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label} helper processes`}
            onClick={onToggle}
          >
            <Chevron className="chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
            <Folder size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="group-label">{group.label}</span>
          </button>
          {group.projectPath ? <span className="group-path">{group.projectPath}</span> : null}
          <div className="group-meta">
            {hasConflict ? <span className="conflict-badge">Port conflict</span> : null}
            <span className="group-stat">{group.processes.length} processes</span>
            <span className="group-stat">{group.totalMemoryMb.toFixed(1)} MB</span>
            {group.helperCount > 0 ? (
              <span className="group-stat group-helpers">
                {expanded
                  ? 'Hide helpers'
                  : `+${group.helperCount} helper${group.helperCount === 1 ? '' : 's'}`}
              </span>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

export function ProcessTable({
  groups,
  conflictPorts,
  expandedGroups,
  onToggleGroup,
  isStale,
  stopError,
  onStop,
}: {
  groups: RenderGroup[];
  conflictPorts: Set<number>;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  isStale: boolean;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
}) {
  return (
    <div className={`table-wrap${isStale ? ' is-stale' : ''}`}>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th className="col-ports">Ports</th>
            <th className="col-cpu">CPU</th>
            <th className="col-mem">Memory</th>
            <th className="col-uptime">Uptime</th>
            <th className="col-status">Status</th>
            <th className="col-actions" aria-label="Actions" />
          </tr>
        </thead>
        {groups.map((group) => {
          const isGrouped = group.processes.length > 1;
          const hasConflict = group.ports.some((port) => conflictPorts.has(port));

          if (!isGrouped) {
            return (
              <tbody key={group.key}>
                <ProcessRow
                  process={group.processes[0]}
                  isChild={false}
                  conflictPorts={conflictPorts}
                  stopError={stopError}
                  onStop={onStop}
                />
              </tbody>
            );
          }

          const expanded = expandedGroups.has(group.key);
          const visible = expanded
            ? group.processes
            : group.processes.slice(0, group.primaryCount);

          return (
            <tbody key={group.key} className="group">
              <GroupHeader
                group={group}
                expanded={expanded}
                hasConflict={hasConflict}
                onToggle={() => onToggleGroup(group.key)}
              />
              {visible.map((process, index) => (
                <ProcessRow
                  key={process.pid}
                  process={process}
                  isChild={index >= group.primaryCount}
                  conflictPorts={conflictPorts}
                  stopError={stopError}
                  onStop={onStop}
                />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
