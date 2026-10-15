const assert = require('node:assert/strict');
const test = require('node:test');
const { createCardService, SAMPLE_TRANSACTIONS } = require('../../src/services/cardService');

test('new card belongs to the requesting holder, is masked, and creates exactly five deterministic samples', async () => {
  let createArgs;
  const now = new Date('2026-10-15T00:00:00Z');
  const tx = {
    account: { findUnique: async () => ({ id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: null }) },
    card: { create: async (args) => { createArgs = args; return { id: 'card-1', accountId: 'account-1', lastFour: '1234', status: 'ACTIVE', createdAt: now, updatedAt: now, account: { accountNumber: 'EXB-1', displayName: null, type: 'EVERYDAY' }, transactions: args.data.transactions.create.map((item, index) => ({ id: `transaction-${index + 1}`, ...item })) }; } },
  };
  const service = createCardService({ prisma: { $transaction: async (operation) => operation(tx) }, now: () => now, lastFourGenerator: () => '1234' });
  const card = await service.createCard('customer-1', { accountId: 'account-1' });
  assert.equal(createArgs.data.customerId, 'customer-1');
  assert.equal(createArgs.data.transactions.create.length, 5);
  assert.deepEqual(createArgs.data.transactions.create.map((item) => item.merchant), SAMPLE_TRANSACTIONS.map((item) => item.merchant));
  assert.equal(card.maskedNumber, '•••• 1234');
  assert.equal(card.lastFour, undefined);
  assert.equal(card.transactions.length, 5);
});

test('card ownership and conditional transitions reject foreign and repeated actions', async () => {
  let current = { customerId: 'customer-1', status: 'ACTIVE' };
  const full = () => ({ id: 'card-1', accountId: 'account-1', customerId: current.customerId, lastFour: '1234', status: current.status, account: {}, transactions: [] });
  const prisma = { card: {
    findUnique: async ({ select }) => select.customerId && select.lastFour ? full() : current,
    updateMany: async ({ where, data }) => { if (where.status !== current.status) return { count: 0 }; current = { ...current, status: data.status }; return { count: 1 }; },
  } };
  const service = createCardService({ prisma });
  assert.equal((await service.lockCard('customer-1', 'card-1')).status, 'LOCKED');
  await assert.rejects(() => service.lockCard('customer-1', 'card-1'), (error) => error.status === 409);
  await assert.rejects(() => service.unlockCard('customer-2', 'card-1'), (error) => error.status === 403);
  assert.equal((await service.disableCard('customer-1', 'card-1')).status, 'DISABLED');
  await assert.rejects(() => service.disableCard('customer-1', 'card-1'), (error) => error.status === 409);
});
