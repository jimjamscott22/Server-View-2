# Sites design implementation

## Summary

Implemented the approved **Server-View Viewing Lab** Sites design in the production React/FastAPI source while preserving the existing live process API, WebSocket updates, filtering, grouping, port-conflict handling, and process-stop confirmation.

## Frontend changes

- Rebuilt the dashboard shell around the dark navy/cyan command-center design:
  - branded fixed navigation rail with live process and port counts
  - workstation hero and WebSocket/polling state
  - compact-density toggle and refresh action
  - four-part system summary with process, memory, port, and development-health metrics
- Added three functional data views:
  - grouped process table
  - project cards
  - listening-port ownership map
- Added responsive behavior for collapsed tablet navigation and bottom mobile navigation.
- Preserved keyboard focus, semantic tabs, search labeling, confirmation dialogs, reduced-motion support, and responsive table behavior.
- Corrected project-label extraction for both POSIX and Windows paths.

## Backend changes

- Added the workstation hostname and development-process share of total system memory to the existing process summary response.
- Kept the added fields backward compatible with defaults.

## Verification

- Frontend production build: passed.
- Frontend Vitest suite: 15 tests passed.
- Backend pytest suite: 32 tests passed.
- Browser verification:
  - compared the grouped-table view against the saved Sites design at the native desktop viewport
  - exercised project-card and port-map tabs with live local process data
  - verified filtering and compact-density state
  - opened and canceled the process-stop confirmation without terminating a process
  - checked the 390 x 844 mobile layout with no page-level horizontal overflow
