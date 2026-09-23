import { useEffect, useRef } from 'react';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import type { Store } from '../engine/store';

/* The permission modal: "Change A4 from 0 to 10?" and similar, shown before any edit takes effect
   while confirmMode is on. While one is open it blocks every other action — no stray keystroke or
   click can reach the grid underneath, so a second edit can never race the one waiting for an answer. */
export function ConfirmModal({ store }: { store: Store }) {
  const p = store.pending;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!p) return;
    // focus the safer button first: Cancel for something destructive, Confirm otherwise (fast workflow)
    (p.danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); store.confirmPending(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); store.cancelPending(); return; }
      if (e.key === 'Tab') { e.stopPropagation(); return; } // let focus move between the two buttons
      // swallow everything else so it can never reach the grid underneath
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [p, store]);

  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div aria-hidden className="anim-fade absolute inset-0 bg-black/55" onClick={() => store.cancelPending()} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="anim-pop relative w-full max-w-sm rounded-2xl border border-line bg-panel p-5 text-ink shadow-[var(--shadow)]"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <span aria-hidden className={'grid size-9 flex-none place-items-center rounded-full ' + (p.danger ? 'bg-err/15 text-err' : 'bg-softaccent text-accent')}>
            {p.danger ? <TriangleAlert size={18} /> : <CircleHelp size={18} />}
          </span>
          <h2 id="confirm-title" className="font-display text-lg font-bold">{p.title}</h2>
        </div>
        <p id="confirm-message" className="mb-5 text-[14.5px] leading-relaxed">{p.message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => store.cancelPending()}
            className="rounded-lg border border-line bg-cell px-4 py-2 text-[14px] font-medium hover:border-lineStrong"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => store.confirmPending()}
            className={'rounded-lg px-4 py-2 text-[14px] font-semibold text-onaccent hover:opacity-90 ' + (p.danger ? 'bg-err' : 'bg-accent')}
          >
            {p.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
