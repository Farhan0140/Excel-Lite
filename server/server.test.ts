import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';
import { connectPglite, migrate } from './db';
import type { Db } from './db';
import type { Config } from './config';
import { hashPassword, newRecoveryCode, readSession, recoveryDigest, signSession, verifyPassword } from './security';
import { sampleWorkbook } from '../src/engine/model';

const cfg = (over: Partial<Config> = {}): Config => ({
  prod: false, port: 0, jwtSecret: 'test-secret-test-secret-test-secret-123', recoveryPepper: 'test-pepper-test-pepper-test-pepper-123',
  sessionDays: 7, cookieSecure: false, trustProxy: false, staticDir: '/nonexistent', rateLimit: false, hash: { N: 1024, r: 8, p: 1 }, ...over,
});

let db: Db, server: http.Server, base: string;

/* a tiny browser: remembers the session cookie */
function client() {
  let cookie = '';
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json, setCookie: set };
  };
  return { call, get cookie() { return cookie; }, set cookie(v: string) { cookie = v; } };
}

let n = 0;
const uniq = () => `user${++n}-${Date.now()}@example.com`;
const PW = 'correct horse battery';

async function signup(c = client(), email = uniq(), password = PW) {
  const r = await c.call('POST', '/api/auth/signup', { email, password });
  return { c, email, r, code: r.json?.recoveryCode as string };
}

beforeAll(async () => {
  db = await connectPglite(); // in-memory Postgres
  await migrate(db);
  server = http.createServer(createApp(db, cfg()));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await db.close();
});

describe('sign up', () => {
  it('creates the account, returns a 6 digit recovery code once, and sets a JWT cookie', async () => {
    const { r, email } = await signup();
    expect(r.status).toBe(201);
    expect(r.json.user.email).toBe(email);
    expect(r.json.recoveryCode).toMatch(/^\d{6}$/);
    expect(r.setCookie[0]).toMatch(/hl_session=.+HttpOnly/i);
    expect(r.setCookie[0]).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(r.json)).not.toMatch(/hash/i);
    expect(typeof r.json.token).toBe('string'); // a native app has no cookie jar, so it gets the raw token too
  });
  it('never stores the password or the recovery code in clear text', async () => {
    const { r, email } = await signup();
    const { rows } = await db.query<{ password_hash: string; recovery_hash: string }>('select password_hash, recovery_hash from users where email = $1', [email]);
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);
    expect(rows[0].password_hash).not.toContain(PW);
    expect(rows[0].recovery_hash).not.toContain(r.json.recoveryCode);
    expect(rows[0].recovery_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects a taken email (any letter case), weak passwords and bad emails', async () => {
    const { email } = await signup();
    expect((await client().call('POST', '/api/auth/signup', { email: email.toUpperCase(), password: PW })).json.error.code).toBe('email_taken');
    expect((await client().call('POST', '/api/auth/signup', { email: uniq(), password: 'short' })).status).toBe(400);
    expect((await client().call('POST', '/api/auth/signup', { email: 'not-an-email', password: PW })).status).toBe(400);
    expect((await client().call('POST', '/api/auth/signup', { email: uniq(), password: 'x'.repeat(200) })).status).toBe(400);
  });
});

