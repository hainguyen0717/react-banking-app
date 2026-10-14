const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACCOUNT_TYPES,
  OWNERSHIP_TYPES,
  createAccountService,
  validateAccountInput,
  validateJointAccountInput,
} = require('../../src/services/accountService');
const { DEFAULT_OPENING_BALANCE_CENTS, getDefaultAccountBalanceCents } = require('../../src/config/accountConfig');

const primaryOwner = {
  id: 'customer-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  isActive: true,
};
const coOwner = {
  id: 'customer-2',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  isActive: true,
};

function accountResult(data) {
  const safePrimaryOwner = (({ id, email, firstName, lastName }) => ({ id, email, firstName, lastName }))(primaryOwner);
  const safeCoOwner = (({ id, email, firstName, lastName }) => ({ id, email, firstName, lastName }))(coOwner);
  return {
    id: 'account-1',
    createdAt: new Date('2026-10-14T00:00:00Z'),
    updatedAt: new Date('2026-10-14T00:00:00Z'),
    ...data,
    primaryOwner: safePrimaryOwner,
    coOwner: data.ownershipType === 'JOINT' ? safeCoOwner : null,
  };
}

test('account and ownership types are deliberately separate closed sets', () => {
  assert.deepEqual(ACCOUNT_TYPES, ['EVERYDAY', 'SAVINGS', 'BUSINESS']);
  assert.deepEqual(OWNERSHIP_TYPES, ['SINGLE', 'JOINT']);
  assert.throws(() => validateAccountInput({ type: 'JOINT' }), /EVERYDAY, SAVINGS, BUSINESS/);
});

test('opening balance defaults to $1,000,000 and accepts a configured override', () => {
  assert.equal(getDefaultAccountBalanceCents({}), DEFAULT_OPENING_BALANCE_CENTS);
  assert.equal(DEFAULT_OPENING_BALANCE_CENTS, 100_000_000);
  assert.equal(getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '2500' }), 2500);
  assert.throws(() => getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '-1' }), /non-negative safe integer/);
  assert.throws(() => getDefaultAccountBalanceCents({ DEFAULT_ACCOUNT_BALANCE_CENTS: '10.5' }), /non-negative safe integer/);
});

