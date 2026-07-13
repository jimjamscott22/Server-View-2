# Signal Deck Dashboard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing Server-View dashboard presentation to match the approved Signal Deck dark desktop, Dim Workbench light desktop, and dark mobile concepts without changing its monitoring or process-termination behavior.

**Architecture:** Keep API, polling, filtering, grouping, and stop state in `App`, and extract visual regions into focused presentational components. Use one semantic process table whose rows reflow through CSS at mobile widths, one shared anchor navigation that moves from the desktop rail to the mobile bottom bar, and root theme tokens for the two palettes.

**Tech Stack:** React 19.2, TypeScript 5.9, Vite 7, Vitest/Testing Library, Lucide React 0.547.0, Fontsource variable fonts, CSS.

## Global Constraints

- Treat `docs/superpowers/specs/2026-07-13-signal-deck-dashboard-overhaul-design.md` and its three linked concept images as the source of truth.
- Preserve two-second polling, abort/interval cleanup, manual refresh, stale data, search, project grouping, helper expansion, port conflicts, theme persistence, and SIGTERM confirmation.
- Keep the grouped process table as the primary desktop surface; add no charts, fake capacity totals, inert filter buttons, settings UI, or unrelated navigation.
- Desktop concepts are verified at 1440x1000; mobile is verified at 390x844 with no primary horizontal overflow.
- Use only the approved visible copy from the design spec.
- Bind summary values only to `process_count`, `total_memory_mb`, `active_ports`, and currently available group/conflict data.
- Preserve explicit error states and type safety; do not add broad catches, silent success fallbacks, or `any` casts.
- Use Lucide icons through direct named imports with `size`, `strokeWidth={1.75}`, and hidden text inside icon-only buttons.
- Self-host Barlow Condensed, Manrope, and JetBrains Mono with Fontsource imports; use no runtime font CDN.

---

### Task 1: Build the Signal Deck component structure and preserve behavior

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Create: `frontend/src/components/DashboardChrome.tsx`
- Create: `frontend/src/components/ProcessTable.tsx`
- Create: `frontend/src/components/ConfirmStopDialog.tsx`

**Interfaces:**
- Consumes: `ProcessSummary`, `ProcessInfo`, and `RenderGroup` from the existing type/utility modules.
- Produces: `AppNavigation`, `DashboardHeader`, `SummaryBand`, `ProcessToolbar`, `ProcessTable`, and `ConfirmStopDialog` named exports.
- `App` remains the only owner of fetch/polling, query, expanded groups, theme, selected process, and stop request state.

- [ ] **Step 1: Add failing tests for the approved chrome and current-theme label**

Add this test inside the existing `describe('App', ...)` block, using the existing `mockFetch` and `emptyResponse` helpers:

