import { describe, expect, it } from 'vitest';
import { Store } from './store';
import { blank, sampleWorkbook, setCell } from './model';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
// confirmMode defaults on — this is the whole point of the feature, so tests build a Store that way
const fresh = () => new Store(mem(), false);
// a Store with a genuinely empty sheet, for tests that need a cell with no pre-existing value/formatting
// (fresh() loads the built-in example, which has real content on most of the first 15 rows)
function blankStore(): Store {
  const s = new Store(mem(), false);
  s.W = { cur: 0, sheets: [{ name: 'Tab1', data: blank() }] };
  return s;
}
const put = (s: Store, r: number, c: number, v: string) => setCell(s.S, r, c, { v });
const typeInto = (s: Store, r: number, c: number, v: string) => {
  s.sel = { ar: r, ac: c, fr: r, fc: c };
  s.startEdit(v);
  s.commitEdit();
};

describe('confirm mode defaults on', () => {
  it('a brand new Store asks before every change', () => {
    expect(fresh().confirmMode).toBe(true);
  });
  it('an old saved preference (fillOpacity only, no confirmMode) still defaults to on', () => {
    const st = mem();
    st.setItem('household-ledger-ui', JSON.stringify({ fillOpacity: 60 }));
    const s = new Store(st, false);
    expect(s.confirmMode).toBe(true);
    expect(s.fillOpacity).toBe(60);
  });
  it('an explicit off preference is remembered', () => {
    const st = mem();
    st.setItem('household-ledger-ui', JSON.stringify({ fillOpacity: 100, confirmMode: false }));
    expect(new Store(st, false).confirmMode).toBe(false);
  });
});

describe('editing a cell (the A4: 0 -> 10 case)', () => {
  it('holds the change and asks a plain-English question until confirmed', () => {
    const s = fresh();
    put(s, 3, 0, '0');
    typeInto(s, 3, 0, '10');
    expect(s.S.cells['3,0'].v).toBe('0'); // not applied yet
    expect(s.pending).toBeTruthy();
    expect(s.pending!.message).toBe('Change A4 from "0" to "10"?');
    s.confirmPending();
    expect(s.S.cells['3,0'].v).toBe('10');
    expect(s.pending).toBeNull();
  });
  it('cancelling leaves the cell exactly as it was', () => {
    const s = fresh();
    put(s, 3, 0, '0');
    typeInto(s, 3, 0, '10');
    s.cancelPending();
    expect(s.S.cells['3,0'].v).toBe('0');
    expect(s.pending).toBeNull();
    expect(s.hist.length).toBe(0); // nothing was ever pushed to undo history
  });
  it('typing the same value again asks nothing (no real change)', () => {
    const s = fresh();
    put(s, 3, 0, '10');
    typeInto(s, 3, 0, '10');
    expect(s.pending).toBeNull();
  });
  it('describes setting an empty cell, and clearing one, in plain English', () => {
    const s = blankStore();
    typeInto(s, 5, 0, 'Rent');
    expect(s.pending!.message).toBe('Set A6 to "Rent"?');
    s.confirmPending();
    typeInto(s, 5, 0, '');
    expect(s.pending!.message).toBe('Clear A6 (currently "Rent")?');
    s.confirmPending();
    expect(s.S.cells['5,0']).toBeUndefined();
  });
  it('confirming applies exactly one undo step', () => {
    const s = fresh();
    put(s, 3, 0, '0');
    typeInto(s, 3, 0, '10');
    s.confirmPending();
    expect(s.hist.length).toBe(1);
    s.undo();
    expect(s.S.cells['3,0'].v).toBe('0');
  });
  it('turning confirm mode off applies changes immediately again, like before', () => {
    const s = fresh();
    s.toggleConfirmMode();
    expect(s.confirmMode).toBe(false);
    put(s, 3, 0, '0');
    typeInto(s, 3, 0, '10');
    expect(s.pending).toBeNull();
    expect(s.S.cells['3,0'].v).toBe('10');
  });
});

describe('one confirmation at a time, no lost edits', () => {
  it('refuses to start a second edit while one is pending', () => {
    const s = fresh();
    put(s, 3, 0, '0');
    typeInto(s, 3, 0, '10');
    s.sel = { ar: 4, ac: 0, fr: 4, fc: 0 };
    s.startEdit('should not start');
    expect(s.editing).toBe(false);
    expect(s.msg).toMatch(/confirm or cancel/i);
    // the first pending change is exactly what it was, untouched
    expect(s.pending!.message).toBe('Change A4 from "0" to "10"?');
  });
  it('a second attempt at the SAME kind of change while one is pending does not silently apply', () => {
    const s = fresh();
    s.sel = { ar: 5, ac: 0, fr: 6, fc: 1 };
    s.toggleBold();
    const first = s.pending;
    s.toggleBold(); // pressed again before confirming
    expect(s.pending).toBe(first); // unchanged, and the cell is still not bold
    s.confirmPending();
    expect(s.S.cells['5,0'].b).toBe(1);
  });
});

