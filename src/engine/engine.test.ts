import { describe, expect, it } from 'vitest';
import { Store } from './store';
import { Evaluator } from './formula';
import { blank, cleanData, setCell, workbookFromBackup, backupText, sampleWorkbook } from './model';
import { shiftMap, xform, colName, colIdx } from './refs';
import type { Workbook } from './types';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
// these tests check the underlying mutation engine, not the confirmation layer, so confirmMode starts off
const fresh = () => { const s = new Store(mem(), false); s.confirmMode = false; return s; };
const val = (s: Store, r: number, c: number, si = s.W.cur) => s.ev.display(si, r, c).t;
const put = (s: Store, r: number, c: number, v: string) => setCell(s.S, r, c, { v });
function wb(...rows: string[][]): Workbook {
  const D = blank();
  rows.forEach((row, r) => row.forEach((v, c) => v && setCell(D, r, c, { v })));
  return { cur: 0, sheets: [{ name: 'Tab1', data: D }] };
}
const calc = (rows: string[][], r: number, c: number) => new Evaluator(wb(...rows).sheets).display(0, r, c).t;

describe('references', () => {
  it('column names round trip', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colIdx('AB')).toBe(27);
  });
  it('relative refs shift, absolute refs stay', () => {
    expect(xform('=B3-B2', shiftMap(7, 0))).toBe('=B10-B9');
    expect(xform('=$B$3*B4', shiftMap(2, 1))).toBe('=$B$3*C6');
    expect(xform('=SUM(B2:B5)', shiftMap(10, 0))).toBe('=SUM(B12:B15)');
    expect(xform('=Tab1!B6+A1', shiftMap(1, 1))).toBe('=Tab1!C7+B2');
  });
  it('shifting off the sheet gives #REF!', () => {
    expect(xform('=A1', shiftMap(-1, 0))).toBe('=#REF!');
  });
});

describe('formulas', () => {
  it('arithmetic, precedence, unary minus, brackets', () => {
    expect(calc([['=1+2*3']], 0, 0)).toBe('7');
    expect(calc([['=(1+2)*3']], 0, 0)).toBe('9');
    expect(calc([['=-4+10']], 0, 0)).toBe('6');
    expect(calc([['=10/4']], 0, 0)).toBe('2.5');
  });
  it('SUM AVG AVERAGE MIN MAX over ranges', () => {
    const t = [['1'], ['2'], ['3'], ['=SUM(A1:A3)'], ['=AVG(A1:A3)'], ['=MIN(A1:A3)'], ['=MAX(A1:A3)'], ['=AVERAGE(A1:A3, 6)']];
    expect(calc(t, 3, 0)).toBe('6');
    expect(calc(t, 4, 0)).toBe('2');
    expect(calc(t, 5, 0)).toBe('1');
    expect(calc(t, 6, 0)).toBe('3');
    expect(calc(t, 7, 0)).toBe('3');
  });
  it('text in a range is skipped, empty cells count as 0 in arithmetic', () => {
    expect(calc([['5'], ['hello'], ['7'], ['=SUM(A1:A3)'], ['=A5+1']], 3, 0)).toBe('12');
    expect(calc([['=B1+1']], 0, 0)).toBe('1');
  });
  it('error codes', () => {
    expect(calc([['=1/0']], 0, 0)).toBe('#DIV/0!');
    expect(calc([['=FOO(1)']], 0, 0)).toBe('#NAME?');
    expect(calc([['=A1']], 0, 0)).toBe('#CIRC!');
    expect(calc([['abc', '=A1+1']], 0, 1)).toBe('#VALUE!');
    expect(calc([['=Nope!A1']], 0, 0)).toBe('#REF!');
    expect(calc([['=AVG(B1:B3)']], 0, 0)).toBe('#DIV/0!');
    expect(calc([['=1+']], 0, 0)).toBe('#ERR!');
    expect(calc([['=A2:A3']], 0, 0)).toBe('#VALUE!');
  });
  it('numbers accept commas and currency signs', () => {
    expect(calc([['$1,200', '=A1+1']], 0, 1)).toBe('1,201');
  });
});

describe('the built in example', () => {
  it('matches the original values', () => {
    const s = fresh();
    s.W = sampleWorkbook();
    expect(val(s, 5, 1, 0)).toBe('22.5'); // electricity 150 x 0.15
    expect(val(s, 12, 1, 0)).toBe('76.8'); // water 32 x 2.4
    expect(val(s, 14, 1, 0)).toBe('99.3');
    expect(val(s, 3, 1, 1)).toBe('99.3'); // Tab2 reads Tab1
    expect(s.W.sheets[0].data.cells['10,1'].v).toBe('=B10-B9'); // the pasted water block shifted its formulas
  });
});

