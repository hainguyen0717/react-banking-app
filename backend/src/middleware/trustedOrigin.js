const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createTrustedOriginMiddleware(frontendOrigins) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS' || !MUTATION_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === 'null' || !frontendOrigins.has(origin)) {
      return res.status(403).json({ error: 'Trusted Origin required.' });
    }
    return next();
  };
}

module.exports = { MUTATION_METHODS, createTrustedOriginMiddleware };
