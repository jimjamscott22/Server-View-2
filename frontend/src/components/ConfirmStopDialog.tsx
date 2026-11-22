import { useLayoutEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import type { ProcessInfo } from '../types';

/**
 * Native modal <dialog>: showModal() traps focus, makes the page behind it
 * inert, and turns Escape into a `cancel` event. Cancel gets focus first so
 * the safe choice is the default for keyboard users.
 */
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Layout effect so the cleanup runs before React removes the element,
  // letting us close it and hand focus back to the Stop button that opened it.
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
    // Keep the dialog's lifetime in React state rather than letting the browser close it.
    event.preventDefault();
    if (!isStopping) {
      onCancel();
    }
  }

  if (process.category === 'docker') {
    return (
      <dialog ref={dialogRef} className="dialog" aria-labelledby="stop-title" onCancel={handleCancel}>
        <h2 id="stop-title">Managed by Docker</h2>
        <p>
          <strong>{process.name}</strong> (PID {process.pid}) forwards
          {process.ports.length > 0 ? ` port ${process.ports.join(', ')}` : ' a port'} to a Docker
          container. Stopping it would drop the port mapping and leave the container running, so
          stop the container with <code>docker stop</code> instead.
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Close
          </button>
        </div>
      </dialog>
    );
  }

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="stop-title" onCancel={handleCancel}>
      <h2 id="stop-title">Stop process?</h2>
      <p>
        Stop <strong>{process.name}</strong> with PID {process.pid}? This sends a terminate
        request (SIGTERM on Unix, TerminateProcess on Windows).
      </p>
      {process.category === 'database' ? (
        <p className="dialog-note">
          This is a database server. Clients connected to it will lose their connection, and a
          system service manager may start it again.
        </p>
      ) : null}
      {error ? (
        <p className="dialog-error" role="alert">
          Couldn’t stop the process: {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={isStopping}>
          Cancel
        </button>
        <button className="danger" type="button" onClick={onConfirm} disabled={isStopping}>
          {isStopping ? 'Stopping...' : 'Stop process'}
        </button>
      </div>
    </dialog>
  );
}
