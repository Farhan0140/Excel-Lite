import { BookOpen, UserRound, CopyPlus, Download, Eraser, FileText, FilePlus2, Files, FolderOpen, Palette, Pencil, Sparkles, Trash2, Wallet, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Store } from '../engine/store';
import { Popover, PanelTitle } from './ui';

interface Item {
  icon: LucideIcon;
  label: string;
  hint?: string;
  run: () => void | false; // return false to keep the menu open (used by the two-step delete)
  danger?: boolean;
  armed?: boolean;
}
interface Section { title: string; note?: string; items: Item[] }

export function MenuPanel({
  store, open, onClose, onOpenFile, onGuide, onTheme, onAccount,
}: { store: Store; open: boolean; onClose: () => void; onOpenFile: () => void; onGuide: () => void; onTheme: () => void; onAccount: () => void }) {
  const name = store.curSheet.name;
  const left: Section[] = [
    {
      title: 'File',
      items: [
        { icon: Download, label: 'Save backup', hint: 'Download all tabs as a file', run: () => store.saveBackup() },
        { icon: FolderOpen, label: 'Open backup', hint: 'Load a file you saved earlier', run: onOpenFile },
      ],
    },
    {
      title: 'Export',
      items: [
        { icon: FileText, label: 'PDF: this tab', hint: name, run: () => void store.exportPdf(false) },
        { icon: Files, label: 'PDF: all tabs', hint: store.W.sheets.length + ' tabs in one file', run: () => void store.exportPdf(true) },
      ],
    },
    {
      title: 'Insert',
      note: 'Blocks go at the selected cell',
      items: [
        { icon: Zap, label: 'Insert block: Meter reading', hint: 'Usage × rate = amount due', run: () => store.insertTemplate('meter') },
        { icon: Wallet, label: 'Insert block: Monthly budget', hint: 'Items with a SUM total', run: () => store.insertTemplate('budget') },
        { icon: Sparkles, label: 'Load example', hint: 'Replace this tab with a sample', run: () => store.loadExample() },
      ],
    },
  ];
  const right: Section[] = [
    {
      title: 'Tabs',
      items: [
        { icon: FilePlus2, label: 'New tab', hint: 'Add an empty tab', run: () => store.addTab() },
        { icon: Pencil, label: 'Rename', hint: 'Rename "' + name + '"', run: () => store.startRename(store.W.cur) },
        { icon: CopyPlus, label: 'Copy tab', hint: 'Duplicate with all formulas', run: () => store.copyTab() },
        {
          icon: Trash2,
          danger: true,
          armed: store.delArm,
          label: store.delArm ? 'Sure? Delete "' + name + '"' : 'Delete tab',
          hint: store.delArm ? 'Press again to confirm' : 'Remove this tab',
          run: () => (store.deleteTab() ? undefined : false),
        },
        { icon: Eraser, label: 'Clear tab', hint: 'Empty this tab (undo brings it back)', run: () => store.clearTab() },
      ],
    },
    {
      title: 'Account, help & look',
      items: [
        { icon: UserRound, label: 'Account', hint: 'Sync, password, recovery code, sign out', run: () => { onAccount(); return false; } },
        { icon: BookOpen, label: 'Guide', hint: 'Formulas and how to use each tool', run: () => { onGuide(); return false; } },
        { icon: Palette, label: 'Theme', hint: 'Colours, light and dark', run: () => { onTheme(); return false; } },
      ],
    },
  ];

  const renderSection = (s: Section) => (
    <section key={s.title} className="px-2 pb-1 pt-2">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {s.title}
        {s.note && <span className="ml-2 font-normal normal-case tracking-normal opacity-80">{s.note}</span>}
      </h3>
      <ul role="menu">
        {s.items.map((it) => (
          <li key={it.label} role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const keep = it.run() === false;
                if (!keep) onClose();
              }}
              className={
                'group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-softaccent active:bg-softaccent coarse:py-2.5 ' +
                (it.armed ? 'bg-err/15 ' : '')
              }
            >
              <span
                className={
                  'grid size-9 flex-none place-items-center rounded-lg ' + (it.danger ? 'bg-err/15 text-err' : 'bg-softaccent text-accent')
                }
              >
                <it.icon size={19} strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={'block truncate text-[14px] font-medium ' + (it.danger ? 'text-err' : '')}>{it.label}</span>
                {it.hint && <span className="block truncate text-xs text-muted">{it.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <Popover open={open} onClose={onClose} variant="sheet" title="Menu" panelClass="sm:w-[36rem]">
      <PanelTitle onClose={onClose}>Menu</PanelTitle>
      <div className="grid pb-2 sm:grid-cols-2 sm:gap-x-1">
        <div>{left.map(renderSection)}</div>
        <div>{right.map(renderSection)}</div>
      </div>
    </Popover>
  );
}
