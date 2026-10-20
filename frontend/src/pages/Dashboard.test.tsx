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

const cards = [
  { id: 'card-locked', accountId: 'account-1', maskedNumber: '•••• 1111', status: 'LOCKED', createdAt: '2026-10-19T01:00:00Z', updatedAt: '2026-10-19T01:00:00Z', account: { accountNumber: 'EXB-000000001', displayName: null, type: 'EVERYDAY' }, transactions: [] },
  { id: 'card-active', accountId: 'account-2', maskedNumber: '•••• 4242', status: 'ACTIVE', createdAt: '2026-10-18T01:00:00Z', updatedAt: '2026-10-18T01:00:00Z', account: { accountNumber: 'EXB-000000002', displayName: 'Goals', type: 'SAVINGS' }, transactions: [] },
] as const;

const overviewTransactions = {
  'account-1': [
    { id: 'transaction-sent', method: 'PAYID', direction: 'SENT', amountCents: 2500, description: 'Lunch', counterpartyAccountNumber: null, counterpartyLabel: 'Grace Hopper', customerReference: null, createdAt: '2026-10-19T08:00:00Z' },
    { id: 'transaction-old', method: 'BPAY', direction: 'SENT', amountCents: 1000, description: null, counterpartyAccountNumber: null, counterpartyLabel: 'Utility Co', customerReference: '123', createdAt: '2026-10-18T08:00:00Z' },
  ],
  'account-2': [
    { id: 'transaction-received', method: 'TRANSFER', direction: 'RECEIVED', amountCents: 5000, description: null, counterpartyAccountNumber: 'EXB-000000003', counterpartyLabel: 'EXB-000000003', customerReference: null, createdAt: '2026-10-19T09:00:00Z' },
  ],
} as const;

