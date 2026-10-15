const assert = require('node:assert/strict');
const test = require('node:test');
const { createTransferService, validateTransferInput } = require('../../src/services/transferService');

function createTransactionPrisma({ sourceCustomerId = 'customer-1', coOwnerCustomerId = null, sourceBalance = 5000, destinationId = 'account-2' } = {}) {
  const calls = { updates: [], creates: [] };
  const tx = {
    account: {
      findUnique: async ({ where }) => where.id
        ? { id: 'account-1', customerId: sourceCustomerId, coOwnerCustomerId, accountNumber: 'EXB-000000001', balanceCents: sourceBalance }
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

test('transferMoney uses a conditional debit when supported to prevent concurrent overdrafts', async () => {
  let debitWhere;
  const tx = {
    account: {
      findUnique: async ({ where }) => where.id ? { id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: null, accountNumber: 'EXB-1', balanceCents: 500 } : { id: 'account-2', accountNumber: 'EXB-2' },
      updateMany: async (args) => { debitWhere = args.where; return { count: 1 }; },
      update: async () => {},
    },
    transfer: { create: async (args) => ({ id: 'transfer-1', ...args.data, createdAt: new Date() }) },
  };
  await createTransferService({ prisma: { $transaction: async (operation) => operation(tx) } }).transferMoney({ customerId: 'customer-1', sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-2', amountCents: 200 });
  assert.deepEqual(debitWhere, { id: 'account-1', balanceCents: { gte: 200 } });
});

test('a joint co-owner can transfer from the shared account', async () => {
  const { prisma, calls } = createTransactionPrisma({ sourceCustomerId: 'customer-1', coOwnerCustomerId: 'customer-2' });
  const service = createTransferService({ prisma });

  await service.transferMoney({
    customerId: 'customer-2',
    sourceAccountId: 'account-1',
    destinationAccountNumber: 'EXB-000000002',
    amountCents: 100,
  });

  assert.equal(calls.updates.length, 2);
  assert.equal(calls.creates.length, 1);
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

test('listTransactions allows either joint owner and derives SENT/RECEIVED in query order', async () => {
  const prisma = {
    account: { findUnique: async () => ({ id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: 'customer-2' }) },
    transfer: {
      findMany: async (args) => {
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        return [
          { id: 'new', sourceAccountId: 'account-1', amountCents: 200, description: null, createdAt: new Date('2026-10-16T00:00:01Z'), sourceAccount: { accountNumber: 'EXB-1' }, destinationAccount: { accountNumber: 'EXB-2' } },
          { id: 'old', sourceAccountId: 'account-2', amountCents: 100, description: 'Refund', createdAt: new Date('2026-10-16T00:00:00Z'), sourceAccount: { accountNumber: 'EXB-2' }, destinationAccount: { accountNumber: 'EXB-1' } },
        ];
      },
    },
  };
  const service = createTransferService({ prisma });
  const transactions = await service.listTransactions('customer-2', 'account-1');

  assert.deepEqual(transactions.map(({ id, direction, counterpartyAccountNumber }) => ({ id, direction, counterpartyAccountNumber })), [
    { id: 'new', direction: 'SENT', counterpartyAccountNumber: 'EXB-2' },
    { id: 'old', direction: 'RECEIVED', counterpartyAccountNumber: 'EXB-2' },
  ]);
});

test('listTransactions merges BPAY and linked PayID records without duplicating transfers', async () => {
  const prisma = {
    account: { findUnique: async () => ({ id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: null }) },
    transfer: { findMany: async () => [{
      id: 'transfer-1', sourceAccountId: 'account-1', amountCents: 250, description: null,
      createdAt: new Date('2026-10-16T00:00:00Z'), sourceAccount: { accountNumber: 'EXB-1' }, destinationAccount: { accountNumber: 'EXB-2' },
      payment: { id: 'payment-payid', method: 'PAYID', description: 'Lunch', payeeNameSnapshot: 'Safe Recipient', createdAt: new Date('2026-10-16T00:00:01Z') },
    }] },
    payment: { findMany: async () => [{ id: 'payment-bpay', method: 'BPAY', amountCents: 100, description: null, payeeNameSnapshot: 'Example Energy', customerReference: '1234567890', createdAt: new Date('2026-10-16T00:00:02Z') }] },
  };
  const transactions = await createTransferService({ prisma }).listTransactions('customer-1', 'account-1');
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(({ id, method, counterpartyAccountNumber, counterpartyLabel }) => ({ id, method, counterpartyAccountNumber, counterpartyLabel })), [
    { id: 'payment-bpay', method: 'BPAY', counterpartyAccountNumber: null, counterpartyLabel: 'Example Energy' },
    { id: 'payment-payid', method: 'PAYID', counterpartyAccountNumber: null, counterpartyLabel: 'Safe Recipient' },
  ]);
});

test('an unrelated customer cannot transfer from or view a joint account and causes no writes', async () => {
  const { prisma: transactionPrisma, calls } = createTransactionPrisma({ sourceCustomerId: 'customer-1', coOwnerCustomerId: 'customer-2' });
  const transferService = createTransferService({ prisma: transactionPrisma });
  await assert.rejects(
    () => transferService.transferMoney({ customerId: 'customer-3', sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-000000002', amountCents: 100 }),
    (error) => error.code === 'SOURCE_ACCOUNT_FORBIDDEN',
  );
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.creates.length, 0);

  const historyService = createTransferService({
    prisma: {
      account: { findUnique: async () => ({ id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: 'customer-2' }) },
      transfer: { findMany: async () => { throw new Error('history query must not run'); } },
    },
  });
  await assert.rejects(
    () => historyService.listTransactions('customer-3', 'account-1'),
    (error) => error.code === 'ACCOUNT_FORBIDDEN',
  );
});
