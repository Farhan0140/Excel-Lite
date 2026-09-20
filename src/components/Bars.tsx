import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, Menu, Palette, Plus, UserRound } from 'lucide-react';
import type { SyncStatus } from '../auth/sync';
import { SyncDot } from './AccountPanel';
import type { Store } from '../engine/store';
import { fmt } from '../engine/refs';
import { IconButton } from './ui';

/* ------------------------------------------------------------------ header */
export function Header({
  menuOpen, themeOpen, accountOpen, syncStatus, onMenu, onTheme, onAccount, onGuide, menuPanel, themePanel, accountPanel,
}: {
  menuOpen: boolean; themeOpen: boolean; accountOpen: boolean; syncStatus: SyncStatus;
  onMenu: () => void; onTheme: () => void; onAccount: () => void; onGuide: () => void;
  menuPanel: ReactNode; themePanel: ReactNode; accountPanel: ReactNode;
}) {
  return (
    <header className="flex flex-none items-center gap-2 px-2.5 pb-1.5 pt-2 sm:gap-3 sm:px-4 sm:pt-3">
      <span aria-hidden className="grid size-8 flex-none place-items-center rounded-lg bg-accent text-onaccent sm:size-9">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
          <path d="M3.5 9.5h17M3.5 15h17M10 3.5v17" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-5">
        <h1 className="truncate font-display text-[19px] font-bold leading-tight tracking-tight sm:text-2xl">Household ledger</h1>
        <p className="hidden truncate text-[13px] text-muted lg:block">Select a block, copy it, paste it below. Its formulas move with it.</p>
      </div>

      <div className="flex flex-none items-center gap-0.5 sm:gap-1">
        {/* Guide and Theme are also in the Menu, so on a small phone only Account and Menu are shown here */}
        <div className="hidden sm:block">
          <IconButton icon={BookOpen} label="Guide: formulas and how to use each tool" onClick={onGuide} className="flex-none" />
        </div>
        <div className="relative">
          <div className="hidden sm:block">
            <IconButton icon={Palette} label="Theme" aria-expanded={themeOpen} onClick={onTheme} className="flex-none" />
          </div>
          {themePanel}
        </div>
        <div className="relative">
          <IconButton icon={UserRound} label={'Account: ' + (syncStatus === 'saved' ? 'all changes saved' : syncStatus)} aria-expanded={accountOpen} onClick={onAccount} className="relative flex-none" />
          <SyncDot status={syncStatus} className="pointer-events-none absolute right-0 top-0" />
          {accountPanel}
        </div>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onMenu}
            className="ml-1 flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-onaccent transition-opacity hover:opacity-90 active:opacity-80 coarse:h-10"
          >
            <Menu size={18} aria-hidden /> Menu
          </button>
          {menuPanel}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ tabs */
export function TabBar({ store, kb }: { store: Store; kb: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { W, renaming } = store;
  const fxKb = kb && store.fxEditing(); // typing a formula on a phone: tabs stay so you can point at other tabs

  // focus the rename box right away (inside the tap, so the phone keyboard opens)
  useLayoutEffect(() => {
    if (renaming >= 0 && input.current) {
      input.current.focus();
      input.current.select();
    }
  }, [renaming]);
  // keep the current tab in view
  useLayoutEffect(() => {
    if (renaming < 0) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [W.cur, W.sheets.length, renaming]);

  return (
    <div className={'flex flex-none items-center gap-2 ' + (kb ? 'mx-1.5 mb-1.5' : 'mx-2.5 mt-2 sm:mx-4')}>
      <div ref={list} role="tablist" aria-label="Tabs" className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        {W.sheets.map((sh, i) =>
          i === renaming ? (
            <input
              key={i}
              ref={input}
              defaultValue={sh.name}
              maxLength={30}
              aria-label="Tab name"
              spellCheck={false}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); store.finishRename(true, e.currentTarget.value); }
                else if (e.key === 'Escape') { e.preventDefault(); store.finishRename(false, ''); }
              }}
              onBlur={(e) => store.finishRename(true, e.currentTarget.value)}
              className="w-36 flex-none rounded-full border-2 border-accent bg-cell px-3 py-1 text-[13px] text-ink outline-none"
            />
          ) : (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === W.cur}
              data-keep-edit
              title={sh.name + ' (double-click to rename)'}
              onMouseDown={(e) => { if (store.fxEditing()) e.preventDefault(); }}
              onClick={() => {
                store.switchTo(i, true);
                if (!store.editing) store.focusGrid();
              }}
              onDoubleClick={() => {
                if (!store.editing) { store.switchTo(i); store.startRename(i); }
              }}
              className={
                'max-w-[190px] flex-none truncate rounded-full border px-3.5 py-1.5 text-[13px] transition-colors coarse:py-2 ' +
                (i === W.cur ? 'border-accent bg-accent font-semibold text-onaccent' : 'border-line bg-panel text-ink hover:border-accent')
              }
            >
              {sh.name}
            </button>
          ),
        )}
      </div>
      {!fxKb && (
        <IconButton icon={Plus} label="New tab" onClick={() => { store.addTab(); store.focusGrid(); }} className="flex-none border border-line bg-panel" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ status line */
export function StatusBar({ store, syncNote }: { store: Store; syncNote?: string }) {
  // Sum / average of the selected numbers, worked out only when the data or selection changes
  const stats = useMemo(() => {
    const R = store.rng(), cnt = (R.r1 - R.r0 + 1) * (R.c1 - R.c0 + 1);
    let n = 0, sum = 0;
    if (cnt > 1 && cnt <= 60000) {
      for (let r = R.r0; r <= R.r1; r++)
        for (let c = R.c0; c <= R.c1; c++) {
          const v = store.ev.numberAt(store.W.cur, r, c);
          if (v !== null) { sum += v; n++; }
        }
    }
    return cnt > 1 && n > 0 ? { sum, avg: sum / n, n } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ver, store.selVer]);

  return (
    <footer className="flex flex-none items-center justify-between gap-3 px-3 pb-2 pt-1.5 text-xs text-muted sm:px-5 sm:text-[12.5px]">
      <span className={'min-w-0 flex-1 truncate ' + (syncNote ? 'font-medium text-ink' : '')}>{store.msg ? '' : syncNote || store.hint}</span>
      {stats && (
        <span className="flex flex-none gap-3 whitespace-nowrap">
          <span>Sum <b className="font-semibold text-ink">{fmt(stats.sum)}</b></span>
          <span className="hidden min-[400px]:inline">Average <b className="font-semibold text-ink">{fmt(stats.avg)}</b></span>
          <span className="hidden sm:inline">Numbers <b className="font-semibold text-ink">{stats.n}</b></span>
        </span>
      )}
    </footer>
  );
}

/* a message that appears over the bottom of the grid (saved, copied, errors...) */
export function Toast({ store }: { store: Store }) {
  if (!store.msg) return null;
  return (
    <div
      key={store.msgId}
      role="status"
      aria-live="polite"
      className="anim-pop pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto w-fit max-w-[min(32rem,100%)] rounded-xl bg-ink px-4 py-2.5 text-[13px] leading-snug text-cell shadow-[var(--shadow)]"
    >
      {store.msg}
    </div>
  );
}
