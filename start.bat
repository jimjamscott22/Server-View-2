@echo off
REM Starts the Server-View backend and frontend together.
cd /d "%~dp0"

echo Starting backend (uvicorn) on http://127.0.0.1:8008 ...
start "Server-View Backend" cmd /k "cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8008"

echo Starting frontend (Vite) on http://127.0.0.1:5178 ...
start "Server-View Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5178"

echo.
echo Server-View is running in two separate windows.
echo Close those windows (or press Ctrl+C in each) to stop the servers.
