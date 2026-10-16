import { delayActivityStore } from './delayActivity';
import { DelaySample, isDelaySample } from './delay';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

interface ApiErrorBody {
  error?: string | { message?: string };
  message?: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function isDelayControlPath(path: string) {
  return path === '/api/test-controls/delay' || path === '/api/test-controls/delay/sample';
}

function createHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}

async function parseResponse<T>(response: Response, notifyUnauthorized = true): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;

  if (!response.ok || body === null) {
    if (notifyUnauthorized && response.status === 401) unauthorizedHandler?.();
    const nestedMessage = typeof body?.error === 'object' ? body.error.message : undefined;
    const legacyMessage = typeof body?.error === 'string' ? body.error : undefined;
    throw new ApiError(
      nestedMessage ?? body?.message ?? legacyMessage ?? 'The request could not be completed.',
      response.status,
    );
  }

  return body;
}

async function requestDelaySample(): Promise<DelaySample> {
  const response = await fetch(`${API_BASE_URL}/api/test-controls/delay/sample`, {
    method: 'POST',
    credentials: 'include',
    headers: createHeaders(),
  });
  const sample = await parseResponse<unknown>(response, false);
  if (!isDelaySample(sample)) throw new ApiError('The delay service returned an invalid sample.', 502);
  return sample;
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  if (isDelayControlPath(path)) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: createHeaders(options?.headers),
    });
    return parseResponse<T>(response);
  }

  const sample = await requestDelaySample();
  const activityId = delayActivityStore.start(sample.sampledSeconds, 'api');
  const headers = createHeaders(options?.headers);
  headers.set('X-Test-Delay-Ticket', sample.ticket);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
    return await parseResponse<T>(response);
  } finally {
    delayActivityStore.finish(activityId);
  }
}
