import { useEffect } from 'react';
import type { Store } from '../engine/store';
import type { SyncManager } from '../auth/sync';

/* Ask before the page is closed, refreshed, or navigated away from while something would be lost:
   text you are still typing, a change waiting for Confirm/Cancel, or an edit that has not reached
   the server yet. Every modern browser ignores a custom message here and shows its own fixed wording
   ("Leave site? Changes you made may not be saved") — that is a browser security rule, not a bug.

   Chrome for Android does not actually block the close when the person taps through that dialog
   anyway — a deliberate Chromium change (to stop the prompt being abused), not something a page can
   override. So the one loss that dialog can't prevent there — a cell still being typed, never
   committed to the workbook — is closed a different way: committing it the moment the app is
   backgrounded, which fires reliably even when beforeunload does not. Once committed it is covered by
   the same on-device save + sync queue as any other edit, so nothing is lost even if the close goes
   straight through. */
export function useUnsavedGuard(store: Store, sync: SyncManager) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const atRisk = store.editing || store.pending !== null || sync.dirty;
      if (!atRisk) return;
      e.preventDefault();
      e.returnValue = ''; // Chrome only shows the prompt when this is set
    };
    const commitIfHidden = () => { if (document.visibilityState === 'hidden' && store.editing) store.commitEdit(); };
    const commitNow = () => { if (store.editing) store.commitEdit(); };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('visibilitychange', commitIfHidden);
    window.addEventListener('pagehide', commitNow);
    return () => {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('visibilitychange', commitIfHidden);
      window.removeEventListener('pagehide', commitNow);
    };
  }, [store, sync]);
}
