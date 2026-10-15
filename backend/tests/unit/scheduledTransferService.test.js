const assert = require('node:assert/strict');
const test = require('node:test');
const { validateScheduleInput, createScheduledTransferService } = require('../../src/services/scheduledTransferService');

const NOW = new Date('2026-10-15T00:00:00.000Z');

test('schedule validation requires a strict future UTC instant', () => {
  const base = { sourceAccountId: 'a', destinationAccountNumber: 'EXB-2', amountCents: 100, scheduledFor: '2026-10-15T01:00:00.000Z' };
  assert.equal(validateScheduleInput(base, NOW).scheduledFor.toISOString(), base.scheduledFor);
  assert.throws(() => validateScheduleInput({ ...base, scheduledFor: '2026-10-14T23:00:00.000Z' }, NOW), /future/i);
  assert.throws(() => validateScheduleInput({ ...base, scheduledFor: '2026-10-15 01:00' }, NOW), /ISO-8601/i);
  assert.throws(() => validateScheduleInput({ ...base, scheduledFor: '2026-02-30T01:00:00.000Z' }, NOW), /ISO-8601/i);
});

test('creating a schedule checks ownership and current funds but does not mutate balances', async () => {
  let created;
  const prisma = {
    account: { findUnique: async ({ where }) => where.id ? { id: 'source', customerId: 'customer-1', coOwnerCustomerId: null, balanceCents: 500 } : { id: 'destination' } },
    scheduledTransfer: { create: async (args) => { created = args; return { id: 'schedule-1', ...args.data, status: 'PENDING', failureReason: null, processedAt: null, transferId: null, createdAt: NOW, updatedAt: NOW, sourceAccount: { accountNumber: 'EXB-1' }, destinationAccount: { accountNumber: 'EXB-2' } }; } },
  };
  const schedule = await createScheduledTransferService({ prisma, now: () => NOW }).createScheduledTransfer('customer-1', {
    sourceAccountId: 'source', destinationAccountNumber: 'EXB-2', amountCents: 200, description: ' Future ', scheduledFor: '2026-10-15T01:00:00.000Z',
  });
  assert.equal(created.data.customerId, 'customer-1');
  assert.equal(created.data.description, 'Future');
  assert.equal(schedule.status, 'PENDING');
  assert.equal(prisma.account.update, undefined);
});

function processingPrisma({ balance = 500, claimCount = 1 } = {}) {
  const calls = { scheduleUpdates: [], accountUpdates: [], transfers: [] };
  const schedule = { id: 'schedule-1', customerId: 'customer-1', sourceAccountId: 'source', destinationAccountId: 'destination', amountCents: 200, description: 'Rent' };
  const tx = {
    scheduledTransfer: {
      updateMany: async () => ({ count: claimCount }),
      findUnique: async () => schedule,
      update: async (args) => { calls.scheduleUpdates.push(args); },
    },
    account: {
      findUnique: async ({ where }) => where.id === 'source' ? { id: 'source', customerId: 'customer-1', coOwnerCustomerId: null, accountNumber: 'EXB-1', balanceCents: balance } : { id: 'destination', accountNumber: 'EXB-2' },
      updateMany: async () => ({ count: balance >= 200 ? 1 : 0 }),
      update: async (args) => { calls.accountUpdates.push(args); },
    },
    transfer: { create: async (args) => { calls.transfers.push(args); return { id: 'transfer-1', ...args.data, createdAt: NOW }; } },
  };
  return {
    calls,
    prisma: {
      scheduledTransfer: { findMany: async () => [{ id: 'schedule-1' }] },
      $transaction: async (operation) => operation(tx),
    },
  };
}

test('due processing claims once, completes atomically, and creates normal history', async () => {
  const { prisma, calls } = processingPrisma();
  const results = await createScheduledTransferService({ prisma, now: () => NOW }).processDueScheduledTransfers();
  assert.deepEqual(results, ['COMPLETED']);
  assert.equal(calls.transfers.length, 1);
  assert.equal(calls.accountUpdates.length, 1);
  assert.equal(calls.scheduleUpdates[0].data.status, 'COMPLETED');
  assert.equal(calls.scheduleUpdates[0].data.transferId, 'transfer-1');
});

test('due insufficient funds becomes terminal FAILED with no credit or history and a lost claim is ignored', async () => {
  const failed = processingPrisma({ balance: 50 });
  assert.deepEqual(await createScheduledTransferService({ prisma: failed.prisma, now: () => NOW }).processDueScheduledTransfers(), ['FAILED']);
  assert.equal(failed.calls.transfers.length, 0);
  assert.equal(failed.calls.accountUpdates.length, 0);
  assert.deepEqual(failed.calls.scheduleUpdates[0].data, { status: 'FAILED', processedAt: NOW, failureReason: 'INSUFFICIENT_FUNDS' });

  const lost = processingPrisma({ claimCount: 0 });
  assert.deepEqual(await createScheduledTransferService({ prisma: lost.prisma, now: () => NOW }).processDueScheduledTransfers(), []);
  assert.equal(lost.calls.transfers.length, 0);
});