describe('formatting and fill', () => {
  it('bold asks, in both directions, and only changes the selection on confirm', () => {
    const s = blankStore();
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 1 };
    s.toggleBold();
    expect(s.pending!.message).toBe('Make A1:B1 bold?');
    expect(s.S.cells['0,0']).toBeUndefined();
    s.confirmPending();
    expect(s.S.cells['0,0'].b).toBe(1);
    s.toggleBold();
    expect(s.pending!.message).toBe('Remove bold from A1:B1?');
    s.confirmPending();
    // an otherwise-empty cell with no bold and no fill has nothing left to remember
    expect(s.S.cells['0,0']).toBeUndefined();
  });
  it('fill colour names the colour and opacity; "no fill" is flagged as a destructive change', () => {
    const s = blankStore();
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.setFill(2);
    expect(s.pending!.message).toBe('Fill A1 with Green at 100% opacity?');
    expect(s.pending!.danger).toBeFalsy();
    s.confirmPending();
    expect(s.S.cells['0,0'].f).toBe(2);
    s.setFill(0);
    expect(s.pending!.message).toBe('Remove the fill colour from A1?');
    expect(s.pending!.danger).toBe(true);
    s.confirmPending();
    expect(s.S.cells['0,0']).toBeUndefined();
  });
  it('the opacity slider only asks once you release it on a filled cell that actually changes', () => {
    const s = blankStore();
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.setFill(1);
    s.confirmPending();
    s.setOpacity(55, false); // dragging: no confirmation
    expect(s.pending).toBeNull();
    s.setOpacity(55, true); // released
    expect(s.pending!.message).toBe('Set the fill opacity to 55% for A1?');
    s.confirmPending();
    expect(s.S.cells['0,0'].o).toBe(55);
  });
});

describe('clearing cells', () => {
  it('Delete on an empty selection asks nothing', () => {
    const s = blankStore();
    s.sel = { ar: 10, ac: 0, fr: 10, fc: 0 };
    s.clearSel();
    expect(s.pending).toBeNull();
  });
  it('Delete on cells with content asks, and only clears on confirm', () => {
    const s = blankStore();
    put(s, 10, 0, 'x');
    s.sel = { ar: 10, ac: 0, fr: 10, fc: 0 };
    s.clearSel();
    expect(s.pending!.message).toBe('Clear the contents of A11?');
    expect(s.pending!.danger).toBe(true);
    expect(s.S.cells['10,0'].v).toBe('x');
    s.confirmPending();
    expect(s.S.cells['10,0']).toBeUndefined();
  });
});

describe('merge, unmerge, fill down', () => {
  it('merge warns about hidden values by name and count', () => {
    const s = blankStore();
    put(s, 0, 0, 'a'); put(s, 0, 1, 'b');
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 1 };
    s.mergeSel();
    expect(s.pending!.message).toMatch(/Merge A1:B1 into one cell\? Only the top-left value is kept — 1 other value will be hidden/);
    expect(s.S.merges.length).toBe(0);
    s.confirmPending();
    expect(s.S.merges).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 1 }]);
  });
  it('unmerge asks for the range', () => {
    const s = blankStore();
    s.S.merges.push({ r0: 0, c0: 0, r1: 0, c1: 1 });
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    s.unmergeSel();
    expect(s.pending!.message).toBe('Unmerge the cells in A1:B1?');
    s.confirmPending();
    expect(s.S.merges.length).toBe(0);
  });
  it('fill down describes the target range and only fills on confirm', () => {
    const s = blankStore();
    put(s, 0, 0, '1');
    s.sel = { ar: 0, ac: 0, fr: 3, fc: 0 };
    s.fillDown();
    expect(s.pending!.message).toMatch(/^Fill down into A1:A4\?/);
    expect(s.S.cells['3,0']).toBeUndefined();
    s.confirmPending();
    expect(s.S.cells['3,0'].v).toBe('1');
  });
});

