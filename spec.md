# Project Specification: Server-View

**Version:** 1.0  
**Status:** Draft / Architecture Review  
**Author:** Senior Software Architect  

---

## 1. Overview
**Server-View** is a lightweight, cross-platform web dashboard designed to provide developers and homelab enthusiasts with a centralized "command center" for local development environments. Instead of manually checking terminal tabs, `lsof`, or `top` commands, Server-View aggregates running development processes, maps them to active ports, monitors resource consumption in real-time, and provides a one-click interface to manage (stop/kill) those processes.

## 2. Problem Statement
Developers often run multiple concurrent services (e.g., a Next.js frontend, a FastAPI backend, a Redis instance, and a local database). This leads to several "friction points":
1.  **Port Conflicts:** Difficulty identifying which process is occupying a specific port (e.g., "Why is 3000 already taken?").
2.  **Zombie Processes:** Development servers occasionally hang or fail to shut down properly, leaving "ghost" processes consuming RAM/CPU.
3.  **Resource Blindness:** Lack of visibility into which specific project is causing a system slowdown.
4.  **Context Switching:** Constant toggling between terminal windows to check logs or status.

## 3. Goals
*   **Visibility:** Provide a single pane of glass for all active local dev servers.
*   **Control:** Enable rapid termination of hanging processes without manual CLI intervention.
*   **Low Overhead:** The monitor itself must consume negligible CPU/RAM.
*   **Real-time Feedback:** Update resource metrics (CPU/RAM) dynamically without page refreshes.
*   **Ease of Use:** A "plug-and-play" experience where the tool automatically detects relevant dev commands.

## 4. Target Users
*   **Software Developers:** Full-stack, Backend, and Frontend engineers working on microservices.
*   **Homelab Enthusiasts:** Users running local automation scripts, home servers, or self-hosted tools.
*   **DevOps Engineers:** For quick local environment auditing.

## 5. Core Features

### 5.1 Process & Port Discovery
*   **Auto-Scanning:** Periodically scan system processes.
*   **Smart Filtering:** Identify processes based on keywords (`node`, `python`, `uvicorn`, `docker`, `npm`).
*   **Port Mapping:** Automatically correlate PIDs to listening TCP/UDP ports.
*   **Directory Context:** Attempt to resolve the working directory of the process to show the project path.

### 5.2 Resource Monitoring
*   **Live Metrics:** Display CPU percentage and Resident Set Size (RSS) memory usage.
*   **Uptime Tracking:** Calculate how long a process has been running.
*   **Status Indicators:** Visual cues for active, idle, or "hanging" states.

### 5.3 Management Actions
*   **One-Click Kill:** Send `SIGTERM` or `SIGKILL` to specific PIDs via the UI.
*   **Refresh Toggle:** Manual trigger to re-scan the system.

### 5.4 Dashboard UI
*   **Summary Cards:** Total running dev servers, total RAM usage, and active ports.
*   **Process Table:** Sortable/filterable list of processes.
*   **Search Bar:** Quickly find a process by name, port, or directory.

## 6. Non-Goals
*   **Remote Management:** This version will not support remote SSH access (focus is strictly local).
*   **Log Streaming:** We will not pipe `stdout` from all processes into the dashboard (this would be too resource-intensive for an MVP).
*   **Code Editing:** This is a monitor, not an IDE.
*   **Complex Networking:** No advanced firewall or routing rules.

## 7. MVP Scope
The Minimum Viable Product includes:
1.  **Backend:** A FastAPI local agent using `psutil` for system-level process scanning and port mapping.
2.  **Frontend:** A React (Vite) dashboard displaying a list of filtered processes.
3.  **Core Logic:** Detection of dev-oriented `node`, `npm`, `vite`, `next`, `python`, `uvicorn`, and `fastapi` processes + port mapping.
4.  **Action:** Confirmed stop action that sends `SIGTERM` only.
5.  **Real-time:** Basic polling every 2 seconds for resource updates.

## 8. Data Model
Since the app is primarily a "view" of the OS, a persistent database is not required for the MVP. Historical logging and SQLite are deferred.

### Process Object (In-Memory / API Response)
```json
{
  "pid": 1234,
  "name": "Next.js Dev Server",
  "command": "npm run dev",
  "cwd": "/Users/dev/projects/my-app",
  "ports": [3000],
  "cpu_usage": 12.5,
  "memory_mb": 256.0,
  "uptime_seconds": 930,
  "status": "running"
}
```

## 9. API Plan (Internal)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | GET | Returns backend health status. |
| `/api/processes` | GET | Returns a list of filtered dev processes and their ports. |
| `/api/processes/{pid}/kill` | POST | Sends `SIGTERM` to the specified PID. |

WebSockets, historical logs, and a separate stats endpoint are deferred.

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Permissions** | High | The app may need `sudo` or specific permissions to see all process details. *Mitigation: Provide a "Permission Required" UI state and guide the user to run the backend with appropriate privileges.* |
| **Performance Overhead** | Medium | Constant scanning can spike CPU. *Mitigation: Use efficient system calls (e.g., `psutil` in Python or `systeminformation` in Node) and throttle scan frequency.* |
| **Security** | High | A web UI that can kill processes is dangerous. *Mitigation: Restrict the backend to `localhost` only and implement a simple "Are you sure?" confirmation for the Kill action.* |
| **OS Differences** | Medium | Process management differs between Windows, macOS, and Linux. *Mitigation: Use cross-platform libraries for process/port detection.* |
