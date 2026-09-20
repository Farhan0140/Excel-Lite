import { useEffect } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/* A square icon-only button. The label is used for the tooltip and for screen readers. */
export function IconButton({
  icon: Icon, label, className = '', size = 20, ...rest
}: { icon: LucideIcon; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={
        'grid h-9 min-w-0 flex-1 place-items-center rounded-lg text-ink transition-colors sm:size-9 sm:flex-none coarse:h-10 ' +
        'hover:bg-softaccent active:bg-softaccent disabled:pointer-events-none disabled:opacity-35 ' +
        'aria-pressed:bg-accent aria-pressed:text-onaccent aria-expanded:bg-softaccent ' + className
      }
      {...rest}
    >
      <Icon size={size} strokeWidth={2} aria-hidden />
    </button>
  );
}

export const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px flex-none bg-line sm:mx-1" />;

/* Click-away layer + panel. "sheet" = bottom sheet on phones / dropdown on desktop.
   "drop" = card under the toolbar on phones / dropdown under its button on desktop. */
export function Popover({
  open, onClose, variant, title, children, panelClass = '', align = 'right',
}: {
  open: boolean; onClose: () => void; variant: 'sheet' | 'drop'; title?: string; children: ReactNode; panelClass?: string; align?: 'left' | 'right';
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const sheet = variant === 'sheet';
  return (
    <>
      <div
        className={'anim-fade fixed inset-0 z-40 ' + (sheet ? 'bg-black/45 sm:bg-transparent' : '')}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={title}
        className={
          'anim-sheet z-50 overflow-y-auto overscroll-contain border border-line bg-panel text-ink shadow-[var(--shadow)] ' +
          (sheet
            ? 'fixed inset-x-0 bottom-0 max-h-[86dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[calc(100dvh-84px)] sm:rounded-xl sm:pb-0 '
            : 'anim-pop absolute inset-x-2 top-full mt-1 max-h-[70dvh] rounded-xl sm:inset-x-auto sm:mt-2 ') +
          (align === 'right' ? 'sm:right-0 ' : 'sm:left-0 ') + panelClass
        }
      >
        {sheet && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" />}
        {children}
      </div>
    </>
  );
}

export function PanelTitle({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 sm:pt-3">
      <h2 className="font-display text-base font-bold">{children}</h2>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-8 place-items-center rounded-lg text-muted hover:bg-softaccent hover:text-ink">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
    </div>
  );
}
