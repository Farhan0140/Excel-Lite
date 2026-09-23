import { useEffect } from 'react';
import type { Store } from '../engine/store';
import type { SyncManager } from '../auth/sync';

/* Ask before the page is closed, refreshed, or navigated away from while something would be lost:
   text you are still typing, a change waiting for Confirm/Cancel, or an edit that has not reached
   the server yet. Every modern browser ignores a custom message here and shows its own fixed wording
   ("Leave site? Changes you made may not be saved") — that is a browser security rule, not a bug. */
export function useUnsavedGuard(store: Store, sync: SyncManager) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const atRisk = store.editing || store.pending !== null || sync.dirty;
      if (!atRisk) return;
      e.preventDefault();
      e.returnValue = ''; // Chrome only shows the prompt when this is set
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store, sync]);
}
