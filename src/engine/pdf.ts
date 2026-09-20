import type { Cell, Merge, Sheet } from './types';
import { DW } from './types';
import { Evaluator } from './formula';
import { PDF_FILL } from './palette';

/* ---------- export to PDF (each page is drawn sharply, so any language or symbol prints correctly) ---------- */
const PG = { pw: 595.28, ph: 841.89, mx: 36, top: 58, bot: 40 };
const PDFK = 3;
const PFONT = '"Instrument Sans",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial,sans-serif';

interface Plan {
  sh: Sheet;
  si: number;
  pw: number;
  ph: number;
  empty?: boolean;
  s?: number;
  widths?: number[];
  c0?: number; c1?: number; r0?: number; r1?: number;
}

function planSheet(sh: Sheet, si: number): Plan[] {
  const D = sh.data;
  let mr = -1, mc = -1;
  for (const k in D.cells) {
    const q = k.split(',');
    mr = Math.max(mr, +q[0]);
    mc = Math.max(mc, +q[1]);
  }
  D.merges.forEach((m) => { mr = Math.max(mr, m.r1); mc = Math.max(mc, m.c1); });
  if (mr < 0) return [{ sh, si, empty: true, pw: PG.pw, ph: PG.ph }];
  const rows = mr + 1, cols = mc + 1, wd: number[] = [];
  let tw = 0;
  for (let c = 0; c < cols; c++) { const w = D.colW[c] || DW; wd.push(w); tw += w; }
  const cwP = PG.pw - 2 * PG.mx, cwL = PG.ph - 2 * PG.mx;
  let land = false, s = Math.min(0.9, cwP / tw);
  if (s < 0.7) { land = true; s = Math.max(Math.min(0.9, cwL / tw), 0.6); }
  const pw = land ? PG.ph : PG.pw, ph = land ? PG.pw : PG.ph, maxPx = (pw - 2 * PG.mx) / s;
  const groups: [number, number][] = [];
  let start = 0;
  while (start < cols) {
    let end = start, sum = 0;
    while (end < cols && (end === start || sum + wd[end] <= maxPx)) { sum += wd[end]; end++; }
    if (end < cols) {
      let e = end, ch = true;
      while (ch) { ch = false; D.merges.forEach((m) => { if (m.c0 < e && m.c1 >= e && m.c0 > start) { e = m.c0; ch = true; } }); }
      if (e > start) end = e;
    }
    groups.push([start, end - 1]);
    start = end;
  }
  const rowH = 28 * s, cap = Math.max(1, Math.floor((ph - PG.top - PG.bot) / rowH)), rp: [number, number][] = [];
  let rs = 0;
  while (rs < rows) {
    let re = Math.min(rs + cap, rows);
    if (re < rows) {
      let e2 = re, ch2 = true;
      while (ch2) { ch2 = false; D.merges.forEach((m) => { if (m.r0 < e2 && m.r1 >= e2 && m.r0 > rs) { e2 = m.r0; ch2 = true; } }); }
      if (e2 > rs) re = e2;
    }
    rp.push([rs, re - 1]);
    rs = re;
  }
  const plans: Plan[] = [];
  groups.forEach((g) => rp.forEach((r) => plans.push({ sh, si, pw, ph, s, widths: wd, c0: g[0], c1: g[1], r0: r[0], r1: r[1] })));
  return plans;
}

