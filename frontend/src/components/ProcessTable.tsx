import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AlertKind } from '../alerts';
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

/** Docker port owners can't be stopped, so they can't be selected for a bulk stop either. */
export function isStoppable(process: ProcessInfo): boolean {
  return process.category !== 'docker';
}

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Database',
  docker: 'Docker',
};

function ProcessRow({
  process,
  isChild,
  isSelected,
  isChecked,
  alertKinds,
  conflictPorts,
  stopError,
  onStop,
  onToggleCheck,
}: {
  process: ProcessInfo;
  isChild: boolean;
  isSelected: boolean;
  isChecked: boolean;
  alertKinds: Set<AlertKind> | undefined;
  conflictPorts: Set<number>;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
  onToggleCheck: (process: ProcessInfo) => void;
}) {
  const isRestricted = !process.command && !process.cwd;
  const failedStop = stopError?.pid === process.pid ? stopError : null;
  const rowClass = [
    isChild ? 'row-child' : '',
    isRestricted ? 'row-restricted' : '',
    isSelected ? 'row-selected' : '',
    isChecked ? 'row-checked' : '',
    alertKinds?.size ? 'row-alert' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={rowClass || undefined}>
      <td className="select-cell">
        {isStoppable(process) ? (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleCheck(process)}
            aria-label={`Select ${process.name} (PID ${process.pid})`}
          />
        ) : null}
      </td>
      <td className="process-cell">
        <div className="process-name">{process.name}</div>
        <div className="process-meta">PID {process.pid}</div>
        <code>{process.command || 'Command unavailable'}</code>
        {isChild ? null : (
          <div className="cwd">{process.cwd ?? 'Working directory unavailable'}</div>
        )}
        {process.category && CATEGORY_LABELS[process.category] ? (
          <span className={`tag-category tag-${process.category}`}>{CATEGORY_LABELS[process.category]}</span>
        ) : null}
        {isRestricted ? <span className="tag-restricted">Limited access</span> : null}
      </td>
      <td className="ports-cell" data-label="Ports"><Ports ports={process.ports} conflictPorts={conflictPorts} /></td>
      <td className={`num cpu-cell${alertKinds?.has('cpu') ? ' is-over-limit' : ''}`} data-label="CPU">
        {process.cpu_usage.toFixed(1)}%
      </td>
      <td className={`num memory-cell${alertKinds?.has('memory') ? ' is-over-limit' : ''}`} data-label="Memory">
        {process.memory_mb.toFixed(1)} MB
      </td>
      <td className="num uptime-cell" data-label="Uptime">{formatUptime(process.uptime_seconds)}</td>
      <td className="status-cell" data-label="Status"><span className={statusClass(process.status)}>{process.status}</span></td>
      <td className="action-cell" data-label="Action">
        {process.category === 'docker' ? (
          <span className="muted" title="Stop the container with docker stop">Managed by Docker</span>
        ) : (
          <button className="danger" type="button" onClick={() => onStop(process)}>
            Stop
          </button>
        )}
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
      <td colSpan={8}>
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

function SelectAllCheckbox({
  selectable,
  checkedPids,
  onSetChecked,
}: {
  selectable: ProcessInfo[];
  checkedPids: Set<number>;
  onSetChecked: (processes: ProcessInfo[], checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const checkedCount = selectable.filter((process) => checkedPids.has(process.pid)).length;
  const all = selectable.length > 0 && checkedCount === selectable.length;
  const some = checkedCount > 0 && !all;

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = some;
    }
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      disabled={selectable.length === 0}
      onChange={() => onSetChecked(selectable, !all)}
      aria-label="Select all shown processes"
    />
  );
}

export function ProcessTable({
  groups,
  conflictPorts,
  expandedGroups,
  onToggleGroup,
  isStale,
  selectedPid,
  stopError,
  onStop,
  checkedPids,
  onSetChecked,
  alertKinds,
}: {
  groups: RenderGroup[];
  conflictPorts: Set<number>;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  isStale: boolean;
  selectedPid: number | null;
  stopError: StopError | null;
  onStop: (process: ProcessInfo) => void;
  /** Rows ticked for a bulk stop. */
  checkedPids: Set<number>;
  onSetChecked: (processes: ProcessInfo[], checked: boolean) => void;
  /** Active resource alerts by PID. */
  alertKinds: Map<number, Set<AlertKind>>;
}) {
  const visibleRows = (group: RenderGroup) =>
    group.processes.length > 1 && !expandedGroups.has(group.key)
      ? group.processes.slice(0, group.primaryCount)
      : group.processes;
  // "Select all" means the rows on screen, not helpers hidden in collapsed groups.
  const selectable = groups.flatMap(visibleRows).filter(isStoppable);
  const rowProps = (process: ProcessInfo, isChild: boolean) => ({
    process,
    isChild,
    isSelected: selectedPid === process.pid,
    isChecked: checkedPids.has(process.pid),
    alertKinds: alertKinds.get(process.pid),
    conflictPorts,
    stopError,
    onStop,
    onToggleCheck: (target: ProcessInfo) => onSetChecked([target], !checkedPids.has(target.pid)),
  });

  return (
    <div className={`table-wrap${isStale ? ' is-stale' : ''}`}>
      <table>
        <thead>
          <tr>
            <th className="col-select">
              <SelectAllCheckbox selectable={selectable} checkedPids={checkedPids} onSetChecked={onSetChecked} />
            </th>
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
                <ProcessRow {...rowProps(group.processes[0], false)} />
              </tbody>
            );
          }

          const expanded = expandedGroups.has(group.key);

          return (
            <tbody key={group.key} className="group">
              <GroupHeader
                group={group}
                expanded={expanded}
                hasConflict={hasConflict}
                onToggle={() => onToggleGroup(group.key)}
              />
              {visibleRows(group).map((process, index) => (
                <ProcessRow key={process.pid} {...rowProps(process, index >= group.primaryCount)} />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
