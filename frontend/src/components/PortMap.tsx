import { Server } from 'lucide-react';
import type { RenderGroup } from '../processUtils';
import type { ProcessInfo } from '../types';

type PortOwner = { port: number; process: ProcessInfo; group: RenderGroup };

export function PortMap({
  groups,
  hostName,
  onStop,
}: {
  groups: RenderGroup[];
  hostName: string;
  onStop: (process: ProcessInfo) => void;
}) {
  const owners: PortOwner[] = groups
    .flatMap((group) => group.processes.flatMap((process) => process.ports.map((port) => ({ port, process, group }))))
    .sort((a, b) => a.port - b.port);

  return (
    <div className="port-map-layout">
      <section className="port-map" aria-label="Listening port owners">
        <div className="host-node">
          <Server size={22} strokeWidth={1.6} />
          <span className="eyebrow">{hostName.toUpperCase()}</span>
          <strong>127.0.0.1</strong>
          <small>{owners.length} open ports</small>
        </div>
        <div className="port-nodes">
          {owners.map(({ port, process, group }) => (
            <button
              className="port-node"
              type="button"
              aria-label={`TCP ${port} ${group.label} ${process.name} · PID ${process.pid} ${process.status}`}
              onClick={() => onStop(process)}
              key={`${process.pid}:${port}`}
            >
              <span className="port-number"><small>TCP</small>{port}</span>
              <span className="port-owner"><strong>{group.label}</strong><small>{process.name} · PID {process.pid}</small></span>
              <span className={process.status.toLowerCase().includes('run') ? 'status status-ok' : 'status'}>{process.status}</span>
            </button>
          ))}
        </div>
      </section>
      <aside className="port-legend">
        <p className="eyebrow">How to read it</p>
        <h3>One host. Every open door.</h3>
        <p>Each line connects a listening TCP port to the process and project that owns it. Select any node to inspect or stop that process.</p>
        <ul><li>Frontend</li><li>Backend</li><li>Tooling</li></ul>
      </aside>
    </div>
  );
}