test('createAccount persists SINGLE ownership and returns one safe owner', async () => {
  let createArgs;
  const prisma = {
    customer: { findUnique: async () => primaryOwner },
    account: {
      create: async (args) => {
        createArgs = args;
        return accountResult(args.data);
      },
    },
  };
  const service = createAccountService({ prisma, openingBalanceCents: 4321, accountNumberGenerator: () => 'EXB-000000001' });

  const account = await service.createAccount('customer-1', { type: 'SAVINGS', displayName: ' Holiday ' });

  assert.deepEqual(createArgs.data, {
    accountNumber: 'EXB-000000001',
    customerId: 'customer-1',
    coOwnerCustomerId: null,
    ownershipType: 'SINGLE',
    type: 'SAVINGS',
    displayName: 'Holiday',
    balanceCents: 4321,
    currency: 'AUD',
  });
  assert.equal(account.balanceCents, 4321);
  assert.deepEqual(account.owners, [{ id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' }]);
  assert.equal(account.primaryOwner, undefined);
  assert.equal(account.coOwner, undefined);
});

test('createJointAccount normalizes email and creates one JOINT account with two safe owners', async () => {
  const customerLookups = [];
  let createArgs;
  const prisma = {
    customer: {
      findUnique: async (args) => {
        customerLookups.push(args.where);
        return args.where.id ? primaryOwner : coOwner;
      },
    },
    account: {
      create: async (args) => {
        createArgs = args;
        return accountResult(args.data);
      },
    },
  };
  const service = createAccountService({ prisma, openingBalanceCents: 100_000_000, accountNumberGenerator: () => 'EXB-000000002' });

  const account = await service.createJointAccount('customer-1', {
    type: 'EVERYDAY',
    displayName: ' Shared bills ',
    coOwnerEmail: ' GRACE@EXAMPLE.COM ',
  });

  assert.deepEqual(customerLookups, [{ id: 'customer-1' }, { email: 'grace@example.com' }]);
  assert.equal(createArgs.data.ownershipType, 'JOINT');
  assert.equal(createArgs.data.coOwnerCustomerId, 'customer-2');
  assert.equal(createArgs.data.balanceCents, 100_000_000);
  assert.equal(createArgs.data.displayName, 'Shared bills');
  assert.equal(account.owners.length, 2);
  assert.deepEqual(account.owners.map(({ id }) => id), ['customer-1', 'customer-2']);
});

test('joint account validation rejects malformed email, bad type and long name before writes', async () => {
  assert.throws(() => validateJointAccountInput({ type: 'EVERYDAY', coOwnerEmail: 'not-email' }), (error) => error.code === 'INVALID_CO_OWNER_EMAIL');
  assert.throws(() => validateJointAccountInput({ type: 'JOINT', coOwnerEmail: 'grace@example.com' }), (error) => error.code === 'INVALID_ACCOUNT_TYPE');
  assert.throws(() => validateJointAccountInput({ type: 'SAVINGS', displayName: 'x'.repeat(81), coOwnerEmail: 'grace@example.com' }), (error) => error.code === 'INVALID_DISPLAY_NAME');
});

test('createJointAccount rejects missing, inactive and same-customer co-owners without creating', async () => {
  const scenarios = [
    { coOwner: null, code: 'CO_OWNER_NOT_FOUND' },
    { coOwner: { ...coOwner, isActive: false }, code: 'CO_OWNER_INACTIVE' },
    { coOwner: { ...primaryOwner }, code: 'CO_OWNER_MUST_BE_DIFFERENT' },
  ];

  for (const scenario of scenarios) {
    let createCalls = 0;
    const prisma = {
      customer: { findUnique: async ({ where }) => where.id ? primaryOwner : scenario.coOwner },
      account: { create: async () => { createCalls += 1; } },
    };
    const service = createAccountService({ prisma, openingBalanceCents: 0 });
    await assert.rejects(
      () => service.createJointAccount('customer-1', { type: 'BUSINESS', coOwnerEmail: 'grace@example.com' }),
      (error) => error.code === scenario.code,
    );
    assert.equal(createCalls, 0);
  }
});

test('createAccount rejects a missing or inactive primary customer without creating an account', async () => {
  let createCalls = 0;
  const prisma = {
    customer: { findUnique: async ({ where }) => where.id === 'inactive' ? { ...primaryOwner, id: 'inactive', isActive: false } : null },
    account: { create: async () => { createCalls += 1; } },
  };
  const service = createAccountService({ prisma, openingBalanceCents: 0 });

  await assert.rejects(() => service.createAccount('missing', { type: 'EVERYDAY' }), (error) => error.status === 404);
  await assert.rejects(() => service.createAccount('inactive', { type: 'EVERYDAY' }), (error) => error.code === 'CUSTOMER_INACTIVE');
  assert.equal(createCalls, 0);
});

test('listAccounts finds primary and co-owned accounts once in deterministic order', async () => {
  let findManyArgs;
  const prisma = {
    customer: { findUnique: async () => coOwner },
    account: {
      findMany: async (args) => {
        findManyArgs = args;
        return [accountResult({
          accountNumber: 'EXB-000000002', customerId: 'customer-1', coOwnerCustomerId: 'customer-2',
          ownershipType: 'JOINT', type: 'EVERYDAY', displayName: null, balanceCents: 10, currency: 'AUD',
        })];
      },
    },
  };
  const service = createAccountService({ prisma });
  const result = await service.listAccounts('customer-2');

  assert.deepEqual(findManyArgs.where, { OR: [{ customerId: 'customer-2' }, { coOwnerCustomerId: 'customer-2' }] });
  assert.deepEqual(findManyArgs.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].ownershipType, 'JOINT');
  assert.deepEqual(result[0].owners.map(({ id }) => id), ['customer-1', 'customer-2']);
});
