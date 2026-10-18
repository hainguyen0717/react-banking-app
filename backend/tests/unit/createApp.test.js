const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  createApp,
  createDefaultServices,
  createRequestLogger,
  resolveCorsOrigin,
  handleUnhandledApiError,
  DELAY_SETTING_VALIDATION_ERROR,
  CORS_ALLOWED_HEADERS,
  SWAGGER_UI_OPTIONS,
} = require('../../src/createApp');

async function invokeRoute(app, path, method, { headers = {}, body = {}, params = {} } = {}) {
  const routeLayer = app._router.stack.find((candidate) => candidate.route?.path === path && candidate.route.methods[method]);
  assert(routeLayer, `${method.toUpperCase()} ${path} should be registered`);
  const req = { method: method.toUpperCase(), headers: { 'content-type': 'application/json', ...headers }, body, params };
  const res = {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    redirect(code, location) { this.statusCode = code; this.headers.Location = location; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
  const run = async (index) => {
    const handler = routeLayer.route.stack[index]?.handle;
    if (!handler) return;
    let nextPromise;
    const next = (error) => {
      nextPromise = error ? Promise.reject(error) : run(index + 1);
      return nextPromise;
    };
    await handler(req, res, next);
    if (nextPromise) await nextPromise;
  };
  await run(0);
  return { req, res };
}

function checkCorsOrigin(origin) {
  return new Promise((resolve, reject) => {
    resolveCorsOrigin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test('CORS allows only the two exact local frontend origins', async () => {
  assert.deepEqual(CORS_ALLOWED_HEADERS, ['Authorization', 'Content-Type', 'X-Test-Delay-Ticket']);
  assert.equal(await checkCorsOrigin('http://localhost:5173'), true);
  assert.equal(await checkCorsOrigin('http://127.0.0.1:5173'), true);
  assert.equal(await checkCorsOrigin(undefined), true);
  assert.equal(await checkCorsOrigin('http://localhost:5174'), false);
  assert.equal(await checkCorsOrigin('http://127.0.0.1:3000'), false);
  assert.equal(await checkCorsOrigin('http://example.com'), false);
  assert.equal(await checkCorsOrigin('http://localhost:5173.evil.example'), false);
});

test('delay controls are public, origin-protected on mutation, and reject invalid updates atomically', async () => {
  const app = createApp({ prisma: {}, logger: { info: () => {}, error: () => {} } });
  const getLayer = app._router.stack.find((layer) => layer.route?.path === '/api/test-controls/delay' && layer.route.methods.get);
  const putLayer = app._router.stack.find((layer) => layer.route?.path === '/api/test-controls/delay' && layer.route.methods.put);
  const sampleLayer = app._router.stack.find((layer) => layer.route?.path === '/api/test-controls/delay/sample' && layer.route.methods.post);
  const apiDelayLayer = app._router.stack.find((layer) => !layer.route && String(layer.regexp).includes('api'));
  assert(getLayer, 'GET delay control should be registered');
  assert(putLayer, 'PUT delay control should be registered');
  assert(sampleLayer, 'POST delay sample control should be registered');
  assert(apiDelayLayer, 'ordinary API delay middleware should be mounted');
  assert.equal(getLayer.route.stack.length, 1, 'GET control should not require authentication');
  assert.equal(putLayer.route.stack.length, 3, 'PUT control should require trusted origin and JSON Content-Type');
  assert(app._router.stack.indexOf(getLayer) < app._router.stack.indexOf(apiDelayLayer));
  assert(app._router.stack.indexOf(putLayer) < app._router.stack.indexOf(apiDelayLayer));
  assert(app._router.stack.indexOf(sampleLayer) < app._router.stack.indexOf(apiDelayLayer));

  const initial = await invokeRoute(app, '/api/test-controls/delay', 'get');
  assert.deepEqual(initial.res.body, { minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });

  const forbidden = await invokeRoute(app, '/api/test-controls/delay', 'put', {
    body: { minSeconds: 2, maxSeconds: 4, scope: 'API' },
  });
  assert.equal(forbidden.res.statusCode, 403);

  const saved = await invokeRoute(app, '/api/test-controls/delay', 'put', {
    headers: { origin: 'http://localhost:5173' },
    body: { minSeconds: 2, maxSeconds: 4, scope: 'API' },
  });
  assert.equal(saved.res.statusCode, 200);
  assert.deepEqual(saved.res.body, { minSeconds: 2, maxSeconds: 4, scope: 'API' });

  const sample = await invokeRoute(app, '/api/test-controls/delay/sample', 'post', {
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(sample.res.statusCode, 200);
  assert.equal(typeof sample.res.body.ticket, 'string');
  assert.equal(Number.isInteger(sample.res.body.sampledSeconds), true);
  assert.equal(sample.res.headers['Cache-Control'], 'no-store');

  const invalid = await invokeRoute(app, '/api/test-controls/delay', 'put', {
    headers: { origin: 'http://localhost:5173' },
    body: { minSeconds: 5, maxSeconds: 4, scope: 'UI' },
  });
  assert.equal(invalid.res.statusCode, 400);
  assert.match(invalid.res.body.error, /minSeconds no greater than maxSeconds/);
  const unchanged = await invokeRoute(app, '/api/test-controls/delay', 'get');
  assert.deepEqual(unchanged.res.body, { minSeconds: 2, maxSeconds: 4, scope: 'API' });
});

test('JSON parser client errors remain 400 without masking unrelated internal errors', () => {
  const messages = [];
  const logger = { error: (...args) => messages.push(args) };
  const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  });
  const parserError = Object.assign(new SyntaxError('Unexpected token'), {
    status: 400,
    type: 'entity.parse.failed',
  });

  const delayResponse = createResponse();
  handleUnhandledApiError(
    parserError,
    { method: 'PUT', path: '/api/test-controls/delay' },
    delayResponse,
    logger,
  );
  assert.equal(delayResponse.statusCode, 400);
  assert.deepEqual(delayResponse.body, { error: DELAY_SETTING_VALIDATION_ERROR });

  const ordinaryResponse = createResponse();
  handleUnhandledApiError(
    parserError,
    { method: 'POST', path: '/api/accounts' },
    ordinaryResponse,
    logger,
  );
  assert.equal(ordinaryResponse.statusCode, 400);
  assert.deepEqual(ordinaryResponse.body, { error: 'Invalid JSON request body.' });
  assert.equal(messages.length, 0, 'expected client parse errors should not be logged as internal failures');

  const internalResponse = createResponse();
  const internalError = new Error('database unavailable');
  handleUnhandledApiError(
    internalError,
    { method: 'GET', path: '/api/accounts' },
    internalResponse,
    logger,
  );
  assert.equal(internalResponse.statusCode, 500);
  assert.deepEqual(internalResponse.body, { error: 'Internal server error.' });
  assert.deepEqual(messages, [['Unhandled API error', internalError]]);
});

test('request logging records only the path and never query values', () => {
  const messages = [];
  const res = new EventEmitter();
  res.statusCode = 200;
  createRequestLogger({ info: (message) => messages.push(message), error: () => {} })(
    { method: 'GET', path: '/api/accounts', originalUrl: '/api/accounts?token=secret-value' },
    res,
    () => {},
  );
  res.emit('finish');
  assert.match(messages[0], /^GET \/api\/accounts -> 200/);
  assert.doesNotMatch(messages[0], /secret-value|token=/);
});

test('Swagger UI is public, canonical, and loads the active raw contract with cookie credentials', async () => {
  const app = createApp({ prisma: {}, logger: { info: () => {}, error: () => {} } });
  const stack = app._router.stack;
  const contractIndex = stack.findIndex((layer) => layer.route?.path === '/docs/openapi.json');
  const redirectLayer = stack.find((layer) => layer.route && layer.match('/docs') && !layer.match('/docs/'));
  const docsMiddlewareIndex = stack.findIndex((layer) => !layer.route && String(layer.regexp).includes('docs'));
  const docsMiddleware = stack.filter((layer) => !layer.route && String(layer.regexp).includes('docs'));
  assert(contractIndex >= 0);
  assert(redirectLayer, 'slashless /docs must have an exact redirect route');
  assert(docsMiddlewareIndex > contractIndex, 'raw OpenAPI JSON must be registered before Swagger middleware');
  assert.equal(stack[contractIndex].route.stack.length, 1, 'raw documentation route must be public');
  assert.equal(redirectLayer.route.stack.length, 1, 'UI redirect must be public');
  assert.equal(redirectLayer.match('/docs'), true);
  assert.equal(redirectLayer.match('/docs/'), false, 'canonical /docs/ must not redirect to itself');
  assert(docsMiddleware.every((layer) => layer.match('/docs/')), 'canonical /docs/ must reach Swagger middleware');
  assert.equal(docsMiddleware.length, 3);
  assert.deepEqual(SWAGGER_UI_OPTIONS.swaggerOptions, {
    url: '/docs/openapi.json',
    withCredentials: true,
    persistAuthorization: false,
  });

  const contract = await invokeRoute(app, '/docs/openapi.json', 'get');
  assert.equal(contract.res.body.openapi, '3.0.3');
  const redirectResponse = {
    statusCode: 200,
    headers: {},
    redirect(code, location) { this.statusCode = code; this.headers.Location = location; return this; },
  };
  await redirectLayer.route.stack[0].handle({}, redirectResponse);
  assert.equal(redirectResponse.statusCode, 308);
  assert.equal(redirectResponse.headers.Location, '/docs/');

  const uiResponse = {
    body: null,
    send(value) { this.body = value; return this; },
  };
  docsMiddleware.at(-1).handle({}, uiResponse, () => {});
  assert.match(uiResponse.body, /<div id="swagger-ui"><\/div>/);

  const initResponse = {
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    send(value) { this.body = value; return this; },
  };
  docsMiddleware[0].handle({ url: '/swagger-ui-init.js' }, initResponse, () => {});
  assert.match(initResponse.body, /"url"\s*:\s*"\/docs\/openapi\.json"/);
  assert.match(initResponse.body, /"withCredentials"\s*:\s*true/);
  assert.match(initResponse.body, /"persistAuthorization"\s*:\s*false/);
  assert.doesNotMatch(JSON.stringify(SWAGGER_UI_OPTIONS.swaggerOptions), /eb_session|password|bearer|authorization\s*:/i);
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
        return { id: 'account-1', customerId: 'customer-1', coOwnerCustomerId: null };
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

test('default service wiring exposes joint account creation', () => {
  const services = createDefaultServices({ customer: {}, account: {}, transfer: {} });
  assert.equal(typeof services.createJointAccount, 'function');
});

test('createApp service overrides remain independent from default wiring', async () => {
  const prisma = {
    customer: { findUnique: async () => { throw new Error('default customer service should not run'); } },
  };
  const override = async () => ({ id: 'override-customer' });
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma,
    services: {
      authenticateCustomer: override,
      createSession: async () => ({ token: 'A'.repeat(43), session: { id: 'session-1', absoluteExpiresAt: new Date(Date.now() + 60_000) } }),
    },
    logger: { info: () => {}, error: () => {} },
  });

  const loginLayer = app._router.stack.find((layer) => layer.route?.path === '/api/login');
  assert(loginLayer, 'login route should be registered');

  const { res: response } = await invokeRoute(app, '/api/login', 'post', {
    headers: { origin: 'http://localhost:5173' },
    body: { email: 'override@example.com', password: 'password' },
  });

  assert.deepEqual(response.body, {
    customer: { id: 'override-customer' },
    accessToken: 'A'.repeat(43),
    tokenType: 'Bearer',
    expiresAt: response.body.expiresAt,
  });
  assert.match(response.body.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.headers['Cache-Control'], 'no-store, no-cache, must-revalidate');
  assert.equal(response.headers.Pragma, 'no-cache');
  assert.equal(response.statusCode, 200);
});

test('protected routes derive the actor from req.auth and expose no customer-id route bypass', async () => {
  let receivedCustomerId;
  let receivedTransfer;
  const auth = { session: { id: 'session-1' }, customer: { id: 'verified-customer' } };
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {} },
    services: {
      resolveSession: async () => auth,
      listAccounts: async (customerId) => { receivedCustomerId = customerId; return []; },
      transferMoney: async (input) => { receivedTransfer = input; return { id: 'transfer-1' }; },
    },
    logger: { info: () => {}, error: () => {} },
  });

  const paths = app._router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert(paths.includes('/api/accounts'));
  assert(paths.includes('/api/joint-accounts'));
  assert(paths.includes('/api/accounts/:accountId/transactions'));
  assert(!paths.some((path) => String(path).includes(':customerId')));
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/login').route.stack.length, 3);
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/customers').route.stack.length, 3);
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/accounts' && layer.route.methods.get).route.stack.length, 2);
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/accounts' && layer.route.methods.post).route.stack.length, 4);

  const authenticatedHeaders = { cookie: `eb_session=${'A'.repeat(43)}`, origin: 'http://localhost:5173' };
  await invokeRoute(app, '/api/accounts', 'get', { headers: authenticatedHeaders });
  await invokeRoute(app, '/api/transfers', 'post', {
    headers: authenticatedHeaders,
    body: { customerId: 'spoofed-customer', sourceAccountId: 'account-1', destinationAccountNumber: 'EXB-2', amountCents: 1 },
  });
  assert.equal(receivedCustomerId, 'verified-customer');
  assert.equal(receivedTransfer.customerId, 'verified-customer');
});

test('logout revokes only req.auth.session and clears the cookie', async () => {
  let deletedSessionId;
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {} },
    services: {
      resolveSession: async () => ({ session: { id: 'current-session' }, customer: { id: 'customer-1' } }),
      deleteSession: async (sessionId) => { deletedSessionId = sessionId; },
    },
    logger: { info: () => {}, error: () => {} },
  });
  const { res } = await invokeRoute(app, '/api/logout', 'post', {
    headers: { cookie: `eb_session=${'A'.repeat(43)}`, origin: 'http://localhost:5173' },
  });
  assert.equal(deletedSessionId, 'current-session');
  assert.equal(res.statusCode, 204);
  assert.match(res.headers['Set-Cookie'], /^eb_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
});

