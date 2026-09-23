import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { Api } from './api';
import { bootstrap, scopedStorage, SyncManager } from './sync';
import type { KV } from './sync';
import { Store } from '../engine/store';
import { sampleWorkbook, blank, setCell } from '../engine/model';
import type { Workbook } from '../engine/types';

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function wbWith(text: string): Workbook {
  const D = blank();
  setCell(D, 0, 0, { v: text });
  return { cur: 0, sheets: [{ name: 'Tab1', data: D }] };
}

// a fake server that behaves like the real one (revisions, conflicts)
function fakeApi(initial: { data: unknown; revision: number } | null = null) {
  const state = { data: initial ? initial.data : null, revision: initial ? initial.revision : 0, online: true, expired: false, puts: 0 };
  const api: Api = {
    me: async () => ({ user: { id: 'u1', email: 'a@b.c' } }),
    signup: async () => { throw new Error('unused'); },
    signin: async () => { throw new Error('unused'); },
    signout: async () => ({}),
    reset: async () => { throw new Error('unused'); },
    changePassword: async () => ({}),
    newRecoveryCode: async () => ({ recoveryCode: '123456' }),
    getWorkbook: async () => {
      if (!state.online) throw new ApiError(0, 'network', 'offline');
      return { data: state.data, revision: state.revision, updatedAt: null };
    },
    putWorkbook: async (json, base, force) => {
      if (!state.online) throw new ApiError(0, 'network', 'offline');
      if (state.expired) throw new ApiError(401, 'unauthenticated', 'sign in');
      if (!force && base !== state.revision) throw new ApiError(409, 'conflict', 'changed', { revision: state.revision });
      state.puts++;
      state.data = JSON.parse(json);
      state.revision++;
      return { revision: state.revision };
    },
  };
  return { api, state };
}

const text = (s: Store) => s.S.cells['0,0']?.v;
const type = (s: Store, v: string) => { s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 }; s.startEdit(v); s.commitEdit(); };

describe('bootstrap: what to open with', () => {
  it('a new account with no data starts from the example and marks it to be uploaded', async () => {
    const { api } = fakeApi();
    const b = await bootstrap(api, memKV(), null);
    expect(b.workbook.sheets.length).toBe(2);
    expect(b).toMatchObject({ dirty: true, status: 'pending', revision: 0, fromLegacy: false });
  });
  it('a new account takes over the ledger that was on this device before accounts existed', async () => {
    const { api } = fakeApi();
    const legacy = memKV();
    legacy.setItem('household-ledger-v2', JSON.stringify({ cur: 0, sheets: wbWith('mine').sheets }));
    const b = await bootstrap(api, memKV(), legacy);
    expect(b.workbook.sheets[0].data.cells['0,0'].v).toBe('mine');
    expect(b.fromLegacy).toBe(true);
  });
  it('an existing ledger on the server wins on a clean device', async () => {
    const { api } = fakeApi({ data: wbWith('server'), revision: 4 });
    const b = await bootstrap(api, memKV(), null);
    expect(b.workbook.sheets[0].data.cells['0,0'].v).toBe('server');
    expect(b).toMatchObject({ dirty: false, status: 'saved', revision: 4 });
  });
  it('unsaved work on this device is kept when the server has not changed', async () => {
    const { api } = fakeApi({ data: wbWith('server'), revision: 4 });
    const kv = memKV();
    kv.setItem('household-ledger-v2', JSON.stringify(wbWith('offline edit')));
    kv.setItem('sync-dirty', '1'); kv.setItem('sync-rev', '4');
    const b = await bootstrap(api, kv, null);
    expect(b.workbook.sheets[0].data.cells['0,0'].v).toBe('offline edit');
    expect(b).toMatchObject({ dirty: true, status: 'pending' });
  });
  it('unsaved work + a newer server copy is a conflict, not a silent overwrite', async () => {
    const { api } = fakeApi({ data: wbWith('server'), revision: 7 });
    const kv = memKV();
    kv.setItem('household-ledger-v2', JSON.stringify(wbWith('offline edit')));
    kv.setItem('sync-dirty', '1'); kv.setItem('sync-rev', '4');
    const b = await bootstrap(api, kv, null);
    expect(b).toMatchObject({ dirty: true, status: 'conflict', revision: 7 });
    expect(b.workbook.sheets[0].data.cells['0,0'].v).toBe('offline edit');
  });
  it('offline: opens the copy on this device; with no copy it says so', async () => {
    const { api, state } = fakeApi({ data: wbWith('server'), revision: 4 });
    state.online = false;
    await expect(bootstrap(api, memKV(), null)).rejects.toMatchObject({ status: 0 });
    const kv = memKV();
    kv.setItem('household-ledger-v2', JSON.stringify(wbWith('cached')));
    kv.setItem('sync-rev', '4');
    const b = await bootstrap(api, kv, null);
    expect(b.workbook.sheets[0].data.cells['0,0'].v).toBe('cached');
    expect(b.status).toBe('offline');
  });
  it('users on one device get separate storage', () => {
    const base = memKV();
    scopedStorage(base, 'alice').setItem('x', '1');
    expect(scopedStorage(base, 'bob').getItem('x')).toBeNull();
    expect(scopedStorage(base, 'alice').getItem('x')).toBe('1');
  });
});

