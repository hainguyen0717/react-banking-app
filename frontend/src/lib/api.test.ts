import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, setUnauthorizedHandler } from './api';
import { delayActivityStore } from './delayActivity';

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  setUnauthorizedHandler(null);
  delayActivityStore.reset();
  vi.restoreAllMocks();
});

describe('apiRequest', () => {
  it('samples first, sends the reserved ticket with credentials, and supports empty 204 responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ticket: 'opaque-ticket', sampledSeconds: 0 }))
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    await expect(apiRequest<void>('/api/logout', { method: 'POST' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/test-controls/delay/sample');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/logout');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect((fetchMock.mock.calls[1][1]?.headers as Headers).get('X-Test-Delay-Ticket')).toBe('opaque-ticket');
  });

  it('notifies the auth boundary on a business-request 401 before throwing', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ticket: 'opaque-ticket', sampledSeconds: 0 }))
      .mockResolvedValueOnce(response({ error: 'Authentication required.' }, 401));

    await expect(apiRequest('/api/accounts')).rejects.toEqual(expect.objectContaining({ status: 401 }));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('keeps delay activity active until the business response body is fully consumed', async () => {
    let resolveBody: ((value: { accounts: never[] }) => void) | undefined;
    const body = new Promise<{ accounts: never[] }>((resolve) => { resolveBody = resolve; });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ ticket: 'opaque-ticket', sampledSeconds: 2 }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => body } as Response);

    const request = apiRequest<{ accounts: never[] }>('/api/accounts');
    await vi.waitFor(() => expect(delayActivityStore.getSnapshot().active).toBe(true));
    resolveBody?.({ accounts: [] });
    await expect(request).resolves.toEqual({ accounts: [] });
    expect(delayActivityStore.getSnapshot().active).toBe(false);
  });

  it('does not send the business request when sampling fails or returns an invalid contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ sampledSeconds: 2 }));
    await expect(apiRequest('/api/accounts')).rejects.toThrow('invalid sample');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bypasses sampling for delay controls', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' }));
    await apiRequest('/api/test-controls/delay');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
