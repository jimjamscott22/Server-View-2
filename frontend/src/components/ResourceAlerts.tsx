import { BellRing, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { DEFAULT_ALERT_SETTINGS, UPDATE_INTERVAL_SECONDS, describeAlert } from '../alerts';
import type { AlertSettings, ResourceAlert } from '../alerts';

function AlertSettingsForm({
  settings,
  onSave,
  onClose,
}: {
  settings: AlertSettings;
  onSave: (settings: AlertSettings) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [cpu, setCpu] = useState(String(settings.cpuPercent));
  const [memory, setMemory] = useState(String(settings.memoryMb));
  const [seconds, setSeconds] = useState(String(settings.sustainUpdates * UPDATE_INTERVAL_SECONDS));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sustainSeconds = Number(seconds);
    onSave({
      enabled,
      cpuPercent: Number(cpu) > 0 ? Number(cpu) : DEFAULT_ALERT_SETTINGS.cpuPercent,
      memoryMb: Number(memory) > 0 ? Number(memory) : DEFAULT_ALERT_SETTINGS.memoryMb,
      sustainUpdates:
        sustainSeconds > 0
          ? Math.max(1, Math.round(sustainSeconds / UPDATE_INTERVAL_SECONDS))
          : DEFAULT_ALERT_SETTINGS.sustainUpdates,
    });
    onClose();
  }

  return (
    <form className="alert-settings" aria-label="Alert settings" onSubmit={handleSubmit}>
      <label className="alert-toggle" htmlFor={`${id}-enabled`}>
        <input id={`${id}-enabled`} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Alert on high resource use
      </label>
      <div className="alert-fields">
        <label htmlFor={`${id}-cpu`}>
          CPU above (%)
          <input id={`${id}-cpu`} type="number" min="1" step="1" inputMode="numeric" value={cpu} disabled={!enabled} onChange={(event) => setCpu(event.target.value)} />
        </label>
        <label htmlFor={`${id}-memory`}>
          Memory above (MB)
          <input id={`${id}-memory`} type="number" min="1" step="1" inputMode="numeric" value={memory} disabled={!enabled} onChange={(event) => setMemory(event.target.value)} />
        </label>
        <label htmlFor={`${id}-seconds`}>
          For at least (seconds)
          <input id={`${id}-seconds`} type="number" min={UPDATE_INTERVAL_SECONDS} step={UPDATE_INTERVAL_SECONDS} inputMode="numeric" value={seconds} disabled={!enabled} onChange={(event) => setSeconds(event.target.value)} />
        </label>
      </div>
      <p className="alert-hint">CPU is a percent of one core, so a busy multi-threaded process can go past 100%.</p>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" type="submit">Save</button>
      </div>
    </form>
  );
}

/** Banner for processes over the alert limits, plus the settings that define those limits. */
export function ResourceAlerts({
  alerts,
  settings,
  onSettingsChange,
}: {
  alerts: ResourceAlert[];
  settings: AlertSettings;
  onSettingsChange: (settings: AlertSettings) => void;
}) {
  const [editing, setEditing] = useState(false);
  const summary = settings.enabled
    ? `Alerts at ${settings.cpuPercent}% CPU or ${settings.memoryMb} MB for ${settings.sustainUpdates * UPDATE_INTERVAL_SECONDS}s`
    : 'Resource alerts are off';

  return (
    <div className="resource-alerts">
      <div className="alert-bar">
        <span className="alert-summary">{summary}</span>
        <button className="control-button" type="button" aria-expanded={editing} onClick={() => setEditing((current) => !current)}>
          <SlidersHorizontal size={16} strokeWidth={1.7} aria-hidden="true" />
          Alert settings
        </button>
      </div>
      {editing ? <AlertSettingsForm settings={settings} onSave={onSettingsChange} onClose={() => setEditing(false)} /> : null}
      {/* Polite live region: announced when the set of alerts changes, without interrupting. */}
      <div role="status" aria-live="polite">
        {alerts.length > 0 ? (
          <div className="resource-alert-banner">
            <BellRing size={17} strokeWidth={1.8} aria-hidden="true" />
            <ul>
              {alerts.map((alert) => (
                <li key={`${alert.pid}-${alert.kind}`}>{describeAlert(alert)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
