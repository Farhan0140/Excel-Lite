import { useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, CloudOff, KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import { api, ApiError } from '../auth/api';
import type { User } from '../auth/api';
import { ErrorNote, Field, Submit } from '../auth/AuthScreen';
import { RecoveryCodeBox } from '../auth/RecoveryCode';
import type { SyncManager, SyncStatus } from '../auth/sync';
import { PanelTitle, Popover } from './ui';

export const SYNC_TEXT: Record<SyncStatus, string> = {
  saved: 'All changes saved',
  pending: 'Saving in a moment…',
  saving: 'Saving…',
  offline: 'Offline. Changes are kept on this device and saved when you are back online.',
  error: 'Could not save right now. Trying again…',
  conflict: 'This ledger was changed on another device.',
  expired: 'Your session ended. Sign in again.',
};

export function useSyncStatus(sync: SyncManager): SyncStatus {
  useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  return sync.status;
}

export function SyncDot({ status, className = '' }: { status: SyncStatus; className?: string }) {
  const color = status === 'saved' ? 'bg-[#2f9e6f]' : status === 'conflict' || status === 'error' || status === 'expired' ? 'bg-err' : 'bg-fx';
  return <span aria-hidden className={'inline-block size-2.5 rounded-full ring-2 ring-panel ' + color + ' ' + className} />;
}

type View = 'main' | 'password' | 'ask-code' | 'code';

export function AccountPanel({
  open, onClose, user, sync, onSignedOut,
}: { open: boolean; onClose: () => void; user: User; sync: SyncManager; onSignedOut: (clearLocal: boolean) => void }) {
  const status = useSyncStatus(sync);
  const [view, setView] = useState<View>('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newCode, setNewCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState(false);

  const close = () => {
    setView('main'); setError(''); setNote(''); setCurrent(''); setNext(''); setNewCode(''); setSaved(false); setArmed(false);
    onClose();
  };
  const back = () => { setView('main'); setError(''); setCurrent(''); setNext(''); };

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!current) return setError('Enter your current password.');
    if (next.length < 8) return setError('The new password must be at least 8 characters.');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setNote('Password changed. Other devices have been signed out.');
      back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  }
  async function makeCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!current) return setError('Enter your password to continue.');
    setBusy(true);
    try {
      const r = await api.newRecoveryCode(current);
      setNewCode(r.recoveryCode);
      setCurrent('');
      setView('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  }
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    const ok = await sync.flush(); // make sure the server has everything first
    if (!ok && sync.dirty && !armed) {
      setArmed(true);
      setBusy(false);
      setNote('Some changes are not saved to your account yet. Press Sign out again to leave anyway. They stay on this device.');
      return;
    }
    try {
      await api.signout();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.network) return setError('You are offline, so we cannot sign you out yet. Try again when you are connected.');
    }
    onSignedOut(!sync.dirty); // a clean sign out also removes this device's copy
  }

  return (
    <Popover open={open} onClose={close} variant="sheet" title="Account" panelClass="sm:w-[24rem]">
      <PanelTitle onClose={close}>{view === 'password' ? 'Change password' : view === 'main' ? 'Account' : 'Recovery code'}</PanelTitle>
      <div className="px-4 pb-4 pt-1">
        {view === 'main' && (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-head px-3 py-3">
              <span className="grid size-10 flex-none place-items-center rounded-full bg-accent text-onaccent"><UserRound size={20} aria-hidden /></span>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" data-testid="account-email">{user.email}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted" role="status" data-testid="sync-status">
                  {status === 'saving' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : status === 'saved' ? <CheckCircle2 size={13} className="text-[#2f9e6f]" aria-hidden /> : status === 'offline' ? <CloudOff size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
                  <span>{SYNC_TEXT[status]}</span>
                </div>
              </div>
            </div>

            {status !== 'saved' && status !== 'saving' && status !== 'conflict' && (
              <button type="button" onClick={() => void sync.flush()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel py-2.5 text-[14px] font-medium hover:border-accent">
                <RefreshCw size={16} aria-hidden /> Save now
              </button>
            )}
            {note && <div role="status" className="mt-3 rounded-lg border border-accent/40 bg-softaccent px-3 py-2 text-[13.5px]">{note}</div>}
            {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

            <ul className="mt-3 space-y-1">
              <li>
                <button type="button" onClick={() => { setNote(''); setView('password'); }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-softaccent">
                  <span className="grid size-9 place-items-center rounded-lg bg-softaccent text-accent"><KeyRound size={19} aria-hidden /></span>
                  <span><span className="block text-[14px] font-medium">Change password</span><span className="block text-xs text-muted">Signs your other devices out</span></span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => { setNote(''); setView('ask-code'); }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-softaccent">
                  <span className="grid size-9 place-items-center rounded-lg bg-softaccent text-accent"><ShieldCheck size={19} aria-hidden /></span>
                  <span><span className="block text-[14px] font-medium">New recovery code</span><span className="block text-xs text-muted">Lost your code? Make a new 6 digit one</span></span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => void signOut()} disabled={busy} className={'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-softaccent disabled:opacity-60 ' + (armed ? 'bg-err/15' : '')}>
                  <span className="grid size-9 place-items-center rounded-lg bg-err/15 text-err">{busy ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <LogOut size={19} aria-hidden />}</span>
                  <span><span className="block text-[14px] font-medium text-err">{armed ? 'Sign out anyway' : 'Sign out'}</span><span className="block text-xs text-muted">Your ledger stays safe in your account</span></span>
                </button>
              </li>
            </ul>
          </>
        )}

        {view === 'password' && (
          <form onSubmit={changePassword} className="space-y-3" noValidate>
            <Field label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
            <Field label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" hint="At least 8 characters." />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Submit busy={busy}>Change password</Submit>
            <button type="button" onClick={back} className="w-full py-1 text-[13.5px] font-medium text-accent">Cancel</button>
          </form>
        )}

        {view === 'ask-code' && (
          <form onSubmit={makeCode} className="space-y-3" noValidate>
            <p className="text-[13.5px] leading-relaxed text-muted">Enter your password to make a new recovery code. Your current code will stop working.</p>
            <Field label="Password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Submit busy={busy}>Make new code</Submit>
            <button type="button" onClick={back} className="w-full py-1 text-[13.5px] font-medium text-accent">Cancel</button>
          </form>
        )}

        {view === 'code' && (
          <div>
            <p className="mb-3 text-[13.5px] leading-relaxed"><b>Save this code now.</b> The old one no longer works and this one is not shown again.</p>
            <RecoveryCodeBox code={newCode} email={user.email} />
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-head px-3 py-3 text-[14px] leading-snug">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-5 flex-none accent-accent" />
              <span>I have saved my recovery code.</span>
            </label>
            <button type="button" disabled={!saved} onClick={close} className="mt-3 w-full rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent disabled:opacity-40">Done</button>
          </div>
        )}
      </div>
    </Popover>
  );
}
