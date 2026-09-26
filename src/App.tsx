import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import type { Store } from './engine/store';
import type { User } from './auth/api';
import type { SyncManager } from './auth/sync';
import { pwaUpdate } from './pwa';
import { AccountPanel, SYNC_TEXT, useSyncStatus } from './components/AccountPanel';
import { StoreContext, useStoreSync } from './store-context';
import type { useTheme } from './theme';
import { useKeyboardMode } from './hooks/useKeyboardMode';
import { useUnsavedGuard } from './hooks/useUnsavedGuard';
import { Header, StatusBar, TabBar, Toast } from './components/Bars';
import { Toolbar } from './components/Toolbar';
import type { ToolPanel } from './components/Toolbar';
import { FormulaBar, SuggestBar } from './components/Editing';
import { Sheet } from './components/Grid';
import { MenuPanel } from './components/MenuPanel';
import { ThemePanel } from './components/ThemePanel';
import { GuideModal } from './components/GuideModal';
import { ConfirmModal } from './components/ConfirmModal';

type Top = 'menu' | 'theme' | 'guide' | 'account' | null;

export default function App({
  store, sync, user, theme, onSignedOut,
}: { store: Store; sync: SyncManager; user: User; theme: ReturnType<typeof useTheme>; onSignedOut: (clearLocal: boolean) => void }) {
  useStoreSync(store);
  const syncStatus = useSyncStatus(sync);
  const kb = useKeyboardMode(store);
  useUnsavedGuard(store, sync);
  const [top, setTop] = useState<Top>(null);
  const [tool, setTool] = useState<ToolPanel>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const pwa = useSyncExternalStore(pwaUpdate.subscribe, pwaUpdate.getSnapshot);

  useEffect(() => {
    if (pwa.offlineReady) { store.flash('Ready to work offline.'); pwaUpdate.dismissOfflineReady(); }
  }, [pwa.offlineReady, store]);

  // function suggestions depend on the caret, so refresh them once the inputs have been redrawn
  useLayoutEffect(() => {
    if (store.editing || store.sugItems.length) store.updateSug();
  });

  // page-wide listeners: click-away finishes an edit, copy / paste, dropping a backup file
  useEffect(() => {
    const onDown = (e: MouseEvent) => store.onDocMouseDown(e);
    const onUp = () => store.onMouseUp();
    const onCopy = (e: ClipboardEvent) => store.onDocCopy(e);
    const onPaste = (e: ClipboardEvent) => store.onDocPaste(e);
    const onSel = () => { if (store.editing) store.updateSug(); };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        store.readBackupFile(e.dataTransfer.files[0]);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [store]);

  // start on the grid, so the keyboard shortcuts work straight away
  useEffect(() => { store.focusGrid(); }, [store]);

  const closeTop = () => { setTop(null); store.focusGrid(); };
  const openFile = () => fileIn.current?.click();
  const fxKb = kb && store.fxEditing();

  return (
    <StoreContext.Provider value={store}>
      <ConfirmModal store={store} />
      {/* everything except the grid and the formula bar hides while the phone keyboard is up */}
      {!kb && (
        <Header
          menuOpen={top === 'menu'}
          themeOpen={top === 'theme'}
          accountOpen={top === 'account'}
          syncStatus={syncStatus}
          onAccount={() => { setTool(null); setTop(top === 'account' ? null : 'account'); }}
          onMenu={() => { setTool(null); setTop(top === 'menu' ? null : 'menu'); }}
          onTheme={() => { setTool(null); setTop(top === 'theme' ? null : 'theme'); }}
          onGuide={() => { setTool(null); setTop('guide'); }}
          menuPanel={
            <MenuPanel
              store={store}
              open={top === 'menu'}
              onClose={closeTop}
              onOpenFile={openFile}
              onGuide={() => setTop('guide')}
              onTheme={() => setTop('theme')}
              onAccount={() => setTop('account')}
            />
          }
          accountPanel={<AccountPanel open={top === 'account'} onClose={closeTop} user={user} sync={sync} onSignedOut={onSignedOut} />}
          themePanel={
            <ThemePanel
              open={top === 'theme'}
              onClose={closeTop}
              mode={theme.mode}
              palette={theme.palette}
              dark={theme.dark}
              setMode={theme.setMode}
              setPalette={theme.setPalette}
            />
          }
        />
      )}
      {!kb && <Toolbar store={store} panel={tool} setPanel={(p) => { setTop(null); setTool(p); }} />}

      {pwa.needRefresh && (
        <div role="status" className="mx-2.5 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-softaccent px-3 py-2 text-[13.5px] sm:mx-4">
          <RefreshCw size={18} className="flex-none text-accent" aria-hidden />
          <span className="min-w-0 flex-1 basis-56">A new version of the app is ready.</span>
          <button type="button" onClick={pwaUpdate.apply} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-onaccent">Reload</button>
        </div>
      )}

      {/* the ledger was changed on another device while this one had unsaved changes: never overwrite silently */}
      {syncStatus === 'conflict' && (
        <div role="alert" className="mx-2.5 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-fx/60 bg-fx/15 px-3 py-2 text-[13.5px] sm:mx-4">
          <TriangleAlert size={18} className="flex-none text-fx" aria-hidden />
          <span className="min-w-0 flex-1 basis-56">{SYNC_TEXT.conflict} Which version do you want to keep?</span>
          <button type="button" onClick={() => void sync.useServerVersion()} className="rounded-lg border border-line bg-panel px-3 py-1.5 font-medium hover:border-accent">Use the other version</button>
          <button type="button" onClick={() => void sync.keepMine()} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-onaccent">Keep mine</button>
        </div>
      )}

      <FormulaBar store={store} kb={kb} />
      <SuggestBar store={store} kb={kb} />

      <div className={'relative flex min-h-0 flex-1 flex-col ' + (kb ? 'mx-1.5 mb-1.5' : 'mx-2.5 sm:mx-4')}>
        <Sheet store={store} />
        <Toast store={store} />
      </div>

      {(!kb || fxKb) && <TabBar store={store} kb={kb} />}
      {!kb && <StatusBar store={store} syncNote={syncStatus === 'offline' ? SYNC_TEXT.offline : syncStatus === 'error' ? SYNC_TEXT.error : undefined} />}

      <GuideModal open={top === 'guide'} onClose={closeTop} />
      <input
        ref={fileIn}
        type="file"
        accept=".json,application/json,text/plain"
        className="hidden"
        aria-label="Backup file"
        onChange={(e) => {
          store.readBackupFile(e.target.files && e.target.files[0]);
          e.target.value = '';
        }}
      />
    </StoreContext.Provider>
  );
}
