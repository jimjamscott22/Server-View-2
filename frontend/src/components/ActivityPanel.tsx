import { CirclePlay, CircleStop } from 'lucide-react';
import { formatRelativeTime } from '../processUtils';
import type { HistoryEvent } from '../types';

function projectName(cwd: string | null): string | null {
  if (!cwd) {
    return null;
  }
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** Recent starts and stops, from the agent's history database. */
export function ActivityPanel({
  events,
  error,
  nowMs,
}: {
  events: HistoryEvent[];
  error: string | null;
  nowMs: number;
}) {
  return (
    <section id="activity" className="activity-panel" aria-label="Recent activity">
      <header className="dev-port-bay-head">
        <div>
          <p className="eyebrow">History</p>
          <h2>Recent activity</h2>
        </div>
        <p className="dev-port-bay-meta">
          <span>Kept for 7 days</span>
        </p>
      </header>
      {error ? <div className="state">History unavailable: {error}</div> : null}
      {!error && events.length === 0 ? (
        <div className="state">No starts or stops recorded yet. They appear here as dev servers come and go.</div>
      ) : null}
      {events.length > 0 ? (
        <ol className="activity-list">
          {events.map((event) => {
            const Icon = event.kind === 'started' ? CirclePlay : CircleStop;
            const project = projectName(event.cwd);
            return (
              <li className={`activity-item is-${event.kind}`} key={`${event.kind}-${event.pid}-${event.started_at}`}>
                <Icon className="activity-icon" size={17} strokeWidth={1.8} aria-hidden="true" />
                <span className="activity-copy">
                  <strong>{event.name}</strong>{' '}
                  {event.kind === 'started' ? 'started' : 'stopped'}
                  {event.ports.length > 0 ? ` on :${event.ports.join(', :')}` : ''}
                  {project ? <span className="activity-project"> · {project}</span> : null}
                  <code>{event.command}</code>
                </span>
                <time className="activity-time" dateTime={new Date(event.time * 1000).toISOString()} title={new Date(event.time * 1000).toLocaleString()}>
                  {formatRelativeTime(event.time, nowMs)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