```tsx
test('renders functional navigation and labels the current theme', async () => {
  const user = userEvent.setup();
  mockFetch(emptyResponse);

  render(<App />);
  await screen.findByText('No development processes detected.');

  expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#overview');
  expect(screen.getByRole('link', { name: 'Processes' })).toHaveAttribute('href', '#processes');
  expect(screen.getByRole('link', { name: 'Ports' })).toHaveAttribute('href', '#ports');

  const themeButton = screen.getByRole('button', { name: 'Light theme' });
  await user.click(themeButton);

  expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run from `frontend/`:

```bash
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/vitest/vitest.mjs run src/App.test.tsx
```

Expected: FAIL because the three navigation links do not exist and the existing theme button labels the destination theme instead of the current theme.

- [ ] **Step 3: Install the approved icon and local-font dependencies**

Run from `frontend/`:

```bash
npm install lucide-react@0.547.0 @fontsource-variable/manrope @fontsource-variable/barlow-condensed @fontsource-variable/jetbrains-mono
```

Import the local font CSS before the app stylesheet in `frontend/src/main.tsx`:

```tsx
import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/barlow-condensed/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
```

- [ ] **Step 4: Create the dashboard chrome components**

Create `frontend/src/components/DashboardChrome.tsx` with these exact public props and DOM contracts:

```tsx
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
```

- [ ] **Step 5: Extract the existing process and dialog markup without changing behavior**

Move `Ports`, `ProcessRow`, `GroupHeader`, and `ProcessTable` from `App.tsx` to `frontend/src/components/ProcessTable.tsx`. Export only `ProcessTable`. Preserve current props and behavior, replace text chevrons with Lucide `ChevronDown`/`ChevronRight`, use `Folder` in group headers, and add `data-label` to mobile-reflow cells:

```tsx
<td data-label="Ports"><Ports ports={process.ports} conflictPorts={conflictPorts} /></td>
<td className="num" data-label="CPU">{process.cpu_usage.toFixed(1)}%</td>
<td className="num" data-label="Memory">{process.memory_mb.toFixed(1)} MB</td>
<td className="num" data-label="Uptime">{formatUptime(process.uptime_seconds)}</td>
<td data-label="Status"><span className={statusClass(process.status)}>{process.status}</span></td>
<td className="action-cell" data-label="Action">...</td>
```

Move `ConfirmStopDialog` unchanged in behavior to `frontend/src/components/ConfirmStopDialog.tsx`; export it as a named function.

- [ ] **Step 6: Recompose `App` around the new components**

Keep all existing state, callbacks, effects, derived values, and `handleConfirmStop`. Replace only the returned layout and removed local component definitions:

```tsx
return (
  <div className="dashboard-shell">
    <AppNavigation />
    <main className="app-shell">
      <section id="overview" className="overview-section">
        <DashboardHeader
          theme={theme}
          statusState={statusState}
          statusLabel={statusLabel}
          isRefreshing={isRefreshing}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onRefresh={() => void loadProcesses()}
        />
        <SummaryBand summary={data.summary} />
      </section>
      <section id="processes" className="process-section" aria-label="Processes">
        <ProcessToolbar query={query} onQueryChange={setQuery} />
        {error ? <div className="alert">Error: {error}</div> : null}
        {data.port_conflicts && data.port_conflicts.length > 0 ? <div className="conflict-banner" role="status">{data.port_conflicts.map((conflict) => `Port ${conflict.port} claimed by ${conflict.pids.length} processes`).join(' · ')}</div> : null}
        {isLoading ? <div className="state">Loading processes...</div> : null}
        {!isLoading && visibleProcesses.length === 0 ? <div className="state">{query ? 'No processes match the current filter.' : 'No development processes detected.'}</div> : null}
        {!isLoading && visibleProcesses.length > 0 ? <ProcessTable groups={groups} conflictPorts={conflictPorts} expandedGroups={expandedGroups} onToggleGroup={toggleGroup} isStale={isStale} stopError={stopError} onStop={(process) => { setStopError(null); setSelectedProcess(process); }} /> : null}
      </section>
      {selectedProcess ? <ConfirmStopDialog process={selectedProcess} isStopping={isStopping} error={stopError?.pid === selectedProcess.pid ? stopError.message : null} onCancel={() => setSelectedProcess(null)} onConfirm={() => void handleConfirmStop()} /> : null}
    </main>
  </div>
);
```

- [ ] **Step 7: Run tests and the TypeScript build**

Run from `frontend/`:

```bash
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/vitest/vitest.mjs run
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/typescript/bin/tsc -b
```

Expected: all existing and new tests PASS; TypeScript exits 0.

- [ ] **Step 8: Commit the component architecture**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components
git commit -m "Refactor dashboard into Signal Deck components"
```

---

### Task 2: Implement the approved themes, responsive table, and visual verification

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: class names and `data-label` attributes from Task 1.
- Produces: the complete dark, Dim Workbench, desktop rail, mobile bottom-nav, summary strip, table reflow, state, and dialog presentation.

