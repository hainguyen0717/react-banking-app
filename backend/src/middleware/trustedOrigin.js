const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseExactHttpOrigin(value) {
  if (typeof value !== 'string' || value === 'null') return null;

  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== value
      || parsed.username
      || parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(req) {
  const protocol = req.protocol;
  const host = req.headers?.host;
  if (!['http', 'https'].includes(protocol) || typeof host !== 'string') return null;
  return parseExactHttpOrigin(`${protocol}://${host}`);
}

function createTrustedOriginMiddleware(frontendOrigins) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS' || !MUTATION_METHODS.has(req.method)) return next();
    const origin = parseExactHttpOrigin(req.headers.origin);
    const sameOrigin = origin !== null && origin === getRequestOrigin(req);
    if (origin === null || (!frontendOrigins.has(origin) && !sameOrigin)) {
      return res.status(403).json({ error: 'Trusted Origin required.' });
    }
    return next();
  };
}

module.exports = {
  MUTATION_METHODS,
  parseExactHttpOrigin,
  getRequestOrigin,
  createTrustedOriginMiddleware,
};
