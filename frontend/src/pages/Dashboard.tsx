import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { ACCOUNT_TYPES, AccountType, formatAud, parseAudToCents } from '../lib/banking';
import { useAuth } from '../auth/AuthContext';
import { DateTimePicker } from '../components/DateTimePicker';
import styles from './Dashboard.module.css';

interface Account {
  id: string;
  accountNumber: string;
  customerId: string;
  ownershipType: 'SINGLE' | 'JOINT';
  owners: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
  type: AccountType;
  displayName: string | null;
  balanceCents: number;
  currency: 'AUD';
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  id: string;
  method: 'TRANSFER' | 'BANK_ACCOUNT' | 'PAYID' | 'BPAY';
  direction: 'SENT' | 'RECEIVED';
  amountCents: number;
  description: string | null;
  counterpartyAccountNumber: string | null;
  counterpartyLabel: string;
  customerReference: string | null;
  createdAt: string;
}

type PaymentMethod = 'BANK_ACCOUNT' | 'PAYID' | 'BPAY';
interface PaymentReview {
  method: PaymentMethod;
  sourceAccountNumber: string;
  amountCents: number;
  description: string | null;
  payeeName: string;
  destinationAccountNumber?: string;
  payId?: string;
  billerCode?: string;
  customerReference?: string;
}
interface PaymentReceipt extends Omit<PaymentReview, 'destinationAccountNumber' | 'payId' | 'billerCode' | 'customerReference'> {
  id: string;
  createdAt: string;
  destinationAccountNumber: string | null;
  payId: string | null;
  billerCode: string | null;
  customerReference: string | null;
}

interface ScheduledTransfer {
  id: string;
  sourceAccountId: string;
  sourceAccountNumber: string;
  destinationAccountNumber: string;
  amountCents: number;
  description: string | null;
  scheduledFor: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  failureReason: string | null;
}

interface CardTransaction {
  id: string;
  merchant: string;
  amountCents: number;
  occurredAt: string;
}

interface Card {
  id: string;
  accountId: string;
  maskedNumber: string;
  status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  account: { accountNumber: string; displayName: string | null; type: AccountType };
  transactions: CardTransaction[];
}

type HistoryState = Record<string, { status: 'loading' | 'ready' | 'error'; transactions: Transaction[]; error?: string }>;
type DashboardView = 'accounts' | 'new-account' | 'new-joint-account' | 'payments' | 'transfer' | 'profile' | 'schedule-transfer' | 'scheduled-transfers' | 'cards';
type FormMessage = { kind: 'success' | 'error'; text: string };

function labelAccountType(type: AccountType) {
  return type === 'EVERYDAY' ? 'Everyday transactions' : type.charAt(0) + type.slice(1).toLowerCase();
}

