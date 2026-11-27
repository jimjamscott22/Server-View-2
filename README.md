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
- `POST /api/processes/stop` with body `{"targets": [{"pid": <number>, "started_at": <number>}, ...]}` (1 to 25 processes). Returns one result per process: `status` is `requested` or `failed`, with `http_status` and `message`. Each process gets the same checks and its own audit-log line as a single stop. The whole request counts once toward the rate limit.
- `GET /api/history/events?limit=50`: recent process starts and stops, newest first (up to 500)
- `GET /api/history/samples?pid=<pid>&started_at=<number>&minutes=60`: CPU and memory samples for one process (one every 30 seconds)
- `WS /ws/processes` (pushes the process list every 2 seconds)

REST, WebSocket and the history recorder share one scan of the machine: a scan less than a second old is reused rather than repeated. Repeat scans also skip processes already known not to be dev servers.

### Process history

The agent keeps a small SQLite database of when dev servers started and stopped, plus a CPU and memory sample for each one every 30 seconds. The dashboard shows it under **Recent activity**. It records while the agent runs, even with no dashboard open, and deletes rows older than 7 days. Locations:

- Linux: `~/.local/state/server-view/history.db` (or under `$XDG_STATE_HOME`)
- macOS: `~/Library/Application Support/Server-View/history.db`
- Windows: `%LOCALAPPDATA%\Server-View\history.db`
- Set `SERVER_VIEW_HISTORY_DB` to use another path. If the database can't be opened, the agent logs a warning and the history endpoints return `503`. Everything else keeps working.

### Resource alerts

The dashboard flags a process that stays over a CPU or memory limit (default: 80% CPU or 1024 MB for 6 seconds). The alert appears in a banner and highlights the row. Change the limits, or turn alerts off, under **Alert settings**. Settings are saved in that browser.

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