test('bearer logout revokes the selected bearer session without clearing a separate browser cookie', async () => {
  const bearerToken = 'B'.repeat(43);
  const cookieToken = 'C'.repeat(43);
  let deletedSessionId;
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {} },
    services: {
      resolveSession: async (token) => ({
        session: { id: token === bearerToken ? 'bearer-session' : 'cookie-session' },
        customer: { id: 'customer-1' },
      }),
      deleteSession: async (sessionId) => { deletedSessionId = sessionId; },
    },
    logger: { info: () => {}, error: () => {} },
  });

  const { req, res } = await invokeRoute(app, '/api/logout', 'post', {
    headers: { authorization: `Bearer ${bearerToken}`, cookie: `eb_session=${cookieToken}` },
  });
  assert.equal(req.auth.method, 'bearer');
  assert.equal(deletedSessionId, 'bearer-session');
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Set-Cookie'], undefined);

  const matching = await invokeRoute(app, '/api/logout', 'post', {
    headers: { authorization: `Bearer ${bearerToken}`, cookie: `eb_session=${bearerToken}` },
  });
  assert.match(matching.res.headers['Set-Cookie'], /^eb_session=; Path=\/; HttpOnly/);
});

test('required-body routes reject unsupported media types while bodyless actions do not require one', async () => {
  let createdAccounts = 0;
  let lockedCards = 0;
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {}, card: {} },
    services: {
      resolveSession: async () => ({ session: { id: 'session-1' }, customer: { id: 'customer-1' } }),
      createAccount: async () => { createdAccounts += 1; return {}; },
      lockCard: async () => { lockedCards += 1; return {}; },
    },
    logger: { info: () => {}, error: () => {} },
  });
  const token = 'A'.repeat(43);
  const unsupported = await invokeRoute(app, '/api/accounts', 'post', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: { type: 'EVERYDAY' },
  });
  assert.equal(unsupported.res.statusCode, 415);
  assert.deepEqual(unsupported.res.body, { error: 'Content-Type must be application/json.' });
  assert.equal(createdAccounts, 0);

  const bodyless = await invokeRoute(app, '/api/cards/:cardId/lock', 'post', {
    headers: { authorization: `Bearer ${token}`, 'content-type': undefined },
    params: { cardId: 'card-1' },
  });
  assert.equal(bodyless.res.statusCode, 200);
  assert.equal(lockedCards, 1);
});

