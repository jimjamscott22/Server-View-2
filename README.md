# Server-View-2
A lightweight dashboard to monitor and manage local development servers (Vite, Next.js, FastAPI, uvicorn, etc.) in real time.

## MVP Stack

- `backend/`: FastAPI local agent using `psutil` for process, port, and resource discovery.
- `frontend/`: React + TypeScript + Vite dashboard.

The backend is designed for local use and should be bound to `127.0.0.1`. The dashboard polls every 2 seconds and requests process termination only when you confirm Stop (SIGTERM on Unix; TerminateProcess on Windows).

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
- `GET /api/processes`
- `POST /api/processes/{pid}/kill`
