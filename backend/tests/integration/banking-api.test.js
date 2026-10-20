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
const { createDelayService } = require('../../src/services/delayService');
const { createScheduledTransferService } = require('../../src/services/scheduledTransferService');
const { createCardService } = require('../../src/services/cardService');
const expectedOpenApiDocument = require('../../src/docs/openapi.json');

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
        redirect: options.redirect ?? 'follow',
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
  let testNow;
  let processDueScheduledTransfers;

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

  async function paymentState(accountIds) {
    const [accounts, transferCount, paymentCount] = await Promise.all([
      prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, balanceCents: true },
        orderBy: { id: 'asc' },
      }),
      prisma.transfer.count(),
      prisma.payment.count(),
    ]);
    return { accounts, transferCount, paymentCount };
  }

  function assertJson(result, status) {
    assert.equal(result.response.status, status, JSON.stringify(result.body));
    assert.match(result.response.headers.get('content-type') ?? '', /^application\/json\b/);
  }

  async function rawRequest(relativePath, { method = 'POST', headers = {}, body } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, { method, headers, body });
    const contentType = response.headers.get('content-type') ?? '';
    const responseBody = response.status === 204
      ? null
      : (/^application\/json\b/.test(contentType) ? await response.json() : await response.text());
    return { response, body: responseBody, setCookie: response.headers.get('set-cookie') };
  }

  async function createPayId(accountId, overrides = {}) {
    return prisma.payIdDirectoryEntry.create({
      data: {
        type: 'EMAIL',
        value: 'recipient.payid@example.test',
        displayName: 'PayID Recipient',
        accountId,
        isActive: true,
        ...overrides,
      },
    });
  }

  async function createBpayBiller(overrides = {}) {
    return prisma.bpayBiller.create({
      data: {
        billerCode: '123456',
        name: 'Example Energy',
        referenceLength: 10,
        isActive: true,
        ...overrides,
      },
    });
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
    testNow = new Date('2030-01-15T10:00:00.000Z');
    const scheduledServices = createScheduledTransferService({ prisma, now: () => testNow });
    const cardServices = createCardService({
      prisma,
      now: () => testNow,
      lastFourGenerator: () => '4242',
    });
    processDueScheduledTransfers = scheduledServices.processDueScheduledTransfers;
    server = await startServer(createApp({
      prisma,
      logger: createTestLogger(),
      services: { ...scheduledServices, ...cardServices },
    }));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    testNow = new Date('2030-01-15T10:00:00.000Z');
    await prisma.authSession.deleteMany();
    await prisma.cardTransaction.deleteMany();
    await prisma.card.deleteMany();
    await prisma.scheduledTransfer.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.payIdDirectoryEntry.deleteMany();
    await prisma.bpayBiller.deleteMany();
    await prisma.account.deleteMany();
    await prisma.customer.deleteMany();

    const resetDelay = await client().request('/api/test-controls/delay', {
      method: 'PUT',
      body: { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' },
    });
    assertJson(resetDelay, 200);
    assert.deepEqual(resetDelay.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });
  });

  after(async () => {
    await stopServer(server);
    await prisma?.$disconnect();
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('health, Swagger UI, local assets, and OpenAPI are public, passive, and retain the active contract', async () => {
    const anonymous = client();
    const beforeState = {
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
      payments: await prisma.payment.count(),
      payIds: await prisma.payIdDirectoryEntry.count(),
      bpayBillers: await prisma.bpayBiller.count(),
      scheduledTransfers: await prisma.scheduledTransfer.count(),
      cards: await prisma.card.count(),
      cardTransactions: await prisma.cardTransaction.count(),
    };

    const firstHealth = await anonymous.request('/api/health');
    const secondHealth = await anonymous.request('/api/health');
    assert.equal(firstHealth.response.status, 200);
    assert.deepEqual(firstHealth.body, { status: 'ok' });
    assert.deepEqual(secondHealth.body, firstHealth.body);

    const legacyHealth = await anonymous.request('/health', { redirect: 'manual' });
    assert.equal(legacyHealth.response.status, 308);
    assert.equal(legacyHealth.response.headers.get('location'), '/api/health');

    const redirect = await anonymous.request('/docs', { redirect: 'manual' });
    assert.equal(redirect.response.status, 308);
    assert.equal(redirect.response.headers.get('location'), '/docs/');

    const swaggerUi = await anonymous.request('/docs/', { redirect: 'manual' });
    assert.equal(swaggerUi.response.status, 200);
    assert.match(swaggerUi.response.headers.get('content-type') ?? '', /^text\/html\b/);
    assert.match(swaggerUi.body, /<title>Express Bank Demo API<\/title>/);
    assert.match(swaggerUi.body, /\.\/swagger-ui\.css/);
    assert.match(swaggerUi.body, /\.\/swagger-ui-bundle\.js/);
    assert.match(swaggerUi.body, /\.\/swagger-ui-init\.js/);

    const swaggerCss = await anonymous.request('/docs/swagger-ui.css');
    assert.equal(swaggerCss.response.status, 200);
    assert.match(swaggerCss.response.headers.get('content-type') ?? '', /^text\/css\b/);
    assert.match(swaggerCss.body, /\.swagger-ui/);

    const swaggerBundle = await anonymous.request('/docs/swagger-ui-bundle.js');
    assert.equal(swaggerBundle.response.status, 200);
    assert.match(swaggerBundle.response.headers.get('content-type') ?? '', /^(application|text)\/javascript\b/);
    assert.match(swaggerBundle.body, /SwaggerUIBundle/);

    const swaggerConfig = await anonymous.request('/docs/swagger-ui-init.js');
    assert.equal(swaggerConfig.response.status, 200);
    assert.match(swaggerConfig.response.headers.get('content-type') ?? '', /^(application|text)\/javascript\b/);
    assert.match(swaggerConfig.body, /["']url["']\s*:\s*["']\/docs\/openapi\.json["']/);
    assert.match(swaggerConfig.body, /["']withCredentials["']\s*:\s*true/);
    assert.match(swaggerConfig.body, /["']persistAuthorization["']\s*:\s*false/);

    for (const renderedSource of [swaggerUi.body, swaggerConfig.body]) {
      assert.doesNotMatch(renderedSource, new RegExp(TEST_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(renderedSource, /eb_session=[A-Za-z0-9_-]{43}/);
      assert.doesNotMatch(renderedSource, /["'](?:authorization|password|token)["']\s*:\s*["'][^"']+["']/i);
    }

    const documentation = await anonymous.request('/docs/openapi.json');
    assert.equal(documentation.response.status, 200);
    assert.match(documentation.response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.deepEqual(documentation.body, expectedOpenApiDocument);
    assert.equal(documentation.body.openapi, '3.0.3');
    assert.deepEqual(documentation.body.servers, [{
      url: '/',
      description: 'The origin serving this contract and Swagger UI',
    }]);
    assert.deepEqual(documentation.body.components.schemas.AccountType.enum, [
      'EVERYDAY', 'SAVINGS', 'BUSINESS',
    ]);
    assert.deepEqual(documentation.body.components.schemas.OwnershipType.enum, ['SINGLE', 'JOINT']);
    assert.equal(documentation.body.components.securitySchemes.cookieAuth.type, 'apiKey');
    assert.equal(documentation.body.components.securitySchemes.cookieAuth.in, 'cookie');
    assert.equal(documentation.body.components.securitySchemes.cookieAuth.name, 'eb_session');
    assert.equal(documentation.body.components.securitySchemes.bearerAuth.type, 'http');
    assert.equal(documentation.body.components.securitySchemes.bearerAuth.scheme, 'bearer');

    for (const route of [
      '/api/test-controls/delay',
      '/api/test-controls/delay/sample',
      '/api/session',
      '/api/logout',
      '/api/accounts',
      '/api/joint-accounts',
      '/api/transfers',
      '/api/payments/resolve',
      '/api/payments',
      '/api/profile',
      '/api/scheduled-transfers',
      '/api/cards',
      '/api/cards/{cardId}',
      '/api/cards/{cardId}/lock',
      '/api/cards/{cardId}/unlock',
      '/api/cards/{cardId}/disable',
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
    assert.deepEqual(documentation.body.paths['/api/test-controls/delay'].get.security, []);
    assert.deepEqual(documentation.body.paths['/api/test-controls/delay'].put.security, []);
    assert.deepEqual(documentation.body.paths['/api/test-controls/delay/sample'].post.security, []);
    assert.ok(documentation.body.paths['/api/test-controls/delay'].put.responses['400']);
    assert.ok(documentation.body.paths['/api/test-controls/delay'].put.responses['403']);
    assert.ok(documentation.body.paths['/api/test-controls/delay/sample'].post.responses['403']);
    const protectedSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
    for (const [route, method] of [
      ['/api/session', 'get'],
      ['/api/logout', 'post'],
      ['/api/profile', 'put'],
      ['/api/accounts', 'get'],
      ['/api/accounts', 'post'],
      ['/api/joint-accounts', 'post'],
      ['/api/transfers', 'post'],
      ['/api/payments/resolve', 'post'],
      ['/api/payments', 'post'],
      ['/api/scheduled-transfers', 'get'],
      ['/api/scheduled-transfers', 'post'],
      ['/api/cards', 'get'],
      ['/api/cards', 'post'],
      ['/api/cards/{cardId}', 'get'],
      ['/api/cards/{cardId}/lock', 'post'],
      ['/api/cards/{cardId}/unlock', 'post'],
      ['/api/cards/{cardId}/disable', 'post'],
      ['/api/accounts/{accountId}/transactions', 'get'],
    ]) {
      assert.deepEqual(
        documentation.body.paths[route][method].security,
        protectedSecurity,
        `${method.toUpperCase()} ${route} must advertise bearer or cookie authentication`,
      );
    }
    for (const [route, method] of [
      ['/api/test-controls/delay', 'put'],
      ['/api/login', 'post'],
      ['/api/customers', 'post'],
      ['/api/profile', 'put'],
      ['/api/accounts', 'post'],
      ['/api/joint-accounts', 'post'],
      ['/api/transfers', 'post'],
      ['/api/payments/resolve', 'post'],
      ['/api/payments', 'post'],
      ['/api/scheduled-transfers', 'post'],
      ['/api/cards', 'post'],
    ]) {
      const operation = documentation.body.paths[route][method];
      assert.equal(operation.requestBody.required, true, `${method.toUpperCase()} ${route} needs a required body`);
      assert.ok(operation.requestBody.content['application/json']);
      assert.ok(operation.responses['415'], `${method.toUpperCase()} ${route} needs 415`);
    }
    for (const [route, method] of [
      ['/api/session', 'get'],
      ['/api/accounts', 'get'],
      ['/api/accounts/{accountId}/transactions', 'get'],
      ['/api/cards/{cardId}', 'get'],
    ]) {
      assert.ok(documentation.body.paths[route][method].responses['401'], `${method.toUpperCase()} ${route} needs 401`);
    }
    for (const [route, method] of [
      ['/api/logout', 'post'],
      ['/api/profile', 'put'],
      ['/api/accounts', 'post'],
      ['/api/joint-accounts', 'post'],
      ['/api/transfers', 'post'],
      ['/api/payments/resolve', 'post'],
      ['/api/payments', 'post'],
      ['/api/scheduled-transfers', 'post'],
      ['/api/cards', 'post'],
      ['/api/cards/{cardId}/lock', 'post'],
      ['/api/cards/{cardId}/unlock', 'post'],
      ['/api/cards/{cardId}/disable', 'post'],
    ]) {
      const responses = documentation.body.paths[route][method].responses;
      assert.ok(responses['401'], `${method.toUpperCase()} ${route} needs 401`);
      assert.ok(responses['403'], `${method.toUpperCase()} ${route} needs 403`);
    }
    for (const schema of [
      'UpdateProfileRequest',
      'PaymentRequest',
      'BankAccountPaymentRequest',
      'PayIdPaymentRequest',
      'BpayPaymentRequest',
      'PaymentResolution',
      'PaymentReceipt',
      'CreateScheduledTransferRequest',
      'ScheduledTransfer',
      'CardTransaction',
      'Card',
      'DelaySetting',
      'DelaySample',
    ]) assert.ok(documentation.body.components.schemas[schema], `OpenAPI is missing ${schema}`);

    assert.deepEqual({
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
      payments: await prisma.payment.count(),
      payIds: await prisma.payIdDirectoryEntry.count(),
      bpayBillers: await prisma.bpayBiller.count(),
      scheduledTransfers: await prisma.scheduledTransfer.count(),
      cards: await prisma.card.count(),
      cardTransactions: await prisma.cardTransaction.count(),
    }, beforeState);
  });

  test('delay ranges default per app, accept fixed and variable bounds, and are shared without database writes', async () => {
    const firstClient = client();
    const secondClient = client();
    const beforeState = {
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    };

    const initial = await firstClient.request('/api/test-controls/delay', { origin: 'https://foreign.example' });
    assertJson(initial, 200);
    assert.deepEqual(initial.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });

    for (const setting of [
      { minSeconds: 2, maxSeconds: 5, scope: 'API' },
      { minSeconds: 60, maxSeconds: 60, scope: 'UI' },
    ]) {
      const updated = await firstClient.request('/api/test-controls/delay', { method: 'PUT', body: setting });
      assertJson(updated, 200);
      assert.deepEqual(updated.body, setting);
      const shared = await secondClient.request('/api/test-controls/delay');
      assertJson(shared, 200);
      assert.deepEqual(shared.body, setting);
    }

    assert.deepEqual({
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    }, beforeState);

    const freshServer = await startServer(createApp({ prisma, logger: createTestLogger() }));
    try {
      const address = freshServer.address();
      const freshClient = createHttpClient(() => `http://127.0.0.1:${address.port}`);
      const freshDefault = await freshClient.request('/api/test-controls/delay');
      assertJson(freshDefault, 200);
      assert.deepEqual(freshDefault.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });
    } finally {
      await stopServer(freshServer);
    }
  });

  test('range updates and samples require a trusted Origin and invalid settings are rejected atomically', async () => {
    const controlClient = client();
    const configured = await controlClient.request('/api/test-controls/delay', {
      method: 'PUT',
      body: { minSeconds: 1, maxSeconds: 3, scope: 'UI' },
    });
    assertJson(configured, 200);

    for (const origin of [null, 'https://foreign.example', 'http://localhost:5173.evil.example']) {
      for (const request of [
        { path: '/api/test-controls/delay', method: 'PUT', body: { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' } },
        { path: '/api/test-controls/delay/sample', method: 'POST' },
      ]) {
        const rejected = await controlClient.request(request.path, { ...request, origin });
        assertJson(rejected, 403);
        assert.deepEqual(rejected.body, { error: 'Trusted Origin required.' });
      }
      assert.deepEqual((await controlClient.request('/api/test-controls/delay')).body, configured.body);
    }

    for (const body of [
      null,
      true,
      1,
      'invalid',
      {},
      { minSeconds: 0, maxSeconds: 0 },
      { minSeconds: 0, scope: 'API' },
      { maxSeconds: 0, scope: 'API' },
      { minSeconds: -1, maxSeconds: 0, scope: 'API' },
      { minSeconds: 0, maxSeconds: 61, scope: 'API' },
      { minSeconds: 2, maxSeconds: 1, scope: 'API' },
      { minSeconds: 0.5, maxSeconds: 1, scope: 'API' },
      { minSeconds: 0, maxSeconds: 1.5, scope: 'API' },
      { minSeconds: '0', maxSeconds: 1, scope: 'API' },
      { minSeconds: 0, maxSeconds: '1', scope: 'API' },
      { minSeconds: 0, maxSeconds: 1, scope: 'api' },
      { minSeconds: 0, maxSeconds: 1, scope: 'API', extra: true },
    ]) {
      const rejected = await controlClient.request('/api/test-controls/delay', { method: 'PUT', body });
      assertJson(rejected, 400);
      assert.deepEqual(rejected.body, {
        error: 'Provide exactly minSeconds and maxSeconds as integers from 0 to 60, with minSeconds no greater than maxSeconds, and scope as API, UI, or BOTH.',
      });
      assert.deepEqual((await controlClient.request('/api/test-controls/delay')).body, configured.body);
    }

    const malformedResponse = await fetch(`${baseUrl}/api/test-controls/delay`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: TRUSTED_ORIGIN },
      body: '{"minSeconds":1,',
    });
    assert.equal(malformedResponse.status, 400);
    assert.match(malformedResponse.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.deepEqual(await malformedResponse.json(), {
      error: 'Provide exactly minSeconds and maxSeconds as integers from 0 to 60, with minSeconds no greater than maxSeconds, and scope as API, UI, or BOTH.',
    });
    assert.deepEqual((await controlClient.request('/api/test-controls/delay')).body, configured.body);
  });

  test('sample control is responsive, non-cacheable, in range, and passive', async () => {
    const controlClient = client();
    const setting = { minSeconds: 2, maxSeconds: 5, scope: 'API' };
    assertJson(await controlClient.request('/api/test-controls/delay', { method: 'PUT', body: setting }), 200);
    const beforeState = {
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    };

    const startedAt = process.hrtime.bigint();
    const sampled = await controlClient.request('/api/test-controls/delay/sample', { method: 'POST' });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    assertJson(sampled, 200);
    assert.match(sampled.response.headers.get('cache-control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/);
    assert.match(sampled.body.ticket, /^[A-Za-z0-9._~-]+$/);
    assert.ok(Number.isInteger(sampled.body.sampledSeconds));
    assert.ok(sampled.body.sampledSeconds >= 2 && sampled.body.sampledSeconds <= 5);
    assert.ok(elapsedMs < 750, `sample control was delayed by ${elapsedMs} ms`);
    assert.deepEqual((await controlClient.request('/api/test-controls/delay')).body, setting);
    assert.deepEqual({
      customers: await prisma.customer.count(),
      sessions: await prisma.authSession.count(),
      accounts: await prisma.account.count(),
      transfers: await prisma.transfer.count(),
    }, beforeState);
  });

  test('UI and zero ranges are immediate while unticketed API and BOTH requests expose fixed applied delays', async () => {
    const controlClient = client();

    async function configure(body) {
      const result = await controlClient.request('/api/test-controls/delay', { method: 'PUT', body });
      assertJson(result, 200);
      assert.deepEqual(result.body, body);
    }

    async function timedRequest(httpClient, relativePath, options) {
      const startedAt = process.hrtime.bigint();
      const result = await httpClient.request(relativePath, options);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      return { ...result, elapsedMs };
    }

    await configure({ minSeconds: 1, maxSeconds: 1, scope: 'UI' });
    const uiScopeHealth = await timedRequest(controlClient, '/api/health');
    assertJson(uiScopeHealth, 200);
    assert.equal(uiScopeHealth.response.headers.get('x-test-delay-seconds'), '0');
    assert.ok(uiScopeHealth.elapsedMs < 750, `UI scope unexpectedly delayed the API by ${uiScopeHealth.elapsedMs} ms`);

    await configure({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });
    const zeroDelayHealth = await timedRequest(controlClient, '/api/health');
    assertJson(zeroDelayHealth, 200);
    assert.equal(zeroDelayHealth.response.headers.get('x-test-delay-seconds'), '0');
    assert.ok(zeroDelayHealth.elapsedMs < 750, `zero range took ${zeroDelayHealth.elapsedMs} ms`);

    await configure({ minSeconds: 1, maxSeconds: 1, scope: 'API' });
    const docs = await timedRequest(controlClient, '/docs/openapi.json');
    assertJson(docs, 200);
    assert.equal(docs.response.headers.get('x-test-delay-seconds'), null);
    assert.ok(docs.elapsedMs < 750, `API delay leaked into docs by ${docs.elapsedMs} ms`);

    const legacyHealth = await timedRequest(controlClient, '/health', { redirect: 'manual' });
    assert.equal(legacyHealth.response.status, 308);
    assert.equal(legacyHealth.response.headers.get('location'), '/api/health');
    assert.equal(legacyHealth.response.headers.get('x-test-delay-seconds'), null);
    assert.ok(legacyHealth.elapsedMs < 750, `API delay leaked into legacy health by ${legacyHealth.elapsedMs} ms`);

    const delayedSuccess = await timedRequest(controlClient, '/api/health');
    assertJson(delayedSuccess, 200);
    assert.deepEqual(delayedSuccess.body, { status: 'ok' });
    assert.equal(delayedSuccess.response.headers.get('x-test-delay-seconds'), '1');
    assert.ok(delayedSuccess.elapsedMs >= 850, `API success returned after only ${delayedSuccess.elapsedMs} ms`);

    await configure({ minSeconds: 1, maxSeconds: 1, scope: 'BOTH' });
    const delayedError = await timedRequest(client(), '/api/accounts');
    assertJson(delayedError, 401);
    assert.deepEqual(delayedError.body, { error: 'Authentication required.' });
    assert.equal(delayedError.response.headers.get('x-test-delay-seconds'), '1');
    assert.ok(delayedError.elapsedMs >= 850, `BOTH error returned after only ${delayedError.elapsedMs} ms`);
  });

  test('a valid ticket applies its exact delay once and controls stay responsive after an in-flight reset', async () => {
    const actor = await createAuthenticatedCustomer({ suffix: 'ticketed-captured-delay' });
    const controlClient = client();
    const fixedDelay = { minSeconds: 1, maxSeconds: 1, scope: 'API' };
    assertJson(await controlClient.request('/api/test-controls/delay', { method: 'PUT', body: fixedDelay }), 200);

    const sampleStartedAt = process.hrtime.bigint();
    const sample = await controlClient.request('/api/test-controls/delay/sample', { method: 'POST' });
    const sampleElapsedMs = Number(process.hrtime.bigint() - sampleStartedAt) / 1_000_000;
    assertJson(sample, 200);
    assert.deepEqual(Object.keys(sample.body).sort(), ['sampledSeconds', 'ticket']);
    assert.equal(sample.body.sampledSeconds, 1);
    assert.match(sample.response.headers.get('cache-control') ?? '', /no-store/);
    assert.ok(sampleElapsedMs < 750, `sample control was delayed by ${sampleElapsedMs} ms`);

    const requestStartedAt = process.hrtime.bigint();
    let accountSettled = false;
    const pendingAccount = actor.client.request('/api/accounts', {
      method: 'POST',
      headers: { 'X-Test-Delay-Ticket': sample.body.ticket },
      body: { type: 'EVERYDAY', displayName: 'Ticketed delayed account' },
    }).finally(() => {
      accountSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const resetStartedAt = process.hrtime.bigint();
    const reset = await controlClient.request('/api/test-controls/delay', {
      method: 'PUT',
      body: { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' },
    });
    const resetElapsedMs = Number(process.hrtime.bigint() - resetStartedAt) / 1_000_000;
    assertJson(reset, 200);
    assert.deepEqual(reset.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });
    assert.ok(resetElapsedMs < 750, `control update was delayed by ${resetElapsedMs} ms`);
    assert.equal(accountSettled, false, 'ticketed API response completed before its captured delay elapsed');

    const current = await controlClient.request('/api/test-controls/delay');
    assertJson(current, 200);
    assert.deepEqual(current.body, reset.body);
    const zeroSample = await controlClient.request('/api/test-controls/delay/sample', { method: 'POST' });
    assertJson(zeroSample, 200);
    assert.equal(zeroSample.body.sampledSeconds, 0);
    assert.equal(accountSettled, false, 'control requests waited for the in-flight API response');

    const account = await pendingAccount;
    const requestElapsedMs = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;
    assertJson(account, 201);
    assert.equal(account.response.headers.get('x-test-delay-seconds'), '1');
    assert.equal(account.body.customerId, actor.customer.id);
    assert.ok(requestElapsedMs >= 850, `captured ticket delay was reset after only ${requestElapsedMs} ms`);
    assert.equal(await prisma.account.count({ where: { customerId: actor.customer.id } }), 1);

    for (const ticket of [sample.body.ticket, 'unknown-ticket']) {
      const rejected = await actor.client.request('/api/accounts', {
        method: 'POST',
        headers: { 'X-Test-Delay-Ticket': ticket },
        body: { type: 'SAVINGS', displayName: 'Must not persist' },
      });
      assertJson(rejected, 400);
      assert.equal(rejected.response.headers.get('x-test-delay-seconds'), '0');
      assert.deepEqual(rejected.body, { error: 'Invalid or expired test delay ticket.' });
      assert.equal(await prisma.account.count({ where: { customerId: actor.customer.id } }), 1);
    }

    const anonymousWithTicket = await client().request('/api/accounts', {
      headers: { 'X-Test-Delay-Ticket': zeroSample.body.ticket },
    });
    assertJson(anonymousWithTicket, 401);
    assert.equal(anonymousWithTicket.response.headers.get('x-test-delay-seconds'), '0');
    assert.deepEqual(anonymousWithTicket.body, { error: 'Authentication required.' });
  });

  test('expired delay tickets are rejected before a banking route can create side effects', async () => {
    const expiringDelayService = createDelayService(undefined, { ticketTtlMs: 25 });
    const expiringServer = await startServer(createApp({
      prisma,
      logger: createTestLogger(),
      delayService: expiringDelayService,
    }));
    try {
      const address = expiringServer.address();
      const expiringClient = createHttpClient(() => `http://127.0.0.1:${address.port}`);
      const sample = await expiringClient.request('/api/test-controls/delay/sample', { method: 'POST' });
      assertJson(sample, 200);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rejected = await expiringClient.request('/api/customers', {
        method: 'POST',
        headers: { 'X-Test-Delay-Ticket': sample.body.ticket },
        body: {
          email: 'expired-ticket@example.test',
          password: TEST_PASSWORD,
          firstName: 'Expired',
          lastName: 'Ticket',
        },
      });
      assertJson(rejected, 400);
      assert.equal(rejected.response.headers.get('x-test-delay-seconds'), '0');
      assert.deepEqual(rejected.body, { error: 'Invalid or expired test delay ticket.' });
      assert.equal(await prisma.customer.count(), 0);
    } finally {
      await stopServer(expiringServer);
    }
  });

  test('delay tickets do not authenticate and preserve login and logout response contracts', async () => {
    const created = await createCustomer({ suffix: 'ticket-auth-contracts' });
    const controlClient = client();
    async function reserveTicket() {
      const sampled = await controlClient.request('/api/test-controls/delay/sample', { method: 'POST' });
      assertJson(sampled, 200);
      assert.equal(sampled.body.sampledSeconds, 0);
      return sampled.body.ticket;
    }

    const anonymous = await client().request('/api/accounts', {
      headers: { 'X-Test-Delay-Ticket': await reserveTicket() },
    });
    assertJson(anonymous, 401);
    assert.deepEqual(anonymous.body, { error: 'Authentication required.' });

    const authClient = client();
    const invalidLogin = await authClient.request('/api/login', {
      method: 'POST',
      headers: { 'X-Test-Delay-Ticket': await reserveTicket() },
      body: { email: created.registration.email, password: 'wrong-password' },
    });
    assertJson(invalidLogin, 401);
    assert.deepEqual(invalidLogin.body, { error: 'Invalid credentials.' });
    assert.equal(authClient.cookie, null);

    const authenticated = await authClient.request('/api/login', {
      method: 'POST',
      headers: { 'X-Test-Delay-Ticket': await reserveTicket() },
      body: { email: created.registration.email, password: created.registration.password },
    });
    assertJson(authenticated, 200);
    assert.equal(authenticated.body.customer.id, created.customer.id);
    assert.match(authClient.cookie ?? '', /^eb_session=[A-Za-z0-9_-]{43}$/);

    const logout = await authClient.request('/api/logout', {
      method: 'POST',
      headers: { 'X-Test-Delay-Ticket': await reserveTicket() },
    });
    assert.equal(logout.response.status, 204);
    assert.equal(logout.body, null);
    assert.equal(logout.response.headers.get('x-test-delay-seconds'), '0');
    assert.equal(authClient.cookie, null);
  });

  test('CORS and trusted-Origin checks accept exact origins and reject mutation lookalikes without side effects', async () => {
    const anonymous = client();
    for (const origin of [TRUSTED_ORIGIN, SECOND_TRUSTED_ORIGIN]) {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      const allowedHeaders = (response.headers.get('access-control-allow-headers') ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase());
      assert.ok(allowedHeaders.includes('authorization'));
      assert.ok(allowedHeaders.includes('content-type'));
    }

    const rejectedPreflight = await fetch(`${baseUrl}/api/accounts`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173.evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    assert.equal(rejectedPreflight.headers.has('access-control-allow-origin'), false);

    const registration = {
      email: 'origin-test@example.test',
      password: TEST_PASSWORD,
      firstName: 'Origin',
      lastName: 'Test',
    };
    for (const origin of [null, 'null', 'https://foreign.example', 'http://localhost:5173.evil.example']) {
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
    for (const origin of [
      null,
      'https://foreign.example',
      'http://localhost:5173.evil.example',
      baseUrl.replace('127.0.0.1', '127.0.0.1.evil.example'),
    ]) {
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

  test('the actual server origin can establish and use a cookie session without broadening CORS', async () => {
    const sameOrigin = client();
    const registration = {
      email: 'same-origin@example.test',
      password: TEST_PASSWORD,
      firstName: 'Same',
      lastName: 'Origin',
    };

    const created = await sameOrigin.request('/api/customers', {
      method: 'POST',
      origin: baseUrl,
      body: registration,
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.response.headers.has('access-control-allow-origin'), false);

    const authenticated = await sameOrigin.request('/api/login', {
      method: 'POST',
      origin: baseUrl,
      body: { email: registration.email, password: registration.password },
    });
    assert.equal(authenticated.response.status, 200);
    assert.match(authenticated.setCookie ?? '', /^eb_session=[A-Za-z0-9_-]{43};/);

    const session = await sameOrigin.request('/api/session');
    assert.equal(session.response.status, 200);
    assert.equal(session.body.id, created.body.id);

    const account = await sameOrigin.request('/api/accounts', {
      method: 'POST',
      origin: baseUrl,
      body: { type: 'EVERYDAY', displayName: 'Swagger-created account' },
    });
    assert.equal(account.response.status, 201);
    assert.equal(account.body.customerId, created.body.id);
    assert.equal(await prisma.account.count({ where: { customerId: created.body.id } }), 1);

    const crossOriginPreflight = await fetch(`${baseUrl}/api/accounts`, {
      method: 'OPTIONS',
      headers: { Origin: baseUrl, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(crossOriginPreflight.headers.has('access-control-allow-origin'), false);
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
    assert.equal(authenticated.response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.equal(authenticated.response.headers.get('pragma'), 'no-cache');
    assert.equal(authenticated.body.tokenType, 'Bearer');
    assert.ok(Date.parse(authenticated.body.expiresAt));

    const token = authenticated.client.cookie.slice('eb_session='.length);
    assert.equal(authenticated.body.accessToken, token);
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
    assert.deepEqual(session.body, authenticated.body.customer);
    assert.equal(session.body.id, created.customer.id);
    assert.ok(Date.parse(session.body.lastLoginAt));
    assert.equal('passwordHash' in session.body, false);
    assert.equal('isActive' in session.body, false);
  });

  test('bearer-only clients can perform passive reads and representative mutations without an Origin', async () => {
    const actor = await createAuthenticatedCustomer({ suffix: 'bearer-only-actor' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'bearer-only-recipient' });
    const bearerClient = client();
    const bearerHeaders = { Authorization: `Bearer ${actor.login.body.accessToken}` };

    assert.equal(bearerClient.cookie, null);
    const session = await bearerClient.request('/api/session', { headers: bearerHeaders, origin: null });
    assertJson(session, 200);
    assert.equal(session.body.id, actor.customer.id);

    const sourceResult = await bearerClient.request('/api/accounts', {
      method: 'POST',
      headers: bearerHeaders,
      origin: null,
      body: { type: 'EVERYDAY', displayName: 'Bearer source' },
    });
    assertJson(sourceResult, 201);
    assert.equal(sourceResult.body.customerId, actor.customer.id);
    const destination = await createAccount(recipient.client, 'SAVINGS', 'Bearer destination');

    const listed = await bearerClient.request('/api/accounts', { headers: bearerHeaders, origin: null });
    assertJson(listed, 200);
    assert.deepEqual(listed.body.accounts.map(({ id }) => id), [sourceResult.body.id]);

    const transferred = await bearerClient.request('/api/transfers', {
      method: 'POST',
      headers: bearerHeaders,
      origin: null,
      body: {
        sourceAccountId: sourceResult.body.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 1_234,
        description: 'Bearer integration transfer',
      },
    });
    assertJson(transferred, 201);
    assert.deepEqual(await balancesAndTransferCount([sourceResult.body.id, destination.id]), {
      accounts: [
        { id: destination.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS + 1_234 },
        { id: sourceResult.body.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS - 1_234 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
      transferCount: 1,
    });
  });

  test('an explicit malformed or invalid bearer credential never falls back to a valid cookie', async () => {
    const actor = await createAuthenticatedCustomer({ suffix: 'bearer-authoritative' });
    const accountCount = await prisma.account.count();

    for (const authorization of ['Basic opaque', 'Bearer', `Bearer ${'Z'.repeat(43)}`]) {
      const rejected = await actor.client.request('/api/accounts', {
        method: 'POST',
        headers: { Authorization: authorization },
        origin: null,
        body: { type: 'EVERYDAY', displayName: 'Must not persist' },
      });
      assertJson(rejected, 401);
      assert.deepEqual(rejected.body, { error: 'Authentication required.' });
      assert.equal(rejected.response.headers.get('www-authenticate'), 'Bearer realm="express-bank"');
      assert.equal(rejected.setCookie, null);
      assert.equal(await prisma.account.count(), accountCount);
    }

    const rejectedRead = await actor.client.request('/api/session', {
      headers: { Authorization: `Bearer ${'Y'.repeat(43)}` },
    });
    assertJson(rejectedRead, 401);
    assert.equal(rejectedRead.response.headers.get('www-authenticate'), 'Bearer realm="express-bank"');
    assert.equal(rejectedRead.setCookie, null);
  });

  test('bearer logout revokes only its selected session and clears only a matching cookie', async () => {
    const created = await createCustomer({ suffix: 'bearer-logout' });
    const firstLogin = await login(created.registration);
    const secondLogin = await login(created.registration);
    assert.equal(await prisma.authSession.count({ where: { customerId: created.customer.id } }), 2);

    const unrelatedCookieLogout = await client().request('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstLogin.body.accessToken}` },
      cookieOverride: secondLogin.client.cookie,
      origin: null,
    });
    assert.equal(unrelatedCookieLogout.response.status, 204);
    assert.equal(unrelatedCookieLogout.body, null);
    assert.equal(unrelatedCookieLogout.response.headers.get('content-type'), null);
    assert.equal(unrelatedCookieLogout.setCookie, null);
    assert.equal(await prisma.authSession.count({ where: { customerId: created.customer.id } }), 1);

    const replay = await client().request('/api/session', {
      headers: { Authorization: `Bearer ${firstLogin.body.accessToken}` },
    });
    assertJson(replay, 401);
    assert.equal(replay.response.headers.get('www-authenticate'), 'Bearer realm="express-bank"');
    assert.equal((await secondLogin.client.request('/api/session')).response.status, 200);

    const thirdLogin = await login(created.registration);
    const matchingCookieLogout = await thirdLogin.client.request('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${thirdLogin.body.accessToken}` },
      origin: null,
    });
    assert.equal(matchingCookieLogout.response.status, 204);
    assert.match(matchingCookieLogout.setCookie, /^eb_session=;/);
    assert.match(matchingCookieLogout.setCookie, /Max-Age=0/);
    assert.equal(thirdLogin.client.cookie, null);
    assert.equal(await prisma.authSession.count({ where: { customerId: created.customer.id } }), 1);
  });

  test('required JSON media types, malformed JSON, bodyless actions, and response content types are enforced over HTTP', async () => {
    const actor = await createAuthenticatedCustomer({
      suffix: 'content-type-actor',
      firstName: 'Before',
      lastName: 'Media',
    });
    const coOwner = await createCustomer({
      suffix: 'content-type-coowner',
      email: 'content.type.coowner@example.test',
    });
    const bearerHeaders = { Authorization: `Bearer ${actor.login.body.accessToken}` };
    const unsupportedCustomer = {
      email: 'content.type.rejected@example.test',
      password: TEST_PASSWORD,
      firstName: 'Rejected',
      lastName: 'Registration',
    };
    const requiredBodyRequests = [
      {
        method: 'PUT', path: '/api/test-controls/delay', headers: { Origin: TRUSTED_ORIGIN },
        body: { minSeconds: 1, maxSeconds: 1, scope: 'API' },
      },
      {
        method: 'POST', path: '/api/login', headers: { Origin: TRUSTED_ORIGIN },
        body: { email: actor.registration.email, password: actor.registration.password },
      },
      {
        method: 'POST', path: '/api/customers', headers: { Origin: TRUSTED_ORIGIN }, body: unsupportedCustomer,
      },
      {
        method: 'PUT', path: '/api/profile', headers: bearerHeaders,
        body: { firstName: 'Changed', lastName: 'Media', address: 'Must not persist' },
      },
      { method: 'POST', path: '/api/accounts', headers: bearerHeaders, body: { type: 'EVERYDAY' } },
      {
        method: 'POST', path: '/api/joint-accounts', headers: bearerHeaders,
        body: { type: 'EVERYDAY', coOwnerEmail: coOwner.customer.email },
      },
      { method: 'POST', path: '/api/transfers', headers: bearerHeaders, body: {} },
      { method: 'POST', path: '/api/payments/resolve', headers: bearerHeaders, body: {} },
      { method: 'POST', path: '/api/payments', headers: bearerHeaders, body: {} },
      { method: 'POST', path: '/api/scheduled-transfers', headers: bearerHeaders, body: {} },
      { method: 'POST', path: '/api/cards', headers: bearerHeaders, body: {} },
    ];
    const beforeState = {
      delay: (await client().request('/api/test-controls/delay')).body,
      customerCount: await prisma.customer.count(),
      sessionCount: await prisma.authSession.count(),
      accountCount: await prisma.account.count(),
      transferCount: await prisma.transfer.count(),
      paymentCount: await prisma.payment.count(),
      scheduledTransferCount: await prisma.scheduledTransfer.count(),
      cardCount: await prisma.card.count(),
      cardTransactionCount: await prisma.cardTransaction.count(),
      profile: await prisma.customer.findUnique({ where: { id: actor.customer.id } }),
    };

    for (const contentType of [null, 'text/plain']) {
      for (const request of requiredBodyRequests) {
        const headers = { ...request.headers };
        if (contentType !== null) headers['Content-Type'] = contentType;
        const rejected = await rawRequest(request.path, {
          method: request.method,
          headers,
          body: Buffer.from(JSON.stringify(request.body)),
        });
        assertJson(rejected, 415);
        assert.deepEqual(rejected.body, { error: 'Content-Type must be application/json.' });
      }
    }

    assert.deepEqual((await client().request('/api/test-controls/delay')).body, beforeState.delay);
    assert.equal(await prisma.customer.count(), beforeState.customerCount);
    assert.equal(await prisma.authSession.count(), beforeState.sessionCount);
    assert.equal(await prisma.account.count(), beforeState.accountCount);
    assert.equal(await prisma.transfer.count(), beforeState.transferCount);
    assert.equal(await prisma.payment.count(), beforeState.paymentCount);
    assert.equal(await prisma.scheduledTransfer.count(), beforeState.scheduledTransferCount);
    assert.equal(await prisma.card.count(), beforeState.cardCount);
    assert.equal(await prisma.cardTransaction.count(), beforeState.cardTransactionCount);
    assert.deepEqual(
      await prisma.customer.findUnique({ where: { id: actor.customer.id } }),
      beforeState.profile,
    );

    const charsetAccepted = await rawRequest('/api/test-controls/delay', {
      method: 'PUT',
      headers: { Origin: TRUSTED_ORIGIN, 'Content-Type': 'Application/JSON; Charset=UTF-8' },
      body: Buffer.from(JSON.stringify({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' })),
    });
    assertJson(charsetAccepted, 200);
    assert.deepEqual(charsetAccepted.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });

    const malformed = await rawRequest('/api/accounts', {
      method: 'POST',
      headers: { ...bearerHeaders, 'Content-Type': 'application/json; charset="utf-8"' },
      body: Buffer.from('{"type":'),
    });
    assertJson(malformed, 400);
    assert.deepEqual(malformed.body, { error: 'Invalid JSON request body.' });
    assert.equal(await prisma.account.count(), beforeState.accountCount);

    const createdAccount = await rawRequest('/api/accounts', {
      method: 'POST',
      headers: { ...bearerHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ type: 'EVERYDAY', displayName: 'Charset accepted' })),
    });
    assertJson(createdAccount, 201);
    const createdCard = await actor.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: createdAccount.body.id },
    });
    assertJson(createdCard, 201);

    const passiveGet = await rawRequest('/api/accounts', { method: 'GET', headers: bearerHeaders });
    assertJson(passiveGet, 200);
    const bodylessAction = await rawRequest(`/api/cards/${createdCard.body.id}/lock`, {
      method: 'POST',
      headers: bearerHeaders,
    });
    assertJson(bodylessAction, 200);
    assert.equal(bodylessAction.body.status, 'LOCKED');

    const noContent = await rawRequest('/api/logout', { method: 'POST', headers: bearerHeaders });
    assert.equal(noContent.response.status, 204);
    assert.equal(noContent.body, null);
    assert.equal(noContent.response.headers.get('content-type'), null);
  });

  test('protected APIs reject missing, malformed, unknown, idle, absolute-expired, and inactive sessions', async () => {
    const missing = await client().request('/api/accounts');
    assert.equal(missing.response.status, 401);
    assert.deepEqual(missing.body, { error: 'Authentication required.' });

    const newlyProtectedRequests = [
      { method: 'PUT', path: '/api/profile', body: { firstName: 'No', lastName: 'Session', address: 'Nowhere' } },
      { method: 'GET', path: '/api/scheduled-transfers' },
      { method: 'POST', path: '/api/scheduled-transfers', body: {} },
      { method: 'GET', path: '/api/cards' },
      { method: 'POST', path: '/api/cards', body: {} },
      { method: 'GET', path: '/api/cards/missing-card' },
      { method: 'POST', path: '/api/cards/missing-card/lock' },
      { method: 'POST', path: '/api/cards/missing-card/unlock' },
      { method: 'POST', path: '/api/cards/missing-card/disable' },
      { method: 'POST', path: '/api/payments/resolve', body: {} },
      { method: 'POST', path: '/api/payments', body: {} },
    ];
    for (const request of newlyProtectedRequests) {
      const result = await client().request(request.path, {
        method: request.method,
        body: request.body,
      });
      assert.equal(result.response.status, 401, `${request.method} ${request.path}`);
      assert.deepEqual(result.body, { error: 'Authentication required.' });
    }

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

  test('payment endpoints reject malformed, expired, revoked, and inactive sessions before validation or side effects', async () => {
    const malformed = await client().request('/api/payments', {
      method: 'POST',
      body: {},
      cookieOverride: `eb_session=${'A'.repeat(43)}; eb_session=${'B'.repeat(43)}`,
    });
    assertJson(malformed, 401);
    assert.deepEqual(malformed.body, { error: 'Authentication required.' });

    const created = await createCustomer({ suffix: 'payment-session-states' });
    const expiredClient = (await login(created.registration)).client;
    const expiredSession = await prisma.authSession.findFirst({ where: { customerId: created.customer.id } });
    await prisma.authSession.update({
      where: { id: expiredSession.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await expiredClient.request('/api/payments', { method: 'POST', body: {} });
    assertJson(expired, 401);

    const revokedClient = (await login(created.registration)).client;
    await prisma.authSession.deleteMany({ where: { customerId: created.customer.id } });
    const revoked = await revokedClient.request('/api/payments/resolve', { method: 'POST', body: {} });
    assertJson(revoked, 401);

    const inactiveClient = (await login(created.registration)).client;
    await prisma.customer.update({ where: { id: created.customer.id }, data: { isActive: false } });
    const inactive = await inactiveClient.request('/api/payments', { method: 'POST', body: {} });
    assertJson(inactive, 401);
    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.transfer.count(), 0);
  });

  test('profile updates are actor-scoped, immediately visible to concurrent sessions, and reject invalid input safely', async () => {
    const actor = await createCustomer({
      suffix: 'profile-actor',
      email: 'profile.actor@example.test',
      firstName: 'Before',
      lastName: 'Person',
    });
    const firstSession = (await login(actor.registration)).client;
    const secondSession = (await login(actor.registration)).client;
    const other = await createAuthenticatedCustomer({
      suffix: 'profile-other',
      email: 'profile.other@example.test',
      firstName: 'Other',
      lastName: 'Customer',
    });
    const sessionCount = await prisma.authSession.count();

    const updated = await firstSession.request('/api/profile', {
      method: 'PUT',
      body: {
        customerId: other.customer.id,
        firstName: '  Updated  ',
        lastName: '  Name  ',
        address: '  10 Test Street, Melbourne  ',
        email: 'attacker-controlled@example.test',
        passwordHash: 'must-not-be-used',
        isActive: false,
      },
    });
    assert.equal(updated.response.status, 200);
    assert.match(updated.response.headers.get('content-type'), /^application\/json\b/);
    assert.equal(updated.body.id, actor.customer.id);
    assert.equal(updated.body.email, actor.customer.email);
    assert.equal(updated.body.firstName, 'Updated');
    assert.equal(updated.body.lastName, 'Name');
    assert.equal(updated.body.address, '10 Test Street, Melbourne');
    for (const sensitive of ['password', 'passwordHash', 'isActive', 'token']) {
      assert.equal(sensitive in updated.body, false);
    }

    const concurrentView = await secondSession.request('/api/session');
    assert.deepEqual(concurrentView.body, updated.body);
    const unchangedOther = await other.client.request('/api/session');
    assert.equal(unchangedOther.body.firstName, 'Other');
    assert.equal(unchangedOther.body.lastName, 'Customer');
    assert.equal(unchangedOther.body.address, null);
    assert.equal(await prisma.authSession.count(), sessionCount);
    const persisted = await prisma.customer.findUnique({ where: { id: actor.customer.id } });
    assert.equal(persisted.firstName, 'Updated');
    assert.equal(persisted.lastName, 'Name');
    assert.equal(persisted.address, '10 Test Street, Melbourne');
    assert.equal(persisted.email, actor.customer.email);
    assert.equal(persisted.isActive, true);

    for (const body of [
      { firstName: '', lastName: 'Name', address: 'Address' },
      { firstName: 'First', lastName: '', address: 'Address' },
      { firstName: 'First', lastName: 'Last', address: ' ' },
      { firstName: 'x'.repeat(101), lastName: 'Last', address: 'Address' },
      { firstName: 'First', lastName: 'Last', address: 'x'.repeat(251) },
    ]) {
      const rejected = await firstSession.request('/api/profile', { method: 'PUT', body });
      assert.equal(rejected.response.status, 400);
      assert.deepEqual(Object.keys(rejected.body), ['error']);
    }
    const afterRejected = await prisma.customer.findUnique({ where: { id: actor.customer.id } });
    assert.equal(afterRejected.firstName, persisted.firstName);
    assert.equal(afterRejected.lastName, persisted.lastName);
    assert.equal(afterRejected.address, persisted.address);
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
    assertJson(primaryHistory, 200);
    assertJson(coOwnerHistory, 200);
    assert.deepEqual(coOwnerHistory.body, primaryHistory.body);
    assert.deepEqual(
      primaryHistory.body.transactions.map(({ direction }) => direction).sort(),
      ['RECEIVED', 'SENT', 'SENT'],
    );
    assert.deepEqual(
      new Set(primaryHistory.body.transactions.map(({ id }) => id)),
      new Set([sentByPrimary.body.id, sentByCoOwner.body.id, receivedByJoint.body.id]),
    );
    for (let index = 1; index < primaryHistory.body.transactions.length; index += 1) {
      const newer = primaryHistory.body.transactions[index - 1];
      const older = primaryHistory.body.transactions[index];
      const newerTime = Date.parse(newer.createdAt);
      const olderTime = Date.parse(older.createdAt);
      assert.ok(
        newerTime > olderTime || (newerTime === olderTime && newer.id >= older.id),
        'transaction history must be ordered newest-first with a deterministic ID tie-breaker',
      );
    }

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

  test('bank-account payment resolution is passive and confirmation persists one linked transfer and one history row', async () => {
    const payer = await createAuthenticatedCustomer({ suffix: 'bank-payment-payer' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'bank-payment-recipient' });
    const source = await createAccount(payer.client, 'EVERYDAY', 'Bills account');
    const destination = await createAccount(recipient.client, 'BUSINESS', 'Merchant settlement');
    const requestBody = {
      method: 'BANK_ACCOUNT',
      sourceAccountId: source.id,
      destinationAccountNumber: destination.accountNumber,
      amountCents: 12_345,
      description: 'Invoice 42',
      customerId: recipient.customer.id,
    };
    const baseline = await paymentState([source.id, destination.id]);
    const historiesBefore = await Promise.all([
      payer.client.request(`/api/accounts/${source.id}/transactions`),
      recipient.client.request(`/api/accounts/${destination.id}/transactions`),
    ]);

    const firstResolution = await payer.client.request('/api/payments/resolve', { method: 'POST', body: requestBody });
    const secondResolution = await payer.client.request('/api/payments/resolve', { method: 'POST', body: requestBody });
    assertJson(firstResolution, 200);
    assert.deepEqual(secondResolution.body, firstResolution.body);
    assert.deepEqual(firstResolution.body, {
      method: 'BANK_ACCOUNT',
      sourceAccountNumber: source.accountNumber,
      amountCents: 12_345,
      description: 'Invoice 42',
      payeeName: 'Merchant settlement',
      destinationAccountNumber: destination.accountNumber,
    });
    assert.deepEqual(await paymentState([source.id, destination.id]), baseline);
    assert.deepEqual(historiesBefore.map(({ body }) => body), [{ transactions: [] }, { transactions: [] }]);

    const confirmed = await payer.client.request('/api/payments', { method: 'POST', body: requestBody });
    assertJson(confirmed, 201);
    assert.deepEqual({
      ...confirmed.body,
      id: '<id>',
      createdAt: '<createdAt>',
    }, {
      id: '<id>',
      method: 'BANK_ACCOUNT',
      sourceAccountNumber: source.accountNumber,
      amountCents: 12_345,
      description: 'Invoice 42',
      payeeName: 'Merchant settlement',
      destinationAccountNumber: destination.accountNumber,
      payId: null,
      billerCode: null,
      customerReference: null,
      createdAt: '<createdAt>',
    });
    assert.ok(Date.parse(confirmed.body.createdAt));

    const persistedPayment = await prisma.payment.findUnique({
      where: { id: confirmed.body.id },
      include: { transfer: true },
    });
    assert.equal(persistedPayment.customerId, payer.customer.id);
    assert.equal(persistedPayment.payeeNameSnapshot, 'Merchant settlement');
    assert.equal(persistedPayment.transfer.amountCents, 12_345);
    assert.deepEqual(await paymentState([source.id, destination.id]), {
      accounts: [
        { id: destination.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS + 12_345 },
        { id: source.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS - 12_345 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
      transferCount: 1,
      paymentCount: 1,
    });

    const outgoing = await payer.client.request(`/api/accounts/${source.id}/transactions`);
    const incoming = await recipient.client.request(`/api/accounts/${destination.id}/transactions`);
    assertJson(outgoing, 200);
    assertJson(incoming, 200);
    assert.equal(outgoing.body.transactions.length, 1);
    assert.equal(incoming.body.transactions.length, 1);
    assert.deepEqual(
      outgoing.body.transactions.map(({ id, method, direction, counterpartyAccountNumber, counterpartyLabel }) => (
        { id, method, direction, counterpartyAccountNumber, counterpartyLabel }
      )),
      [{
        id: confirmed.body.id,
        method: 'BANK_ACCOUNT',
        direction: 'SENT',
        counterpartyAccountNumber: destination.accountNumber,
        counterpartyLabel: 'Merchant settlement',
      }],
    );
    assert.equal(incoming.body.transactions[0].id, confirmed.body.id);
    assert.equal(incoming.body.transactions[0].method, 'BANK_ACCOUNT');
    assert.equal(incoming.body.transactions[0].direction, 'RECEIVED');
    const stateAfterReads = await paymentState([source.id, destination.id]);
    assert.deepEqual((await payer.client.request(`/api/accounts/${source.id}/transactions`)).body, outgoing.body);
    assert.deepEqual(await paymentState([source.id, destination.id]), stateAfterReads);

    const legacyTransfer = await payer.client.request('/api/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 500,
        description: 'Legacy transfer still works',
      },
    });
    assertJson(legacyTransfer, 201);
    await prisma.transfer.update({
      where: { id: legacyTransfer.body.id },
      data: { createdAt: new Date('2040-01-01T00:00:00.000Z') },
    });
    const mixedHistory = await payer.client.request(`/api/accounts/${source.id}/transactions`);
    assert.deepEqual(mixedHistory.body.transactions.map(({ id, method }) => ({ id, method })), [
      { id: legacyTransfer.body.id, method: 'TRANSFER' },
      { id: confirmed.body.id, method: 'BANK_ACCOUNT' },
    ]);
    assert.equal(mixedHistory.body.transactions.filter(({ id }) => id === confirmed.body.id).length, 1);
  });

  test('PayID resolution is case-insensitive and never exposes its mapped account in review, receipt, or outgoing history', async () => {
    const payer = await createAuthenticatedCustomer({ suffix: 'payid-payer' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'payid-recipient' });
    const source = await createAccount(payer.client, 'EVERYDAY', 'PayID source');
    const destination = await createAccount(recipient.client, 'BUSINESS', 'Private mapped account');
    await createPayId(destination.id);
    const requestBody = {
      method: 'PAYID',
      sourceAccountId: source.id,
      payId: '  Recipient.PayID@Example.Test  ',
      amountCents: 4_321,
      description: 'Email payment',
    };

    const resolution = await payer.client.request('/api/payments/resolve', { method: 'POST', body: requestBody });
    assertJson(resolution, 200);
    assert.deepEqual(resolution.body, {
      method: 'PAYID',
      sourceAccountNumber: source.accountNumber,
      amountCents: 4_321,
      description: 'Email payment',
      payeeName: 'PayID Recipient',
      payId: 'recipient.payid@example.test',
    });
    assert.equal(JSON.stringify(resolution.body).includes(destination.accountNumber), false);
    assert.equal(JSON.stringify(resolution.body).includes(destination.id), false);

    const confirmed = await payer.client.request('/api/payments', { method: 'POST', body: requestBody });
    assertJson(confirmed, 201);
    assert.equal(confirmed.body.payId, 'recipient.payid@example.test');
    assert.equal(confirmed.body.destinationAccountNumber, null);
    assert.equal(confirmed.body.payeeName, 'PayID Recipient');
    assert.equal(JSON.stringify(confirmed.body).includes(destination.accountNumber), false);
    assert.equal(JSON.stringify(confirmed.body).includes(destination.id), false);

    const outgoing = await payer.client.request(`/api/accounts/${source.id}/transactions`);
    const incoming = await recipient.client.request(`/api/accounts/${destination.id}/transactions`);
    assertJson(outgoing, 200);
    assertJson(incoming, 200);
    assert.equal(outgoing.body.transactions.length, 1);
    assert.equal(incoming.body.transactions.length, 1);
    assert.deepEqual({
      id: outgoing.body.transactions[0].id,
      method: outgoing.body.transactions[0].method,
      direction: outgoing.body.transactions[0].direction,
      counterpartyAccountNumber: outgoing.body.transactions[0].counterpartyAccountNumber,
      counterpartyLabel: outgoing.body.transactions[0].counterpartyLabel,
    }, {
      id: confirmed.body.id,
      method: 'PAYID',
      direction: 'SENT',
      counterpartyAccountNumber: null,
      counterpartyLabel: 'PayID Recipient',
    });
    assert.equal(JSON.stringify(outgoing.body).includes(destination.accountNumber), false);
    assert.equal(JSON.stringify(outgoing.body).includes(destination.id), false);
    assert.deepEqual(await paymentState([source.id, destination.id]), {
      accounts: [
        { id: destination.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS + 4_321 },
        { id: source.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS - 4_321 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
      transferCount: 1,
      paymentCount: 1,
    });
  });

  test('either joint owner can make a BPAY payment with a source-only debit and both owners see the same history', async () => {
    const primary = await createAuthenticatedCustomer({ suffix: 'bpay-primary', email: 'bpay.primary@example.test' });
    const coOwner = await createAuthenticatedCustomer({ suffix: 'bpay-coowner', email: 'bpay.coowner@example.test' });
    const joint = await createJointAccount(primary.client, coOwner.customer.email, 'SAVINGS', 'Joint bills');
    await createBpayBiller();
    const requestBody = {
      method: 'BPAY',
      sourceAccountId: joint.id,
      billerCode: '123456',
      customerReference: '0123456789',
      amountCents: 7_500,
      description: 'Electricity',
      customerId: primary.customer.id,
    };

    const resolution = await coOwner.client.request('/api/payments/resolve', {
      method: 'POST',
      body: requestBody,
      origin: baseUrl,
    });
    assertJson(resolution, 200);
    assert.deepEqual(resolution.body, {
      method: 'BPAY',
      sourceAccountNumber: joint.accountNumber,
      amountCents: 7_500,
      description: 'Electricity',
      payeeName: 'Example Energy',
      billerCode: '123456',
      customerReference: '0123456789',
    });
    assert.deepEqual(await paymentState([joint.id]), {
      accounts: [{ id: joint.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS }],
      transferCount: 0,
      paymentCount: 0,
    });

    const confirmed = await coOwner.client.request('/api/payments', { method: 'POST', body: requestBody });
    assertJson(confirmed, 201);
    assert.equal(confirmed.body.billerCode, '123456');
    assert.equal(confirmed.body.customerReference, '0123456789');
    assert.equal(confirmed.body.destinationAccountNumber, null);
    assert.equal(confirmed.body.payId, null);
    assert.deepEqual(await paymentState([joint.id]), {
      accounts: [{ id: joint.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS - 7_500 }],
      transferCount: 0,
      paymentCount: 1,
    });
    const persisted = await prisma.payment.findUnique({ where: { id: confirmed.body.id } });
    assert.equal(persisted.customerId, coOwner.customer.id);
    assert.equal(persisted.transferId, null);

    const primaryHistory = await primary.client.request(`/api/accounts/${joint.id}/transactions`);
    const coOwnerHistory = await coOwner.client.request(`/api/accounts/${joint.id}/transactions`);
    assertJson(primaryHistory, 200);
    assert.deepEqual(coOwnerHistory.body, primaryHistory.body);
    assert.deepEqual(primaryHistory.body.transactions.map((entry) => ({
      id: entry.id,
      method: entry.method,
      direction: entry.direction,
      amountCents: entry.amountCents,
      counterpartyAccountNumber: entry.counterpartyAccountNumber,
      counterpartyLabel: entry.counterpartyLabel,
      customerReference: entry.customerReference,
    })), [{
      id: confirmed.body.id,
      method: 'BPAY',
      direction: 'SENT',
      amountCents: 7_500,
      counterpartyAccountNumber: null,
      counterpartyLabel: 'Example Energy',
      customerReference: '0123456789',
    }]);
  });

  test('invalid, missing, self, foreign-source, and unfunded payments are atomic', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'payment-negative-owner' });
    const other = await createAuthenticatedCustomer({ suffix: 'payment-negative-other' });
    const source = await createAccount(owner.client, 'EVERYDAY', 'Payment source');
    const ownedDestination = await createAccount(owner.client, 'SAVINGS', 'Also mine');
    const foreignDestination = await createAccount(other.client, 'BUSINESS', 'Other account');
    await createPayId(foreignDestination.id);
    await createPayId(source.id, { value: 'self.payid@example.test', displayName: 'Self PayID' });
    await createPayId(foreignDestination.id, {
      value: 'inactive.payid@example.test',
      displayName: 'Inactive PayID',
      isActive: false,
    });
    await createBpayBiller();
    await createBpayBiller({ billerCode: '99999', name: 'Inactive Biller', referenceLength: 8, isActive: false });
    const baseline = await paymentState([source.id, ownedDestination.id, foreignDestination.id]);
    const bankBase = {
      method: 'BANK_ACCOUNT',
      sourceAccountId: source.id,
      destinationAccountNumber: foreignDestination.accountNumber,
      amountCents: 100,
    };
    const cases = [
      { actor: owner.client, status: 400, body: { ...bankBase, amountCents: 0 } },
      { actor: owner.client, status: 400, body: { ...bankBase, amountCents: 1.5 } },
      { actor: owner.client, status: 400, body: { ...bankBase, description: 'x'.repeat(141) } },
      { actor: owner.client, status: 400, body: { ...bankBase, payId: 'irrelevant@example.test' } },
      { actor: owner.client, status: 404, body: { ...bankBase, sourceAccountId: 'missing-source' } },
      { actor: owner.client, status: 404, body: { ...bankBase, destinationAccountNumber: 'EXB-MISSING' } },
      { actor: owner.client, status: 400, body: { ...bankBase, destinationAccountNumber: ownedDestination.accountNumber } },
      { actor: owner.client, status: 409, body: { ...bankBase, amountCents: EXPECTED_OPENING_BALANCE_CENTS + 1 } },
      { actor: owner.client, status: 404, body: { method: 'PAYID', sourceAccountId: source.id, payId: 'missing@example.test', amountCents: 100 } },
      { actor: owner.client, status: 404, body: { method: 'PAYID', sourceAccountId: source.id, payId: 'inactive.payid@example.test', amountCents: 100 } },
      { actor: owner.client, status: 400, body: { method: 'PAYID', sourceAccountId: source.id, payId: 'self.payid@example.test', amountCents: 100 } },
      { actor: owner.client, status: 404, body: { method: 'BPAY', sourceAccountId: source.id, billerCode: '11111', customerReference: '12345678', amountCents: 100 } },
      { actor: owner.client, status: 404, body: { method: 'BPAY', sourceAccountId: source.id, billerCode: '99999', customerReference: '12345678', amountCents: 100 } },
      { actor: owner.client, status: 400, body: { method: 'BPAY', sourceAccountId: source.id, billerCode: '123456', customerReference: '1234ABC890', amountCents: 100 } },
      { actor: owner.client, status: 400, body: { method: 'BPAY', sourceAccountId: source.id, billerCode: '123456', customerReference: '123456789', amountCents: 100 } },
      { actor: other.client, status: 403, body: { ...bankBase, customerId: owner.customer.id } },
    ];
    for (const scenario of cases) {
      const result = await scenario.actor.request('/api/payments', { method: 'POST', body: scenario.body });
      assertJson(result, scenario.status);
      assert.deepEqual(Object.keys(result.body), ['error']);
      assert.deepEqual(await paymentState([source.id, ownedDestination.id, foreignDestination.id]), baseline);
    }
    assert.deepEqual((await owner.client.request(`/api/accounts/${source.id}/transactions`)).body, { transactions: [] });
    assert.deepEqual((await other.client.request(`/api/accounts/${foreignDestination.id}/transactions`)).body, { transactions: [] });
  });

  test('new feature mutations require an exact trusted Origin and have no rejected-request side effects', async () => {
    const actor = await createAuthenticatedCustomer({ suffix: 'feature-origin-actor' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'feature-origin-recipient' });
    const source = await createAccount(actor.client, 'EVERYDAY');
    const destination = await createAccount(recipient.client, 'SAVINGS');
    const card = await actor.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: source.id },
    });
    assert.equal(card.response.status, 201);
    const profileBefore = await prisma.customer.findUnique({ where: { id: actor.customer.id } });

    const mutationRequests = [
      {
        method: 'PUT',
        path: '/api/profile',
        body: { firstName: 'Origin', lastName: 'Rejected', address: 'No change' },
      },
      {
        method: 'POST',
        path: '/api/scheduled-transfers',
        body: {
          sourceAccountId: source.id,
          destinationAccountNumber: destination.accountNumber,
          amountCents: 500,
          scheduledFor: '2030-01-15T11:00:00.000Z',
        },
      },
      {
        method: 'POST',
        path: '/api/payments/resolve',
        body: {
          method: 'BANK_ACCOUNT',
          sourceAccountId: source.id,
          destinationAccountNumber: destination.accountNumber,
          amountCents: 500,
        },
      },
      {
        method: 'POST',
        path: '/api/payments',
        body: {
          method: 'BANK_ACCOUNT',
          sourceAccountId: source.id,
          destinationAccountNumber: destination.accountNumber,
          amountCents: 500,
        },
      },
      { method: 'POST', path: '/api/cards', body: { accountId: source.id } },
      { method: 'POST', path: `/api/cards/${card.body.id}/lock` },
      { method: 'POST', path: `/api/cards/${card.body.id}/unlock` },
      { method: 'POST', path: `/api/cards/${card.body.id}/disable` },
    ];
    for (const origin of [null, 'http://localhost:5173.evil.example']) {
      for (const request of mutationRequests) {
        const rejected = await actor.client.request(request.path, {
          method: request.method,
          body: request.body,
          origin,
        });
        assert.equal(rejected.response.status, 403, `${request.method} ${request.path} with ${origin}`);
        assert.deepEqual(rejected.body, { error: 'Trusted Origin required.' });
      }
    }

    const profileAfter = await prisma.customer.findUnique({ where: { id: actor.customer.id } });
    assert.equal(profileAfter.firstName, profileBefore.firstName);
    assert.equal(profileAfter.lastName, profileBefore.lastName);
    assert.equal(profileAfter.address, profileBefore.address);
    assert.equal(await prisma.scheduledTransfer.count(), 0);
    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.card.count(), 1);
    assert.equal(await prisma.cardTransaction.count(), 5);
    assert.equal((await prisma.card.findUnique({ where: { id: card.body.id } })).status, 'ACTIVE');
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), {
      accounts: [
        { id: destination.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS },
        { id: source.id, balanceCents: EXPECTED_OPENING_BALANCE_CENTS },
      ].sort((left, right) => left.id.localeCompare(right.id)),
      transferCount: 0,
    });
  });

  test('scheduled transfers are private, reserve no funds, support joint sources, and complete exactly once when ticked', async () => {
    const primary = await createAuthenticatedCustomer({
      suffix: 'schedule-primary',
      email: 'schedule.primary@example.test',
    });
    const coOwner = await createAuthenticatedCustomer({
      suffix: 'schedule-coowner',
      email: 'schedule.coowner@example.test',
    });
    const recipient = await createAuthenticatedCustomer({ suffix: 'schedule-recipient' });
    const source = await createJointAccount(primary.client, coOwner.customer.email, 'EVERYDAY');
    const destination = await createAccount(recipient.client, 'SAVINGS');
    const baseline = await balancesAndTransferCount([source.id, destination.id]);

    const created = await coOwner.client.request('/api/scheduled-transfers', {
      method: 'POST',
      body: {
        customerId: primary.customer.id,
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber.toLowerCase(),
        amountCents: 12_345,
        description: '  Future joint payment  ',
        scheduledFor: '2030-01-15T11:00:00.000Z',
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, 'PENDING');
    assert.equal(created.body.amountCents, 12_345);
    assert.equal(created.body.description, 'Future joint payment');
    assert.equal(created.body.scheduledFor, '2030-01-15T11:00:00.000Z');
    assert.equal(created.body.sourceAccountNumber, source.accountNumber);
    assert.equal(created.body.destinationAccountNumber, destination.accountNumber);
    assert.equal(created.body.failureReason, null);
    assert.equal(created.body.transferId, null);
    assert.equal('customerId' in created.body, false);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), baseline);

    const creatorList = await coOwner.client.request('/api/scheduled-transfers');
    assert.deepEqual(creatorList.body, { scheduledTransfers: [created.body] });
    const primaryList = await primary.client.request('/api/scheduled-transfers');
    const recipientList = await recipient.client.request('/api/scheduled-transfers');
    assert.deepEqual(primaryList.body, { scheduledTransfers: [] });
    assert.deepEqual(recipientList.body, { scheduledTransfers: [] });

    testNow = new Date('2030-01-15T11:00:00.001Z');
    assert.deepEqual(await processDueScheduledTransfers(), ['COMPLETED']);
    const completedState = await balancesAndTransferCount([source.id, destination.id]);
    assert.equal(completedState.transferCount, 1);
    assert.deepEqual(
      Object.fromEntries(completedState.accounts.map((account) => [account.id, account.balanceCents])),
      {
        [source.id]: EXPECTED_OPENING_BALANCE_CENTS - 12_345,
        [destination.id]: EXPECTED_OPENING_BALANCE_CENTS + 12_345,
      },
    );
    const completed = await coOwner.client.request('/api/scheduled-transfers');
    assert.equal(completed.body.scheduledTransfers[0].status, 'COMPLETED');
    assert.equal(completed.body.scheduledTransfers[0].failureReason, null);
    assert.equal(completed.body.scheduledTransfers[0].processedAt, testNow.toISOString());
    assert.match(completed.body.scheduledTransfers[0].transferId, /^[0-9a-f-]{36}$/);

    assert.deepEqual(await processDueScheduledTransfers(), []);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), completedState);
    const history = await coOwner.client.request(`/api/accounts/${source.id}/transactions`);
    assert.equal(history.body.transactions.length, 1);
    assert.equal(history.body.transactions[0].id, completed.body.scheduledTransfers[0].transferId);
  });

  test('scheduled transfers fail once when funds are insufficient at execution and never create partial effects', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'schedule-failure-owner' });
    const recipient = await createAuthenticatedCustomer({ suffix: 'schedule-failure-recipient' });
    const source = await createAccount(owner.client, 'EVERYDAY');
    const destination = await createAccount(recipient.client, 'SAVINGS');
    const drainDestination = await createAccount(recipient.client, 'BUSINESS');

    const scheduled = await owner.client.request('/api/scheduled-transfers', {
      method: 'POST',
      body: {
        sourceAccountId: source.id,
        destinationAccountNumber: destination.accountNumber,
        amountCents: 1_000,
        scheduledFor: '2030-01-15T11:00:00.000Z',
      },
    });
    assert.equal(scheduled.response.status, 201);
    const drained = await owner.client.request('/api/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: source.id,
        destinationAccountNumber: drainDestination.accountNumber,
        amountCents: EXPECTED_OPENING_BALANCE_CENTS - 500,
      },
    });
    assert.equal(drained.response.status, 201);
    const beforeTick = await balancesAndTransferCount([source.id, destination.id, drainDestination.id]);

    testNow = new Date('2030-01-15T12:00:00.000Z');
    assert.deepEqual(await processDueScheduledTransfers(), ['FAILED']);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id, drainDestination.id]), beforeTick);
    const failed = await owner.client.request('/api/scheduled-transfers');
    assert.equal(failed.body.scheduledTransfers[0].status, 'FAILED');
    assert.equal(failed.body.scheduledTransfers[0].failureReason, 'INSUFFICIENT_FUNDS');
    assert.equal(failed.body.scheduledTransfers[0].transferId, null);
    assert.equal(failed.body.scheduledTransfers[0].processedAt, testNow.toISOString());

    testNow = new Date('2030-01-16T12:00:00.000Z');
    assert.deepEqual(await processDueScheduledTransfers(), []);
    assert.deepEqual(await balancesAndTransferCount([source.id, destination.id, drainDestination.id]), beforeTick);
  });

  test('invalid, missing, self, foreign, past, and unfunded schedules persist nothing', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'schedule-negative-owner' });
    const other = await createAuthenticatedCustomer({ suffix: 'schedule-negative-other' });
    const source = await createAccount(owner.client, 'EVERYDAY');
    const destination = await createAccount(other.client, 'SAVINGS');
    const baseline = await balancesAndTransferCount([source.id, destination.id]);
    const valid = {
      sourceAccountId: source.id,
      destinationAccountNumber: destination.accountNumber,
      amountCents: 100,
      scheduledFor: '2030-01-15T11:00:00.000Z',
    };
    const scenarios = [
      { actor: owner.client, status: 400, body: { ...valid, amountCents: 1.5 } },
      { actor: owner.client, status: 400, body: { ...valid, scheduledFor: '2030-01-15T11:00:00Z' } },
      { actor: owner.client, status: 400, body: { ...valid, scheduledFor: testNow.toISOString() } },
      { actor: other.client, status: 403, body: valid },
      { actor: owner.client, status: 404, body: { ...valid, sourceAccountId: 'missing-source' } },
      { actor: owner.client, status: 404, body: { ...valid, destinationAccountNumber: 'EXB-000000000' } },
      { actor: owner.client, status: 400, body: { ...valid, destinationAccountNumber: source.accountNumber } },
      { actor: owner.client, status: 409, body: { ...valid, amountCents: EXPECTED_OPENING_BALANCE_CENTS + 1 } },
    ];
    for (const scenario of scenarios) {
      const rejected = await scenario.actor.request('/api/scheduled-transfers', {
        method: 'POST',
        body: scenario.body,
      });
      assert.equal(rejected.response.status, scenario.status, JSON.stringify(rejected.body));
      assert.deepEqual(Object.keys(rejected.body), ['error']);
      assert.equal(await prisma.scheduledTransfer.count(), 0);
      assert.deepEqual(await balancesAndTransferCount([source.id, destination.id]), baseline);
    }
  });

  test('card creation is holder-private, supports personal and joint accounts, and adds exactly five display-only samples', async () => {
    const primary = await createAuthenticatedCustomer({
      suffix: 'card-primary',
      email: 'card.primary@example.test',
    });
    const coOwner = await createAuthenticatedCustomer({
      suffix: 'card-coowner',
      email: 'card.coowner@example.test',
    });
    const personal = await createAccount(primary.client, 'EVERYDAY', 'Personal spending');
    const joint = await createJointAccount(primary.client, coOwner.customer.email, 'SAVINGS', 'Shared spending');
    const balancesBefore = await balancesAndTransferCount([personal.id, joint.id]);

    const personalCard = await primary.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: personal.id },
    });
    const primaryJointCard = await primary.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: joint.id },
    });
    const coOwnerJointCard = await coOwner.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: joint.id },
    });
    for (const created of [personalCard, primaryJointCard, coOwnerJointCard]) {
      assert.equal(created.response.status, 201);
      assert.equal(created.body.status, 'ACTIVE');
      assert.equal(created.body.maskedNumber, '•••• 4242');
      assert.equal('lastFour' in created.body, false);
      assert.equal('customerId' in created.body, false);
      assert.equal(created.body.transactions.length, 5);
      assert.deepEqual(
        created.body.transactions.map(({ sampleSequence, merchant, amountCents }) => ({ sampleSequence, merchant, amountCents })),
        [
          { sampleSequence: 1, merchant: 'Corner Cafe', amountCents: 875 },
          { sampleSequence: 2, merchant: 'City Grocer', amountCents: 4_260 },
          { sampleSequence: 3, merchant: 'Metro Transit', amountCents: 520 },
          { sampleSequence: 4, merchant: 'Book & Paper', amountCents: 2_199 },
          { sampleSequence: 5, merchant: 'Harbour Pharmacy', amountCents: 1_635 },
        ],
      );
      const serialized = JSON.stringify(created.body);
      for (const sensitive of ['passwordHash', 'token', 'cvv', 'pin']) assert.doesNotMatch(serialized, new RegExp(sensitive, 'i'));
      for (const rawCardField of ['pan', 'cardNumber', 'fullNumber']) {
        assert.equal(rawCardField in created.body, false);
      }
    }
    assert.equal(await prisma.card.count(), 3);
    assert.equal(await prisma.cardTransaction.count(), 15);
    assert.deepEqual(await balancesAndTransferCount([personal.id, joint.id]), balancesBefore);
    assert.deepEqual((await primary.client.request(`/api/accounts/${personal.id}/transactions`)).body, { transactions: [] });
    assert.deepEqual((await primary.client.request(`/api/accounts/${joint.id}/transactions`)).body, { transactions: [] });

    const primaryList = await primary.client.request('/api/cards');
    const coOwnerList = await coOwner.client.request('/api/cards');
    assert.deepEqual(
      new Set(primaryList.body.cards.map(({ id }) => id)),
      new Set([personalCard.body.id, primaryJointCard.body.id]),
    );
    assert.deepEqual(coOwnerList.body.cards.map(({ id }) => id), [coOwnerJointCard.body.id]);
    const coOwnerCannotRead = await coOwner.client.request(`/api/cards/${primaryJointCard.body.id}`);
    const primaryCannotRead = await primary.client.request(`/api/cards/${coOwnerJointCard.body.id}`);
    assert.equal(coOwnerCannotRead.response.status, 403);
    assert.equal(primaryCannotRead.response.status, 403);
    const coOwnerCannotMutate = await coOwner.client.request(`/api/cards/${primaryJointCard.body.id}/lock`, { method: 'POST' });
    assert.equal(coOwnerCannotMutate.response.status, 403);
    assert.equal((await prisma.card.findUnique({ where: { id: primaryJointCard.body.id } })).status, 'ACTIVE');
  });

  test('card lock, unlock, and permanent disable transitions persist and reject repeated or invalid changes', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'card-state-owner' });
    const account = await createAccount(owner.client, 'EVERYDAY');
    const created = await owner.client.request('/api/cards', {
      method: 'POST',
      body: { accountId: account.id },
    });
    const path = `/api/cards/${created.body.id}`;

    const locked = await owner.client.request(`${path}/lock`, { method: 'POST' });
    assert.equal(locked.response.status, 200);
    assert.equal(locked.body.status, 'LOCKED');
    assert.equal((await owner.client.request(path)).body.status, 'LOCKED');
    const repeatedLock = await owner.client.request(`${path}/lock`, { method: 'POST' });
    assert.equal(repeatedLock.response.status, 409);

    const unlocked = await owner.client.request(`${path}/unlock`, { method: 'POST' });
    assert.equal(unlocked.response.status, 200);
    assert.equal(unlocked.body.status, 'ACTIVE');
    const repeatedUnlock = await owner.client.request(`${path}/unlock`, { method: 'POST' });
    assert.equal(repeatedUnlock.response.status, 409);

    const disabled = await owner.client.request(`${path}/disable`, { method: 'POST' });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.status, 'DISABLED');
    for (const action of ['lock', 'unlock', 'disable']) {
      const rejected = await owner.client.request(`${path}/${action}`, { method: 'POST' });
      assert.equal(rejected.response.status, 409, action);
    }
    assert.equal((await prisma.card.findUnique({ where: { id: created.body.id } })).status, 'DISABLED');
    assert.equal(await prisma.cardTransaction.count({ where: { cardId: created.body.id } }), 5);
  });

  test('invalid and unauthorized card creation is atomic', async () => {
    const owner = await createAuthenticatedCustomer({ suffix: 'card-negative-owner' });
    const other = await createAuthenticatedCustomer({ suffix: 'card-negative-other' });
    const ownerAccount = await createAccount(owner.client, 'EVERYDAY');
    const otherAccount = await createAccount(other.client, 'SAVINGS');
    const balancesBefore = await balancesAndTransferCount([ownerAccount.id, otherAccount.id]);
    const scenarios = [
      { status: 400, body: {} },
      { status: 400, body: { accountId: ' ' } },
      { status: 404, body: { accountId: 'missing-account' } },
      { status: 403, body: { accountId: otherAccount.id } },
    ];
    for (const scenario of scenarios) {
      const rejected = await owner.client.request('/api/cards', { method: 'POST', body: scenario.body });
      assert.equal(rejected.response.status, scenario.status, JSON.stringify(rejected.body));
      assert.deepEqual(Object.keys(rejected.body), ['error']);
      assert.equal(await prisma.card.count(), 0);
      assert.equal(await prisma.cardTransaction.count(), 0);
      assert.deepEqual(await balancesAndTransferCount([ownerAccount.id, otherAccount.id]), balancesBefore);
    }
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