test('protected mutations authenticate before trusted-origin checks while public mutations still require origin', async () => {
  let protectedHandlerCalls = 0;
  let publicHandlerCalls = 0;
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {} },
    services: {
      resolveSession: async () => ({ session: { id: 'session-1' }, customer: { id: 'customer-1' } }),
      createAccount: async () => { protectedHandlerCalls += 1; return {}; },
      createCustomer: async () => { publicHandlerCalls += 1; return {}; },
    },
    logger: { info: () => {}, error: () => {} },
  });

  const unauthenticated = await invokeRoute(app, '/api/accounts', 'post', { body: { type: 'EVERYDAY' } });
  assert.equal(unauthenticated.res.statusCode, 401);
  assert.deepEqual(unauthenticated.res.body, { error: 'Authentication required.' });

  for (const origin of [undefined, 'http://localhost:5173.evil.example']) {
    const headers = { cookie: `eb_session=${'A'.repeat(43)}` };
    if (origin) headers.origin = origin;
    const result = await invokeRoute(app, '/api/accounts', 'post', { headers, body: { type: 'EVERYDAY' } });
    assert.equal(result.res.statusCode, 403);
    assert.deepEqual(result.res.body, { error: 'Trusted Origin required.' });
  }
  assert.equal(protectedHandlerCalls, 0);

  const publicWithoutOrigin = await invokeRoute(app, '/api/customers', 'post', { body: {} });
  assert.equal(publicWithoutOrigin.res.statusCode, 403);
  assert.equal(publicHandlerCalls, 0);

  const publicAllowed = await invokeRoute(app, '/api/customers', 'post', {
    headers: { origin: 'http://localhost:5173' }, body: {},
  });
  assert.equal(publicAllowed.res.statusCode, 201);
  assert.equal(publicHandlerCalls, 1);
});

