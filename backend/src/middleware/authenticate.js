const { readSessionCookie, serializeClearedSessionCookie } = require('../http/sessionCookie');

function createAuthenticateMiddleware({ resolveSession, isProduction = false }) {
  return async (req, res, next) => {
    const cookie = readSessionCookie(req.headers.cookie);
    if (!cookie.presented) return res.status(401).json({ error: 'Authentication required.' });

    try {
      const auth = cookie.malformed ? null : await resolveSession(cookie.token);
      if (!auth) {
        res.setHeader('Set-Cookie', serializeClearedSessionCookie(isProduction));
        return res.status(401).json({ error: 'Authentication required.' });
      }
      req.auth = auth;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createAuthenticateMiddleware };
