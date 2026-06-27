# Server-View-2
A lightweight dashboard to monitor and manage local development servers (Vite, Next.js, FastAPI, uvicorn, etc.) in real time.

## MVP Stack

- `backend/`: FastAPI local agent using `psutil` for process, port, and resource discovery.
- `frontend/`: React + TypeScript + Vite dashboard.

The backend is designed for local use and should be bound to `127.0.0.1`. The dashboard polls every 2 seconds and sends `SIGTERM` only when stopping a process.

## Development

Install dependencies:

```bash
cd backend && uv sync
cd ../frontend && npm install
```

Run the backend:

```bash
cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend:

```bash
cd frontend && npm run dev
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000`.

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