- [ ] **Step 1: Add a regression test for responsive-safe process cell labels**

In the existing populated-table test, add these assertions after the table renders:

```tsx
const processRow = screen.getByText('npm run dev').closest('tr') as HTMLElement;
expect(within(processRow).getByText('5173').closest('td')).toHaveAttribute('data-label', 'Ports');
expect(within(processRow).getByText('1.2%').closest('td')).toHaveAttribute('data-label', 'CPU');
expect(within(processRow).getByText('running').closest('td')).toHaveAttribute('data-label', 'Status');
```

- [ ] **Step 2: Run the focused test and confirm it fails if Task 1 missed the mobile metadata contract**

```bash
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/vitest/vitest.mjs run src/App.test.tsx
```

Expected before the missing attributes are corrected: FAIL on `data-label`; after Task 1 already implemented them correctly, this step is an immediate PASS and serves as regression coverage.

- [ ] **Step 3: Replace the theme tokens with the approved palette**

Start `styles.css` with this exact token contract, then make all component rules consume only these variables:

```css
:root {
  --bg: #d8e1ea;
  --rail: #c9d5e2;
  --surface: #e7edf3;
  --surface-raised: #dce7f0;
  --surface-band: #d4e0ea;
  --border: #afc1d1;
  --divider: rgba(99, 126, 150, 0.25);
  --row-hover: #d8e6f1;
  --text: #082441;
  --text-muted: #506b84;
  --text-faint: #6d8195;
  --accent: #007fb5;
  --accent-strong: #00658f;
  --accent-soft: rgba(0, 127, 181, 0.12);
  --success: #147c50;
  --success-soft: rgba(20, 124, 80, 0.1);
  --warn: #9b6400;
  --warn-soft: rgba(155, 100, 0, 0.1);
  --warn-border: rgba(155, 100, 0, 0.35);
  --danger: #c83243;
  --danger-strong: #a51f31;
  --danger-soft: rgba(200, 50, 67, 0.1);
  --danger-border: rgba(200, 50, 67, 0.4);
  --shadow-panel: 0 10px 28px rgba(24, 55, 82, 0.12);
  --shadow-dialog: 0 24px 64px rgba(10, 31, 50, 0.3);
  --font-display: "Barlow Condensed Variable", sans-serif;
  --font-sans: "Manrope Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
  --radius-sm: 10px;
  --radius: 12px;
  --radius-pill: 999px;
  color: var(--text);
  background: var(--bg);
  font-family: var(--font-sans);
}

[data-theme="dark"] {
  --bg: #031426;
  --rail: #041a2d;
  --surface: #071f35;
  --surface-raised: #0a2c48;
  --surface-band: #09243c;
  --border: #1b405c;
  --divider: rgba(102, 145, 177, 0.18);
  --row-hover: #0b3150;
  --text: #edf7ff;
  --text-muted: #91a8bc;
  --text-faint: #667e94;
  --accent: #05c8f5;
  --accent-strong: #4edbff;
  --accent-soft: rgba(5, 200, 245, 0.12);
  --success: #6fe89b;
  --success-soft: rgba(111, 232, 155, 0.1);
  --warn: #ffb01f;
  --warn-soft: rgba(255, 176, 31, 0.1);
  --warn-border: rgba(255, 176, 31, 0.42);
  --danger: #ff5964;
  --danger-strong: #ff7b84;
  --danger-soft: rgba(255, 89, 100, 0.1);
  --danger-border: rgba(255, 89, 100, 0.45);
  --shadow-panel: 0 18px 48px rgba(0, 4, 12, 0.28);
  --shadow-dialog: 0 28px 72px rgba(0, 0, 0, 0.58);
}
```

- [ ] **Step 4: Implement the desktop composition and component families**

