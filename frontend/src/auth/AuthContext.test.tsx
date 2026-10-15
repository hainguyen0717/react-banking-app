import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api';
import { AuthProvider, useAuth } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function AuthenticatedAction() {
  const auth = useAuth();
  return <button data-testid="protected-action" onClick={() => { void apiRequest('/api/accounts').catch(() => undefined); }}>{auth.customer?.firstName}</button>;
}

function ProfileAction() {
  const auth = useAuth();
  return <button data-testid="profile-action" onClick={() => { void auth.updateProfile({ firstName: 'Grace', lastName: 'Hopper', address: '1 Navy Way' }); }}>{auth.customer?.firstName} · {auth.customer?.address}</button>;
}

function renderProtected() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/" element={<div data-testid="login-route">Login</div>} />
          <Route path="/dashboard" element={<ProtectedRoute><AuthenticatedAction /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('AuthProvider and ProtectedRoute', () => {
  it('bootstraps a direct protected refresh from the HttpOnly session without Web Storage', async () => {
    localStorage.setItem('express-bank-customer', JSON.stringify({ id: 'forged' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }));
    renderProtected();

    expect(screen.getByTestId('auth-session-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('protected-action')).toHaveTextContent('Ada');
    expect(localStorage.getItem('express-bank-customer')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/session'), expect.objectContaining({ credentials: 'include' }));
  });

  it('treats a bootstrap 401 as anonymous', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'Authentication required.' }, 401));
    renderProtected();
    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
  });

  it('shows a retry state for network failure and recovers', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(response({ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }));
    renderProtected();
    expect(await screen.findByTestId('auth-session-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('auth-session-retry'));
    expect(await screen.findByTestId('protected-action')).toHaveTextContent('Ada');
  });

  it('clears authenticated memory when a protected action returns 401', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }))
      .mockResolvedValueOnce(response({ error: 'Authentication required.' }, 401));
    renderProtected();
    fireEvent.click(await screen.findByTestId('protected-action'));
    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
  });

  it('replaces the authenticated profile after a successful personal-information update', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ id: 'customer-1', email: 'ada@example.com', firstName: 'Grace', lastName: 'Hopper', address: '1 Navy Way' }));
    render(<AuthProvider initialState={{ status: 'authenticated', customer: { id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', address: null }, error: null }}><ProfileAction /></AuthProvider>);
    fireEvent.click(screen.getByTestId('profile-action'));
    expect(await screen.findByText('Grace · 1 Navy Way')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/profile'), expect.objectContaining({ method: 'PUT', credentials: 'include' }));
  });
});
