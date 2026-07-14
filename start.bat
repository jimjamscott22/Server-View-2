@echo off
REM Starts the Server-View backend and frontend together.
cd /d "%~dp0"

REM Check for tray mode argument
set TRAY_MODE=false
if "%~1" == "--tray" goto :tray_mode
if "%~1" == "-t" goto :tray_mode

goto :normal_mode

:tray_mode
set TRAY_MODE=true
goto :start_servers

:normal_mode
echo Starting backend (uvicorn) on http://127.0.0.1:8008 ...
start "Server-View Backend" cmd /k "cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8008"

echo Starting frontend (Vite) on http://127.0.0.1:5178 ...
start "Server-View Frontend" cmd /k "cd frontend && npm run dev"

goto :open_browser

:start_servers
if "%TRAY_MODE%" == "true" (
    echo Starting backend in tray mode...
    echo The backend will run in the system tray. Use the tray icon to access the dashboard.
    start "Server-View Backend (Tray)" cmd /k "cd backend && uv run python -m app --tray"
) else (
    echo Starting backend (uvicorn) on http://127.0.0.1:8008 ...
    start "Server-View Backend" cmd /k "cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8008"
)

echo Starting frontend (Vite) on http://127.0.0.1:5178 ...
start "Server-View Frontend" cmd /k "cd frontend && npm run dev"

:open_browser
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5178"

echo.
if "%TRAY_MODE%" == "true" (
    echo Server-View is running in tray mode.
    echo Close the backend window to stop (or use the tray icon menu).
) else (
    echo Server-View is running in two separate windows.
    echo Close those windows (or press Ctrl+C in each) to stop the servers.
)
