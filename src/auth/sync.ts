import { ApiError } from './api';
import type { Api } from './api';
import type { Store } from '../engine/store';
import { cleanWorkbook, loadWorkbook, sampleWorkbook } from '../engine/model';
import type { StorageLike } from '../engine/model';
import type { Workbook } from '../engine/types';

/* Local-first sync. The ledger always lives in this device's storage too, so it opens instantly and keeps
   working without a connection; changes are sent to the server a moment after you stop typing. */

export type SyncStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'error' | 'conflict' | 'expired';

export interface KV extends StorageLike { removeItem(k: string): void }

// one user's private corner of the browser storage (so two people sharing a device never see each other's ledger)
export function scopedStorage(base: KV, userId: string): KV {
  const p = `hl:${userId}:`;
  return { getItem: (k) => base.getItem(p + k), setItem: (k, v) => base.setItem(p + k, v), removeItem: (k) => base.removeItem(p + k) };
}
export function clearScoped(base: KV & { key(i: number): string | null; length: number }, userId: string) {
  const p = `hl:${userId}:`;
  const keys: string[] = [];
  for (let i = 0; i < base.length; i++) { const k = base.key(i); if (k && k.startsWith(p)) keys.push(k); }
  keys.forEach((k) => base.removeItem(k));
}

const WB = 'household-ledger-v2'; // the key Store/loadWorkbook use inside the scoped storage
const REV = 'sync-rev';
const DIRTY = 'sync-dirty';
export const LEGACY_KEYS = ['household-ledger-v1', 'household-ledger-v2'];

export interface Boot {
  workbook: Workbook;
  revision: number; // the server revision this copy is based on
  dirty: boolean; // has changes the server has not seen
  status: SyncStatus;
  fromLegacy: boolean; // taken over from the pre-account local copy
}

/* Decide what to open with: the server copy, or this device's copy when it has unsaved work. */
export async function bootstrap(api: Api, kv: KV, legacy: KV | null): Promise<Boot> {
  let remote: Awaited<ReturnType<Api['getWorkbook']>> | null = null;
  try {
    remote = await api.getWorkbook();
  } catch (e) {
    if (!(e instanceof ApiError && e.network)) throw e;
  }
  const hasLocal = !!kv.getItem(WB);
  const localDirty = kv.getItem(DIRTY) === '1';
  const localRev = Number(kv.getItem(REV)) || 0;

  if (!remote) {
    // no connection: work from this device's copy
    if (!hasLocal) throw new ApiError(0, 'network', "Can't reach the server, and there is no copy of your ledger on this device yet.");
    return { workbook: loadWorkbook(kv), revision: localRev, dirty: localDirty, status: 'offline', fromLegacy: false };
  }
  const remoteWb = remote.data ? cleanWorkbook(remote.data) : null;

  if (!remoteWb) {
    // the server has nothing yet (a new account): start from this device's ledger, else the ledger from before accounts existed, else the example
    const hasLegacy = !hasLocal && !!legacy && LEGACY_KEYS.some((k) => legacy.getItem(k));
    const workbook = hasLocal ? loadWorkbook(kv) : hasLegacy ? loadWorkbook(legacy) : sampleWorkbook();
    return { workbook, revision: remote.revision, dirty: true, status: 'pending', fromLegacy: hasLegacy };
  }
  if (hasLocal && localDirty) {
    // unsaved work on this device: keep it, unless the server moved on in the meantime
    const workbook = loadWorkbook(kv);
    return { workbook, revision: remote.revision, dirty: true, status: localRev === remote.revision ? 'pending' : 'conflict', fromLegacy: false };
  }
  return { workbook: remoteWb, revision: remote.revision, dirty: false, status: 'saved', fromLegacy: false };
}

export interface SyncOptions {
  delayMs?: number;
  onExpired?: () => void;
  onSaved?: () => void;
}

const BACKOFF = [3000, 8000, 20000, 45000, 60000];

