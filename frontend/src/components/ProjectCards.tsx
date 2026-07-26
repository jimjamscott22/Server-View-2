import { Folder, MoreHorizontal } from 'lucide-react';
import type { RenderGroup } from '../processUtils';
import type { ProcessInfo } from '../types';

export function ProjectCards({
  groups,
  isStale,
  onStop,
}: {
  groups: RenderGroup[];
  isStale: boolean;
  onStop: (process: ProcessInfo) => void;
}) {
  return (
    <div className={`project-grid${isStale ? ' is-stale' : ''}`}>
      {groups.map((group) => (
        <article className="project-card" key={group.key}>
          <header className="project-card-head">
            <span className="project-icon"><Folder size={18} strokeWidth={1.7} /></span>
            <span className="project-title">
              <strong>{group.label}</strong>
              <small>{group.projectPath ?? 'Working directory unavailable'}</small>
            </span>
            <span className="active-label">Active</span>
          </header>
          <dl className="project-stats">
            <div><dt>Services</dt><dd>{group.processes.length}</dd></div>
            <div><dt>Memory</dt><dd>{group.totalMemoryMb.toFixed(1)} MB</dd></div>
            <div><dt>Ports</dt><dd>{group.ports.length}</dd></div>
          </dl>
          <div className="project-processes">
            {group.processes.map((process) => (
              <div className="project-process" key={process.pid}>
                <span className="service-type">{process.ports.some((port) => port < 7000) ? 'F' : 'B'}</span>
                <span><strong>{process.name}</strong><small>PID {process.pid} · {process.memory_mb.toFixed(1)} MB</small></span>
                {process.ports[0] ? <span className="port">:{process.ports[0]}</span> : null}
                <button className="icon-button" type="button" aria-label={`Stop ${process.name}`} onClick={() => onStop(process)}>
                  <MoreHorizontal size={18} />
                </button>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
