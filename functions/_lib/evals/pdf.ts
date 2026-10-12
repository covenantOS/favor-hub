// The evaluation document as a PDF (letter size). The font travels inside the file, so a name with an accent never prints as a box.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { EvalDoc } from './doc';

const W = 612;
const H = 792;
const M = { l: 54, r: 54, t: 56, b: 60 };
const INK = rgb(0.11, 0.13, 0.11);
const MUTE = rgb(0.4, 0.4, 0.36);
const RULE = rgb(0.8, 0.78, 0.7);
const GREEN = rgb(0.17, 0.3, 0.14);

function safe(text: string, has: Set<number>): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (has.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const plain = [...base].filter((b) => has.has(b.codePointAt(0)!)).join('');
    out += plain || (ch === '’' || ch === '‘' ? "'" : ch === '“' || ch === '”' ? '"' : ch.trim() === '' ? ' ' : '?');
  }
  return out;
}

/** Wraps to a width and breaks a word that is wider than the line. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (font.widthOfTextAtSize(w, size) > width) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export async function evalPdf(d: EvalDoc, fontBytes: Uint8Array, logo?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const sans = await doc.embedFont(fontBytes, { subset: true });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const has = new Set(sans.getCharacterSet());
  const hasB = new Set(bold.getCharacterSet());
  doc.setTitle(d.title);
  doc.setAuthor('Favor International');
  const logoImg = logo ? await doc.embedPng(logo).catch(() => null) : null;
  const pages: PDFPage[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = M.t;
  const width = W - M.l - M.r;
  const at = (top: number) => H - top;
  const need = (h: number) => {
    if (y + h > H - M.b) {
      page = doc.addPage([W, H]);
      pages.push(page);
      y = M.t;
    }
  };
  const line = (t: string, x: number, top: number, size: number, b = false, color = INK) => {
    page.drawText(safe(t, b ? hasB : has), { x, y: at(top), size, font: b ? bold : sans, color });
  };
  const para = (t: string, size = 10, b = false, color = INK, gap = 5, x = M.l, w = width) => {
    for (const l of wrap(safe(t, b ? hasB : has), b ? bold : sans, size, w)) {
      need(size + 4);
      line(l, x, y, size, b, color);
      y += size + 3.5;
    }
    y += gap;
  };

  if (logoImg) {
    const s = logoImg.scale(0.18);
    page.drawImage(logoImg, { x: M.l, y: at(y + s.height), width: s.width, height: s.height });
    y += s.height + 14;
  }
  para(d.title, 18, true, GREEN, 4);
  para(d.status, 9, false, MUTE, 8);
  for (const [k, v] of d.meta) {
    need(16);
    line(k, M.l, y, 9.5, true, MUTE);
    line(v, M.l + 130, y, 10.5);
    y += 16;
  }
  y += 6;

  for (const s of d.sections) {
    need(40);
    y += 8;
    para(s.heading, 13, true, GREEN, 3);
    page.drawLine({ start: { x: M.l, y: at(y - 2) }, end: { x: W - M.r, y: at(y - 2) }, thickness: 0.6, color: RULE });
    y += 6;
    for (const p of s.paras || []) para(p, 10, false, INK, 6);
    for (const x of s.qa || []) {
      para(x.q, 9.5, true, INK, 1);
      para(x.a, 10, false, INK, 8);
    }
    if (s.table) {
      const cols = s.table.head.length;
      // Wide text columns get more room than short number columns.
      const weight = s.table.head.map((_, i) => Math.max(6, Math.min(40, Math.max(...[s.table!.head[i], ...s.table!.rows.map((r) => r[i] || '')].map((c) => c.length)))));
      const total = weight.reduce((a, b) => a + b, 0);
      const widths = weight.map((x) => Math.max(46, (x / total) * width));
      const scale = width / widths.reduce((a, b) => a + b, 0);
      const cw = widths.map((x) => x * scale);
      const xs = cw.map((_, i) => M.l + cw.slice(0, i).reduce((a, b) => a + b, 0));
      need(26);
      s.table.head.forEach((h, i) => line(h, xs[i] + 2, y, 8.5, true, MUTE));
      y += 12;
      page.drawLine({ start: { x: M.l, y: at(y - 3) }, end: { x: W - M.r, y: at(y - 3) }, thickness: 0.6, color: RULE });
      for (const r of s.table.rows) {
        const cells = r.map((c, i) => wrap(safe(c || '', has), sans, 9, cw[i] - 6));
        const h = Math.max(...cells.map((c) => c.length)) * 11.5 + 6;
        need(h);
        cells.forEach((c, i) => c.forEach((l, k) => line(l, xs[i] + 2, y + k * 11.5, 9)));
        y += h;
        page.drawLine({ start: { x: M.l, y: at(y - 3) }, end: { x: W - M.r, y: at(y - 3) }, thickness: 0.3, color: RULE });
      }
      y += 6;
      void cols;
    }
  }
  pages.forEach((p, i) => {
    p.drawText(`${d.title}    Page ${i + 1} of ${pages.length}`, { x: M.l, y: 30, size: 8, font: sans, color: MUTE });
  });
  return doc.save();
}
