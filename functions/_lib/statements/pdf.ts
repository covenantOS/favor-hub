// Prints giving statements on Favor's letterhead layout: logo and mailing address at the top, the partner's name and
// address where a window envelope shows it, a table of gifts, the totals, the tax language, and the letterhead
// footer line on every page. Letter size, one statement after another in one file, so a batch prints in one go.
// The fonts travel inside the file (the same Arimo the receipts use), so a partner's accented name never prints as a box.

import fontkit from '@pdf-lib/fontkit';
import { Duplex, PDFDocument, PrintScaling, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { fill, type StatementCopy } from './copy';
import { longDate, moneyOf, periodLabel, shortDate, type Line, type Statement } from './rules';

export const PAGE = { width: 612, height: 792 };
const M = { left: 54, right: 54, top: 48, bottom: 66 };
const INK = rgb(0.1, 0.1, 0.1);
const MUTE = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.75, 0.75, 0.75);
const GREEN = rgb(0.13, 0.34, 0.22);
const BODY = 10;
const SMALL = 8.5;
const LEAD = 13;
/** Where a double-window envelope shows the address. */
const WINDOW = { x: 54, first: 150, step: 13 };
const COLS = { date: 54, fund: 122, type: 392, amount: 558 };

export interface Fonts {
  sans: Uint8Array;
}

export interface PdfInput {
  statements: Statement[];
  copy: StatementCopy;
  yearEnd: boolean;
  /** YYYY-MM-DD printed as the statement date. */
  issued: string;
  fonts: Fonts;
  /** PNG of the Favor logo. Left out, the header prints the name in type. */
  logo?: Uint8Array;
  title?: string;
}

function supported(font: PDFFont): Set<number> {
  return new Set(font.getCharacterSet());
}

