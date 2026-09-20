import { useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { downloadFile } from '../engine/download';
import { AuthShell } from './AuthScreen';

export type CodeKind = 'signup' | 'reset' | 'new';

/* the code, big, with copy + download. Used on its own screen and inside the Account panel. */
export function RecoveryCodeBox({ code, email }: { code: string; email: string }) {
  const [copied, setCopied] = useState(false);
  const spaced = code.slice(0, 3) + ' ' + code.slice(3);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked: the code is still on screen to write down */
    }
  }
  function save() {
    const text =
      `Household ledger - recovery code\n\nAccount: ${email}\nRecovery code: ${code}\n\n` +
      `Use this 6 digit code with "Forgot your password?" on the sign-in page to set a new password.\n` +
      `After you use it you get a new code, and this one stops working. Keep this file somewhere private.\n`;
    downloadFile(text, 'household-ledger-recovery-code.txt', 'text/plain');
  }
  return (
    <div>
      <div
        className="select-all rounded-xl border-2 border-dashed border-accent bg-cell px-3 py-5 text-center font-mono text-[40px] font-bold leading-none tracking-[0.18em] sm:text-5xl"
        aria-label={'Recovery code: ' + code.split('').join(' ')}
        data-testid="recovery-code"
      >
        {spaced}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className="flex items-center justify-center gap-2 rounded-lg border border-line bg-panel py-2.5 text-[14px] font-medium hover:border-accent">
          {copied ? <Check size={17} className="text-accent" aria-hidden /> : <Copy size={17} aria-hidden />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={save} className="flex items-center justify-center gap-2 rounded-lg border border-line bg-panel py-2.5 text-[14px] font-medium hover:border-accent">
          <Download size={17} aria-hidden /> Download
        </button>
      </div>
    </div>
  );
}

export function RecoveryCodeScreen({ code, email, kind, onDone }: { code: string; email: string; kind: CodeKind; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const title = kind === 'signup' ? 'Your account is ready' : kind === 'reset' ? 'Password changed' : 'Your new recovery code';
  return (
    <AuthShell>
      <div className="mb-1 flex items-center gap-2 text-accent">
        <ShieldCheck size={22} aria-hidden />
        <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      </div>
      <p className="mb-4 text-[14px] leading-relaxed">
        {kind === 'reset' && <>You are signed in with your new password. The old recovery code no longer works. </>}
        {kind === 'new' && <>The old recovery code no longer works. </>}
        <b>Save this 6 digit recovery code now.</b> If you ever forget your password it is the only way back in, and it is <b>not shown again</b>.
      </p>
      <RecoveryCodeBox code={code} email={email} />
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-head px-3 py-3 text-[14px] leading-snug">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-5 flex-none accent-accent" />
        <span>I have saved my recovery code somewhere safe.</span>
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={onDone}
        className="mt-3 w-full rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Continue to my ledger
      </button>
    </AuthShell>
  );
}
