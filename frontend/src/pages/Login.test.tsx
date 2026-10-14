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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
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
});
