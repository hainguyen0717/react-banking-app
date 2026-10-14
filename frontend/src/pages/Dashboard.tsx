import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { ACCOUNT_TYPES, AccountType, formatAud, parseAudToCents } from '../lib/banking';
import { clearCustomerSession, loadCustomerSession } from '../lib/session';
import styles from './Dashboard.module.css';

interface Account {
  id: string;
  accountNumber: string;
  customerId: string;
  type: AccountType;
  displayName: string | null;
  balanceCents: number;
  currency: 'AUD';
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  id: string;
  direction: 'SENT' | 'RECEIVED';
  amountCents: number;
  description: string | null;
  counterpartyAccountNumber: string;
  createdAt: string;
}

type HistoryState = Record<string, { status: 'loading' | 'ready' | 'error'; transactions: Transaction[]; error?: string }>;
type DashboardView = 'accounts' | 'new-account' | 'transfer';

function labelAccountType(type: AccountType) {
  return type === 'EVERYDAY' ? 'Everyday transactions' : type.charAt(0) + type.slice(1).toLowerCase();
}

export function Dashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customer = useMemo(() => loadCustomerSession(), []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsStatus, setAccountsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [accountsError, setAccountsError] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('EVERYDAY');
  const [displayName, setDisplayName] = useState('');
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destinationAccountNumber, setDestinationAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({});

  const loadAccounts = useCallback(async () => {
    if (!customer) return;
    setAccountsError('');
    try {
      const response = await apiRequest<{ accounts: Account[] }>(`/api/customers/${customer.id}/accounts`);
      setAccounts(response.accounts);
      setSourceAccountId((current) => current || response.accounts[0]?.id || '');
      setAccountsStatus('ready');
    } catch (error) {
      setAccountsStatus('error');
      setAccountsError(error instanceof Error ? error.message : 'Accounts could not be loaded.');
    }
  }, [customer]);

  const loadTransactions = useCallback(async (accountId: string) => {
    if (!customer) return;
    setHistory((current) => ({ ...current, [accountId]: { status: 'loading', transactions: [] } }));
    try {
      const response = await apiRequest<{ transactions: Transaction[] }>(
        `/api/customers/${customer.id}/accounts/${accountId}/transactions`,
      );
      setHistory((current) => ({ ...current, [accountId]: { status: 'ready', transactions: response.transactions } }));
    } catch (error) {
      setHistory((current) => ({
        ...current,
        [accountId]: {
          status: 'error',
          transactions: [],
          error: error instanceof Error ? error.message : 'Transactions could not be loaded.',
        },
      }));
    }
  }, [customer]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  if (!customer) return <Navigate to="/" replace />;

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage(null);
    setIsCreatingAccount(true);
    try {
      await apiRequest<Account>(`/api/customers/${customer!.id}/accounts`, {
        method: 'POST',
        body: JSON.stringify({ type: accountType, displayName: displayName || undefined }),
      });
      setDisplayName('');
      setAccountMessage('Account created with the configured opening balance.');
      await loadAccounts();
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : 'Account could not be created.');
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferMessage(null);
    const amountCents = parseAudToCents(amount);
    if (amountCents === null) {
      setTransferMessage('Enter a positive amount with no more than two decimal places.');
      return;
    }
    setIsTransferring(true);
    try {
      await apiRequest('/api/transfers', {
        method: 'POST',
        body: JSON.stringify({
          customerId: customer!.id,
          sourceAccountId,
          destinationAccountNumber,
          amountCents,
          description: description || undefined,
        }),
      });
      setAmount('');
      setDescription('');
      setTransferMessage('Transfer complete. Balances and transaction history are up to date.');
      await loadAccounts();
      if (expandedAccountId) await loadTransactions(expandedAccountId);
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'Transfer could not be completed.');
    } finally {
      setIsTransferring(false);
    }
  }

  function handleHistoryToggle(accountId: string) {
    if (expandedAccountId === accountId) {
      setExpandedAccountId(null);
      return;
    }
    setExpandedAccountId(accountId);
    void loadTransactions(accountId);
  }

  function handleLogout() {
    clearCustomerSession();
    navigate('/');
  }

  const totalBalance = accounts.reduce((total, account) => total + account.balanceCents, 0);
  const requestedView = searchParams.get('view');
  const activeView: DashboardView = requestedView === 'new-account' || requestedView === 'transfer'
    ? requestedView
    : 'accounts';

  return (
    <div className={styles.shell} data-testid="dashboard-shell">
      <a className={styles.skipLink} href="#dashboard-content" data-testid="dashboard-skip-link">Skip to dashboard content</a>
      <header className={styles.topbar} data-testid="dashboard-header">
        <div className={styles.brand} data-testid="dashboard-brand">EXPRESS / BANK</div>
        <div className={styles.customerMeta} data-testid="dashboard-customer-meta">
          <span className={styles.customerName} data-testid="dashboard-customer-name">{customer.firstName} {customer.lastName}</span>
          <button className={styles.logoutButton} type="button" onClick={handleLogout} data-testid="dashboard-logout">Log out</button>
        </div>
      </header>

      <main className={styles.main} data-testid="dashboard-main">
        <section className={styles.summary} aria-labelledby="dashboard-title" data-testid="dashboard-summary">
          <div className={styles.summaryCopy} data-testid="dashboard-summary-copy">
            <p className={styles.eyebrow} data-testid="dashboard-eyebrow">Financial overview</p>
            <h1 className={styles.title} id="dashboard-title" data-testid="dashboard-title">Good day, {customer.firstName}.</h1>
            <p className={styles.subtitle} data-testid="dashboard-subtitle">Create test accounts, move funds and inspect each recorded transfer.</p>
          </div>
          <div className={styles.totalCard} data-testid="dashboard-total-card">
            <span className={styles.totalLabel} data-testid="dashboard-total-label">Total available balance</span>
            <strong className={styles.totalValue} data-testid="dashboard-total-balance">{formatAud(totalBalance)}</strong>
            <span className={styles.totalCurrency} data-testid="dashboard-total-currency">Across {accounts.length} AUD {accounts.length === 1 ? 'account' : 'accounts'}</span>
          </div>
        </section>

        <div className={styles.dashboardLayout} data-testid="dashboard-layout">
          <aside className={styles.sidebar} data-testid="dashboard-sidebar">
            <nav className={styles.functionNav} aria-label="Dashboard functions" data-testid="dashboard-function-nav">
              <section className={styles.navGroup} aria-labelledby="dashboard-nav-accounts-label" data-testid="dashboard-nav-group-accounts">
                <h2 className={styles.navGroupLabel} id="dashboard-nav-accounts-label" data-testid="dashboard-nav-group-accounts-label">Accounts</h2>
                <ul className={styles.navList} data-testid="dashboard-nav-group-accounts-list">
                  <li data-testid="dashboard-nav-accounts-overview-item">
                    <Link className={styles.navLink} to="/dashboard?view=accounts" aria-current={activeView === 'accounts' ? 'page' : undefined} data-testid="dashboard-nav-accounts-overview">Accounts overview</Link>
                  </li>
                  <li data-testid="dashboard-nav-new-account-item">
                    <Link className={styles.navLink} to="/dashboard?view=new-account" aria-current={activeView === 'new-account' ? 'page' : undefined} data-testid="dashboard-nav-new-account">New account</Link>
                  </li>
                </ul>
              </section>
              <section className={styles.navGroup} aria-labelledby="dashboard-nav-transfer-label" data-testid="dashboard-nav-group-transfer">
                <h2 className={styles.navGroupLabel} id="dashboard-nav-transfer-label" data-testid="dashboard-nav-group-transfer-label">Transfer</h2>
                <ul className={styles.navList} data-testid="dashboard-nav-group-transfer-list">
                  <li data-testid="dashboard-nav-transfer-item">
                    <Link className={styles.navLink} to="/dashboard?view=transfer" aria-current={activeView === 'transfer' ? 'page' : undefined} data-testid="dashboard-nav-transfer">Transfer</Link>
                  </li>
                </ul>
              </section>
            </nav>
          </aside>

          <div className={styles.dashboardContent} id="dashboard-content" tabIndex={-1} data-testid="dashboard-content">
            {activeView === 'accounts' ? (
              <section className={styles.viewPanel} aria-labelledby="accounts-heading" data-testid="dashboard-view-accounts">
                <div className={styles.sectionHeading} data-testid="dashboard-accounts-heading-row">
                  <div data-testid="dashboard-accounts-heading-copy">
                    <p className={styles.eyebrow} data-testid="dashboard-accounts-eyebrow">Portfolio</p>
                    <h2 className={styles.sectionTitle} id="accounts-heading" data-testid="dashboard-view-accounts-heading">Accounts overview</h2>
                  </div>
                  <button className={styles.refreshButton} type="button" onClick={() => void loadAccounts()} data-testid="dashboard-accounts-refresh">Refresh</button>
                </div>

                {accountsStatus === 'loading' ? <p className={styles.state} role="status" data-testid="dashboard-accounts-loading">Loading accounts…</p> : null}
                {accountsStatus === 'error' ? <p className={styles.error} role="alert" data-testid="dashboard-accounts-error">{accountsError}</p> : null}
                {accountsStatus === 'ready' && accounts.length === 0 ? (
                  <div className={styles.emptyState} data-testid="dashboard-accounts-empty">
                    <h3 data-testid="dashboard-accounts-empty-title">No accounts yet</h3>
                    <p data-testid="dashboard-accounts-empty-copy">Choose one of the three account types to create your first test account.</p>
                    <Link className={styles.inlineLink} to="/dashboard?view=new-account" data-testid="dashboard-accounts-empty-new-account-link">Open a new account</Link>
                  </div>
                ) : null}

                <div className={styles.accountList} data-testid="dashboard-account-list">
                  {accounts.map((account) => {
                    const accountHistory = history[account.id];
                    const expanded = expandedAccountId === account.id;
                    return (
                      <article className={styles.accountCard} key={account.id} data-testid={`account-card-${account.id}`}>
                        <div className={styles.accountCardTop} data-testid={`account-card-header-${account.id}`}>
                          <div data-testid={`account-card-identity-${account.id}`}>
                            <p className={styles.accountType} data-testid={`account-type-${account.id}`}>{labelAccountType(account.type)}</p>
                            <h3 className={styles.accountName} data-testid={`account-name-${account.id}`}>{account.displayName || labelAccountType(account.type)}</h3>
                          </div>
                          <span className={styles.statusBadge} data-testid={`account-status-${account.id}`}>Active</span>
                        </div>
                        <p className={styles.accountNumber} data-testid={`account-number-${account.id}`}>{account.accountNumber}</p>
                        <div className={styles.accountBalanceRow} data-testid={`account-balance-row-${account.id}`}>
                          <span className={styles.balanceLabel} data-testid={`account-balance-label-${account.id}`}>Available</span>
                          <strong className={styles.accountBalance} data-testid={`account-balance-${account.id}`}>{formatAud(account.balanceCents)}</strong>
                        </div>
                        <button className={styles.historyButton} type="button" aria-expanded={expanded} aria-controls={`transactions-${account.id}`} onClick={() => handleHistoryToggle(account.id)} data-testid={`account-transactions-toggle-${account.id}`}>
                          {expanded ? 'Hide transactions' : 'View transactions'}
                        </button>
                        {expanded ? (
                          <div className={styles.transactions} id={`transactions-${account.id}`} data-testid={`transactions-panel-${account.id}`}>
                            {accountHistory?.status === 'loading' ? <p className={styles.state} role="status" data-testid={`transactions-loading-${account.id}`}>Loading transactions…</p> : null}
                            {accountHistory?.status === 'error' ? <p className={styles.error} role="alert" data-testid={`transactions-error-${account.id}`}>{accountHistory.error}</p> : null}
                            {accountHistory?.status === 'ready' && accountHistory.transactions.length === 0 ? <p className={styles.state} data-testid={`transactions-empty-${account.id}`}>No transfers recorded for this account.</p> : null}
                            {accountHistory?.transactions.map((transaction) => (
                              <div className={styles.transactionRow} key={transaction.id} data-testid={`transaction-row-${transaction.id}`}>
                                <div className={styles.transactionCopy} data-testid={`transaction-copy-${transaction.id}`}>
                                  <strong className={styles.transactionDirection} data-testid={`transaction-direction-${transaction.id}`}>{transaction.direction === 'SENT' ? 'Sent' : 'Received'}</strong>
                                  <span className={styles.counterparty} data-testid={`transaction-counterparty-${transaction.id}`}>{transaction.counterpartyAccountNumber}</span>
                                  {transaction.description ? <span className={styles.description} data-testid={`transaction-description-${transaction.id}`}>{transaction.description}</span> : null}
                                </div>
                                <span className={transaction.direction === 'SENT' ? styles.sentAmount : styles.receivedAmount} data-testid={`transaction-amount-${transaction.id}`}>{transaction.direction === 'SENT' ? '−' : '+'}{formatAud(transaction.amountCents)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {activeView === 'new-account' ? (
              <section className={styles.viewPanel} aria-labelledby="new-account-view-heading" data-testid="dashboard-view-new-account">
                <h2 className={styles.sectionTitle} id="new-account-view-heading" data-testid="dashboard-view-new-account-heading">New account</h2>
                <section className={styles.actionCard} aria-labelledby="create-account-heading" data-testid="account-create-section">
                  <p className={styles.eyebrow} data-testid="account-create-eyebrow">Account setup</p>
                  <h3 className={styles.actionTitle} id="create-account-heading" data-testid="account-create-heading">Open a test account</h3>
                  <p className={styles.actionCopy} data-testid="account-create-copy">Every new account receives the server-configured opening balance.</p>
                  <form className={styles.form} onSubmit={handleCreateAccount} data-testid="account-create-form">
                    <label className={styles.label} htmlFor="account-type" data-testid="account-create-type-label">Account type
                      <select className={styles.input} id="account-type" value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)} data-testid="account-create-type">
                        {ACCOUNT_TYPES.map((type) => <option key={type} value={type} data-testid={`account-create-type-option-${type}`}>{labelAccountType(type)}</option>)}
                      </select>
                    </label>
                    <label className={styles.label} htmlFor="display-name" data-testid="account-create-display-name-label">Display name <span className={styles.optional} data-testid="account-create-display-name-optional">Optional</span>
                      <input className={styles.input} id="display-name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} data-testid="account-create-display-name" />
                    </label>
                    {accountMessage ? <p className={styles.formMessage} role="status" data-testid="account-create-message">{accountMessage}</p> : null}
                    <button className={styles.primaryButton} type="submit" disabled={isCreatingAccount} data-testid="account-create-submit">{isCreatingAccount ? 'Opening account…' : 'Open account'}</button>
                  </form>
                </section>
              </section>
            ) : null}

            {activeView === 'transfer' ? (
              <section className={styles.viewPanel} aria-labelledby="transfer-view-heading" data-testid="dashboard-view-transfer">
                <h2 className={styles.sectionTitle} id="transfer-view-heading" data-testid="dashboard-view-transfer-heading">Transfer</h2>
                <section className={styles.actionCard} aria-labelledby="transfer-heading" data-testid="transfer-section">
                  <p className={styles.eyebrow} data-testid="transfer-eyebrow">Transfer</p>
                  <h3 className={styles.actionTitle} id="transfer-heading" data-testid="transfer-heading">Send money</h3>
                  <p className={styles.actionCopy} data-testid="transfer-copy">Transfer to another Express Bank account. The destination account may belong to another customer.</p>
                  <form className={styles.form} onSubmit={handleTransfer} data-testid="transfer-form">
                    <label className={styles.label} htmlFor="source-account" data-testid="transfer-source-label">From
                      <select className={styles.input} id="source-account" value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)} required disabled={accounts.length === 0} data-testid="transfer-source-account">
                        {accounts.length === 0 ? <option value="" data-testid="transfer-source-empty-option">Create an account first</option> : null}
                        {accounts.map((account) => <option key={account.id} value={account.id} data-testid={`transfer-source-option-${account.id}`}>{account.displayName || labelAccountType(account.type)} · {account.accountNumber}</option>)}
                      </select>
                    </label>
                    <label className={styles.label} htmlFor="destination-account" data-testid="transfer-destination-label">Destination account number
                      <input className={styles.input} id="destination-account" value={destinationAccountNumber} onChange={(event) => setDestinationAccountNumber(event.target.value)} placeholder="EXB-123456789" required data-testid="transfer-destination-account" />
                    </label>
                    <label className={styles.label} htmlFor="transfer-amount" data-testid="transfer-amount-label">Amount (AUD)
                      <input className={styles.input} id="transfer-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="250.00" required data-testid="transfer-amount" />
                    </label>
                    <label className={styles.label} htmlFor="transfer-description" data-testid="transfer-description-label">Description <span className={styles.optional} data-testid="transfer-description-optional">Optional</span>
                      <input className={styles.input} id="transfer-description" maxLength={140} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="transfer-description" />
                    </label>
                    {transferMessage ? <p className={styles.formMessage} role="status" data-testid="transfer-message">{transferMessage}</p> : null}
                    <button className={styles.primaryButton} type="submit" disabled={isTransferring || accounts.length === 0} data-testid="transfer-submit">{isTransferring ? 'Sending…' : 'Send transfer'}</button>
                  </form>
                </section>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