test('profile, schedule and card routes use verified actor identity and preserve mutation-origin ordering', async () => {
  const calls = [];
  const { createApp } = require('../../src/createApp');
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {}, scheduledTransfer: {}, card: {} },
    services: {
      resolveSession: async () => ({ session: { id: 'session-1' }, customer: { id: 'verified-customer' } }),
      updateProfile: async (customerId) => { calls.push(['profile', customerId]); return { id: customerId }; },
      createScheduledTransfer: async (customerId) => { calls.push(['schedule', customerId]); return { id: 'schedule-1' }; },
      listScheduledTransfers: async (customerId) => { calls.push(['schedules', customerId]); return []; },
      createCard: async (customerId) => { calls.push(['create-card', customerId]); return { id: 'card-1' }; },
      listCards: async (customerId) => { calls.push(['cards', customerId]); return []; },
      getCard: async (customerId) => { calls.push(['card', customerId]); return { id: 'card-1' }; },
      lockCard: async (customerId) => { calls.push(['lock', customerId]); return { id: 'card-1' }; },
    },
    logger: { info: () => {}, error: () => {} },
  });
  const headers = { cookie: `eb_session=${'A'.repeat(43)}`, origin: 'http://localhost:5173' };
  await invokeRoute(app, '/api/profile', 'put', { headers, body: { customerId: 'spoofed' } });
  await invokeRoute(app, '/api/scheduled-transfers', 'post', { headers, body: { customerId: 'spoofed' } });
  await invokeRoute(app, '/api/cards', 'post', { headers, body: { customerId: 'spoofed' } });
  await invokeRoute(app, '/api/cards/:cardId/lock', 'post', { headers, params: { cardId: 'card-1' } });
  assert.deepEqual(calls, [['profile', 'verified-customer'], ['schedule', 'verified-customer'], ['create-card', 'verified-customer'], ['lock', 'verified-customer']]);

  const unauthenticated = await invokeRoute(app, '/api/profile', 'put', { headers: { origin: 'http://localhost:5173' } });
  assert.equal(unauthenticated.res.statusCode, 401);
  const untrusted = await invokeRoute(app, '/api/cards', 'post', { headers: { cookie: `eb_session=${'A'.repeat(43)}` } });
  assert.equal(untrusted.res.statusCode, 403);
});

