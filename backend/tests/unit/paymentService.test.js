const assert = require('node:assert/strict');
const test = require('node:test');
const { createPaymentService, validatePaymentInput } = require('../../src/services/paymentService');

const source = { id: 'source', customerId: 'customer-1', coOwnerCustomerId: 'customer-2', accountNumber: 'EXB-SOURCE', balanceCents: 5000 };
const destination = { id: 'destination', customerId: 'recipient', coOwnerCustomerId: null, accountNumber: 'EXB-DEST', displayName: 'Harbour Services' };

function accountLookup({ where }) {
  if (where.id === 'source') return source;
  if (where.id === 'destination' || where.accountNumber === 'EXB-DEST') return destination;
  return null;
}

test('payment input normalizes method identifiers and rejects irrelevant or malformed fields', () => {
  assert.deepEqual(validatePaymentInput({
    method: 'payid', sourceAccountId: ' source ', amountCents: 123, payId: ' Recipient@Example.COM ', description: ' Invoice ',
  }), {
    method: 'PAYID', sourceAccountId: 'source', amountCents: 123, payId: 'recipient@example.com', description: 'Invoice',
  });
  assert.throws(() => validatePaymentInput({ method: 'BPAY', sourceAccountId: 'source', amountCents: 1, billerCode: '12A', customerReference: '123' }), /digits only/);
  assert.throws(() => validatePaymentInput({ method: 'PAYID', sourceAccountId: 'source', amountCents: 1, payId: 'a@b.com', billerCode: '123' }), /not valid/);
  assert.throws(() => validatePaymentInput({ method: 'BANK_ACCOUNT', sourceAccountId: 'source', amountCents: 0, destinationAccountNumber: 'EXB-DEST' }), /positive whole number/);
});

test('resolve supports a joint co-owner and returns safe account, PayID and BPAY review details', async () => {
  const prisma = {
    account: { findUnique: async (args) => accountLookup(args) },
    payIdDirectoryEntry: { findUnique: async () => ({ id: 'payid-1', value: 'recipient@example.com', displayName: 'Safe Recipient', isActive: true, account: { id: 'destination', customerId: 'recipient', coOwnerCustomerId: null } }) },
    bpayBiller: { findUnique: async () => ({ id: 'biller-1', billerCode: '123456', name: 'Example Energy', referenceLength: 10, isActive: true }) },
  };
  const service = createPaymentService({ prisma });
  const bank = await service.resolvePayment('customer-2', { method: 'BANK_ACCOUNT', sourceAccountId: 'source', destinationAccountNumber: 'exb-dest', amountCents: 100 });
  const payId = await service.resolvePayment('customer-2', { method: 'PAYID', sourceAccountId: 'source', payId: 'RECIPIENT@example.com', amountCents: 100 });
  const bpay = await service.resolvePayment('customer-2', { method: 'BPAY', sourceAccountId: 'source', billerCode: '123456', customerReference: '1234567890', amountCents: 100 });
  assert.equal(bank.payeeName, 'Harbour Services');
  assert.equal(payId.payeeName, 'Safe Recipient');
  assert.equal(payId.payId, 'recipient@example.com');
  assert.doesNotMatch(JSON.stringify(payId), /EXB-DEST|destination/);
  assert.deepEqual({ name: bpay.payeeName, reference: bpay.customerReference }, { name: 'Example Energy', reference: '1234567890' });
});

test('resolution rejects unowned sources, actor-owned destinations, unknown entries and bad BPAY references', async () => {
  const base = {
    account: { findUnique: async ({ where }) => where.id === 'source' ? source : { ...destination, customerId: 'customer-1' } },
    payIdDirectoryEntry: { findUnique: async () => null },
    bpayBiller: { findUnique: async () => ({ id: 'biller-1', name: 'Biller', referenceLength: 4, isActive: true }) },
  };
  const service = createPaymentService({ prisma: base });
  await assert.rejects(() => service.resolvePayment('outsider', { method: 'BANK_ACCOUNT', sourceAccountId: 'source', destinationAccountNumber: 'EXB-DEST', amountCents: 1 }), (error) => error.code === 'SOURCE_ACCOUNT_FORBIDDEN');
  await assert.rejects(() => service.resolvePayment('customer-1', { method: 'BANK_ACCOUNT', sourceAccountId: 'source', destinationAccountNumber: 'EXB-DEST', amountCents: 1 }), (error) => error.code === 'SELF_PAYMENT');
  await assert.rejects(() => service.resolvePayment('customer-1', { method: 'PAYID', sourceAccountId: 'source', payId: 'missing@example.com', amountCents: 1 }), (error) => error.code === 'PAYID_NOT_FOUND');
  await assert.rejects(() => service.resolvePayment('customer-1', { method: 'BPAY', sourceAccountId: 'source', billerCode: '1', customerReference: '123', amountCents: 1 }), (error) => error.code === 'INVALID_CUSTOMER_REFERENCE');
});

