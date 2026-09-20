import { DW, FILL_COUNT, LW, MAXC, MAXR } from './types';
import type { Cell, Sheet, SheetData, Workbook } from './types';
import { key, shiftMap, xform } from './refs';

export function blank(): SheetData {
  const w: number[] = [];
  for (let i = 0; i < 8; i++) w.push(i ? DW : LW);
  return { rows: 40, cols: 8, cells: {}, colW: w, merges: [] };
}

export function setCell(D: SheetData, r: number, c: number, patch: Partial<Cell>) {
  const k = key(r, c);
  const cur = D.cells[k] || { v: '', b: 0, f: 0 };
  const n: Cell = { ...cur, ...patch };
  // opacity only means something on a filled cell, and 100% is the default
  if (!n.f || n.o == null || n.o >= 100) delete n.o;
  if (n.v === '' && !n.b && !n.f) delete D.cells[k];
  else D.cells[k] = n;
}

// a copy of a cell that can be put somewhere else (keeps bold, fill colour and fill opacity)
export function cloneCell(src: Cell, v = src.v): Cell {
  const n: Cell = { v, b: src.b, f: src.f };
  if (src.o != null && src.f) n.o = src.o;
  return n;
}

export const fillOpacity = (cell: Cell | undefined): number => (cell && cell.f && cell.o != null ? cell.o : 100);

/* ---------- templates & sample data ---------- */
type TplCell = [number, number, string, number?, number?];
export const TEMPLATES: Record<string, TplCell[]> = {
  meter: [
    [0, 0, 'Electricity', 1, 3], [0, 1, '', 1, 3],
    [1, 0, 'Previous reading'], [1, 1, '1200'],
    [2, 0, 'Current reading'], [2, 1, '1350'],
    [3, 0, 'Units used', 1], [3, 1, '=B3-B2', 1],
    [4, 0, 'Rate per unit'], [4, 1, '0.15'],
    [5, 0, 'Amount due', 1, 1], [5, 1, '=B4*B5', 1, 1],
  ],
  budget: [
    [0, 0, 'Monthly budget', 1, 3], [0, 1, 'Amount', 1, 3],
    [1, 0, 'Rent'], [1, 1, '1000'],
    [2, 0, 'Groceries'], [2, 1, '450'],
    [3, 0, 'Utilities'], [3, 1, '180'],
    [4, 0, 'Other'], [4, 1, '120'],
    [5, 0, 'Total', 1, 1], [5, 1, '=SUM(B2:B5)', 1, 1],
  ],
};
export const TEMPLATE_MERGES: Record<string, number[][]> = { meter: [[0, 0, 0, 1]], budget: [] };

export function place(D: SheetData, t: TplCell[], tr: number, tc: number) {
  t.forEach((x) => {
    let v = x[2];
    if (v[0] === '=') v = xform(v, shiftMap(tr, tc));
    const r = tr + x[0],
      c = tc + x[1];
    if (r >= MAXR || c >= MAXC) return;
    D.cells[key(r, c)] = { v, b: x[3] || 0, f: x[4] || 0 };
  });
}
export function tplSize(t: TplCell[]) {
  let h = 0,
    w = 0;
  t.forEach((x) => {
    h = Math.max(h, x[0] + 1);
    w = Math.max(w, x[1] + 1);
  });
  return { h, w };
}

export function sampleData(): SheetData {
  const D = blank();
  place(D, TEMPLATES.meter, 0, 0);
  place(D, TEMPLATES.meter, 7, 0); // pasted copy: formulas shift automatically
  D.merges.push({ r0: 0, c0: 0, r1: 0, c1: 1 }, { r0: 7, c0: 0, r1: 7, c1: 1 });
  setCell(D, 7, 0, { v: 'Water' });
  setCell(D, 8, 1, { v: '310' });
  setCell(D, 9, 1, { v: '342' });
  setCell(D, 11, 1, { v: '2.4' });
  setCell(D, 14, 0, { v: 'Total bills', b: 1, f: 1 });
  setCell(D, 14, 1, { v: '=B6+B13', b: 1, f: 1 });
  return D;
}

export function sampleWorkbook(): Workbook {
  const S = sampleData();
  const D2 = blank();
  D2.cells = {
    '0,0': { v: 'Summary', b: 1, f: 3 }, '0,1': { v: '', b: 1, f: 3 },
    '1,0': { v: 'Electricity bill', b: 0, f: 0 }, '1,1': { v: '=Tab1!B6', b: 0, f: 0 },
    '2,0': { v: 'Water bill', b: 0, f: 0 }, '2,1': { v: '=Tab1!B13', b: 0, f: 0 },
    '3,0': { v: 'All bills', b: 1, f: 1 }, '3,1': { v: '=B2+B3', b: 1, f: 1 },
  };
  D2.merges = [{ r0: 0, c0: 0, r1: 0, c1: 1 }];
  return { cur: 0, sheets: [{ name: 'Tab1', data: S }, { name: 'Tab2', data: D2 }] };
}