test('payment resolution and confirmation authenticate first, require trusted origin and ignore spoofed identity', async () => {
  const calls = [];
  const app = createApp({
    prisma: { customer: {}, account: {}, transfer: {}, authSession: {}, payment: {}, payIdDirectoryEntry: {}, bpayBiller: {} },
    services: {
      resolveSession: async () => ({ session: { id: 'session-1' }, customer: { id: 'verified-customer' } }),
      resolvePayment: async (customerId, input) => { calls.push(['resolve', customerId, input]); return { method: 'BPAY' }; },
      createPayment: async (customerId, input) => { calls.push(['create', customerId, input]); return { id: 'payment-1' }; },
    },
    logger: { info: () => {}, error: () => {} },
  });
  const headers = { cookie: `eb_session=${'A'.repeat(43)}`, origin: 'http://localhost:5173' };
  const resolve = await invokeRoute(app, '/api/payments/resolve', 'post', { headers, body: { customerId: 'spoofed', method: 'BPAY' } });
  const create = await invokeRoute(app, '/api/payments', 'post', { headers, body: { customerId: 'spoofed', method: 'BPAY' } });
  assert.equal(resolve.res.statusCode, 200);
  assert.equal(create.res.statusCode, 201);
  assert.deepEqual(calls.map(([name, actor]) => [name, actor]), [['resolve', 'verified-customer'], ['create', 'verified-customer']]);
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/payments/resolve').route.stack.length, 4);
  assert.equal(app._router.stack.find((layer) => layer.route?.path === '/api/payments').route.stack.length, 4);

  const unauthenticated = await invokeRoute(app, '/api/payments', 'post', { headers: { origin: 'http://localhost:5173' } });
  assert.equal(unauthenticated.res.statusCode, 401);
  const untrusted = await invokeRoute(app, '/api/payments', 'post', { headers: { cookie: `eb_session=${'A'.repeat(43)}` } });
  assert.equal(untrusted.res.statusCode, 403);
});
