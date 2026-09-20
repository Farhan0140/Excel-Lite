import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from './config';
import type { Db, Query } from './db';
import { hashPassword, newRecoveryCode, PROD_HASH, readSession, recoveryDigest, safeEqualHex, signSession, verifyPassword } from './security';
import { cleanWorkbook } from '../src/engine/model';

const COOKIE = 'hl_session';
const LOCK_MINUTES = 15;
const PW_MAX_FAILS = 10; // wrong passwords before the account is locked for a while
const CODE_MAX_FAILS = 5; // wrong recovery codes before the account is locked for a while

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  recovery_hash: string;
  token_version: number;
  pw_failed: number;
  pw_locked_until: Date | null;
  recovery_failed: number;
  recovery_locked_until: Date | null;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/* ---------- input rules ---------- */
const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254, 'That email address is too long.');
const newPassword = z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password must be at most 128 characters.');
const anyPassword = z.string().min(1, 'Enter your password.').max(128, 'That password is too long.');
const schemas = {
  signup: z.object({ email, password: newPassword }),
  signin: z.object({ email, password: anyPassword }),
  reset: z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'The recovery code is 6 digits.'), newPassword }),
  changePassword: z.object({ currentPassword: anyPassword, newPassword }),
  newCode: z.object({ password: anyPassword }),
  putWorkbook: z.object({ baseRevision: z.number().int().min(0), force: z.boolean().optional(), data: z.unknown() }),
};
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, 'invalid_input', r.error.issues[0]?.message || 'Invalid input.');
  return r.data;
}

