import { DW, FILL_COUNT, MAXC, MAXR, MAX_TABS } from './types';
import type { Cell, Merge, Range, Sel, Sheet, SheetData, Workbook } from './types';
import { canonSheets, colName, delMap, fmt, fmtSheet, insMap, key, ref, rewriteSheet, sheetByName, shiftMap, xform } from './refs';
import type { RefMap } from './refs';
import { Evaluator } from './formula';
import {
  TEMPLATES, TEMPLATE_MERGES, backupText, blank, cloneCell, loadWorkbook, place, sampleData, saveWorkbook, setCell,
  tplSize, workbookFromBackup,
} from './model';
import type { StorageLike } from './model';
import { downloadFile } from './download';
import { buildPdf } from './pdf';
import { FILLS } from './palette';

export interface Clip {
  cells: (Cell | null)[][];
  r0: number; c0: number; h: number; w: number;
  merges: Merge[];
  tsv: string;
}
export interface Suggestion { kind: 'fn' | 'tab'; name: string; d: string }
export type InputId = 'ed' | 'fb';

// a change waiting for the user's say-so ("Change A4 from 0 to 10?")
export interface ConfirmDesc { title: string; message: string; danger?: boolean; confirmLabel?: string }
export interface PendingChange extends ConfirmDesc { run: () => void; cancel: () => void }

function shortValue(v: string): string {
  if (v === '') return '(empty)';
  const t = v.length > 40 ? v.slice(0, 37) + '…' : v;
  return '"' + t + '"';
}
function describeValueChange(address: string, oldV: string, newV: string): string {
  if (oldV === '') return 'Set ' + address + ' to ' + shortValue(newV) + '?';
  if (newV === '') return 'Clear ' + address + ' (currently ' + shortValue(oldV) + ')?';
  return 'Change ' + address + ' from ' + shortValue(oldV) + ' to ' + shortValue(newV) + '?';
}
function fillName(n: number): string {
  const f = FILLS.find((x) => x.n === n);
  return f ? f.name : 'colour ' + n;
}

export const FUNCS = [
  { name: 'SUM', d: 'Add up numbers or a range' },
  { name: 'AVG', d: 'Average of numbers' },
  { name: 'MAX', d: 'Largest value' },
  { name: 'MIN', d: 'Smallest value' },
];
export const SYMS: [string, string][] = [['(', '('], [')', ')'], [',', ','], [':', ':'], ['+', '+'], ['-', '-'], ['×', '*'], ['÷', '/']];
const TOKRE = /([A-Za-z_][A-Za-z0-9_]*)$/;

export const HINT_DESKTOP = 'Press Enter to edit a cell. Start with = to write a formula, then click cells to add them.';
export const HINT_TOUCH = 'Tap a cell to select it, tap again to edit. Start with = to write a formula, then tap cells to add them.';

const UI_KEY = 'household-ledger-ui';

type MouseLike = { target: EventTarget | null; shiftKey: boolean; preventDefault(): void };
type KeyLike = { target?: EventTarget | null; key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; preventDefault(): void };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

export class Store {
  W: Workbook;
  storage: StorageLike | null;
  coarse: boolean;

  hist: string[] = [];
  future: string[] = [];
  sel: Sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
  clip: Clip | null = null;
  copyRange: Range | null = null;
  extendMode = false;

  editing = false;
  edit = { si: 0, r: 0, c: 0 };
  editText = '';
  pendingCaret: { target: InputId; pos: number; focus: boolean } | null = null;
  sugItems: Suggestion[] = [];
  sugIdx = -1;

  renaming = -1;
  delArm = false;
  msg = '';
  msgId = 0;
  fillOpacity = 100;
  revealReq = false;

  // ask before every change ("permission modal"): on by default, one at a time
  confirmMode = true;
  pending: PendingChange | null = null;

  cover = new Map<string, Merge>();
  // bumped on: any change (tick), data/structure change (ver), selection change (selVer)
  tick = 0;
  ver = 0;
  selVer = 0;
  wver = 0; // column widths / size of the grid

  wrapEl: HTMLElement | null = null;
  edEl: HTMLInputElement | null = null;
  fbEl: HTMLInputElement | null = null;

  private listeners = new Set<() => void>();
  private _ev: Evaluator | null = null;
  private dragging = false;
  private tapEdit = false;
  private delTimer: ReturnType<typeof setTimeout> | undefined;
  private msgTimer: ReturnType<typeof setTimeout> | undefined;
  private pdfBusy = false;

  // called after every change that should be kept (the sync layer listens to this to save to the server)
  onPersist: (() => void) | null = null;

  constructor(storage: StorageLike | null, coarse = false, initial?: Workbook) {
    this.storage = storage;
    this.coarse = coarse;
    this.W = initial ?? loadWorkbook(storage);
    this.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    try {
      const u = JSON.parse(storage?.getItem(UI_KEY) || '{}');
      if (u && u.fillOpacity >= 10 && u.fillOpacity <= 100) this.fillOpacity = Math.round(u.fillOpacity);
      if (u && typeof u.confirmMode === 'boolean') this.confirmMode = u.confirmMode;
    } catch { /* ignore */ }
    this.applyMerges();
  }

