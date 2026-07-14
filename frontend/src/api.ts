import type { KillResponse, ProcessListResponse } from './types';

// WebSocket connection for real-time updates
let socket: WebSocket | null = null;
let onMessageCallback: ((data: ProcessListResponse) => void) | null = null;
let onErrorCallback: ((error: Error) => void) | null = null;
let onCloseCallback: (() => void) | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function fetchProcesses(signal?: AbortSignal): Promise<ProcessListResponse> {
  const response = await fetch('/api/processes', { signal });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProcessListResponse>;
}

export async function killProcess(pid: number): Promise<KillResponse> {
  const response = await fetch(`/api/processes/${pid}/kill`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<KillResponse>;
}

// WebSocket functions
export function connectWebSocket(
  onMessage: (data: ProcessListResponse) => void,
  onError?: (error: Error) => void,
  onClose?: () => void
): void {
  // Close existing connection if any
  disconnectWebSocket();

  onMessageCallback = onMessage;
  onErrorCallback = onError;
  onCloseCallback = onClose;
  reconnectAttempts = 0;

  connect();
}

function connect(): void {
  // Use window.location to determine the WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = import.meta.env.VITE_BACKEND_PORT || '8008';
  const wsUrl = `${protocol}//${host}:${port}/ws/processes`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      reconnectAttempts = 0;
      console.log('WebSocket connected');
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProcessListResponse;
        if (onMessageCallback) {
          onMessageCallback(data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        if (onErrorCallback) {
          onErrorCallback(error as Error);
        }
      }
    };

    socket.onerror = (event) => {
      console.error('WebSocket error:', event);
      if (onErrorCallback) {
        onErrorCallback(new Error('WebSocket connection error'));
      }
    };

    socket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      if (onCloseCallback) {
        onCloseCallback();
      }
      
      // Attempt to reconnect
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(connect, RECONNECT_DELAY_MS);
      } else {
        console.error('Max reconnection attempts reached');
      }
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    if (onErrorCallback) {
      onErrorCallback(error as Error);
    }
  }
}

export function disconnectWebSocket(): void {
  if (socket) {
    socket.close();
    socket = null;
  }
  onMessageCallback = null;
  onErrorCallback = null;
  onCloseCallback = null;
  reconnectAttempts = 0;
}

export function isWebSocketConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

export function sendWebSocketMessage(message: string): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(message);
  }
}
