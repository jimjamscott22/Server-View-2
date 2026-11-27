import { useLayoutEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import type { ProcessInfo, StopResult } from '../types';

/**
 * Confirms stopping every selected process. Same modal behaviour as
 * ConfirmStopDialog: focus starts on Cancel, Escape cancels, and focus goes
 * back to the button that opened it.
 */
export function BulkStopDialog({
  processes,
  isStopping,
  error,
  failures,
  onCancel,
  onConfirm,
}: {
  processes: ProcessInfo[];
  isStopping: boolean;
  /** The whole request failed (for example, rate limited). */
  error: string | null;
  /** Per-process failures from the last attempt, keyed by PID. */
  failures: Map<number, StopResult>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      dialog.showModal();
    }
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!isStopping) {
      onCancel();
    }
  }

  const count = processes.length;
  const databases = processes.filter((process) => process.category === 'database').length;
  const retrying = failures.size > 0;

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="bulk-stop-title" onCancel={handleCancel}>
      <h2 id="bulk-stop-title">
        {retrying ? `${count} process${count === 1 ? '' : 'es'} didn’t stop` : `Stop ${count} process${count === 1 ? '' : 'es'}?`}
      </h2>
      <p>
        {retrying
          ? 'The others were stopped. These failed, for the reasons shown:'
          : 'Each one gets a terminate request (SIGTERM on Unix, TerminateProcess on Windows).'}
      </p>
      <ul className="bulk-stop-list">
        {processes.map((process) => {
          const failure = failures.get(process.pid);
          return (
            <li key={process.pid}>
              <strong>{process.name}</strong> <span className="muted">PID {process.pid}</span>
              {process.ports.length > 0 ? <span className="muted"> · :{process.ports.join(', :')}</span> : null}
              {failure ? <div className="stop-error">{failure.message}</div> : null}
            </li>
          );
        })}
      </ul>
      {databases > 0 && !retrying ? (
        <p className="dialog-note">
          {databases === 1 ? 'One of these is a database server.' : `${databases} of these are database servers.`} Clients
          connected to it will lose their connection, and a system service manager may start it again.
        </p>
      ) : null}
      {error ? (
        <p className="dialog-error" role="alert">
          Couldn’t stop the processes: {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={isStopping}>
          {retrying ? 'Close' : 'Cancel'}
        </button>
        <button className="danger" type="button" onClick={onConfirm} disabled={isStopping}>
          {isStopping ? 'Stopping...' : retrying ? 'Try again' : `Stop ${count} process${count === 1 ? '' : 'es'}`}
        </button>
      </div>
    </dialog>
  );
}
