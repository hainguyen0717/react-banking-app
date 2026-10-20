export interface OverviewAccount {
  id: string;
  accountNumber: string;
  displayName: string | null;
  balanceCents: number;
  type: string;
}

export interface OverviewTransaction {
  id: string;
  method: 'TRANSFER' | 'BANK_ACCOUNT' | 'PAYID' | 'BPAY';
  direction: 'SENT' | 'RECEIVED';
  amountCents: number;
  description: string | null;
  counterpartyLabel: string;
  counterpartyAccountNumber?: string | null;
  createdAt: string;
}

export function activityHeadline(transaction: OverviewTransaction) {
  const description = transaction.description?.trim();
  if (description) return description;

  const counterpartyLabel = transaction.counterpartyLabel?.trim();
  if (counterpartyLabel) return counterpartyLabel;

  const accountNumber = transaction.counterpartyAccountNumber?.trim();
  if (accountNumber) return accountNumber;

  const direction = transaction.direction === 'SENT' ? 'Sent' : 'Received';
  const method = transaction.method === 'BANK_ACCOUNT'
    ? 'bank account payment'
    : transaction.method === 'PAYID'
      ? 'PayID payment'
      : transaction.method === 'BPAY'
        ? 'BPAY payment'
        : 'transfer';
  return `${direction} ${method}`;
}

export interface AccountTransaction extends OverviewTransaction {
  accountId: string;
  accountNumber: string;
  accountName: string;
}

export interface OverviewCard {
  id: string;
  status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  createdAt: string;
}

export interface WeekdaySpend {
  dateKey: string;
  label: string;
  amountCents: number;
}

export function uniqueAccounts(accounts: OverviewAccount[]) {
  return Array.from(new Map(accounts.map((account) => [account.id, account])).values());
}

export function totalAccessibleBalance(accounts: OverviewAccount[]) {
  return uniqueAccounts(accounts).reduce((total, account) => total + account.balanceCents, 0);
}

export function mergeAccountTransactions(
  accounts: OverviewAccount[],
  transactionsByAccount: Record<string, OverviewTransaction[]>,
) {
  return uniqueAccounts(accounts)
    .flatMap<AccountTransaction>((account) => (transactionsByAccount[account.id] ?? []).map((transaction) => ({
      ...transaction,
      accountId: account.id,
      accountNumber: account.accountNumber,
      accountName: account.displayName || account.type.charAt(0) + account.type.slice(1).toLowerCase(),
    })))
    .sort((left, right) => {
      const timeDifference = new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
      return timeDifference
        || right.id.localeCompare(left.id)
        || right.accountId.localeCompare(left.accountId)
        || right.direction.localeCompare(left.direction);
    });
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentWeekSpend(transactions: AccountTransaction[], now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const end = new Date(monday);
  end.setDate(end.getDate() + 7);

  const amounts = new Map<string, number>();
  transactions.forEach((transaction) => {
    const createdAt = new Date(transaction.createdAt);
    if (transaction.direction !== 'SENT' || createdAt < monday || createdAt >= end) return;
    const key = localDateKey(createdAt);
    amounts.set(key, (amounts.get(key) ?? 0) + transaction.amountCents);
  });

  const days: WeekdaySpend[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const dateKey = localDateKey(date);
    return {
      dateKey,
      label: new Intl.DateTimeFormat('en-AU', { weekday: 'short' }).format(date),
      amountCents: amounts.get(dateKey) ?? 0,
    };
  });

  return {
    days,
    totalCents: days.reduce((total, item) => total + item.amountCents, 0),
  };
}

const CARD_STATUS_PRIORITY: Record<OverviewCard['status'], number> = {
  ACTIVE: 0,
  LOCKED: 1,
  DISABLED: 2,
};

export function selectFeaturedCard<T extends OverviewCard>(cards: T[]): T | null {
  return [...cards].sort((left, right) => {
    const priority = CARD_STATUS_PRIORITY[left.status] - CARD_STATUS_PRIORITY[right.status];
    const created = new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
    return priority || created || right.id.localeCompare(left.id);
  })[0] ?? null;
}
