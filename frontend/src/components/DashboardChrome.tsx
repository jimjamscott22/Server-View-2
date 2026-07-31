import {
  Columns3,
  Cpu,
  Grid2X2,
  House,
  Layers3,
  ListTree,
  Network,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { COMMON_DEV_PORTS } from '../processUtils';
import type { ProcessSummary } from '../types';

export type ViewMode = 'table' | 'cards' | 'ports';
type StatusState = 'live' | 'refreshing' | 'stale';

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">SV</span>;
}

export function AppNavigation({
  summary,
  isOnline,
}: {
  summary: ProcessSummary;
  isOnline: boolean;
}) {
  const commonPortCount = summary.active_ports.filter((port) =>
    (COMMON_DEV_PORTS as readonly number[]).includes(port),
  ).length;

  const navItems: Array<{
    href: string;
    label: string;
    Icon: typeof House;
    count?: number;
  }> = [
    { href: '#overview', label: 'Overview', Icon: House },
    { href: '#dev-ports', label: 'Dev ports', Icon: Network, count: commonPortCount },
    { href: '#workspace', label: 'Processes', Icon: Layers3, count: summary.process_count },
  ];

  return (
    <aside className="app-navigation">
      <a className="nav-brand" href="#overview" aria-label="Server-View overview">
        <BrandMark />
        <span className="brand-copy">
          <strong>SERVER-VIEW</strong>
          <small>LOCAL COMMAND CENTER</small>
        </span>
      </a>
      <nav className="nav-links" aria-label="Main navigation">
        {navItems.map(({ href, label, Icon, count }) => (
          <a className="nav-link" href={href} aria-label={label} aria-current={label === 'Processes' ? 'page' : undefined} key={label}>
            <Icon size={18} strokeWidth={1.7} />
            <span>{label}</span>
            {count !== undefined ? <span className="nav-count">{count}</span> : null}
          </a>
        ))}
      </nav>
      <div className="agent-status">
        <span className={isOnline ? 'online-dot' : 'online-dot is-offline'} />
        <span><strong>{isOnline ? 'Agent online' : 'Agent reconnecting'}</strong><small>127.0.0.1:8008</small></span>
      </div>
    </aside>
  );
}

export function DashboardHeader({
  hostName,
  statusState,
  statusLabel,
  isRefreshing,
  compact,
  onToggleCompact,
  onRefresh,
}: {
  hostName: string;
  statusState: StatusState;
  statusLabel: string;
  isRefreshing: boolean;
  compact: boolean;
  onToggleCompact: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="dashboard-header">
      <div className="hero-copy">
        <p className="eyebrow">WORKSTATION / {hostName.toUpperCase()}</p>
        <h1>Local services, <em>clearly.</em></h1>
        <p className="hero-description">
          A focused command center for organizing the same live process data.
        </p>
      </div>
      <div className="header-controls">
        <span className="status-pill" data-state={statusState} role="status" aria-live="polite">{statusLabel}</span>
        <button className="control-button" type="button" aria-pressed={compact} onClick={onToggleCompact}>
          <Columns3 size={17} strokeWidth={1.7} />
          <span>{compact ? 'Comfortable' : 'Compact'}</span>
        </button>
        <button className="control-button" type="button" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw size={17} strokeWidth={1.7} className={isRefreshing ? 'is-spinning' : undefined} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>
    </header>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  detail,
  id,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  id?: string;
}) {
  return (
    <article className="summary-metric" id={id}>
      <span className="metric-icon">{icon}</span>
      <span className="metric-copy">
        <span className="metric-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
    </article>
  );
}

export function SummaryBand({ summary, isOnline }: { summary: ProcessSummary; isOnline: boolean }) {
  const conflicts = summary.conflict_count ?? 0;
  const healthScore = isOnline ? (conflicts > 0 ? 86 : 98) : 68;
  return (
    <section className="summary-band" aria-label="System summary">
      <SummaryMetric
        icon={<Layers3 size={22} strokeWidth={1.7} />}
        label="Processes"
        value={String(summary.process_count)}
        detail={`across ${summary.group_count ?? 0} projects`}
      />
      <SummaryMetric
        icon={<Cpu size={22} strokeWidth={1.7} />}
        label="Memory"
        value={`${summary.total_memory_mb.toFixed(1)} MB`}
        detail={`${(summary.memory_percent ?? 0).toFixed(1)}% of system RAM`}
      />
      <SummaryMetric
        id="ports"
        icon={<Network size={22} strokeWidth={1.7} />}
        label="Listening ports"
        value={String(summary.active_ports.length)}
        detail={conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} detected` : 'no conflicts detected'}
      />
      <article className="summary-metric health-metric">
        <span className="health-ring" style={{ '--health': healthScore } as React.CSSProperties}>{healthScore}</span>
        <span className="metric-copy">
          <span className="metric-label">Dev health</span>
          <strong>{healthScore > 90 ? 'Excellent' : healthScore > 75 ? 'Good' : 'Attention'}</strong>
          <small>{isOnline ? 'All services responding' : 'Agent connection degraded'}</small>
        </span>
      </article>
    </section>
  );
}

const modeMeta: Record<ViewMode, { label: string; kicker: string; heading: string; Icon: typeof ListTree }> = {
  table: { label: 'Grouped table', kicker: 'Precision view', heading: 'Scan every process at once', Icon: ListTree },
  cards: { label: 'Project cards', kicker: 'Project view', heading: 'See services in their project context', Icon: Grid2X2 },
  ports: { label: 'Port map', kicker: 'Network view', heading: 'Follow ports back to their owners', Icon: Network },
};

export function WorkspaceHeader({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="workspace-heading">
      <div>
        <p className="eyebrow">{modeMeta[mode].kicker}</p>
        <h2>{modeMeta[mode].heading}</h2>
      </div>
      <div className="view-tabs" role="tablist" aria-label="Choose a viewing mode">
        {(Object.entries(modeMeta) as [ViewMode, (typeof modeMeta)[ViewMode]][]).map(([value, meta]) => (
          <button
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? 'view-tab is-active' : 'view-tab'}
            onClick={() => onModeChange(value)}
            key={value}
          >
            <meta.Icon size={16} strokeWidth={1.7} />
            {meta.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProcessToolbar({
  query,
  showing,
  total,
  onQueryChange,
}: {
  query: string;
  showing: number;
  total: number;
  onQueryChange: (value: string) => void;
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onQueryChange(event.target.value);
  }
  return (
    <div className="toolbar-row">
      <div className="process-toolbar">
        <label className="visually-hidden" htmlFor="process-search">Search</label>
        <Search size={17} strokeWidth={1.7} aria-hidden="true" />
        <input
          id="process-search"
          type="search"
          placeholder="Search name, command, directory, port, or PID"
          value={query}
          onChange={handleChange}
        />
      </div>
      <span className="showing-count">SHOWING {showing} OF {total}</span>
    </div>
  );
}
