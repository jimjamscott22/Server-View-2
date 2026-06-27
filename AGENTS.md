# Repository Guidelines

## Project Structure & Module Organization
This repository is currently documentation-first. The main files are:

- `README.md`: short project summary.
- `spec.md`: product specification, API plan, data model, risks, and MVP scope.
- `implementation_plan.md`: phased architecture and delivery plan.
- `Server-View-Plan.md`: earlier concept notes and FastAPI/React-oriented plan.
- `LICENSE`: project license.

When implementation begins, keep source code organized by runtime boundary. Use `backend/` for the local process-monitoring agent/API, `frontend/` for the dashboard, and `tests/` for automated tests. Store static UI assets under `frontend/src/assets/` or the framework-equivalent asset directory.

## Build, Test, and Development Commands
No runnable app scaffold or package manifest exists yet, so there are no verified build or test commands. Add commands here when the first implementation lands. Expected future examples:

- `cd backend && uvicorn app.main:app --reload`: run a FastAPI backend locally.
- `cd frontend && npm run dev`: run a Vite or Next.js dashboard.
- `npm test` or `pytest`: run the project test suite once configured.

Do not document commands until they are present and verified in the repo.

## Coding Style & Naming Conventions
Prefer clear module boundaries: process discovery, port mapping, resource sampling, API routes, and UI components should remain separate. Use descriptive names such as `processScanner`, `portMapper`, `ProcessTable`, and `KillProcessDialog`.

For JavaScript/TypeScript, use 2-space indentation, `camelCase` for variables/functions, and `PascalCase` for React components. For Python, follow PEP 8 with 4-space indentation and `snake_case`. Keep API field names aligned with `spec.md` unless intentionally migrating the contract.

## Testing Guidelines
Add tests with the implementation. Backend tests should cover process filtering, port mapping, permission/error handling, and kill safety checks. Frontend tests should cover rendering, filtering/search, status states, and confirmation behavior for destructive actions.

Use explicit test names that describe behavior, for example `test_filters_dev_processes` or `ProcessTable.filtersByPort.test.tsx`.

## Commit & Pull Request Guidelines
The current history uses short, imperative summaries such as `Initial commit` and `Added documentation files`. Continue with concise, action-oriented commit messages.

Pull requests should include a short summary, verification steps, linked issue or task when available, and screenshots or screen recordings for dashboard UI changes. For changes touching process termination, document the safety behavior and local-only restrictions.

## Security & Configuration Tips
The dashboard can terminate local processes, so keep the agent bound to `localhost` by default. Avoid broad permissions, handle access-denied process data gracefully, and require confirmation before sending kill signals.