/** Swap a character the font lacks for its plain letter. */
export function safe(text: string, has: Set<number>): string {
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

function wrapWords(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const sans = await doc.embedFont(input.fonts.sans, { subset: true });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const has = supported(sans);
  const hasBold = new Set<number>();
  for (let c = 32; c < 127; c++) hasBold.add(c);
  const logo: PDFImage | null = input.logo ? await doc.embedPng(input.logo) : null;

  const title = input.title || `${input.yearEnd ? input.copy.titleYearEnd : input.copy.title}`;
  doc.setTitle(title);
  doc.setAuthor('Favor International');
  doc.setSubject(`${input.statements.length} statement${input.statements.length === 1 ? '' : 's'}`);
  doc.setCreator('Favor Hub');
  doc.setProducer('Favor Hub');
  const prefs = doc.catalog.getOrCreateViewerPreferences();
  prefs.setPrintScaling(PrintScaling.None);
  prefs.setDuplex(Duplex.Simplex);
  prefs.setDisplayDocTitle(true);

  const width = PAGE.width - M.left - M.right;

  for (const st of input.statements) {
    const pages: PDFPage[] = [];
    let page!: PDFPage;
    let y = 0; // distance from the top of the page
    const at = (top: number): number => PAGE.height - top;

    const text = (t: string, x: number, top: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: boolean; max?: number } = {}): void => {
      const size = o.size ?? BODY;
      const font = o.bold ? bold : sans;
      let s = safe(t, o.bold ? hasBold : has);
      if (o.max) while (s.length > 1 && font.widthOfTextAtSize(s, size) > o.max) s = s.slice(0, -2) + '.';
      const w = font.widthOfTextAtSize(s, size);
      page.drawText(s, { x: o.right ? x - w : x, y: at(top), size, font, color: o.color ?? INK });
    };
    const rule = (top: number, color = RULE): void => {
      page.drawLine({ start: { x: M.left, y: at(top) }, end: { x: PAGE.width - M.right, y: at(top) }, thickness: 0.6, color });
    };
    const paragraph = (t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}): void => {
      const size = o.size ?? BODY;
      const font = o.bold ? bold : sans;
      const lines = wrapWords(safe(t, o.bold ? hasBold : has), font, size, width);
      for (const l of lines) {
        need(LEAD);
        text(l, M.left, y, { size, bold: o.bold, color: o.color });
        y += size + 3.5;
      }
      y += o.gap ?? 6;
    };

    const header = (first: boolean): void => {
      page = doc.addPage([PAGE.width, PAGE.height]);
      pages.push(page);
      y = M.top;
      if (logo) {
        const h = first ? 44 : 28;
        const w = (logo.width / logo.height) * h;
        page.drawImage(logo, { x: M.left, y: at(y + h), width: w, height: h });
      } else {
        text('Favor International', M.left, y + 22, { size: first ? 18 : 12, bold: true, color: GREEN });
      }
      if (first) {
        text('3433 Lithia Pinecrest Rd #356', PAGE.width - M.right, y + 10, { size: SMALL, color: MUTE, right: true });
        text('Valrico, FL 33596', PAGE.width - M.right, y + 21, { size: SMALL, color: MUTE, right: true });
        text('941-444-9940   favorintl.org', PAGE.width - M.right, y + 32, { size: SMALL, color: MUTE, right: true });
        y = 104;
      } else {
        text(`${st.partner.addressee}, ${periodLabel(st.from, st.to)}`, PAGE.width - M.right, y + 18, { size: SMALL, color: MUTE, right: true, max: 330 });
        y = M.top + 40;
        rule(y - 6);
      }
    };
    const need = (h: number): void => {
      if (y + h > PAGE.height - M.bottom) header(false);
    };

    // First page: title, the address in the window, the opening line.
    header(true);
    const period = periodLabel(st.from, st.to);
    const vars = { from: longDate(st.from), to: longDate(st.to), period, year: st.from.slice(0, 4) };
    text(input.yearEnd ? input.copy.titleYearEnd : input.copy.title, M.left, y + 6, { size: 15, bold: true, color: GREEN });
    text(period, PAGE.width - M.right, y + 6, { size: 11, bold: true, right: true });
    text(`Statement date ${longDate(input.issued)}`, PAGE.width - M.right, y + 20, { size: SMALL, color: MUTE, right: true });
    text(`Partner ID ${st.partner.lookup}`, PAGE.width - M.right, y + 31, { size: SMALL, color: MUTE, right: true });

    const p = st.partner;
    const cityLine = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const address = [p.addressee, ...p.addressLines, cityLine, p.country && !/^(united states|usa|us)$/i.test(p.country) ? p.country : ''].filter(Boolean);
    address.slice(0, 7).forEach((line, i) => text(line, WINDOW.x, WINDOW.first + i * WINDOW.step, { size: 10.5, max: 300 }));
    y = Math.max(WINDOW.first + 7 * WINDOW.step + 10, 244);

    paragraph(fill(input.copy.intro, vars), { gap: 10 });

    const tableHead = (label: string): void => {
      need(LEAD * 4);
      text(label, COLS.date, y, { size: 10, bold: true, color: GREEN });
      y += 8;
      rule(y);
      y += 11;
      text('Date', COLS.date, y, { size: SMALL, bold: true, color: MUTE });
      text('Designation', COLS.fund, y, { size: SMALL, bold: true, color: MUTE });
      text('Type', COLS.type, y, { size: SMALL, bold: true, color: MUTE });
      text('Amount', COLS.amount, y, { size: SMALL, bold: true, color: MUTE, right: true });
      y += 5;
      rule(y);
      y += 12;
    };
    const rows = (lines: Line[], opt: { from?: boolean } = {}): void => {
      for (const l of lines) {
        const fund = (opt.from && l.from ? `${l.from}: ` : '') + (l.fund || 'Where Needed Most');
        const mark = l.flags.includes('noncash') ? ' *' : '';
        const wrapped = wrapWords(safe(fund, has), sans, 9.5, COLS.type - COLS.fund - 10);
        const h = Math.max(1, wrapped.length) * 12 + 2;
        if (y + h > PAGE.height - M.bottom) {
          header(false);
          tableHead('Gifts, continued');
        }
        text(shortDate(l.date), COLS.date, y, { size: 9.5 });
        wrapped.forEach((w, i) => text(w, COLS.fund, y + i * 12, { size: 9.5 }));
        text(l.kind, COLS.type, y, { size: 9.5, color: MUTE });
        text(moneyOf(l.cents) + mark, COLS.amount, y, { size: 9.5, right: true });
        y += h;
      }
    };
    const totalRow = (label: string, c: number, strong = false): void => {
      need(LEAD + 6);
      rule(y - 8);
      text(label, COLS.date, y + 2, { size: strong ? 10.5 : 9.5, bold: strong });
      text(moneyOf(c), COLS.amount, y + 2, { size: strong ? 10.5 : 9.5, bold: strong, right: true });
      y += LEAD + 4;
    };

    if (st.gifts.length === 0 && st.refunds.length === 0) {
      paragraph('No gifts are recorded on this partner for the period.', { gap: 8 });
    } else {
      tableHead('Gifts');
      rows(st.gifts);
      totalRow(`Total gifts${st.totals.giftCount ? `, ${st.totals.giftCount} ${st.totals.giftCount === 1 ? 'gift' : 'gifts'}` : ''}`, st.totals.gifts, st.refunds.length === 0);
      if (st.refunds.length) {
        y += 8;
        tableHead('Refunds and returned gifts');
        rows(st.refunds);
        totalRow('Net total', st.totals.net, true);
      }
    }
    y += 10;

    paragraph(fill(input.copy.goods, vars), { bold: true, gap: 4 });
    paragraph(fill(input.copy.tax, vars), { size: 9, color: MUTE, gap: 8 });
    if (st.refunds.length) paragraph(fill(input.copy.refund, vars), { size: 9, color: MUTE });
    if (st.gifts.some((l) => l.flags.includes('noncash'))) paragraph(fill(input.copy.noncash, vars), { size: 9, color: MUTE });

    if (st.notDeductible.length) {
      y += 4;
      tableHead('Payments that are not tax-deductible');
      rows(st.notDeductible);
      totalRow('Total, not counted above', st.totals.notDeductible);
      paragraph(fill(input.copy.notDeductible, vars), { size: 9, color: MUTE });
    }
    if (st.soft.length) {
      y += 4;
      tableHead('Gifts made through a fund or foundation');
      rows(st.soft, { from: true });
      totalRow('Total, not counted above', st.totals.soft);
      paragraph(fill(input.copy.soft, vars), { size: 9, color: MUTE });
    }

    need(LEAD * 5);
    y += 6;
    paragraph(fill(input.copy.contact, vars), { gap: 10 });
    text(input.copy.closing, M.left, y, {});
    y += 18;
    text(input.copy.signer, M.left, y, { bold: true });
    if (input.copy.signerTitle) {
      y += 13;
      text(input.copy.signerTitle, M.left, y, {});
    }

    // Footer and page numbers, now that the number of pages is known.
    pages.forEach((pg, i) => {
      page = pg;
      rule(PAGE.height - 50);
      text(input.copy.footer, PAGE.width / 2 - Math.min(sans.widthOfTextAtSize(safe(input.copy.footer, has), SMALL), width) / 2, PAGE.height - 38, { size: SMALL, color: MUTE, max: width });
      if (pages.length > 1) text(`Page ${i + 1} of ${pages.length}`, PAGE.width - M.right, PAGE.height - 26, { size: SMALL, color: MUTE, right: true });
    });
  }

  if (input.statements.length === 0) {
    const pg = doc.addPage([PAGE.width, PAGE.height]);
    pg.drawText('No statements.', { x: M.left, y: PAGE.height - 100, size: 12, font: sans });
  }
  return doc.save();
}
