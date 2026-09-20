import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type { InputId, Store } from '../engine/store';
import { SYMS } from '../engine/store';
import { ref } from '../engine/refs';

/* One text box. The cell editor (over the grid) and the formula bar are both this component:
   they always show the same text, whichever one you type in. */
export function EditInput({
  store, id, className, style, placeholder, label, place,
}: { store: Store; id: InputId; className?: string; style?: CSSProperties; placeholder?: string; label: string; place?: () => void }) {
  const el = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (id === 'ed') store.edEl = el.current;
    else store.fbEl = el.current;
    return () => {
      if (id === 'ed') store.edEl = null;
      else store.fbEl = null;
    };
  }, [store, id]);

  // after every render: put the caret where the last edit asked for it
  useLayoutEffect(() => {
    place?.(); // the floating editor must sit over its cell BEFORE it takes focus, or the browser scrolls to where it used to be
    const p = store.pendingCaret, node = el.current;
    if (p && p.target === id && node) {
      store.pendingCaret = null;
      if (p.focus && document.activeElement !== node) node.focus({ preventScroll: true });
      try { node.setSelectionRange(p.pos, p.pos); } catch { /* not focusable yet */ }
    }
  });

  // typing "(" adds ")" too. React does not expose the browser's beforeinput event, so listen for it directly.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const h = (e: Event) => store.autoPair(e as InputEvent);
    node.addEventListener('beforeinput', h);
    return () => node.removeEventListener('beforeinput', h);
  }, [store]);

  const isBar = id === 'fb';
  const value = isBar && !store.editing ? store.rawActive() : store.editText;
  const sug = () => store.updateSug();
  return (
    <input
      ref={el}
      value={value}
      style={style}
      className={className}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      enterKeyHint="next"
      onChange={(e) => store.setEditText(e.target.value)}
      onFocus={isBar ? (e) => { if (!store.editing) store.startEdit(e.target.value, true); } : undefined}
      onKeyDown={(e) => store.onEditKeyDown(e)}
      onKeyUp={sug}
      onClick={sug}
      onSelect={sug}
    />
  );
}

/* the box that floats over the cell being edited */
export function CellEditor({ store }: { store: Store }) {
  const { editing, edit } = store;
  const away = store.editAway;

  // follow the cell being edited (also after scrolling / resizing / inserting rows)
  const place = () => {
    const el = store.edEl, wrap = store.wrapEl;
    if (!editing || away || !el || !wrap) return;
    const td = wrap.querySelector(`td[data-r="${edit.r}"][data-c="${edit.c}"]`) as HTMLElement | null;
    if (!td) return;
    const a = td.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    el.style.left = a.left - w.left + wrap.scrollLeft - wrap.clientLeft + 'px';
    el.style.top = a.top - w.top + wrap.scrollTop - wrap.clientTop + 'px';
    el.style.width = Math.max(a.width, 150) + 'px';
    el.style.height = a.height + 'px';
  };

  return (
    <EditInput
      store={store}
      id="ed"
      label="Edit cell"
      place={place}
      style={{ display: editing ? 'block' : 'none' }}
      className={'absolute z-[6] m-0 rounded-none border-2 border-accent bg-cell px-1.5 text-ink outline-none ' + (away ? 'ed-away' : '')}
    />
  );
}

/* name box + text box (+ Done button on phones while the keyboard is open) */
export function FormulaBar({ store, kb }: { store: Store; kb: boolean }) {
  const R = store.rng();
  const single = R.r0 === R.r1 && R.c0 === R.c1;
  const name = single ? ref(store.sel.ar, store.sel.ac) : ref(R.r0, R.c0) + ':' + ref(R.r1, R.c1);
  return (
    <div
      className={
        'flex items-stretch overflow-hidden rounded-lg border border-line bg-cell focus-within:border-accent focus-within:shadow-[0_0_0_2px_var(--sel)] ' +
        (kb ? 'mx-1.5 my-1.5' : 'mx-2.5 my-1.5 sm:mx-4 sm:my-2')
      }
    >
      <span className="flex min-w-[68px] flex-none items-center justify-center border-r border-line bg-head px-2 py-1.5 text-[13px] font-semibold sm:min-w-[88px] sm:px-3" aria-live="polite">
        {name}
      </span>
      <EditInput
        store={store}
        id="fb"
        label="Cell contents"
        placeholder="Type a value, or start with = for a formula"
        className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-muted/70 focus-visible:outline-none"
      />
      {kb && (
        <button
          type="button"
          onClick={() => store.done()}
          className="m-1 flex flex-none items-center gap-1 rounded-md bg-accent px-3 text-[13px] font-semibold text-onaccent"
        >
          <Check size={16} aria-hidden /> Done
        </button>
      )}
    </div>
  );
}

/* function suggestions, plus symbol keys that are awkward on a phone keyboard */
export function SuggestBar({ store, kb }: { store: Store; kb: boolean }) {
  const on = store.fxEditing() && (store.sugItems.length > 0 || store.coarse);
  if (!on) return null;
  return (
    <div
      data-keep-edit
      aria-label="Formula suggestions"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        if (b.dataset.sym) store.insertSym(b.dataset.sym);
        else store.pickSug(+b.dataset.i!);
      }}
      className={'no-scrollbar mb-1.5 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap ' + (kb ? 'mx-1.5' : 'mx-2.5 sm:mx-4')}
    >
      {store.sugItems.map((it, i) => (
        <button
          key={it.kind + it.name}
          type="button"
          data-i={i}
          className={
            'inline-flex flex-none items-baseline gap-2 rounded-full border border-accent px-3 py-1 text-[13px] ' +
            (i === store.sugIdx ? 'bg-accent text-onaccent' : 'bg-panel text-ink')
          }
        >
          <b className="font-semibold">{it.kind === 'tab' ? it.name + '!' : it.name + '('}</b>
          <small className={'text-[11.5px] ' + (i === store.sugIdx ? 'opacity-85' : 'text-muted')}>{it.d}</small>
        </button>
      ))}
      <span aria-hidden className="hidden h-[18px] w-px flex-none bg-line coarse:block" />
      {SYMS.map((sy) => (
        <button
          key={sy[1]}
          type="button"
          data-sym={sy[1]}
          aria-label={'Insert ' + sy[1]}
          className="hidden min-w-10 flex-none items-center justify-center rounded-full border border-line bg-panel px-2.5 py-1 text-base text-ink coarse:inline-flex"
        >
          {sy[0]}
        </button>
      ))}
    </div>
  );
}
