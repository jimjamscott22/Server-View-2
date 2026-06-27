# Server-View Future Plans

This document tracks product and styling directions for future Server-View iterations. The current MVP should stay functional, local-first, and table-centered; theme work should improve clarity without making the dashboard feel like a marketing page.

## Theme Variant Candidates

### 1. Workbench Light

**Direction:** A refined version of the current interface: light background, quiet borders, dense tables, strong typography, and restrained blue/green/red status accents.

**Best for:** The default theme. It keeps Server-View feeling like a dependable local developer utility and should be the first polish pass.

**Implementation notes:**
- Extract CSS variables for background, surface, border, text, muted text, accent, danger, success, and table row states.
- Reduce repeated one-off colors in `frontend/src/styles.css`.
- Improve table hierarchy with tighter column widths, clearer command/path wrapping, and row hover/focus states.
- Keep cards limited to summary metrics and modal surfaces.

### 2. Terminal Dark

**Direction:** A dark operational theme inspired by terminals and process monitors, using near-black backgrounds, graphite surfaces, bright but limited status colors, and high-contrast monospace command snippets.

**Best for:** Developers who keep dark IDEs and terminals open all day. This should be offered as an optional theme, not the only visual direction.

**Implementation notes:**
- Add a `data-theme="dark"` root selector once tokens exist.
- Use true neutral grays instead of a blue-slate wash so the UI does not become one-note.
- Give destructive actions stronger contrast but keep confirmation requirements unchanged.
- Test long command lines carefully; dark themes make low-contrast muted text fail faster.

### 3. Port Map Console

**Direction:** A slightly more technical variant that gives ports more visual weight: colored port chips, clearer process-to-port relationships, and optional grouping around active listening ports.

**Best for:** Debugging port conflicts and identifying which dev server owns `3000`, `5173`, `8000`, etc.

**Implementation notes:**
- Keep the table as the primary surface, but consider a compact "Ports" rail or grouped rows.
- Use deterministic port-chip colors from a limited palette, not random colors.
- Add conflict states only when multiple rows claim the same listening port.
- This variant pairs well with a future grouping/filtering refactor.

### 4. Project-Oriented View

**Direction:** A quieter theme and layout that emphasizes working directory/project first, then child processes underneath.

**Best for:** Reducing wrapper/runtime noise once process grouping is implemented.

**Implementation notes:**
- Group rows by `cwd` when available.
- Show project path as the primary label and commands as child metadata.
- Collapse helper processes by default if they do not own ports.
- Requires data-shaping changes before styling work will be meaningful.

## Recommended Order

1. **Workbench Light polish:** Establish design tokens and clean up current CSS.
2. **Process grouping:** Reduce duplicate wrapper/runtime rows before adding more visual complexity.
3. **Terminal Dark:** Add theme switching after tokens are stable.
4. **Port Map Console:** Add once the app has better grouped data and conflict detection.

## Styling Refactor Checklist

- Move colors, radii, spacing, and shadows into named CSS variables.
- Split layout, summary, toolbar, table, dialog, and responsive rules into clear sections.
- Define table column sizing with stable responsive constraints.
- Add accessible focus states for buttons, search input, and stop confirmation controls.
- Add visual states for stale data, refresh in progress, access-denied rows, and failed stop requests.
- Keep theme switching client-local; no backend persistence is needed for MVP.

## Non-Goals For The Next Styling Pass

- Do not replace the table with cards as the main desktop view.
- Do not add decorative backgrounds, hero sections, or marketing-style layout.
- Do not add charts before the process list and grouping model are cleaner.
- Do not change stop behavior beyond visual polish and clearer confirmation messaging.