/* ---------- storage ---------- */
const KEY = 'household-ledger-v1';
const KEY2 = 'household-ledger-v2';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function normData(o: any): SheetData | null {
  if (o && o.cells && o.rows && o.cols && Array.isArray(o.colW)) {
    if (!Array.isArray(o.merges)) o.merges = [];
    return o as SheetData;
  }
  return null;
}

export function loadWorkbook(st: StorageLike | null): Workbook {
  try {
    const t = st && st.getItem(KEY2);
    if (t) {
      const o = JSON.parse(t);
      const list: Sheet[] = [];
      if (o && Array.isArray(o.sheets))
        o.sheets.forEach((x: any, i: number) => {
          const d = normData(x && x.data);
          const nm = x && x.name ? String(x.name).replace(/^Tab (\d+)$/, 'Tab$1').replace(/[!':]/g, '').slice(0, 30) : '';
          if (d) list.push({ name: nm || 'Tab' + (i + 1), data: d });
        });
      if (list.length) return { cur: Math.min(Math.max(+o.cur || 0, 0), list.length - 1), sheets: list };
    }
    const old = st && st.getItem(KEY);
    if (old) {
      const d2 = normData(JSON.parse(old));
      if (d2) return { cur: 0, sheets: [{ name: 'Tab1', data: d2 }] };
    }
  } catch {
    /* fall through to the example */
  }
  return sampleWorkbook();
}

export function saveWorkbook(st: StorageLike | null, W: Workbook) {
  try {
    st?.setItem(KEY2, JSON.stringify({ cur: W.cur, sheets: W.sheets.map((x) => ({ name: x.name, data: x.data })) }));
  } catch {
    /* storage may be full or blocked */
  }
}

/* ---------- backup files ---------- */
export function cleanData(d: any): SheetData | null {
  if (!d || typeof d !== 'object' || !d.cells || typeof d.cells !== 'object') return null;
  const out: SheetData = { rows: 20, cols: 6, cells: {}, colW: [], merges: [] };
  let maxR = 0,
    maxC = 0;
  for (const k in d.cells) {
    const m = /^(\d+),(\d+)$/.exec(k);
    if (!m) continue;
    const r = +m[1],
      c = +m[2],
      x = d.cells[k];
    if (r >= MAXR || c >= MAXC || !x || typeof x.v !== 'string') continue;
    const f = +x.f;
    const cell: Cell = { v: x.v.slice(0, 2000), b: x.b ? 1 : 0, f: f >= 1 && f <= FILL_COUNT ? f : 0 };
    const o = Math.round(+x.o);
    if (cell.f && o >= 10 && o < 100) cell.o = o;
    out.cells[k] = cell;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  out.rows = Math.min(MAXR, Math.max(20, Math.floor(+d.rows) || 40, maxR + 1));
  out.cols = Math.min(MAXC, Math.max(6, Math.floor(+d.cols) || 8, maxC + 1));
  for (let i = 0; i < out.cols; i++) {
    const w = +(d.colW && d.colW[i]);
    out.colW.push(w >= 50 && w <= 500 ? w : i ? DW : LW);
  }
  (Array.isArray(d.merges) ? d.merges : []).forEach((g: any) => {
    if (!g) return;
    const a = [g.r0, g.c0, g.r1, g.c1].map((n: any) => Math.floor(+n));
    if (a.some((n) => !(n >= 0)) || a[2] < a[0] || a[3] < a[1] || a[2] >= out.rows || a[3] >= out.cols || (a[2] === a[0] && a[3] === a[1])) return;
    const hit = out.merges.some((q) => q.r0 <= a[2] && q.r1 >= a[0] && q.c0 <= a[3] && q.c1 >= a[1]);
    if (!hit) out.merges.push({ r0: a[0], c0: a[1], r1: a[2], c1: a[3] });
  });
  return out;
}

// turn any parsed workbook (backup file, server response, request body) into a safe Workbook, or null when it is not one
export function cleanWorkbook(o: any): Workbook | null {
  const list: Sheet[] = [];
  if (o && Array.isArray(o.sheets)) {
    o.sheets.slice(0, 40).forEach((x: any, i: number) => {
      const d = cleanData(x && x.data);
      if (!d) return;
      let nm = (x.name ? String(x.name) : '').replace(/[!':]/g, '').trim().slice(0, 30) || 'Tab' + (i + 1);
      const base = nm;
      let n = 2;
      while (list.some((q) => q.name.toLowerCase() === nm.toLowerCase())) nm = base.slice(0, 26) + n++;
      list.push({ name: nm, data: d });
    });
  } else {
    const one = cleanData(o);
    if (one) list.push({ name: 'Tab1', data: one });
  }
  if (!list.length) return null;
  return { cur: Math.min(Math.max(Math.floor(+o.cur) || 0, 0), list.length - 1), sheets: list };
}

// turn the text of a backup file into a workbook, or null when it is not one
export function workbookFromBackup(text: string): Workbook | null {
  let o: any;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  return cleanWorkbook(o);
}

export function backupText(W: Workbook): string {
  return JSON.stringify({
    app: 'household-ledger',
    version: 2,
    savedAt: new Date().toISOString(),
    cur: W.cur,
    sheets: W.sheets.map((x) => ({ name: x.name, data: x.data })),
  });
}
