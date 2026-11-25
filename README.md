# Server-View-2
A lightweight dashboard to monitor and manage local development servers (Vite, Next.js, FastAPI, uvicorn, etc.) in real time.

## MVP Stack

- `backend/`: FastAPI local agent using `psutil` for process, port, and resource discovery.
- `frontend/`: React + TypeScript + Vite dashboard.

The backend is designed for local use and should be bound to `127.0.0.1`. The dashboard gets live updates over a WebSocket (falling back to polling every 2 seconds) and requests process termination only when you confirm Stop (SIGTERM on Unix; TerminateProcess on Windows).

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js 18+ (for the frontend)

On Windows 11, install these and ensure `uv`, `python`, and `npm` are on your `PATH` before using `start.bat`.

**Windows note:** Listing listening ports via `psutil` may be incomplete without elevated privileges. User-owned dev servers usually still appear; run the backend as Administrator only if you need a fuller system-wide port map.

## Quick Start

Once dependencies are installed (see below), start both servers with a single script:

- **Linux/macOS:** `./start.sh`
- **Windows:** double-click `start.bat` (or run it from cmd/PowerShell)

Both scripts launch the backend on `8008` and the frontend on `5178`, then open the dashboard in your default browser.

Tray mode (backend in the system tray): `./start.sh --tray` or `start.bat --tray`.

## Development

Install dependencies:

```bash
cd backend && uv sync
cd ../frontend && npm install
```

On Windows (PowerShell or cmd):

```bat
cd backend && uv sync
cd ..\frontend && npm install
```

Run the backend:

```bash
cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8008
```

Run the frontend:

```bash
cd frontend && npm run dev
```

The frontend dev server runs on port `5178` and proxies `/api` requests to `http://127.0.0.1:8008`.

These non-default ports (8008 for uvicorn, 5178 for Vite) are used to avoid clashing with other FastAPI/Vite/Next.js apps running locally.

## Verification

```bash
cd backend && uv run pytest
cd frontend && npm test
cd frontend && npm run build
```

## API

- `GET /api/health`
- `GET /api/processes` (each process includes `started_at`, its start time in epoch seconds, and `category`: `app`, `database` or `docker`)
- `POST /api/processes/{pid}/kill` with body `{"started_at": <number>}`
- `WS /ws/processes` (pushes the process list every 2 seconds)

### Local-only safety checks

- The agent only answers requests whose `Host` is `127.0.0.1` or `localhost`. This blocks DNS-rebinding pages.
- Stop requests and `/ws/processes` must carry the dashboard's `Origin` (`http://127.0.0.1:5178` or `http://localhost:5178`). Other websites can't stop processes or read the process list. For a manual stop with `curl`, add `-H "Origin: http://127.0.0.1:5178"`.
- A stop only goes through if the PID still has the `started_at` the dashboard showed (otherwise `409`, because the OS reused the PID) and is a process the dashboard lists (otherwise `403`).
- Docker port owners (`docker-proxy`, the Docker Desktop backend, `rootlesskit`) are listed but can't be stopped (`403`): stopping one drops the port mapping and leaves the container running. Use `docker stop` instead.
- The agent only stops processes owned by the account it runs as (otherwise `403`). Starting it as root or Administrator does not let it stop other users' servers. If you run the agent under `sudo`, it can no longer stop your own servers, so start it as yourself.
- The agent accepts at most 10 stop requests per 10 seconds. Anything over that gets `429` with a `Retry-After` header.
- Every stop request is written to an audit log, one JSON object per line: what was asked, from which `Origin`, the process name, command and folder, and the result (stopped, refused and why, or rate limited). The log rotates at 1 MB and keeps 3 old files. Locations:
  - Linux: `~/.local/state/server-view/audit.log` (or under `$XDG_STATE_HOME`)
  - macOS: `~/Library/Logs/Server-View/audit.log`
  - Windows: `%LOCALAPPDATA%\Server-View\Logs\audit.log`
  - Set `SERVER_VIEW_AUDIT_LOG` to use another path. If the file can't be written, stops still work and the agent logs a warning.