test('bank-account and PayID confirmation atomically record a linked transfer and secrecy-safe receipt', async () => {
  for (const method of ['BANK_ACCOUNT', 'PAYID']) {
    const calls = { debits: 0, credits: 0, transfers: 0, payments: [] };
    const tx = {
      account: {
        findUnique: async (args) => accountLookup(args),
        updateMany: async () => { calls.debits += 1; return { count: 1 }; },
        update: async () => { calls.credits += 1; },
      },
      payIdDirectoryEntry: { findUnique: async () => ({ id: 'payid-1', displayName: 'Safe Recipient', value: 'recipient@example.com', isActive: true, account: { id: 'destination', customerId: 'recipient', coOwnerCustomerId: null } }) },
      transfer: { create: async ({ data }) => { calls.transfers += 1; return { id: 'transfer-1', ...data, createdAt: new Date('2026-10-16T00:00:00Z') }; } },
      payment: { create: async ({ data }) => { calls.payments.push(data); return { id: `payment-${method}`, ...data, createdAt: new Date('2026-10-16T00:00:01Z') }; } },
    };
    const input = method === 'BANK_ACCOUNT'
      ? { method, sourceAccountId: 'source', destinationAccountNumber: 'EXB-DEST', amountCents: 250 }
      : { method, sourceAccountId: 'source', payId: 'recipient@example.com', amountCents: 250 };
    const receipt = await createPaymentService({ prisma: { $transaction: async (work) => work(tx) } }).createPayment('customer-1', input);
    assert.deepEqual({ debits: calls.debits, credits: calls.credits, transfers: calls.transfers, payments: calls.payments.length }, { debits: 1, credits: 1, transfers: 1, payments: 1 });
    assert.equal(receipt.id, `payment-${method}`);
    if (method === 'PAYID') assert.doesNotMatch(JSON.stringify(receipt), /EXB-DEST/);
  }
});

test('BPAY confirmation conditionally debits only the source and records an immutable receipt', async () => {
  const calls = { debit: null, payment: null };
  const tx = {
    account: { findUnique: async () => source, updateMany: async (args) => { calls.debit = args; return { count: 1 }; } },
    bpayBiller: { findUnique: async () => ({ id: 'biller-1', billerCode: '123', name: 'Example Biller', referenceLength: 4, isActive: true }) },
    payment: { create: async ({ data }) => { calls.payment = data; return { id: 'payment-bpay', ...data, createdAt: new Date('2026-10-16T00:00:00Z') }; } },
  };
  const receipt = await createPaymentService({ prisma: { $transaction: async (work) => work(tx) } }).createPayment('customer-1', { method: 'BPAY', sourceAccountId: 'source', billerCode: '123', customerReference: '4567', amountCents: 99 });
  assert.deepEqual(calls.debit.where, { id: 'source', balanceCents: { gte: 99 } });
  assert.equal(calls.payment.transferId, null);
  assert.deepEqual({ method: receipt.method, biller: receipt.payeeName, reference: receipt.customerReference }, { method: 'BPAY', biller: 'Example Biller', reference: '4567' });
});

test('insufficient BPAY funds abort before a payment is written', async () => {
  let writes = 0;
  const tx = {
    account: { findUnique: async () => source, updateMany: async () => ({ count: 0 }) },
    bpayBiller: { findUnique: async () => ({ id: 'biller-1', name: 'Biller', referenceLength: 4, isActive: true }) },
    payment: { create: async () => { writes += 1; } },
  };
  await assert.rejects(() => createPaymentService({ prisma: { $transaction: async (work) => work(tx) } }).createPayment('customer-1', { method: 'BPAY', sourceAccountId: 'source', billerCode: '123', customerReference: '4567', amountCents: 9999 }), (error) => error.code === 'INSUFFICIENT_FUNDS');
  assert.equal(writes, 0);
});
