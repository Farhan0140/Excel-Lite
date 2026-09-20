export interface Cell {
  v: string; // raw text: a value, or a formula starting with "="
  b: number; // bold 0/1
  f: number; // fill colour 0 (none) .. FILL_COUNT
  o?: number; // fill opacity in percent (10-100); missing means 100
}
export interface Merge { r0: number; c0: number; r1: number; c1: number }
export interface SheetData {
  rows: number;
  cols: number;
  cells: Record<string, Cell>;
  colW: number[];
  merges: Merge[];
}
export interface Sel { ar: number; ac: number; fr: number; fc: number }
export interface Range { r0: number; c0: number; r1: number; c1: number }
export interface Sheet { name: string; data: SheetData; _sel?: Sel | null }
export interface Workbook { cur: number; sheets: Sheet[] }

export const MAXR = 1000;
export const MAXC = 60;
export const DW = 118;
export const LW = 140; // first column of a new tab: narrow enough that column B is visible on a 320px phone
export const MAX_TABS = 40;
export const FILL_COUNT = 8;
