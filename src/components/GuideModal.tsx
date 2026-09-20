import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bold, ClipboardPaste, Copy, PaintBucket, Redo2, SquareDashedMousePointer, Table2, Undo2, X } from 'lucide-react';

/* ---------- little building blocks used by the guide text ---------- */
const Code = ({ children }: { children: ReactNode }) => (
  <code className="whitespace-nowrap rounded-md bg-head px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>
);
const P = ({ children }: { children: ReactNode }) => <p className="my-2 leading-relaxed">{children}</p>;
const H = ({ children }: { children: ReactNode }) => <h4 className="mb-1 mt-4 text-[13px] font-semibold uppercase tracking-wider text-muted">{children}</h4>;
const Note = ({ children, tone = 'tip' }: { children: ReactNode; tone?: 'tip' | 'warn' }) => (
  <div className={'my-3 rounded-lg border-l-4 px-3 py-2 text-[13.5px] leading-relaxed ' + (tone === 'warn' ? 'border-err bg-err/10' : 'border-accent bg-softaccent')}>
    <b className="mr-1">{tone === 'warn' ? 'Careful:' : 'Tip:'}</b>
    {children}
  </div>
);
const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="my-2 space-y-2">
    {items.map((s, i) => (
      <li key={i} className="flex gap-3 leading-relaxed">
        <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-accent text-xs font-bold text-onaccent">{i + 1}</span>
        <span className="min-w-0">{s}</span>
      </li>
    ))}
  </ol>
);
const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="my-2 list-disc space-y-1.5 pl-5 leading-relaxed marker:text-accent">
    {items.map((s, i) => <li key={i}>{s}</li>)}
  </ul>
);
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[420px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="bg-head text-xs uppercase tracking-wider text-muted">
            {head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className={'px-3 py-2 leading-snug ' + (j === 0 ? 'font-medium' : '')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Section { id: string; title: string; body: ReactNode }

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Quick start',
    body: (
      <>
        <P>This is a small spreadsheet for household money: bills, meter readings and budgets. It saves itself in your browser as you work.</P>
        <Steps
          items={[
            <>Tap (or click) a cell to select it. Type a value such as <Code>Rent</Code> or <Code>1000</Code>. On a phone, tap a selected cell once more to start typing.</>,
            <>Press <b>Enter</b> to save and move down. On a phone tap <b>Done</b> when you are finished.</>,
            <>To calculate, start with an equals sign: <Code>=B2+B3</Code>. Instead of typing <Code>B2</Code> you can just tap that cell.</>,
            <>Select a finished block, tap the <b>Copy</b> icon, tap a new cell and tap <b>Paste</b>. The formulas move with the block.</>,
            <>Open the <b>Menu</b> for backups, PDF, tabs and ready-made blocks. Use the <b>Theme</b> button to change colours or go dark.</>,
          ]}
        />
        <Note>Want to see it working? Menu → <b>Load example</b> fills the tab with an electricity and water bill you can change.</Note>
      </>
    ),
  },
  {
    id: 'account',
    title: 'Your account, sync and recovery code',
    body: (
      <>
        <P>Your ledger is saved to your account, so you can open it on your phone and on a computer. It also keeps a copy on the device you are using, so it opens fast and keeps working when the connection drops.</P>
        <H>Creating an account</H>
        <Steps
          items={[
            <>Choose <b>Create account</b>, enter an email address and a password of at least 8 characters. The email is only your user name: we do not send emails and do not check it.</>,
            <>You are shown a <b>6 digit recovery code</b>. Copy it, download it, or write it down, then tick the box to continue. It is <b>not shown again</b>.</>,
          ]}
        />
        <H>If you forget your password</H>
        <Steps
          items={[
            <>On the sign-in page tap <b>Forgot your password?</b></>,
            <>Enter your email, the 6 digit recovery code and a new password.</>,
            <>You are signed in and you get a <b>new</b> recovery code. The old code stops working, so save the new one. (Account → <b>New recovery code</b> makes another whenever you want.)</>,
          ]}
        />
        <Note tone="warn">Five wrong recovery codes lock the reset for 15 minutes, so guessing does not work. If you lose both your password and your recovery code, the account cannot be recovered. Keep the code somewhere private.</Note>
        <H>Saving and syncing</H>
        <List
          items={[
            <>Changes are saved to your account a moment after you stop typing. The dot on the <b>Account</b> icon is green when everything is saved, and orange while saving or offline.</>,
            <>Offline? Keep working. Changes are kept on the device and sent when you are back online.</>,
            <>If the same ledger was changed on another device while you had unsaved changes, a bar asks which version to keep. Nothing is overwritten without your say-so.</>,
            <>Changing your password signs your other devices out. <b>Sign out</b> (Account panel) removes the local copy from this device, which is best on a shared phone or computer.</>,
            <><b>Save backup</b> still works and is a good extra copy.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'select',
    title: 'Moving and selecting',
    body: (
      <>
        <Table
          head={['To select…', 'Mouse / keyboard', 'Phone']}
          rows={[
            ['One cell', 'Click it, or use the arrow keys', 'Tap it'],
            ['A block (range)', 'Drag, or Shift + click / Shift + arrows', <>Tap the first cell, turn on the <b>Select range</b> icon, then tap the last cell. Tap the icon again to turn it off.</>],
            ['A whole column or row', 'Click the letter or number at the edge', 'Tap the letter or number'],
            ['Everything', <>Ctrl + A, or click the top-left corner</>, 'Tap the top-left corner'],
          ]}
        />
        <P>The box at the left of the formula bar shows where you are: <Code>B3</Code> for one cell, <Code>A1:B6</Code> for a block. When you select several numbers, the bottom of the screen shows their <b>Sum</b> and <b>Average</b>.</P>
      </>
    ),
  },
  {
    id: 'typing',
    title: 'Typing and editing',
    body: (
      <>
        <List
          items={[
            <><b>Start typing</b> on a selected cell to replace it, or press <b>Enter</b> / <b>F2</b> / double-click to edit what is already there.</>,
            <><b>Enter</b> saves and moves down. <b>Tab</b> saves and moves right. <b>Esc</b> cancels your edit.</>,
            <><b>Delete</b> clears the selected cells.</>,
            <>The <b>formula bar</b> above the grid shows the real contents of the selected cell (the formula, not just its result). You can type there too.</>,
            <>Numbers may include commas and a currency sign: <Code>1,200</Code>, <Code>$45</Code> and <Code>€9.50</Code> are all numbers. Numbers line up on the right, text on the left.</>,
            <>A small orange corner in a cell means it holds a formula.</>,
          ]}
        />
        <H>On a phone</H>
        <List
          items={[
            <>While the keyboard is open the screen shows only the grid and the formula bar, to give you room. Tap <b>Done</b> to close the keyboard.</>,
            <>The keyboard's <b>Next</b> key saves and moves to the cell below. Tapping another cell jumps the editor there and keeps the keyboard open.</>,
            <>While writing a formula, a row of function chips and symbol keys (<Code>(</Code> <Code>)</Code> <Code>,</Code> <Code>:</Code> <Code>+</Code> <Code>-</Code> <Code>×</Code> <Code>÷</Code>) appears above the grid.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'formulas',
    title: 'Formulas for beginners',
    body: (
      <>
        <P>A formula is a small sum the sheet works out for you, and updates whenever the numbers change. It <b>always starts with =</b>.</P>
        <H>Cell addresses</H>
        <P>Every cell has an address: its column letter and row number. <Code>B3</Code> is column B, row 3. Type the address in a formula, or tap the cell while typing (this works right after <Code>=</Code>, an operator, <Code>(</Code>, <Code>,</Code> or <Code>:</Code>).</P>
        <H>Calculating</H>
        <Table
          head={['Symbol', 'Does', 'Example']}
          rows={[
            [<Code>+</Code>, 'Add', <><Code>=B2+B3</Code></>],
            [<Code>-</Code>, 'Subtract', <><Code>=B3-B2</Code></>],
            [<Code>*</Code>, 'Multiply (on a phone use the × key)', <><Code>=B4*B5</Code></>],
            [<Code>/</Code>, 'Divide (on a phone use the ÷ key)', <><Code>=B6/2</Code></>],
            [<Code>( )</Code>, 'Do this part first', <><Code>=(B2+B3)/2</Code></>],
          ]}
        />
        <P>Multiplying and dividing happen before adding and subtracting, like in school: <Code>=2+3*4</Code> is 14, but <Code>=(2+3)*4</Code> is 20.</P>
        <H>A real example: an electricity bill</H>
        <Table
          head={['Cell', 'Contains', 'Shows']}
          rows={[
            ['B2  Previous reading', <Code>1200</Code>, '1,200'],
            ['B3  Current reading', <Code>1350</Code>, '1,350'],
            ['B4  Units used', <Code>=B3-B2</Code>, '150'],
            ['B5  Rate per unit', <Code>0.15</Code>, '0.15'],
            ['B6  Amount due', <Code>=B4*B5</Code>, '22.5'],
          ]}
        />
        <P>Change the current reading and B4 and B6 update by themselves.</P>
        <Note>Type formulas in any case: <Code>=sum(b2:b5)</Code> becomes <Code>=SUM(B2:B5)</Code> automatically. An empty cell counts as 0. Results show up to 4 decimals.</Note>
      </>
    ),
  },
  {
    id: 'functions',
    title: 'Functions: SUM, AVG, MIN, MAX',
    body: (
      <>
        <P>A function does a bigger job in one word. Write its name, then the values in brackets. Values can be cells (<Code>B2</Code>), numbers (<Code>10</Code>) or a <b>range</b>, which is a block written as two corners with a colon: <Code>B2:B5</Code> means B2, B3, B4 and B5.</P>
        <Table
          head={['Function', 'What it gives you', 'Example']}
          rows={[
            [<Code>SUM(…)</Code>, 'The total of the numbers', <><Code>=SUM(B2:B5)</Code> adds four cells</>],
            [<><Code>AVG(…)</Code><br /><Code>AVERAGE(…)</Code></>, 'The average (total ÷ how many numbers)', <><Code>=AVG(B2:B5)</Code></>],
            [<Code>MAX(…)</Code>, 'The biggest number', <><Code>=MAX(B2:B5)</Code></>],
            [<Code>MIN(…)</Code>, 'The smallest number', <><Code>=MIN(B2:B5)</Code></>],
          ]}
        />
        <H>Good to know</H>
        <List
          items={[
            <>Mix things freely, separated by commas: <Code>=SUM(B2:B5, D2, 100)</Code>.</>,
            <>Text and empty cells <b>inside a range</b> are skipped, so a heading in the middle of a range does no harm.</>,
            <>A range must sit inside a function. <Code>=B2:B5</Code> on its own shows <Code>#VALUE!</Code>.</>,
            <><Code>AVG</Code> of nothing shows <Code>#DIV/0!</Code>. <Code>MIN</Code> and <Code>MAX</Code> of nothing give 0.</>,
            <>Functions can sit inside sums: <Code>=SUM(B2:B5)*0.2</Code> is 20% of the total.</>,
            <>Type <Code>=</Code> and suggestion chips appear. Tap one and it writes the name and brackets for you. Typing <Code>(</Code> adds the closing <Code>)</Code> automatically.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'copy',
    title: 'Copy, paste and fill',
    body: (
      <>
        <P>Select a block, tap <b>Copy</b> (a dashed orange line marks it), select where it should go and tap <b>Paste</b>. Text, formulas, bold, colours and merged cells all come along.</P>
        <H>Formulas move with the block</H>
        <P>References are <b>relative</b> by default: they shift by the same distance the block moves. Copy <Code>=B3-B2</Code> seven rows down and it becomes <Code>=B10-B9</Code>. That is how you repeat the meter block for water: copy A1:B6, paste at A8, change the numbers.</P>
        <H>Keep a cell fixed with $</H>
        <P>Put <Code>$</Code> before the column or row you do not want to move:</P>
        <Table
          head={['Write', 'When copied…']}
          rows={[
            [<Code>$B$1</Code>, 'Always stays B1 (fully fixed). Good for a single rate.'],
            [<Code>$B1</Code>, 'Column stays B, row can move.'],
            [<Code>B$1</Code>, 'Row stays 1, column can move.'],
            [<Code>B1</Code>, 'Moves in both directions.'],
          ]}
        />
        <H>More ways</H>
        <List
          items={[
            <><b>Repeat:</b> if the area you select before pasting is an exact multiple of the copied block, the block repeats to fill it.</>,
            <><b>Fill down (Ctrl + D):</b> select a column of cells whose top cell has the formula; the others become copies of it.</>,
            <><b>From other apps:</b> you can paste tab-separated text copied from Excel, Google Sheets or a website table.</>,
            <>Press <b>Esc</b> to remove the dashed line.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'tabs',
    title: 'Using several tabs',
    body: (
      <>
        <P>Tabs sit at the bottom. Use one per month, per person or for a summary. A formula can read a cell on another tab by writing the tab name, an exclamation mark, then the address:</P>
        <Table
          head={['Formula', 'Means']}
          rows={[
            [<Code>=Tab1!B6</Code>, 'Cell B6 on the tab called Tab1'],
            [<Code>=Tab1!B6+Tab2!B4</Code>, 'Add cells from two tabs'],
            [<Code>=SUM(Tab1!B2:B5)</Code>, 'A range on another tab'],
            [<Code>='My Bills'!B6</Code>, 'Tab names with spaces need quotes'],
          ]}
        />
        <List
          items={[
            <>While writing a formula, tap another tab and tap a cell there. The address is inserted with the tab name for you.</>,
            <>Rename a tab and every formula that uses it is updated. Delete a tab and formulas that used it show <Code>#REF!</Code> (Undo brings it back).</>,
            <>Tab names cannot contain <Code>! ' :</Code> and may be up to 30 letters. You can have up to 40 tabs.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'format',
    title: 'Bold, colours and merging',
    body: (
      <>
        <List
          items={[
            <><b>Bold</b> (the B icon): makes the selected cells bold, or removes it if they are all bold.</>,
            <><b>Fill colour</b> (the paint bucket): pick cells, then a colour. Choose <b>No fill</b> to clear it.</>,
            <><b>Opacity</b>: the slider in the same panel sets how strong the colour is, from 10% (very light) to 100%. Choose the opacity, then tap a colour to use it for new fills. Moving the slider also changes the opacity of the coloured cells you have selected.</>,
            <>Coloured cells keep a clear grid line around them at any opacity, so a big coloured block never loses its cell borders.</>,
            <><b>Merge cells</b> (grid icon → Merge cells): joins the selected cells into one box, good for titles. Only the top-left value is kept (Undo brings the others back). <b>Unmerge</b> splits it again.</>,
            <><b>Column width</b>: drag the right edge of a column letter, with the mouse or your finger.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'rows',
    title: 'Rows and columns',
    body: (
      <>
        <P>The grid icon in the toolbar (next to the paint bucket) opens the <b>Cells</b> panel:</P>
        <List
          items={[
            <><b>Row above / Row below</b> and <b>Column left / Column right</b> insert as many rows or columns as you have selected (one, if you selected a whole row or column).</>,
            <><b>Delete row / Delete column</b> remove the selected ones.</>,
            <>Formulas are adjusted for you. A range like <Code>SUM(B2:B5)</Code> grows when you insert inside it and shrinks when you delete inside it. A formula that pointed at a deleted cell shows <Code>#REF!</Code>.</>,
            <>A tab can have up to 1000 rows and 60 columns. It grows as you type near the edge.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'menu',
    title: 'The Menu, item by item',
    body: (
      <>
        <Table
          head={['Item', 'What it does']}
          rows={[
            ['Save backup', <>Downloads a file with <b>every tab</b>, all formulas, colours and column widths (<Code>household-ledger-date.json</Code>). Keep it somewhere safe or send it to yourself.</>],
            ['Open backup', 'Loads a backup file and replaces what is on screen. Undo brings back what you had before. You can also drag a backup file onto the page.'],
            ['PDF: this tab', 'Makes a PDF of the tab you are looking at. Wide tabs turn sideways or split over pages. Colours and merged cells are printed as they look.'],
            ['PDF: all tabs', 'One PDF with every tab, each starting on a new page.'],
            ['Insert block', <>Places a ready-made block (<b>Meter reading</b> with usage × rate, or <b>Monthly budget</b> with a SUM total) starting at the selected cell. Change the numbers, or copy it further down.</>],
            ['Load example', 'Replaces the current tab with the sample electricity + water bills. Undo brings your tab back.'],
            ['New tab', 'Adds an empty tab (Tab3, Tab4…).'],
            ['Rename', 'Type a new name for the current tab. You can also double-click a tab.'],
            ['Copy tab', 'Duplicates the current tab with all its formulas, right after it.'],
            ['Delete tab', <>Press once to arm it (the button asks <i>Sure?</i>), press again within 4 seconds to delete. You always keep at least one tab.</>],
            ['Clear tab', 'Empties the current tab. Undo brings it back.'],
          ]}
        />
        <Note>Your work is saved in this browser automatically. If you clear the browser's site data, or open the page on another device, it will not be there. <b>Save backup</b> now and then, especially before changing phone.</Note>
      </>
    ),
  },
  {
    id: 'icons',
    title: 'Toolbar icons',
    body: (
      <>
        <Table
          head={['Icon', 'Name', 'Use']}
          rows={[
            [<Undo2 size={20} aria-label="Undo icon" />, 'Undo', 'Takes back your last change. Works many steps back (Ctrl + Z).'],
            [<Redo2 size={20} aria-label="Redo icon" />, 'Redo', 'Puts back what you undid (Ctrl + Y).'],
            [<Copy size={20} aria-label="Copy icon" />, 'Copy', 'Copies the selected block (Ctrl + C).'],
            [<ClipboardPaste size={20} aria-label="Paste icon" />, 'Paste', 'Pastes at the selected cell (Ctrl + V).'],
            [<SquareDashedMousePointer size={20} aria-label="Select range icon" />, 'Select range', 'When lit, tapping a cell stretches the selection to it. Made for phones.'],
            [<Bold size={20} aria-label="Bold icon" />, 'Bold', 'Bold on / off (Ctrl + B).'],
            [<PaintBucket size={20} aria-label="Fill colour icon" />, 'Fill colour', 'Colours and opacity for the selected cells.'],
            [<Table2 size={20} aria-label="Cells icon" />, 'Cells', 'Merge, unmerge, insert or delete rows and columns.'],
          ]}
        />
        <P>Hover over an icon (or press and hold it on some phones) to see its name.</P>
      </>
    ),
  },
  {
    id: 'errors',
    title: 'When a cell shows an error',
    body: (
      <>
        <P>A red code means the formula could not be worked out. Nothing is broken: fix the cause and it goes away.</P>
        <Table
          head={['Code', 'Meaning', 'Try']}
          rows={[
            [<Code>#DIV/0!</Code>, 'Dividing by zero or an empty cell, or AVG of nothing.', 'Fill in the number you divide by.'],
            [<Code>#VALUE!</Code>, 'A cell used in a sum holds text, or a bare range like =B2:B5.', 'Use numbers, or wrap the range in SUM( ).'],
            [<Code>#REF!</Code>, 'A cell, row or tab the formula used was deleted, or the tab name does not exist.', 'Retype the reference, or Undo.'],
            [<Code>#NAME?</Code>, 'A function name that does not exist (only SUM, AVG, AVERAGE, MIN, MAX do).', 'Check the spelling.'],
            [<Code>#CIRC!</Code>, 'The formula uses its own cell, directly or through others.', 'Point it at different cells.'],
            [<Code>#ERR!</Code>, 'The formula is not written correctly (missing bracket, stray symbol).', 'Look for a missing ) or operator.'],
            [<Code>#NUM!</Code>, 'The result is too big to be a number.', 'Check the numbers.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    body: (
      <>
        <P>On Mac, use ⌘ instead of Ctrl.</P>
        <Table
          head={['Keys', 'Does']}
          rows={[
            [<Code>Ctrl + Z</Code>, 'Undo'],
            [<><Code>Ctrl + Y</Code> or <Code>Ctrl + Shift + Z</Code></>, 'Redo'],
            [<Code>Ctrl + C</Code>, 'Copy'],
            [<Code>Ctrl + V</Code>, 'Paste'],
            [<Code>Ctrl + B</Code>, 'Bold'],
            [<Code>Ctrl + D</Code>, 'Fill down'],
            [<Code>Ctrl + A</Code>, 'Select everything'],
            [<Code>Arrow keys</Code>, 'Move (add Shift to select a block)'],
            [<><Code>Tab</Code> / <Code>Shift + Tab</Code></>, 'Move right / left'],
            [<><Code>Enter</Code> or <Code>F2</Code></>, 'Edit the selected cell'],
            [<Code>Esc</Code>, 'Cancel the edit, or hide the dashed copy line'],
            [<><Code>Delete</Code> or <Code>Backspace</Code></>, 'Clear the selected cells'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'recipes',
    title: 'Try these',
    body: (
      <>
        <H>1. Monthly budget with a total</H>
        <Steps
          items={[
            <>Select a cell, Menu → <b>Insert block → Monthly budget</b>.</>,
            <>Change the amounts. The <b>Total</b> uses <Code>=SUM(B2:B5)</Code>.</>,
            <>Need another line? Tap the row number of <b>Groceries</b>, then Cells → <b>Row below</b>, and type the new item. The new row lands inside the list, so the total's range grows by itself (<Code>SUM(B2:B6)</Code>). A row added right after the last item is outside the range, so drag or retype the total then.</>,
          ]}
        />
        <H>2. One tab per month, one summary</H>
        <Steps
          items={[
            <>Build January on Tab1, then Menu → <b>Copy tab</b> for February.</>,
            <>Rename the tabs Jan and Feb.</>,
            <>On a new tab write <Code>=Jan!B6+Feb!B6</Code> for the two-month total.</>,
          ]}
        />
        <H>3. A rate you use everywhere</H>
        <Steps
          items={[
            <>Put the rate in one cell, say <Code>E1</Code> = <Code>0.15</Code>.</>,
            <>In your bills write <Code>=B4*$E$1</Code>. Copy it down and it always uses E1.</>,
            <>Change E1 once and every bill updates.</>,
          ]}
        />
        <H>4. Highlight what matters</H>
        <Steps
          items={[
            <>Select the totals, tap the paint bucket, pick Yellow.</>,
            <>Slide Opacity to 50% for a softer highlight. Even at 50% the cell borders stay clear.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'phone',
    title: 'Phone tips',
    body: (
      <List
        items={[
          <>Add this page to your home screen (Chrome menu → <i>Add to Home screen</i>, Safari share → <i>Add to Home Screen</i>) for one-tap access.</>,
          <>Turn the phone sideways for a wider grid; the layout adapts.</>,
          <>Scroll the grid with one finger. Column and row headers stay in place.</>,
          <>The icon toolbar never scrolls sideways, so every tool is one tap away. Rows and columns, merging and colours live in the two right-hand icons.</>,
          <>Long tab lists scroll sideways. Rename, copy and delete are in the Menu.</>,
          <>Use <b>Save backup</b> before you change or reset your phone.</>,
        ]}
      />
    ),
  },
];

export function GuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // highlight the section being read
  useEffect(() => {
    const root = scroller.current;
    if (!open || !root) return;
    const on = () => {
      let cur = SECTIONS[0].id;
      const top = root.getBoundingClientRect().top + 90;
      for (const s of SECTIONS) {
        const el = root.querySelector('#g-' + s.id);
        if (el && el.getBoundingClientRect().top <= top) cur = s.id;
      }
      setActive(cur);
    };
    on();
    root.addEventListener('scroll', on, { passive: true });
    return () => root.removeEventListener('scroll', on);
  }, [open]);

  if (!open) return null;
  const go = (id: string) => {
    scroller.current?.querySelector('#g-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guide"
        onClick={(e) => e.stopPropagation()}
        className="anim-sheet flex w-full max-w-5xl flex-col overflow-hidden bg-panel text-ink shadow-[var(--shadow)] sm:rounded-2xl sm:border sm:border-line"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-xl font-bold leading-tight">Guide</h2>
            <p className="text-xs text-muted">Formulas and every tool, for beginners</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            autoFocus
            className="grid size-10 place-items-center rounded-lg bg-head text-ink hover:bg-headhl"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {/* phone: a row of chips to jump around */}
        <nav aria-label="Guide sections" className="no-scrollbar flex flex-none gap-1.5 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(s.id)}
              className={
                'flex-none rounded-full border px-3 py-1 text-[13px] ' +
                (active === s.id ? 'border-accent bg-accent font-semibold text-onaccent' : 'border-line bg-panel')
              }
            >
              {s.title}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Guide sections" className="hidden w-56 flex-none overflow-y-auto border-r border-line p-3 md:block">
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => go(s.id)}
                    className={
                      'w-full rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ' +
                      (active === s.id ? 'bg-softaccent font-semibold text-accent' : 'hover:bg-softaccent')
                    }
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 pt-2 text-[14.5px] sm:px-6">
            {SECTIONS.map((s) => (
              <section key={s.id} id={'g-' + s.id} className="scroll-mt-2 border-b border-line py-5 last:border-b-0">
                <h3 className="mb-2 font-display text-lg font-bold">{s.title}</h3>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
