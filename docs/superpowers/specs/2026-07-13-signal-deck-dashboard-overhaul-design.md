# Server-View Signal Deck Dashboard Overhaul

Date: 2026-07-13
Status: Approved for implementation

## Goal

Restyle the existing Server-View React dashboard into the approved Signal Deck interface while preserving its local-first process-monitoring behavior. The redesign keeps the grouped process table as the primary workspace, adds a slim functional navigation rail, and supports coordinated dark, Dim Workbench light, and mobile layouts.

## Approved Concepts

- Dark desktop: [signal-deck-dark-desktop.png](assets/signal-deck-dark-desktop.png)
- Dim Workbench desktop: [signal-deck-dim-workbench-desktop.png](assets/signal-deck-dim-workbench-desktop.png)
- Dark mobile: [signal-deck-dark-mobile.png](assets/signal-deck-dark-mobile.png)

The dark desktop concept is the primary layout specification. The revised Dim Workbench concept is the light-theme color specification. The mobile concept defines responsive reflow. Sample values in the concepts are illustrative; production values continue to come from the existing API.

## Scope

### Included

- Preserve automatic two-second polling, manual refresh, stale-data treatment, search, project grouping, helper expansion, port conflicts, theme persistence, and SIGTERM confirmation.
- Add a slim desktop navigation rail and mobile bottom navigation using functional in-page anchors for Overview, Processes, and Ports.
- Recompose the header, summary metrics, search control, grouped process table, alerts, empty/loading states, and confirmation dialog in the approved design system.
- Convert the desktop table into readable stacked process rows at narrow widths without losing data or forcing primary horizontal scrolling.
- Use code-native text, controls, icons, table data, and interaction states.

### Excluded

- No charts, historical analytics, fake capacity totals, or invented process metrics.
- No backend contract or process-kill behavior changes.
- No new settings surface, authentication, remote monitoring, or multi-host navigation.
- No decorative marketing sections, bento-card dashboard, or raster screenshot used as UI.

## Information Architecture

### Desktop

1. A fixed-width left rail contains the SV mark and anchor links for Overview, Processes, and Ports. Processes is visually active because the process workspace is the primary task.
2. A quiet top header contains Server-View, the existing subtitle, live/refreshing/stale state, the current theme control, and manual refresh.
3. One summary band contains the three real metrics already returned by the API: process count, total memory, and listening port count. Optional group/conflict counts may appear only when supplied or derived from the current response.
4. A prominent search field precedes the process table. No inert filter button will be added.
5. The grouped process table remains the dominant surface. Project headers, primary rows, helper rows, port conflicts, restricted rows, and Stop actions keep their current semantics.
6. Alerts, conflict messages, loading/empty states, and the confirmation dialog use the same visual language.

### Mobile

1. The desktop rail becomes a fixed bottom navigation bar with the same three functional anchors.
2. The header keeps the brand, live state, theme toggle, and refresh as touch-sized controls.
3. Summary metrics become a horizontally scrollable, snap-aligned strip.
4. Search becomes full width.
5. Table headers are hidden visually and each process row becomes a structured grid: process identity and command first; port, status, and Stop action next; CPU, memory, and uptime in a compact metadata line.
6. Group headers remain expandable and helper counts remain visible.

## Visual System

### Typography

- Brand and major headings: Barlow Condensed, weight 600-700, tight tracking.
- UI chrome and content: Manrope variable, weight 450-750.
- Commands, paths, ports, and numeric technical metadata: JetBrains Mono variable.
- Controls receive explicit font size, weight, tracking, and line height; no browser-default typography.

The font files should be installed through Fontsource packages and imported locally so the dashboard does not depend on a runtime CDN.

### Dark Theme Tokens

- Page: deep navy-black, approximately `#031426`.
- Rail: darker ink navy, approximately `#041A2D`.
- Primary surface: ink blue, approximately `#071F35`.
- Raised/selected surface: approximately `#0A2C48`.
- Border/divider: blue-gray with low opacity, approximately `#1B405C`.
- Text: cool near-white `#EDF7FF`; muted `#91A8BC`; faint `#667E94`.
- Accent: electric cyan `#05C8F5`; accent-soft is a low-opacity cyan wash.
- Healthy: mint `#6FE89B`; warning: amber `#FFB01F`; danger/conflict: coral `#FF5964`.

### Dim Workbench Theme Tokens

- Page: cool blue-gray, approximately `#D8E1EA`.
- Rail: medium-light slate, approximately `#C9D5E2`.
- Primary surface: pale steel, approximately `#E7EDF3`.
- Raised/selected surface: approximately `#DCE7F0`.
- Table/group band: approximately `#D4E0EA`.
- Border/divider: cool blue-gray, approximately `#AFC1D1`.
- Text: dark navy `#082441`; muted `#506B84`; faint `#6D8195`.
- Cyan, mint, amber, and coral retain their semantic roles at reduced saturation.
- The theme must remain visibly lighter than dark mode without using a white or near-white page background.

### Geometry And Elevation

- Main radii: 10px controls, 12px panels, 999px semantic chips.
- Borders are hairline and cool-toned; selection is communicated with cyan edge emphasis rather than heavy glow.
- Shadows are directional and restrained. Dark mode uses depth primarily through surface contrast; light mode uses soft low-contrast shadow.
- The page uses one purposeful workspace frame and open bands. Avoid nested card grids.

### Icon System

