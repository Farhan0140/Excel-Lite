import { registerSW } from 'virtual:pwa-register';

/* Lets the installed app open (and re-open) with no connection at all: the service worker keeps a
   cached copy of the app shell (HTML/JS/CSS/wasm), separate from the ledger data itself, which already
   lives in an on-device SQLite database (see storage/sqlite.ts) and only ever talks to the server
   through SyncManager. A new shell is downloaded quietly in the background; this just tracks whether
   one is ready, so the UI can offer a reload instead of forcing one mid-edit. */

interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
}

let state: PwaState = { needRefresh: false, offlineReady: false };
let reload: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// call once, at startup; a no-op outside a real service-worker-capable browser
export function initPwa() {
  if (reload || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  reload = registerSW({
    onNeedRefresh: () => set({ needRefresh: true }),
    onOfflineReady: () => set({ offlineReady: true }),
  });
}

export const pwaUpdate = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => void listeners.delete(fn); },
  getSnapshot: () => state,
  apply: () => void reload?.(true),
  dismissOfflineReady: () => set({ offlineReady: false }),
};
