const DEFAULT_IDLE_TIMEOUT_SECONDS = 1800;
const DEFAULT_ABSOLUTE_TIMEOUT_SECONDS = 28800;
const DEFAULT_FRONTEND_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function parsePositiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function getSessionConfig(env = process.env) {
  const idleTimeoutSeconds = parsePositiveInteger(
    env.SESSION_IDLE_TIMEOUT_SECONDS,
    DEFAULT_IDLE_TIMEOUT_SECONDS,
    'SESSION_IDLE_TIMEOUT_SECONDS',
  );
  const absoluteTimeoutSeconds = parsePositiveInteger(
    env.SESSION_ABSOLUTE_TIMEOUT_SECONDS,
    DEFAULT_ABSOLUTE_TIMEOUT_SECONDS,
    'SESSION_ABSOLUTE_TIMEOUT_SECONDS',
  );
  if (absoluteTimeoutSeconds < idleTimeoutSeconds) {
    throw new Error('SESSION_ABSOLUTE_TIMEOUT_SECONDS must be greater than or equal to SESSION_IDLE_TIMEOUT_SECONDS.');
  }
  return { idleTimeoutSeconds, absoluteTimeoutSeconds };
}

function getFrontendOrigins(env = process.env) {
  const values = env.FRONTEND_ORIGINS === undefined
    ? DEFAULT_FRONTEND_ORIGINS
    : env.FRONTEND_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error('FRONTEND_ORIGINS must include at least one origin.');

  return new Set(values.map((value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`FRONTEND_ORIGINS contains an invalid origin: ${value}`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new Error(`FRONTEND_ORIGINS must contain exact HTTP(S) origins: ${value}`);
    }
    return value;
  }));
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_ABSOLUTE_TIMEOUT_SECONDS,
  DEFAULT_FRONTEND_ORIGINS,
  getSessionConfig,
  getFrontendOrigins,
};
