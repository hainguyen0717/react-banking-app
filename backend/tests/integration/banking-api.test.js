const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  after,
  before,
  beforeEach,
  describe,
  test,
} = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { createApp } = require('../../src/createApp');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_ROOT = path.join(BACKEND_ROOT, 'prisma/migrations');
const EXPECTED_OPENING_BALANCE_CENTS = 100_000_000;
const TEST_PASSWORD = 'Test-only-password-123!';

function createTestLogger() {
  return {
    info: () => {},
    error: () => {},
  };
}

async function startServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await Promise.race([
    once(server, 'listening'),
    once(server, 'error').then(([error]) => Promise.reject(error)),
  ]);
  return server;
}

async function stopServer(server) {
  if (!server?.listening) {
    return;
  }

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

async function readJsonResponse(response) {
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/json\b/,
    `Expected JSON content type for ${response.url}`,
  );
  return response.json();
}

describe('banking API against isolated SQLite', { concurrency: false }, () => {
  let temporaryDirectory;
  let prisma;
  let server;
  let baseUrl;

  async function request(relativePath, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await readJsonResponse(response);
    return { response, body: json };
  }

  async function createCustomer(overrides = {}) {
    const suffix = overrides.suffix ?? `${Date.now()}-${Math.random()}`;
    const registration = {
      email: `customer-${suffix}@example.test`,
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'Customer',
      ...overrides,
    };
    delete registration.suffix;

    const result = await request('/api/customers', {
      method: 'POST',
      body: registration,
    });
    assert.equal(result.response.status, 201);
    return { customer: result.body, registration };
  }

  async function createAccount(customerId, type = 'EVERYDAY', displayName = undefined) {
    const result = await request(`/api/customers/${customerId}/accounts`, {
      method: 'POST',
      body: { type, ...(displayName === undefined ? {} : { displayName }) },
    });
    assert.equal(result.response.status, 201);
    return result.body;
  }

  async function balancesAndTransferCount(accountIds) {
    const [accounts, transferCount] = await Promise.all([
      prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, balanceCents: true },
        orderBy: { id: 'asc' },
      }),
      prisma.transfer.count(),
    ]);
    return { accounts, transferCount };
  }

  before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-api-integration-'));
    const databasePath = path.join(temporaryDirectory, 'integration.db');
    const databaseUrl = `file:${databasePath}`;

    const migrationFiles = fs.readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(MIGRATIONS_ROOT, entry.name, 'migration.sql'))
      .filter((file) => fs.existsSync(file))
      .sort();
    for (const migrationFile of migrationFiles) {
      execFileSync('sqlite3', [databasePath], {
        input: fs.readFileSync(migrationFile),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Intentionally do not change process.env.DATABASE_URL. This proves that the
    // injected client, rather than the developer database configured in .env,
    // owns every route exercised by this suite.
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const app = createApp({ prisma, logger: createTestLogger() });
    server = await startServer(app);
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await prisma.transfer.deleteMany();
    await prisma.account.deleteMany();
    await prisma.customer.deleteMany();
  });

  after(async () => {
    await stopServer(server);
    await prisma?.$disconnect();
    if (temporaryDirectory) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('health and OpenAPI reads are passive and describe the active contract', async () => {
    const beforeState = {
      customers: await prisma.customer.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    };

    const firstHealth = await request('/api/health');
    const secondHealth = await request('/api/health');
    assert.equal(firstHealth.response.status, 200);
    assert.deepEqual(firstHealth.body, { status: 'ok' });
    assert.deepEqual(secondHealth.body, firstHealth.body);

    const documentation = await request('/docs/openapi.json');
    assert.equal(documentation.response.status, 200);
    assert.equal(documentation.body.openapi, '3.0.3');
    assert.deepEqual(documentation.body.components.schemas.AccountType.enum, [
      'EVERYDAY',
      'SAVINGS',
      'BUSINESS',
    ]);
    for (const route of [
      '/api/customers',
      '/api/customers/{customerId}/accounts',
      '/api/transfers',
      '/api/customers/{customerId}/accounts/{accountId}/transactions',
    ]) {
      assert.ok(documentation.body.paths[route], `OpenAPI is missing ${route}`);
    }

    assert.deepEqual({
      customers: await prisma.customer.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    }, beforeState);
  });

  test('CORS preflight allows both exact local frontend origins and omits headers for others', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await fetch(`${baseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
        },
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    }

    const rejected = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(rejected.headers.has('access-control-allow-origin'), false);
    assert.equal(rejected.headers.has('access-control-allow-credentials'), false);
  });

  test('customer registration persists normalized credentials and retains login regression behavior', async () => {
    const registration = {
      email: '  ADA.LOVELACE@Example.Test  ',
      password: TEST_PASSWORD,
      firstName: '  Ada ',
      lastName: ' Lovelace  ',
    };
    const created = await request('/api/customers', { method: 'POST', body: registration });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.email, 'ada.lovelace@example.test');
    assert.equal(created.body.firstName, 'Ada');
    assert.equal(created.body.lastName, 'Lovelace');
    assert.equal('passwordHash' in created.body, false);
    assert.equal('isActive' in created.body, false);

    const stored = await prisma.customer.findUnique({
      where: { email: 'ada.lovelace@example.test' },
    });
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, TEST_PASSWORD);

    const login = await request('/api/login', {
      method: 'POST',
      body: { email: 'ADA.LOVELACE@example.test', password: TEST_PASSWORD },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.id, created.body.id);
    assert.equal('passwordHash' in login.body, false);

    const invalidLogin = await request('/api/login', {
      method: 'POST',
      body: { email: 'ada.lovelace@example.test', password: 'not-the-password' },
    });
    assert.equal(invalidLogin.response.status, 401);
    assert.deepEqual(invalidLogin.body, { error: 'Invalid credentials.' });

    const duplicate = await request('/api/customers', { method: 'POST', body: registration });
    assert.equal(duplicate.response.status, 409);
    assert.deepEqual(duplicate.body, { error: 'A customer with this email already exists.' });

    const invalid = await request('/api/customers', {
      method: 'POST',
      body: { ...registration, email: 'not-an-email' },
    });
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(invalid.body, { error: 'Enter a valid email address.' });
    assert.equal(await prisma.customer.count(), 1);
  });

  test('creates exactly the three supported account types with the default $1,000,000 balance', async () => {
    const { customer } = await createCustomer({ suffix: 'account-owner' });
    const created = [];

    for (const type of ['EVERYDAY', 'SAVINGS', 'BUSINESS']) {
      const account = await createAccount(customer.id, type, `${type} account`);
      created.push(account);
      assert.equal(account.customerId, customer.id);
      assert.equal(account.type, type);
      assert.equal(account.displayName, `${type} account`);
      assert.equal(account.balanceCents, EXPECTED_OPENING_BALANCE_CENTS);
      assert.equal(account.currency, 'AUD');
      assert.match(account.accountNumber, /^EXB-\d{9}$/);
    }

    assert.equal(new Set(created.map(({ id }) => id)).size, 3);
    assert.equal(new Set(created.map(({ accountNumber }) => accountNumber)).size, 3);

    const firstList = await request(`/api/customers/${customer.id}/accounts`);
    const secondList = await request(`/api/customers/${customer.id}/accounts`);
    assert.equal(firstList.response.status, 200);
    assert.deepEqual(secondList.body, firstList.body);
    assert.deepEqual(
      firstList.body.accounts.map(({ id }) => id),
      created.map(({ id }) => id),
    );
    assert.equal(await prisma.transfer.count(), 0);

    const invalidType = await request(`/api/customers/${customer.id}/accounts`, {
      method: 'POST',
      body: { type: 'CHECKING' },
    });
    assert.equal(invalidType.response.status, 400);
    assert.match(invalidType.body.error, /EVERYDAY, SAVINGS, BUSINESS/);

    const missingCustomer = await request('/api/customers/customer-does-not-exist/accounts', {
      method: 'POST',
      body: { type: 'SAVINGS' },
    });
    assert.equal(missingCustomer.response.status, 404);
    assert.equal(await prisma.account.count(), 3);
  });

  test('uses the configured server-side opening balance for newly created accounts', async () => {
    const { customer } = await createCustomer({ suffix: 'configured-balance-owner' });
    const configuredBalanceCents = 7_654_321;
    const previousValue = process.env.DEFAULT_ACCOUNT_BALANCE_CENTS;
    process.env.DEFAULT_ACCOUNT_BALANCE_CENTS = String(configuredBalanceCents);
    const configuredApp = createApp({ prisma, logger: createTestLogger() });
    if (previousValue === undefined) {
      delete process.env.DEFAULT_ACCOUNT_BALANCE_CENTS;
    } else {
      process.env.DEFAULT_ACCOUNT_BALANCE_CENTS = previousValue;
    }

    const configuredServer = await startServer(configuredApp);
    try {
      const address = configuredServer.address();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/customers/${customer.id}/accounts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'SAVINGS', displayName: 'Configured balance' }),
        },
      );
      const body = await readJsonResponse(response);
      assert.equal(response.status, 201);
      assert.equal(body.balanceCents, configuredBalanceCents);

      const stored = await prisma.account.findUnique({ where: { id: body.id } });
      assert.equal(stored.balanceCents, configuredBalanceCents);
    } finally {
      await stopServer(configuredServer);
    }
  });

  test('transfers money atomically and exposes SENT and RECEIVED transaction views', async () => {
    const { customer: sender } = await createCustomer({ suffix: 'sender' });
    const { customer: receiver } = await createCustomer({ suffix: 'receiver' });
    const source = await createAccount(sender.id, 'EVERYDAY', 'Daily spending');
    const destination = await createAccount(receiver.id, 'SAVINGS', 'Rainy day');
    const amountCents = 25_050;

    const transferred = await request('/api/transfers', {
      method: 'POST',
      body: {
        customerId: sender.id,
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber.toLowerCase(),
        amountCents,
        description: '  Integration transfer  ',
      },
    });

    assert.equal(transferred.response.status, 201);
    assert.equal(transferred.body.sourceAccountId, source.id);
    assert.equal(transferred.body.destinationAccountId, destination.id);
    assert.equal(transferred.body.sourceAccountNumber, source.accountNumber);
    assert.equal(transferred.body.destinationAccountNumber, destination.accountNumber);
    assert.equal(transferred.body.amountCents, amountCents);
    assert.equal(transferred.body.description, 'Integration transfer');
    assert.ok(Date.parse(transferred.body.createdAt));

    const persisted = await balancesAndTransferCount([source.id, destination.id]);
    assert.equal(persisted.transferCount, 1);
    assert.deepEqual(
      Object.fromEntries(persisted.accounts.map((account) => [account.id, account.balanceCents])),
      {
        [source.id]: EXPECTED_OPENING_BALANCE_CENTS - amountCents,
        [destination.id]: EXPECTED_OPENING_BALANCE_CENTS + amountCents,
      },
    );

    const sentHistory = await request(
      `/api/customers/${sender.id}/accounts/${source.id}/transactions`,
    );
    const receivedHistory = await request(
      `/api/customers/${receiver.id}/accounts/${destination.id}/transactions`,
    );
    assert.deepEqual(sentHistory.body.transactions, [{
      id: transferred.body.id,
      direction: 'SENT',
      amountCents,
      description: 'Integration transfer',
      counterpartyAccountNumber: destination.accountNumber,
      createdAt: transferred.body.createdAt,
    }]);
    assert.deepEqual(receivedHistory.body.transactions, [{
      id: transferred.body.id,
      direction: 'RECEIVED',
      amountCents,
      description: 'Integration transfer',
      counterpartyAccountNumber: source.accountNumber,
      createdAt: transferred.body.createdAt,
    }]);

    const repeatedHistory = await request(
      `/api/customers/${sender.id}/accounts/${source.id}/transactions`,
    );
    assert.deepEqual(repeatedHistory.body, sentHistory.body);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), persisted);
  });

  test('rejects invalid, unauthorized, missing, self, and overdrawn transfers without side effects', async () => {
    const { customer: owner } = await createCustomer({ suffix: 'negative-owner' });
    const { customer: other } = await createCustomer({ suffix: 'negative-other' });
    const source = await createAccount(owner.id, 'EVERYDAY');
    const destination = await createAccount(other.id, 'BUSINESS');
    const baseline = await balancesAndTransferCount([source.id, destination.id]);

    const cases = [
      {
        name: 'zero amount',
        expectedStatus: 400,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 0 },
      },
      {
        name: 'fractional cents',
        expectedStatus: 400,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 1.5 },
      },
      {
        name: 'string amount',
        expectedStatus: 400,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: '100' },
      },
      {
        name: 'foreign source ownership',
        expectedStatus: 403,
        body: { customerId: other.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 100 },
      },
      {
        name: 'missing source',
        expectedStatus: 404,
        body: { customerId: owner.id, sourceAccountId: 'missing-source', destinationAccountNumber: destination.accountNumber, amountCents: 100 },
      },
      {
        name: 'missing destination',
        expectedStatus: 404,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: 'EXB-000000000', amountCents: 100 },
      },
      {
        name: 'self transfer',
        expectedStatus: 400,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: source.accountNumber, amountCents: 100 },
      },
      {
        name: 'insufficient funds',
        expectedStatus: 409,
        body: { customerId: owner.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: EXPECTED_OPENING_BALANCE_CENTS + 1 },
      },
    ];

    for (const scenario of cases) {
      const result = await request('/api/transfers', { method: 'POST', body: scenario.body });
      assert.equal(
        result.response.status,
        scenario.expectedStatus,
        `${scenario.name} returned ${result.response.status}: ${JSON.stringify(result.body)}`,
      );
      assert.deepEqual(Object.keys(result.body), ['error'], scenario.name);
      assert.deepEqual(
        await balancesAndTransferCount([source.id, destination.id]),
        baseline,
        `${scenario.name} changed persisted state`,
      );
    }
  });

  test('enforces account-history ownership and inactive-customer account rules without mutation', async () => {
    const { customer: owner } = await createCustomer({ suffix: 'history-owner' });
    const { customer: other } = await createCustomer({ suffix: 'history-other' });
    const account = await createAccount(owner.id, 'SAVINGS');
    const baseline = await balancesAndTransferCount([account.id]);

    const forbiddenHistory = await request(
      `/api/customers/${other.id}/accounts/${account.id}/transactions`,
    );
    assert.equal(forbiddenHistory.response.status, 403);
    assert.deepEqual(forbiddenHistory.body, { error: 'This account does not belong to the customer.' });

    const missingHistory = await request(
      `/api/customers/${owner.id}/accounts/missing-account/transactions`,
    );
    assert.equal(missingHistory.response.status, 404);

    await prisma.customer.update({
      where: { id: owner.id },
      data: { isActive: false },
    });
    const inactiveList = await request(`/api/customers/${owner.id}/accounts`);
    const inactiveCreate = await request(`/api/customers/${owner.id}/accounts`, {
      method: 'POST',
      body: { type: 'BUSINESS' },
    });
    assert.equal(inactiveList.response.status, 409);
    assert.equal(inactiveCreate.response.status, 409);
    assert.equal(await prisma.account.count(), 1);
    assert.deepEqual(await balancesAndTransferCount([account.id]), baseline);
  });
});
