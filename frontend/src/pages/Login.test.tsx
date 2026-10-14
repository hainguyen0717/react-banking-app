import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerLogin } from './Login';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('CustomerLogin', () => {
  it('renders the accessible login form and registration route with stable locators', () => {
    render(<MemoryRouter><CustomerLogin /></MemoryRouter>);

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
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<CustomerLogin />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-route">Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('customer-login-username'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('customer-login-password'), { target: { value: 'safe-pass' } });
    fireEvent.click(screen.getByTestId('customer-login-submit'));

    expect(await screen.findByTestId('dashboard-route')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('express-bank-customer')).toContain('customer-1'));
    expect(localStorage.getItem('express-bank-customer')).not.toContain('safe-pass');
  });
});