describe('SyncManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: { data: unknown; revision: number } | null = { data: sampleWorkbook(), revision: 1 }, opts = {}) => {
    const { api, state } = fakeApi(initial);
    const kv = memKV();
    const store = new Store(kv, false, wbWith('start'));
    store.confirmMode = false; // these tests check syncing, not the confirmation layer
    const sync = new SyncManager(store, api, kv, { revision: initial ? initial.revision : 0, dirty: false, status: 'saved' }, { delayMs: 1000, ...opts });
    sync.start();
    return { api, state, kv, store, sync };
  };

  it('waits until you stop typing, then saves once', async () => {
    const { state, store, sync } = setup();
    type(store, 'a'); type(store, 'ab'); type(store, 'abc');
    expect(sync.status).toBe('pending');
    expect(state.puts).toBe(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(state.puts).toBe(1);
    expect(sync.status).toBe('saved');
    expect(sync.revision).toBe(2);
    expect((state.data as any).sheets[0].data.cells['0,0'].v).toBe('abc');
  });
  it('remembers unsaved work on the device (survives closing the page)', async () => {
    const { kv, store, state } = setup();
    state.online = false;
    type(store, 'offline');
    expect(kv.getItem('sync-dirty')).toBe('1');
  });
  it('offline: keeps trying with a growing delay and saves when the connection returns', async () => {
    const { state, store, sync } = setup();
    state.online = false;
    type(store, 'x');
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(3100);
    expect(sync.status).toBe('offline');
    state.online = true;
    await vi.advanceTimersByTimeAsync(8100);
    expect(sync.status).toBe('saved');
    expect(state.puts).toBe(1);
  });
  it('a change made while saving is sent right after, not lost', async () => {
    const { state, store, sync, api } = setup();
    let release!: () => void;
    const slow = api.putWorkbook;
    api.putWorkbook = (j, b, f, k) => new Promise((res, rej) => { release = () => slow(j, b, f, k).then(res, rej); });
    type(store, 'first');
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.status).toBe('saving');
    type(store, 'second');
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(sync.status).toBe('pending');
    api.putWorkbook = slow;
    await vi.advanceTimersByTimeAsync(400);
    expect(sync.status).toBe('saved');
    expect((state.data as any).sheets[0].data.cells['0,0'].v).toBe('second');
  });
  it('another device saved first: stops, reports a conflict, never overwrites', async () => {
    const { state, store, sync } = setup();
    state.revision = 5; // someone else saved
    type(store, 'mine');
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.status).toBe('conflict');
    expect(sync.revision).toBe(5);
    expect(state.puts).toBe(0);
    type(store, 'mine 2'); // more edits do not start uploads while the conflict is open
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.puts).toBe(0);
  });
  it('conflict -> use the server version', async () => {
    const { state, store, sync } = setup();
    state.revision = 5; state.data = wbWith('from other device');
    type(store, 'mine');
    await vi.advanceTimersByTimeAsync(1100);
    expect(await sync.useServerVersion()).toBe(true);
    expect(text(store)).toBe('from other device');
    expect(sync.status).toBe('saved');
    expect(sync.dirty).toBe(false);
    expect(store.hist.length).toBe(0);
  });
  it('conflict -> keep mine overwrites the server', async () => {
    const { state, store, sync } = setup();
    state.revision = 5; state.data = wbWith('from other device');
    type(store, 'mine');
    await vi.advanceTimersByTimeAsync(1100);
    expect(await sync.keepMine()).toBe(true);
    expect((state.data as any).sheets[0].data.cells['0,0'].v).toBe('mine');
    expect(sync.status).toBe('saved');
    expect(sync.revision).toBe(6);
  });
  it('an expired session is reported so the app can ask you to sign in again', async () => {
    const onExpired = vi.fn();
    const { state, store, sync } = setup(undefined, { onExpired });
    state.expired = true;
    type(store, 'x');
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.status).toBe('expired');
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(sync.dirty).toBe(true);
  });
  it('flush() saves immediately (used before signing out) and says whether everything is safe', async () => {
    const { state, store, sync } = setup();
    type(store, 'now');
    expect(await sync.flush()).toBe(true);
    expect(state.puts).toBe(1);
    state.online = false;
    type(store, 'again');
    expect(await sync.flush()).toBe(false);
    expect(sync.dirty).toBe(true);
  });
  it('loading a ledger from the server does not count as a change', async () => {
    const { state, store, sync } = setup();
    store.replaceWorkbook(wbWith('remote'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(state.puts).toBe(0);
    expect(sync.status).toBe('saved');
  });
});
