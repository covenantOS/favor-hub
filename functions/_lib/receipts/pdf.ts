// Prints the changing part of a thank-you receipt onto the pre-printed legal
// sheet: the receipt lines and mailing address in the top panel, the letter
// in the middle, the reply slip at the bottom. One page per letter, and a
// partner's gifts share one letter.
//
// Every position below was measured from the last archived InDesign batch
// (2025-10-03), so a sheet printed here lands where the old ones did. The
// fonts travel inside the file. The old templates named a font that ships
// only with macOS, which is why they printed as scrambled characters on a
// Windows computer.

import fontkit from '@pdf-lib/fontkit';
import { Duplex, PDFDocument, PrintScaling, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { LetterCopy } from './letter';
import { longDate, money, shortDate, type Letter } from './rules';

export const PAGE = { width: 612, height: 1008 };

const INK = rgb(0.1, 0.1, 0.1);
const SANS = 12;
const MONO = 12;
const LEADING = 14;

// Top panel: the receipt the partner tears off and keeps.
const RECEIPT = { x: 42.2, first: 70.5, step: 15, maxWidth: 390 };
// Four lines in the band the usual three use (66 to 102), for a letter whose gifts need two rows.
const RECEIPT_TIGHT = { first: 66, step: 12, size: 10.5 };
const GIFTS_LABEL = 'Gifts: ';
// The pre-printed "No goods or services" note starts at x 412, level with the first receipt line.
const GIFTS_WIDTH = 355;
// The mailing address. It shows through the envelope window.
const ADDRESS = { x: 48, first: 151, step: 14.4, maxWidth: 300 };
// The letter.
const BODY = { left: 54.3, indent: 36, columns: 68, date: { x: 291.9, y: 281 }, greeting: 309, first: 337 };
/** The pre-printed disclosure paragraph starts here. The signature block must end above it. */
const BODY_FLOOR = 688;
const SIGN = { x: 291.9, image: { x: 276.1, dy: -6.1, width: 161.7, height: 55.7 }, name: 42, title: 56 };
// Bottom panel: the slip that comes back with the next gift.
const SLIP = {
  hint: { x: 475.2, y: 841 },
  row: { x: 75.6, y: 880.5, step: 80, box: 9.2 },
  writeIn: { x: 472, y: 841, line: 62 },
  address: { x: 75.6, first: 916, step: 14.4, maxWidth: 200 },
  code: { x: 300 },
};

export interface Fonts {
  mono: Uint8Array;
  monoBold: Uint8Array;
  sans: Uint8Array;
}

export interface PdfInput {
  letters: Letter[];
  /** YYYY-MM-DD printed at the top of each letter. */
  letterDate: string;
  appealCode: string;
  copy: LetterCopy;
  fonts: Fonts;
  /** PNG of the signature. Left out, the letter prints the name alone. */
  signature?: Uint8Array;
  /** JPEG of the pre-printed sheet, drawn underneath for an on-screen proof. Never set for the print file. */
  paper?: Uint8Array;
  title?: string;
}

interface Run {
  text: string;
  bold: boolean;
}

/** "**Thank you** so much" to words that know whether they are bold. */
function words(paragraph: string): Run[] {
  const out: Run[] = [];
  paragraph.split('**').forEach((piece, i) => {
    for (const w of piece.split(/\s+/).filter(Boolean)) out.push({ text: w, bold: i % 2 === 1 });
  });
  return out;
}

/** Fill lines of a fixed number of characters. The letter face is monospaced, so counting is measuring. */
function wrap(runs: Run[], first: number, rest: number): Run[][] {
  const lines: Run[][] = [[]];
  let used = 0;
  let limit = first;
  for (const run of runs) {
    const need = (used > 0 ? 1 : 0) + run.text.length;
    if (used > 0 && used + need > limit) {
      lines.push([]);
      used = 0;
      limit = rest;
    }
    lines[lines.length - 1].push(run);
    used += (used > 0 ? 1 : 0) + run.text.length;
  }
  // A paragraph should not end on one stranded word.
  const last = lines[lines.length - 1];
  const before = lines[lines.length - 2];
  if (before && last.length === 1 && before.length > 3) last.unshift(before.pop()!);
  return lines;
}

/** How many lines the letter takes with this copy, and whether it clears the pre-printed text below it. */
export function measure(copy: LetterCopy, amount = 1000): { lines: number; bottom: number; fits: boolean } {
  let y = BODY.first;
  let lines = 0;
  for (const p of copy.paragraphs) {
    const n = wrap(words(p.replace('{amount}', money(amount))), BODY.columns - 5, BODY.columns).length;
    lines += n;
    y += n * LEADING + LEADING;
  }
  const closing = y + LEADING;
  const bottom = closing + SIGN.title + 4;
  return { lines, bottom, fits: bottom <= BODY_FLOOR };
}

function supported(font: PDFFont): Set<number> {
  return new Set(font.getCharacterSet());
}

/** Swap a character the font lacks for its plain letter, so a name with an accent never prints as a box. */
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

/** "Gifts: 9/6/2026 $150.00, 9/25/2026 $50.00," then the rest, split where the receipt runs out of width. */
function giftRows(items: string[], font: PDFFont, size: number, maxWidth: number): string[] {
  const room = (row: number) => maxWidth - (row === 0 ? 0 : font.widthOfTextAtSize(GIFTS_LABEL, size));
  const rows: string[][] = [[]];
  for (const item of items) {
    const row = rows[rows.length - 1];
    const text = `${rows.length === 1 ? GIFTS_LABEL : ''}${[...row, item].join(', ')},`;
    if (row.length && font.widthOfTextAtSize(text, size) > room(rows.length - 1)) rows.push([item]);
    else row.push(item);
  }
  return rows.map((row, i) => `${i === 0 ? GIFTS_LABEL : ''}${row.join(', ')}${i < rows.length - 1 ? ',' : ''}`);
}

function fitSize(font: PDFFont, text: string, size: number, maxWidth: number, floor = 8.5): number {
  let s = size;
  while (s > floor && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}

export async function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const mono = await doc.embedFont(input.fonts.mono, { subset: true });
  const monoBold = await doc.embedFont(input.fonts.monoBold, { subset: true });
  const sans = await doc.embedFont(input.fonts.sans, { subset: true });
  const has = { mono: supported(mono), sans: supported(sans) };
  const signature: PDFImage | null = input.signature ? await doc.embedPng(input.signature) : null;
  const paper: PDFImage | null = input.paper ? await doc.embedJpg(input.paper) : null;
  const charWidth = mono.widthOfTextAtSize('M', MONO);
  const dateLine = longDate(input.letterDate);

  const title = input.title || `Thank-you receipts, ${dateLine}`;
  doc.setTitle(title);
  doc.setAuthor('Favor International');
  doc.setSubject(`${input.letters.length} receipts, reply code ${input.appealCode}`);
  doc.setCreator('Favor Hub');
  doc.setProducer('Favor Hub');
  // Ask the print dialog for actual size, one side, and the tray that holds legal paper.
  const prefs = doc.catalog.getOrCreateViewerPreferences();
  prefs.setPrintScaling(PrintScaling.None);
  prefs.setDuplex(Duplex.Simplex);
  prefs.setPickTrayByPDFSize(true);
  prefs.setDisplayDocTitle(true);

  for (const letter of input.letters) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    if (paper) page.drawImage(paper, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });
    const at = (y: number): number => PAGE.height - y;
    const sansLine = (text: string, x: number, y: number, maxWidth: number, size = SANS): void => {
      const t = safe(text, has.sans);
      page.drawText(t, { x, y: at(y), size: fitSize(sans, t, size, maxWidth), font: sans, color: INK });
    };
    const monoLine = (runs: Run[], x: number, y: number): void => {
      // Neighbouring words of one weight go down as one string.
      let cx = x;
      let i = 0;
      while (i < runs.length) {
        let j = i;
        const parts: string[] = [];
        while (j < runs.length && runs[j].bold === runs[i].bold) parts.push(safe(runs[j++].text, has.mono));
        const t = parts.join(' ');
        page.drawText(t, { x: cx, y: at(y), size: MONO, font: runs[i].bold ? monoBold : mono, color: INK });
        cx += (t.length + 1) * charWidth;
        i = j;
      }
    };

    // Receipt lines. A letter that covers several gifts lists each one's date and amount.
    const gifts = letter.gifts && letter.gifts.length ? letter.gifts : [{ date: letter.giftDate, amount: letter.amount }];
    const several = gifts.length > 1;
    const tail = [`Total Gift Amount: ${money(letter.amount)}`, ...(letter.fund ? [`Designation: ${letter.fund}`] : [])];
    const items = gifts.map((x) => `${shortDate(x.date)} ${money(x.amount)}`);
    const rows = several ? giftRows(items, sans, RECEIPT_TIGHT.size, GIFTS_WIDTH) : [];
    if (!several) {
      [`Date of Gift: ${shortDate(letter.giftDate)}`, ...tail].forEach((line, i) => sansLine(line, RECEIPT.x, RECEIPT.first + i * RECEIPT.step, RECEIPT.maxWidth));
    } else if (sans.widthOfTextAtSize(`${GIFTS_LABEL}${items.join(', ')}`, SANS) <= GIFTS_WIDTH) {
      [`${GIFTS_LABEL}${items.join(', ')}`, ...tail].forEach((line, i) => sansLine(line, RECEIPT.x, RECEIPT.first + i * RECEIPT.step, RECEIPT.maxWidth));
    } else if (rows.length <= 2) {
      // Gifts a size smaller, in one or two rows, inside the same band, so nothing reaches the envelope window.
      const indent = sans.widthOfTextAtSize(GIFTS_LABEL, RECEIPT_TIGHT.size);
      const lines = [
        ...rows.map((text, i) => ({ text, x: i === 0 ? RECEIPT.x : RECEIPT.x + indent, width: GIFTS_WIDTH - (i === 0 ? 0 : indent) })),
        ...tail.map((text) => ({ text, x: RECEIPT.x, width: RECEIPT.maxWidth })),
      ];
      lines.forEach((l, i) => sansLine(l.text, l.x, RECEIPT_TIGHT.first + i * RECEIPT_TIGHT.step, l.width, RECEIPT_TIGHT.size));
    } else {
      const span = `${GIFTS_LABEL}${gifts.length} gifts from ${shortDate(gifts[0].date)} to ${shortDate(gifts[gifts.length - 1].date)}`;
      [span, ...tail].forEach((line, i) => sansLine(line, RECEIPT.x, RECEIPT.first + i * RECEIPT.step, RECEIPT.maxWidth));
    }

    // Mailing address, then the same block on the reply slip.
    const address = [letter.addressee, ...letter.addressLines, letter.cityLine];
    address.forEach((line, i) => sansLine(line, ADDRESS.x, ADDRESS.first + i * ADDRESS.step, ADDRESS.maxWidth));
    address.forEach((line, i) => sansLine(line, SLIP.address.x, SLIP.address.first + i * SLIP.address.step, SLIP.address.maxWidth));
    const lastSlipLine = SLIP.address.first + (address.length - 1) * SLIP.address.step;
    sansLine(input.appealCode, SLIP.code.x, lastSlipLine, 120);

    // The letter.
    monoLine([{ text: dateLine, bold: false }], BODY.date.x, BODY.date.y);
    const greeting = input.copy.greeting === 'first' ? letter.greetingFirst : letter.greetingFull;
    monoLine([{ text: `Dear ${greeting},`, bold: false }], BODY.left, BODY.greeting);
    let y = BODY.first;
    for (const paragraph of input.copy.paragraphs) {
      // "your generous gift of $200.00" reads "your generous gifts totaling $200.00" when the letter covers several.
      const said = several ? paragraph.replace(/\bgift of \{amount\}/i, 'gifts totaling {amount}') : paragraph;
      const lines = wrap(words(said.replace('{amount}', money(letter.amount))), BODY.columns - 5, BODY.columns);
      lines.forEach((line, i) => {
        monoLine(line, BODY.left + (i === 0 ? BODY.indent : 0), y);
        y += LEADING;
      });
      y += LEADING;
    }
    const closing = y + LEADING;
    monoLine([{ text: input.copy.closing, bold: false }], SIGN.x, closing);
    if (signature) {
      page.drawImage(signature, {
        x: SIGN.image.x,
        y: at(closing + SIGN.image.dy + SIGN.image.height),
        width: SIGN.image.width,
        height: SIGN.image.height,
      });
    }
    monoLine([{ text: input.copy.signerName, bold: false }], SIGN.x, closing + SIGN.name);
    monoLine([{ text: input.copy.signerTitle, bold: false }], SIGN.x, closing + SIGN.title);

    // Reply slip. A monthly partner writes an amount in; everyone else gets four boxes and a blank.
    const blank = (x: number, baseline: number): void => {
      page.drawText('$', { x, y: at(baseline), size: SANS, font: sans, color: INK });
      page.drawLine({ start: { x: x + 8, y: at(baseline + 1.5) }, end: { x: x + 8 + SLIP.writeIn.line, y: at(baseline + 1.5) }, thickness: 0.6, color: INK });
    };
    if (letter.segment === 'recurring') {
      blank(SLIP.writeIn.x, SLIP.writeIn.y);
    } else {
      page.drawText('(check gift amount)', { x: SLIP.hint.x, y: at(SLIP.hint.y), size: SANS, font: sans, color: INK });
      const asks = letter.segment === 'major' ? input.copy.asks.major : input.copy.asks.regular;
      const box = (x: number): void => {
        page.drawRectangle({ x, y: at(SLIP.row.y + 0.6), width: SLIP.row.box, height: SLIP.row.box, borderWidth: 0.6, borderColor: INK });
      };
      asks.forEach((ask, i) => {
        const x = SLIP.row.x + i * SLIP.row.step;
        box(x);
        page.drawText(`$${ask.toLocaleString('en-US')}`, { x: x + SLIP.row.box + 5, y: at(SLIP.row.y), size: SANS, font: sans, color: INK });
      });
      const x = SLIP.row.x + asks.length * SLIP.row.step;
      box(x);
      blank(x + SLIP.row.box + 5, SLIP.row.y);
    }
  }

  return doc.save();
}
