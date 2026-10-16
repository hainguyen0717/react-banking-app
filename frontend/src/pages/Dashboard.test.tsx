import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function renderDashboard(initialEntry = '/dashboard', initialDelay = { durationSeconds: 0, scope: 'BOTH' }) {
  const configuredFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (String(input).endsWith('/api/test-controls/delay') && method === 'GET') {
      return Promise.resolve(response(initialDelay));
    }
    return configuredFetch(input, init);
  }));
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    const cardsDestination = screen.getByTestId('dashboard-nav-cards-standalone');
    const paymentsDestination = screen.getByTestId('dashboard-nav-payments-standalone');
    const transferGroup = screen.getByTestId('dashboard-nav-group-transfer');
    expect(within(accountsGroup).getByRole('heading', { name: 'Accounts' })).toBe(screen.getByTestId('dashboard-nav-group-accounts-label'));
    expect(within(accountsGroup).getByRole('list')).toBeInTheDocument();
    expect(within(transferGroup).getByRole('heading', { name: 'Transfer' })).toBe(screen.getByTestId('dashboard-nav-group-transfer-label'));
    expect(within(transferGroup).getByRole('list')).toBeInTheDocument();
    expect(within(accountsGroup).queryByTestId('dashboard-nav-cards')).not.toBeInTheDocument();
    expect(within(cardsDestination).getByTestId('dashboard-nav-cards-item')).toContainElement(screen.getByTestId('dashboard-nav-cards'));
    expect(accountsGroup.compareDocumentPosition(cardsDestination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cardsDestination.compareDocumentPosition(paymentsDestination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(paymentsDestination.compareDocumentPosition(transferGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByTestId('dashboard-nav-accounts-overview')).toHaveAttribute('href', '/dashboard?view=accounts');
    expect(screen.getByTestId('dashboard-nav-new-account')).toHaveAttribute('href', '/dashboard?view=new-account');
    expect(screen.getByTestId('dashboard-nav-new-joint-account')).toHaveAttribute('href', '/dashboard?view=new-joint-account');
    expect(screen.getByTestId('dashboard-nav-cards')).toHaveAttribute('href', '/dashboard?view=cards');
    expect(screen.getByTestId('dashboard-nav-payments')).toHaveAttribute('href', '/dashboard?view=payments');
    expect(screen.getByTestId('dashboard-nav-transfer')).toHaveAttribute('href', '/dashboard?view=transfer');
    expect(screen.getByTestId('dashboard-nav-delay-simulator')).toHaveAttribute('href', '/dashboard?view=delay-simulator');
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

  it('delays UI-inclusive navigation once while retaining the current view and href', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { durationSeconds: 3, scope: 'UI' });
    await screen.findByTestId('account-card-account-1');
    expect(await screen.findByTestId('delay-banner-status')).toHaveTextContent('3s · UI');
    vi.useFakeTimers();

    const newAccountLink = screen.getByTestId('dashboard-nav-new-account');
    expect(newAccountLink).toHaveAttribute('href', '/dashboard?view=new-account');
    fireEvent.click(newAccountLink);
    fireEvent.click(screen.getByTestId('dashboard-nav-transfer'));
    expect(screen.getByTestId('dashboard-view-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('delay-navigation-pending')).toHaveTextContent('New account');

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('dashboard-view-accounts')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('dashboard-view-new-account')).toBeInTheDocument();
  });

  it('navigates immediately for API-only delay settings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { durationSeconds: 60, scope: 'API' });
    await screen.findByTestId('account-card-account-1');
    fireEvent.click(screen.getByTestId('dashboard-nav-new-account'));
    expect(screen.getByTestId('dashboard-view-new-account')).toBeInTheDocument();
    expect(screen.queryByTestId('delay-navigation-pending')).not.toBeInTheDocument();
  });
});