  /* ---------- react glue ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.tick;
  emit() {
    this.tick++;
    this.listeners.forEach((l) => l());
  }
  private selChanged() {
    this.selVer++;
    this.emit();
  }
  // after any change to cells / sheets: re-derive merges, drop cached formula results, repaint
  refresh() {
    this.applyMerges();
    this._ev = null;
    this.ver++;
    this.selVer++;
    this.wver++;
    this.emit();
  }

  get S(): SheetData {
    return this.W.sheets[this.W.cur].data;
  }
  set S(d: SheetData) {
    this.W.sheets[this.W.cur].data = d;
  }
  get curSheet(): Sheet {
    return this.W.sheets[this.W.cur];
  }
  get ev(): Evaluator {
    return this._ev || (this._ev = new Evaluator(this.W.sheets));
  }
  get hint() {
    return this.coarse ? HINT_TOUCH : HINT_DESKTOP;
  }

  /* ---------- messages ---------- */
  flash(m: string) {
    this.msg = m;
    this.msgId++;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => {
      this.msg = '';
      this.emit();
    }, 4200);
    this.emit();
  }

  /* ---------- ranges & merges ---------- */
  rng(): Range {
    const sel = this.sel;
    const R = { r0: Math.min(sel.ar, sel.fr), r1: Math.max(sel.ar, sel.fr), c0: Math.min(sel.ac, sel.fc), c1: Math.max(sel.ac, sel.fc) };
    let ch = true;
    while (ch) {
      ch = false;
      this.S.merges.forEach((m) => {
        if (m.r0 <= R.r1 && m.r1 >= R.r0 && m.c0 <= R.c1 && m.c1 >= R.c0) {
          if (m.r0 < R.r0) { R.r0 = m.r0; ch = true; }
          if (m.r1 > R.r1) { R.r1 = m.r1; ch = true; }
          if (m.c0 < R.c0) { R.c0 = m.c0; ch = true; }
          if (m.c1 > R.c1) { R.c1 = m.c1; ch = true; }
        }
      });
    }
    return R;
  }
  // "A4" for one cell, "A1:B3" for a block — used in confirmation messages
  addressOf(R: Range): string {
    return R.r0 === R.r1 && R.c0 === R.c1 ? ref(R.r0, R.c0) : ref(R.r0, R.c0) + ':' + ref(R.r1, R.c1);
  }
  snap(r: number, c: number): [number, number] {
    const m = this.cover.get(key(r, c));
    return m ? [m.r0, m.c0] : [r, c];
  }
  private unmergeArea(r0: number, c0: number, r1: number, c1: number) {
    this.S.merges = this.S.merges.filter((m) => !(m.r0 <= r1 && m.r1 >= r0 && m.c0 <= c1 && m.c1 >= c0));
  }
  private applyMerges() {
    const S = this.S;
    this.cover = new Map();
    const keep: Merge[] = [];
    S.merges.forEach((m) => {
      if (m.r0 >= S.rows || m.c0 >= S.cols) return;
      m.r1 = Math.min(m.r1, S.rows - 1);
      m.c1 = Math.min(m.c1, S.cols - 1);
      keep.push(m);
      for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) this.cover.set(key(r, c), m);
    });
    S.merges = keep;
    const sel = this.sel;
    let s = this.snap(sel.ar, sel.ac);
    sel.ar = s[0]; sel.ac = s[1];
    s = this.snap(sel.fr, sel.fc);
    sel.fr = s[0]; sel.fc = s[1];
  }
  private adjMerges(kind: 'r' | 'c', mode: 'ins' | 'del', at: number, n: number) {
    const out: Merge[] = [];
    this.S.merges.forEach((m) => {
      const a0 = kind === 'r' ? m.r0 : m.c0, a1 = kind === 'r' ? m.r1 : m.c1;
      let b0: number, b1: number;
      if (mode === 'ins') { b0 = a0 >= at ? a0 + n : a0; b1 = a1 >= at ? a1 + n : a1; }
      else if (a1 < at) { b0 = a0; b1 = a1; }
      else if (a0 >= at + n) { b0 = a0 - n; b1 = a1 - n; }
      else {
        b0 = a0 < at ? a0 : at;
        b1 = a1 >= at + n ? a1 - n : at - 1;
        if (b1 < b0) return;
      }
      const nm = { r0: m.r0, c0: m.c0, r1: m.r1, c1: m.c1 };
      if (kind === 'r') { nm.r0 = b0; nm.r1 = b1; } else { nm.c0 = b0; nm.c1 = b1; }
      if (nm.r1 > nm.r0 || nm.c1 > nm.c0) out.push(nm);
    });
    this.S.merges = out;
  }
  private hasMerge(R: Range) {
    return this.S.merges.some((m) => m.r0 <= R.r1 && m.r1 >= R.r0 && m.c0 <= R.c1 && m.c1 >= R.c0);
  }
  mergeSel() {
    const R = this.rng(), S = this.S;
    if (R.r0 === R.r1 && R.c0 === R.c1) { this.flash('Select two or more cells to combine, for example A1 and A2.'); return; }
    if ((R.r0 === 0 && R.r1 === S.rows - 1) || (R.c0 === 0 && R.c1 === S.cols - 1)) {
      this.flash('Select only the cells you want to combine, not a whole row or column.');
      return;
    }
    let lost = 0;
    for (let r = R.r0; r <= R.r1; r++)
      for (let c = R.c0; c <= R.c1; c++) {
        if (r === R.r0 && c === R.c0) continue;
        const x = S.cells[key(r, c)];
        if (x && x.v !== '') lost++;
      }
    const address = this.addressOf(R);
    const message = lost
      ? 'Merge ' + address + ' into one cell? Only the top-left value is kept — ' + lost + ' other value' + (lost > 1 ? 's' : '') + ' will be hidden (Undo brings them back).'
      : 'Merge ' + address + ' into one cell?';
    this.gate({ title: 'Merge cells', message, danger: !!lost, confirmLabel: 'Merge' }, () => {
      this.mutate(() => {
        this.unmergeArea(R.r0, R.c0, R.r1, R.c1);
        for (let r = R.r0; r <= R.r1; r++)
          for (let c = R.c0; c <= R.c1; c++) {
            if (r === R.r0 && c === R.c0) continue;
            delete this.S.cells[key(r, c)];
          }
        this.S.merges.push({ r0: R.r0, c0: R.c0, r1: R.r1, c1: R.c1 });
        this.sel = { ar: R.r0, ac: R.c0, fr: R.r1, fc: R.c1 };
        this.copyRange = null;
      });
      this.flash(lost ? 'Combined. Only the top-left value was kept. Undo brings back the ' + lost + ' other value' + (lost > 1 ? 's' : '') + '.' : 'Cells combined into one box.');
    });
  }
  unmergeSel() {
    const R = this.rng();
    if (!this.hasMerge(R)) { this.flash('No combined cells in the selection.'); return; }
    const address = this.addressOf(R);
    this.gate({ title: 'Unmerge cells', message: 'Unmerge the cells in ' + address + '?', confirmLabel: 'Unmerge' }, () => {
      this.mutate(() => { this.unmergeArea(R.r0, R.c0, R.r1, R.c1); this.copyRange = null; });
      this.flash('Cells separated again.');
    });
  }

  /* ---------- history / mutation ---------- */
  save(silent = false) {
    saveWorkbook(this.storage, this.W);
    if (!silent) this.onPersist?.();
  }
  // swap in a whole ledger (e.g. the newest one from the server); history starts fresh
  replaceWorkbook(wb: Workbook, silent = true) {
    if (this.editing) this.cancelEdit();
    this.W = wb;
    this.hist = [];
    this.future = [];
    this.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    this.copyRange = null;
    this.renaming = -1;
    this.scrollReset();
    this.save(silent);
    this.refresh();
  }
  snapshot(): string {
    return JSON.stringify({ cur: this.W.cur, sheets: this.W.sheets.map((x) => ({ name: x.name, data: x.data })) });
  }
  pushHist() {
    this.hist.push(this.snapshot());
    if (this.hist.length > 100) this.hist.shift();
    this.future.length = 0;
  }
  mutate(fn: () => void) {
    this.pushHist();
    fn();
    this.save();
    this.refresh();
  }
  /* ---------- ask first ("permission modal") ----------
     When confirmMode is on, a mutation is held as `pending` instead of running immediately; the UI shows
     a modal built from `desc` and the change only happens once the user presses Confirm. Only one change
     waits at a time — starting a new edit while one is pending is blocked (see startEdit). */
  private gate(desc: ConfirmDesc, fn: () => void) {
    if (!this.confirmMode) { fn(); return; }
    if (this.pending) { this.flash('Please confirm or cancel the change that is waiting first.'); return; }
    this.pending = {
      ...desc,
      run: () => { this.pending = null; fn(); this.emit(); },
      cancel: () => { this.pending = null; this.emit(); },
    };
    this.emit();
  }
  confirmPending() {
    this.pending?.run();
  }
  cancelPending() {
    this.pending?.cancel();
  }
  private saveUiPrefs() {
    try { this.storage?.setItem(UI_KEY, JSON.stringify({ fillOpacity: this.fillOpacity, confirmMode: this.confirmMode })); } catch { /* ignore */ }
  }
  toggleConfirmMode() {
    this.confirmMode = !this.confirmMode;
    this.saveUiPrefs();
    this.flash(this.confirmMode ? 'Changes will now ask you to confirm first.' : 'Changes now apply right away, without asking.');
    this.emit();
  }
  private clampSel() {
    const S = this.S, sel = this.sel;
    sel.ar = Math.min(sel.ar, S.rows - 1); sel.fr = Math.min(sel.fr, S.rows - 1);
    sel.ac = Math.min(sel.ac, S.cols - 1); sel.fc = Math.min(sel.fc, S.cols - 1);
  }
  private afterRestore() {
    this.copyRange = null;
    this.clampSel();
    this.save();
    this.refresh();
  }
  restoreSnap(str: string) {
    const o = JSON.parse(str), prev = this.W.cur;
    this.stashSheet();
    const old = this.W.sheets;
    this.W.sheets = o.sheets.map((x: Sheet, i: number) => ({ name: x.name, data: x.data, _sel: old[i] ? old[i]._sel : null }));
    this.W.cur = Math.min(o.cur, this.W.sheets.length - 1);
    if (this.W.cur !== prev) {
      this.sel = this.W.sheets[this.W.cur]._sel || { ar: 0, ac: 0, fr: 0, fc: 0 };
      this.scrollReset();
    }
    this.afterRestore();
  }
  undo() {
    this.commitEdit();
    if (!this.hist.length) return;
    this.future.push(this.snapshot());
    this.restoreSnap(this.hist.pop()!);
  }
  redo() {
    this.commitEdit();
    if (!this.future.length) return;
    this.hist.push(this.snapshot());
    this.restoreSnap(this.future.pop()!);
  }
  ensureSize(rows: number, cols: number) {
    const S = this.S;
    rows = Math.min(rows, MAXR);
    cols = Math.min(cols, MAXC);
    S.rows = Math.max(S.rows, Math.min(MAXR, rows + 3));
    while (S.cols < cols) { S.cols++; S.colW.push(DW); }
  }

  /* ---------- dom bridges ---------- */
  focusGrid() {
    this.wrapEl?.focus({ preventScroll: true });
  }
  reveal() {
    this.revealReq = true;
  }
  private scrollReset() {
    if (this.wrapEl) { this.wrapEl.scrollTop = 0; this.wrapEl.scrollLeft = 0; }
  }

  /* ---------- editing ---------- */
  rawActive(): string {
    const c = this.S.cells[key(this.sel.ar, this.sel.ac)];
    return c ? c.v : '';
  }
  get editAway() {
    return this.editing && this.W.cur !== this.edit.si;
  }
  fxEditing() {
    return this.editing && this.editText[0] === '=';
  }
  private setCaret(target: InputId, pos: number, focus = false) {
    this.pendingCaret = { target, pos, focus };
  }
  startEdit(text: string, fromBar = false) {
    if (this.editing) return;
    if (this.pending) { this.flash('Please confirm or cancel the pending change first.'); return; }
    this.editing = true;
    this.edit = { si: this.W.cur, r: this.sel.ar, c: this.sel.ac };
    this.editText = text;
    this.reveal();
    if (!fromBar) this.setCaret('ed', text.length, true);
    this.emit();
  }
  // type into whichever box is active; keeps the two boxes and suggestions in step
  setEditText(text: string) {
    if (!this.editing) this.startEdit(text, true);
    this.editText = text;
    this.emit();
  }
  private applyEdit() {
    if (this.W.cur !== this.edit.si) { this.stashSheet(); this.loadSheet(this.edit.si); }
    let v = this.editText;
    if (v.trim()[0] === '=') v = canonSheets(v.trim().toUpperCase(), this.W.sheets);
    const { r, c } = this.edit, cur = this.S.cells[key(r, c)], curV = cur ? cur.v : '';
    if (curV === v) return;
    const address = ref(r, c);
    this.gate(
      { title: 'Change ' + address, message: describeValueChange(address, curV, v), confirmLabel: 'Change' },
      () => this.mutate(() => setCell(this.S, r, c, { v })),
    );
  }
  private closeEditor() {
    this.editing = false;
    this.editText = '';
    this.sugItems = [];
    this.sugIdx = -1;
    this.emit();
  }
  commitEdit(): boolean {
    if (!this.editing) return false;
    this.applyEdit();
    this.closeEditor();
    return true;
  }
  cancelEdit() {
    if (!this.editing) return;
    if (this.W.cur !== this.edit.si) { this.stashSheet(); this.loadSheet(this.edit.si); }
    this.closeEditor();
    this.focusGrid();
  }
  // save this cell and start editing another one WITHOUT dropping focus, so the phone keyboard stays open
  retarget(r: number, c: number) {
    this.applyEdit();
    r = Math.min(r, MAXR - 1);
    c = Math.min(c, MAXC - 1);
    if (r >= this.S.rows || c >= this.S.cols) { this.ensureSize(r + 1, c + 1); this.refresh(); }
    const sn = this.snap(r, c);
    r = sn[0]; c = sn[1];
    this.sel = { ar: r, ac: c, fr: r, fc: c };
    this.edit = { si: this.W.cur, r, c };
    const text = this.rawActive();
    this.editText = text;
    this.reveal();
    this.setCaret('ed', text.length);
    this.selChanged();
  }
  editNext() {
    const m = this.cover.get(key(this.edit.r, this.edit.c));
    this.retarget((m ? m.r1 : this.edit.r) + 1, this.edit.c);
  }
  onEditKeyDown(e: KeyLike) {
    if (this.sugKeys(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.coarse && this.editing && this.W.cur === this.edit.si && !this.confirmMode) { this.editNext(); return; }
      this.commitEdit(); this.focusGrid(); this.move(1, 0, false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.commitEdit(); this.focusGrid(); this.move(0, e.shiftKey ? -1 : 1, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelEdit();
    }
  }
  done() {
    this.commitEdit();
    this.focusGrid();
  }

  /* click a cell while writing a formula to insert its reference (with the tab name if it is on another tab) */
  curInput(): HTMLInputElement | null {
    return document.activeElement === this.fbEl ? this.fbEl : this.edEl;
  }
  private inputId(i: HTMLInputElement): InputId {
    return i === this.fbEl ? 'fb' : 'ed';
  }
  refInsertOK(): boolean {
    const i = this.curInput();
    if (!i) return false;
    const v = i.value;
    if (v[0] !== '=') return false;
    const p = i.selectionStart ?? v.length;
    if (p !== i.selectionEnd) return false;
    const prev = v.slice(0, p).replace(/\s+$/, '').slice(-1);
    return prev === '' || /[=+\-*\/(,:]/.test(prev);
  }
  insertRef(r: number, c: number) {
    const i = this.curInput();
    if (!i) return;
    const s = i.selectionStart ?? 0, e = i.selectionEnd ?? s, v = i.value;
    let t = ref(r, c);
    const prev = v.slice(0, s).replace(/\s+$/, '').slice(-1);
    if (this.W.cur !== this.edit.si && prev !== ':') t = fmtSheet(this.curSheet.name) + '!' + t;
    this.replaceRange(i, s, e, t);
  }

  /* ---------- formula helper: function suggestions, auto brackets, symbol keys ---------- */
  private fxCtx() {
    if (!this.editing) return null;
    const i = this.curInput();
    if (!i) return null;
    const v = i.value;
    if (v[0] !== '=' || i.selectionStart !== i.selectionEnd) return null;
    const pos = i.selectionStart ?? v.length;
    return { i, v, pos, before: v.slice(0, pos) };
  }
  private suggestions(): Suggestion[] {
    const c = this.fxCtx();
    if (!c) return [];
    const m = TOKRE.exec(c.before), out: Suggestion[] = [];
    if (!m) {
      if (c.before === '=') FUNCS.forEach((f) => out.push({ kind: 'fn', name: f.name, d: f.d }));
      return out;
    }
    const tok = m[1], startIdx = c.pos - tok.length;
    if (startIdx > 0 && /[!'$.]/.test(c.v.charAt(startIdx - 1))) return out;
    const up = tok.toUpperCase();
    FUNCS.forEach((f) => { if (f.name.indexOf(up) === 0) out.push({ kind: 'fn', name: f.name, d: f.d }); });
    this.W.sheets.forEach((x) => {
      if (x.name.toLowerCase().indexOf(tok.toLowerCase()) === 0) out.push({ kind: 'tab', name: x.name, d: 'Use cells from this tab' });
    });
    return out.slice(0, 6);
  }
  updateSug() {
    const items = this.fxEditing() ? this.suggestions() : [];
    const same = items.length === this.sugItems.length && items.every((x, i) => x.kind === this.sugItems[i].kind && x.name === this.sugItems[i].name);
    if (same) return;
    this.sugItems = items;
    this.sugIdx = -1;
    this.emit();
  }
  private replaceRange(i: HTMLInputElement, start: number, end: number, text: string, caret?: number) {
    const v = i.value;
    this.editText = v.slice(0, start) + text + v.slice(end);
    this.setCaret(this.inputId(i), start + (caret == null ? text.length : caret));
    this.emit();
  }
  acceptSug(it: Suggestion | undefined) {
    const c = this.fxCtx();
    if (!c || !it) return;
    const m = TOKRE.exec(c.before), start = m ? c.pos - m[1].length : c.pos;
    let text: string, caret: number;
    if (it.kind === 'fn') {
      text = c.v.charAt(c.pos) === '(' ? it.name : it.name + '()'; // brackets added for you, cursor goes inside
      caret = it.name.length + 1;
    } else {
      text = fmtSheet(it.name) + '!';
      caret = text.length;
    }
    this.replaceRange(c.i, start, c.pos, text, caret);
    this.pendingCaret!.focus = true;
  }
  insertSym(sym: string) {
    const c = this.fxCtx();
    if (!c) return;
    if (sym === '(') this.replaceRange(c.i, c.pos, c.pos, '()', 1);
    else if (sym === ')' && c.v.charAt(c.pos) === ')') {
      this.setCaret(this.inputId(c.i), c.pos + 1);
      this.emit();
    } else this.replaceRange(c.i, c.pos, c.pos, sym);
  }
  pickSug(i: number) {
    this.acceptSug(this.sugItems[i]);
  }
  private sugKeys(e: KeyLike): boolean {
    if (!this.sugItems.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.sugItems.length;
      this.sugIdx = e.key === 'ArrowDown' ? (this.sugIdx + 1) % n : this.sugIdx <= 0 ? n - 1 : this.sugIdx - 1;
      this.emit();
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && this.sugIdx >= 0)) {
      e.preventDefault();
      this.acceptSug(this.sugItems[Math.max(this.sugIdx, 0)]);
      return true;
    }
    return false;
  }
  // typing "(" adds the closing ")" too, and typing ")" steps over an existing one
  autoPair(e: InputEvent) {
    if (e.inputType !== 'insertText' || !e.data) return;
    const i = e.target as HTMLInputElement, v = i.value;
    if (v[0] !== '=' || i.selectionStart !== i.selectionEnd) return;
    const p = i.selectionStart ?? 0;
    if (e.data === '(') { e.preventDefault(); this.replaceRange(i, p, p, '()', 1); }
    else if (e.data === ')' && v.charAt(p) === ')') {
      e.preventDefault();
      this.setCaret(this.inputId(i), p + 1);
      this.emit();
    }
  }

  /* ---------- selection & navigation ---------- */
  move(dr: number, dc: number, ext: boolean) {
    const sel = this.sel;
    const br = ext ? sel.fr : sel.ar, bc = ext ? sel.fc : sel.ac, m = this.cover.get(key(br, bc));
    let r = (dr > 0 && m ? m.r1 : br) + dr, c = (dc > 0 && m ? m.c1 : bc) + dc;
    r = clamp(r, 0, MAXR - 1); c = clamp(c, 0, MAXC - 1);
    if (r >= this.S.rows || c >= this.S.cols) { this.ensureSize(r + 1, c + 1); this.refresh(); }
    const sn = this.snap(r, c);
    r = sn[0]; c = sn[1];
    if (ext) { sel.fr = r; sel.fc = c; } else { sel.ar = sel.fr = r; sel.ac = sel.fc = c; }
    this.reveal();
    this.selChanged();
  }
  selectAll() {
    this.sel = { ar: 0, ac: 0, fr: this.S.rows - 1, fc: this.S.cols - 1 };
    this.selChanged();
  }
  toggleExtend() {
    this.extendMode = !this.extendMode;
    this.emit();
  }
  onGridMouseDown(e: MouseLike) {
    const t = e.target as Element;
    if (t === this.edEl) return;
    if (t.closest('.rz')) return;
    const td = t.closest('td') as HTMLElement | null, ch = t.closest('th.ch') as HTMLElement | null;
    const rh = t.closest('th.rh') as HTMLElement | null, cn = t.closest('th.corner');
    const wasEditing = this.editing;
    if (this.editing) {
      const away = this.W.cur !== this.edit.si;
      if (td && this.refInsertOK()) { e.preventDefault(); this.insertRef(+td.dataset.r!, +td.dataset.c!); return; }
      // phone: one tap on any other cell jumps the editor there and keeps the keyboard open
      // (off while confirming every change, so a tap can never race a pending confirmation)
      if (td && this.coarse && !away && !this.confirmMode && !e.shiftKey && !this.extendMode) {
        e.preventDefault();
        this.tapEdit = false;
        this.retarget(+td.dataset.r!, +td.dataset.c!);
        return;
      }
      this.commitEdit();
      if (away) { this.focusGrid(); return; }
    }
    const ext = e.shiftKey || this.extendMode, sel = this.sel, S = this.S;
    this.tapEdit = this.coarse && !!td && !ext && !wasEditing && sel.ar === sel.fr && sel.ac === sel.fc && sel.ar === +td.dataset.r! && sel.ac === +td.dataset.c!;
    if (td) {
      const r = +td.dataset.r!, c = +td.dataset.c!;
      if (ext) { sel.fr = r; sel.fc = c; } else this.sel = { ar: r, ac: c, fr: r, fc: c };
      this.dragging = true;
    } else if (ch) {
      const cc = +ch.dataset.c!;
      if (ext) { sel.ar = 0; sel.fr = S.rows - 1; sel.fc = cc; } else this.sel = { ar: 0, ac: cc, fr: S.rows - 1, fc: cc };
    } else if (rh) {
      const rr = +rh.dataset.r!;
      if (ext) { sel.ac = 0; sel.fc = S.cols - 1; sel.fr = rr; } else this.sel = { ar: rr, ac: 0, fr: rr, fc: S.cols - 1 };
    } else if (cn) {
      this.sel = { ar: 0, ac: 0, fr: S.rows - 1, fc: S.cols - 1 };
    }
    this.selChanged();
    this.focusGrid();
  }
  onGridClick() {
    if (this.tapEdit) {
      this.tapEdit = false;
      if (!this.editing && !this.dragging) this.startEdit(this.rawActive());
    }
  }
  onGridMouseMove(e: { target: EventTarget | null }) {
    if (!this.dragging) return;
    const td = (e.target as Element).closest && ((e.target as Element).closest('td') as HTMLElement | null);
    if (td) {
      const r = +td.dataset.r!, c = +td.dataset.c!;
      if (r !== this.sel.fr || c !== this.sel.fc) { this.sel.fr = r; this.sel.fc = c; this.selChanged(); }
    }
  }
  onMouseUp() {
    this.dragging = false;
  }
  onGridDblClick(e: { target: EventTarget | null }) {
    const td = (e.target as Element).closest('td');
    if (td && !this.editing) this.startEdit(this.rawActive());
  }
  // a mouse press anywhere outside the sheet finishes the edit (except tabs / suggestions while pointing at cells)
  onDocMouseDown(e: MouseLike) {
    const t = e.target as Element;
    if (this.editing && t !== this.edEl && t !== this.fbEl && !(this.wrapEl && this.wrapEl.contains(t))) {
      if (this.fxEditing() && t.closest && t.closest('[data-keep-edit]')) { e.preventDefault(); return; }
      this.commitEdit();
    }
  }
  onGridKeyDown(e: KeyLike) {
    if (e.target === this.edEl) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    if (mod) {
      const l = k.toLowerCase();
      if (l === 'z') { e.preventDefault(); if (sh) this.redo(); else this.undo(); }
      else if (l === 'y') { e.preventDefault(); this.redo(); }
      else if (l === 'b') { e.preventDefault(); this.toggleBold(); }
      else if (l === 'd') { e.preventDefault(); this.fillDown(); }
      else if (l === 'a') { e.preventDefault(); this.selectAll(); }
      else if (l === 'c') { this.doCopy(true); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); this.move(1, 0, sh); }
    else if (k === 'ArrowUp') { e.preventDefault(); this.move(-1, 0, sh); }
    else if (k === 'ArrowLeft') { e.preventDefault(); this.move(0, -1, sh); }
    else if (k === 'ArrowRight') { e.preventDefault(); this.move(0, 1, sh); }
    else if (k === 'Tab') { e.preventDefault(); this.move(0, sh ? -1 : 1, false); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); this.startEdit(this.rawActive()); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clearSel(); }
    else if (k === 'Escape') { this.copyRange = null; this.selChanged(); }
    else if (k.length === 1 && !e.altKey) { e.preventDefault(); this.startEdit(k); }
  }
  setColWidth(c: number, w: number) {
    this.S.colW[c] = clamp(w, 50, 500);
    this.wver++;
    this.emit();
  }
  endResize() {
    this.save();
  }

  /* ---------- copy & paste (structure + formulas, relative refs adjust) ---------- */
  private usedBounds() {
    let mr = 0, mc = 0;
    for (const k in this.S.cells) {
      const p = k.split(',');
      mr = Math.max(mr, +p[0]);
      mc = Math.max(mc, +p[1]);
    }
    return { mr, mc };
  }
  doCopy(writeSystem: boolean) {
    this.commitEdit();
    const R = this.rng(), ub = this.usedBounds(), S = this.S;
    if (R.r0 === 0 && R.r1 === S.rows - 1) R.r1 = Math.min(R.r1, ub.mr);
    if (R.c0 === 0 && R.c1 === S.cols - 1) R.c1 = Math.min(R.c1, ub.mc);
    const cells: (Cell | null)[][] = [], lines: string[] = [];
    for (let r = R.r0; r <= R.r1; r++) {
      const row: (Cell | null)[] = [], line: string[] = [];
      for (let c = R.c0; c <= R.c1; c++) {
        const cell = S.cells[key(r, c)];
        row.push(cell ? cloneCell(cell) : null);
        line.push(this.ev.display(this.W.cur, r, c).t);
      }
      cells.push(row);
      lines.push(line.join('\t'));
    }
    const mg: Merge[] = [];
    S.merges.forEach((m) => {
      if (m.r0 >= R.r0 && m.r1 <= R.r1 && m.c0 >= R.c0 && m.c1 <= R.c1) mg.push({ r0: m.r0 - R.r0, c0: m.c0 - R.c0, r1: m.r1 - R.r0, c1: m.c1 - R.c0 });
    });
    this.clip = { cells, r0: R.r0, c0: R.c0, h: R.r1 - R.r0 + 1, w: R.c1 - R.c0 + 1, merges: mg, tsv: lines.join('\n') };
    this.copyRange = R;
    this.selChanged();
    this.flash('Copied ' + ref(R.r0, R.c0) + ':' + ref(R.r1, R.c1) + '. Click where it should go, then paste.');
    if (writeSystem && navigator.clipboard && navigator.clipboard.writeText) {
      try { navigator.clipboard.writeText(this.clip.tsv).catch(() => {}); } catch { /* ignore */ }
    }
  }
  pasteClip() {
    const clip = this.clip;
    if (!clip) { this.flash('Nothing copied yet. Select a block and choose Copy.'); return; }
    this.commitEdit();
    const R = this.rng(), tr = R.r0, tc = R.c0, selH = R.r1 - R.r0 + 1, selW = R.c1 - R.c0 + 1;
    const repR = selH > clip.h && selH % clip.h === 0 ? selH / clip.h : 1;
    const repC = selW > clip.w && selW % clip.w === 0 ? selW / clip.w : 1;
    const address = this.addressOf({ r0: tr, c0: tc, r1: Math.min(MAXR - 1, tr + clip.h * repR - 1), c1: Math.min(MAXC - 1, tc + clip.w * repC - 1) });
    this.gate({ title: 'Paste', message: 'Paste into ' + address + '? This replaces what is there now.', danger: true, confirmLabel: 'Paste' }, () => {
      this.mutate(() => {
        this.ensureSize(tr + clip.h * repR, tc + clip.w * repC);
        const S = this.S;
        for (let a = 0; a < repR; a++)
          for (let b = 0; b < repC; b++) {
            const or = tr + a * clip.h, oc = tc + b * clip.w, dr = or - clip.r0, dc = oc - clip.c0;
            this.unmergeArea(or, oc, or + clip.h - 1, oc + clip.w - 1);
            for (let i = 0; i < clip.h; i++)
              for (let j = 0; j < clip.w; j++) {
                const r = or + i, c = oc + j;
                if (r >= MAXR || c >= MAXC) continue;
                const src = clip.cells[i][j];
                if (src) {
                  let v = src.v;
                  if (v[0] === '=') v = xform(v, shiftMap(dr, dc));
                  S.cells[key(r, c)] = cloneCell(src, v);
                } else delete S.cells[key(r, c)];
              }
            (clip.merges || []).forEach((m) => {
              if (or + m.r1 < MAXR && oc + m.c1 < MAXC) S.merges.push({ r0: or + m.r0, c0: oc + m.c0, r1: or + m.r1, c1: oc + m.c1 });
            });
          }
        this.sel = { ar: tr, ac: tc, fr: Math.min(MAXR - 1, tr + clip.h * repR - 1), fc: Math.min(MAXC - 1, tc + clip.w * repC - 1) };
      });
      this.reveal();
      this.emit();
    });
  }
  pasteText(t: string) {
    const lines = t.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const R = this.rng();
    let w = 0;
    lines.forEach((l) => { w = Math.max(w, l.length); });
    const address = this.addressOf({ r0: R.r0, c0: R.c0, r1: Math.min(MAXR - 1, R.r0 + lines.length - 1), c1: Math.min(MAXC - 1, R.c0 + w - 1) });
    this.gate({ title: 'Paste', message: 'Paste into ' + address + '? This replaces what is there now.', danger: true, confirmLabel: 'Paste' }, () =>
      this.mutate(() => {
        this.ensureSize(R.r0 + lines.length, R.c0 + w);
        this.unmergeArea(R.r0, R.c0, R.r0 + lines.length - 1, R.c0 + w - 1);
        lines.forEach((l, i) => {
          l.forEach((v, j) => {
            const r = R.r0 + i, c = R.c0 + j;
            if (r >= MAXR || c >= MAXC) return;
            v = v.trim();
            if (v[0] === '=') v = v.toUpperCase();
            setCell(this.S, r, c, { v });
          });
        });
        this.sel = { ar: R.r0, ac: R.c0, fr: Math.min(MAXR - 1, R.r0 + lines.length - 1), fc: Math.min(MAXC - 1, R.c0 + w - 1) };
      }),
    );
  }
  // the Paste button: our own copy first, otherwise whatever text is on the system clipboard
  paste() {
    if (this.clip) this.pasteClip();
    else if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(
        (t) => { if (t) this.pasteText(t); else this.flash('Nothing to paste yet.'); },
        () => this.flash('Nothing copied yet. Select a block and choose Copy.'),
      );
    } else this.flash('Nothing copied yet. Select a block and choose Copy.');
  }
  onDocCopy(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (this.editing || (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT'))) return;
    this.doCopy(false);
    if (e.clipboardData && this.clip) { e.clipboardData.setData('text/plain', this.clip.tsv); e.preventDefault(); }
  }
  onDocPaste(e: ClipboardEvent) {
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT')) return;
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    const norm = t.replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (this.clip && (t === '' || norm === this.clip.tsv)) this.pasteClip();
    else if (t) this.pasteText(t);
  }

  /* ---------- formatting & structure ---------- */
  private eachSel(fn: (r: number, c: number) => void) {
    const R = this.rng();
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) fn(r, c);
  }
  clearSel() {
    let any = false;
    this.eachSel((r, c) => { const x = this.S.cells[key(r, c)]; if (x && x.v !== '') any = true; });
    if (!any) return;
    const address = this.addressOf(this.rng());
    this.gate(
      { title: 'Clear ' + address, message: 'Clear the contents of ' + address + '?', danger: true, confirmLabel: 'Clear' },
      () => this.mutate(() => this.eachSel((r, c) => setCell(this.S, r, c, { v: '' }))),
    );
  }
  toggleBold() {
    let all = true;
    this.eachSel((r, c) => { const x = this.S.cells[key(r, c)]; if (!x || !x.b) all = false; });
    const address = this.addressOf(this.rng());
    const message = all ? 'Remove bold from ' + address + '?' : 'Make ' + address + ' bold?';
    this.gate(
      { title: 'Bold', message, confirmLabel: all ? 'Remove' : 'Bold' },
      () => this.mutate(() => this.eachSel((r, c) => setCell(this.S, r, c, { b: all ? 0 : 1 }))),
    );
  }
  setFill(n: number) {
    const o = this.fillOpacity;
    const address = this.addressOf(this.rng());
    const message = n ? 'Fill ' + address + ' with ' + fillName(n) + ' at ' + o + '% opacity?' : 'Remove the fill colour from ' + address + '?';
    this.gate(
      { title: n ? 'Fill colour' : 'Remove fill', message, danger: !n, confirmLabel: n ? 'Fill' : 'Remove' },
      () => this.mutate(() => this.eachSel((r, c) => setCell(this.S, r, c, n ? { f: n, o } : { f: 0 }))),
    );
  }
  // change how see-through the fill is: remembered for the next fill, and applied to filled cells in the selection
  setOpacity(p: number, apply: boolean) {
    p = clamp(Math.round(p), 10, 100);
    this.fillOpacity = p;
    this.saveUiPrefs();
    if (!apply) { this.emit(); return; }
    let any = false;
    this.eachSel((r, c) => { const x = this.S.cells[key(r, c)]; if (x && x.f && (x.o ?? 100) !== p) any = true; });
    if (!any) { this.emit(); return; }
    const address = this.addressOf(this.rng());
    this.gate(
      { title: 'Fill opacity', message: 'Set the fill opacity to ' + p + '% for ' + address + '?', confirmLabel: 'Set' },
      () => this.mutate(() => this.eachSel((r, c) => { const x = this.S.cells[key(r, c)]; if (x && x.f) setCell(this.S, r, c, { o: p }); })),
    );
  }
  // opacity and colour of the active cell, so the picker can show what is selected
  activeFill(): { f: number; o: number } {
    const x = this.S.cells[key(this.sel.ar, this.sel.ac)];
    return { f: x ? x.f : 0, o: x && x.f ? (x.o ?? 100) : this.fillOpacity };
  }
  fillDown() {
    const R = this.rng();
    if (R.r1 === R.r0) return;
    if (this.hasMerge(R)) { this.flash('Unmerge the cells before filling down.'); return; }
    const address = this.addressOf(R);
    this.gate(
      { title: 'Fill down', message: 'Fill down into ' + address + '? The rows below the top one are replaced with copies of it.', danger: true, confirmLabel: 'Fill down' },
      () =>
        this.mutate(() => {
          const S = this.S;
          for (let c = R.c0; c <= R.c1; c++) {
            const src = S.cells[key(R.r0, c)];
            for (let r = R.r0 + 1; r <= R.r1; r++) {
              if (src) {
                let v = src.v;
                if (v[0] === '=') v = xform(v, shiftMap(r - R.r0, 0));
                S.cells[key(r, c)] = cloneCell(src, v);
              } else delete S.cells[key(r, c)];
            }
          }
        }),
    );
  }
  private remap(fn: (r: number, c: number) => [number, number] | null) {
    const nc: Record<string, Cell> = {};
    for (const k in this.S.cells) {
      const p = k.split(',').map(Number), q = fn(p[0], p[1]);
      if (q) nc[key(q[0], q[1])] = this.S.cells[k];
    }
    this.S.cells = nc;
    this.copyRange = null;
  }
  // structural change on the CURRENT tab: fix its own formulas and every other tab's references to it
  private xformAll(map: RefMap) {
    const target = this.curSheet;
    this.W.sheets.forEach((sh) => {
      const cells = sh.data.cells;
      for (const k in cells) {
        const c = cells[k];
        if (c.v[0] !== '=') continue;
        const m: RefMap = (kind, i, role, abs, name) => {
          const t = name ? sheetByName(this.W.sheets, name) : sh;
          return t === target ? map(kind, i, role, abs, name) : i;
        };
        c.v = xform(c.v, m);
      }
    });
  }
  insertRows(at: number, n: number) {
    if (this.S.rows + n > MAXR) { this.flash('The sheet is limited to ' + MAXR + ' rows.'); return; }
    const label = n === 1 ? 'a row above row ' + (at + 1) : n + ' rows above row ' + (at + 1);
    this.gate({ title: 'Insert rows', message: 'Insert ' + label + '?', confirmLabel: 'Insert' }, () =>
      this.mutate(() => {
        this.remap((r, c) => [r >= at ? r + n : r, c]);
        this.S.rows += n;
        this.xformAll(insMap('r', at, n));
        this.adjMerges('r', 'ins', at, n);
      }),
    );
  }
  deleteRows(at: number, n: number) {
    const label = n === 1 ? 'row ' + (at + 1) : 'rows ' + (at + 1) + '-' + (at + n);
    this.gate(
      { title: 'Delete rows', message: 'Delete ' + label + '? Formulas that used ' + (n === 1 ? 'it' : 'them') + ' will show #REF!.', danger: true, confirmLabel: 'Delete' },
      () =>
        this.mutate(() => {
          this.remap((r, c) => (r < at ? [r, c] : r >= at + n ? [r - n, c] : null));
          this.S.rows = Math.max(20, this.S.rows - n);
          this.xformAll(delMap('r', at, n));
          this.adjMerges('r', 'del', at, n);
          this.clampSel();
        }),
    );
  }
  insertCols(at: number, n: number) {
    if (this.S.cols + n > MAXC) { this.flash('The sheet is limited to ' + MAXC + ' columns.'); return; }
    const label = n === 1 ? 'a column before column ' + colName(at) : n + ' columns before column ' + colName(at);
    this.gate({ title: 'Insert columns', message: 'Insert ' + label + '?', confirmLabel: 'Insert' }, () =>
      this.mutate(() => {
        this.remap((r, c) => [r, c >= at ? c + n : c]);
        this.S.cols += n;
        const add: number[] = [];
        for (let i = 0; i < n; i++) add.push(DW);
        this.S.colW.splice(at, 0, ...add);
        this.xformAll(insMap('c', at, n));
        this.adjMerges('c', 'ins', at, n);
      }),
    );
  }
  deleteCols(at: number, n: number) {
    const label = n === 1 ? 'column ' + colName(at) : 'columns ' + colName(at) + '-' + colName(at + n - 1);
    this.gate(
      { title: 'Delete columns', message: 'Delete ' + label + '? Formulas that used ' + (n === 1 ? 'it' : 'them') + ' will show #REF!.', danger: true, confirmLabel: 'Delete' },
      () =>
        this.mutate(() => {
          this.remap((r, c) => (c < at ? [r, c] : c >= at + n ? [r, c - n] : null));
          this.S.cols -= n;
          this.S.colW.splice(at, n);
          while (this.S.cols < 6) { this.S.cols++; this.S.colW.push(DW); }
          this.xformAll(delMap('c', at, n));
          this.adjMerges('c', 'del', at, n);
          this.clampSel();
        }),
    );
  }
  private rowSpan() {
    const R = this.rng(), full = R.r0 === 0 && R.r1 === this.S.rows - 1;
    return { R, n: full ? 1 : R.r1 - R.r0 + 1, full };
  }
  private colSpan() {
    const R = this.rng(), full = R.c0 === 0 && R.c1 === this.S.cols - 1;
    return { R, n: full ? 1 : R.c1 - R.c0 + 1, full };
  }
  rowAbove() { const s = this.rowSpan(); this.insertRows(s.R.r0, s.n); }
  rowBelow() { const s = this.rowSpan(); this.insertRows(s.full ? s.R.r0 + 1 : s.R.r1 + 1, s.n); }
  colLeft() { const s = this.colSpan(); this.insertCols(s.R.c0, s.n); }
  colRight() { const s = this.colSpan(); this.insertCols(s.full ? s.R.c0 + 1 : s.R.c1 + 1, s.n); }
  delRow() { const s = this.rowSpan(); this.deleteRows(s.R.r0, s.full ? 1 : s.n); }
  delCol() { const s = this.colSpan(); this.deleteCols(s.R.c0, s.full ? 1 : s.n); }

  insertTemplate(name: string) {
    const t = TEMPLATES[name];
    if (!t) return;
    this.commitEdit();
    const R = this.rng(), sz = tplSize(t);
    const label = name === 'meter' ? 'Meter reading' : name === 'budget' ? 'Monthly budget' : name;
    this.gate({ title: 'Insert block', message: 'Insert the ' + label + ' block at ' + ref(R.r0, R.c0) + '?', confirmLabel: 'Insert' }, () => {
      this.mutate(() => {
        this.ensureSize(R.r0 + sz.h, R.c0 + sz.w);
        this.unmergeArea(R.r0, R.c0, R.r0 + sz.h - 1, R.c0 + sz.w - 1);
        place(this.S, t, R.r0, R.c0);
        (TEMPLATE_MERGES[name] || []).forEach((m) => {
          this.S.merges.push({ r0: R.r0 + m[0], c0: R.c0 + m[1], r1: R.r0 + m[2], c1: R.c0 + m[3] });
        });
        this.sel = { ar: R.r0, ac: R.c0, fr: R.r0 + sz.h - 1, fc: R.c0 + sz.w - 1 };
      });
      this.flash('Block added. Change the numbers, or copy it and paste it further down.');
    });
  }
  loadExample() {
    this.commitEdit();
    this.gate(
      { title: 'Load example', message: 'Replace "' + this.curSheet.name + '" with the example? Its current data will be replaced (Undo brings it back).', danger: true, confirmLabel: 'Replace' },
      () => {
        this.mutate(() => { this.S = sampleData(); this.sel = { ar: 0, ac: 0, fr: 0, fc: 0 }; this.copyRange = null; });
        this.flash('Example loaded. Try selecting A1:B6, copying it and pasting at A16.');
      },
    );
  }
  clearTab() {
    this.commitEdit();
    this.gate(
      { title: 'Clear tab', message: 'Clear all data on "' + this.curSheet.name + '"? Undo brings it back.', danger: true, confirmLabel: 'Clear' },
      () => {
        this.mutate(() => { this.S = blank(); this.sel = { ar: 0, ac: 0, fr: 0, fc: 0 }; this.copyRange = null; });
        this.flash('Tab cleared. Undo brings it back.');
      },
    );
  }

  /* ---------- tabs ---------- */
  stashSheet() {
    this.curSheet._sel = this.sel;
  }
  loadSheet(i: number) {
    this.W.cur = i;
    const sh = this.W.sheets[i];
    this.sel = sh._sel || { ar: 0, ac: 0, fr: 0, fc: 0 };
    this.copyRange = null;
    this.clampSel();
    this.scrollReset();
    this.refresh();
    this.save();
  }
  switchTo(i: number, keepEdit = false) {
    if (i === this.W.cur) return;
    if (!(keepEdit && this.fxEditing())) this.commitEdit();
    this.stashSheet();
    this.loadSheet(i);
  }
  uniqueName(base: string): string {
    base = base.slice(0, 26);
    if (!sheetByName(this.W.sheets, base)) return base;
    for (let k = 2; ; k++) {
      const n = base + k;
      if (!sheetByName(this.W.sheets, n)) return n;
    }
  }
  addTab() {
    if (this.W.sheets.length >= MAX_TABS) { this.flash('That is the maximum of ' + MAX_TABS + ' tabs.'); return; }
    this.disarm();
    this.commitEdit(); this.pushHist(); this.stashSheet();
    let n = this.W.sheets.length + 1, nm: string;
    for (; ; n++) { nm = 'Tab' + n; if (!sheetByName(this.W.sheets, nm)) break; }
    this.W.sheets.push({ name: nm, data: blank() });
    this.loadSheet(this.W.sheets.length - 1);
    this.flash('New empty tab added. In a formula, use ' + nm + '!A1 to read a cell from it.');
  }
  copyTab() {
    if (this.W.sheets.length >= MAX_TABS) { this.flash('That is the maximum of ' + MAX_TABS + ' tabs.'); return; }
    this.disarm();
    this.commitEdit(); this.pushHist(); this.stashSheet();
    const cur = this.curSheet;
    this.W.sheets.splice(this.W.cur + 1, 0, { name: this.uniqueName(cur.name + '_copy'), data: JSON.parse(JSON.stringify(cur.data)) });
    this.loadSheet(this.W.cur + 1);
    this.flash('Tab copied. Every formula works the same in the copy.');
  }
  disarm() {
    if (!this.delArm) return;
    this.delArm = false;
    clearTimeout(this.delTimer);
    this.emit();
  }
  // first press arms it ("Sure?"), second press within 4 seconds deletes
  deleteTab(): boolean {
    if (this.W.sheets.length < 2) { this.flash('You need at least one tab.'); return true; }
    if (!this.delArm) {
      this.delArm = true;
      this.flash('Press Delete tab again to remove "' + this.curSheet.name + '". Formulas that use it will show #REF!.');
      clearTimeout(this.delTimer);
      this.delTimer = setTimeout(() => this.disarm(), 4000);
      this.emit();
      return false;
    }
    this.disarm();
    if (this.editing) this.cancelEdit();
    this.pushHist();
    const i = this.W.cur, nm = this.W.sheets[i].name.toLowerCase();
    this.rewriteAll((n) => (n.toLowerCase() === nm ? null : undefined));
    this.W.sheets.splice(i, 1);
    this.loadSheet(Math.min(i, this.W.sheets.length - 1));
    this.flash('Tab deleted. Undo brings it back.');
    return true;
  }
  private rewriteAll(fn: (name: string) => string | null | undefined) {
    this.W.sheets.forEach((sh) => {
      const cells = sh.data.cells;
      for (const k in cells) {
        const c = cells[k];
        if (c.v[0] === '=') c.v = rewriteSheet(c.v, fn);
      }
    });
  }
  startRename(i: number) {
    this.disarm();
    this.commitEdit();
    this.renaming = i;
    this.emit();
  }
  finishRename(doSave: boolean, value: string) {
    const i = this.renaming;
    if (i < 0) return;
    this.renaming = -1;
    if (doSave) {
      let v = value.replace(/[!':]/g, '').trim().slice(0, 30);
      const old = this.W.sheets[i].name;
      if (v && v !== old) {
        const clash = this.W.sheets.some((x, j) => j !== i && x.name.toLowerCase() === v.toLowerCase());
        if (clash) { v = this.uniqueName(v); this.flash('That name is already used, so it became "' + v + '".'); }
        this.pushHist();
        this.rewriteAll((n) => (n.toLowerCase() === old.toLowerCase() ? v : undefined));
        this.W.sheets[i].name = v;
        this.save();
        this.refresh();
      }
    }
    this.emit();
    this.focusGrid();
  }

  /* ---------- backup files & PDF ---------- */
  saveBackup() {
    this.commitEdit();
    const ok = downloadFile(backupText(this.W), 'household-ledger-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    this.flash(ok ? 'Backup saved to your Downloads. Use Open backup any time to load it again.' : 'Saving files is not available here.');
  }
  openBackupText(text: string) {
    const wb = workbookFromBackup(text);
    if (!wb) { this.flash('That file is not a Household ledger backup.'); return; }
    this.commitEdit();
    const n = wb.sheets.length;
    this.gate(
      { title: 'Open backup', message: 'Replace everything with this backup (' + n + ' tab' + (n > 1 ? 's' : '') + ')? Undo brings back what you had before.', danger: true, confirmLabel: 'Open' },
      () => {
        this.pushHist();
        this.restoreSnap(JSON.stringify(wb));
        this.flash('Backup opened (' + n + ' tab' + (n > 1 ? 's' : '') + '). Undo brings back what you had before.');
      },
    );
  }
  readBackupFile(f: File | undefined | null) {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { this.flash('That file is too large to be a backup.'); return; }
    const fr = new FileReader();
    fr.onload = () => this.openBackupText(String(fr.result || ''));
    fr.onerror = () => this.flash('That file could not be read.');
    fr.readAsText(f);
  }
  async exportPdf(all: boolean) {
    if (this.pdfBusy) return;
    this.commitEdit();
    const list = all ? this.W.sheets : [this.curSheet];
    this.pdfBusy = true;
    this.flash('Preparing your PDF…');
    try {
      const res = await buildPdf(this.W.sheets, list);
      if (!res) { this.flash('That would be more than 300 pages. Try exporting one tab at a time.'); return; }
      const label = all ? 'all-tabs' : this.curSheet.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tab';
      const ok = downloadFile(res.blob, 'household-ledger-' + label + '-' + new Date().toISOString().slice(0, 10) + '.pdf', 'application/pdf');
      this.flash(ok ? 'PDF saved (' + res.pages + ' page' + (res.pages > 1 ? 's' : '') + ') to your Downloads.' : 'Saving files is not available here.');
    } catch {
      this.flash('The PDF could not be created on this device.');
    } finally {
      this.pdfBusy = false;
    }
  }

  /* ---------- helpers used by the ui ---------- */
  colLabel(c: number) {
    return colName(c);
  }
  fmtNum(n: number) {
    return fmt(n);
  }
  get maxFill() {
    return FILL_COUNT;
  }
}
