const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCOUNT_TYPES, createAccountService, validateAccountInput } = require('../../src/services/accountService');
const { DEFAULT_OPENING_BALANCE_CENTS, getDefaultAccountBalanceCents } = require('../../src/config/accountConfig');

test('account types are exactly EVERYDAY, SAVINGS and BUSINESS', () => {
  assert.deepEqual(ACCOUNT_TYPES, ['EVERYDAY', 'SAVINGS', 'BUSINESS']);
  assert.throws(() => validateAccountInput({ type: 'TERM_DEPOSIT' }), /EVERYDAY, SAVINGS, BUSINESS/);
});

test('opening balance defaults to $1,000,000 and accepts a configured override', () => {
  assert.equal(getDefaultAccountBalanceCents({}), DEFAULT_OPENING_BALANCE_CENTS);
  assert.equal(DEFAULT_OPENING_BALANCE_CENTS, 100_000_000);
  assert.equal(getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '2500' }), 2500);
  assert.throws(() => getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '-1' }), /non-negative safe integer/);
  assert.throws(() => getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '10.5' }), /non-negative safe integer/);
});

test('createAccount uses the server opening balance, AUD and generated account number', async () => {
  let createArgs;
  const prisma = {
    customer: { findUnique: async () => ({ id: 'customer-1', isActive: true }) },
    account: {
      create: async (args) => {
        createArgs = args;
        return { id: 'account-1', ...args.data };
      },
    },
  };
  const service = createAccountService({ prisma, openingBalanceCents: 4321, accountNumberGenerator: () => 'EXB-000000001' });

  const account = await service.createAccount('customer-1', { type: 'SAVINGS', displayName: ' Holiday ' });

  assert.equal(account.balanceCents, 4321);
  assert.equal(createArgs.data.currency, 'AUD');
  assert.equal(createArgs.data.accountNumber, 'EXB-000000001');
  assert.equal(createArgs.data.displayName, 'Holiday');
});

test('createAccount rejects a missing or inactive customer without creating an account', async () => {
  let createCalls = 0;
  const prisma = {
    customer: { findUnique: async ({ where }) => where.id === 'inactive' ? { id: 'inactive', isActive: false } : null },
    account: { create: async () => { createCalls += 1; } },
  };
  const service = createAccountService({ prisma, openingBalanceCents: 0 });

  await assert.rejects(() => service.createAccount('missing', { type: 'EVERYDAY' }), (error) => error.status === 404);
  await assert.rejects(() => service.createAccount('inactive', { type: 'EVERYDAY' }), (error) => error.code === 'CUSTOMER_INACTIVE');
  assert.equal(createCalls, 0);
});
