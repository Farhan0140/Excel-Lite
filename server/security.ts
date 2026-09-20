import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';

/* ---------- passwords: scrypt (built in to Node, no native modules), per-user salt ---------- */
export interface HashParams { N: number; r: number; p: number }
export const PROD_HASH: HashParams = { N: 32768, r: 8, p: 3 }; // OWASP recommended scrypt setting (~32 MB)
const KEYLEN = 64;

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const opts = (P: HashParams) => ({ N: P.N, r: P.r, p: P.p, maxmem: 256 * P.N * P.r + 16 * 1024 * 1024 });

export async function hashPassword(password: string, P: HashParams = PROD_HASH): Promise<string> {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(password.normalize('NFKC'), salt, KEYLEN, opts(P));
  return `scrypt$${P.N}$${P.r}$${P.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const P = { N: +N, r: +r, p: +p };
  if (!(P.N >= 2 && P.N <= 1 << 20 && P.r > 0 && P.r <= 16 && P.p > 0 && P.p <= 16)) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, opts(P));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---------- the 6 digit recovery code ----------
   Only 1,000,000 codes exist, so a plain hash could be brute forced in a second if the database ever leaked.
   We store an HMAC keyed with a secret ("pepper") that lives only in the server environment, and the reset
   endpoint locks an account after a few wrong guesses (see app.ts). */
export const newRecoveryCode = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export const recoveryDigest = (pepper: string, userId: string, code: string): string =>
  crypto.createHmac('sha256', pepper).update(userId + ':' + code).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const A = Buffer.from(a, 'hex'), B = Buffer.from(b, 'hex');
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
}

/* ---------- session token (JWT, HS256) ---------- */
const ISSUER = 'household-ledger';
const keyOf = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(secret: string, userId: string, tokenVersion: number, days: number): Promise<string> {
  return new SignJWT({ ver: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(keyOf(secret));
}

export async function readSession(secret: string, token: string): Promise<{ sub: string; ver: number } | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), { algorithms: ['HS256'], issuer: ISSUER });
    if (typeof payload.sub !== 'string' || typeof payload.ver !== 'number') return null;
    return { sub: payload.sub, ver: payload.ver };
  } catch {
    return null;
  }
}
