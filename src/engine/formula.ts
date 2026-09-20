import type { Sheet } from './types';
import { colIdx, fmt, parseNum, sheetByName, unq } from './refs';

/* ---------- formula evaluation ---------- */
type Val = number | string;
type Res = Val | Val[];
type Tok = { t: 'ref!' } | { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string };

const E = (m: string) => new Error(m);

export interface Display {
  t: string; // text shown in the cell
  k: 'n' | 't' | 'e'; // number, text, error
}

export class Evaluator {
  private cache = new Map<string, Val | Error>();
  private visiting = new Set<string>();
  private sheets: Sheet[];

  constructor(sheets: Sheet[]) {
    this.sheets = sheets;
  }

  private parseRef(s: string) {
    const m = /^(?:('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_]*)!)?\$?([A-Z]+)\$?(\d+)$/u.exec(s)!;
    return { sheet: m[1] ? unq(m[1]) : null, c: colIdx(m[2]), r: +m[3] - 1 };
  }

  private resolveSheet(name: string | null, si: number): number {
    if (!name) return si;
    const t = sheetByName(this.sheets, name);
    if (!t) throw E('#REF!');
    return this.sheets.indexOf(t);
  }

  // value of a cell (numbers, text, or throws an Error such as #DIV/0!)
  evalCell(si: number, r: number, c: number): Val {
    const k = si + ':' + r + ',' + c;
    if (this.cache.has(k)) {
      const cv = this.cache.get(k)!;
      if (cv instanceof Error) throw cv;
      return cv;
    }
    if (this.visiting.has(k)) throw E('#CIRC!');
    const cell = this.sheets[si].data.cells[r + ',' + c];
    let out: Val | Error;
    if (!cell || cell.v === '') out = '';
    else if (cell.v[0] === '=') {
      this.visiting.add(k);
      try {
        out = this.evalFormula(cell.v.slice(1), si);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        out = msg && msg[0] === '#' ? (e as Error) : E('#ERR!');
      } finally {
        this.visiting.delete(k);
      }
    } else {
      const n = parseNum(cell.v);
      out = n === null ? cell.v : n;
    }
    this.cache.set(k, out);
    if (out instanceof Error) throw out;
    return out;
  }

  private valueOf(si: number, r: number, c: number): number {
    const v = this.evalCell(si, r, c);
    if (v === '') return 0;
    if (typeof v === 'string') throw E('#VALUE!');
    return v;
  }

  display(si: number, r: number, c: number): Display {
    const cell = this.sheets[si].data.cells[r + ',' + c];
    if (!cell || cell.v === '') return { t: '', k: 't' };
    try {
      const v = this.evalCell(si, r, c);
      return typeof v === 'number' ? { t: fmt(v), k: 'n' } : { t: String(v), k: 't' };
    } catch (e) {
      return { t: (e as Error).message, k: 'e' };
    }
  }

  numberAt(si: number, r: number, c: number): number | null {
    try {
      const v = this.evalCell(si, r, c);
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  private evalFormula(src: string, si: number): number {
    const toks: Tok[] = [];
    let pos = 0;
    const re =
      /\s*(?:(#REF!)|(\d+\.?\d*|\.\d+)|((?:(?:'(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_]*)!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|([A-Z]+)(?=\s*\()|([-+*\/(),]))/yu;
    for (;;) {
      if (/^\s*$/.test(src.slice(pos))) break;
      re.lastIndex = pos;
      const m = re.exec(src);
      if (!m) throw E('#ERR!');
      pos = re.lastIndex;
      if (m[1]) toks.push({ t: 'ref!' });
      else if (m[2]) toks.push({ t: 'num', v: parseFloat(m[2]) });
      else if (m[3]) toks.push({ t: 'ref', v: m[3] });
      else if (m[4]) toks.push({ t: 'fn', v: m[4] });
      else toks.push({ t: 'op', v: m[5] });
    }
    let i = 0;
    const isOp = (p: Tok | undefined, vals: string[]) => !!p && p.t === 'op' && vals.indexOf(p.v) >= 0;
    const num = (v: Res): number => {
      if (Array.isArray(v)) throw E('#VALUE!');
      return v as number;
    };
    const self = this;
    function expr(): Res {
      let v = term();
      while (isOp(toks[i], ['+', '-'])) {
        const op = (toks[i++] as { v: string }).v;
        const b = term();
        v = op === '+' ? num(v) + num(b) : num(v) - num(b);
      }
      return v;
    }
    function term(): Res {
      let v = unary();
      while (isOp(toks[i], ['*', '/'])) {
        const op = (toks[i++] as { v: string }).v;
        const b = unary();
        if (op === '*') v = num(v) * num(b);
        else {
          if (num(b) === 0) throw E('#DIV/0!');
          v = num(v) / num(b);
        }
      }
      return v;
    }
    function unary(): Res {
      const p = toks[i];
      if (isOp(p, ['-', '+'])) {
        i++;
        const v = unary();
        return (p as { v: string }).v === '-' ? -num(v) : num(v);
      }
      return primary();
    }
    function expect(v: string) {
      const p = toks[i++];
      if (!isOp(p, [v])) throw E('#ERR!');
    }
    function primary(): Res {
      const p = toks[i++];
      if (!p) throw E('#ERR!');
      if (p.t === 'num') return p.v;
      if (p.t === 'ref!') throw E('#REF!');
      if (p.t === 'ref') {
        const bang = p.v.lastIndexOf('!'),
          pre = bang >= 0 ? p.v.slice(0, bang + 1) : '',
          rest = p.v.slice(bang + 1);
        if (rest.indexOf(':') >= 0) {
          const ab = rest.split(':'),
            a = self.parseRef(pre + ab[0]),
            b = self.parseRef(ab[1]),
            out: Val[] = [],
            ts = self.resolveSheet(a.sheet, si);
          for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
            for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(self.evalCell(ts, r, c));
          return out;
        }
        const q = self.parseRef(p.v);
        return self.valueOf(self.resolveSheet(q.sheet, si), q.r, q.c);
      }
      if (p.t === 'op' && p.v === '(') {
        const v = expr();
        expect(')');
        return v;
      }
      if (p.t === 'fn') {
        expect('(');
        const args: Res[] = [];
        if (isOp(toks[i], [')'])) i++;
        else
          for (;;) {
            args.push(expr());
            const n = toks[i++];
            if (isOp(n, [')'])) break;
            if (!isOp(n, [','])) throw E('#ERR!');
          }
        return callFn(p.v, args);
      }
      throw E('#ERR!');
    }
    const result = expr();
    if (i !== toks.length) throw E('#ERR!');
    if (Array.isArray(result)) throw E('#VALUE!');
    if (!isFinite(result as number)) throw E('#NUM!');
    return result as number;
  }
}

function callFn(name: string, args: Res[]): number {
  const xs: number[] = [];
  args.forEach((a) => {
    if (Array.isArray(a)) {
      a.forEach((x) => {
        if (typeof x === 'number') xs.push(x);
      });
    } else xs.push(a as number);
  });
  const sum = xs.reduce((a, b) => a + b, 0);
  switch (name) {
    case 'SUM':
      return sum;
    case 'AVERAGE':
    case 'AVG':
      if (!xs.length) throw E('#DIV/0!');
      return sum / xs.length;
    case 'MIN':
      return xs.length ? Math.min(...xs) : 0;
    case 'MAX':
      return xs.length ? Math.max(...xs) : 0;
    default:
      throw E('#NAME?');
  }
}
