import {
  Cpu,
  House,
  Layers3,
  Moon,
  Network,
  Plug,
  RefreshCw,
  Search,
  Sun,
} from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import type { ProcessSummary } from '../types';

type Theme = 'light' | 'dark';
type StatusState = 'live' | 'refreshing' | 'stale';

const navItems = [
  { href: '#overview', label: 'Overview', Icon: House },
  { href: '#processes', label: 'Processes', Icon: Layers3 },
  { href: '#ports', label: 'Ports', Icon: Plug },
] as const;

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">SV</span>;
}

export function AppNavigation() {
  return (
    <nav className="app-navigation" aria-label="Dashboard sections">
      <a className="nav-brand" href="#overview" aria-label="Server-View overview"><BrandMark /></a>
      <div className="nav-links">
        {navItems.map(({ href, label, Icon }) => (
          <a className="nav-link" href={href} aria-current={label === 'Processes' ? 'page' : undefined} key={href}>
            <Icon size={20} strokeWidth={1.75} />
            <span>{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

export function DashboardHeader({
  theme,
  statusState,
  statusLabel,
  isRefreshing,
  onToggleTheme,
  onRefresh,
}: {
  theme: Theme;
  statusState: StatusState;
  statusLabel: string;
  isRefreshing: boolean;
  onToggleTheme: () => void;
  onRefresh: () => void;
}) {
  const ThemeIcon = theme === 'dark' ? Moon : Sun;
  return (
    <header className="dashboard-header">
      <div className="header-titles">
        <h1>Server-View</h1>
        <p>Local development processes and listening ports.</p>
      </div>
      <div className="header-controls">
        <span className="status-pill" data-state={statusState} role="status" aria-live="polite">{statusLabel}</span>
        <button className="control-button" type="button" onClick={onToggleTheme} aria-pressed={theme === 'dark'}>
          <ThemeIcon size={18} strokeWidth={1.75} />
          <span>{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>
        </button>
        <button className="control-button" type="button" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw size={18} strokeWidth={1.75} className={isRefreshing ? 'is-spinning' : undefined} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>
    </header>
  );
}

function SummaryMetric({ icon, label, value, id }: { icon: ReactNode; label: string; value: string; id?: string }) {
  return <article className="summary-metric" id={id}><span className="metric-icon">{icon}</span><span><span className="metric-label">{label}</span><strong>{value}</strong></span></article>;
}

export function SummaryBand({ summary }: { summary: ProcessSummary }) {
  return (
    <section className="summary-band" aria-label="Process summary">
      <SummaryMetric icon={<Layers3 size={25} strokeWidth={1.75} />} label="Processes" value={String(summary.process_count)} />
      <SummaryMetric icon={<Cpu size={25} strokeWidth={1.75} />} label="Memory" value={`${summary.total_memory_mb.toFixed(1)} MB`} />
      <SummaryMetric id="ports" icon={<Network size={25} strokeWidth={1.75} />} label="Listening ports" value={String(summary.active_ports.length)} />
    </section>
  );
}

export function ProcessToolbar({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) { onQueryChange(event.target.value); }
  return <div className="process-toolbar"><label className="visually-hidden" htmlFor="process-search">Search</label><Search size={19} strokeWidth={1.75} aria-hidden="true" /><input id="process-search" type="search" placeholder="Name, command, cwd, port, or PID" value={query} onChange={handleChange} /></div>;
}