const publicUser = (u: Pick<UserRow, 'id' | 'email'>) => ({ id: u.id, email: u.email });
const minutesLeft = (until: Date) => Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));
const isLocked = (until: Date | null) => !!until && new Date(until).getTime() > Date.now();

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function createApp(db: Db, cfg: Config) {
  const app = express();
  app.set('trust proxy', cfg.trustProxy);
  // strict security headers; "upgrade to https" and HSTS only make sense (and only work) when the site really is served over https
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': cfg.cookieSecure ? [] : null } },
      hsts: cfg.cookieSecure,
    }),
  );

  const hashParams = cfg.hash ?? PROD_HASH;
  let dummy: Promise<string> | null = null; // compared against when the email is unknown, so timing does not reveal accounts
  const dummyHash = () => (dummy ??= hashPassword('not-a-real-password', hashParams));

  async function startSession(res: Response, userId: string, tokenVersion: number) {
    const token = await signSession(cfg.jwtSecret, userId, tokenVersion, cfg.sessionDays);
    res.cookie(COOKIE, token, {
      httpOnly: true, // page scripts can never read the token
      secure: cfg.cookieSecure,
      sameSite: 'strict', // also our CSRF protection: other sites cannot make the browser send it
      path: '/',
      maxAge: cfg.sessionDays * 86_400_000,
    });
  }

  const limiter = (windowMs: number, limit: number) =>
    cfg.rateLimit
      ? rateLimit({
          windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
          handler: (_req, res) => {
            res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } });
          },
        })
      : (_req: Request, _res: Response, next: NextFunction) => next();

  const small = express.json({ limit: '16kb' });
  const big = express.json({ limit: '8mb' });

  /* signed-in only */
  async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = readCookie(req, COOKIE);
    const s = token ? await readSession(cfg.jwtSecret, token) : null;
    if (!s) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    const { rows } = await db.query<UserRow>('select id, email, token_version from users where id = $1', [s.sub]);
    const u = rows[0];
    // the version changes when the password is changed or reset, which signs out every older session
    if (!u || u.token_version !== s.ver) throw new HttpError(401, 'unauthenticated', 'Please sign in again.');
    res.locals.user = u;
    next();
  }

  // Wrong-password bookkeeping for an already loaded (and row-locked) user. Returns null when the password is right.
  async function checkPassword(q: Query, u: UserRow, password: string): Promise<HttpError | null> {
    if (isLocked(u.pw_locked_until)) {
      return new HttpError(429, 'locked', `Too many wrong passwords. Try again in ${minutesLeft(u.pw_locked_until!)} minutes.`);
    }
    if (await verifyPassword(password, u.password_hash)) {
      if (u.pw_failed) await q('update users set pw_failed = 0, pw_locked_until = null where id = $1', [u.id]);
      return null;
    }
    const lock = u.pw_failed + 1 >= PW_MAX_FAILS;
    await q(
      `update users set pw_failed = $2, pw_locked_until = case when $3 then now() + make_interval(mins => $4) else pw_locked_until end where id = $1`,
      [u.id, lock ? 0 : u.pw_failed + 1, lock, LOCK_MINUTES],
    );
    return new HttpError(401, 'invalid_credentials', 'Wrong email or password.');
  }

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.get('/health', (_req, res) => void res.json({ ok: true }));

  /* ---------- sign up: returns the 6 digit recovery code, once ---------- */
  api.post('/auth/signup', limiter(60 * 60_000, 20), small, async (req, res) => {
    const { email: em, password } = parse(schemas.signup, req.body);
    const id = crypto.randomUUID();
    const code = newRecoveryCode();
    const passwordHash = await hashPassword(password, hashParams);
    try {
      await db.query('insert into users (id, email, password_hash, recovery_hash) values ($1, $2, $3, $4)', [
        id, em, passwordHash, recoveryDigest(cfg.recoveryPepper, id, code),
      ]);
    } catch (e: any) {
      if (e?.code === '23505') throw new HttpError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
      throw e;
    }
    await startSession(res, id, 0);
    res.status(201).json({ user: { id, email: em }, recoveryCode: code });
  });

  /* ---------- sign in ---------- */
  api.post('/auth/signin', limiter(15 * 60_000, 30), small, async (req, res) => {
    const { email: em, password } = parse(schemas.signin, req.body);
    const out = await db.tx(async (q) => {
      const { rows } = await q<UserRow>('select * from users where lower(email) = $1 for update', [em]);
      const u = rows[0];
      if (!u) {
        await verifyPassword(password, await dummyHash());
        return { err: new HttpError(401, 'invalid_credentials', 'Wrong email or password.') };
      }
      const err = await checkPassword(q, u, password);
      return err ? { err } : { u };
    });
    if ('err' in out && out.err) throw out.err;
    const u = (out as { u: UserRow }).u;
    await startSession(res, u.id, u.token_version);
    res.json({ user: publicUser(u) });
  });

  api.post('/auth/signout', (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, secure: cfg.cookieSecure, sameSite: 'strict', path: '/' });
    res.json({ ok: true });
  });

  api.get('/auth/me', requireAuth, (_req, res) => void res.json({ user: publicUser(res.locals.user) }));

  /* ---------- forgot password: email + recovery code -> new password AND a brand new recovery code ---------- */
  api.post('/auth/reset', limiter(15 * 60_000, 15), small, async (req, res) => {
    const { email: em, code, newPassword: np } = parse(schemas.reset, req.body);
    const bad = new HttpError(400, 'invalid_reset', "That email and recovery code don't match.");
    const out = await db.tx(async (q) => {
      // the row lock means parallel guesses are counted one after another, so the attempt limit cannot be raced
      const { rows } = await q<UserRow>('select * from users where lower(email) = $1 for update', [em]);
      const u = rows[0];
      if (!u) return { err: bad };
      if (isLocked(u.recovery_locked_until)) {
        return { err: new HttpError(429, 'locked', `Too many wrong codes. Try again in ${minutesLeft(u.recovery_locked_until!)} minutes.`) };
      }
      if (!safeEqualHex(u.recovery_hash, recoveryDigest(cfg.recoveryPepper, u.id, code))) {
        const lock = u.recovery_failed + 1 >= CODE_MAX_FAILS;
        await q(
          `update users set recovery_failed = $2, recovery_locked_until = case when $3 then now() + make_interval(mins => $4) else recovery_locked_until end where id = $1`,
          [u.id, lock ? 0 : u.recovery_failed + 1, lock, LOCK_MINUTES],
        );
        return { err: bad };
      }
      const nextCode = newRecoveryCode(); // the old code is now useless
      const hash = await hashPassword(np, hashParams);
      const r = await q<{ token_version: number }>(
        `update users set password_hash = $2, recovery_hash = $3, token_version = token_version + 1,
           pw_failed = 0, pw_locked_until = null, recovery_failed = 0, recovery_locked_until = null, updated_at = now()
         where id = $1 returning token_version`,
        [u.id, hash, recoveryDigest(cfg.recoveryPepper, u.id, nextCode)],
      );
      return { u, version: r.rows[0].token_version, nextCode };
    });
    if ('err' in out && out.err) throw out.err;
    const ok = out as { u: UserRow; version: number; nextCode: string };
    await startSession(res, ok.u.id, ok.version);
    res.json({ user: publicUser(ok.u), recoveryCode: ok.nextCode });
  });

  /* ---------- signed in: change password / make a new recovery code ---------- */
  api.post('/auth/password', limiter(15 * 60_000, 20), small, requireAuth, async (req, res) => {
    const { currentPassword, newPassword: np } = parse(schemas.changePassword, req.body);
    const id = res.locals.user.id as string;
    const out = await db.tx(async (q) => {
      const { rows } = await q<UserRow>('select * from users where id = $1 for update', [id]);
      const err = await checkPassword(q, rows[0], currentPassword);
      if (err) return { err };
      const hash = await hashPassword(np, hashParams);
      const r = await q<{ token_version: number }>(
        'update users set password_hash = $2, token_version = token_version + 1, updated_at = now() where id = $1 returning token_version',
        [id, hash],
      );
      return { version: r.rows[0].token_version };
    });
    if ('err' in out && out.err) throw out.err;
    await startSession(res, id, (out as { version: number }).version);
    res.json({ ok: true });
  });

  api.post('/auth/recovery-code', limiter(15 * 60_000, 20), small, requireAuth, async (req, res) => {
    const { password } = parse(schemas.newCode, req.body);
    const id = res.locals.user.id as string;
    const code = newRecoveryCode();
    const out = await db.tx(async (q) => {
      const { rows } = await q<UserRow>('select * from users where id = $1 for update', [id]);
      const err = await checkPassword(q, rows[0], password);
      if (err) return { err };
      await q('update users set recovery_hash = $2, recovery_failed = 0, recovery_locked_until = null, updated_at = now() where id = $1', [
        id, recoveryDigest(cfg.recoveryPepper, id, code),
      ]);
      return {};
    });
    if ('err' in out && out.err) throw out.err;
    res.json({ recoveryCode: code });
  });

  /* ---------- the ledger itself ---------- */
  api.get('/workbook', limiter(15 * 60_000, 600), requireAuth, async (_req, res) => {
    const { rows } = await db.query<{ data: unknown; revision: number; updated_at: Date }>(
      'select data, revision, updated_at from workbooks where user_id = $1',
      [res.locals.user.id],
    );
    const w = rows[0];
    res.json(w ? { data: w.data, revision: w.revision, updatedAt: w.updated_at } : { data: null, revision: 0, updatedAt: null });
  });

  api.put('/workbook', limiter(15 * 60_000, 900), requireAuth, big, async (req, res) => {
    const { baseRevision, force, data } = parse(schemas.putWorkbook, req.body);
    const clean = cleanWorkbook(data); // never trust what a client sends: normalise and cap everything
    if (!clean) throw new HttpError(400, 'invalid_workbook', 'That is not a valid ledger.');
    // one atomic statement: only writes when the client saw the latest revision (or explicitly forces)
    const { rows } = await db.query<{ revision: number; updated_at: Date }>(
      `insert into workbooks (user_id, data, revision) values ($1, $2::jsonb, 1)
       on conflict (user_id) do update
         set data = excluded.data, revision = workbooks.revision + 1, updated_at = now()
         where workbooks.revision = $3 or $4
       returning revision, updated_at`,
      [res.locals.user.id, JSON.stringify(clean), baseRevision, !!force],
    );
    if (!rows[0]) {
      const cur = await db.query<{ revision: number }>('select revision from workbooks where user_id = $1', [res.locals.user.id]);
      throw new HttpError(409, 'conflict', 'This ledger was changed somewhere else.', { revision: cur.rows[0]?.revision ?? 0 });
    }
    res.json({ revision: rows[0].revision, updatedAt: rows[0].updated_at });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.')));
  app.use('/api', api);

  /* ---------- the built web app (production) ---------- */
  const index = path.join(cfg.staticDir, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  /* ---------- errors ---------- */
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message }, ...(err.extra || {}) });
    } else if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'That is too large.' } });
    } else if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_input', message: 'Invalid request.' } });
    } else {
      console.error('[server] unexpected error:', err);
      res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
    }
  });

  return app;
}