function fitText(g: CanvasRenderingContext2D, str: string, maxW: number): string {
  if (g.measureText(str).width <= maxW) return str;
  let t = str;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function wrapLines(g: CanvasRenderingContext2D, str: string, maxW: number, maxLines: number): string[] {
  const words = str.split(/\s+/), lines: string[] = [];
  let cur = '';
  words.forEach((w) => {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  let out = lines;
  if (out.length > maxLines) out = out.slice(0, Math.max(1, maxLines));
  return out.map((l) => fitText(g, l, maxW));
}

interface PageImg { pw: number; ph: number; w: number; h: number; jpg: Uint8Array }

function renderPdfPage(ev: Evaluator, pl: Plan, n: number, total: number): PageImg {
  const cv = document.createElement('canvas');
  cv.width = Math.round(pl.pw * PDFK);
  cv.height = Math.round(pl.ph * PDFK);
  const g = cv.getContext('2d')!;
  g.setTransform(PDFK, 0, 0, PDFK, 0, 0);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, pl.pw, pl.ph);
  g.textBaseline = 'middle';
  // header and footer
  g.fillStyle = '#1D6B67'; g.textAlign = 'left'; g.font = '600 12px ' + PFONT;
  g.fillText(fitText(g, 'Household ledger  –  ' + pl.sh.name, pl.pw - 2 * PG.mx - 110), PG.mx, 30);
  g.fillStyle = '#5A6E73'; g.textAlign = 'right'; g.font = '400 10px ' + PFONT;
  g.fillText(new Date().toLocaleDateString(), pl.pw - PG.mx, 30);
  g.strokeStyle = '#D0DAD8'; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(PG.mx, 42); g.lineTo(pl.pw - PG.mx, 42); g.stroke();
  g.textAlign = 'center'; g.fillText('Page ' + n + ' of ' + total, pl.pw / 2, pl.ph - 22);
  if (pl.empty) {
    g.fillStyle = '#5A6E73'; g.textAlign = 'left'; g.font = '400 12px ' + PFONT;
    g.fillText('This tab is empty.', PG.mx, PG.top + 10);
  } else {
    const s = pl.s!, D = pl.sh.data, x0 = PG.mx, y0 = PG.top, rowH = 28 * s, cx = [x0];
    for (let c = pl.c0!; c <= pl.c1!; c++) cx.push(cx[cx.length - 1] + pl.widths![c] * s);
    const cover2 = new Map<string, Merge>();
    D.merges.forEach((m) => {
      if (m.r0 >= pl.r0! && m.r1 <= pl.r1! && m.c0 >= pl.c0! && m.c1 <= pl.c1!)
        for (let a = m.r0; a <= m.r1; a++) for (let b = m.c0; b <= m.c1; b++) cover2.set(a + ',' + b, m);
    });
    const items: { r: number; c: number; x: number; y: number; w: number; h: number; merged: boolean; cell?: Cell }[] = [];
    for (let r = pl.r0!; r <= pl.r1!; r++)
      for (let c = pl.c0!; c <= pl.c1!; c++) {
        const m = cover2.get(r + ',' + c);
        if (m && !(m.r0 === r && m.c0 === c)) continue;
        const x = cx[c - pl.c0!], y = y0 + (r - pl.r0!) * rowH;
        items.push({ r, c, x, y, w: cx[(m ? m.c1 : c) - pl.c0! + 1] - x, h: ((m ? m.r1 : r) - r + 1) * rowH, merged: !!m, cell: D.cells[r + ',' + c] });
      }
    items.forEach((it) => {
      if (it.cell && it.cell.f) {
        g.globalAlpha = (it.cell.o ?? 100) / 100; // fill opacity chosen on screen
        g.fillStyle = PDF_FILL[it.cell.f];
        g.fillRect(it.x, it.y, it.w, it.h);
        g.globalAlpha = 1;
      }
    });
    // grid lines are drawn after the fills, so a coloured block never loses its borders
    g.strokeStyle = '#AEBBB9'; g.lineWidth = 0.6;
    items.forEach((it) => g.strokeRect(it.x, it.y, it.w, it.h));
    const pad = 7 * s, fs = 13 * s;
    items.forEach((it) => {
      const d = ev.display(pl.si, it.r, it.c);
      if (d.t === '') return;
      g.font = (it.cell && it.cell.b ? '600 ' : '400 ') + fs + 'px ' + PFONT;
      g.fillStyle = d.k === 'e' ? '#B3372B' : '#15232A';
      const maxW = it.w - 2 * pad;
      if (it.merged || d.k !== 'n') g.textAlign = it.merged ? 'center' : 'left';
      else g.textAlign = 'right';
      const tx = g.textAlign === 'center' ? it.x + it.w / 2 : g.textAlign === 'right' ? it.x + it.w - pad : it.x + pad;
      if (it.merged && it.h > rowH * 1.5) {
        const lh = fs * 1.3, lines = wrapLines(g, d.t, maxW, Math.floor((it.h - 4) / lh)), top = it.y + it.h / 2 - ((lines.length - 1) * lh) / 2;
        lines.forEach((ln, i) => g.fillText(ln, tx, top + i * lh));
      } else g.fillText(fitText(g, d.t, maxW), tx, it.y + it.h / 2 + 0.5);
    });
  }
  const b64 = cv.toDataURL('image/jpeg', 0.94).split(',')[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { pw: pl.pw, ph: pl.ph, w: cv.width, h: cv.height, jpg: bytes };
}

function makePdf(pages: PageImg[]): Blob {
  const enc = new TextEncoder(), chunks: BlobPart[] = [], offs: number[] = [];
  let len = 0;
  function push(x: string | Uint8Array) {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b as BlobPart);
    len += b.length;
  }
  function begin(n: number) { offs[n] = len; push(n + ' 0 obj\n'); }
  const f = (v: number) => v.toFixed(2);
  push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const kids = pages.map((_, i) => 3 + 3 * i + ' 0 R');
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2); push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>\nendobj\n');
  pages.forEach((pg, i) => {
    const po = 3 + 3 * i, co = 4 + 3 * i, io = 5 + 3 * i, content = 'q ' + f(pg.pw) + ' 0 0 ' + f(pg.ph) + ' 0 0 cm /Im0 Do Q';
    begin(po); push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pg.pw) + ' ' + f(pg.ph) + '] /Resources << /XObject << /Im0 ' + io + ' 0 R >> >> /Contents ' + co + ' 0 R >>\nendobj\n');
    begin(co); push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
    begin(io); push('<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpg.length + ' >>\nstream\n');
    push(pg.jpg); push('\nendstream\nendobj\n');
  });
  const total = 3 + 3 * pages.length, xr = len;
  let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let n = 1; n < total; n++) x += ('0000000000' + offs[n]).slice(-10) + ' 00000 n \n';
  push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n');
  return new Blob(chunks, { type: 'application/pdf' });
}

// list = the tabs to print (all of them, or just the current one); returns null when it would be too long
export async function buildPdf(allSheets: Sheet[], list: Sheet[]): Promise<{ blob: Blob; pages: number } | null> {
  const ev = new Evaluator(allSheets);
  const plans: Plan[] = [];
  list.forEach((sh) => planSheet(sh, allSheets.indexOf(sh)).forEach((pl) => plans.push(pl)));
  if (plans.length > 300) return null;
  if (document.fonts && document.fonts.load) {
    await Promise.race([document.fonts.load('600 13px "Instrument Sans"'), new Promise((r) => setTimeout(r, 1500))]);
  }
  const pages: PageImg[] = [];
  for (let i = 0; i < plans.length; i++) {
    await new Promise((r) => setTimeout(r, 0));
    pages.push(renderPdfPage(ev, plans[i], i + 1, plans.length));
  }
  return { blob: makePdf(pages), pages: plans.length };
}