Use CSS Grid for `.dashboard-shell` with a `156px` rail and flexible content at widths above `1040px`. Keep `.app-navigation` fixed to the viewport edge, `.app-shell` at `min(1400px, 100%)`, `.summary-band` as three open grid columns inside one panel, `.process-toolbar` at a practical `min(640px, 100%)`, and `.table-wrap` as the single dominant panel. Match the concepts with explicit typography, spacing, borders, focus states, chip families, group bands, row hover/selected cyan edge, alerts, and dialog styles. Do not add styles for components absent from the approved spec.

The desktop table must retain these stable widths:

```css
th.col-ports { width: 12%; }
th.col-cpu,
th.col-mem,
th.col-uptime { width: 9%; }
th.col-status { width: 10%; }
th.col-actions { width: 84px; }
```

- [ ] **Step 5: Implement the approved mobile reflow**

At `max-width: 760px`, use this complete structural contract. Existing component-family colors, borders, typography, radii, focus states, and spacing continue to inherit from the desktop rules and theme tokens; do not introduce mobile-only colors or components:

```css
@media (max-width: 760px) {
  body { padding-bottom: 78px; }
  .dashboard-shell { display: block; }
  .app-navigation { inset: auto 0 0; width: 100%; height: 72px; flex-direction: row; z-index: 20; }
  .nav-brand { display: none; }
  .nav-links { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
  .nav-link { min-height: 72px; flex-direction: column; justify-content: center; gap: 4px; }
  .app-shell { width: 100%; padding: 20px 16px 28px; }
  .dashboard-header { align-items: flex-start; display: grid; grid-template-columns: 1fr auto; }
  .header-titles p { display: none; }
  .header-controls .control-button span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .summary-band { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 78vw); overflow-x: auto; scroll-snap-type: x mandatory; }
  .summary-metric { scroll-snap-align: start; }
  .process-toolbar { width: 100%; }
  table, tbody, tr, td { display: block; width: 100%; }
  table { min-width: 0; }
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .group-row td { display: block; }
  tbody tr:not(.group-row) { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px 12px; padding: 14px 12px; }
  tbody tr:not(.group-row) > td { border: 0; padding: 0; }
  tbody tr:not(.group-row) > td:first-child { grid-column: 1 / -1; }
  tbody tr:not(.group-row) > td.num { display: inline-flex; gap: 6px; color: var(--text-muted); }
  tbody tr:not(.group-row) > td.num::before { content: attr(data-label); color: var(--text-faint); font-size: 0.68rem; font-weight: 700; text-transform: uppercase; }
  .action-cell { justify-self: end; }
  .group-path { flex-basis: 100%; }
}
```

Add a tablet breakpoint from `761px` through `1040px` that collapses the rail to icons while retaining the desktop table.

- [ ] **Step 6: Run the complete automated verification**

Run from `frontend/`:

```bash
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/vitest/vitest.mjs run
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/typescript/bin/tsc -b
/home/jimjamscozz/.lmstudio/.internal/utils/node node_modules/vite/bin/vite.js build
```

Run from the repository root:

```bash
backend/.venv/bin/python -m pytest backend/tests
```

Expected: all frontend and backend tests PASS; TypeScript and Vite build exit 0.

- [ ] **Step 7: Verify the rendered product and iterate to concept fidelity**

Start the backend on `127.0.0.1:8008` and frontend on `127.0.0.1:5178`. Because no Browser/IAB tool is available in this session, use Playwright or headless Chrome to capture dark/light desktop at 1440x1000 and dark mobile at 390x844. Exercise search, group expansion, theme toggle, refresh, and Stop-dialog cancel. Compare screenshots against the three approved concept assets with `view_image`, correct visible drift, and record at least five comparison points in a temporary fidelity ledger. Remove temporary screenshots and the ledger after the final comparison.

- [ ] **Step 8: Commit the visual implementation**

```bash
git add frontend/src/styles.css frontend/src/App.test.tsx
git commit -m "Apply Signal Deck responsive styling"
```
