import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

/** A real hash to verify against when the email is unknown, so timing doesn't reveal which emails exist. */
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString('hex'));

const COMMON = new Set(['password', 'password1', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'openajar123']);

/** Returns an error message, or null when acceptable. Length over composition rules, per current guidance. */
export function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'Enter a password';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use 128 characters or fewer';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common';
  if (new Set(password).size < 4) return 'Use a less repetitive password';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length > 3) return 'Don’t include your email name in your password';
  return null;
}