function mockOverviewFetch(options: { accountList?: unknown[]; cardList?: unknown[]; transactions?: Record<string, readonly unknown[]> } = {}) {
  const accountList = options.accountList ?? accounts;
  const cardList = options.cardList ?? cards;
  const transactions: Record<string, readonly unknown[]> = options.transactions ?? overviewTransactions;
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith('/api/accounts')) return Promise.resolve(response({ accounts: accountList }));
    if (url.endsWith('/api/cards')) return Promise.resolve(response({ cards: cardList }));
    const match = url.match(/\/api\/accounts\/([^/]+)\/transactions$/);
    if (match) return Promise.resolve(response({ transactions: transactions[match[1]] ?? [] }));
    return Promise.resolve(response({}));
  });
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function renderDashboard(
  initialEntry = '/dashboard',
  initialDelay = { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' },
  sampledSeconds: number | (() => number) = 0,
) {
  const configuredFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (String(input).endsWith('/api/test-controls/delay') && method === 'GET') {
      return Promise.resolve(response(initialDelay));
    }
    if (String(input).endsWith('/api/test-controls/delay/sample') && method === 'POST') {
      const sampledValue = typeof sampledSeconds === 'function' ? sampledSeconds() : sampledSeconds;
      return Promise.resolve(response({ ticket: 'dashboard-test-ticket', sampledSeconds: sampledValue }));
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
    'falls back to the overview for %s',
    async (initialEntry) => {
      mockOverviewFetch();
      renderDashboard(initialEntry);

      expect(await screen.findByTestId('dashboard-view-overview')).toBeInTheDocument();
      expect(screen.getByTestId('overview-greeting')).toHaveTextContent(/Good (morning|afternoon|evening), Ada\./);
      expect(screen.getByTestId('overview-greeting-name')).toHaveTextContent('Ada.');
      expect(screen.queryByTestId('dashboard-view-new-account')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-view-transfer')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-nav-overview')).toHaveAttribute('aria-current', 'page');
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
    mockOverviewFetch();
    renderDashboard();
    await screen.findByTestId('overview-featured-card-card-active');

    expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-sidebar-menu')).toContainElement(screen.getByTestId('dashboard-function-nav'));
    expect(screen.getByTestId('dashboard-sidebar-brand')).not.toContainElement(screen.getByTestId('dashboard-function-nav'));
    expect(screen.getByTestId('dashboard-brand')).toHaveTextContent('DBank');
    expect(screen.getByTestId('dashboard-brand-accent')).toHaveTextContent('.');
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('id', 'dashboard-content');
    expect(screen.getByTestId('dashboard-skip-link')).toHaveAttribute('href', '#dashboard-content');
    expect(screen.getByRole('navigation', { name: 'Dashboard functions' })).toBe(screen.getByTestId('dashboard-function-nav'));

    const primaryGroup = screen.getByTestId('dashboard-nav-group-primary');
    const manageGroup = screen.getByTestId('dashboard-nav-group-manage');
    const settingsGroup = screen.getByTestId('dashboard-nav-group-settings');
    expect(within(primaryGroup).getByRole('heading', { name: 'Primary' })).toBe(screen.getByTestId('dashboard-nav-group-primary-label'));
    expect(within(primaryGroup).getByRole('list')).toBeInTheDocument();
    expect(within(manageGroup).getByRole('heading', { name: 'Manage' })).toBeInTheDocument();
    expect(within(settingsGroup).getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(primaryGroup.compareDocumentPosition(manageGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(manageGroup.compareDocumentPosition(settingsGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByTestId('dashboard-nav-overview')).toHaveAttribute('href', '/dashboard?view=overview');
    expect(screen.getByTestId('dashboard-nav-accounts-overview')).toHaveAttribute('href', '/dashboard?view=accounts');
    expect(screen.getByTestId('dashboard-nav-new-account')).toHaveAttribute('href', '/dashboard?view=new-account');
    expect(screen.getByTestId('dashboard-nav-new-joint-account')).toHaveAttribute('href', '/dashboard?view=new-joint-account');
    expect(screen.getByTestId('dashboard-nav-cards')).toHaveAttribute('href', '/dashboard?view=cards');
    expect(screen.getByTestId('dashboard-nav-payments')).toHaveAttribute('href', '/dashboard?view=payments');
    expect(screen.getByTestId('dashboard-nav-transfer')).toHaveAttribute('href', '/dashboard?view=transfer');
    expect(screen.getByTestId('dashboard-nav-delay-simulator')).toHaveAttribute('href', '/dashboard?view=delay-simulator');
    expect(screen.getByTestId('dashboard-nav-overview')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('dashboard-nav-accounts-overview')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('dashboard-nav-new-account')).not.toHaveAttribute('aria-current');
    expect(screen.queryByTestId('dashboard-actions')).not.toBeInTheDocument();
  });

  it('composes live account, card, recent activity and weekly spend data on the overview', async () => {
    mockOverviewFetch();
    renderDashboard('/dashboard?view=overview');

    expect(await screen.findByTestId('overview-featured-card-card-active')).toBeInTheDocument();
    expect(screen.getByTestId('overview-current-date')).not.toBeEmptyDOMElement();
    expect(screen.getByTestId('overview-send-money')).toHaveAttribute('href', '/dashboard?view=transfer');
    expect(screen.getByTestId('overview-total-balance')).toHaveTextContent('$1,000,050.00');
    expect(screen.getByTestId('overview-account-count')).toHaveTextContent('Across 2 accounts');
    expect(screen.getByTestId('overview-featured-card-number-card-active')).toHaveTextContent('•••• 4242');
    expect(screen.getByTestId('overview-activity-account-2-transaction-received-received')).toHaveTextContent('Received into Goals');
    expect(screen.getByTestId('overview-activity-account-1-transaction-sent-sent')).toHaveTextContent('Sent from Everyday');
    expect(screen.getByTestId('overview-activity-account-1-transaction-old-sent')).toBeInTheDocument();
    expect(screen.getByTestId('overview-weekly-spend-total')).toHaveTextContent('$25.00');
    expect(screen.getAllByTestId(/^overview-weekday-\d{4}-\d{2}-\d{2}$/)).toHaveLength(7);
  });

  it('shows explicit empty states when the customer has no overview records', async () => {
    mockOverviewFetch({ accountList: [], cardList: [], transactions: {} });
    renderDashboard('/dashboard?view=overview');

    expect(await screen.findByTestId('overview-card-empty')).toBeInTheDocument();
    expect(screen.getByTestId('overview-total-balance')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('overview-account-count')).toHaveTextContent('Across 0 accounts');
    expect(screen.getByTestId('overview-activity-empty')).toBeInTheDocument();
    expect(screen.getByTestId('overview-spend-empty')).toBeInTheDocument();
  });

  it('does not present a zero balance while account data is still loading', async () => {
    let resolveAccounts: ((value: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/api/accounts')) return new Promise<Response>((resolve) => { resolveAccounts = resolve; });
      if (url.endsWith('/api/cards')) return Promise.resolve(response({ cards: [] }));
      if (url.includes('/transactions')) return Promise.resolve(response({ transactions: [] }));
      return Promise.resolve(response({}));
    });
    renderDashboard('/dashboard?view=overview');

    expect(await screen.findByTestId('overview-balance-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-total-balance')).not.toBeInTheDocument();
    await act(async () => { resolveAccounts?.(response({ accounts })); });
    expect(await screen.findByTestId('overview-total-balance')).toHaveTextContent('$1,000,050.00');
  });

  it('keeps card and history failures separate and offers an activity retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/api/accounts')) return Promise.resolve(response({ accounts }));
      if (url.endsWith('/api/cards')) return Promise.reject(new Error('Cards unavailable'));
      if (url.includes('/transactions')) return Promise.reject(new Error('History unavailable'));
      return Promise.resolve(response({}));
    });
    renderDashboard('/dashboard?view=overview');

    expect(await screen.findByTestId('overview-card-error')).toHaveTextContent('Cards unavailable');
    expect(screen.getByTestId('overview-error')).toHaveTextContent('History unavailable');
    expect(screen.getByTestId('overview-retry')).toBeEnabled();
    expect(screen.getByTestId('overview-total-balance')).toHaveTextContent('$1,000,050.00');
  });

  it('drills activity into an owned account history', async () => {
    mockOverviewFetch();
    renderDashboard('/dashboard?view=overview');
    const activity = await screen.findByTestId('overview-activity-account-1-transaction-sent-sent');
    expect(activity).toHaveAttribute('href', '/dashboard?view=accounts&accountId=account-1');
    fireEvent.click(activity);
    expect(await screen.findByTestId('transactions-panel-account-1')).toBeInTheDocument();
  });

  it('ignores an unknown account query instead of requesting or expanding it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts&accountId=not-owned');
    await screen.findByTestId('account-card-account-1');
    expect(screen.queryByTestId('transactions-panel-not-owned')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/not-owned/transactions'))).toBe(false);
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

  it('blocks only dashboard content and lets a different destination supersede pending UI navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { minSeconds: 3, maxSeconds: 3, scope: 'UI' });
    await screen.findByTestId('account-card-account-1');
    expect(await screen.findByTestId('delay-banner-status')).toHaveTextContent('3s · UI');
    vi.useFakeTimers();

    const newAccountLink = screen.getByTestId('dashboard-nav-new-account');
    expect(newAccountLink).toHaveAttribute('href', '/dashboard?view=new-account');
    fireEvent.click(newAccountLink);
    fireEvent.click(screen.getByTestId('dashboard-nav-transfer'));
    expect(screen.getByTestId('dashboard-view-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('delay-navigation-pending')).toHaveTextContent('Transfer');
    expect(screen.getByTestId('dashboard-delay-blocker-message')).toHaveTextContent('3 seconds remaining');
    expect(screen.getByTestId('dashboard-content-inner')).toHaveAttribute('inert');
    expect(screen.getByTestId('dashboard-sidebar')).not.toHaveAttribute('inert');

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('dashboard-view-accounts')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('dashboard-view-transfer')).toBeInTheDocument();
  });

  it('navigates immediately when a replacement destination resamples zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { minSeconds: 0, maxSeconds: 1, scope: 'UI' });
    await screen.findByTestId('account-card-account-1');
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.999).mockReturnValueOnce(0);

    fireEvent.click(screen.getByTestId('dashboard-nav-new-account'));
    expect(screen.getByTestId('delay-navigation-pending')).toHaveTextContent('New account');
    fireEvent.click(screen.getByTestId('dashboard-nav-transfer'));

    expect(screen.getByTestId('dashboard-view-transfer')).toBeInTheDocument();
    expect(screen.queryByTestId('delay-navigation-pending')).not.toBeInTheDocument();
  });

  it('dismisses a BOTH blocker at the sampled time for a client-only destination', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { minSeconds: 1, maxSeconds: 1, scope: 'BOTH' });
    await screen.findByTestId('account-card-account-1');
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('dashboard-nav-new-account'));
    expect(screen.getByTestId('dashboard-delay-blocker')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId('dashboard-view-new-account')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-delay-blocker')).not.toBeInTheDocument();
  });

  it('bridges a BOTH blocker into one immediate API load without a visual gap or duplicate request', async () => {
    let resolveCards: ((value: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveCards = resolve; }));
    let sampleCall = 0;
    renderDashboard(
      '/dashboard?view=accounts',
      { minSeconds: 1, maxSeconds: 1, scope: 'BOTH' },
      () => (sampleCall++ === 0 ? 0 : 2),
    );
    await screen.findByTestId('account-card-account-1');
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('dashboard-nav-cards'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('dashboard-view-cards')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-delay-blocker-message')).toHaveTextContent('Completing…');

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('dashboard-delay-blocker-message')).toHaveTextContent('2 seconds remaining');
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/cards'))).toHaveLength(1);

    await act(async () => {
      resolveCards?.(response({ cards: [] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('dashboard-delay-blocker')).not.toBeInTheDocument();
  });

  it('navigates immediately for API-only delay settings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    renderDashboard('/dashboard?view=accounts', { minSeconds: 60, maxSeconds: 60, scope: 'API' });
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
      .mockResolvedValueOnce(response({ minSeconds: 2, maxSeconds: 12, scope: 'BOTH' }));
    renderDashboard('/dashboard?view=delay-simulator', { minSeconds: 1, maxSeconds: 4, scope: 'UI' });

    expect(await screen.findByTestId('delay-simulator-form')).toBeInTheDocument();
    expect(screen.getByTestId('delay-simulator-minimum')).toHaveValue(1);
    expect(screen.getByTestId('delay-simulator-maximum')).toHaveValue(4);
    expect(screen.getByTestId('delay-simulator-scope-ui')).toBeChecked();
    fireEvent.change(screen.getByTestId('delay-simulator-minimum'), { target: { value: '13' } });
    fireEvent.change(screen.getByTestId('delay-simulator-maximum'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('delay-simulator-apply'));
    expect(screen.getByTestId('delay-banner-error')).toHaveTextContent('minimum no greater than maximum');
    expect(screen.getByTestId('delay-simulator-range-error')).toHaveTextContent('minimum no greater than maximum');
    expect(screen.getByTestId('delay-simulator-minimum')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('delay-simulator-maximum')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('delay-simulator-minimum'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('delay-simulator-scope-both'));
    fireEvent.click(screen.getByTestId('delay-simulator-apply'));
    expect(await screen.findByTestId('delay-banner-success')).toHaveTextContent('applied');
    expect(screen.getByTestId('delay-banner-status')).toHaveTextContent('12s · BOTH');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ minSeconds: 2, maxSeconds: 12, scope: 'BOTH' });
  });

  it('resets to zero while retaining the active scope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ minSeconds: 0, maxSeconds: 0, scope: 'API' }));
    renderDashboard('/dashboard?view=delay-simulator', { minSeconds: 4, maxSeconds: 8, scope: 'API' });
    await screen.findByTestId('delay-simulator-form');
    fireEvent.click(screen.getByTestId('delay-banner-reset'));
    expect(await screen.findByTestId('delay-banner-success')).toHaveTextContent('reset');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ minSeconds: 0, maxSeconds: 0, scope: 'API' });
  });

  it('does not add a client-side delay to API-backed actions when BOTH is active', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ accounts }))
      .mockResolvedValueOnce(response({ id: 'transfer-1' }, 201))
      .mockResolvedValueOnce(response({ accounts }));
    renderDashboard('/dashboard?view=transfer', { minSeconds: 20, maxSeconds: 20, scope: 'BOTH' });
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts }));
    const configuredFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(input).endsWith('/api/test-controls/delay') && method === 'GET') {
        return Promise.resolve(response({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' }));
      }
      if (String(input).endsWith('/api/test-controls/delay/sample') && method === 'POST') {
        return Promise.resolve(response({ ticket: 'logout-test-ticket', sampledSeconds: 0 }));
      }
      return configuredFetch(input, init);
    }));
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
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ));
  });
});
