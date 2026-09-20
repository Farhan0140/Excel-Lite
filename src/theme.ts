import { useCallback, useEffect, useState } from 'react';

export type Mode = 'system' | 'light' | 'dark';
export interface ThemePrefs { mode: Mode; palette: string }

export const PALETTES = [
  { id: 'teal', name: 'Teal', note: 'The original' },
  { id: 'ocean', name: 'Ocean', note: 'Calm blue' },
  { id: 'violet', name: 'Violet', note: 'Soft purple' },
  { id: 'rose', name: 'Rose', note: 'Warm pink' },
  { id: 'copper', name: 'Copper', note: 'Earthy orange' },
  { id: 'forest', name: 'Forest', note: 'Fresh green' },
  { id: 'slate', name: 'Slate', note: 'Quiet blue-grey' },
  { id: 'mono', name: 'Mono', note: 'Black & white' },
];
export const MODES: { id: Mode; name: string }[] = [
  { id: 'system', name: 'Auto' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];

const KEY = 'household-ledger-theme';

function read(): ThemePrefs {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      mode: t.mode === 'light' || t.mode === 'dark' ? t.mode : 'system',
      palette: PALETTES.some((p) => p.id === t.palette) ? t.palette : 'teal',
    };
  } catch {
    return { mode: 'system', palette: 'teal' };
  }
}

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function useTheme() {
  const [prefs, setPrefs] = useState<ThemePrefs>(read);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && sysDark);

  useEffect(() => {
    const d = document.documentElement;
    d.setAttribute('data-mode', dark ? 'dark' : 'light');
    d.setAttribute('data-palette', prefs.palette);
    // colour of the phone's browser bar
    const accent = getComputedStyle(d).getPropertyValue('--panel').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent || '#1D6B67');
  }, [dark, prefs.palette]);

  const update = useCallback((p: Partial<ThemePrefs>) => {
    setPrefs((cur) => {
      const n = { ...cur, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }, []);

  return { ...prefs, dark, setMode: (mode: Mode) => update({ mode }), setPalette: (palette: string) => update({ palette }) };
}
