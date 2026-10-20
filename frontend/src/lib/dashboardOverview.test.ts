import { describe, expect, it } from 'vitest';
import {
  currentWeekSpend,
  mergeAccountTransactions,
  selectFeaturedCard,
  totalAccessibleBalance,
} from './dashboardOverview';

const accounts = [
  { id: 'a-1', accountNumber: 'EXB-1', displayName: null, balanceCents: 1200, type: 'EVERYDAY' },
  { id: 'a-2', accountNumber: 'EXB-2', displayName: 'Shared', balanceCents: 3000, type: 'SAVINGS' },
  { id: 'a-2', accountNumber: 'EXB-2', displayName: 'Shared', balanceCents: 3000, type: 'SAVINGS' },
];

describe('dashboard overview helpers', () => {
  it('counts each accessible account once and preserves account context on separate perspectives', () => {
    expect(totalAccessibleBalance(accounts)).toBe(4200);
    const merged = mergeAccountTransactions(accounts, {
      'a-1': [{ id: 'tx-1', method: 'TRANSFER', direction: 'SENT', amountCents: 100, description: null, counterpartyLabel: 'EXB-2', createdAt: '2026-10-19T08:00:00Z' }],
      'a-2': [{ id: 'tx-1', method: 'TRANSFER', direction: 'RECEIVED', amountCents: 100, description: null, counterpartyLabel: 'EXB-1', createdAt: '2026-10-19T08:00:00Z' }],
    });

    expect(merged).toHaveLength(2);
    expect(merged.map(({ accountId, direction }) => `${accountId}-${direction}`)).toEqual(['a-2-RECEIVED', 'a-1-SENT']);
    expect(merged[0]).toMatchObject({ accountName: 'Shared', accountNumber: 'EXB-2' });
  });

  it('sorts newest first with stable transaction, account and direction tie breaks', () => {
    const merged = mergeAccountTransactions(accounts, {
      'a-1': [
        { id: 'tx-a', method: 'PAYID', direction: 'SENT', amountCents: 1, description: null, counterpartyLabel: 'A', createdAt: '2026-10-18T00:00:00Z' },
        { id: 'tx-z', method: 'BPAY', direction: 'SENT', amountCents: 1, description: null, counterpartyLabel: 'Z', createdAt: '2026-10-18T00:00:00Z' },
      ],
    });
    expect(merged.map(({ id }) => id)).toEqual(['tx-z', 'tx-a']);
  });

  it('builds a local Monday-to-Sunday week and counts only outgoing recorded transactions', () => {
    const merged = mergeAccountTransactions(accounts, {
      'a-1': [
        { id: 'transfer', method: 'TRANSFER', direction: 'SENT', amountCents: 100, description: null, counterpartyLabel: 'A', createdAt: '2026-10-19T10:00:00+11:00' },
        { id: 'payid', method: 'PAYID', direction: 'SENT', amountCents: 200, description: null, counterpartyLabel: 'B', createdAt: '2026-10-20T10:00:00+11:00' },
        { id: 'bpay', method: 'BPAY', direction: 'SENT', amountCents: 300, description: null, counterpartyLabel: 'C', createdAt: '2026-10-25T10:00:00+11:00' },
        { id: 'incoming', method: 'BANK_ACCOUNT', direction: 'RECEIVED', amountCents: 999, description: null, counterpartyLabel: 'D', createdAt: '2026-10-21T10:00:00+11:00' },
        { id: 'prior', method: 'TRANSFER', direction: 'SENT', amountCents: 999, description: null, counterpartyLabel: 'E', createdAt: '2026-10-18T10:00:00+11:00' },
      ],
    });
    const week = currentWeekSpend(merged, new Date(2026, 9, 21, 12));

    expect(week.days).toHaveLength(7);
    expect(week.days.map(({ dateKey }) => dateKey)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(week.days.map(({ amountCents }) => amountCents)).toEqual([100, 200, 0, 0, 0, 0, 300]);
    expect(week.totalCents).toBe(600);
  });

  it('prefers the newest active card, then locked, then disabled, and handles no cards', () => {
    const cards = [
      { id: 'disabled', status: 'DISABLED' as const, createdAt: '2026-10-21T00:00:00Z' },
      { id: 'active-old', status: 'ACTIVE' as const, createdAt: '2026-10-19T00:00:00Z' },
      { id: 'locked', status: 'LOCKED' as const, createdAt: '2026-10-22T00:00:00Z' },
      { id: 'active-new', status: 'ACTIVE' as const, createdAt: '2026-10-20T00:00:00Z' },
    ];
    expect(selectFeaturedCard(cards)?.id).toBe('active-new');
    expect(selectFeaturedCard(cards.filter(({ status }) => status !== 'ACTIVE'))?.id).toBe('locked');
    expect(selectFeaturedCard([])).toBeNull();
  });
});
