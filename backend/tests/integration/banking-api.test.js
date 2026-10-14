const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
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
const TRUSTED_ORIGIN = 'http://localhost:5173';
const SECOND_TRUSTED_ORIGIN = 'http://127.0.0.1:5173';
const EXPECTED_OPENING_BALANCE_CENTS = 100_000_000;
const TEST_PASSWORD = 'Test-only-password-123!';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createTestLogger() {
  return { info: () => {}, error: () => {} };
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
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function createHttpClient(getBaseUrl) {
  let cookie = null;

  return {
    get cookie() {
      return cookie;
    },
    set cookie(value) {
      cookie = value;
    },
    async request(relativePath, options = {}) {
      const method = (options.method ?? 'GET').toUpperCase();
      const headers = { ...(options.headers ?? {}) };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';

      const hasOriginOverride = Object.prototype.hasOwnProperty.call(options, 'origin');
      const origin = hasOriginOverride
        ? options.origin
        : (MUTATION_METHODS.has(method) ? TRUSTED_ORIGIN : undefined);
      if (origin !== undefined && origin !== null) headers.Origin = origin;

      const hasCookieOverride = Object.prototype.hasOwnProperty.call(options, 'cookieOverride');
      const requestCookie = hasCookieOverride ? options.cookieOverride : cookie;
      if (requestCookie) headers.Cookie = requestCookie;

      const response = await fetch(`${getBaseUrl()}${relativePath}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      const setCookie = response.headers.get('set-cookie');
      if (setCookie && options.captureCookie !== false) {
        const cookiePair = setCookie.split(';', 1)[0];
        cookie = cookiePair === 'eb_session=' ? null : cookiePair;
      }

      const contentType = response.headers.get('content-type') ?? '';
      let body = null;
      if (response.status !== 204) {
        body = /^application\/json\b/.test(contentType)
          ? await response.json()
          : await response.text();
      }
      return { response, body, setCookie };
    },
  };
}

describe('authenticated banking API against isolated SQLite', { concurrency: false }, () => {
  let temporaryDirectory;
  let prisma;
  let server;
  let baseUrl;

  function client() {
    return createHttpClient(() => baseUrl);
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

    const result = await client().request('/api/customers', {
      method: 'POST',
      body: registration,
    });
    assert.equal(result.response.status, 201);
    return { customer: result.body, registration };
  }

  async function login(registration, httpClient = client()) {
    const result = await httpClient.request('/api/login', {
      method: 'POST',
      body: { email: registration.email, password: registration.password },
    });
    assert.equal(result.response.status, 200);
    assert.match(httpClient.cookie ?? '', /^eb_session=[A-Za-z0-9_-]{43}$/);
    return { ...result, client: httpClient };
  }

  async function createAuthenticatedCustomer(overrides = {}) {
    const created = await createCustomer(overrides);
    const authenticated = await login(created.registration);
    return { ...created, client: authenticated.client, login: authenticated };
  }

  async function createAccount(httpClient, type = 'EVERYDAY', displayName, extraBody = {}) {
    const result = await httpClient.request('/api/accounts', {
      method: 'POST',
      body: {
        type,
        ...(displayName === undefined ? {} : { displayName }),
        ...extraBody,
      },
    });
    assert.equal(result.response.status, 201);
    return result.body;
  }

  async function createJointAccount(httpClient, coOwnerEmail, type = 'EVERYDAY', displayName, extraBody = {}) {
    const result = await httpClient.request('/api/joint-accounts', {
      method: 'POST',
      body: {
        type,
        coOwnerEmail,
        ...(displayName === undefined ? {} : { displayName }),
        ...extraBody,
      },
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

    // The process still points at the developer database. Successful assertions
    // against this client prove every route uses the injected isolated database.
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    server = await startServer(createApp({ prisma, logger: createTestLogger() }));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await prisma.authSession.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.account.deleteMany();
    await prisma.customer.deleteMany();
  });

  after(async () => {
    await stopServer(server);
    await prisma?.$disconnect();
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('health and OpenAPI are public, passive, and document only authenticated banking routes', async () => {
    const anonymous = client();
    const beforeState = {
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    };

    const firstHealth = await anonymous.request('/api/health');
    const secondHealth = await anonymous.request('/api/health');
    assert.equal(firstHealth.response.status, 200);
    assert.deepEqual(firstHealth.body, { status: 'ok' });
    assert.deepEqual(secondHealth.body, firstHealth.body);

    const documentation = await anonymous.request('/docs/openapi.json');
    assert.equal(documentation.response.status, 200);
    assert.equal(documentation.body.openapi, '3.0.3');
    assert.deepEqual(documentation.body.components.schemas.AccountType.enum, [
      'EVERYDAY', 'SAVINGS', 'BUSINESS',
    ]);
    assert.deepEqual(documentation.body.components.schemas.OwnershipType.enum, ['SINGLE', 'JOINT']);
    assert.deepEqual(documentation.body.components.securitySchemes.cookieAuth, {
      type: 'apiKey',
      in: 'cookie',
      name: 'eb_session',
      description: 'Opaque session token. Only its SHA-256 hash is persisted server-side.',
    });

    for (const route of [
      '/api/session',
      '/api/logout',
      '/api/accounts',
      '/api/joint-accounts',
      '/api/transfers',
      '/api/accounts/{accountId}/transactions',
    ]) {
      assert.ok(documentation.body.paths[route], `OpenAPI is missing ${route}`);
    }
    for (const removedRoute of [
      '/api/customers/{customerId}/accounts',
      '/api/customers/{customerId}/joint-accounts',
      '/api/customers/{customerId}/accounts/{accountId}/transactions',
    ]) {
      assert.equal(documentation.body.paths[removedRoute], undefined);
    }
    assert.deepEqual(documentation.body.paths['/api/login'].post.security, []);
    assert.deepEqual(documentation.body.paths['/api/customers'].post.security, []);
    assert.deepEqual(documentation.body.paths['/api/accounts'].get.security, [{ cookieAuth: [] }]);
    assert.deepEqual(documentation.body.paths['/api/transfers'].post.security, [{ cookieAuth: [] }]);

    assert.deepEqual({
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    }, beforeState);
  });

  test('CORS and trusted-Origin checks accept exact origins and reject mutation lookalikes without side effects', async () => {
    const anonymous = client();
    for (const origin of [TRUSTED_ORIGIN, SECOND_TRUSTED_ORIGIN]) {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    }

    const rejectedPreflight = await fetch(`${baseUrl}/api/accounts`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173.evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(rejectedPreflight.headers.has('access-control-allow-origin'), false);

    const registration = {
      email: 'origin-test@example.test',
      password: TEST_PASSWORD,
      firstName: 'Origin',
      lastName: 'Test',
    };
    for (const origin of [null, 'null', 'http://localhost:5173.evil.example']) {
      const rejected = await anonymous.request('/api/customers', {
        method: 'POST',
        body: registration,
        origin,
      });
      assert.equal(rejected.response.status, 403);
      assert.deepEqual(rejected.body, { error: 'Trusted Origin required.' });
      assert.equal(await prisma.customer.count(), 0);
    }

    const { client: authenticated } = await createAuthenticatedCustomer({ suffix: 'origin-auth' });
    for (const origin of [null, 'http://localhost:5173.evil.example']) {
      const rejected = await authenticated.request('/api/accounts', {
        method: 'POST',
        body: { type: 'EVERYDAY' },
        origin,
      });
      assert.equal(rejected.response.status, 403);
      assert.equal(await prisma.account.count(), 0);
    }
    const passiveRead = await authenticated.request('/api/accounts', { origin: null });
    assert.equal(passiveRead.response.status, 200);
    assert.deepEqual(passiveRead.body, { accounts: [] });
  });

  test('registration and login create a hash-only opaque cookie session and expose a safe profile', async () => {
    const created = await createCustomer({
      suffix: 'session-profile',
      email: 'session.profile@example.test',
      firstName: 'Session',
      lastName: 'Profile',
    });

    const invalidLogin = await client().request('/api/login', {
      method: 'POST',
      body: { email: created.registration.email, password: 'wrong-password' },
    });
    assert.equal(invalidLogin.response.status, 401);
    assert.equal(invalidLogin.setCookie, null);
    assert.equal(await prisma.authSession.count(), 0);

    const authenticated = await login(created.registration);
    assert.match(authenticated.setCookie, /HttpOnly/);
    assert.match(authenticated.setCookie, /SameSite=Lax/);
    assert.match(authenticated.setCookie, /Max-Age=\d+/);
    assert.doesNotMatch(authenticated.setCookie, /; Secure/);

    const token = authenticated.client.cookie.slice('eb_session='.length);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    const expectedHash = createHash('sha256').update(token).digest('hex');
    const stored = await prisma.authSession.findFirst();
    assert.equal(stored.customerId, created.customer.id);
    assert.equal(stored.tokenHash, expectedHash);
    assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.tokenHash, token);
    assert(stored.absoluteExpiresAt.getTime() > Date.now() + (7 * 60 * 60 * 1000));
    assert(stored.absoluteExpiresAt.getTime() <= Date.now() + (8 * 60 * 60 * 1000));
    const rawSessions = await prisma.$queryRawUnsafe('SELECT * FROM AuthSession');
    assert.equal(rawSessions.some((row) => Object.values(row).includes(token)), false);

    const session = await authenticated.client.request('/api/session');
    assert.equal(session.response.status, 200);
    assert.deepEqual(session.body, authenticated.body);
    assert.equal(session.body.id, created.customer.id);
    assert.ok(Date.parse(session.body.lastLoginAt));
    assert.equal('passwordHash' in session.body, false);
    assert.equal('isActive' in session.body, false);
  });

  test('protected APIs reject missing, malformed, unknown, idle, absolute-expired, and inactive sessions', async () => {
    const missing = await client().request('/api/accounts');
    assert.equal(missing.response.status, 401);
    assert.deepEqual(missing.body, { error: 'Authentication required.' });

    const missingAccountMutation = await client().request('/api/accounts', {
      method: 'POST',
      body: { type: 'EVERYDAY' },
      origin: null,
    });
    const missingLogout = await client().request('/api/logout', {
      method: 'POST',
      origin: null,
    });
    assert.equal(missingAccountMutation.response.status, 401);
    assert.equal(missingLogout.response.status, 401);
    assert.equal(await prisma.account.count(), 0);

    const duplicateTokenCookie = `eb_session=${'A'.repeat(43)}; eb_session=${'B'.repeat(43)}`;
    const malformed = await client().request('/api/session', { cookieOverride: duplicateTokenCookie });
    assert.equal(malformed.response.status, 401);
    assert.match(malformed.setCookie, /^eb_session=;/);
    assert.match(malformed.setCookie, /Max-Age=0/);

    const unknown = await client().request('/api/session', {
      cookieOverride: `eb_session=${'Z'.repeat(43)}`,
    });
    assert.equal(unknown.response.status, 401);
    assert.match(unknown.setCookie, /Max-Age=0/);

    const created = await createCustomer({ suffix: 'expiry-customer' });

    const idleClient = (await login(created.registration)).client;
    const idleSession = await prisma.authSession.findFirst({ where: { customerId: created.customer.id } });
    await prisma.authSession.update({
      where: { id: idleSession.id },
      data: {
        lastSeenAt: new Date(Date.now() - (31 * 60 * 1000)),
        absoluteExpiresAt: new Date(Date.now() + (60 * 60 * 1000)),
      },
    });
    const idle = await idleClient.request('/api/session');
    assert.equal(idle.response.status, 401);
    assert.equal(await prisma.authSession.count(), 0);

    const absoluteClient = (await login(created.registration)).client;
    const absoluteSession = await prisma.authSession.findFirst({ where: { customerId: created.customer.id } });
    await prisma.authSession.update({
      where: { id: absoluteSession.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1_000) },
    });
    const absolute = await absoluteClient.request('/api/accounts');
    assert.equal(absolute.response.status, 401);
    assert.equal(await prisma.authSession.count(), 0);

    const inactiveClient = (await login(created.registration)).client;
    await prisma.customer.update({ where: { id: created.customer.id }, data: { isActive: false } });
    const inactive = await inactiveClient.request('/api/session');
    assert.equal(inactive.response.status, 401);
    assert.equal(await prisma.authSession.count(), 0);
  });

  test('concurrent sessions are independent and logout clears and revokes only the current cookie', async () => {
    const created = await createCustomer({ suffix: 'concurrent-session' });
    const first = (await login(created.registration)).client;
    const second = (await login(created.registration)).client;
    assert.notEqual(first.cookie, second.cookie);
    assert.equal(await prisma.authSession.count({ where: { customerId: created.customer.id } }), 2);

    const replayCookie = first.cookie;
    const logout = await first.request('/api/logout', { method: 'POST' });
    assert.equal(logout.response.status, 204);
    assert.equal(logout.body, null);
    assert.match(logout.setCookie, /^eb_session=;/);
    assert.match(logout.setCookie, /Max-Age=0/);
    assert.equal(first.cookie, null);
    assert.equal(await prisma.authSession.count({ where: { customerId: created.customer.id } }), 1);

    const replay = await client().request('/api/session', { cookieOverride: replayCookie });
    assert.equal(replay.response.status, 401);
    const stillActive = await second.request('/api/session');
    assert.equal(stillActive.response.status, 200);
    assert.equal(stillActive.body.id, created.customer.id);
  });

  test('personal accounts derive the actor from the session and reject identity spoofing', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'personal-owner' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'personal-recipient' });
    const source = await createAccount(
      owner.client,
      'EVERYDAY',
      'Daily spending',
      { customerId: recipient.customer.id },
    );
    const destination = await createAccount(recipient.client, 'SAVINGS', 'Rainy day');

    assert.equal(source.customerId, owner.customer.id);
    assert.equal(source.ownershipType, 'SINGLE');
    assert.deepEqual(source.owners, [{
      id: owner.customer.id,
      email: owner.customer.email,
      firstName: owner.customer.firstName,
      lastName: owner.customer.lastName,
    }]);

    const transferred = await owner.client.request('/api/transfers', {
      method: 'POST',
      body: {
        customerId: recipient.customer.id,
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 25_050,
        description: 'Session-owned transfer',
      },
    });
    assert.equal(transferred.response.status, 201);
    const persisted = await balancesAndTransferCount([source.id, destination.id]);
    assert.equal(persisted.transferCount, 1);
    assert.deepEqual(
      Object.fromEntries(persisted.accounts.map((account) => [account.id, account.balanceCents])),
      {
        [source.id]: EXPECTED_OPENING_BALANCE_CENTS - 25_050,
        [destination.id]: EXPECTED_OPENING_BALANCE_CENTS + 25_050,
      },
    );

    const spoofed = await recipient.client.request('/api/transfers', {
      method: 'POST',
      body: {
        customerId: owner.customer.id,
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 100,
      },
    });
    assert.equal(spoofed.response.status, 403);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), persisted);

    const ownerHistory = await owner.client.request(`/api/accounts/${source.id}/transactions`);
    const recipientHistory = await recipient.client.request(`/api/accounts/${destination.id}/transactions`);
    assert.equal(ownerHistory.body.transactions[0].direction, 'SENT');
    assert.equal(recipientHistory.body.transactions[0].direction, 'RECEIVED');

    const forbiddenHistory = await recipient.client.request(`/api/accounts/${source.id}/transactions`);
    assert.equal(forbiddenHistory.response.status, 403);
    const unauthenticatedHistory = await client().request(`/api/accounts/${source.id}/transactions`);
    assert.equal(unauthenticatedHistory.response.status, 401);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), persisted);
  });

  test('joint owners share one balance, can both transfer, and see identical passive history', async () => {
    const primary = await createAuthenticatedCustomer({
      suffix: 'joint-primary',
      email: 'primary.owner@example.test',
      firstName: 'Primary',
      lastName: 'Owner',
    });
    const coOwner = await createAuthenticatedCustomer({
      suffix: 'joint-co-owner',
      email: 'co.owner@example.test',
      firstName: 'Co',
      lastName: 'Owner',
    });
    const recipient = await createAuthenticatedCustomer({ suffix: 'joint-recipient' });
    const destination = await createAccount(recipient.client, 'BUSINESS', 'Transfer destination');

    const joint = await createJointAccount(
      primary.client,
      '  CO.OWNER@EXAMPLE.TEST  ',
      'SAVINGS',
      '  Shared future  ',
      { customerId: recipient.customer.id },
    );
    assert.equal(joint.customerId, primary.customer.id);
    assert.equal(joint.ownershipType, 'JOINT');
    assert.equal(joint.balanceCents, EXPECTED_OPENING_BALANCE_CENTS);
    assert.deepEqual(joint.owners.map(({ id }) => id), [primary.customer.id, coOwner.customer.id]);
    assert.equal(await prisma.account.count({ where: { id: joint.id } }), 1);

    const primaryList = await primary.client.request('/api/accounts');
    const coOwnerList = await coOwner.client.request('/api/accounts');
    for (const result of [primaryList, coOwnerList]) {
      const occurrences = result.body.accounts.filter(({ id }) => id === joint.id);
      assert.equal(occurrences.length, 1);
      assert.deepEqual(occurrences[0], joint);
    }

    const sentByPrimary = await primary.client.request('/api/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: joint.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 10_000,
        description: 'Primary owner transfer',
      },
    });
    const sentByCoOwner = await coOwner.client.request('/api/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: joint.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 20_000,
        description: 'Co-owner transfer',
      },
    });
    const receivedByJoint = await recipient.client.request('/api/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: destination.id,
        destinationAccountNumber: joint.accountNumber,
        amountCents: 7_000,
        description: 'Incoming to shared account',
      },
    });
    for (const result of [sentByPrimary, sentByCoOwner, receivedByJoint]) {
      assert.equal(result.response.status, 201);
    }

    const persisted = await balancesAndTransferCount([joint.id, destination.id]);
    assert.equal(persisted.transferCount, 3);
    assert.deepEqual(
      Object.fromEntries(persisted.accounts.map((account) => [account.id, account.balanceCents])),
      {
        [joint.id]: EXPECTED_OPENING_BALANCE_CENTS - 10_000 - 20_000 + 7_000,
        [destination.id]: EXPECTED_OPENING_BALANCE_CENTS + 10_000 + 20_000 - 7_000,
      },
    );

    const primaryHistory = await primary.client.request(`/api/accounts/${joint.id}/transactions`);
    const coOwnerHistory = await coOwner.client.request(`/api/accounts/${joint.id}/transactions`);
    assert.deepEqual(coOwnerHistory.body, primaryHistory.body);
    assert.deepEqual(
      primaryHistory.body.transactions.map(({ direction }) => direction).sort(),
      ['RECEIVED', 'SENT', 'SENT'],
    );
    assert.deepEqual(
      new Set(primaryHistory.body.transactions.map(({ id }) => id)),
      new Set([sentByPrimary.body.id, sentByCoOwner.body.id, receivedByJoint.body.id]),
    );

    const updatedPrimaryList = await primary.client.request('/api/accounts');
    const updatedCoOwnerList = await coOwner.client.request('/api/accounts');
    assert.deepEqual(updatedCoOwnerList.body, updatedPrimaryList.body);
    const repeatedHistory = await coOwner.client.request(`/api/accounts/${joint.id}/transactions`);
    assert.deepEqual(repeatedHistory.body, coOwnerHistory.body);
    assert.deepEqual(await balancesAndTransferCount([joint.id, destination.id]), persisted);
  });

  test('invalid account and joint-account requests are rejected without persisted side effects', async () => {
    const primary = await createAuthenticatedCustomer({
      suffix: 'creation-negative-primary',
      email: 'creation.primary@example.test',
    });
    const coOwner = await createAuthenticatedCustomer({
      suffix: 'creation-negative-coowner',
      email: 'creation.coowner@example.test',
    });
    const inactive = await createCustomer({
      suffix: 'creation-negative-inactive',
      email: 'creation.inactive@example.test',
    });
    await prisma.customer.update({ where: { id: inactive.customer.id }, data: { isActive: false } });

    const cases = [
      { path: '/api/accounts', body: { type: 'CHECKING' }, status: 400 },
      { path: '/api/accounts', body: { type: 'SAVINGS', displayName: 'x'.repeat(81) }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY' }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY', coOwnerEmail: 'not-an-email' }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY', coOwnerEmail: 42 }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY', coOwnerEmail: primary.customer.email }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY', coOwnerEmail: 'unknown@example.test' }, status: 404 },
      { path: '/api/joint-accounts', body: { type: 'EVERYDAY', coOwnerEmail: inactive.customer.email }, status: 409 },
      { path: '/api/joint-accounts', body: { type: 'JOINT', coOwnerEmail: coOwner.customer.email }, status: 400 },
      { path: '/api/joint-accounts', body: { type: 'SAVINGS', displayName: 'x'.repeat(81), coOwnerEmail: coOwner.customer.email }, status: 400 },
    ];

    for (const scenario of cases) {
      const baseline = {
        accounts: await prisma.account.count(),
        transfers: await prisma.transfer.count(),
      };
      const result = await primary.client.request(scenario.path, {
        method: 'POST',
        body: scenario.body,
      });
      assert.equal(result.response.status, scenario.status, JSON.stringify(result.body));
      assert.deepEqual(Object.keys(result.body), ['error']);
      assert.deepEqual({
        accounts: await prisma.account.count(),
        transfers: await prisma.transfer.count(),
      }, baseline);
    }

    const unauthenticated = await client().request('/api/joint-accounts', {
      method: 'POST',
      body: { type: 'EVERYDAY', coOwnerEmail: coOwner.customer.email },
    });
    assert.equal(unauthenticated.response.status, 401);
    assert.equal(await prisma.account.count(), 0);
  });

  test('invalid and unauthorized joint-source transfers leave balances and history unchanged', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'transfer-negative-owner' });
    const coOwner = await createAuthenticatedCustomer({ suffix: 'transfer-negative-coowner' });
    const unrelated = await createAuthenticatedCustomer({ suffix: 'transfer-negative-unrelated' });
    const source = await createJointAccount(owner.client, coOwner.customer.email, 'EVERYDAY');
    const destination = await createAccount(unrelated.client, 'BUSINESS');
    const baseline = await balancesAndTransferCount([source.id, destination.id]);

    const cases = [
      { actor: owner.client, status: 400, body: { sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 0 } },
      { actor: owner.client, status: 400, body: { sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 1.5 } },
      { actor: owner.client, status: 400, body: { sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: '100' } },
      { actor: unrelated.client, status: 403, body: { customerId: owner.customer.id, sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: 100 } },
      { actor: owner.client, status: 404, body: { sourceAccountId: 'missing-source', destinationAccountNumber: destination.accountNumber, amountCents: 100 } },
      { actor: owner.client, status: 404, body: { sourceAccountId: source.id, destinationAccountNumber: 'EXB-000000000', amountCents: 100 } },
      { actor: owner.client, status: 400, body: { sourceAccountId: source.id, destinationAccountNumber: source.accountNumber, amountCents: 100 } },
      { actor: owner.client, status: 409, body: { sourceAccountId: source.id, destinationAccountNumber: destination.accountNumber, amountCents: EXPECTED_OPENING_BALANCE_CENTS + 1 } },
    ];
    for (const scenario of cases) {
      const result = await scenario.actor.request('/api/transfers', {
        method: 'POST',
        body: scenario.body,
      });
      assert.equal(result.response.status, scenario.status, JSON.stringify(result.body));
      assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), baseline);
    }

    const unauthenticated = await client().request('/api/transfers', {
      method: 'POST',
      body: {
        customerId: owner.customer.id,
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 100,
      },
    });
    assert.equal(unauthenticated.response.status, 401);

    const forbiddenHistory = await unrelated.client.request(`/api/accounts/${source.id}/transactions`);
    assert.equal(forbiddenHistory.response.status, 403);
    const missingHistoryAuth = await client().request(`/api/accounts/${source.id}/transactions`);
    assert.equal(missingHistoryAuth.response.status, 401);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), baseline);
  });

  test('removed customer-ID banking routes return 404 and cannot bypass session ownership', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'removed-route-owner' });
    const other = await createAuthenticatedCustomer({ suffix: 'removed-route-other' });
    const baseline = {
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    };

    const oldRequests = [
      { method: 'GET', path: `/api/customers/${other.customer.id}/accounts` },
      { method: 'POST', path: `/api/customers/${other.customer.id}/accounts`, body: { type: 'EVERYDAY' } },
      { method: 'POST', path: `/api/customers/${other.customer.id}/joint-accounts`, body: { type: 'EVERYDAY', coOwnerEmail: owner.customer.email } },
      { method: 'GET', path: `/api/customers/${other.customer.id}/accounts/missing/transactions` },
    ];
    for (const oldRequest of oldRequests) {
      const result = await owner.client.request(oldRequest.path, {
        method: oldRequest.method,
        body: oldRequest.body,
      });
      assert.equal(result.response.status, 404, `${oldRequest.method} ${oldRequest.path}`);
    }
    assert.deepEqual({
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    }, baseline);
  });
});
