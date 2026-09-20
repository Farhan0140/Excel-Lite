import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { MODES, PALETTES } from '../theme';
import type { Mode } from '../theme';
import { Popover, PanelTitle } from './ui';

const modeIcon = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemePanel({
  open, onClose, mode, palette, dark, setMode, setPalette,
}: {
  open: boolean; onClose: () => void; mode: Mode; palette: string; dark: boolean;
  setMode: (m: Mode) => void; setPalette: (p: string) => void;
}) {
  return (
    <Popover open={open} onClose={onClose} variant="sheet" title="Theme" panelClass="sm:w-[22rem]">
      <PanelTitle onClose={onClose}>Theme</PanelTitle>
      <div className="px-4 pb-4 pt-2">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Brightness</p>
        <div role="radiogroup" aria-label="Brightness" className="grid grid-cols-3 gap-1 rounded-xl bg-head p-1">
          {MODES.map((m) => {
            const Icon = modeIcon[m.id];
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.id)}
                className={
                  'flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-colors coarse:py-2.5 ' +
                  (on ? 'bg-accent text-onaccent shadow-sm' : 'text-ink hover:bg-softaccent')
                }
              >
                <Icon size={16} aria-hidden /> {m.name}
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Colours</p>
        <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-2">
          {PALETTES.map((p) => {
            const on = palette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPalette(p.id)}
                className={'rounded-xl border-2 p-1.5 text-left transition-colors ' + (on ? 'border-accent' : 'border-line hover:border-lineStrong')}
              >
                {/* a tiny preview drawn with the theme's own colours */}
                <span data-palette={p.id} data-mode={dark ? 'dark' : 'light'} className="block overflow-hidden rounded-lg border border-line bg-canvas">
                  <span className="flex items-center gap-1 bg-panel px-1.5 py-1">
                    <span className="h-1.5 w-6 rounded-full bg-accent" />
                    <span className="h-1.5 w-3 rounded-full bg-line" />
                  </span>
                  <span className="grid grid-cols-3 gap-px bg-line p-px">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        className={'h-3.5 bg-cell ' + (i === 1 ? 'outline outline-2 -outline-offset-2 outline-accent' : '')}
                        style={i === 4 ? { background: 'var(--f3)' } : undefined}
                      />
                    ))}
                  </span>
                </span>
                <span className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted">{p.note}</span>
                  </span>
                  {on && <Check size={16} className="flex-none text-accent" aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
