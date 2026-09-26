import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, WifiOff } from 'lucide-react';
import { api, ApiError } from './api';
import type { User } from './api';
import { AuthScreen, AuthShell, ErrorNote } from './AuthScreen';
import { RecoveryCodeScreen } from './RecoveryCode';
import type { CodeKind } from './RecoveryCode';
import { bootFromBackup, bootstrap, clearScoped, LEGACY_KEYS, scopedStorage, SyncManager } from './sync';
import type { KV } from './sync';
import { looksLikeColdStart, retryUntilOk } from './wakeServer';
import { initSqlStorage } from '../storage/sqlite';
import { Store } from '../engine/store';
import { workbookFromBackup } from '../engine/model';
import type { Workbook } from '../engine/types';
import { useTheme } from '../theme';
import App from '../App';

const CACHED_USER = 'hl-last-user';

type BrowserKV = KV & { key(i: number): string | null; length: number };

const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

type Phase =
  | { t: 'loading' }
  | { t: 'waking'; attempt: number }
  | { t: 'offline' }
  | { t: 'anon'; notice?: string; email?: string }
  | { t: 'code'; user: User; code: string; kind: CodeKind }
  | { t: 'authed'; user: User; kv: BrowserKV | null };

export default function Root() {
  const theme = useTheme(); // applies the saved colours to every screen, including sign in
  const [phase, setPhase] = useState<Phase>({ t: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [kv, setKv] = useState<BrowserKV | null | undefined>(undefined); // undefined = still opening SQLite

  // open the on-device database once, before anything else touches storage
  useEffect(() => {
    let dead = false;
    (async () => {
      const store = await initSqlStorage().catch(() => null); // storage blocked: app still works, just no on-device copy
      if (!dead) setKv(store);
    })();
    return () => { dead = true; };
  }, []);

  // who am I? (the browser sends the session cookie by itself)
  useEffect(() => {
    if (kv === undefined) return; // wait for the local database to finish opening first
    let dead = false;
    (async () => {
      try {
        const r = await api.me();
        if (dead) return;
        remember(kv, r.user);
        setPhase({ t: 'authed', user: r.user, kv });
      } catch (e) {
        if (dead) return;
        if (e instanceof ApiError && e.status === 401) {
          setPhase({ t: 'anon' }); // definitely signed out: no point retrying
          return;
        }
        if (!looksLikeColdStart(e)) { setPhase({ t: 'anon' }); return; }
        // the browser itself has no connection at all (airplane mode, no signal, …): waking-up retries
        // would just burn ~2 minutes proving what we already know, so go straight to this device's copy
        if (e instanceof ApiError && e.network && typeof navigator !== 'undefined' && navigator.onLine === false) {
          const cached = readCached(kv);
          setPhase(cached ? { t: 'authed', user: cached, kv } : { t: 'offline' });
          return;
        }
        // network error, or a 5xx that looks like a still-booting free-tier host: keep retrying the
        // real request itself (not just a /health ping) until it actually answers, instead of giving
        // up after one attempt
        setPhase({ t: 'waking', attempt: 0 });
        try {
          const r = await retryUntilOk(() => api.me(), { onAttempt: (n) => { if (!dead) setPhase({ t: 'waking', attempt: n }); } });
          if (dead) return;
          remember(kv, r.user);
          setPhase({ t: 'authed', user: r.user, kv });
          return;
        } catch (e2) {
          if (dead) return;
          if (e2 instanceof ApiError && e2.status === 401) { setPhase({ t: 'anon' }); return; } // the server woke up and said "not signed in"
        }
        // exhausted the wait with no answer at all: open the copy kept on this device, if any
        const cached = readCached(kv);
        setPhase(cached ? { t: 'authed', user: cached, kv } : { t: 'offline' });
      }
    })();
    return () => { dead = true; };
  }, [attempt, kv]);

  // the device had no local copy either, so it's stuck on the "you are offline" screen: try again by
  // itself the moment the browser sees a connection, instead of waiting for the user to tap the button
  useEffect(() => {
    if (phase.t !== 'offline') return;
    const retry = () => { setPhase({ t: 'loading' }); setAttempt((a) => a + 1); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [phase.t]);

  const finish = (user: User, code: string | null, kind: 'signin' | 'signup' | 'reset') => {
    remember(kv ?? null, user);
    setPhase(code ? { t: 'code', user, code, kind: kind === 'reset' ? 'reset' : 'signup' } : { t: 'authed', user, kv: kv ?? null });
  };

  if (phase.t === 'loading' || kv === undefined) {
    return (
      <div className="grid flex-1 place-items-center text-muted" role="status" aria-live="polite">
        <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} aria-hidden /> Loading…</span>
      </div>
    );
  }
  if (phase.t === 'waking') {
    return (
      <div className="grid flex-1 place-items-center text-muted" role="status" aria-live="polite">
        <span className="flex items-center gap-2">
          <Loader2 className="animate-spin" size={20} aria-hidden />
          Waking up the server{phase.attempt > 1 ? ` (still trying, attempt ${phase.attempt})` : '…'}
        </span>
      </div>
    );
  }
  if (phase.t === 'offline') {
    return (
      <AuthShell>
        <div className="mb-3 flex items-center gap-2"><WifiOff size={22} className="text-muted" aria-hidden /><h2 className="font-display text-xl font-bold">You are offline</h2></div>
        <p className="mb-4 text-[14px] text-muted">We cannot reach the server, and this device has no saved copy yet. Connect to the internet and try again.</p>
        <button type="button" onClick={() => { setPhase({ t: 'loading' }); setAttempt((a) => a + 1); }} className="w-full rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent">Try again</button>
      </AuthShell>
    );
  }
  if (phase.t === 'anon') return <AuthScreen onDone={finish} notice={phase.notice} initialEmail={phase.email} />;
  if (phase.t === 'code') {
    return <RecoveryCodeScreen code={phase.code} email={phase.user.email} kind={phase.kind} onDone={() => setPhase({ t: 'authed', user: phase.user, kv: kv ?? null })} />;
  }
  return (
    <Session
      key={phase.user.id}
      user={phase.user}
      kv={phase.kv}
      theme={theme}
      onSignedOut={(clearLocal) => {
        if (clearLocal && phase.kv) clearScoped(phase.kv, phase.user.id);
        try { phase.kv?.removeItem(CACHED_USER); } catch { /* ignore */ }
        setPhase({ t: 'anon' });
      }}
      onExpired={() => setPhase({ t: 'anon', email: phase.user.email, notice: 'Your session ended. Sign in again to keep saving. Changes you made are safe on this device.' })}
    />
  );
}

function remember(kv: BrowserKV | null, u: User) {
  try { (kv ?? localStorage).setItem(CACHED_USER, JSON.stringify(u)); } catch { /* ignore */ }
}
function readCached(kv: BrowserKV | null): User | null {
  try {
    const u = JSON.parse((kv ?? localStorage).getItem(CACHED_USER) || 'null');
    return u && typeof u.id === 'string' && typeof u.email === 'string' ? u : null;
  } catch {
    return null;
  }
}

/* signed in: load the ledger (server copy or this device's copy), then run the sheet with sync switched on */
function Session({
  user, kv: base, theme, onSignedOut, onExpired,
}: { user: User; kv: BrowserKV | null; theme: ReturnType<typeof useTheme>; onSignedOut: (clearLocal: boolean) => void; onExpired: () => void }) {
  const [ready, setReady] = useState<{ store: Store; sync: SyncManager } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [backupWb, setBackupWb] = useState<Workbook | null>(null);
  const [backupError, setBackupError] = useState('');
  const backupIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    let sync: SyncManager | null = null;
    setError('');
    (async () => {
      const kv = base ? scopedStorage(base, user.id) : memoryKV();
      try {
        const boot = backupWb ? bootFromBackup(kv, backupWb) : await bootstrap(api, kv, base);
        if (dead) return;
        const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        const store = new Store(kv, coarse, boot.workbook);
        store.save(true); // this device now has its own copy (works offline)
        sync = new SyncManager(store, api, kv, boot, {
          onExpired,
          onSaved: () => {
            // the pre-account copy has been uploaded: remove it so the next person on this device does not inherit it
            if (boot.fromLegacy && base) LEGACY_KEYS.forEach((k) => base.removeItem(k));
          },
        });
        sync.start();
        setReady({ store, sync });
      } catch (e) {
        if (!dead) {
          if (e instanceof ApiError && e.status === 401) onExpired();
          else setError(e instanceof ApiError ? e.message : 'Could not load your ledger.');
        }
      }
    })();
    return () => {
      dead = true;
      sync?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, attempt, backupWb]);

  async function openBackupFile(f: File | undefined | null) {
    if (!f) return;
    setBackupError('');
    if (f.size > 20 * 1024 * 1024) { setBackupError('That file is too large to be a backup.'); return; }
    const text = await f.text().catch(() => null);
    const wb = text == null ? null : workbookFromBackup(text);
    if (!wb) { setBackupError('That file is not a Household ledger backup.'); return; }
    setBackupWb(wb); // re-runs the effect above, opening straight from this instead of the server
  }

  if (error) {
    return (
      <AuthShell>
        <h2 className="mb-2 font-display text-xl font-bold">Could not open your ledger</h2>
        <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent">Try again</button>
          <button type="button" onClick={() => backupIn.current?.click()} className="flex items-center justify-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[15px] font-medium hover:border-accent">
            <FolderOpen size={17} aria-hidden /> Open backup
          </button>
        </div>
        {backupError && <div className="mt-3"><ErrorNote>{backupError}</ErrorNote></div>}
        <p className="mt-3 text-[13px] leading-snug text-muted">If you saved a backup earlier (Menu → Save backup), open it here to keep working offline. It's reconciled with your account once you're back online.</p>
        <input
          ref={backupIn}
          type="file"
          accept=".json,application/json,text/plain"
          className="hidden"
          aria-label="Backup file"
          onChange={(e) => { void openBackupFile(e.target.files && e.target.files[0]); e.target.value = ''; }}
        />
      </AuthShell>
    );
  }
  if (!ready) {
    return (
      <div className="grid flex-1 place-items-center text-muted" role="status" aria-live="polite">
        <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} aria-hidden /> Opening your ledger…</span>
      </div>
    );
  }
  return <App store={ready.store} sync={ready.sync} user={user} theme={theme} onSignedOut={onSignedOut} />;
}
