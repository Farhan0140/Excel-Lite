import initSqlJs, { type Database } from 'sql.js';
import type { KV } from '../auth/sync';

/* The browser has no native SQLite, so this loads sql.js (real SQLite compiled to WebAssembly) and
   keeps the one open Database in memory, persisting its serialized bytes to IndexedDB — a snapshot,
   not a stream of writes — so a reload picks up where the last save left off. This is the local
   source of truth: every read/write the app makes (accounts, workbooks, sync queue) goes through the
   synchronous KV surface below, same shape as the old localStorage-backed adapter, so nothing above
   this file (Store, sync.ts) needs to change. */

const DB_NAME = 'household-ledger-sql';
const STORE = 'snapshots';
const SNAPSHOT_KEY = 'db';
const FLUSH_DELAY_MS = 400;

export type SqlKV = KV & { key(i: number): string | null; length: number; flush(): Promise<void> };

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSnapshot(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(SNAPSHOT_KEY);
    req.onsuccess = () => {
      idb.close();
      const v = req.result as Uint8Array | undefined;
      resolve(v ?? null);
    };
    req.onerror = () => { idb.close(); reject(req.error); };
  });
}

async function saveSnapshot(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, SNAPSHOT_KEY);
    tx.oncomplete = () => { idb.close(); resolve(); };
    tx.onerror = () => { idb.close(); reject(tx.error); };
  });
}

/* Opens (or creates) the on-device database and returns a synchronous KV surface backed by it.
   Call once, before anything else touches storage; the result can be shared by every reader/writer
   in the app, same as the localStorage object it replaces. */
export async function initSqlStorage(): Promise<SqlKV> {
  const SQL = await initSqlJs({ locateFile: (f) => '/' + f });
  const existing = await loadSnapshot().catch(() => null);
  const db: Database = existing ? new SQL.Database(existing) : new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    pending = false;
    await saveSnapshot(db.export());
  };
  const scheduleFlush = () => {
    pending = true;
    if (timer) return;
    timer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
  };
  // best-effort: catch the tab actually closing/backgrounding, since the debounce timer won't fire by itself
  const flushNow = () => { void flush(); };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
    window.addEventListener('pagehide', flushNow);
  }

  const allKeys = (): string[] => {
    const out: string[] = [];
    const stmt = db.prepare('SELECT key FROM kv ORDER BY key');
    try { while (stmt.step()) out.push(stmt.get()[0] as string); } finally { stmt.free(); }
    return out;
  };

  return {
    getItem(k: string): string | null {
      const stmt = db.prepare('SELECT value FROM kv WHERE key = ?');
      try {
        stmt.bind([k]);
        return stmt.step() ? (stmt.get()[0] as string) : null;
      } finally { stmt.free(); }
    },
    setItem(k: string, v: string): void {
      db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
      scheduleFlush();
    },
    removeItem(k: string): void {
      db.run('DELETE FROM kv WHERE key = ?', [k]);
      scheduleFlush();
    },
    get length(): number { return allKeys().length; },
    key(i: number): string | null { return allKeys()[i] ?? null; },
    flush,
  };
}
