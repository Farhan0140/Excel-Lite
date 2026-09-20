import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import { api, ApiError } from './api';
import type { User } from './api';

export type AuthDone = (user: User, recoveryCode: string | null, kind: 'signin' | 'signup' | 'reset') => void;
type Mode = 'signin' | 'signup' | 'forgot';

/* ------------------------------------------------------------- shell shared by every auth screen */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full flex-col justify-center px-4 py-8" style={{ maxWidth: wide ? 30 * 16 : 26 * 16 }}>
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-accent text-onaccent">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
              <path d="M3.5 9.5h17M3.5 15h17M10 3.5v17" />
            </svg>
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight tracking-tight">Household ledger</h1>
            <p className="text-[13px] text-muted">Your bills, readings and budgets, saved to your account.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5 shadow-[var(--shadow)] sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label, hint, error, type = 'text', value, onChange, autoComplete, inputMode, maxLength, autoFocus, name, mono,
}: {
  label: string; hint?: string; error?: boolean; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string;
  inputMode?: 'numeric' | 'email' | 'text'; maxLength?: number; autoFocus?: boolean; name?: string; mono?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium">{label}</span>
      <span className="relative block">
        <input
          name={name}
          type={isPw && show ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error || undefined}
          className={
            'w-full rounded-lg border bg-cell px-3 py-2.5 text-[15px] text-ink outline-none transition-shadow placeholder:text-muted/60 focus:border-accent focus:shadow-[0_0_0_2px_var(--sel)] ' +
            (error ? 'border-err ' : 'border-line ') + (isPw ? 'pr-11 ' : '') + (mono ? 'text-center font-mono text-2xl tracking-[0.5em] ' : '')
          }
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
          >
            {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        )}
      </span>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const Submit = ({ busy, children }: { busy: boolean; children: ReactNode }) => (
  <button
    type="submit"
    disabled={busy}
    className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-60"
  >
    {busy && <Loader2 size={18} className="animate-spin" aria-hidden />}
    {children}
  </button>
);

export const ErrorNote = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-[13.5px] text-ink">
    <AlertCircle size={18} className="mt-px flex-none text-err" aria-hidden />
    <span>{children}</span>
  </div>
);

/* ------------------------------------------------------------- sign in / sign up / forgot password */
export function AuthScreen({ onDone, notice, initialEmail }: { onDone: AuthDone; notice?: string; initialEmail?: string }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = (m: Mode) => {
    setMode(m);
    setError('');
    setPassword('');
    setCode('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim()) return setError('Enter your email address.');
    if (!password) return setError(mode === 'forgot' ? 'Choose a new password.' : 'Enter your password.');
    if (mode === 'signup' && password.length < 8) return setError('Password must be at least 8 characters.');
    if (mode === 'forgot') {
      if (!/^\d{6}$/.test(code)) return setError('Enter the 6 digit recovery code.');
      if (password.length < 8) return setError('The new password must be at least 8 characters.');
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const r = await api.signin(email, password);
        onDone(r.user, null, 'signin');
      } else if (mode === 'signup') {
        const r = await api.signup(email, password);
        onDone(r.user, r.recoveryCode, 'signup');
      } else {
        const r = await api.reset(email, code, password);
        onDone(r.user, r.recoveryCode, 'reset');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const heading = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password';
  return (
    <AuthShell>
      {mode !== 'forgot' && (
        <div role="tablist" aria-label="Sign in or create an account" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-head p-1">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => go(m)}
              className={'flex items-center justify-center gap-1.5 rounded-lg py-2 text-[14px] font-medium transition-colors ' + (mode === m ? 'bg-accent text-onaccent shadow-sm' : 'hover:bg-softaccent')}
            >
              {m === 'signin' ? <LogIn size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
      )}
      <h2 className="mb-1 font-display text-xl font-bold">{heading}</h2>
      {mode === 'forgot' && (
        <p className="mb-4 text-[13.5px] leading-relaxed text-muted">
          Enter your email, the 6 digit recovery code you were given when you made your account, and a new password. After that you get a <b className="text-ink">new</b> recovery code; the old one stops working.
        </p>
      )}
      {mode === 'signup' && <p className="mb-4 text-[13.5px] leading-relaxed text-muted">You will get a 6 digit recovery code on the next screen. It is the only way to reset a forgotten password.</p>}
      {mode === 'signin' && <div className="mb-4" />}
      {notice && !error && (
        <div role="status" className="mb-4 rounded-lg border border-accent/40 bg-softaccent px-3 py-2 text-[13.5px]">{notice}</div>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
        {mode === 'forgot' && (
          <Field
            label="6 digit recovery code" name="code" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code" inputMode="numeric" maxLength={6} mono hint="The code shown when you created your account (or the last time you reset your password)."
          />
        )}
        <Field
          label={mode === 'forgot' ? 'New password' : 'Password'} name="password" type="password" value={password} onChange={setPassword}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          hint={mode !== 'signin' ? 'At least 8 characters.' : undefined}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Submit busy={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : (<><KeyRound size={18} aria-hidden /> Reset password</>)}
        </Submit>
      </form>

      <div className="mt-4 text-center text-[13.5px]">
        {mode === 'signin' && (
          <button type="button" onClick={() => go('forgot')} className="font-medium text-accent underline-offset-2 hover:underline">
            Forgot your password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => go('signin')} className="font-medium text-accent underline-offset-2 hover:underline">
            Back to sign in
          </button>
        )}
      </div>
    </AuthShell>
  );
}