export function Dashboard() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const customer = auth.customer;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsStatus, setAccountsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [accountsError, setAccountsError] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('EVERYDAY');
  const [displayName, setDisplayName] = useState('');
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [jointAccountType, setJointAccountType] = useState<AccountType>('EVERYDAY');
  const [jointDisplayName, setJointDisplayName] = useState('');
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [jointAccountMessage, setJointAccountMessage] = useState<FormMessage | null>(null);
  const [isCreatingJointAccount, setIsCreatingJointAccount] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destinationAccountNumber, setDestinationAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({});
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [profileFirstName, setProfileFirstName] = useState(customer?.firstName ?? '');
  const [profileLastName, setProfileLastName] = useState(customer?.lastName ?? '');
  const [profileAddress, setProfileAddress] = useState(customer?.address ?? '');
  const [profileMessage, setProfileMessage] = useState<FormMessage | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<FormMessage | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledTransfers, setScheduledTransfers] = useState<ScheduledTransfer[]>([]);
  const [schedulesStatus, setSchedulesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [schedulesError, setSchedulesError] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsStatus, setCardsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cardsError, setCardsError] = useState('');
  const [newCardAccountId, setNewCardAccountId] = useState('');
  const [cardMessage, setCardMessage] = useState<FormMessage | null>(null);
  const [cardInFlight, setCardInFlight] = useState<string | null>(null);
  const [disableCardId, setDisableCardId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_ACCOUNT');
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState('');
  const [paymentDestinationAccount, setPaymentDestinationAccount] = useState('');
  const [paymentPayId, setPaymentPayId] = useState('');
  const [paymentBillerCode, setPaymentBillerCode] = useState('');
  const [paymentCustomerReference, setPaymentCustomerReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [paymentReview, setPaymentReview] = useState<PaymentReview | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<PaymentReceipt | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<FormMessage | null>(null);
  const [paymentInFlight, setPaymentInFlight] = useState<'resolve' | 'confirm' | null>(null);
  const paymentReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const paymentReceiptHeadingRef = useRef<HTMLHeadingElement>(null);
  const disableDialogRef = useRef<HTMLElement>(null);
  const disableCancelRef = useRef<HTMLButtonElement>(null);
  const disableTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastDisableTriggerId = useRef<string | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!customer) return;
    setAccountsError('');
    try {
      const response = await apiRequest<{ accounts: Account[] }>('/api/accounts');
      setAccounts(response.accounts);
      setSourceAccountId((current) => current || response.accounts[0]?.id || '');
      setPaymentSourceAccountId((current) => current || response.accounts[0]?.id || '');
      setNewCardAccountId((current) => current || response.accounts[0]?.id || '');
      setAccountsStatus('ready');
    } catch (error) {
      setAccountsStatus('error');
      setAccountsError(error instanceof Error ? error.message : 'Accounts could not be loaded.');
    }
  }, [customer]);

  const loadScheduledTransfers = useCallback(async () => {
    if (!customer) return;
    setSchedulesStatus('loading');
    setSchedulesError('');
    try {
      const response = await apiRequest<{ scheduledTransfers: ScheduledTransfer[] }>('/api/scheduled-transfers');
      setScheduledTransfers(response.scheduledTransfers);
      setSchedulesStatus('ready');
    } catch (error) {
      setSchedulesStatus('error');
      setSchedulesError(error instanceof Error ? error.message : 'Scheduled transfers could not be loaded.');
    }
  }, [customer]);

  const loadCards = useCallback(async () => {
    if (!customer) return;
    setCardsStatus('loading');
    setCardsError('');
    try {
      const response = await apiRequest<{ cards: Card[] }>('/api/cards');
      setCards(response.cards);
      setCardsStatus('ready');
    } catch (error) {
      setCardsStatus('error');
      setCardsError(error instanceof Error ? error.message : 'Cards could not be loaded.');
    }
  }, [customer]);

  const loadTransactions = useCallback(async (accountId: string) => {
    if (!customer) return;
    setHistory((current) => ({ ...current, [accountId]: { status: 'loading', transactions: [] } }));
    try {
      const response = await apiRequest<{ transactions: Transaction[] }>(
        `/api/accounts/${accountId}/transactions`,
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

  useEffect(() => {
    if (searchParams.get('view') === 'scheduled-transfers') void loadScheduledTransfers();
    if (searchParams.get('view') === 'cards') void loadCards();
  }, [searchParams, loadScheduledTransfers, loadCards]);

  useEffect(() => {
    if (disableCardId) {
      lastDisableTriggerId.current = disableCardId;
      disableCancelRef.current?.focus();
      return;
    }

    const triggerId = lastDisableTriggerId.current;
    if (triggerId) {
      lastDisableTriggerId.current = null;
      disableTriggerRefs.current.get(triggerId)?.focus();
    }
  }, [disableCardId]);

  useEffect(() => {
    if (paymentReview) paymentReviewHeadingRef.current?.focus();
    if (paymentReceipt) paymentReceiptHeadingRef.current?.focus();
  }, [paymentReview, paymentReceipt]);

  if (!customer) return null;

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage(null);
    setIsCreatingAccount(true);
    try {
      await apiRequest<Account>('/api/accounts', {
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

  async function handleCreateJointAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJointAccountMessage(null);
    setIsCreatingJointAccount(true);
    try {
      await apiRequest<Account>('/api/joint-accounts', {
        method: 'POST',
        body: JSON.stringify({
          type: jointAccountType,
          displayName: jointDisplayName || undefined,
          coOwnerEmail,
        }),
      });
      setJointDisplayName('');
      setCoOwnerEmail('');
      setJointAccountMessage({
        kind: 'success',
        text: 'Joint account created. Both owners can now view the shared balance and make transfers.',
      });
      await loadAccounts();
    } catch (error) {
      setJointAccountMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Joint account could not be created.',
      });
    } finally {
      setIsCreatingJointAccount(false);
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

  async function handleProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileMessage(null);
    setIsSavingProfile(true);
    try {
      const updated = await auth.updateProfile({ firstName: profileFirstName, lastName: profileLastName, address: profileAddress });
      setProfileFirstName(updated.firstName);
      setProfileLastName(updated.lastName);
      setProfileAddress(updated.address ?? '');
      setProfileMessage({ kind: 'success', text: 'Personal information updated.' });
    } catch (error) {
      setProfileMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Personal information could not be updated.' });
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleScheduleTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScheduleMessage(null);
    const amountCents = parseAudToCents(amount);
    if (amountCents === null) {
      setScheduleMessage({ kind: 'error', text: 'Enter a positive amount with no more than two decimal places.' });
      return;
    }
    if (!scheduledFor) {
      setScheduleMessage({ kind: 'error', text: 'Choose a future date and time.' });
      return;
    }
    setIsScheduling(true);
    try {
      await apiRequest('/api/scheduled-transfers', {
        method: 'POST',
        body: JSON.stringify({ sourceAccountId, destinationAccountNumber, amountCents, description: description || undefined, scheduledFor }),
      });
      setAmount(''); setDescription(''); setScheduledFor(null);
      setScheduleMessage({ kind: 'success', text: 'Transfer scheduled. Funds will be checked again when it is due.' });
    } catch (error) {
      setScheduleMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Transfer could not be scheduled.' });
    } finally {
      setIsScheduling(false);
    }
  }

  async function handleOpenCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCardMessage(null);
    setCardInFlight('new');
    try {
      await apiRequest('/api/cards', { method: 'POST', body: JSON.stringify({ accountId: newCardAccountId }) });
      setCardMessage({ kind: 'success', text: 'Card opened with five sample card transactions.' });
      await loadCards();
    } catch (error) {
      setCardMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Card could not be opened.' });
    } finally { setCardInFlight(null); }
  }

  async function handleCardAction(cardId: string, action: 'lock' | 'unlock' | 'disable') {
    setCardInFlight(`${cardId}-${action}`);
    setCardMessage(null);
    try {
      await apiRequest(`/api/cards/${cardId}/${action}`, { method: 'POST' });
      setDisableCardId(null);
      await loadCards();
    } catch (error) {
      setCardMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Card could not be updated.' });
    } finally { setCardInFlight(null); }
  }

  function invalidatePaymentReview() {
    setPaymentReview(null);
    setPaymentMessage(null);
  }

  function paymentPayload() {
    const amountCents = parseAudToCents(paymentAmount);
    if (amountCents === null) return null;
    return {
      method: paymentMethod,
      sourceAccountId: paymentSourceAccountId,
      amountCents,
      description: paymentDescription || undefined,
      ...(paymentMethod === 'BANK_ACCOUNT' ? { destinationAccountNumber: paymentDestinationAccount } : {}),
      ...(paymentMethod === 'PAYID' ? { payId: paymentPayId } : {}),
      ...(paymentMethod === 'BPAY' ? { billerCode: paymentBillerCode, customerReference: paymentCustomerReference } : {}),
    };
  }

  async function handlePaymentResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentMessage(null);
    const payload = paymentPayload();
    if (!payload) {
      setPaymentMessage({ kind: 'error', text: 'Enter a positive amount with no more than two decimal places.' });
      return;
    }
    setPaymentInFlight('resolve');
    try {
      setPaymentReview(await apiRequest<PaymentReview>('/api/payments/resolve', { method: 'POST', body: JSON.stringify(payload) }));
    } catch (error) {
      setPaymentMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Payment details could not be resolved.' });
    } finally {
      setPaymentInFlight(null);
    }
  }

  async function handlePaymentConfirm() {
    const payload = paymentPayload();
    if (!payload || !paymentReview) return;
    setPaymentMessage(null);
    setPaymentInFlight('confirm');
    try {
      const receipt = await apiRequest<PaymentReceipt>('/api/payments', { method: 'POST', body: JSON.stringify(payload) });
      setPaymentReceipt(receipt);
      setPaymentReview(null);
      setPaymentMessage({ kind: 'success', text: 'Payment complete. Your receipt is ready.' });
      setExpandedAccountId(paymentSourceAccountId);
      await loadAccounts();
      await loadTransactions(paymentSourceAccountId);
    } catch (error) {
      setPaymentMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Payment could not be completed.' });
    } finally {
      setPaymentInFlight(null);
    }
  }

  function startAnotherPayment() {
    setPaymentReceipt(null);
    setPaymentReview(null);
    setPaymentMessage(null);
    setPaymentDestinationAccount('');
    setPaymentPayId('');
    setPaymentBillerCode('');
    setPaymentCustomerReference('');
    setPaymentAmount('');
    setPaymentDescription('');
  }

  function closeDisableDialog() {
    setDisableCardId(null);
  }

  function handleDisableDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDisableDialog();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = Array.from(disableDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
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

  async function handleLogout() {
    setLogoutError(null);
    try {
      await auth.logout();
      navigate('/');
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Logout could not be completed.');
    }
  }

  const totalBalance = accounts.reduce((total, account) => total + account.balanceCents, 0);
  const requestedView = searchParams.get('view');
  const validViews: DashboardView[] = ['accounts', 'new-account', 'new-joint-account', 'payments', 'transfer', 'profile', 'schedule-transfer', 'scheduled-transfers', 'cards'];
  const activeView: DashboardView = validViews.includes(requestedView as DashboardView)
    ? requestedView as DashboardView
    : 'accounts';

  return (
    <div className={styles.shell} data-testid="dashboard-shell">
      <a className={styles.skipLink} href="#dashboard-content" data-testid="dashboard-skip-link">Skip to dashboard content</a>
      <header className={styles.topbar} data-testid="dashboard-header">
        <div className={styles.brand} data-testid="dashboard-brand">EXPRESS / BANK</div>
        <div className={styles.customerMeta} data-testid="dashboard-customer-meta">
          <span className={styles.customerName} data-testid="dashboard-customer-name">{customer.firstName} {customer.lastName}</span>
          <button className={styles.logoutButton} type="button" onClick={handleLogout} data-testid="dashboard-logout">Log out</button>
          {logoutError ? <span className={styles.error} role="alert" data-testid="dashboard-logout-error">{logoutError}</span> : null}
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
                  <li data-testid="dashboard-nav-new-joint-account-item">
                    <Link className={styles.navLink} to="/dashboard?view=new-joint-account" aria-current={activeView === 'new-joint-account' ? 'page' : undefined} data-testid="dashboard-nav-new-joint-account">New joint account</Link>
                  </li>
                </ul>
              </section>
              <section className={styles.standaloneNav} aria-label="Cards" data-testid="dashboard-nav-cards-standalone">
                <ul className={styles.navList} data-testid="dashboard-nav-cards-list">
                  <li data-testid="dashboard-nav-cards-item">
                    <Link className={styles.navLink} to="/dashboard?view=cards" aria-current={activeView === 'cards' ? 'page' : undefined} data-testid="dashboard-nav-cards">Cards</Link>
                  </li>
                </ul>
              </section>
              <section className={styles.standaloneNav} aria-label="Payments" data-testid="dashboard-nav-payments-standalone">
                <ul className={styles.navList} data-testid="dashboard-nav-payments-list">
                  <li data-testid="dashboard-nav-payments-item">
                    <Link className={styles.navLink} to="/dashboard?view=payments" aria-current={activeView === 'payments' ? 'page' : undefined} data-testid="dashboard-nav-payments">Payments</Link>
                  </li>
                </ul>
              </section>
              <section className={styles.navGroup} aria-labelledby="dashboard-nav-transfer-label" data-testid="dashboard-nav-group-transfer">
                <h2 className={styles.navGroupLabel} id="dashboard-nav-transfer-label" data-testid="dashboard-nav-group-transfer-label">Transfer</h2>
                <ul className={styles.navList} data-testid="dashboard-nav-group-transfer-list">
                  <li data-testid="dashboard-nav-transfer-item">
                    <Link className={styles.navLink} to="/dashboard?view=transfer" aria-current={activeView === 'transfer' ? 'page' : undefined} data-testid="dashboard-nav-transfer">Transfer</Link>
                  </li>
                  <li data-testid="dashboard-nav-schedule-transfer-item">
                    <Link className={styles.navLink} to="/dashboard?view=schedule-transfer" aria-current={activeView === 'schedule-transfer' ? 'page' : undefined} data-testid="dashboard-nav-schedule-transfer">Schedule transfer</Link>
                  </li>
                  <li data-testid="dashboard-nav-scheduled-transfers-item">
                    <Link className={styles.navLink} to="/dashboard?view=scheduled-transfers" aria-current={activeView === 'scheduled-transfers' ? 'page' : undefined} data-testid="dashboard-nav-scheduled-transfers">Scheduled transfers</Link>
                  </li>
                </ul>
              </section>
              <section className={styles.navGroup} aria-labelledby="dashboard-nav-profile-label" data-testid="dashboard-nav-group-profile">
                <h2 className={styles.navGroupLabel} id="dashboard-nav-profile-label" data-testid="dashboard-nav-group-profile-label">Profile</h2>
                <ul className={styles.navList} data-testid="dashboard-nav-group-profile-list">
                  <li data-testid="dashboard-nav-profile-item"><Link className={styles.navLink} to="/dashboard?view=profile" aria-current={activeView === 'profile' ? 'page' : undefined} data-testid="dashboard-nav-profile">Personal information</Link></li>
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
                        <div className={styles.accountOwnership} data-testid={`account-owners-${account.id}`}>
                          <span className={account.ownershipType === 'JOINT' ? styles.jointBadge : styles.personalBadge} data-testid={`account-ownership-${account.id}`}>
                            {account.ownershipType === 'JOINT' ? 'Joint' : 'Personal'}
                          </span>
                          {(account.owners ?? []).map((owner) => (
                            <span className={styles.accountOwner} key={owner.id} data-testid={`account-owner-${account.id}-${owner.id}`}>
                              {owner.firstName} {owner.lastName} · {owner.email}
                            </span>
                          ))}
                        </div>
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
                                  <strong className={styles.transactionDirection} data-testid={`transaction-direction-${transaction.id}`}>{transaction.direction === 'SENT' ? 'Sent' : 'Received'} · {transaction.method ?? 'TRANSFER'}</strong>
                                  <span className={styles.counterparty} data-testid={`transaction-counterparty-${transaction.id}`}>{transaction.counterpartyLabel ?? transaction.counterpartyAccountNumber}</span>
                                  {transaction.description ? <span className={styles.description} data-testid={`transaction-description-${transaction.id}`}>{transaction.description}</span> : null}
                                  {transaction.customerReference ? <span className={styles.description} data-testid={`transaction-reference-${transaction.id}`}>Reference {transaction.customerReference}</span> : null}
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

            {activeView === 'new-joint-account' ? (
              <section className={styles.viewPanel} aria-labelledby="new-joint-account-view-heading" data-testid="dashboard-view-new-joint-account">
                <h2 className={styles.sectionTitle} id="new-joint-account-view-heading" data-testid="dashboard-view-new-joint-account-heading">New joint account</h2>
                <section className={styles.actionCard} aria-labelledby="create-joint-account-heading" data-testid="joint-account-create-section">
                  <p className={styles.eyebrow} data-testid="joint-account-create-eyebrow">Shared account setup</p>
                  <h3 className={styles.actionTitle} id="create-joint-account-heading" data-testid="joint-account-create-heading">Open a joint test account</h3>
                  <p className={styles.actionCopy} data-testid="joint-account-create-copy">Create one shared account with the configured opening balance applied once.</p>
                  <form className={styles.form} onSubmit={handleCreateJointAccount} data-testid="joint-account-create-form">
                    <label className={styles.label} htmlFor="joint-account-type" data-testid="joint-account-create-type-label">Account type
                      <select className={styles.input} id="joint-account-type" value={jointAccountType} onChange={(event) => setJointAccountType(event.target.value as AccountType)} data-testid="joint-account-create-type">
                        {ACCOUNT_TYPES.map((type) => <option key={type} value={type} data-testid={`joint-account-create-type-option-${type}`}>{labelAccountType(type)}</option>)}
                      </select>
                    </label>
                    <label className={styles.label} htmlFor="joint-account-display-name" data-testid="joint-account-create-display-name-label">Display name <span className={styles.optional} data-testid="joint-account-create-display-name-optional">Optional</span>
                      <input className={styles.input} id="joint-account-display-name" maxLength={80} value={jointDisplayName} onChange={(event) => setJointDisplayName(event.target.value)} data-testid="joint-account-create-display-name" />
                    </label>
                    <label className={styles.label} htmlFor="joint-account-co-owner-email" data-testid="joint-account-create-co-owner-email-label">Co-owner email
                      <input className={styles.input} id="joint-account-co-owner-email" type="email" value={coOwnerEmail} onChange={(event) => setCoOwnerEmail(event.target.value)} aria-describedby="joint-account-create-co-owner-help" required data-testid="joint-account-create-co-owner-email" />
                    </label>
                    <p className={styles.fieldHelp} id="joint-account-create-co-owner-help" data-testid="joint-account-create-co-owner-help">The co-owner must already be a registered active customer. Both owners can view the account and transfer from its shared balance.</p>
                    {jointAccountMessage ? (
                      <p className={jointAccountMessage.kind === 'error' ? styles.error : styles.formMessage} role={jointAccountMessage.kind === 'error' ? 'alert' : 'status'} aria-live="polite" data-testid="joint-account-create-message">
                        {jointAccountMessage.text}
                      </p>
                    ) : null}
                    <button className={styles.primaryButton} type="submit" disabled={isCreatingJointAccount} data-testid="joint-account-create-submit">{isCreatingJointAccount ? 'Opening joint account…' : 'Open joint account'}</button>
                  </form>
                </section>
              </section>
            ) : null}

            {activeView === 'payments' ? (
              <section className={styles.viewPanel} aria-labelledby="payments-heading" data-testid="dashboard-view-payments">
                <h2 className={styles.sectionTitle} id="payments-heading" data-testid="payments-heading">Payments</h2>
                <p className={styles.actionCopy} data-testid="payments-copy">Make an immediate AUD payment by Express Bank account number, email PayID or BPAY.</p>
                {paymentMessage ? <p className={paymentMessage.kind === 'error' ? styles.error : styles.formMessage} role={paymentMessage.kind === 'error' ? 'alert' : 'status'} data-testid="payment-message">{paymentMessage.text}</p> : null}

                {!paymentReview && !paymentReceipt ? (
                  <form className={`${styles.actionCard} ${styles.form}`} onSubmit={handlePaymentResolve} aria-busy={paymentInFlight === 'resolve'} data-testid="payment-entry-form">
                    <fieldset className={styles.methodSelector} data-testid="payment-method-group">
                      <legend className={styles.label} data-testid="payment-method-legend">Payment method</legend>
                      {(['BANK_ACCOUNT', 'PAYID', 'BPAY'] as PaymentMethod[]).map((method) => (
                        <label className={paymentMethod === method ? styles.methodSelected : styles.methodOption} key={method} data-testid={`payment-method-${method === 'BANK_ACCOUNT' ? 'bank-account' : method.toLowerCase()}-label`}>
                          <input type="radio" name="payment-method" value={method} checked={paymentMethod === method} onChange={() => { setPaymentMethod(method); invalidatePaymentReview(); }} data-testid={`payment-method-${method === 'BANK_ACCOUNT' ? 'bank-account' : method.toLowerCase()}`} />
                          <span data-testid={`payment-method-${method === 'BANK_ACCOUNT' ? 'bank-account' : method.toLowerCase()}-text`}>{method === 'BANK_ACCOUNT' ? 'Bank account' : method === 'PAYID' ? 'Email PayID' : 'BPAY'}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className={styles.label} htmlFor="payment-source-account" data-testid="payment-source-label">From
                      <select className={styles.input} id="payment-source-account" value={paymentSourceAccountId} onChange={(event) => { setPaymentSourceAccountId(event.target.value); invalidatePaymentReview(); }} required disabled={accounts.length === 0} data-testid="payment-source-account">
                        {accounts.length === 0 ? <option value="" data-testid="payment-source-empty-option">Create an account first</option> : null}
                        {accounts.map((account) => <option key={account.id} value={account.id} data-testid={`payment-source-option-${account.id}`}>{account.displayName || labelAccountType(account.type)} · {account.accountNumber}{account.ownershipType === 'JOINT' ? ' · Joint' : ''}</option>)}
                      </select>
                    </label>
                    {paymentMethod === 'BANK_ACCOUNT' ? <label className={styles.label} htmlFor="payment-destination-account" data-testid="payment-destination-label">Destination account number
                      <input className={styles.input} id="payment-destination-account" value={paymentDestinationAccount} onChange={(event) => { setPaymentDestinationAccount(event.target.value); invalidatePaymentReview(); }} placeholder="EXB-123456789" required data-testid="payment-destination-account" />
                    </label> : null}
                    {paymentMethod === 'PAYID' ? <label className={styles.label} htmlFor="payment-payid" data-testid="payment-payid-label">Email PayID
                      <input className={styles.input} id="payment-payid" type="email" value={paymentPayId} onChange={(event) => { setPaymentPayId(event.target.value); invalidatePaymentReview(); }} placeholder="recipient@example.com" required data-testid="payment-payid" />
                    </label> : null}
                    {paymentMethod === 'BPAY' ? <>
                      <label className={styles.label} htmlFor="payment-biller-code" data-testid="payment-biller-code-label">Biller code
                        <input className={styles.input} id="payment-biller-code" inputMode="numeric" pattern="[0-9]+" value={paymentBillerCode} onChange={(event) => { setPaymentBillerCode(event.target.value); invalidatePaymentReview(); }} required data-testid="payment-biller-code" />
                      </label>
                      <label className={styles.label} htmlFor="payment-customer-reference" data-testid="payment-customer-reference-label">Customer reference
                        <input className={styles.input} id="payment-customer-reference" inputMode="numeric" pattern="[0-9]+" value={paymentCustomerReference} onChange={(event) => { setPaymentCustomerReference(event.target.value); invalidatePaymentReview(); }} required data-testid="payment-customer-reference" />
                      </label>
                    </> : null}
                    <label className={styles.label} htmlFor="payment-amount" data-testid="payment-amount-label">Amount (AUD)
                      <input className={styles.input} id="payment-amount" inputMode="decimal" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); invalidatePaymentReview(); }} placeholder="250.00" required data-testid="payment-amount" />
                    </label>
                    <label className={styles.label} htmlFor="payment-description" data-testid="payment-description-label">Description <span className={styles.optional} data-testid="payment-description-optional">Optional</span>
                      <input className={styles.input} id="payment-description" maxLength={140} value={paymentDescription} onChange={(event) => { setPaymentDescription(event.target.value); invalidatePaymentReview(); }} data-testid="payment-description" />
                    </label>
                    <button className={styles.primaryButton} type="submit" disabled={paymentInFlight !== null || accounts.length === 0} data-testid="payment-review-submit">{paymentInFlight === 'resolve' ? 'Checking details…' : 'Review payment'}</button>
                  </form>
                ) : null}

                {paymentReview ? (
                  <section className={styles.reviewCard} aria-labelledby="payment-review-heading" aria-busy={paymentInFlight === 'confirm'} data-testid="payment-review">
                    <p className={styles.eyebrow} data-testid="payment-review-eyebrow">Check before confirming</p>
                    <h3 ref={paymentReviewHeadingRef} className={styles.actionTitle} id="payment-review-heading" tabIndex={-1} data-testid="payment-review-heading">Review payment</h3>
                    <dl className={styles.reviewList} data-testid="payment-review-details">
                      <div data-testid="payment-review-method-row"><dt data-testid="payment-review-method-label">Method</dt><dd data-testid="payment-review-method">{paymentReview.method === 'BANK_ACCOUNT' ? 'Bank account' : paymentReview.method === 'PAYID' ? 'Email PayID' : 'BPAY'}</dd></div>
                      <div data-testid="payment-review-source-row"><dt data-testid="payment-review-source-label">From</dt><dd data-testid="payment-review-source">{paymentReview.sourceAccountNumber}</dd></div>
                      <div data-testid="payment-review-payee-row"><dt data-testid="payment-review-payee-label">Payee</dt><dd data-testid="payment-review-payee">{paymentReview.payeeName}</dd></div>
                      <div data-testid="payment-review-amount-row"><dt data-testid="payment-review-amount-label">Amount</dt><dd data-testid="payment-review-amount">{formatAud(paymentReview.amountCents)}</dd></div>
                      {paymentReview.destinationAccountNumber ? <div data-testid="payment-review-destination-row"><dt data-testid="payment-review-destination-label">Account</dt><dd data-testid="payment-review-destination">{paymentReview.destinationAccountNumber}</dd></div> : null}
                      {paymentReview.payId ? <div data-testid="payment-review-payid-row"><dt data-testid="payment-review-payid-label">PayID</dt><dd data-testid="payment-review-payid">{paymentReview.payId}</dd></div> : null}
                      {paymentReview.billerCode ? <div data-testid="payment-review-bpay-row"><dt data-testid="payment-review-bpay-label">BPAY</dt><dd data-testid="payment-review-bpay">Biller {paymentReview.billerCode} · Reference {paymentReview.customerReference}</dd></div> : null}
                      {paymentReview.description ? <div data-testid="payment-review-description-row"><dt data-testid="payment-review-description-label">Description</dt><dd data-testid="payment-review-description">{paymentReview.description}</dd></div> : null}
                    </dl>
                    <p className={styles.fieldHelp} data-testid="payment-review-warning">Confirming sends this payment immediately and it cannot be cancelled in this demo.</p>
                    <div className={styles.reviewActions} data-testid="payment-review-actions">
                      <button type="button" onClick={() => { setPaymentReview(null); setPaymentMessage(null); }} disabled={paymentInFlight !== null} data-testid="payment-review-edit">Edit details</button>
                      <button className={styles.primaryButton} type="button" onClick={() => void handlePaymentConfirm()} disabled={paymentInFlight !== null} data-testid="payment-confirm">{paymentInFlight === 'confirm' ? 'Sending payment…' : 'Confirm payment'}</button>
                    </div>
                  </section>
                ) : null}

                {paymentReceipt ? (
                  <section className={styles.receiptCard} aria-labelledby="payment-receipt-heading" data-testid="payment-receipt">
                    <div data-testid={`payment-receipt-${paymentReceipt.id}`}>
                      <p className={styles.eyebrow} data-testid="payment-receipt-status">Payment complete</p>
                      <h3 ref={paymentReceiptHeadingRef} className={styles.actionTitle} id="payment-receipt-heading" tabIndex={-1} data-testid="payment-receipt-heading">Receipt</h3>
                      <dl className={styles.reviewList} data-testid="payment-receipt-details">
                        <div data-testid="payment-receipt-id-row"><dt data-testid="payment-receipt-id-label">Payment ID</dt><dd data-testid="payment-receipt-id">{paymentReceipt.id}</dd></div>
                        <div data-testid="payment-receipt-method-row"><dt data-testid="payment-receipt-method-label">Method</dt><dd data-testid="payment-receipt-method">{paymentReceipt.method}</dd></div>
                        <div data-testid="payment-receipt-payee-row"><dt data-testid="payment-receipt-payee-label">Payee</dt><dd data-testid="payment-receipt-payee">{paymentReceipt.payeeName}</dd></div>
                        <div data-testid="payment-receipt-amount-row"><dt data-testid="payment-receipt-amount-label">Amount</dt><dd data-testid="payment-receipt-amount">{formatAud(paymentReceipt.amountCents)}</dd></div>
                        <div data-testid="payment-receipt-time-row"><dt data-testid="payment-receipt-time-label">Date</dt><dd data-testid="payment-receipt-time">{new Date(paymentReceipt.createdAt).toLocaleString('en-AU')}</dd></div>
                        {paymentReceipt.payId ? <div data-testid="payment-receipt-payid-row"><dt data-testid="payment-receipt-payid-label">PayID</dt><dd data-testid="payment-receipt-payid">{paymentReceipt.payId}</dd></div> : null}
                        {paymentReceipt.billerCode ? <div data-testid="payment-receipt-bpay-row"><dt data-testid="payment-receipt-bpay-label">BPAY</dt><dd data-testid="payment-receipt-bpay">Biller {paymentReceipt.billerCode} · Reference {paymentReceipt.customerReference}</dd></div> : null}
                      </dl>
                    </div>
                    <button className={styles.primaryButton} type="button" onClick={startAnotherPayment} data-testid="payment-new">Make another payment</button>
                  </section>
                ) : null}
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
                        {accounts.map((account) => <option key={account.id} value={account.id} data-testid={`transfer-source-option-${account.id}`}>{account.displayName || labelAccountType(account.type)} · {account.accountNumber}{account.ownershipType === 'JOINT' ? ' · Joint' : ''}</option>)}
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

            {activeView === 'profile' ? (
              <section className={styles.viewPanel} aria-labelledby="profile-heading" data-testid="dashboard-view-profile">
                <h2 className={styles.sectionTitle} id="profile-heading" data-testid="profile-heading">Personal information</h2>
                <section className={styles.actionCard} data-testid="profile-card">
                  <p className={styles.actionCopy} data-testid="profile-copy">Keep the name and address shown across your banking profile up to date.</p>
                  <form className={styles.form} onSubmit={handleProfileUpdate} data-testid="profile-form">
                    <label className={styles.label} htmlFor="profile-first-name" data-testid="profile-first-name-label">First name
                      <input className={styles.input} id="profile-first-name" maxLength={100} required value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} data-testid="profile-first-name" />
                    </label>
                    <label className={styles.label} htmlFor="profile-last-name" data-testid="profile-last-name-label">Last name
                      <input className={styles.input} id="profile-last-name" maxLength={100} required value={profileLastName} onChange={(event) => setProfileLastName(event.target.value)} data-testid="profile-last-name" />
                    </label>
                    <label className={styles.label} htmlFor="profile-address" data-testid="profile-address-label">Address
                      <textarea className={styles.input} id="profile-address" maxLength={250} required rows={3} value={profileAddress} onChange={(event) => setProfileAddress(event.target.value)} data-testid="profile-address" />
                    </label>
                    {profileMessage ? <p className={profileMessage.kind === 'error' ? styles.error : styles.formMessage} role={profileMessage.kind === 'error' ? 'alert' : 'status'} data-testid="profile-message">{profileMessage.text}</p> : null}
                    <button className={styles.primaryButton} type="submit" disabled={isSavingProfile} data-testid="profile-submit">{isSavingProfile ? 'Saving…' : 'Save personal information'}</button>
                  </form>
                </section>
              </section>
            ) : null}

            {activeView === 'schedule-transfer' ? (
              <section className={styles.viewPanel} aria-labelledby="schedule-transfer-heading" data-testid="dashboard-view-schedule-transfer">
                <h2 className={styles.sectionTitle} id="schedule-transfer-heading" data-testid="schedule-transfer-heading">Schedule transfer</h2>
                <section className={styles.actionCard} data-testid="schedule-transfer-card">
                  <p className={styles.actionCopy} data-testid="schedule-transfer-copy">Choose a future local date and time. Funds are not reserved and all rules are checked again when the transfer is due.</p>
                  <form className={styles.form} onSubmit={handleScheduleTransfer} data-testid="schedule-transfer-form">
                    <label className={styles.label} htmlFor="schedule-transfer-source" data-testid="schedule-transfer-source-label">From
                      <select className={styles.input} id="schedule-transfer-source" value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)} required disabled={accounts.length === 0} data-testid="schedule-transfer-source-account">
                        {accounts.length === 0 ? <option value="" data-testid="schedule-transfer-source-empty-option">Create an account first</option> : null}
                        {accounts.map((account) => <option key={account.id} value={account.id} data-testid={`schedule-transfer-source-option-${account.id}`}>{account.displayName || labelAccountType(account.type)} · {account.accountNumber}</option>)}
                      </select>
                    </label>
                    <label className={styles.label} htmlFor="schedule-transfer-destination" data-testid="schedule-transfer-destination-label">Destination account number
                      <input className={styles.input} id="schedule-transfer-destination" required value={destinationAccountNumber} onChange={(event) => setDestinationAccountNumber(event.target.value)} placeholder="EXB-123456789" data-testid="schedule-transfer-destination-account" />
                    </label>
                    <label className={styles.label} htmlFor="schedule-transfer-amount" data-testid="schedule-transfer-amount-label">Amount (AUD)
                      <input className={styles.input} id="schedule-transfer-amount" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} data-testid="schedule-transfer-amount" />
                    </label>
                    <label className={styles.label} htmlFor="schedule-transfer-description" data-testid="schedule-transfer-description-label">Description <span className={styles.optional} data-testid="schedule-transfer-description-optional">Optional</span>
                      <input className={styles.input} id="schedule-transfer-description" maxLength={140} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="schedule-transfer-description" />
                    </label>
                    <div className={styles.label} data-testid="schedule-transfer-date-time-field"><span data-testid="schedule-transfer-date-time-label">Date and time</span><DateTimePicker value={scheduledFor} onChange={setScheduledFor} /></div>
                    {scheduleMessage ? <p className={scheduleMessage.kind === 'error' ? styles.error : styles.formMessage} role={scheduleMessage.kind === 'error' ? 'alert' : 'status'} data-testid="schedule-transfer-message">{scheduleMessage.text}</p> : null}
                    <button className={styles.primaryButton} type="submit" disabled={isScheduling || accounts.length === 0} data-testid="schedule-transfer-submit">{isScheduling ? 'Scheduling…' : 'Schedule transfer'}</button>
                  </form>
                </section>
              </section>
            ) : null}

            {activeView === 'scheduled-transfers' ? (
              <section className={styles.viewPanel} aria-labelledby="scheduled-transfers-heading" data-testid="dashboard-view-scheduled-transfers">
                <div className={styles.sectionHeading} data-testid="scheduled-transfers-heading-row">
                  <h2 className={styles.sectionTitle} id="scheduled-transfers-heading" data-testid="scheduled-transfers-heading">Scheduled transfers</h2>
                  <button className={styles.refreshButton} type="button" onClick={() => void loadScheduledTransfers()} data-testid="scheduled-transfers-refresh">Refresh</button>
                </div>
                {schedulesStatus === 'loading' ? <p className={styles.state} role="status" data-testid="scheduled-transfers-loading">Loading scheduled transfers…</p> : null}
                {schedulesStatus === 'error' ? <p className={styles.error} role="alert" data-testid="scheduled-transfers-error">{schedulesError}</p> : null}
                {schedulesStatus === 'ready' && scheduledTransfers.length === 0 ? <p className={styles.emptyState} data-testid="scheduled-transfers-empty">No scheduled transfers.</p> : null}
                <div className={styles.accountList} data-testid="scheduled-transfers-list">
                  {scheduledTransfers.map((schedule) => (
                    <article className={styles.accountCard} key={schedule.id} data-testid={`scheduled-transfer-row-${schedule.id}`}>
                      <div className={styles.accountCardTop} data-testid={`scheduled-transfer-header-${schedule.id}`}><strong data-testid={`scheduled-transfer-destination-${schedule.id}`}>{schedule.destinationAccountNumber}</strong><span className={styles.statusBadge} data-testid={`scheduled-transfer-status-${schedule.id}`}>{schedule.status}</span></div>
                      <p data-testid={`scheduled-transfer-source-${schedule.id}`}>From {schedule.sourceAccountNumber}</p>
                      <p data-testid={`scheduled-transfer-time-${schedule.id}`}>{new Date(schedule.scheduledFor).toLocaleString('en-AU')}</p>
                      <strong data-testid={`scheduled-transfer-amount-${schedule.id}`}>{formatAud(schedule.amountCents)}</strong>
                      {schedule.description ? <p data-testid={`scheduled-transfer-description-${schedule.id}`}>{schedule.description}</p> : null}
                      {schedule.failureReason ? <p className={styles.error} data-testid={`scheduled-transfer-failure-${schedule.id}`}>Could not complete: {schedule.failureReason}</p> : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeView === 'cards' ? (
              <section className={styles.viewPanel} aria-labelledby="cards-heading" data-testid="dashboard-view-cards">
                <div className={styles.sectionHeading} data-testid="cards-heading-row"><h2 className={styles.sectionTitle} id="cards-heading" data-testid="cards-heading">Cards</h2><button className={styles.refreshButton} type="button" onClick={() => void loadCards()} data-testid="cards-refresh">Refresh</button></div>
                <section className={styles.actionCard} data-testid="card-open-section">
                  <h3 data-testid="card-open-heading">Open a debit card</h3>
                  <form className={styles.form} onSubmit={handleOpenCard} data-testid="card-open-form">
                    <label className={styles.label} htmlFor="card-open-account" data-testid="card-open-account-label">Linked account
                      <select className={styles.input} id="card-open-account" value={newCardAccountId} onChange={(event) => setNewCardAccountId(event.target.value)} disabled={accounts.length === 0} data-testid="card-open-account">
                        {accounts.length === 0 ? <option value="" data-testid="card-open-account-empty-option">Create an account first</option> : null}
                        {accounts.map((account) => <option key={account.id} value={account.id} data-testid={`card-open-account-option-${account.id}`}>{account.displayName || labelAccountType(account.type)} · {account.accountNumber}</option>)}
                      </select>
                    </label>
                    <button className={styles.primaryButton} type="submit" disabled={cardInFlight !== null || accounts.length === 0} data-testid="card-open-submit">{cardInFlight === 'new' ? 'Opening…' : 'Open card'}</button>
                  </form>
                </section>
                {cardMessage ? <p className={cardMessage.kind === 'error' ? styles.error : styles.formMessage} role={cardMessage.kind === 'error' ? 'alert' : 'status'} data-testid="cards-message">{cardMessage.text}</p> : null}
                {cardsStatus === 'loading' ? <p className={styles.state} role="status" data-testid="cards-loading">Loading cards…</p> : null}
                {cardsStatus === 'error' ? <p className={styles.error} role="alert" data-testid="cards-error">{cardsError}</p> : null}
                {cardsStatus === 'ready' && cards.length === 0 ? <p className={styles.emptyState} data-testid="cards-empty">No cards yet.</p> : null}
                <div className={styles.accountList} data-testid="cards-list">
                  {cards.map((card) => (
                    <article className={styles.accountCard} key={card.id} data-testid={`card-row-${card.id}`}>
                      <div className={styles.accountCardTop} data-testid={`card-header-${card.id}`}><strong data-testid={`card-masked-number-${card.id}`}>{card.maskedNumber}</strong><span className={styles.statusBadge} data-testid={`card-status-${card.id}`}>{card.status}</span></div>
                      <p data-testid={`card-account-${card.id}`}>{card.account.displayName || labelAccountType(card.account.type)} · {card.account.accountNumber}</p>
                      <div className={styles.cardActions} data-testid={`card-actions-${card.id}`}>
                        {card.status === 'ACTIVE' ? <button type="button" disabled={cardInFlight !== null} onClick={() => void handleCardAction(card.id, 'lock')} data-testid={`card-lock-${card.id}`}>Temporarily lock</button> : null}
                        {card.status === 'LOCKED' ? <button type="button" disabled={cardInFlight !== null} onClick={() => void handleCardAction(card.id, 'unlock')} data-testid={`card-unlock-${card.id}`}>Unlock</button> : null}
                        {card.status !== 'DISABLED' ? <button ref={(element) => { if (element) disableTriggerRefs.current.set(card.id, element); else disableTriggerRefs.current.delete(card.id); }} type="button" disabled={cardInFlight !== null} onClick={() => setDisableCardId(card.id)} data-testid={`card-disable-${card.id}`}>Disable permanently</button> : null}
                      </div>
                      <h4 data-testid={`card-transactions-heading-${card.id}`}>Sample card transactions</h4>
                      <div className={styles.transactions} data-testid={`card-transactions-${card.id}`}>
                        {card.transactions.map((transaction) => <div className={styles.transactionRow} key={transaction.id} data-testid={`card-transaction-row-${transaction.id}`}><span data-testid={`card-transaction-merchant-${transaction.id}`}>{transaction.merchant}</span><strong data-testid={`card-transaction-amount-${transaction.id}`}>{formatAud(transaction.amountCents)}</strong></div>)}
                      </div>
                    </article>
                  ))}
                </div>
                {disableCardId ? (
                  <div className={styles.confirmBackdrop} data-testid={`card-disable-backdrop-${disableCardId}`}>
                    <section ref={disableDialogRef} className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby={`card-disable-heading-${disableCardId}`} aria-describedby={`card-disable-copy-${disableCardId}`} onKeyDown={handleDisableDialogKeyDown} data-testid={`card-disable-dialog-${disableCardId}`}>
                      <h3 id={`card-disable-heading-${disableCardId}`} data-testid={`card-disable-heading-${disableCardId}`}>Disable this card permanently?</h3>
                      <p id={`card-disable-copy-${disableCardId}`} data-testid={`card-disable-copy-${disableCardId}`}>This action cannot be undone.</p>
                      <div className={styles.cardActions} data-testid={`card-disable-actions-${disableCardId}`}><button ref={disableCancelRef} type="button" onClick={closeDisableDialog} data-testid={`card-disable-cancel-${disableCardId}`}>Cancel</button><button className={styles.destructiveButton} type="button" disabled={cardInFlight !== null} onClick={() => void handleCardAction(disableCardId, 'disable')} data-testid={`card-disable-confirm-${disableCardId}`}>Disable card</button></div>
                    </section>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
