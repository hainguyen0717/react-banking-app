const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../../src/createApp');

function createTestLogger() {
  const entries = [];
  return {
    entries,
    info: (...args) => entries.push({ level: 'info', message: args.join(' ') }),
    error: (...args) => entries.push({ level: 'error', message: args.join(' ') })
  };
}

const prismaStub = {
  // Accept any template literal invocation
  $queryRaw: async () => 1
};

async function withServer(app, handler) {
  const server = app.listen(0);
  try {
    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await handler(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

test('POST /api/login requires email and password', async () => {
  const logger = createTestLogger();
  const app = createApp({
    prisma: prismaStub,
    services: { authenticateCustomer: async () => null },
    logger
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' })
    });

    const body = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'Email and password are required.' });
    assert(logger.entries.some((entry) => entry.message.includes('missing email or password')));
  });
});

test('POST /api/login rejects invalid credentials', async () => {
  const logger = createTestLogger();
  const app = createApp({
    prisma: prismaStub,
    services: { authenticateCustomer: async () => null },
    logger
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid@example.com', password: 'wrong' })
    });

    const body = await response.json();
    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: 'Invalid credentials.' });
    assert(logger.entries.some((entry) => entry.message.includes('Invalid login attempt')));
  });
});

test('POST /api/login returns customer profile when authentication succeeds', async () => {
  const logger = createTestLogger();
  const expectedCustomer = { id: '123', firstName: 'Ada', lastName: 'Lovelace' };
  const app = createApp({
    prisma: prismaStub,
    services: {
      authenticateCustomer: async (email, password) => {
        assert.equal(email, 'ada@example.com');
        assert.equal(password, 'secure');
        return expectedCustomer;
      }
    },
    logger
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'secure' })
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, expectedCustomer);
    assert(logger.entries.some((entry) => entry.message.includes('authenticated successfully')));
  });
});

test('GET /api/health reports healthy database connection', async () => {
  const logger = createTestLogger();
  const app = createApp({ prisma: prismaStub, logger });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: 'ok' });
  });
});
