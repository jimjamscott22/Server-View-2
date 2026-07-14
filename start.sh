#!/usr/bin/env bash
# Starts the Server-View backend and frontend together.
set -e
cd "$(dirname "$0")"

BACKEND_PID=""
FRONTEND_PID=""
TRAY_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tray|-t)
            TRAY_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--tray|-t]"
            echo "  --tray, -t: Run backend in system tray mode"
            exit 1
            ;;
    esac
done

cleanup() {
  echo
  echo "Stopping Server-View..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

if [ "$TRAY_MODE" = true ]; then
    echo "Starting backend in tray mode..."
    echo "The backend will run in the system tray. Use the tray icon to access the dashboard."
    (cd backend && uv run python -m app --tray) &
    BACKEND_PID=$!
    
    # Wait a bit for the backend to start
    sleep 3
    
    echo "Starting frontend (Vite) on http://127.0.0.1:5178 ..."
    (cd frontend && npm run dev) &
    FRONTEND_PID=$!
else
    echo "Starting backend (uvicorn) on http://127.0.0.1:8008 ..."
    (cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8008) &
    BACKEND_PID=$!

    echo "Starting frontend (Vite) on http://127.0.0.1:5178 ..."
    (cd frontend && npm run dev) &
    FRONTEND_PID=$!
fi

sleep 2
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:5178" >/dev/null 2>&1 || true
fi

echo
echo "Server-View is running. Press Ctrl+C to stop both servers."
wait