describe('rows and columns', () => {
  it('insert row names the row and only inserts on confirm', () => {
    const s = fresh();
    put(s, 0, 0, 'keep');
    s.sel = { ar: 2, ac: 0, fr: 2, fc: 0 };
    s.rowAbove();
    expect(s.pending!.message).toBe('Insert a row above row 3?');
    expect(s.S.rows).toBe(40);
    s.confirmPending();
    expect(s.S.rows).toBe(41);
    expect(s.S.cells['0,0'].v).toBe('keep'); // unaffected row stayed put
  });
  it('delete row warns about #REF! and only deletes on confirm', () => {
    const s = fresh();
    put(s, 0, 0, '5'); put(s, 1, 0, '7'); put(s, 2, 0, '=A1+A2');
    s.sel = { ar: 1, ac: 0, fr: 1, fc: 0 };
    s.delRow();
    expect(s.pending!.message).toBe('Delete row 2? Formulas that used it will show #REF!.');
    expect(s.pending!.danger).toBe(true);
    expect(s.S.cells['1,0'].v).toBe('7');
    s.confirmPending();
    expect(s.S.cells['1,0'].v).toBe('=A1+#REF!');
  });
  it('delete column names it by letter', () => {
    const s = blankStore();
    put(s, 0, 1, 'x');
    s.sel = { ar: 0, ac: 1, fr: 0, fc: 1 };
    s.delCol();
    expect(s.pending!.message).toBe('Delete column B? Formulas that used it will show #REF!.');
    s.confirmPending();
    expect(s.S.cells['0,1']).toBeUndefined();
  });
});

describe('paste, blocks, example, clear tab, backups', () => {
  it('paste describes the destination and replaces only on confirm', () => {
    const s = fresh();
    put(s, 0, 0, '1'); put(s, 0, 1, '=A1*2');
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 1 };
    s.doCopy(false); // copy does not ask (nothing changes)
    expect(s.pending).toBeNull();
    put(s, 10, 0, 'old');
    s.sel = { ar: 10, ac: 0, fr: 10, fc: 0 };
    s.pasteClip();
    expect(s.pending!.message).toBe('Paste into A11:B11? This replaces what is there now.');
    expect(s.S.cells['10,0'].v).toBe('old');
    s.confirmPending();
    expect(s.S.cells['10,0'].v).toBe('1');
  });
  it('pasting plain text also asks first', () => {
    const s = fresh();
    s.sel = { ar: 15, ac: 0, fr: 15, fc: 0 };
    s.pasteText('a\t1\nb\t2');
    expect(s.pending!.message).toBe('Paste into A16:B17? This replaces what is there now.');
    expect(s.S.cells['15,0']).toBeUndefined();
    s.confirmPending();
    expect(s.S.cells['15,0'].v).toBe('a');
  });
  it('insert block names the block and the cell', () => {
    const s = fresh();
    s.sel = { ar: 20, ac: 0, fr: 20, fc: 0 };
    s.insertTemplate('budget');
    expect(s.pending!.message).toBe('Insert the Monthly budget block at A21?');
    s.confirmPending();
    expect(s.S.cells['25,1'].v).toBe('=SUM(B22:B25)');
  });
  it('load example warns it replaces the current tab', () => {
    const s = fresh();
    put(s, 0, 0, 'mine');
    s.loadExample();
    expect(s.pending!.message).toMatch(/^Replace "Tab1" with the example\?/);
    expect(s.pending!.danger).toBe(true);
    expect(s.S.cells['0,0'].v).toBe('mine');
    s.confirmPending();
    expect(s.S.cells['0,0'].v).toBe('Electricity');
  });
  it('clear tab names the tab', () => {
    const s = fresh();
    put(s, 0, 0, 'mine');
    s.clearTab();
    expect(s.pending!.message).toBe('Clear all data on "Tab1"? Undo brings it back.');
    expect(s.S.cells['0,0'].v).toBe('mine');
    s.confirmPending();
    expect(s.S.cells['0,0']).toBeUndefined();
  });
  it('opening a backup counts its tabs and only replaces on confirm', () => {
    const s = fresh();
    const before = s.W.sheets.length;
    s.openBackupText(JSON.stringify(sampleWorkbook()));
    expect(s.pending!.message).toMatch(/^Replace everything with this backup \(2 tabs\)\?/);
    expect(s.W.sheets.length).toBe(before);
    s.confirmPending();
    expect(s.W.sheets.map((x) => x.name)).toEqual(['Tab1', 'Tab2']);
  });
  it('a file that is not a backup is rejected before any confirmation is asked', () => {
    const s = fresh();
    s.openBackupText('not json');
    expect(s.pending).toBeNull();
    expect(s.msg).toMatch(/not a Household ledger backup/);
  });
});

describe('undo and redo are never gated', () => {
  it('undo/redo apply immediately even with confirm mode on', () => {
    const s = fresh();
    put(s, 0, 0, 'a');
    s.mutate(() => {}); // a no-op history entry to undo, without going through the confirm layer
    s.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
    typeInto(s, 0, 0, 'b');
    s.confirmPending();
    expect(s.S.cells['0,0'].v).toBe('b');
    s.undo();
    expect(s.pending).toBeNull();
    expect(s.S.cells['0,0'].v).toBe('a');
    s.redo();
    expect(s.S.cells['0,0'].v).toBe('b');
  });
});
