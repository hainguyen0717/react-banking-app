const assert = require('node:assert/strict');
const test = require('node:test');
const { readSessionCookie, serializeSessionCookie, serializeClearedSessionCookie } = require('../../src/http/sessionCookie');
const { createAuthenticateMiddleware } = require('../../src/middleware/authenticate');
const { createTrustedOriginMiddleware } = require('../../src/middleware/trustedOrigin');

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
    assert.equal(nextCalls, 0);
  }
  assert.equal(resolveCalls, 0);

  const req = { headers: { cookie: 'eb_session=token' } };
  let nextCalls = 0;
  await middleware(req, response(), () => { nextCalls += 1; });
  assert.equal(req.auth.customer.id, 'customer-1');
  assert.equal(nextCalls, 1);
});

test('trusted-origin middleware allows exact origins and OPTIONS but rejects missing, null and hostile origins', () => {
  const middleware = createTrustedOriginMiddleware(new Set(['http://localhost:5173']));
  const allowed = [
    { method: 'OPTIONS', headers: {} },
    { method: 'GET', headers: {} },
    { method: 'POST', headers: { origin: 'http://localhost:5173' } },
  ];
  for (const req of allowed) {
    let nextCalls = 0;
    middleware(req, response(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
  }
  for (const origin of [undefined, 'null', 'http://localhost:5173.evil.example']) {
    const res = response();
    middleware({ method: 'POST', headers: { origin } }, res, () => {});
    assert.equal(res.statusCode, 403);
  }
});
