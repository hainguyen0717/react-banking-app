import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Register } from './Register';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Register', () => {
  it('submits customer details and returns to login with a success state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
    } as Response);

    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<div data-testid="login-route">Login after registration</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('customer-create-first-name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByTestId('customer-create-last-name'), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByTestId('customer-create-email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('customer-create-password'), { target: { value: 'safe-pass' } });
    fireEvent.click(screen.getByTestId('customer-create-submit'));

    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toContain('/api/customers');
    expect(JSON.parse((request[1] as RequestInit).body as string)).toEqual({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'safe-pass',
    });
  });

  it('shows the API error in the stable customer-create error locator', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'EMAIL_ALREADY_EXISTS', message: 'A customer with this email already exists.' } }),
    } as Response);

    render(<MemoryRouter><Register /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('customer-create-first-name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByTestId('customer-create-last-name'), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByTestId('customer-create-email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('customer-create-password'), { target: { value: 'safe-pass' } });
    fireEvent.click(screen.getByTestId('customer-create-submit'));

    expect(await screen.findByTestId('customer-create-error')).toHaveTextContent('already exists');
  });
});