describe('structure changes keep formulas correct', () => {
  it('insert row above moves references, also from other tabs', () => {
    const s = fresh();
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.rowAbove();
    expect(s.S.cells['6,1'].v).toBe('=B5*B6'); // amount due moved from row 6 to 7
    expect(s.W.sheets[1].data.cells['1,1'].v).toBe('=Tab1!B7');
    expect(val(s, 14 + 1, 1, 0)).toBe('99.3');
    expect(val(s, 3, 1, 1)).toBe('99.3');
  });
  it('deleting a referenced row gives #REF!', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    put(s, 0, 0, '5'); put(s, 1, 0, '7'); put(s, 2, 0, '=A1+A2');
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.delRow();
    expect(s.S.cells['1,0'].v).toBe('=A1+#REF!');
    expect(val(s, 1, 0)).toBe('#REF!');
  });
  it('deleting a row inside a range shrinks the range', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    [1, 2, 3, 4].forEach((n, i) => put(s, i, 0, String(n)));
    put(s, 5, 0, '=SUM(A1:A4)');
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.delRow();
    expect(s.S.cells['4,0'].v).toBe('=SUM(A1:A3)');
    expect(val(s, 4, 0)).toBe('8');
  });
  it('insert / delete column', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    put(s, 0, 1, '2'); put(s, 0, 2, '=B1*3');
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.colLeft();
    expect(s.S.cells['0,3'].v).toBe('=C1*3');
    expect(val(s, 0, 3)).toBe('6');
    expect(s.S.cols).toBe(9);
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.delCol();
    expect(s.S.cells['0,2'].v).toBe('=B1*3');
  });
});

describe('copy and paste', () => {
  it('pastes a block with its formulas shifted (the built in example: A1:B6 -> A16)', () => {
    const s = fresh();
    s.sel = { ar: 0, ac: 0, fr: 5, fc: 1 };
    s.doCopy(false);
    s.sel = { ar: 15, ac: 0, fr: 15, fc: 0 };
    s.pasteClip();
    expect(s.S.cells['18,1'].v).toBe('=B18-B17');
    expect(val(s, 20, 1)).toBe('22.5');
    expect(s.S.merges.some((m) => m.r0 === 15 && m.c1 === 1)).toBe(true);
  });
  it('repeats the block when the target selection is a multiple of its size', () => {
    const s = fresh();
    put(s, 20, 0, '1'); put(s, 21, 0, '=A21+1');
    s.sel = { ar: 20, ac: 0, fr: 21, fc: 0 };
    s.doCopy(false);
    s.sel = { ar: 22, ac: 0, fr: 25, fc: 0 };
    s.pasteClip();
    expect(val(s, 23, 0)).toBe('2');
    expect(s.S.cells['25,0'].v).toBe('=A25+1');
  });
  it('fill down copies formulas with shifted references', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    put(s, 0, 0, '1'); put(s, 0, 1, '=A1*2');
    s.sel = { ar: 0, ac: 1, fr: 3, fc: 1 };
    s.fillDown();
    expect(s.S.cells['3,1'].v).toBe('=A4*2');
  });
  it('pastes plain text tables', () => {
    const s = fresh();
    s.sel = { ar: 30, ac: 0, fr: 30, fc: 0 };
    s.pasteText('a\t1\nb\t=a1');
    expect(s.S.cells['31,1'].v).toBe('=A1');
    expect(val(s, 30, 1)).toBe('1');
  });
});

describe('fill colour and opacity', () => {
  it('applies colour with the chosen opacity and keeps it through copy / paste / backup', () => {
    const s = fresh();
    s.setOpacity(40, false);
    s.sel = { ar: 20, ac: 0, fr: 21, fc: 1 };
    s.setFill(3);
    expect(s.S.cells['20,0']).toEqual({ v: '', b: 0, f: 3, o: 40 });
    s.doCopy(false);
    s.sel = { ar: 25, ac: 2, fr: 25, fc: 2 };
    s.pasteClip();
    expect(s.S.cells['25,2'].o).toBe(40);
    const back = workbookFromBackup(backupText(s.W))!;
    expect(back.sheets[0].data.cells['20,0'].o).toBe(40);
  });
  it('changing opacity updates the filled cells only, one undo step', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 1 };
    s.setFill(2);
    put(s, 20, 1, 'x'); setCell(s.S, 20, 1, { f: 0 }); // second cell has no colour
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 1 };
    const before = s.hist.length;
    s.setOpacity(55, true);
    expect(s.S.cells['20,0'].o).toBe(55);
    expect(s.S.cells['20,1'].o).toBeUndefined();
    expect(s.hist.length).toBe(before + 1);
    s.undo();
    expect(s.S.cells['20,0'].o).toBeUndefined();
  });
  it('100% opacity and no fill store no opacity, old backups still load', () => {
    const D = blank();
    setCell(D, 0, 0, { v: 'a', f: 2, o: 100 });
    setCell(D, 1, 0, { v: 'b', f: 0, o: 30 });
    expect(D.cells['0,0'].o).toBeUndefined();
    expect(D.cells['1,0'].o).toBeUndefined();
    const old = cleanData({ rows: 10, cols: 4, colW: [], cells: { '0,0': { v: 'x', b: 1, f: 4 } }, merges: [] })!;
    expect(old.cells['0,0']).toEqual({ v: 'x', b: 1, f: 4 });
    const bad = cleanData({ cells: { '0,0': { v: 'x', b: 0, f: 3, o: 3 }, '0,1': { v: 'y', b: 0, f: 99 } } })!;
    expect(bad.cells['0,0'].o).toBeUndefined();
    expect(bad.cells['0,1'].f).toBe(0);
  });
});

