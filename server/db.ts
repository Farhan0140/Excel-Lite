import pg from 'pg';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export type Query = <T = any>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
export interface Db {
  kind: 'postgres' | 'pglite';
  query: Query;
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* ---------- Neon / any Postgres ---------- */
export function connectPostgres(url: string): Db {
  // Neon's dashboard adds channel_binding=require; node-postgres does not implement it, so drop it (TLS is still enforced by sslmode)
  const u = new URL(url);
  u.searchParams.delete('channel_binding');
  const pool = new pg.Pool({ connectionString: u.toString(), max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  // Neon closes idle connections; without this handler an idle-client error would crash the process
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  const query: Query = async (text, params) => {
    const r = await pool.query(text, params as any[]);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    kind: 'postgres',
    query,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(async (text, params) => {
          const r = await client.query(text, params as any[]);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 } as QueryResult<any>;
        });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/* ---------- development / tests: real Postgres running inside this process (no install, no account) ---------- */
export async function connectPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dir);
  await db.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params) => {
      const r = await db.query(text, params as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
    tx: (fn) =>
      db.transaction((t) =>
        fn(async (text, params) => {
          const r = await t.query(text, params as any[]);
          return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
        }),
      ),
    close: () => db.close(),
  };
}

/* ---------- schema (safe to run on every start) ---------- */
const SCHEMA = [
  `create table if not exists users (
     id                    uuid primary key,
     email                 text not null,
     password_hash         text not null,
     recovery_hash         text not null,
     token_version         integer not null default 0,
     pw_failed             integer not null default 0,
     pw_locked_until       timestamptz,
     recovery_failed       integer not null default 0,
     recovery_locked_until timestamptz,
     created_at            timestamptz not null default now(),
     updated_at            timestamptz not null default now()
   )`,
  `create unique index if not exists users_email_lower_key on users (lower(email))`,
  `create table if not exists workbooks (
     user_id    uuid primary key references users(id) on delete cascade,
     data       jsonb not null,
     revision   integer not null default 1,
     updated_at timestamptz not null default now()
   )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}
