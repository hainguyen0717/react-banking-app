const assert = require('node:assert/strict');
const test = require('node:test');
const { readSessionCookie, serializeSessionCookie, serializeClearedSessionCookie } = require('../../src/http/sessionCookie');
const {
  BEARER_CHALLENGE,
  readBearerAuthorization,
  createAuthenticateMiddleware,
} = require('../../src/middleware/authenticate');
const { createTrustedOriginMiddleware } = require('../../src/middleware/trustedOrigin');
const {
  JSON_CONTENT_TYPE_ERROR,
  isJsonContentType,
  requireJsonContentType,
} = require('../../src/middleware/requireJsonContentType');

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

test('cookie parsing rejects duplicate session cookies and cookie attributes differ by environment', () => {
  assert.deepEqual(readSessionCookie(undefined), { token: null, presented: false, malformed: false });
  assert.equal(readSessionCookie('a=1; eb_session=token').token, 'token');
  assert.equal(readSessionCookie('eb_session=one; eb_session=two').malformed, true);
  const expiry = new Date('2026-10-14T01:00:00Z');
  const dev = serializeSessionCookie('token', expiry, new Date('2026-10-14T00:00:00Z'), false);
  assert.match(dev, /HttpOnly; SameSite=Lax; Max-Age=3600/);
  assert.doesNotMatch(dev, /Secure/);
  const production = serializeSessionCookie('token', expiry, new Date('2026-10-14T00:00:00Z'), true);
  assert.match(production, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(serializeClearedSessionCookie(true), /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0/);
});

test('authentication middleware rejects missing and malformed cookies and attaches verified auth', async () => {
  let resolveCalls = 0;
  const middleware = createAuthenticateMiddleware({
    resolveSession: async () => { resolveCalls += 1; return { session: { id: 'session-1' }, customer: { id: 'customer-1' } }; },
  });
  for (const cookie of [undefined, 'eb_session=one; eb_session=two']) {
    const res = response();
    let nextCalls = 0;
    await middleware({ headers: { cookie } }, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Authentication required.' });
    assert.equal(res.headers['WWW-Authenticate'], BEARER_CHALLENGE);
    assert.equal(nextCalls, 0);
  }
  assert.equal(resolveCalls, 0);

  const req = { headers: { cookie: 'eb_session=token' } };
  let nextCalls = 0;
  await middleware(req, response(), () => { nextCalls += 1; });
  assert.equal(req.auth.customer.id, 'customer-1');
  assert.equal(req.auth.method, 'cookie');
  assert.equal(nextCalls, 1);
});

test('bearer authorization is authoritative, attaches its auth method and never clears an unrelated cookie', async () => {
  const validToken = 'B'.repeat(43);
  const resolvedTokens = [];
  const middleware = createAuthenticateMiddleware({
    resolveSession: async (token) => {
      resolvedTokens.push(token);
      return token === validToken
        ? { session: { id: 'bearer-session' }, customer: { id: 'customer-1' } }
        : null;
    },
  });

  assert.deepEqual(readBearerAuthorization(undefined), { token: null, presented: false, malformed: false });
  assert.equal(readBearerAuthorization(`bearer ${validToken}`).token, validToken);
  assert.equal(readBearerAuthorization('Basic abc').malformed, true);
  assert.equal(readBearerAuthorization('Bearer one, Bearer two').malformed, true);

  const req = { headers: { authorization: `Bearer ${validToken}`, cookie: `eb_session=${'C'.repeat(43)}` } };
  let nextCalls = 0;
  await middleware(req, response(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(req.auth.method, 'bearer');
  assert.equal(req.auth.cookieMatchesSession, false);
  assert.deepEqual(resolvedTokens, [validToken]);

  for (const authorization of ['Basic anything', `Bearer ${'X'.repeat(43)}`]) {
    const res = response();
    await middleware({ headers: { authorization, cookie: `eb_session=${validToken}` } }, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['WWW-Authenticate'], BEARER_CHALLENGE);
    assert.equal(res.headers['Set-Cookie'], undefined);
  }
  assert.deepEqual(resolvedTokens, [validToken, 'X'.repeat(43)]);
});

test('trusted-origin middleware allows configured and exact request origins plus passive methods', () => {
  const middleware = createTrustedOriginMiddleware(new Set(['http://localhost:5173']));
  const allowed = [
    { method: 'OPTIONS', headers: {} },
    { method: 'GET', headers: {} },
    { method: 'POST', protocol: 'http', headers: { host: 'localhost:3001', origin: 'http://localhost:5173' } },
    { method: 'POST', protocol: 'http', headers: { host: 'localhost:3001', origin: 'http://localhost:3001' } },
    { method: 'POST', auth: { method: 'bearer' }, protocol: 'http', headers: { host: 'localhost:3001' } },
  ];
  for (const req of allowed) {
    let nextCalls = 0;
    middleware(req, response(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
  }
});

test('JSON content-type middleware accepts JSON with an optional UTF-8 charset and rejects other or missing media types', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON; Charset=UTF-8'), true);
  assert.equal(isJsonContentType('application/json; charset="utf-8"'), true);
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType(undefined), false);

  for (const contentType of [undefined, 'text/plain', 'application/json; charset=iso-8859-1']) {
    const res = response();
    let nextCalls = 0;
    requireJsonContentType({ headers: { 'content-type': contentType } }, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 415);
    assert.deepEqual(res.body, { error: JSON_CONTENT_TYPE_ERROR });
    assert.equal(nextCalls, 0);
  }
});

test('trusted-origin middleware strictly rejects malformed, foreign and same-origin lookalike mutations', () => {
  const middleware = createTrustedOriginMiddleware(new Set(['http://localhost:5173']));
  const rejectedOrigins = [
    undefined,
    'null',
    'not-an-origin',
    'http://localhost:3001/path',
    'https://localhost:3001',
    'http://localhost:3002',
    'http://localhost',
    'http://localhost:3001.evil.example',
    'http://localhost:5173.evil.example',
  ];

  for (const origin of rejectedOrigins) {
    const res = response();
    let nextCalls = 0;
    middleware({
      method: 'POST',
      protocol: 'http',
      headers: { host: 'localhost:3001', origin },
    }, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 403);
    assert.equal(nextCalls, 0);
  }
});
