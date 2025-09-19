import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

type HashParts = {
  salt: string;
  hash: string;
};

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

function serialize(parts: HashParts): string {
  return `${parts.salt}:${parts.hash}`;
}

function deserialize(serialized: string): HashParts | null {
  const segments = serialized.split(':');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return null;
  }

  return { salt: segments[0], hash: segments[1] };
}

export function hashPassword(plainText: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(plainText, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return serialize({ salt, hash });
}

export function verifyPassword(plainText: string, storedHash: string): boolean {
  const parts = deserialize(storedHash);
  if (!parts) {
    return false;
  }

  const comparisonHash = pbkdf2Sync(plainText, parts.salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  const expectedBuffer = Buffer.from(parts.hash, 'hex');
  const comparisonBuffer = Buffer.from(comparisonHash, 'hex');

  if (!expectedBuffer.length || expectedBuffer.length !== comparisonBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, comparisonBuffer);
}

export function generateToken(subject: string): string {
  const payload = {
    sub: subject,
    iat: Date.now(),
    nonce: randomBytes(16).toString('hex')
  };
  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
