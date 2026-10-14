const assert = require('node:assert/strict');
const test = require('node:test');
const {
  generateSessionToken,
  hashSessionToken,
  createSessionService,
} = require('../../src/services/sessionService');
const { getSessionConfig, getFrontendOrigins } = require('../../src/config/sessionConfig');

const rawToken = 'A'.repeat(43);
const customer = {
  id: 'customer-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace',
  phoneNumber: null, dateOfBirth: null, lastLoginAt: null, isActive: true,
};

test('session tokens contain 32 random bytes and hash deterministically to 64 hex characters', () => {
  const token = generateSessionToken();
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashSessionToken(rawToken), hashSessionToken(rawToken));
  assert.match(hashSessionToken(rawToken), /^[a-f0-9]{64}$/);
  assert.equal(hashSessionToken('malformed'), null);
});

test('createSession persists only the token hash and bounded timestamps', async () => {
  let createArgs;
  const now = new Date('2026-10-14T00:00:00Z');
  const prisma = { authSession: { create: async (args) => { createArgs = args; return { id: 'session-1', ...args.data }; } } };
  const service = createSessionService({
    prisma,
    config: { idleTimeoutSeconds: 60, absoluteTimeoutSeconds: 300 },
    tokenGenerator: () => rawToken,
    now: () => now,
  });

  const result = await service.createSession('customer-1');
  assert.equal(result.token, rawToken);
  assert.notEqual(createArgs.data.tokenHash, rawToken);
  assert.equal(createArgs.data.token, undefined);
  assert.equal(createArgs.data.absoluteExpiresAt.toISOString(), '2026-10-14T00:05:00.000Z');
});

function resolvingPrisma(session) {
  const calls = { deleted: [], updated: [] };
  return {
    calls,
    prisma: {
      authSession: {
        findUnique: async () => session,
        deleteMany: async (args) => { calls.deleted.push(args); },
        update: async (args) => { calls.updated.push(args); },
      },
    },
  };
}

test('resolveSession returns a safe active customer and updates only lastSeenAt', async () => {
  const { prisma, calls } = resolvingPrisma({
    id: 'session-1', customerId: 'customer-1', createdAt: new Date('2026-10-14T00:00:00Z'),
    lastSeenAt: new Date('2026-10-14T00:04:30Z'), absoluteExpiresAt: new Date('2026-10-14T01:00:00Z'), customer,
  });
  const now = new Date('2026-10-14T00:05:00Z');
  const result = await createSessionService({ prisma, config: { idleTimeoutSeconds: 60, absoluteTimeoutSeconds: 3600 }, now: () => now }).resolveSession(rawToken);

  assert.equal(result.customer.id, 'customer-1');
  assert.equal(result.customer.isActive, undefined);
  assert.deepEqual(calls.updated, [{ where: { id: 'session-1' }, data: { lastSeenAt: now } }]);
  assert.equal(calls.deleted.length, 0);
});

test('resolveSession rejects malformed, unknown, idle-expired, absolute-expired and inactive sessions', async () => {
  const base = {
    id: 'session-1', customerId: 'customer-1', createdAt: new Date('2026-10-14T00:00:00Z'),
    lastSeenAt: new Date('2026-10-14T00:09:30Z'), absoluteExpiresAt: new Date('2026-10-14T01:00:00Z'), customer,
  };
  const now = new Date('2026-10-14T00:10:00Z');
  const scenarios = [
    null,
    { ...base, lastSeenAt: new Date('2026-10-14T00:08:59Z') },
    { ...base, absoluteExpiresAt: now },
    { ...base, customer: { ...customer, isActive: false } },
  ];

  const malformed = resolvingPrisma(base);
  assert.equal(await createSessionService({ prisma: malformed.prisma }).resolveSession('bad'), null);
  assert.equal(malformed.calls.updated.length, 0);

  for (const session of scenarios) {
    const { prisma, calls } = resolvingPrisma(session);
    const result = await createSessionService({ prisma, config: { idleTimeoutSeconds: 60, absoluteTimeoutSeconds: 3600 }, now: () => now }).resolveSession(rawToken);
    assert.equal(result, null);
    assert.equal(calls.updated.length, 0);
    assert.equal(calls.deleted.length, session ? 1 : 0);
  }
});

test('deleteSession revokes only the selected current session', async () => {
  let args;
  const prisma = { authSession: { deleteMany: async (value) => { args = value; } } };
  await createSessionService({ prisma }).deleteSession('session-2');
  assert.deepEqual(args, { where: { id: 'session-2' } });
});

test('session and origin configuration rejects unsafe values', () => {
  assert.deepEqual(getSessionConfig({}), { idleTimeoutSeconds: 1800, absoluteTimeoutSeconds: 28800 });
  assert.throws(() => getSessionConfig({ SESSION_IDLE_TIMEOUT_SECONDS: '0' }), /positive safe integer/);
  assert.throws(() => getSessionConfig({ SESSION_IDLE_TIMEOUT_SECONDS: '60', SESSION_ABSOLUTE_TIMEOUT_SECONDS: '59' }), /greater than or equal/);
  assert.deepEqual([...getFrontendOrigins({ FRONTEND_ORIGINS: 'http://localhost:5173,https://bank.example' })], ['http://localhost:5173', 'https://bank.example']);
  assert.throws(() => getFrontendOrigins({ FRONTEND_ORIGINS: 'http://localhost:5173/path' }), /exact HTTP/);
});
