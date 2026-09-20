import type { Sheet } from './types';

/* ---------- small helpers ---------- */
export const key = (r: number, c: number) => r + ',' + c;

export function colName(n: number): string {
  let s = '';
  n++;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function colIdx(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64;
  return n - 1;
}
export const ref = (r: number, c: number) => colName(c) + (r + 1);

export function parseNum(s: string): number | null {
  const t = String(s).trim().replace(/,/g, '').replace(/^([-+]?)\s*[$£€¥]/, '$1');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : null;
}
export function fmt(n: number): string {
  if (Math.abs(n) < 1e-12) n = 0;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/* ---------- formula reference rewriting (relative / absolute refs) ---------- */
const RE =
  /(?<![A-Za-z0-9_.$!'])(?:('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/gu;

export function unq(s: string): string {
  return s[0] === "'" ? s.slice(1, -1).replace(/''/g, "'") : s;
}
export function fmtSheet(n: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) ? n : "'" + n.replace(/'/g, "''") + "'";
}
export function sheetByName(sheets: Sheet[], n: string): Sheet | null {
  n = String(n).toLowerCase();
  for (let i = 0; i < sheets.length; i++) if (sheets[i].name.toLowerCase() === n) return sheets[i];
  return null;
}

// map(kind 'r'|'c', index0, role 'single'|'start'|'end', isAbsolute, sheetName|null) -> new index or null
export type RefMap = (k: 'r' | 'c', i: number, role: 'single' | 'start' | 'end', abs: boolean, sheetName: string | null) => number | null;

export function xform(f: string, map: RefMap): string {
  return f.replace(RE, (_m, shp, ac, cl, ar, rw, ac2, cl2, ar2, rw2) => {
    const nm: string | null = shp ? unq(shp) : null;
    const pf = shp ? shp + '!' : '';
    const role = cl2 ? 'start' : 'single';
    const c = map('c', colIdx(cl), role, !!ac, nm);
    const r = map('r', +rw - 1, role, !!ar, nm);
    if (cl2) {
      const c2 = map('c', colIdx(cl2), 'end', !!ac2, nm);
      const r2 = map('r', +rw2 - 1, 'end', !!ar2, nm);
      if (c == null || r == null || c2 == null || r2 == null || c2 < c || r2 < r) return '#REF!';
      return pf + (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1) + ':' + (ac2 ? '$' : '') + colName(c2) + (ar2 ? '$' : '') + (r2 + 1);
    }
    if (c == null || r == null) return '#REF!';
    return pf + (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1);
  });
}

// fn(sheetName) -> new name | null (becomes #REF!) | undefined (leave as is)
export function rewriteSheet(f: string, fn: (name: string) => string | null | undefined): string {
  if (f.indexOf('!') < 0) return f;
  return f.replace(RE, (m, shp) => {
    if (!shp) return m;
    const res = fn(unq(shp));
    if (res === undefined) return m;
    if (res === null) return '#REF!';
    return fmtSheet(res) + '!' + m.slice(shp.length + 1);
  });
}

export function canonSheets(v: string, sheets: Sheet[]): string {
  return rewriteSheet(v, (n) => {
    const t = sheetByName(sheets, n);
    return t ? t.name : undefined;
  });
}

export function shiftMap(dr: number, dc: number): RefMap {
  return (k, i, _role, abs) => {
    if (abs) return i;
    const n = i + (k === 'r' ? dr : dc);
    return n < 0 ? null : n;
  };
}
export function insMap(kind: 'r' | 'c', at: number, n: number): RefMap {
  return (k, i) => (k === kind && i >= at ? i + n : i);
}
export function delMap(kind: 'r' | 'c', at: number, n: number): RefMap {
  return (k, i, role) => {
    if (k !== kind || i < at) return i;
    if (i >= at + n) return i - n;
    if (role === 'start') return at;
    if (role === 'end') return at - 1 >= 0 ? at - 1 : null;
    return null;
  };
}