describe('Dashboard delay simulator', () => {
  it('loads, validates and applies the complete public delay setting', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ durationSeconds: 12, scope: 'BOTH' }));
    renderDashboard('/dashboard?view=delay-simulator', { durationSeconds: 4, scope: 'UI' });

    expect(await screen.findByTestId('delay-simulator-form')).toBeInTheDocument();
    expect(screen.getByTestId('delay-simulator-duration')).toHaveValue(4);
    expect(screen.getByTestId('delay-simulator-scope-ui')).toBeChecked();
    fireEvent.change(screen.getByTestId('delay-simulator-duration'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByTestId('delay-simulator-apply'));
    expect(screen.getByTestId('delay-banner-error')).toHaveTextContent('whole number from 0 to 60');
    expect(screen.getByTestId('delay-simulator-duration-error')).toHaveTextContent('whole number from 0 to 60');
    expect(screen.getByTestId('delay-simulator-duration')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('delay-simulator-duration')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('delay-simulator-duration'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('delay-simulator-scope-both'));
    fireEvent.click(screen.getByTestId('delay-simulator-apply'));
    expect(await screen.findByTestId('delay-banner-success')).toHaveTextContent('applied');
    expect(screen.getByTestId('delay-banner-status')).toHaveTextContent('12s · BOTH');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ durationSeconds: 12, scope: 'BOTH' });
  });

  it('resets to zero while retaining the active scope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ durationSeconds: 0, scope: 'API' }));
    renderDashboard('/dashboard?view=delay-simulator', { durationSeconds: 8, scope: 'API' });
    await screen.findByTestId('delay-simulator-form');
    fireEvent.click(screen.getByTestId('delay-banner-reset'));
    expect(await screen.findByTestId('delay-banner-success')).toHaveTextContent('reset');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ durationSeconds: 0, scope: 'API' });
  });

  it('does not add a client-side delay to API-backed actions when BOTH is active', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ id: 'transfer-1' }, 201))
      .mockResolvedValueOnce(response({ accounts }));
    renderDashboard('/dashboard?view=transfer', { durationSeconds: 20, scope: 'BOTH' });
    await screen.findByTestId('transfer-form');
    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('transfer-destination-account'), { target: { value: 'EXB-000000002' } });
    fireEvent.change(screen.getByTestId('transfer-amount'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByTestId('transfer-submit'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchMock.mock.calls[1][0]).toContain('/api/transfers');
    expect(screen.queryByTestId('delay-navigation-pending')).not.toBeInTheDocument();
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

  it('updates personal information and immediately refreshes the dashboard profile name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ id: 'customer-1', email: 'ada@example.com', firstName: 'Grace', lastName: 'Hopper', address: '1 Navy Way' }));
    renderDashboard('/dashboard?view=profile');
    await screen.findByTestId('profile-form');
    fireEvent.change(screen.getByTestId('profile-first-name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByTestId('profile-last-name'), { target: { value: 'Hopper' } });
    fireEvent.change(screen.getByTestId('profile-address'), { target: { value: '1 Navy Way' } });
    fireEvent.click(screen.getByTestId('profile-submit'));
    expect(await screen.findByTestId('profile-message')).toHaveTextContent('updated');
    expect(screen.getByTestId('dashboard-customer-name')).toHaveTextContent('Grace Hopper');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ firstName: 'Grace', lastName: 'Hopper', address: '1 Navy Way' });
  });

  it('schedules a transfer with picker-produced ISO and no client customer identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ id: 'schedule-1', status: 'PENDING' }, 201));
    renderDashboard('/dashboard?view=schedule-transfer');
    await screen.findByTestId('schedule-transfer-form');
    fireEvent.change(screen.getByTestId('schedule-transfer-destination-account'), { target: { value: 'EXB-000000002' } });
    fireEvent.change(screen.getByTestId('schedule-transfer-amount'), { target: { value: '25.00' } });
    fireEvent.click(screen.getByTestId('scheduled-transfer-date-time-trigger'));
    fireEvent.click(screen.getByTestId('date-time-picker-next-month'));
    fireEvent.click(screen.getByTestId('date-time-picker-day-2026-11-01'));
    fireEvent.click(screen.getByTestId('date-time-picker-confirm'));
    fireEvent.click(screen.getByTestId('schedule-transfer-submit'));
    expect(await screen.findByTestId('schedule-transfer-message')).toHaveTextContent('Transfer scheduled');
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toMatchObject({ sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-000000002', amountCents: 2500 });
    const scheduledInstant = new Date(body.scheduledFor);
    expect([scheduledInstant.getFullYear(), scheduledInstant.getMonth(), scheduledInstant.getDate()]).toEqual([2026, 10, 1]);
    expect(body).not.toHaveProperty('customerId');
  });

  it('renders masked cards and five ID-located sample transactions with explicit disable confirmation', async () => {
    const card = { id: 'card-1', accountId: 'account-1', maskedNumber: '•••• 1234', status: 'ACTIVE', account: { accountNumber: 'EXB-000000001', displayName: null, type: 'EVERYDAY' }, transactions: Array.from({ length: 5 }, (_, index) => ({ id: `card-transaction-${index + 1}`, merchant: `Merchant ${index + 1}`, amountCents: 100 + index, occurredAt: '2026-10-14T00:00:00Z' })) };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/accounts')) return response({ accounts });
      if (url.endsWith('/api/cards')) return response({ cards: [card] });
      return response(card);
    });
    renderDashboard('/dashboard?view=cards');
    expect(await screen.findByTestId('card-row-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-nav-cards')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('card-masked-number-card-1')).toHaveTextContent('•••• 1234');
    expect(screen.getAllByTestId(/^card-transaction-row-/)).toHaveLength(5);
    fireEvent.click(screen.getByTestId('card-disable-card-1'));
    expect(screen.getByRole('alertdialog', { name: /disable this card permanently/i })).toBeInTheDocument();
    const cancel = screen.getByTestId('card-disable-cancel-card-1');
    const confirm = screen.getByTestId('card-disable-confirm-card-1');
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('card-disable-dialog-card-1'), { key: 'Escape' });
    expect(screen.queryByTestId('card-disable-dialog-card-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-disable-card-1')).toHaveFocus();
  });

  it('supports the Payments deep link and switches method-specific fields with owned joint sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=payments');
    expect(await screen.findByTestId('dashboard-view-payments')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-nav-payments')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('payment-source-option-account-2')).toHaveTextContent('Joint');
    expect(screen.getByTestId('payment-destination-account')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-method-payid'));
    expect(screen.getByTestId('payment-payid')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-destination-account')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-method-bpay'));
    expect(screen.getByTestId('payment-biller-code')).toBeInTheDocument();
    expect(screen.getByTestId('payment-customer-reference')).toBeInTheDocument();
  });

  it('reviews and confirms a bank-account payment in cents, then shows a stable receipt and refreshes history', async () => {
    const review = { method: 'BANK_ACCOUNT', sourceAccountNumber: 'EXB-000000001', amountCents: 1234, description: 'Invoice', payeeName: 'Harbour Services', destinationAccountNumber: 'EXB-PAYMENTS-001' };
    const receipt = { ...review, id: 'payment-1', payId: null, billerCode: null, customerReference: null, createdAt: '2026-10-16T00:00:00Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response(review))
      .mockResolvedValueOnce(response(receipt, 201))
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ transactions: [{ id: 'payment-1', method: 'BANK_ACCOUNT', direction: 'SENT', amountCents: 1234, description: 'Invoice', counterpartyAccountNumber: 'EXB-PAYMENTS-001', counterpartyLabel: 'Harbour Services', customerReference: null, createdAt: receipt.createdAt }] }));
    renderDashboard('/dashboard?view=payments');
    await screen.findByTestId('payment-entry-form');
    fireEvent.change(screen.getByTestId('payment-destination-account'), { target: { value: 'EXB-PAYMENTS-001' } });
    fireEvent.change(screen.getByTestId('payment-amount'), { target: { value: '12.34' } });
    fireEvent.change(screen.getByTestId('payment-description'), { target: { value: 'Invoice' } });
    fireEvent.click(screen.getByTestId('payment-review-submit'));
    expect(await screen.findByTestId('payment-review')).toBeInTheDocument();
    expect(screen.getByTestId('payment-review-heading')).toHaveFocus();
    expect(screen.getByTestId('payment-review-payee')).toHaveTextContent('Harbour Services');
    expect(screen.getByTestId('payment-review-amount')).toHaveTextContent('$12.34');
    fireEvent.click(screen.getByTestId('payment-confirm'));
    expect(await screen.findByTestId('payment-receipt-payment-1')).toBeInTheDocument();
    expect(screen.getByTestId('payment-receipt-heading')).toHaveFocus();
    expect(screen.getByTestId('payment-receipt-id')).toHaveTextContent('payment-1');
    const resolveBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const createBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(resolveBody).toMatchObject({ method: 'BANK_ACCOUNT', sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-PAYMENTS-001', amountCents: 1234 });
    expect(createBody).toEqual(resolveBody);
    expect(createBody).not.toHaveProperty('customerId');
    expect(fetchMock.mock.calls[4][0]).toContain('/api/accounts/account-1/transactions');
  });

  it('keeps PayID review secrecy and preserves BPAY input after an accessible validation error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ method: 'PAYID', sourceAccountNumber: 'EXB-000000001', amountCents: 500, description: null, payeeName: 'Safe Recipient', payId: 'recipient@example.com' }))
      .mockResolvedValueOnce(response({ error: 'Customer reference must be exactly 10 digits for this biller.' }, 400));
    renderDashboard('/dashboard?view=payments');
    await screen.findByTestId('payment-entry-form');
    fireEvent.click(screen.getByTestId('payment-method-payid'));
    fireEvent.change(screen.getByTestId('payment-payid'), { target: { value: 'RECIPIENT@example.com' } });
    fireEvent.change(screen.getByTestId('payment-amount'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByTestId('payment-review-submit'));
    expect(await screen.findByTestId('payment-review')).toHaveTextContent('Safe Recipient');
    expect(screen.getByTestId('payment-review')).not.toHaveTextContent('EXB-PAYMENTS-001');
    fireEvent.click(screen.getByTestId('payment-review-edit'));
    fireEvent.click(screen.getByTestId('payment-method-bpay'));
    fireEvent.change(screen.getByTestId('payment-biller-code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByTestId('payment-customer-reference'), { target: { value: '123' } });
    fireEvent.click(screen.getByTestId('payment-review-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('exactly 10 digits');
    expect(screen.getByTestId('payment-biller-code')).toHaveValue('123456');
    expect(screen.getByTestId('payment-customer-reference')).toHaveValue('123');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).not.toHaveProperty('customerId');
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
