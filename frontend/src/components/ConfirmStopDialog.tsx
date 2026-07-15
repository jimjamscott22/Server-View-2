import type { ProcessInfo } from '../types';

export function ConfirmStopDialog({
  process,
  isStopping,
  error,
  onCancel,
  onConfirm,
}: {
  process: ProcessInfo;
  isStopping: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="stop-title">
        <h2 id="stop-title">Stop process?</h2>
        <p>
          Stop <strong>{process.name}</strong> with PID {process.pid}? This sends a terminate
          request (SIGTERM on Unix, TerminateProcess on Windows).
        </p>
        {error ? (
          <p className="dialog-error" role="alert">
            Couldn’t stop the process: {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={isStopping}>
            Cancel
          </button>
          <button className="danger" type="button" onClick={onConfirm} disabled={isStopping}>
            {isStopping ? 'Stopping...' : 'Stop process'}
          </button>
        </div>
      </section>
    </div>
  );
}
