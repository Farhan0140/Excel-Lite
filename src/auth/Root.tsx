import { useEffect, useState } from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { api, ApiError } from './api';
import type { User } from './api';
import { AuthScreen, AuthShell, ErrorNote } from './AuthScreen';
import { RecoveryCodeScreen } from './RecoveryCode';
import type { CodeKind } from './RecoveryCode';
import { bootstrap, clearScoped, LEGACY_KEYS, scopedStorage, SyncManager } from './sync';
import type { KV } from './sync';
import { Store } from '../engine/store';
import { useTheme } from '../theme';
import App from '../App';

const CACHED_USER = 'hl-last-user';

const browserKV = (): (KV & { key(i: number): string | null; length: number }) | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked: the app still works, it just cannot keep a copy on this device
  }
};
const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

type Phase =
  | { t: 'loading' }
  | { t: 'offline' }
  | { t: 'anon'; notice?: string; email?: string }
  | { t: 'code'; user: User; code: string; kind: CodeKind }
  | { t: 'authed'; user: User };

export default function Root() {
  const theme = useTheme(); // applies the saved colours to every screen, including sign in
  const [phase, setPhase] = useState<Phase>({ t: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // who am I? (the browser sends the session cookie by itself)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await api.me();
        if (dead) return;
        remember(r.user);
        setPhase({ t: 'authed', user: r.user });
      } catch (e) {
        if (dead) return;
        if (e instanceof ApiError && e.network) {
          // no connection: open the copy kept on this device, if this device has been signed in before
          const cached = readCached();
          setPhase(cached ? { t: 'authed', user: cached } : { t: 'offline' });
        } else setPhase({ t: 'anon' });
      }
    })();
    return () => { dead = true; };
  }, [attempt]);

  const finish = (user: User, code: string | null, kind: 'signin' | 'signup' | 'reset') => {
    remember(user);
    setPhase(code ? { t: 'code', user, code, kind: kind === 'reset' ? 'reset' : 'signup' } : { t: 'authed', user });
  };

  if (phase.t === 'loading') {
    return (
      <div className="grid flex-1 place-items-center text-muted" role="status" aria-live="polite">
        <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} aria-hidden /> Loading…</span>
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
    return <RecoveryCodeScreen code={phase.code} email={phase.user.email} kind={phase.kind} onDone={() => setPhase({ t: 'authed', user: phase.user })} />;
  }
  return (
    <Session
      key={phase.user.id}
      user={phase.user}
      theme={theme}
      onSignedOut={(clearLocal) => {
        if (clearLocal) {
          const kv = browserKV();
          if (kv) clearScoped(kv, phase.user.id);
        }
        try { localStorage.removeItem(CACHED_USER); } catch { /* ignore */ }
        setPhase({ t: 'anon' });
      }}
      onExpired={() => setPhase({ t: 'anon', email: phase.user.email, notice: 'Your session ended. Sign in again to keep saving. Changes you made are safe on this device.' })}
    />
  );
}

function remember(u: User) {
  try { localStorage.setItem(CACHED_USER, JSON.stringify(u)); } catch { /* ignore */ }
}
function readCached(): User | null {
  try {
    const u = JSON.parse(localStorage.getItem(CACHED_USER) || 'null');
    return u && typeof u.id === 'string' && typeof u.email === 'string' ? u : null;
  } catch {
    return null;
  }
}

/* signed in: load the ledger (server copy or this device's copy), then run the sheet with sync switched on */
function Session({
  user, theme, onSignedOut, onExpired,
}: { user: User; theme: ReturnType<typeof useTheme>; onSignedOut: (clearLocal: boolean) => void; onExpired: () => void }) {
  const [ready, setReady] = useState<{ store: Store; sync: SyncManager } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    let sync: SyncManager | null = null;
    setError('');
    (async () => {
      const base = browserKV();
      const kv = base ? scopedStorage(base, user.id) : memoryKV();
      try {
        const boot = await bootstrap(api, kv, base);
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
  }, [user.id, attempt]);

  if (error) {
    return (
      <AuthShell>
        <h2 className="mb-2 font-display text-xl font-bold">Could not open your ledger</h2>
        <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent">Try again</button>
          <button type="button" onClick={() => { void api.signout().catch(() => {}); onSignedOut(false); }} className="rounded-lg border border-line bg-panel px-4 py-3 text-[15px] font-medium">Sign out</button>
        </div>
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
