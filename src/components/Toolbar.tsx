import { useEffect, useRef } from 'react';
import {
  BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Bold, ClipboardPaste, Copy, PaintBucket, Redo2,
  ShieldCheck, SquareDashedMousePointer, TableCellsMerge, TableCellsSplit, Table2, Trash2, Undo2, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Store } from '../engine/store';
import { FILLS } from '../engine/palette';
import { IconButton, Popover, Sep } from './ui';

export type ToolPanel = 'fill' | 'cells' | null;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

export function Toolbar({ store, panel, setPanel }: { store: Store; panel: ToolPanel; setPanel: (p: ToolPanel) => void }) {
  const toggle = (p: Exclude<ToolPanel, null>) => setPanel(panel === p ? null : p);
  const after = () => {
    setPanel(null);
    store.focusGrid();
  };
  const act = (fn: () => void) => () => {
    fn();
    store.focusGrid();
  };
  const fill = store.activeFill();

  return (
    // relative: on phones the fill / cells cards open as a full-width card under this bar
    <div role="toolbar" aria-label="Sheet tools" className="relative border-y border-line bg-panel/60">
      <div className="flex items-center gap-0.5 px-2 py-1 sm:px-4 sm:py-1.5">
        <IconButton icon={Undo2} label={'Undo (' + mod + 'Z)'} disabled={!store.hist.length} onClick={act(() => store.undo())} />
        <IconButton icon={Redo2} label={'Redo (' + mod + 'Y)'} disabled={!store.future.length} onClick={act(() => store.redo())} />
        <Sep />
        <IconButton icon={Copy} label={'Copy selection (' + mod + 'C)'} onClick={act(() => store.doCopy(true))} />
        <IconButton icon={ClipboardPaste} label={'Paste at the selected cell (' + mod + 'V)'} onClick={act(() => store.paste())} />
        <IconButton
          icon={SquareDashedMousePointer}
          label="Select range: when on, tapping a cell extends the selection"
          aria-pressed={store.extendMode}
          onClick={act(() => store.toggleExtend())}
        />
        <Sep />
        <IconButton icon={Bold} label={'Bold (' + mod + 'B)'} onClick={act(() => store.toggleBold())} />

        {/* fill colour + opacity */}
        <div className="flex min-w-0 flex-1 sm:relative sm:flex-none">
          <IconButton
            icon={PaintBucket}
            label="Fill colour and opacity"
            aria-expanded={panel === 'fill'}
            onClick={() => toggle('fill')}
            className="relative"
          />
          <FillPicker store={store} open={panel === 'fill'} onClose={after} activeFill={fill.f} />
        </div>

        {/* cells: merge and rows / columns */}
        <div className="flex min-w-0 flex-1 sm:relative sm:flex-none">
          <IconButton icon={Table2} label="Merge cells, rows and columns" aria-expanded={panel === 'cells'} onClick={() => toggle('cells')} />
          <CellsMenu store={store} open={panel === 'cells'} onClose={after} />
        </div>
        <Sep />
        <IconButton
          icon={ShieldCheck}
          label={store.confirmMode ? 'Confirm changes: on — every edit asks first' : 'Confirm changes: off — edits apply right away'}
          aria-pressed={store.confirmMode}
          onClick={act(() => store.toggleConfirmMode())}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fill picker */
function FillPicker({ store, open, onClose, activeFill }: { store: Store; open: boolean; onClose: () => void; activeFill: number }) {
  const rangeRef = useRef<HTMLInputElement>(null);
  const opacity = store.fillOpacity;

  // "change" fires when the slider is released: that is when we colour the selected cells (one undo step)
  useEffect(() => {
    const el = rangeRef.current;
    if (!open || !el) return;
    const done = () => store.setOpacity(+el.value, true);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [open, store]);

  const shown = activeFill || 0;
  return (
    <Popover open={open} onClose={onClose} variant="drop" title="Fill colour" align="left" panelClass="sm:w-72">
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">Fill colour</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => store.setFill(0)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink hover:bg-softaccent"
            >
              <Trash2 size={14} aria-hidden /> No fill
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-softaccent hover:text-ink">
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div role="group" aria-label="Colours" className="grid grid-cols-4 gap-2">
          {FILLS.map((f) => (
            <button
              key={f.n}
              type="button"
              title={f.name}
              aria-label={f.name + ' fill'}
              aria-pressed={shown === f.n}
              onClick={() => store.setFill(f.n)}
              className={
                'relative h-10 rounded-lg border-2 transition-transform active:scale-95 ' +
                (shown === f.n ? 'border-accent' : 'border-lineStrong/60 hover:border-accent')
              }
              // the swatch shows the colour at the chosen opacity, on a checkerboard, so you can see what you will get
              style={{ background: 'var(--cell)' }}
            >
              <span className="chk absolute inset-0 rounded-[6px] opacity-50" aria-hidden />
              <span className="absolute inset-0 rounded-[6px]" style={{ background: `color-mix(in srgb, var(--f${f.n}) ${opacity}%, transparent)` }} aria-hidden />
            </button>
          ))}
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <label htmlFor="fill-opacity" className="font-medium">Opacity</label>
            <output htmlFor="fill-opacity" className="tabular-nums text-muted">{opacity}%</output>
          </div>
          <input
            id="fill-opacity"
            ref={rangeRef}
            type="range"
            min={10}
            max={100}
            step={5}
            value={opacity}
            onChange={(e) => store.setOpacity(+e.target.value, false)}
            className="h-6 w-full cursor-pointer accent-accent"
            aria-valuetext={opacity + ' percent'}
          />
          <div className="mt-1 flex justify-between gap-1">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => store.setOpacity(p, true)}
                aria-pressed={opacity === p}
                className="flex-1 rounded-md border border-line py-1 text-xs tabular-nums hover:border-accent aria-pressed:border-accent aria-pressed:bg-softaccent"
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* what a block of coloured cells looks like: the grid lines stay visible at any opacity */}
        <div className="mt-3 overflow-hidden rounded-lg border border-line" aria-hidden>
          <div className="grid grid-cols-3 bg-cell text-center text-[11px] text-muted">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-6 border-b border-r border-lineStrong/70 leading-6 [&:nth-child(3n)]:border-r-0 [&:nth-child(n+4)]:border-b-0"
                style={{ background: shown ? `color-mix(in srgb, var(--f${shown}) ${opacity}%, transparent)` : `color-mix(in srgb, var(--f1) ${opacity}%, transparent)` }}
              >
                {['A1', 'B1', 'C1', 'A2', 'B2', 'C2'][i]}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Pick cells first, then a colour. Move the slider to change how see-through the colour is on the selected cells. Borders stay visible.
        </p>
      </div>
    </Popover>
  );
}

/* ------------------------------------------------------------------ merge / rows / columns */
interface CellAction { icon: LucideIcon; label: string; run: () => void; danger?: boolean }

function CellsMenu({ store, open, onClose }: { store: Store; open: boolean; onClose: () => void }) {
  const groups: { title: string; items: CellAction[] }[] = [
    {
      title: 'Combine',
      items: [
        { icon: TableCellsMerge, label: 'Merge cells', run: () => store.mergeSel() },
        { icon: TableCellsSplit, label: 'Unmerge', run: () => store.unmergeSel() },
      ],
    },
    {
      title: 'Insert',
      items: [
        { icon: BetweenHorizontalStart, label: 'Row above', run: () => store.rowAbove() },
        { icon: BetweenHorizontalEnd, label: 'Row below', run: () => store.rowBelow() },
        { icon: BetweenVerticalStart, label: 'Column left', run: () => store.colLeft() },
        { icon: BetweenVerticalEnd, label: 'Column right', run: () => store.colRight() },
      ],
    },
    {
      title: 'Delete',
      items: [
        { icon: Trash2, label: 'Delete row', run: () => store.delRow(), danger: true },
        { icon: Trash2, label: 'Delete column', run: () => store.delCol(), danger: true },
      ],
    },
  ];
  return (
    <Popover open={open} onClose={onClose} variant="drop" title="Cells, rows and columns" align="left" panelClass="sm:w-72">
      <div className="p-2">
        {groups.map((g) => (
          <section key={g.title} className="pb-1">
            <h3 className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</h3>
            <ul className="grid grid-cols-2 gap-1">
              {g.items.map((it) => (
                <li key={it.label}>
                  <button
                    type="button"
                    onClick={() => {
                      it.run();
                      onClose();
                    }}
                    className={
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-medium hover:bg-softaccent coarse:py-2.5 ' +
                      (it.danger ? 'text-err' : '')
                    }
                  >
                    <it.icon size={18} aria-hidden className={it.danger ? '' : 'text-accent'} />
                    <span className="truncate">{it.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Popover>
  );
}
