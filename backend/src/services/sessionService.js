const { createHash, randomBytes } = require('node:crypto');
const { getPrismaClient } = require('../lib/prisma');
const { CUSTOMER_PROFILE_SELECT } = require('./customerService');
const { getSessionConfig } = require('../config/sessionConfig');

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

function isValidSessionToken(token) {
  return typeof token === 'string' && SESSION_TOKEN_PATTERN.test(token);
}

function hashSessionToken(token) {
  if (!isValidSessionToken(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

function createSessionService({
  prisma = getPrismaClient(),
  config = getSessionConfig(),
  tokenGenerator = generateSessionToken,
  now = () => new Date(),
} = {}) {
  const createSession = async (customerId) => {
    const token = tokenGenerator();
    const tokenHash = hashSessionToken(token);
    if (!tokenHash) throw new Error('Session token generator returned an invalid token.');
    const createdAt = now();
    const absoluteExpiresAt = new Date(createdAt.getTime() + config.absoluteTimeoutSeconds * 1000);
    const session = await prisma.authSession.create({
      data: { tokenHash, customerId, createdAt, lastSeenAt: createdAt, absoluteExpiresAt },
      select: { id: true, customerId: true, createdAt: true, lastSeenAt: true, absoluteExpiresAt: true },
    });
    return { token, session };
  };

  const deleteSession = async (sessionId) => {
    await prisma.authSession.deleteMany({ where: { id: sessionId } });
  };

  const resolveSession = async (token) => {
    const tokenHash = hashSessionToken(token);
    if (!tokenHash) return null;
    const session = await prisma.authSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        customerId: true,
        createdAt: true,
        lastSeenAt: true,
        absoluteExpiresAt: true,
        customer: { select: { ...CUSTOMER_PROFILE_SELECT, isActive: true } },
      },
    });
    if (!session) return null;

    const currentTime = now();
    const idleExpiresAt = session.lastSeenAt.getTime() + config.idleTimeoutSeconds * 1000;
    if (!session.customer.isActive || session.absoluteExpiresAt.getTime() <= currentTime.getTime() || idleExpiresAt <= currentTime.getTime()) {
      await deleteSession(session.id);
      return null;
    }

    await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: currentTime } });
    const { isActive, ...customer } = session.customer;
    return {
      session: {
        id: session.id,
        customerId: session.customerId,
        createdAt: session.createdAt,
        lastSeenAt: currentTime,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
      customer,
    };
  };

  return { createSession, resolveSession, deleteSession };
}

const defaultService = createSessionService();

module.exports = {
  SESSION_TOKEN_PATTERN,
  generateSessionToken,
  isValidSessionToken,
  hashSessionToken,
  createSessionService,
  createSession: defaultService.createSession,
  resolveSession: defaultService.resolveSession,
  deleteSession: defaultService.deleteSession,
};
