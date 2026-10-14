const assert = require('node:assert/strict');
const test = require('node:test');
const { createTransferService, validateTransferInput } = require('../../src/services/transferService');

function createTransactionPrisma({ sourceCustomerId = 'customer-1', sourceBalance = 5000, destinationId = 'account-2' } = {}) {
  const calls = { updates: [], creates: [] };
  const tx = {
    account: {
      findUnique: async ({ where }) => where.id
        ? { id: 'account-1', customerId: sourceCustomerId, accountNumber: 'EXB-000000001', balanceCents: sourceBalance }
        : destinationId ? { id: destinationId, accountNumber: 'EXB-000000002' } : null,
      update: async (args) => { calls.updates.push(args); },
    },
    transfer: {
      create: async (args) => {
        calls.creates.push(args);
        return { id: 'transfer-1', ...args.data, createdAt: new Date('2026-10-14T00:00:00Z') };
      },
    },
  };
  return { prisma: { $transaction: async (operation) => operation(tx) }, calls };
}

test('transferMoney atomically debits, credits and records one transfer', async () => {
  const { prisma, calls } = createTransactionPrisma();
  const service = createTransferService({ prisma });

  const transfer = await service.transferMoney({
    customerId: 'customer-1',
    sourceAccountId: 'account-1',
    destinationAccountNumber: 'exb-000000002',
    amountCents: 1250,
    description: ' Rent ',
  });

  assert.equal(calls.updates.length, 2);
  assert.deepEqual(calls.updates[0].data.balanceCents, { decrement: 1250 });
  assert.deepEqual(calls.updates[1].data.balanceCents, { increment: 1250 });
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].data.description, 'Rent');
  assert.equal(transfer.destinationAccountNumber, 'EXB-000000002');
});

test('transfer validation rejects invalid amounts and descriptions', () => {
  const base = { customerId: 'c', sourceAccountId: 'a', destinationAccountNumber: 'EXB-1' };
  assert.throws(() => validateTransferInput({ ...base, amountCents: 0 }), /positive whole number/);
  assert.throws(() => validateTransferInput({ ...base, amountCents: 1.5 }), /positive whole number/);
  assert.throws(() => validateTransferInput({ ...base, amountCents: 1, description: 'x'.repeat(141) }), /140/);
});

test('transfer rejects unowned source, self-transfer and insufficient funds without writes', async () => {
  for (const scenario of [
    { options: { sourceCustomerId: 'other' }, expected: 'SOURCE_ACCOUNT_FORBIDDEN' },
    { options: { destinationId: 'account-1' }, expected: 'SELF_TRANSFER' },
    { options: { sourceBalance: 50 }, expected: 'INSUFFICIENT_FUNDS' },
  ]) {
    const { prisma, calls } = createTransactionPrisma(scenario.options);
    const service = createTransferService({ prisma });
    await assert.rejects(
      () => service.transferMoney({ customerId: 'customer-1', sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-000000002', amountCents: 100 }),
      (error) => error.code === scenario.expected,
    );
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.creates.length, 0);
  }
});

test('listTransactions enforces ownership and derives SENT/RECEIVED in query order', async () => {
  const prisma = {
    account: { findUnique: async () => ({ id: 'account-1', customerId: 'customer-1' }) },
    transfer: {
      findMany: async (args) => {
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        return [
          { id: 'new', sourceAccountId: 'account-1', amountCents: 200, description: null, createdAt: new Date(), sourceAccount: { accountNumber: 'EXB-1' }, destinationAccount: { accountNumber: 'EXB-2' } },
          { id: 'old', sourceAccountId: 'account-2', amountCents: 100, description: 'Refund', createdAt: new Date(), sourceAccount: { accountNumber: 'EXB-2' }, destinationAccount: { accountNumber: 'EXB-1' } },
        ];
      },
    },
  };
  const service = createTransferService({ prisma });
  const transactions = await service.listTransactions('customer-1', 'account-1');

  assert.deepEqual(transactions.map(({ id, direction, counterpartyAccountNumber }) => ({ id, direction, counterpartyAccountNumber })), [
    { id: 'new', direction: 'SENT', counterpartyAccountNumber: 'EXB-2' },
    { id: 'old', direction: 'RECEIVED', counterpartyAccountNumber: 'EXB-2' },
  ]);
});
