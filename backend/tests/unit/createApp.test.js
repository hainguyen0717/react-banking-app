const assert = require('node:assert/strict');
const test = require('node:test');
const { createDefaultServices, resolveCorsOrigin } = require('../../src/createApp');

function checkCorsOrigin(origin) {
  return new Promise((resolve, reject) => {
    resolveCorsOrigin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test('CORS allows only the two exact local frontend origins', async () => {
  assert.equal(await checkCorsOrigin('http://localhost:5173'), true);
  assert.equal(await checkCorsOrigin('http://127.0.0.1:5173'), true);
  assert.equal(await checkCorsOrigin(undefined), true);
  assert.equal(await checkCorsOrigin('http://localhost:5174'), false);
  assert.equal(await checkCorsOrigin('http://127.0.0.1:3000'), false);
  assert.equal(await checkCorsOrigin('http://example.com'), false);
  assert.equal(await checkCorsOrigin('http://localhost:5173.evil.example'), false);
});

test('default services use the Prisma client injected into createApp wiring', async () => {
  const calls = [];
  const prisma = {
    customer: {
      findUnique: async (args) => {
        calls.push(['customer.findUnique', args]);
        return { id: 'customer-1', isActive: true };
      },
    },
    account: {
      findMany: async (args) => {
        calls.push(['account.findMany', args]);
        return [];
      },
      findUnique: async (args) => {
        calls.push(['account.findUnique', args]);
        return { id: 'account-1', customerId: 'customer-1' };
      },
    },
    transfer: {
      findMany: async (args) => {
        calls.push(['transfer.findMany', args]);
        return [];
      },
    },
  };

  const services = createDefaultServices(prisma);
  await services.listAccounts('customer-1');
  await services.listTransactions('customer-1', 'account-1');

  assert.deepEqual(calls.map(([name]) => name), [
    'customer.findUnique',
    'account.findMany',
    'account.findUnique',
    'transfer.findMany',
  ]);
});

test('createApp service overrides remain independent from default wiring', async () => {
  const prisma = {
    customer: { findUnique: async () => { throw new Error('default customer service should not run'); } },
  };
  const override = async () => ({ id: 'override-customer' });
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma,
    services: { authenticateCustomer: override },
    logger: { info: () => {}, error: () => {} },
  });

  const loginLayer = app._router.stack.find((layer) => layer.route?.path === '/api/login');
  assert(loginLayer, 'login route should be registered');

  let responseBody;
  const response = {
    statusCode: 200,
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { responseBody = body; return this; },
  };
  await loginLayer.route.stack[0].handle(
    { body: { email: 'override@example.com', password: 'password' } },
    response,
  );

  assert.deepEqual(responseBody, { id: 'override-customer' });
  assert.equal(response.statusCode, 200);
});
