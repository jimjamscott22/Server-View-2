import type { KillResponse, ProcessListResponse } from './types';

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
