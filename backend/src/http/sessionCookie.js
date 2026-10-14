const SESSION_COOKIE_NAME = 'eb_session';

function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return { token: null, presented: false, malformed: false };
  const matching = cookieHeader.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matching.length === 0) return { token: null, presented: false, malformed: false };
  if (matching.length !== 1) return { token: null, presented: true, malformed: true };
  const token = matching[0].slice(SESSION_COOKIE_NAME.length + 1);
  return { token, presented: true, malformed: !token };
}

function cookiePolicy(isProduction = process.env.NODE_ENV === 'production') {
  return isProduction
    ? ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']
    : ['Path=/', 'HttpOnly', 'SameSite=Lax'];
}

function serializeSessionCookie(token, absoluteExpiresAt, now = new Date(), isProduction) {
  const maxAge = Math.max(0, Math.floor((absoluteExpiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    ...cookiePolicy(isProduction),
    `Max-Age=${maxAge}`,
    `Expires=${absoluteExpiresAt.toUTCString()}`,
  ].join('; ');
}

function serializeClearedSessionCookie(isProduction) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    ...cookiePolicy(isProduction),
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

module.exports = {
  SESSION_COOKIE_NAME,
  readSessionCookie,
  serializeSessionCookie,
  serializeClearedSessionCookie,
};
