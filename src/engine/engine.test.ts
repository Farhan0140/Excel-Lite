import { describe, expect, it } from 'vitest';
import { Store } from './store';
import { Evaluator } from './formula';
import { blank, cleanData, cleanWorkbook, loadWorkbook, setCell, workbookFromBackup, backupText, sampleWorkbook } from './model';
import { shiftMap, xform, colName, colIdx, expandFetcher } from './refs';
import type { SheetData, Workbook } from './types';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
// these tests check the underlying mutation engine, not the confirmation layer, so confirmMode starts off
const fresh = () => { const s = new Store(mem(), false); s.confirmMode = false; return s; };
const val = (s: Store, r: number, c: number, si = s.flat) => s.ev.display(si, r, c).t;
const put = (s: Store, r: number, c: number, v: string) => setCell(s.S, r, c, { v });
function one(page0: SheetData = blank()): Workbook {
  return { curPage: 0, pages: [{ cur: 0, sheets: [{ name: 'Tab1', data: page0 }] }] };
}
function wb(...rows: string[][]): Workbook {
  const D = blank();
  rows.forEach((row, r) => row.forEach((v, c) => v && setCell(D, r, c, { v })));
  return one(D);
}
const calc = (rows: string[][], r: number, c: number) => new Evaluator(wb(...rows).pages).display(0, r, c).t;
const typeInto = (s: Store, r: number, c: number, v: string) => { s.sel = { ar: r, ac: c, fr: r, fc: c }; s.startEdit(v); s.commitEdit(); };

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
    expect(s.W.pages[0].sheets[0].data.cells['10,1'].v).toBe('=B10-B9'); // the pasted water block shifted its formulas
  });
});

