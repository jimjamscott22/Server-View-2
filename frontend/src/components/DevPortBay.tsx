import type { DevPortSlot } from '../processUtils';
import type { ProcessInfo } from '../types';

export function DevPortBay({
  slots,
  onStop,
}: {
  slots: DevPortSlot[];
  onStop: (process: ProcessInfo) => void;
}) {
  const occupied = slots.filter((slot) => slot.process).length;

  return (
    <section id="dev-ports" className="dev-port-bay" aria-label="Common development ports">
      <header className="dev-port-bay-head">
        <div>
          <p className="eyebrow">Port bay</p>
          <h2>Common dev ports</h2>
        </div>
        <p className="dev-port-bay-meta">
          <span className="dev-port-bay-count">{occupied}</span>
          <span>of {slots.length} claimed</span>
        </p>
      </header>
      <div className="dev-port-slots">
        {slots.map((slot) => {
          const occupiedSlot = Boolean(slot.process);
          const className = [
            'dev-port-slot',
            occupiedSlot ? 'is-occupied' : 'is-free',
            slot.conflict ? 'is-conflict' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (!occupiedSlot) {
            return (
              <div className={className} key={slot.port}>
                <span className="dev-port-led" aria-hidden="true" />
                <span className="dev-port-identity">
                  <span className="dev-port-number">
                    <small>TCP</small>
                    {slot.port}
                  </span>
                  <span className="dev-port-role">{slot.role}</span>
                </span>
                <span className="dev-port-detail">
                  <strong>available</strong>
                  <small>{slot.hint}</small>
                </span>
              </div>
            );
          }

          const process = slot.process!;
          return (
            <button
              className={className}
              type="button"
              key={slot.port}
              aria-label={`TCP ${slot.port} ${process.name} · PID ${process.pid}${slot.conflict ? ' · conflict' : ''}`}
              onClick={() => onStop(process)}
            >
              <span className="dev-port-led" aria-hidden="true" />
              <span className="dev-port-identity">
                <span className="dev-port-number">
                  <small>TCP</small>
                  {slot.port}
                </span>
                <span className="dev-port-role">{slot.role}</span>
              </span>
              <span className="dev-port-detail">
                <strong>{process.name}</strong>
                <small>
                  {slot.projectLabel ?? 'Ungrouped'} · PID {process.pid}
                  {slot.conflict ? ' · conflict' : ''}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
