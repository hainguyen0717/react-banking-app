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

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;

  if (!response.ok || body === null) {
    if (response.status === 401) unauthorizedHandler?.();
    const nestedMessage = typeof body?.error === 'object' ? body.error.message : undefined;
    const legacyMessage = typeof body?.error === 'string' ? body.error : undefined;
    throw new ApiError(
      nestedMessage ?? body?.message ?? legacyMessage ?? 'The request could not be completed.',
      response.status,
    );
  }

  return body;
}
