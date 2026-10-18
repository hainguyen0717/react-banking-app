const { readSessionCookie, serializeClearedSessionCookie } = require('../http/sessionCookie');

const BEARER_CHALLENGE = 'Bearer realm="express-bank"';

function readBearerAuthorization(authorizationHeader) {
  if (authorizationHeader === undefined) {
    return { token: null, presented: false, malformed: false };
  }
  if (typeof authorizationHeader !== 'string') {
    return { token: null, presented: true, malformed: true };
  }

  const match = /^Bearer[ \t]+([^\s,]+)$/i.exec(authorizationHeader);
  return match
    ? { token: match[1], presented: true, malformed: false }
    : { token: null, presented: true, malformed: true };
}

function rejectAuthentication(res, { clearCookie = false, isProduction = false } = {}) {
  res.setHeader('WWW-Authenticate', BEARER_CHALLENGE);
  if (clearCookie) {
    res.setHeader('Set-Cookie', serializeClearedSessionCookie(isProduction));
  }
  return res.status(401).json({ error: 'Authentication required.' });
}

function createAuthenticateMiddleware({ resolveSession, isProduction = false }) {
  return async (req, res, next) => {
    const bearer = readBearerAuthorization(req.headers.authorization);
    const cookie = readSessionCookie(req.headers.cookie);

    // An explicitly supplied Authorization header is authoritative. Never
    // fall back to a cookie when a bearer credential is malformed or invalid.
    if (bearer.presented && bearer.malformed) return rejectAuthentication(res);
    if (!bearer.presented && !cookie.presented) return rejectAuthentication(res);

    try {
      const method = bearer.presented ? 'bearer' : 'cookie';
      const token = bearer.presented ? bearer.token : cookie.token;
      const auth = (!bearer.presented && cookie.malformed) ? null : await resolveSession(token);
      if (!auth) {
        return rejectAuthentication(res, {
          clearCookie: method === 'cookie',
          isProduction,
        });
      }
      req.auth = {
        ...auth,
        method,
        cookieMatchesSession: method === 'cookie'
          || (!cookie.malformed && cookie.token === bearer.token),
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  BEARER_CHALLENGE,
  readBearerAuthorization,
  rejectAuthentication,
  createAuthenticateMiddleware,
};
