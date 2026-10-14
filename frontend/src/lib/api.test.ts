import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, setUnauthorizedHandler } from './api';

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('apiRequest', () => {
  it('always includes credentials and supports empty 204 responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
    await expect(apiRequest<void>('/api/logout', { method: 'POST' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('notifies the auth boundary on 401 before throwing', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'Authentication required.' }),
    } as Response);

    await expect(apiRequest('/api/accounts')).rejects.toEqual(expect.objectContaining({ status: 401 }));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