describe('merge cells', () => {
  it('merges keep only the top-left value and can be undone', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    put(s, 0, 0, 'a'); put(s, 0, 1, 'b'); put(s, 1, 0, 'c');
    s.sel = { ar: 0, ac: 0, fr: 1, fc: 1 };
    s.mergeSel();
    expect(s.S.merges).toEqual([{ r0: 0, c0: 0, r1: 1, c1: 1 }]);
    expect(s.S.cells['0,1']).toBeUndefined();
    expect(s.cover.get('1,1')).toBeTruthy();
    s.undo();
    expect(s.S.cells['0,1'].v).toBe('b');
    s.redo();
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.unmergeSel();
    expect(s.S.merges.length).toBe(0);
  });
  it('refuses to merge a single cell or a whole row', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    s.mergeSel();
    expect(s.msg).toMatch(/two or more/);
  });
});

describe('tabs', () => {
  it('rename rewrites formulas in other tabs', () => {
    const s = fresh();
    s.startRename(0);
    s.finishRename(true, 'Bills');
    expect(s.W.sheets[0].name).toBe('Bills');
    expect(s.W.sheets[1].data.cells['1,1'].v).toBe('=Bills!B6');
    expect(val(s, 3, 1, 1)).toBe('99.3');
    s.startRename(0);
    s.finishRename(true, 'My Bills');
    expect(s.W.sheets[1].data.cells['1,1'].v).toBe("='My Bills'!B6");
    expect(val(s, 3, 1, 1)).toBe('99.3');
  });
  it('rename clash gets a unique name', () => {
    const s = fresh();
    s.startRename(0);
    s.finishRename(true, 'tab2');
    expect(s.W.sheets[0].name).toBe('tab22');
  });
  it('delete needs two presses, breaks references, and can be undone', () => {
    const s = fresh();
    expect(s.deleteTab()).toBe(false);
    expect(s.W.sheets.length).toBe(2);
    expect(s.deleteTab()).toBe(true);
    expect(s.W.sheets.length).toBe(1);
    expect(s.W.sheets[0].name).toBe('Tab2');
    expect(s.W.sheets[0].data.cells['1,1'].v).toBe('=#REF!');
    expect(val(s, 1, 1)).toBe('#REF!');
    s.undo();
    expect(s.W.sheets.length).toBe(2);
    expect(s.W.sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6');
  });
  it('cannot delete the last tab', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
    s.deleteTab();
    expect(s.W.sheets.length).toBe(1);
    expect(s.msg).toMatch(/at least one/);
  });
  it('new tab and copy tab', () => {
    const s = fresh();
    s.addTab();
    expect(s.W.sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2', 'Tab3']);
    expect(s.W.cur).toBe(2);
    s.switchTo(0);
    s.copyTab();
    expect(s.W.sheets[1].name).toBe('Tab1_copy');
    expect(val(s, 14, 1)).toBe('99.3');
    expect(s.W.cur).toBe(1);
  });
});

describe('editing', () => {
  it('commits typed text, upper-cases formulas and fixes tab-name case', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    s.startEdit('=sum(b2:b3)+tab1!b6');
    s.commitEdit();
    expect(s.S.cells['20,0'].v).toBe('=SUM(B2:B3)+Tab1!B6');
  });
  it('undo / redo restore cells', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    s.startEdit('hello');
    s.commitEdit();
    expect(s.S.cells['20,0'].v).toBe('hello');
    s.undo();
    expect(s.S.cells['20,0']).toBeUndefined();
    s.redo();
    expect(s.S.cells['20,0'].v).toBe('hello');
  });
  it('persists to storage and loads back', () => {
    const st = mem();
    const a = new Store(st);
    a.confirmMode = false;
    a.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    a.startEdit('saved');
    a.commitEdit();
    const b = new Store(st);
    expect(b.S.cells['20,0'].v).toBe('saved');
  });
});

describe('backup files', () => {
  it('round trips all tabs', () => {
    const s = fresh();
    const back = workbookFromBackup(backupText(s.W))!;
    expect(back.sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
    expect(back.sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6');
    expect(back.sheets[0].data.merges.length).toBe(2);
  });
  it('rejects things that are not backups', () => {
    expect(workbookFromBackup('nope')).toBeNull();
    expect(workbookFromBackup('{"a":1}')).toBeNull();
  });
  it('insert block places a formula block at the selection', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    s.insertTemplate('budget');
    expect(s.S.cells['25,1'].v).toBe('=SUM(B22:B25)');
    expect(val(s, 25, 1)).toBe('1,750');
  });
});
