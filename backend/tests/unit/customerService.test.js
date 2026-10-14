const assert = require('node:assert/strict');
const test = require('node:test');
const { createCustomerService, validateRegistration } = require('../../src/services/customerService');

test('createCustomer normalizes fields, hashes the password and returns a safe projection', async () => {
  let createArgs;
  const prisma = {
    customer: {
      create: async (args) => {
        createArgs = args;
        return { id: 'customer-1', email: args.data.email, firstName: args.data.firstName, lastName: args.data.lastName };
      },
    },
  };
  const passwordHasher = {
    hash: async (password, rounds) => {
      assert.equal(password, 'safe-pass');
      assert.equal(rounds, 12);
      return 'hashed-password';
    },
  };
  const service = createCustomerService({ prisma, passwordHasher });

  const customer = await service.createCustomer({
    email: '  ADA@Example.COM ',
    password: 'safe-pass',
    firstName: ' Ada ',
    lastName: ' Lovelace ',
  });

  assert.deepEqual(customer, { id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal(createArgs.data.email, 'ada@example.com');
  assert.equal(createArgs.data.passwordHash, 'hashed-password');
  assert.equal(createArgs.select.passwordHash, undefined);
});

test('createCustomer maps duplicate email errors to a stable 409 error', async () => {
  const service = createCustomerService({
    prisma: { customer: { create: async () => { throw { code: 'P2002' }; } } },
    passwordHasher: { hash: async () => 'hash' },
  });

  await assert.rejects(
    () => service.createCustomer({ email: 'ada@example.com', password: 'safe-pass', firstName: 'Ada', lastName: 'Lovelace' }),
    (error) => error.status === 409 && error.code === 'EMAIL_ALREADY_EXISTS',
  );
});

test('registration validation rejects invalid email, password and names', () => {
  assert.throws(() => validateRegistration({ email: 'bad', password: 'safe-pass', firstName: 'A', lastName: 'B' }), /valid email/i);
  assert.throws(() => validateRegistration({ email: 'a@b.com', password: 'short', firstName: 'A', lastName: 'B' }), /at least 8/i);
  assert.throws(() => validateRegistration({ email: 'a@b.com', password: 'safe-pass', firstName: '', lastName: 'B' }), /First name/i);
});