export class SyncManager {
  status: SyncStatus;
  revision: number;
  tick = 0;
  dirty: boolean;
  private version = 0; // counts changes, to notice edits made while a save is on its way
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private inflight: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];

  constructor(private store: Store, private api: Api, private kv: KV, boot: Pick<Boot, 'revision' | 'dirty' | 'status'>, private opts: SyncOptions = {}) {
    this.status = boot.status;
    this.revision = boot.revision;
    this.dirty = boot.dirty;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.tick;
  private set(s: SyncStatus) {
    this.status = s;
    this.tick++;
    this.listeners.forEach((l) => l());
  }

  start() {
    this.store.onPersist = () => this.touch();
    // React Native defines a `window` global too (so browser-detection checks in shared libraries do
    // not crash), but it has no addEventListener — so this also confirms the DOM API is really there
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof document !== 'undefined') {
      const now = () => void this.flush();
      const hide = () => { if (document.visibilityState === 'hidden') void this.flush(true); };
      window.addEventListener('online', now);
      window.addEventListener('pagehide', now);
      document.addEventListener('visibilitychange', hide);
      this.cleanup.push(() => window.removeEventListener('online', now), () => window.removeEventListener('pagehide', now), () => document.removeEventListener('visibilitychange', hide));
    }
    if (this.dirty && this.status === 'pending') this.schedule(300);
  }
  stop() {
    clearTimeout(this.timer);
    if (this.store.onPersist) this.store.onPersist = null;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  // the store reports a change to keep
  touch() {
    this.version++;
    this.dirty = true;
    try { this.kv.setItem(DIRTY, '1'); } catch { /* storage full or blocked */ }
    if (this.status === 'conflict' || this.status === 'expired') return; // wait for a decision / a new sign-in
    if (this.status !== 'saving') this.set('pending');
    this.schedule(this.opts.delayMs ?? 1500);
  }
  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  // send changes now; resolves true when the server has everything
  flush(keepalive = false): Promise<boolean> {
    if (this.inflight) return this.inflight.then(() => (this.dirty ? this.flush(keepalive) : true));
    if (!this.dirty) return Promise.resolve(true);
    if (this.status === 'conflict' || this.status === 'expired') return Promise.resolve(false);
    clearTimeout(this.timer);
    this.inflight = this.save(keepalive).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async save(keepalive: boolean): Promise<boolean> {
    const v = this.version;
    this.set('saving');
    try {
      const r = await this.api.putWorkbook(this.store.snapshot(), this.revision, false, keepalive);
      this.revision = r.revision;
      this.retries = 0;
      try { this.kv.setItem(REV, String(r.revision)); } catch { /* ignore */ }
      if (this.version === v) {
        this.dirty = false;
        try { this.kv.setItem(DIRTY, '0'); } catch { /* ignore */ }
        this.set('saved');
        this.opts.onSaved?.();
      } else {
        this.set('pending'); // edited again while saving
        this.schedule(200);
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        this.revision = Number(e.extra.revision) || this.revision;
        this.set('conflict');
      } else if (e instanceof ApiError && e.status === 401) {
        this.set('expired');
        this.opts.onExpired?.();
      } else {
        this.set(e instanceof ApiError && e.network ? 'offline' : 'error');
        this.schedule(BACKOFF[Math.min(this.retries++, BACKOFF.length - 1)]);
      }
      return false;
    }
  }

  /* --- the two ways out of a conflict --- */
  // throw away this device's unsaved changes and load what is on the server
  async useServerVersion(): Promise<boolean> {
    try {
      const remote = await this.api.getWorkbook();
      const wb = remote.data ? cleanWorkbook(remote.data) : null;
      if (!wb) return this.keepMine();
      this.store.replaceWorkbook(wb);
      this.revision = remote.revision;
      this.dirty = false;
      this.version++;
      try { this.kv.setItem(REV, String(remote.revision)); this.kv.setItem(DIRTY, '0'); } catch { /* ignore */ }
      this.set('saved');
      return true;
    } catch (e) {
      this.set(e instanceof ApiError && e.network ? 'offline' : this.status);
      return false;
    }
  }
  // overwrite the server with what is on this device
  async keepMine(): Promise<boolean> {
    try {
      const v = this.version;
      const r = await this.api.putWorkbook(this.store.snapshot(), this.revision, true);
      this.revision = r.revision;
      try { this.kv.setItem(REV, String(r.revision)); } catch { /* ignore */ }
      if (this.version === v) {
        this.dirty = false;
        try { this.kv.setItem(DIRTY, '0'); } catch { /* ignore */ }
        this.set('saved');
      } else {
        this.set('pending');
        this.schedule(200);
      }
      return true;
    } catch (e) {
      this.set(e instanceof ApiError && e.network ? 'offline' : 'error');
      return false;
    }
  }
}
