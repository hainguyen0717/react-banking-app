import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerLogin } from './Login';
import { AuthProvider, AuthState } from '../auth/AuthContext';

const anonymousState: AuthState = { status: 'anonymous', customer: null, error: null };

function loginPage(children: ReactNode) {
  return <AuthProvider initialState={anonymousState}>{children}</AuthProvider>;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('CustomerLogin', () => {
  it('renders the accessible login form and registration route with stable locators', () => {
    render(loginPage(<MemoryRouter><CustomerLogin /></MemoryRouter>));

    expect(screen.getByTestId('customer-login-header')).toHaveTextContent('Banking that stays clear.');
    expect(screen.getByTestId('customer-login-username')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByTestId('customer-login-password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByTestId('customer-login-submit')).toHaveTextContent('Log In');
    expect(screen.getByTestId('customer-login-register-link')).toHaveAttribute('href', '/register');
  });

  it('stores only the returned customer profile and navigates to the dashboard', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ticket: 'login-ticket', sampledSeconds: 0 }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
      } as Response);

    render(
      loginPage(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<CustomerLogin />} />
            <Route path="/dashboard" element={<div data-testid="dashboard-route">Dashboard</div>} />
          </Routes>
        </MemoryRouter>,
      ),
    );

    fireEvent.change(screen.getByTestId('customer-login-username'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('customer-login-password'), { target: { value: 'safe-pass' } });
    fireEvent.click(screen.getByTestId('customer-login-submit'));

    expect(await screen.findByTestId('dashboard-route')).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/login'),
      expect.objectContaining({ credentials: 'include' }),
    ));
    expect(localStorage.getItem('express-bank-customer')).toBeNull();
  });

  it('blocks the styled login card and shows the sampled countdown while login is delayed', async () => {
    let resolveLogin!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ticket: 'login-ticket', sampledSeconds: 2 }) } as Response)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLogin = resolve; }));
    render(loginPage(<MemoryRouter><CustomerLogin /></MemoryRouter>));
    fireEvent.change(screen.getByTestId('customer-login-username'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('customer-login-password'), { target: { value: 'safe-pass' } });
    fireEvent.click(screen.getByTestId('customer-login-submit'));

    expect(await screen.findByTestId('login-delay-blocker')).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('login-delay-blocker-message')).toHaveTextContent('2 seconds remaining');
    expect(screen.getByTestId('customer-login-card-content')).toHaveAttribute('inert');
    resolveLogin({ ok: false, status: 401, json: async () => ({ error: 'Invalid credentials.' }) } as Response);
    expect(await screen.findByTestId('customer-login-error')).toHaveTextContent('Invalid credentials');
    expect(screen.queryByTestId('login-delay-blocker')).not.toBeInTheDocument();
  });
});
