// Draws letters from the letter engine (letters.ts) as one PDF, one page per letter, on US Letter paper with the standard Times face.
// A character the face lacks is swapped for its plain letter, so an accent in a name never prints as a box.
import { PDFDocument, PrintScaling, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { LetterDoc } from './letters';

const PAGE = { w: 612, h: 792 };
const M = { left: 72, right: 72, top: 72 };
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.42);
const SIZE = 11.5;
const LEAD = 16;

function safe(text: string, has: Set<number>): string {
  let out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0)!;
    if (has.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const plain = [...base].filter((b) => has.has(b.codePointAt(0)!)).join('');
    out += plain || (ch === '’' || ch === '‘' ? "'" : ch === '“' || ch === '”' ? '"' : ch === '–' || ch === '—' ? '-' : ch.trim() === '' ? ' ' : '');
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (line && font.widthOfTextAtSize(t, size) > width) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function lettersPdf(letters: LetterDoc[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const has = new Set(body.getCharacterSet());
  doc.setTitle(title);
  doc.setAuthor('Favor International');
  doc.setCreator('Favor Hub');
  doc.setProducer('Favor Hub');
  const prefs = doc.catalog.getOrCreateViewerPreferences();
  prefs.setPrintScaling(PrintScaling.None);
  prefs.setDisplayDocTitle(true);
  const width = PAGE.w - M.left - M.right;

  for (const L of letters) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    let y = PAGE.h - M.top;
    const draw = (t: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {}): void => {
      page.drawText(safe(t, has), { x: o.x ?? M.left, y, size: o.size ?? SIZE, font: o.font ?? body, color: o.color ?? INK });
    };
    // Letterhead
    page.drawText('FAVOR INTERNATIONAL', { x: M.left, y, size: 10, font: bold, color: INK, characterSpacing: 2.2 });
    y -= 10;
    page.drawLine({ start: { x: M.left, y }, end: { x: PAGE.w - M.right, y }, thickness: 0.6, color: GREY });
    y -= 34;
    draw(L.dateLine);
    y -= LEAD * 2;
    for (const l of L.addressLines) {
      draw(l);
      y -= LEAD;
    }
    y -= LEAD;
    draw(L.greeting, { font: bold });
    y -= LEAD * 1.6;
    for (const p of L.paragraphs) {
      for (const line of wrap(safe(p, has), body, SIZE, width)) {
        draw(line);
        y -= LEAD;
      }
      y -= LEAD * 0.6;
    }
    y -= LEAD * 0.4;
    draw(L.closing);
    y -= LEAD * 3.4;
    page.drawLine({ start: { x: M.left, y: y + 6 }, end: { x: M.left + 190, y: y + 6 }, thickness: 0.6, color: INK });
    if (L.signerName) {
      draw(L.signerName);
      y -= LEAD;
    }
    if (L.signerTitle) draw(L.signerTitle, { color: GREY });
  }
  return doc.save();
}
