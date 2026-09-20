import { useEffect, useState } from 'react';
import type { Store } from '../engine/store';

/* Phone keyboard mode.
   While you type on a touch screen the on-screen keyboard covers half the page, so we
   - lock the page to the visible area (--vh), so nothing jumps around, and
   - report `kb = true` so the app can hide everything except the grid and the formula bar. */
export function useKeyboardMode(store: Store): boolean {
  const [kbOn, setKbOn] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport, root = document.documentElement;
    let base = 0, lastW = 0, kbFocus = false, on = false, kbOpen = false, focusT = 0, rt: ReturnType<typeof setTimeout>;

    const revealSoon = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const td = store.wrapEl?.querySelector(`td[data-r="${store.sel.ar}"][data-c="${store.sel.ac}"]`) as HTMLElement | null;
        td?.scrollIntoView({ block: on ? 'center' : 'nearest', inline: 'nearest' });
      }, 160);
    };
    const updateKb = () => {
      const want = store.coarse && kbFocus && (kbOpen || Date.now() - focusT < 900);
      if (want === on) return;
      on = want;
      setKbOn(want);
      revealSoon();
    };
    const vvUpdate = () => {
      if (!store.coarse || !vv || vv.scale > 1.02) return;
      if (Math.abs(vv.width - lastW) > 2) { base = 0; lastW = vv.width; }
      base = Math.max(base, vv.height);
      root.style.setProperty('--vh', vv.height + 'px');
      document.body.style.top = vv.offsetTop + 'px';
      kbOpen = vv.height < base - 120;
      updateKb();
      if (on) revealSoon();
    };
    const isEditor = (t: EventTarget | null) => t === store.edEl || t === store.fbEl;
    const onFocusIn = (e: FocusEvent) => {
      if (isEditor(e.target)) { kbFocus = true; focusT = Date.now(); updateKb(); setTimeout(updateKb, 950); }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isEditor(e.target))
        setTimeout(() => {
          const a = document.activeElement;
          kbFocus = isEditor(a);
          updateKb();
        }, 60);
    };
    const onOrient = () => { base = 0; setTimeout(vvUpdate, 300); };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', onOrient);
    if (vv) { vv.addEventListener('resize', vvUpdate); vv.addEventListener('scroll', vvUpdate); }
    vvUpdate();
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('orientationchange', onOrient);
      if (vv) { vv.removeEventListener('resize', vvUpdate); vv.removeEventListener('scroll', vvUpdate); }
      clearTimeout(rt);
    };
  }, [store]);

  return kbOn;
}