describe('structure changes keep formulas correct', () => {
  it('insert row above moves references, also from other tabs', () => {
    const s = fresh();
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.rowAbove();
    expect(s.S.cells['6,1'].v).toBe('=B5*B6'); // amount due moved from row 6 to 7
    expect(s.W.pages[0].sheets[1].data.cells['1,1'].v).toBe('=Tab1!B7');
    expect(val(s, 14 + 1, 1, 0)).toBe('99.3');
    expect(val(s, 3, 1, 1)).toBe('99.3');
  });
  it('deleting a referenced row gives #REF!', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = one();
    put(s, 0, 0, '5'); put(s, 1, 0, '7'); put(s, 2, 0, '=A1+A2');
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.delRow();
    expect(s.S.cells['1,0'].v).toBe('=A1+#REF!');
    expect(val(s, 1, 0)).toBe('#REF!');
  });
  it('deleting a row inside a range shrinks the range', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = one();
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
    s.W = one();
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
    s.W = one();
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
    expect(back.pages[0].sheets[0].data.cells['20,0'].o).toBe(40);
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
    s.W = one();
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
    expect(s.W.pages[0].sheets[0].name).toBe('Bills');
    expect(s.W.pages[0].sheets[1].data.cells['1,1'].v).toBe('=Bills!B6');
    expect(val(s, 3, 1, 1)).toBe('99.3');
    s.startRename(0);
    s.finishRename(true, 'My Bills');
    expect(s.W.pages[0].sheets[1].data.cells['1,1'].v).toBe("='My Bills'!B6");
    expect(val(s, 3, 1, 1)).toBe('99.3');
  });
  it('rename clash gets a unique name', () => {
    const s = fresh();
    s.startRename(0);
    s.finishRename(true, 'tab2');
    expect(s.W.pages[0].sheets[0].name).toBe('tab22');
  });
  it('delete needs two presses, breaks references, and can be undone', () => {
    const s = fresh();
    expect(s.deleteTab()).toBe(false);
    expect(s.W.pages[0].sheets.length).toBe(2);
    expect(s.deleteTab()).toBe(true);
    expect(s.W.pages[0].sheets.length).toBe(1);
    expect(s.W.pages[0].sheets[0].name).toBe('Tab2');
    expect(s.W.pages[0].sheets[0].data.cells['1,1'].v).toBe('=#REF!');
    expect(val(s, 1, 1)).toBe('#REF!');
    s.undo();
    expect(s.W.pages[0].sheets.length).toBe(2);
    expect(s.W.pages[0].sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6');
  });
  it('cannot delete the last tab', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = one();
    s.deleteTab();
    expect(s.W.pages[0].sheets.length).toBe(1);
    expect(s.msg).toMatch(/at least one/);
  });
  it('new tab and copy tab', () => {
    const s = fresh();
    s.addTab();
    expect(s.W.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2', 'Tab3']);
    expect(s.cur).toBe(2);
    s.switchTo(0);
    s.copyTab();
    expect(s.W.pages[0].sheets[1].name).toBe('Tab1_copy');
    expect(val(s, 14, 1)).toBe('99.3');
    expect(s.cur).toBe(1);
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
    expect(back.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
    expect(back.pages[0].sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6');
    expect(back.pages[0].sheets[0].data.merges.length).toBe(2);
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

describe('the row_sum / col_sum fetcher shortcut', () => {
  it('expands to a real SUM formula over everything before the cell', () => {
    expect(expandFetcher('row_sum', 3, 20)).toBe('=SUM(A4:T4)'); // U4 -> everything left of column U on row 4
    expect(expandFetcher('col_sum', 3, 20)).toBe('=SUM(U1:U3)'); // U4 -> everything above row 4 in column U
  });
  it('accepts the bare word, with or without =, with or without (), any case, and trims spaces', () => {
    for (const t of ['row_sum', '=row_sum', 'ROW_SUM', 'RowSum', 'rowsum', 'ROWSUM()', '  =ROW_SUM(  )  ']) {
      expect(expandFetcher(t, 3, 20)).toBe('=SUM(A4:T4)');
    }
  });
  it('at the very edge of the sheet (nothing before it) becomes an empty, valid SUM', () => {
    expect(expandFetcher('row_sum', 5, 0)).toBe('=SUM()'); // column A: nothing to its left
    expect(expandFetcher('col_sum', 0, 5)).toBe('=SUM()'); // row 1: nothing above it
  });
  it('is not confused with ordinary text or formulas', () => {
    expect(expandFetcher('rows summary', 0, 0)).toBeNull();
    expect(expandFetcher('=SUM(A1:A3)', 0, 0)).toBeNull();
    expect(expandFetcher('row_sum_report', 0, 0)).toBeNull();
    expect(expandFetcher('', 0, 0)).toBeNull();
  });

  it('typing it into a cell writes the SUM formula and calculates immediately', () => {
    const s = fresh();
    put(s, 3, 0, '2'); put(s, 3, 1, '3'); put(s, 3, 2, 'text'); put(s, 3, 3, '5'); // A4=2 B4=3 C4=text D4=5
    typeInto(s, 3, 4, 'row_sum'); // E4
    expect(s.S.cells['3,4'].v).toBe('=SUM(A4:D4)');
    expect(val(s, 3, 4)).toBe('10'); // text is skipped, just like a normal SUM range
  });
  it('col_sum works the same way, downward through a column', () => {
    const s = fresh();
    put(s, 0, 2, '4'); put(s, 1, 2, '6');
    typeInto(s, 2, 2, 'COL_SUM'); // C3
    expect(s.S.cells['2,2'].v).toBe('=SUM(C1:C2)');
    expect(val(s, 2, 2)).toBe('10');
  });
  it('is case-insensitive and ignores stray spaces when typed by hand', () => {
    const s = fresh();
    put(s, 0, 0, '7');
    typeInto(s, 1, 0, '  Row_Sum  ');
    expect(s.S.cells['1,0'].v).toBe('=SUM()'); // column A: nothing to the left, still a valid formula
    typeInto(s, 5, 0, 'col_sum');
    expect(val(s, 5, 0)).toBe('7'); // sums A1:A5, which only has the 7
  });
  it('behaves like a real formula afterward: shifts when rows/columns are inserted, updates on edits', () => {
    const s = new Store(mem());
    s.confirmMode = false;
    s.W = one(); // a genuinely empty sheet, no pre-existing merges
    put(s, 0, 0, '1'); put(s, 0, 1, '2');
    typeInto(s, 0, 2, 'row_sum'); // C1 = SUM(A1:B1) = 3
    expect(val(s, 0, 2)).toBe('3');
    s.sel = { ar: 0, ac: 1, fr: 0, fc: 1 };
    s.colLeft(); // insert a column between A and (old) B
    expect(s.S.cells['0,3'].v).toBe('=SUM(A1:C1)'); // the range grew to include the new column
    put(s, 0, 0, '10');
    expect(val(s, 0, 3)).toBe('12'); // 10 + 0(new col) + 2
  });
  it('respects confirm mode exactly like any other cell edit', () => {
    const s = new Store(mem(), false); // confirmMode stays on (the default)
    put(s, 0, 0, '4'); put(s, 0, 1, '6');
    typeInto(s, 0, 2, 'row_sum');
    expect(s.pending).toBeTruthy();
    expect(s.pending!.message).toBe('Set C1 to "=SUM(A1:B1)"?');
    expect(s.S.cells['0,2']).toBeUndefined();
    s.confirmPending();
    expect(val(s, 0, 2)).toBe('10');
  });
});

describe('pages', () => {
  it('the example is one page holding two tabs', () => {
    const s = fresh();
    expect(s.W.pages.length).toBe(1);
    expect(s.W.curPage).toBe(0);
    expect(s.W.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
    expect(s.cur).toBe(0);
  });
  it('addPage adds a blank page starting from its own Tab1 and switches to it; undo removes it', () => {
    const s = fresh();
    s.addPage();
    expect(s.W.pages.length).toBe(2);
    expect(s.W.curPage).toBe(1);
    expect(s.W.pages[1].sheets[0].name).toBe('Tab1'); // every page is its own little workbook
    expect(s.cur).toBe(0);
    expect(s.S.cells['0,0']).toBeUndefined();
    expect(val(s, 14, 1, 0)).toBe('99.3'); // page 1's example is intact while we are on page 2
    s.undo();
    expect(s.W.pages.length).toBe(1);
    expect(s.W.curPage).toBe(0);
  });
  it('gotoPage keeps every page\'s data, and reopens a page on the tab last used there', () => {
    const s = fresh();
    s.addPage(); // page 2, tab Tab1
    typeInto(s, 0, 0, 'page2 data');
    s.addTab(); // page 2, tab Tab2
    typeInto(s, 1, 0, 'on the second tab');
    s.gotoPage(0);
    expect(s.W.pages[0].sheets[0].name).toBe('Tab1'); // arrives on the tab this page kept
    expect(s.S.cells['35,0']).toBeUndefined(); // page 1 Tab1 is untouched (rows past the example are empty)
    s.gotoPage(1);
    expect(s.cur).toBe(1); // page 2 reopens on its second tab
    expect(s.S.cells['1,0'].v).toBe('on the second tab');
    s.gotoPage(1); // no-op on the current page
    expect(s.W.curPage).toBe(1);
  });
  it('duplicatePage makes an exact twin: same tab names, formulas resolve inside the copy', () => {
    const s = fresh();
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 1 };
    s.setOpacity(40, false);
    s.setFill(3); // colour the header block so we can see formatting come along
    s.switchTo(1); // Tab2
    put(s, 5, 5, '=Tab1!B6'); // Tab2!F6 reads Tab1!B6 (22.5) — a refs-inside-the-page formula
    s.duplicatePage();
    expect(s.W.pages.length).toBe(2);
    expect(s.W.curPage).toBe(1);
    expect(s.pageName()).toBe('Page 2'); // an unnamed page stays position-numbered; a renamed name would carry over
    expect(s.W.pages[1].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']); // nothing renamed
    expect(s.W.pages[1].sheets[1].data.cells['5,5'].v).toBe('=Tab1!B6'); // formula text untouched…
    expect(val(s, 5, 5)).toBe('22.5'); // …but it reads the COPY's own Tab1
    expect(s.W.pages[1].sheets[0].data.merges.length).toBe(2);
    expect(s.W.pages[1].sheets[0].data.cells['0,0'].f).toBe(3);
    expect(s.W.pages[1].sheets[0].data.cells['0,0'].o).toBe(40);
    // independence: change the clone's inputs; the original page shows none of it
    s.switchTo(0); // the COPY's Tab1 (same name, own page)
    put(s, 2, 1, '999'); // current reading on the COPY
    expect(val(s, 5, 1)).toBe('-30.15'); // (999-1200)*0.15, recalculated inside the copy only
    s.gotoPage(0);
    s.switchTo(0); // original Tab1
    expect(val(s, 5, 1)).toBe('22.5');
    typeInto(s, 2, 1, '500'); // change the ORIGINAL the way a user would (also refreshes the evaluator)
    expect(val(s, 5, 1)).toBe('-105'); // (500-1200)*0.15
    s.gotoPage(1);
    s.switchTo(0);
    expect(val(s, 5, 1)).toBe('-30.15'); // the copy did not move
  });
  it('structure changes on the original leave the twin alone, and follow across pages by resolution', () => {
    const s = fresh();
    s.duplicatePage();
    s.gotoPage(0);
    s.switchTo(0);
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.rowAbove(); // insert a row above row 2 on the ORIGINAL Tab1
    expect(s.W.pages[0].sheets[0].data.cells['4,1'].v).toBe('=B4-B3'); // original's formulas shifted
    expect(s.W.pages[0].sheets[1].data.cells['1,1'].v).toBe('=Tab1!B7'); // original's cross-tab refs follow
    expect(s.W.pages[1].sheets[0].data.cells['3,1'].v).toBe('=B3-B2'); // the twin was not touched
    expect(s.W.pages[1].sheets[1].data.cells['1,1'].v).toBe('=Tab1!B6'); // its same-named refs resolve at home
  });
  it('duplicating repeatedly keeps every copy identical, tabs and page name included', () => {
    const s = fresh();
    s.switchTo(1);
    s.duplicatePage();
    s.duplicatePage(); // copies of the copy — still exact twins
    expect(s.W.pages.length).toBe(3);
    expect(s.pageName()).toBe('Page 3'); // unnamed pages stay position-numbered
    for (const p of s.W.pages) expect(p.sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
  });
  it('a page cannot lose its last tab', () => {
    const s = fresh();
    s.addPage();
    s.deleteTab();
    expect(s.W.pages[1].sheets.length).toBe(1);
    expect(s.msg).toMatch(/at least one/);
  });
  it('tab names only need to be unique within their page', () => {
    const s = fresh();
    s.addPage(); // page 2 starts from its own Tab1
    s.addTab(); // page 2's next free name is Tab2, even though page 1 also has a Tab2
    expect(s.W.pages[1].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
    s.gotoPage(0);
    s.addTab(); // page 1's next free name is Tab3
    expect(s.W.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2', 'Tab3']);
  });
  it('a same-named tab on the page shadows the global one, and renames follow resolution', () => {
    const s = fresh();
    s.addPage(); // page 2 with its own Tab1
    typeInto(s, 0, 0, '=Tab1!B6');
    expect(val(s, 0, 0)).toBe('0'); // resolves to page 2's own (empty) Tab1, not page 1's example
    s.startRename(0);
    s.finishRename(true, 'Solo'); // move page 2's tab out of the way
    typeInto(s, 0, 0, '=Tab1!B6'); // no local Tab1 any more…
    expect(val(s, 0, 0)).toBe('22.5'); // …so it falls back to page 1's
    s.gotoPage(0);
    s.startRename(0);
    s.finishRename(true, 'Bills'); // rename page-1's Tab1
    s.gotoPage(1);
    expect(s.S.cells['0,0'].v).toBe('=Bills!B6'); // the fallback reference follows the rename
    expect(val(s, 0, 0)).toBe('22.5');
    s.gotoPage(0);
    s.switchTo(1); // page 1's Tab2, same page as the rename
    expect(s.S.cells['1,1'].v).toBe('=Bills!B6'); // its reference was rewritten too
  });
  it('undo and redo restore the page you were on', () => {
    const s = fresh();
    s.addPage();
    s.undo();
    expect(s.W.pages.length).toBe(1);
    expect(s.W.curPage).toBe(0);
    s.redo();
    expect(s.W.pages.length).toBe(2);
    expect(s.W.curPage).toBe(1);
    expect(s.S).toBeTruthy();
  });
  it('caps the number of pages', () => {
    const s = fresh();
    s.W = { curPage: 0, pages: Array.from({ length: 40 }, (_, i) => ({ cur: 0, sheets: [{ name: 'T' + i, data: blank() }] })) };
    s.addPage();
    expect(s.W.pages.length).toBe(40);
    expect(s.msg).toMatch(/maximum of 40 pages/);
  });
  it('cleanWorkbook accepts the old single-page shape and migrations keep the data', () => {
    const legacy = cleanWorkbook({ cur: 1, sheets: [{ name: 'Tab1', data: blank() }, { name: 'Tab2', data: blank() }] })!;
    expect(legacy.curPage).toBe(0);
    expect(legacy.pages.length).toBe(1);
    expect(legacy.pages[0].cur).toBe(1);
    expect(legacy.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
    const bare = cleanWorkbook({ rows: 20, cols: 6, cells: {}, colW: [], merges: [] })!;
    expect(bare.pages[0].sheets[0].name).toBe('Tab1');
  });
  it('cleanWorkbook normalises the pages shape: caps, clamps, per-page unique tab names', () => {
    const made = cleanWorkbook({
      curPage: 9,
      pages: [
        { cur: 5, sheets: [{ name: 'Tab1', data: blank() }, { name: 'tab1', data: blank() }] }, // clash WITHIN a page -> renamed
        { sheets: [{ name: 'Tab1', data: blank() }] }, // the same name on another page is fine now
      ],
    })!;
    expect(made.curPage).toBe(1); // clamped into range
    expect(made.pages[0].cur).toBe(1); // cur=5 clamps to the highest tab index of that page
    expect(made.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'tab12']); // case is preserved, only the clash gets a number
    expect(made.pages[1].sheets[0].name).toBe('Tab1'); // kept as-is: pages are separate namespaces
  });
  it('loadWorkbook migrates the pre-pages v2 local copy to one page', () => {
    const st = mem();
    st.setItem('household-ledger-v2', JSON.stringify({ cur: 0, sheets: [{ name: 'Tab1', data: blank() }] }));
    const w = loadWorkbook(st);
    expect(w.pages.length).toBe(1);
    expect(w.pages[0].sheets.length).toBe(1);
    expect(w.pages[0].sheets[0].data.rows).toBe(40);
  });
  it('storage round trip keeps pages, per-page tab and the page in view', () => {
    const st = mem();
    const a = fresh();
    a.storage = st;
    a.addPage(); // page 2
    a.addTab(); // page 2 gets a second tab and lands on it
    a.save(true);
    const b = new Store(st, false);
    expect(b.W.pages.length).toBe(2);
    expect(b.W.curPage).toBe(1); // reopens on the page that was in view
    expect(b.cur).toBe(1); // ...and on that page's remembered tab
    expect(b.curSheet.name).toBe('Tab2');
  });
  it('pages can be renamed; the name survives undo, redo, backups and reload', () => {
    const s = fresh();
    s.startPageRename();
    s.finishPageRename(true, 'Bills');
    expect(s.pageName()).toBe('Bills');
    s.undo();
    expect(s.pageName()).toBe('Page 1');
    s.redo();
    expect(s.pageName()).toBe('Bills');
    const back = workbookFromBackup(backupText(s.W))!;
    expect(back.pages[0].name).toBe('Bills');
    const st = mem();
    s.storage = st;
    s.save(true);
    expect(new Store(st, false).pageName()).toBe('Bills');
    expect(s.renamingPage).toBe(false);
    s.startPageRename();
    expect(s.renamingPage).toBe(true);
    s.finishPageRename(false, 'ignored');
    expect(s.pageName()).toBe('Bills'); // cancel keeps what there was
  });
  it('a rename that clashes with another page gets a unique name; empty keeps the old one', () => {
    const s = fresh();
    s.addPage(); // display name "Page 2"
    s.gotoPage(0);
    s.startPageRename();
    s.finishPageRename(true, 'Page 2'); // clashes with page 2
    expect(s.pageName()).toBe('Page 22');
    s.startPageRename();
    s.finishPageRename(true, '   '); // empty: keep what there was
    expect(s.pageName()).toBe('Page 22');
  });
  it('new pages get the next free display name; duplicated pages keep the original name', () => {
    const s = fresh();
    s.startPageRename();
    s.finishPageRename(true, 'Bills');
    s.addPage();
    expect(s.pageName()).toBe('Page 2');
    s.startPageRename();
    s.finishPageRename(true, 'Bills2');
    s.duplicatePage();
    expect(s.pageName()).toBe('Bills2'); // an exact twin, page name included
    s.gotoPage(0);
    expect(s.pageName()).toBe('Bills'); // renamed pages keep their name when pages shift around
  });
  it('deletePage removes the whole page, breaks formulas that used its tabs, and is undoable', () => {
    const s = fresh(); // confirmMode off: the gate runs right away
    s.addPage(); // page 2, with its own Tab1
    s.startRename(0);
    s.finishRename(true, 'TempTab'); // a name page 1 can reference without being shadowed
    typeInto(s, 0, 0, '=Tab1!B6'); // page-2 formula now falls back to page 1's Tab1
    s.gotoPage(0);
    s.switchTo(1);
    typeInto(s, 1, 0, '=TempTab!A1'); // page-1 Tab2 reads the doomed page-2 tab
    s.gotoPage(1); // deletePage always removes the page you are on
    s.deletePage();
    expect(s.W.pages.length).toBe(1);
    expect(s.W.pages[0].sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']); // TempTab is gone with its page
    expect(s.W.pages[0].sheets[1].data.cells['1,0'].v).toBe('=#REF!'); // cross-page ref broken, not silent
    expect(s.W.curPage).toBe(0);
    s.undo();
    expect(s.W.pages.length).toBe(2);
    expect(s.S.cells['0,0'].v).toBe('=Tab1!B6'); // the restored page comes back intact
  });
  it('the last page cannot be deleted', () => {
    const s = fresh();
    s.deletePage();
    expect(s.W.pages.length).toBe(1);
    expect(s.msg).toMatch(/at least one page/);
  });
  it('deletePage asks for confirmation when confirm mode is on', () => {
    const s = new Store(mem(), false); // confirmMode stays on (the default)
    s.addPage();
    s.deletePage();
    expect(s.pending).toBeTruthy();
    expect(s.pending!.danger).toBe(true);
    expect(s.W.pages.length).toBe(2); // nothing happened yet
    s.cancelPending();
    expect(s.W.pages.length).toBe(2); // cancelled: nothing happened
  });
});