describe('sign in and sessions', () => {
  it('signs in, reads /me, signs out', async () => {
    const { email } = await signup();
    const c = client();
    const r = await c.call('POST', '/api/auth/signin', { email: email.toUpperCase(), password: PW });
    expect(r.status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).json.user.email).toBe(email);
    await c.call('POST', '/api/auth/signout');
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email } = await signup();
    const a = await client().call('POST', '/api/auth/signin', { email, password: 'wrong password!' });
    const b = await client().call('POST', '/api/auth/signin', { email: uniq(), password: 'wrong password!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json).toEqual(b.json);
  });
  it('locks the account for a while after 10 wrong passwords, even for the right one', async () => {
    const { email } = await signup();
    for (let i = 0; i < 10; i++) expect((await client().call('POST', '/api/auth/signin', { email, password: 'nope nope nope' })).status).toBe(401);
    const r = await client().call('POST', '/api/auth/signin', { email, password: PW });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('locked');
  });
  it('rejects a forged, expired or wrong-secret token', async () => {
    const { r, email } = await signup();
    const id = r.json.user.id as string;
    const c = client();
    c.cookie = 'hl_session=' + (await signSession('some-other-secret-some-other-secret-1234', id, 0, 7));
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
    c.cookie = 'hl_session=not.a.jwt';
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
    c.cookie = 'hl_session=' + (await signSession(cfg().jwtSecret, id, 0, 7));
    expect((await c.call('GET', '/api/auth/me')).json.user.email).toBe(email);
    c.cookie = 'hl_session=' + (await signSession(cfg().jwtSecret, id, 99, 7)); // wrong token version
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
  it('protects the ledger routes', async () => {
    expect((await client().call('GET', '/api/workbook')).status).toBe(401);
    expect((await client().call('PUT', '/api/workbook', { baseRevision: 0, data: {} })).status).toBe(401);
  });
});

describe('password reset with the 6 digit recovery code', () => {
  it('resets the password, signs in with it, and issues a NEW recovery code (the old one dies)', async () => {
    const { email, code } = await signup();
    const c = client();
    const r = await c.call('POST', '/api/auth/reset', { email, code, newPassword: 'a brand new password' });
    expect(r.status).toBe(200);
    expect(r.json.recoveryCode).toMatch(/^\d{6}$/);
    expect(r.json.recoveryCode).not.toBe(code);
    // signed in right away
    expect((await c.call('GET', '/api/auth/me')).json.user.email).toBe(email);
    // old password no longer works, new one does
    expect((await client().call('POST', '/api/auth/signin', { email, password: PW })).status).toBe(401);
    expect((await client().call('POST', '/api/auth/signin', { email, password: 'a brand new password' })).status).toBe(200);
    // the old code no longer works; the new one does (and rotates again)
    expect((await client().call('POST', '/api/auth/reset', { email, code, newPassword: 'another password!' })).status).toBe(400);
    const r2 = await client().call('POST', '/api/auth/reset', { email, code: r.json.recoveryCode, newPassword: 'third password!!' });
    expect(r2.status).toBe(200);
    expect(r2.json.recoveryCode).not.toBe(r.json.recoveryCode);
  });
  it('signs out every older session', async () => {
    const { c, email, code } = await signup();
    expect((await c.call('GET', '/api/auth/me')).status).toBe(200);
    await client().call('POST', '/api/auth/reset', { email, code, newPassword: 'a brand new password' });
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
  it('a wrong code changes nothing, and does not reveal whether the email exists', async () => {
    const { email, code } = await signup();
    const wrong = code === '000000' ? '111111' : '000000';
    const a = await client().call('POST', '/api/auth/reset', { email, code: wrong, newPassword: 'a brand new password' });
    const b = await client().call('POST', '/api/auth/reset', { email: uniq(), code: wrong, newPassword: 'a brand new password' });
    expect(a.status).toBe(400);
    expect(a.json).toEqual(b.json);
    expect((await client().call('POST', '/api/auth/signin', { email, password: PW })).status).toBe(200); // password untouched
  });
  it('locks after 5 wrong codes, so the 6 digits cannot be brute forced (even the right code is refused)', async () => {
    const { email, code } = await signup();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await client().call('POST', '/api/auth/reset', { email, code: wrong, newPassword: 'a brand new password' })).status).toBe(400);
    const r = await client().call('POST', '/api/auth/reset', { email, code, newPassword: 'a brand new password' });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('locked');
    expect((await client().call('POST', '/api/auth/signin', { email, password: PW })).status).toBe(200);
  });
  it('parallel guesses cannot get around the limit', async () => {
    const { email, code } = await signup();
    const wrong = code === '000000' ? '111111' : '000000';
    const rs = await Promise.all(Array.from({ length: 20 }, () => client().call('POST', '/api/auth/reset', { email, code: wrong, newPassword: 'a brand new password' })));
    expect(rs.filter((r) => r.status === 400).length).toBe(5);
    expect(rs.filter((r) => r.status === 429).length).toBe(15);
  });
  it('validates the input (6 digits, new password length)', async () => {
    const { email } = await signup();
    expect((await client().call('POST', '/api/auth/reset', { email, code: '12345', newPassword: 'a brand new password' })).status).toBe(400);
    expect((await client().call('POST', '/api/auth/reset', { email, code: 'abcdef', newPassword: 'a brand new password' })).status).toBe(400);
    expect((await client().call('POST', '/api/auth/reset', { email, code: '123456', newPassword: 'short' })).status).toBe(400);
  });
});

describe('account settings', () => {
  it('changes the password (needs the current one) and keeps this session', async () => {
    const { c, email } = await signup();
    expect((await c.call('POST', '/api/auth/password', { currentPassword: 'wrong wrong', newPassword: 'the next password' })).status).toBe(401);
    expect((await c.call('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'the next password' })).status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(200);
    expect((await client().call('POST', '/api/auth/signin', { email, password: 'the next password' })).status).toBe(200);
  });
  it('makes a new recovery code (needs the password) and the old code stops working', async () => {
    const { c, email, code } = await signup();
    expect((await c.call('POST', '/api/auth/recovery-code', { password: 'wrong wrong' })).status).toBe(401);
    const r = await c.call('POST', '/api/auth/recovery-code', { password: PW });
    expect(r.json.recoveryCode).toMatch(/^\d{6}$/);
    if (r.json.recoveryCode !== code) {
      expect((await client().call('POST', '/api/auth/reset', { email, code, newPassword: 'a brand new password' })).status).toBe(400);
    }
    expect((await client().call('POST', '/api/auth/reset', { email, code: r.json.recoveryCode, newPassword: 'a brand new password' })).status).toBe(200);
  });
});

describe('bearer token auth (what the mobile app uses instead of a cookie jar)', () => {
  it('the token from signup works as "Authorization: Bearer <token>" with no cookie at all', async () => {
    const { r } = await signup();
    const bare = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${r.json.token}` } });
    expect(bare.status).toBe(200);
    const bareJson: any = await bare.json();
    expect(bareJson.user.email).toBe(r.json.user.email);
  });
  it('sign in also returns a usable token', async () => {
    const { email } = await signup();
    const r = await client().call('POST', '/api/auth/signin', { email, password: PW });
    expect(typeof r.json.token).toBe('string');
    const bare = await fetch(`${base}/api/workbook`, { headers: { authorization: `Bearer ${r.json.token}` } });
    expect(bare.status).toBe(200);
  });
  it('a garbage or missing bearer token is rejected, same as a missing cookie', async () => {
    expect((await fetch(`${base}/api/auth/me`, { headers: { authorization: 'Bearer not-a-token' } })).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`, { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });
  it('changing the password invalidates the old bearer token and the response carries a new one', async () => {
    const { r, c } = await signup();
    const oldToken = r.json.token as string;
    const changed = await c.call('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'a brand new password' });
    expect(typeof changed.json.token).toBe('string');
    expect(changed.json.token).not.toBe(oldToken);
    expect((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${oldToken}` } })).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${changed.json.token}` } })).status).toBe(200);
  });
  it('a password reset also returns a fresh, working bearer token', async () => {
    const { email, code } = await signup();
    const r = await client().call('POST', '/api/auth/reset', { email, code, newPassword: 'a brand new password' });
    expect(typeof r.json.token).toBe('string');
    expect((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${r.json.token}` } })).status).toBe(200);
  });
  it('a cookie and a bearer token both work independently for the same account, on different "devices"', async () => {
    const { r, c } = await signup(); // c = a "browser" using the cookie
    // a second "device" using only the token, no cookie
    const workbook = await fetch(`${base}/api/workbook`, { headers: { authorization: `Bearer ${r.json.token}` } });
    expect(workbook.status).toBe(200);
    // the cookie-based session still works too
    expect((await c.call('GET', '/api/auth/me')).status).toBe(200);
  });
});

describe('the ledger (workbook)', () => {
  it('starts empty, saves, and reads back what was saved', async () => {
    const { c } = await signup();
    expect((await c.call('GET', '/api/workbook')).json).toEqual({ data: null, revision: 0, updatedAt: null });
    const wb = sampleWorkbook();
    wb.sheets[0].data.cells['20,0'] = { v: 'shaded', b: 1, f: 3, o: 40 };
    const put = await c.call('PUT', '/api/workbook', { baseRevision: 0, data: JSON.parse(JSON.stringify(wb)) });
    expect(put.status).toBe(200);
    expect(put.json.revision).toBe(1);
    const got = await c.call('GET', '/api/workbook');
    expect(got.json.revision).toBe(1);
    expect(got.json.data.sheets.map((s: any) => s.name)).toEqual(['Tab1', 'Tab2']);
    expect(got.json.data.sheets[0].data.cells['20,0']).toEqual({ v: 'shaded', b: 1, f: 3, o: 40 });
    expect(got.json.data.sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6');
  });
  it('keeps every user\'s ledger separate', async () => {
    const a = await signup(), b = await signup();
    await a.c.call('PUT', '/api/workbook', { baseRevision: 0, data: sampleWorkbook() });
    expect((await b.c.call('GET', '/api/workbook')).json.data).toBeNull();
  });
  it('refuses a stale save (409) instead of overwriting another device, unless forced', async () => {
    const { c, email } = await signup();
    const wb = sampleWorkbook();
    await c.call('PUT', '/api/workbook', { baseRevision: 0, data: wb });
    const other = client();
    await other.call('POST', '/api/auth/signin', { email, password: PW });
    expect((await other.call('PUT', '/api/workbook', { baseRevision: 1, data: wb })).json.revision).toBe(2);
    const stale = await c.call('PUT', '/api/workbook', { baseRevision: 1, data: wb });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('conflict');
    expect(stale.json.revision).toBe(2);
    expect((await c.call('PUT', '/api/workbook', { baseRevision: 2, force: true, data: wb })).json.revision).toBe(3);
  });
  it('a first save with baseRevision 0 cannot overwrite an existing ledger', async () => {
    const { c } = await signup();
    await c.call('PUT', '/api/workbook', { baseRevision: 0, data: sampleWorkbook() });
    expect((await c.call('PUT', '/api/workbook', { baseRevision: 0, data: sampleWorkbook() })).status).toBe(409);
  });
  it('sanitises what it stores (caps, names, colours) and rejects garbage', async () => {
    const { c } = await signup();
    const evil = {
      cur: 99,
      sheets: [{ name: "a!b':c<script>", data: { rows: 5, cols: 3, colW: [10, 9999], merges: [{ r0: 5, c0: 0, r1: 1, c1: 0 }], cells: {
        '0,0': { v: 'x'.repeat(5000), b: 7, f: 99, o: 1 }, 'bad': { v: 'no' }, '99999,0': { v: 'far' }, '1,1': { v: 5 },
      } } }],
    };
    expect((await c.call('PUT', '/api/workbook', { baseRevision: 0, data: evil })).status).toBe(200);
    const d = (await c.call('GET', '/api/workbook')).json.data;
    expect(d.cur).toBe(0);
    expect(d.sheets[0].name).toBe('abc<script>');
    const cell = d.sheets[0].data.cells['0,0'];
    expect(cell.v.length).toBe(2000);
    expect(cell.b).toBe(1);
    expect(cell.f).toBe(0);
    expect(Object.keys(d.sheets[0].data.cells)).toEqual(['0,0']);
    expect(d.sheets[0].data.merges).toEqual([]);
    expect((await c.call('PUT', '/api/workbook', { baseRevision: 1, data: { nothing: true } })).status).toBe(400);
    expect((await c.call('PUT', '/api/workbook', { baseRevision: 'x', data: sampleWorkbook() })).status).toBe(400);
    expect((await c.call('PUT', '/api/workbook', '{not json')).status).toBe(400);
  });
  it('deleting nothing else: a ledger belongs to its user and is removed with the account', async () => {
    const { c, r } = await signup();
    await c.call('PUT', '/api/workbook', { baseRevision: 0, data: sampleWorkbook() });
    await db.query('delete from users where id = $1', [r.json.user.id]);
    const { rows } = await db.query('select 1 from workbooks where user_id = $1', [r.json.user.id]);
    expect(rows.length).toBe(0);
  });
});

describe('primitives', () => {
  it('password hashes verify only the right password and are salted', async () => {
    const h1 = await hashPassword('secret one', { N: 1024, r: 8, p: 1 });
    const h2 = await hashPassword('secret one', { N: 1024, r: 8, p: 1 });
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('secret one', h1)).toBe(true);
    expect(await verifyPassword('secret two', h1)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$999999999$8$1$AAAA$AAAA')).toBe(false);
  });
  it('recovery codes are 6 digits, keep leading zeros and look uniform', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = newRecoveryCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(290);
    expect(recoveryDigest('pepper', 'user', '000123')).not.toBe(recoveryDigest('other pepper', 'user', '000123'));
  });
  it('JWT round trip', async () => {
    const t = await signSession('s'.repeat(32), 'abc', 3, 1);
    expect(await readSession('s'.repeat(32), t)).toEqual({ sub: 'abc', ver: 3 });
    expect(await readSession('t'.repeat(32), t)).toBeNull();
  });
});
