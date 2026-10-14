import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { parseAudToCents } from '../lib/banking';
import { AuthProvider, AuthState } from '../auth/AuthContext';

const accounts = [
  { id: 'account-1', accountNumber: 'EXB-000000001', customerId: 'customer-1', ownershipType: 'SINGLE', owners: [{ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }], type: 'EVERYDAY', displayName: null, balanceCents: 100000000, currency: 'AUD', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' },
  { id: 'account-2', accountNumber: 'EXB-000000002', customerId: 'customer-1', ownershipType: 'JOINT', owners: [{ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }, { id: 'customer-2', email: 'grace@example.com', firstName: 'Grace', lastName: 'Hopper' }], type: 'SAVINGS', displayName: 'Goals', balanceCents: 5000, currency: 'AUD', createdAt: '2026-10-14T00:00:01Z', updatedAt: '2026-10-14T00:00:01Z' },
] as const;

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function renderDashboard(initialEntry = '/dashboard') {
  return render(
    <AuthProvider initialState={authenticatedState}>
      <MemoryRouter initialEntries={[initialEntry]}><Dashboard /></MemoryRouter>
    </AuthProvider>,
  );
}

const authenticatedState: AuthState = {
  status: 'authenticated',
  customer: { id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  error: null,
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Dashboard navigation', () => {
  it.each(['/dashboard', '/dashboard?view=unknown'])(
    'falls back to the accounts view for %s',
    async (initialEntry) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
      renderDashboard(initialEntry);

      expect(await screen.findByTestId('dashboard-view-accounts')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-view-accounts-heading')).toHaveTextContent('Accounts overview');
      expect(screen.queryByTestId('dashboard-view-new-account')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-view-transfer')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-nav-accounts-overview')).toHaveAttribute('aria-current', 'page');
    },
  );

  it.each([
    ['/dashboard?view=new-account', 'dashboard-view-new-account', 'dashboard-view-new-account-heading'],
    ['/dashboard?view=new-joint-account', 'dashboard-view-new-joint-account', 'dashboard-view-new-joint-account-heading'],
    ['/dashboard?view=transfer', 'dashboard-view-transfer', 'dashboard-view-transfer-heading'],
  ])('supports the direct query-backed view %s', async (initialEntry, panelTestId, headingTestId) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard(initialEntry);

    expect(await screen.findByTestId(panelTestId)).toBeInTheDocument();
    expect(screen.getByTestId(headingTestId)).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view-accounts')).not.toBeInTheDocument();
  });

  it('uses grouped semantic navigation, exact hrefs, aria-current and stable layout locators', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard();
    await screen.findByTestId('account-card-account-1');

    expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('id', 'dashboard-content');
    expect(screen.getByTestId('dashboard-skip-link')).toHaveAttribute('href', '#dashboard-content');
    expect(screen.getByRole('navigation', { name: 'Dashboard functions' })).toBe(screen.getByTestId('dashboard-function-nav'));

    const accountsGroup = screen.getByTestId('dashboard-nav-group-accounts');
    const transferGroup = screen.getByTestId('dashboard-nav-group-transfer');
    expect(within(accountsGroup).getByRole('heading', { name: 'Accounts' })).toBe(screen.getByTestId('dashboard-nav-group-accounts-label'));
    expect(within(accountsGroup).getByRole('list')).toBeInTheDocument();
    expect(within(transferGroup).getByRole('heading', { name: 'Transfer' })).toBe(screen.getByTestId('dashboard-nav-group-transfer-label'));
    expect(within(transferGroup).getByRole('list')).toBeInTheDocument();

    expect(screen.getByTestId('dashboard-nav-accounts-overview')).toHaveAttribute('href', '/dashboard?view=accounts');
    expect(screen.getByTestId('dashboard-nav-new-account')).toHaveAttribute('href', '/dashboard?view=new-account');
    expect(screen.getByTestId('dashboard-nav-new-joint-account')).toHaveAttribute('href', '/dashboard?view=new-joint-account');
    expect(screen.getByTestId('dashboard-nav-transfer')).toHaveAttribute('href', '/dashboard?view=transfer');
    expect(screen.getByTestId('dashboard-nav-accounts-overview')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('dashboard-nav-new-account')).not.toHaveAttribute('aria-current');
    expect(screen.queryByTestId('dashboard-actions')).not.toBeInTheDocument();
  });

  it('preserves account, joint-account and transfer form state across in-session view changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=new-account');
    await screen.findByTestId('dashboard-view-new-account');

    fireEvent.change(screen.getByTestId('account-create-type'), { target: { value: 'BUSINESS' } });
    fireEvent.change(screen.getByTestId('account-create-display-name'), { target: { value: 'Testing Pty Ltd' } });
    fireEvent.click(screen.getByTestId('dashboard-nav-new-joint-account'));
    expect(await screen.findByTestId('dashboard-view-new-joint-account')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('joint-account-create-type'), { target: { value: 'SAVINGS' } });
    fireEvent.change(screen.getByTestId('joint-account-create-display-name'), { target: { value: 'Shared goals' } });
    fireEvent.change(screen.getByTestId('joint-account-create-co-owner-email'), { target: { value: 'grace@example.com' } });
    fireEvent.click(screen.getByTestId('dashboard-nav-transfer'));
    expect(await screen.findByTestId('dashboard-view-transfer')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('transfer-destination-account'), { target: { value: 'EXB-000000002' } });
    fireEvent.change(screen.getByTestId('transfer-amount'), { target: { value: '12.34' } });

    fireEvent.click(screen.getByTestId('dashboard-nav-new-account'));
    expect(await screen.findByTestId('account-create-display-name')).toHaveValue('Testing Pty Ltd');
    expect(screen.getByTestId('account-create-type')).toHaveValue('BUSINESS');
    fireEvent.click(screen.getByTestId('dashboard-nav-new-joint-account'));
    expect(await screen.findByLabelText('Co-owner email')).toHaveValue('grace@example.com');
    expect(screen.getByLabelText(/Display name/)).toHaveValue('Shared goals');
    expect(screen.getByTestId('joint-account-create-type')).toHaveValue('SAVINGS');
    fireEvent.click(screen.getByTestId('dashboard-nav-transfer'));
    expect(await screen.findByTestId('transfer-destination-account')).toHaveValue('EXB-000000002');
    expect(screen.getByTestId('transfer-amount')).toHaveValue('12.34');
  });

  it('preserves loaded account history across in-session view changes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ transactions: [{ id: 'transaction-1', direction: 'SENT', amountCents: 2500, description: 'Invoice', counterpartyAccountNumber: 'EXB-000000002', createdAt: '2026-10-14T00:00:02Z' }] }));
    renderDashboard('/dashboard?view=accounts');
    await screen.findByTestId('account-card-account-1');
    fireEvent.click(screen.getByTestId('account-transactions-toggle-account-1'));
    expect(await screen.findByTestId('transaction-row-transaction-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dashboard-nav-new-account'));
    await screen.findByTestId('dashboard-view-new-account');
    fireEvent.click(screen.getByTestId('dashboard-nav-accounts-overview'));

    expect(await screen.findByTestId('transactions-panel-account-1')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-row-transaction-1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Dashboard banking functions', () => {
  it('shows balances and stable ID-based account locators in the accounts view', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts');

    expect(await screen.findByTestId('account-card-account-1')).toBeInTheDocument();
    expect(screen.getByTestId('account-number-account-1')).toHaveTextContent('EXB-000000001');
    expect(screen.getByTestId('account-balance-account-1')).toHaveTextContent('$1,000,000.00');
    expect(screen.getByTestId('account-transactions-toggle-account-1')).toBeInTheDocument();
    expect(screen.getByTestId('account-ownership-account-1')).toHaveTextContent('Personal');
    expect(screen.getByTestId('account-owner-account-1-customer-1')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-ownership-account-2')).toHaveTextContent('Joint');
    expect(screen.getByTestId('account-owner-account-2-customer-1')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('account-owner-account-2-customer-2')).toHaveTextContent('Grace Hopper');
  });

  it('creates a joint account with exactly three product types and no client-owned balance or owner IDs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response(accounts[1], 201))
      .mockResolvedValueOnce(response({ accounts }));
    renderDashboard('/dashboard?view=new-joint-account');
    expect(await screen.findByTestId('joint-account-create-form')).toBeInTheDocument();

    expect(screen.getAllByTestId(/^joint-account-create-type-option-/)).toHaveLength(3);
    expect(screen.getByTestId('joint-account-create-co-owner-help')).toHaveTextContent('registered active customer');
    expect(screen.getByTestId('joint-account-create-co-owner-help')).toHaveTextContent('Both owners');
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'BUSINESS' } });
    fireEvent.change(screen.getByTestId('joint-account-create-display-name'), { target: { value: 'Shared expenses' } });
    fireEvent.change(screen.getByLabelText('Co-owner email'), { target: { value: 'grace@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open joint account' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Joint account created');
    expect(screen.getByTestId('dashboard-view-new-joint-account')).toBeInTheDocument();
    expect(screen.getByTestId('joint-account-create-display-name')).toHaveValue('');
    expect(screen.getByTestId('joint-account-create-co-owner-email')).toHaveValue('');
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toContain('/api/joint-accounts');
    const body = JSON.parse((request[1] as RequestInit).body as string);
    expect(body).toEqual({ type: 'BUSINESS', displayName: 'Shared expenses', coOwnerEmail: 'grace@example.com' });
    expect(body).not.toHaveProperty('balanceCents');
    expect(body).not.toHaveProperty('customerId');
    expect(body).not.toHaveProperty('coOwnerCustomerId');
    expect(body).not.toHaveProperty('ownershipType');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows an accessible API error and retains joint form values for correction', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ error: 'No registered customer was found for that co-owner email.' }, 404));
    renderDashboard('/dashboard?view=new-joint-account');
    await screen.findByTestId('joint-account-create-form');
    fireEvent.change(screen.getByTestId('joint-account-create-display-name'), { target: { value: 'Household' } });
    fireEvent.change(screen.getByTestId('joint-account-create-co-owner-email'), { target: { value: 'missing@example.com' } });
    fireEvent.click(screen.getByTestId('joint-account-create-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent('No registered customer');
    expect(screen.getByTestId('joint-account-create-display-name')).toHaveValue('Household');
    expect(screen.getByTestId('joint-account-create-co-owner-email')).toHaveValue('missing@example.com');
  });

  it('creates one of the exact account types without sending an opening balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts: [] }))
      .mockResolvedValueOnce(response({ ...accounts[1], type: 'BUSINESS' }, 201))
      .mockResolvedValueOnce(response({ accounts: [{ ...accounts[1], type: 'BUSINESS' }] }));
    renderDashboard('/dashboard?view=new-account');
    await screen.findByTestId('account-create-form');

    expect(screen.getAllByTestId(/^account-create-type-option-/)).toHaveLength(3);
    fireEvent.change(screen.getByTestId('account-create-type'), { target: { value: 'BUSINESS' } });
    fireEvent.change(screen.getByTestId('account-create-display-name'), { target: { value: 'Testing Pty Ltd' } });
    fireEvent.click(screen.getByTestId('account-create-submit'));

    expect(await screen.findByTestId('account-create-message')).toHaveTextContent('configured opening balance');
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ type: 'BUSINESS', displayName: 'Testing Pty Ltd' });
    expect(body).not.toHaveProperty('balanceCents');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses Transfer terminology and explains cross-customer destinations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=transfer');
    await screen.findByTestId('transfer-form');

    expect(screen.getByTestId('transfer-eyebrow')).toHaveTextContent(/^Transfer$/);
    expect(screen.getByTestId('transfer-copy')).toHaveTextContent('another Express Bank account');
    expect(screen.getByTestId('transfer-copy')).toHaveTextContent('another customer');
    expect(screen.queryByText(/Internal transfer/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('transfer-source-option-account-2')).toHaveTextContent('Joint');
  });

  it('parses AUD exactly, submits cents and refreshes balances after transfer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ id: 'transfer-1' }, 201))
      .mockResolvedValueOnce(response({ accounts }));
    renderDashboard('/dashboard?view=transfer');
    await screen.findByTestId('transfer-form');

    fireEvent.change(screen.getByTestId('transfer-destination-account'), { target: { value: 'EXB-000000002' } });
    fireEvent.change(screen.getByTestId('transfer-amount'), { target: { value: '12.34' } });
    fireEvent.change(screen.getByTestId('transfer-description'), { target: { value: 'Test transfer' } });
    fireEvent.click(screen.getByTestId('transfer-submit'));

    expect(await screen.findByTestId('transfer-message')).toHaveTextContent('Transfer complete');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-000000002', amountCents: 1234,
    });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).not.toHaveProperty('customerId');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(parseAudToCents('0.01')).toBe(1);
    expect(parseAudToCents('1.234')).toBeNull();
  });

  it('shows an inline validation error and does not call transfer API for malformed amounts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=transfer');
    await screen.findByTestId('transfer-form');
    fireEvent.change(screen.getByTestId('transfer-destination-account'), { target: { value: 'EXB-000000002' } });
    fireEvent.change(screen.getByTestId('transfer-amount'), { target: { value: '1.234' } });
    fireEvent.click(screen.getByTestId('transfer-submit'));

    expect(screen.getByTestId('transfer-message')).toHaveTextContent('two decimal places');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session on logout', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    render(
      <AuthProvider initialState={authenticatedState}>
        <MemoryRouter initialEntries={['/dashboard?view=accounts']}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/" element={<div data-testid="logged-out-route">Logged out</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    await screen.findByTestId('account-card-account-1');
    fireEvent.click(screen.getByTestId('dashboard-logout'));
    expect(await screen.findByTestId('logged-out-route')).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ));
  });
});