- Use one rounded-outline family at an optical 1.75px stroke.
- Icons: brand mark, overview/home, processes/layers, ports/plug, theme/sun-moon, refresh, search, folder, disclosure chevron, memory/chip, and listening-port target.
- Prefer Lucide React where the metaphor and stroke match the concepts. Create only the SV brand mark as a small code-native SVG/CSS mark.
- All icon-only buttons require accessible names and 44px mobile hit targets.

## Component Architecture

- `App`: owns API data, polling, theme, search, selected process, stop state, and derived groups/conflicts.
- `AppNavigation`: renders the desktop rail and mobile bottom navigation from one shared anchor definition.
- `DashboardHeader`: renders product identity, connection status, theme control, and refresh.
- `SummaryBand` and `SummaryMetric`: render real API-backed metrics and their responsive strip behavior.
- `ProcessToolbar`: owns the labelled search field presentation.
- `ProcessTable`: renders group sections, desktop columns, and responsive row layout.
- `ProcessGroupHeader`: owns disclosure state and group metadata.
- `ProcessRow`: renders process identity, command/path, resources, ports, status, restriction state, and Stop action.
- `ConfirmStopDialog`: preserves the existing confirmation and explicit error behavior.
- `icons`: centralizes the chosen icon components and SV mark.

Repeated elements must use shared components and CSS tokens. `App` remains composition and state glue instead of accumulating the full visual markup.

## Data Flow And State

1. `App` fetches the current `ProcessListResponse` and preserves the existing polling interval and abort cleanup.
2. Search and process grouping remain derived state using `filterProcesses` and `buildRenderGroups`.
3. Summary metrics bind to `summary.process_count`, `summary.total_memory_mb`, and `summary.active_ports.length`. No concept-only values such as total machine memory are introduced.
4. Theme changes update the root `data-theme` attribute and use the existing capability-guarded storage helper.
5. Navigation anchors scroll to existing regions. Ports links to the listening-port metric and process port column context rather than introducing a separate product area.
6. Stop continues to open a confirmation dialog, send SIGTERM only after confirmation, refresh quietly on success, and surface the backend error on failure.

## Visible Copy Lock

The first viewport may contain only existing or approved operational copy:

- `Server-View`
- `Local development processes and listening ports.`
- `Live`, `Refreshing`, or `Stale data`
- `Dark theme` or `Light theme`
- `Refresh` or `Refreshing...`
- `Overview`, `Processes`, `Ports`
- `Processes`, `Memory`, `Listening ports`
- `Search`
- `Name, command, cwd, port, or PID`
- `Process`, `Ports`, `CPU`, `Memory`, `Uptime`, `Status`
- Existing API-backed group names, process values, helper counts, restriction labels, conflict messages, status values, and Stop actions

No additional product claims, decorative labels, fake metric explanations, or chart copy will be added.

## Interaction And Accessibility

- Preserve semantic buttons, table relationships on desktop, labelled search, live-region status, and modal semantics.
- Use visible focus treatment with a cyan outline and offset that remains clear in both themes.
- Theme and refresh controls expose accessible names; icon-only mobile controls retain labels through `aria-label`.
- Active navigation uses both icon/text treatment and `aria-current`.
- Selected/hover rows use a cyan left edge plus surface change, not color alone.
- Port conflicts use coral plus text/title; restricted and stale states remain explicit.
- Respect `prefers-reduced-motion`. Motion is limited to the live/refresh pulse, small control transitions, and group disclosure.

## Error And Edge States

- Initial loading uses the themed state surface without showing a success-shaped fallback.
- Empty search and no-process states retain their distinct messages.
- Fetch failure remains an explicit alert. Existing data becomes visually stale rather than disappearing.
- Port conflicts remain visible in the alert/banner, group metadata, and port chip.
- Restricted processes keep `Limited access`, unavailable command/path copy, and a differentiated row treatment.
- Stop failure remains attached to the targeted process and repeated in the open confirmation dialog.
- Long commands and paths wrap safely on mobile and do not force viewport overflow.

## Testing And Verification

### Automated

- Keep all existing App and process utility tests passing.
- Update accessible-name assertions only where the approved theme/navigation copy intentionally changes.
- Add coverage for navigation anchors, current-theme labelling, responsive-safe markup labels, and unchanged Stop confirmation behavior.
- Run frontend tests, TypeScript build, Vite production build, and backend tests.

### Browser QA

- Verify dark and Dim Workbench themes at 1440x1000.
- Verify responsive behavior at 390x844 and a tablet-width breakpoint.
- Exercise search, group expansion/collapse, theme switch, refresh, stale/error presentation, port conflict state, and Stop confirmation/cancel.
- Compare the rendered dark desktop, light desktop, and dark mobile screenshots against their approved concept images.
- Inspect the accepted concept and final screenshots with `view_image` and maintain a fidelity ledger covering layout, typography, palette, icon treatment, spacing, container model, copy, responsive behavior, and interactions.

## Acceptance Criteria

- The process table remains the primary desktop workspace and becomes a readable stacked list on mobile.
- Dark, Dim Workbench, and mobile states visibly match their approved concepts without fake data or inert controls.
- Existing monitoring, filtering, grouping, polling, conflict, theme persistence, and termination behaviors remain working.
- There is no mobile horizontal overflow for primary process content.
- Automated verification passes and the final concept-to-browser comparison is suitable for agency sign-off.
