const JSON_CONTENT_TYPE_ERROR = 'Content-Type must be application/json.';

function getContentType(headers = {}) {
  const value = headers['content-type'] ?? headers['Content-Type'];
  return typeof value === 'string' ? value : null;
}

function isJsonContentType(value) {
  if (typeof value !== 'string') return false;
  const [mediaType, ...parameters] = value.split(';');
  if (mediaType.trim().toLowerCase() !== 'application/json') return false;

  return parameters.every((parameter) => /^charset\s*=\s*(?:"utf-8"|utf-8)$/i.test(parameter.trim()));
}

function requireJsonContentType(req, res, next) {
  if (!isJsonContentType(getContentType(req.headers))) {
    return res.status(415).json({ error: JSON_CONTENT_TYPE_ERROR });
  }
  return next();
}

module.exports = {
  JSON_CONTENT_TYPE_ERROR,
  getContentType,
  isJsonContentType,
  requireJsonContentType,
};
