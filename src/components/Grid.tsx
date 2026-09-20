import { memo, useCallback, useLayoutEffect, useMemo } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent, ReactNode } from 'react';
import type { Store } from '../engine/store';
import type { Display } from '../engine/formula';
import { colName, key } from '../engine/refs';
import { DW } from '../engine/types';
import { CellEditor } from './Editing';

interface CellProps {
  r: number; c: number;
  text: string;
  cls: string;
  f: number; // fill colour 0..8
  o: number; // fill opacity %
  rs: number; cs: number;
}

const Cell = memo(function Cell({ r, c, text, cls, f, o, rs, cs }: CellProps) {
  const style = f ? ({ '--fc': `var(--f${f})`, '--fo': `${o}%` } as CSSProperties) : undefined;
  return (
    <td
      data-r={r}
      data-c={c}
      data-f={f || undefined}
      className={cls}
      rowSpan={rs > 1 ? rs : undefined}
      colSpan={cs > 1 ? cs : undefined}
      style={style}
    >
      {text}
    </td>
  );
});

/* The table itself. It only re-renders when the data, the selection or the column widths change,
   never while you are typing. */
const Grid = memo(function Grid({ store }: { store: Store; ver: number; selVer: number; wver: number }) {
  const S = store.S, R = store.rng(), sel = store.sel, q = store.copyRange, cover = store.cover, si = store.W.cur;
  const ver = store.ver;

  // what every cell shows, worked out once per change of the data
  const disp = useMemo(() => {
    const ev = store.ev;
    const rows: Display[][] = [];
    for (let r = 0; r < S.rows; r++) {
      const row: Display[] = [];
      for (let c = 0; c < S.cols; c++) row.push(ev.display(si, r, c));
      rows.push(row);
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver]);

  // is there a colour on this cell (a merged block counts through its top-left cell)?
  const filled = (r: number, c: number): boolean => {
    if (r < 0 || c < 0 || r >= S.rows || c >= S.cols) return false;
    const m = cover.get(key(r, c));
    const cell = m ? S.cells[key(m.r0, m.c0)] : S.cells[key(r, c)];
    return !!(cell && cell.f);
  };

  const cols = S.cols;
  let total = 0;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) { const w = S.colW[c] || DW; widths.push(w); total += w; }

  const heads: ReactNode[] = [];
  for (let c = 0; c < cols; c++) {
    heads.push(
      <th key={c} className={'ch' + (c >= R.c0 && c <= R.c1 ? ' hl' : '') + (filled(0, c) ? ' sb' : '')} data-c={c}>
        {colName(c)}
        <i className="rz" data-c={c} onPointerDown={(e) => startResize(store, e, c)} />
      </th>,
    );
  }

  const body: ReactNode[] = [];
  for (let r = 0; r < S.rows; r++) {
    const tds: ReactNode[] = [];
    for (let c = 0; c < cols; c++) {
      const m = cover.get(key(r, c));
      if (m && !(m.r0 === r && m.c0 === c)) continue; // hidden behind a merged cell
      const cell = S.cells[key(r, c)];
      const d = disp[r][c];
      const er = m ? m.r1 : r, ec = m ? m.c1 : c;
      let cls = '';
      if (cell && cell.v !== '') {
        if (d.k === 'n') cls += ' num';
        else if (d.k === 'e') cls += ' err';
        if (cell.v[0] === '=') cls += ' fx';
      }
      if (m) cls += er > r ? ' mg mgv' : ' mg';
      if (cell && cell.b) cls += ' b';
      // borders: keep the stronger line colour around every coloured cell
      let sr = !!(cell && cell.f), sb = sr;
      for (let x = r; x <= er && !sr; x++) if (filled(x, ec + 1)) sr = true;
      for (let y = c; y <= ec && !sb; y++) if (filled(er + 1, y)) sb = true;
      if (sr) cls += ' sr';
      if (sb) cls += ' sb';
      if (r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1) cls += ' sel';
      if (r === sel.ar && c === sel.ac) cls += ' active';
      if (q && r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1) {
        cls += ' cp';
        if (r === q.r0) cls += ' cpt';
        if (er === q.r1) cls += ' cpb';
        if (c === q.c0) cls += ' cpl';
        if (ec === q.c1) cls += ' cpr';
      }
      tds.push(
        <Cell
          key={c}
          r={r}
          c={c}
          text={d.t}
          cls={cls.trim()}
          f={cell ? cell.f : 0}
          o={cell && cell.f && cell.o != null ? cell.o : 100}
          rs={er - r + 1}
          cs={ec - c + 1}
        />,
      );
    }
    body.push(
      <tr key={r}>
        <th className={'rh' + (r >= R.r0 && r <= R.r1 ? ' hl' : '') + (filled(r, 0) ? ' sr' : '')} data-r={r}>
          {r + 1}
        </th>
        {tds}
      </tr>,
    );
  }

  return (
    <table className="sheet" aria-label="Spreadsheet cells" style={{ width: `calc(var(--rh-w) + ${total}px)` }}>
      <colgroup>
        <col style={{ width: 'var(--rh-w)' }} />
        {widths.map((w, c) => (
          <col key={c} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="corner" />
          {heads}
        </tr>
      </thead>
      <tbody>{body}</tbody>
    </table>
  );
});

// drag the edge of a column header to change its width (works with a mouse and with a finger)
function startResize(store: Store, e: RPointerEvent<HTMLElement>, c: number) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget, x0 = e.clientX, w0 = store.S.colW[c] || DW;
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const move = (ev: PointerEvent) => store.setColWidth(c, w0 + ev.clientX - x0);
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    store.endResize();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/* the scrolling area: grid + the floating cell editor + mouse / keyboard handling */
export function Sheet({ store }: { store: Store }) {
  // a stable ref callback: a new function every render would make React clear the ref for a moment, and the cell editor needs it
  const setWrap = useCallback((el: HTMLDivElement | null) => { store.wrapEl = el; }, [store]);
  // scroll the selection into view after the grid has been redrawn
  useLayoutEffect(() => {
    if (!store.revealReq) return;
    store.revealReq = false;
    const td = store.wrapEl?.querySelector(`td[data-r="${store.sel.fr}"][data-c="${store.sel.fc}"]`) as HTMLElement | null;
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  return (
    <div
      ref={setWrap}
      tabIndex={0}
      aria-label="Spreadsheet"
      className="sheet-wrap relative min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-cell outline-none focus-visible:border-accent"
      onMouseDown={(e) => store.onGridMouseDown(e)}
      onClick={() => store.onGridClick()}
      onMouseMove={(e) => store.onGridMouseMove(e)}
      onDoubleClick={(e) => store.onGridDblClick(e)}
      onKeyDown={(e) => store.onGridKeyDown(e)}
    >
      <Grid store={store} ver={store.ver} selVer={store.selVer} wver={store.wver} />
      <CellEditor store={store} />
    </div>
  );
}
