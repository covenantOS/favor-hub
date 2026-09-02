import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Env } from '../http';
import { fmtEt, money, type ExpenseItemRow, type ExpenseRow } from './db';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const INK = rgb(0.05, 0.06, 0.05);
const SOFT = rgb(0.42, 0.41, 0.37);
const RULE = rgb(0.8, 0.78, 0.72);
const CREAM = rgb(0.96, 0.94, 0.89);

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const idx = dataUrl.indexOf('base64,');
  if (idx < 0) return null;
  try {
    const bin = atob(dataUrl.slice(idx + 7));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildExpensePdf(env: Env, row: ExpenseRow, items: ExpenseItemRow[], origin: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${row.doc_number} Expense Request`);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let logo: PDFImage | null = null;
  try {
    const res = await env.ASSETS.fetch(new URL('/images/favor-primary.png', origin).toString());
    if (res.ok) logo = await doc.embedPng(await res.arrayBuffer());
  } catch {
    logo = null;
  }

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const width = PAGE_W - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };
  const text = (s: string, x: number, size: number, font: PDFFont, color = INK, p: PDFPage = page) =>
    p.drawText(s, { x, y, size, font, color });

  // Header: logo left, doc id right, heavy rule under.
  if (logo) {
    const h = 34;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: MARGIN, y: y - h + 6, width: w, height: h });
  }
  page.drawText('EXPENSE REQUEST', {
    x: PAGE_W - MARGIN - mono.widthOfTextAtSize('EXPENSE REQUEST', 8), y: y - 2, size: 8, font: mono, color: SOFT,
  });
  page.drawText(row.doc_number, {
    x: PAGE_W - MARGIN - mono.widthOfTextAtSize(row.doc_number, 9), y: y - 14, size: 9, font: mono, color: INK,
  });
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: INK });
  y -= 26;

  text('Expense Request', MARGIN, 18, bold);
  y -= 26;

  const metaRow = (label: string, value: string) => {
    ensure(16);
    text(label, MARGIN, 8.5, helv, SOFT);
    for (const line of wrap(value || '—', helv, 10, width - 130)) {
      text(line, MARGIN + 130, 10, helv);
      y -= 13;
    }
    y += 13 - 15;
  };
  metaRow('Name', row.requester_name);
  metaRow('Email', row.requester_email);
  metaRow('Dates', row.travel_dates || '—');
  metaRow('City / state', row.travel_city || '—');
  y -= 10;

  // Items table.
  const AMOUNT_X = PAGE_W - MARGIN;
  const ITEM_X = MARGIN + 300;
  ensure(20);
  text('DESCRIPTION', MARGIN, 7.5, mono, SOFT);
  text('ITEM', ITEM_X, 7.5, mono, SOFT);
  page.drawText('EST. AMOUNT', { x: AMOUNT_X - mono.widthOfTextAtSize('EST. AMOUNT', 7.5), y, size: 7.5, font: mono, color: SOFT });
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: RULE });
  y -= 14;
  for (const it of items) {
    const descLines = wrap(it.description || '—', helv, 9.5, ITEM_X - MARGIN - 12);
    const itemLines = wrap(it.item || '', helv, 9.5, AMOUNT_X - ITEM_X - 70);
    const rows = Math.max(descLines.length, itemLines.length, 1);
    ensure(rows * 12 + 8);
    const startY = y;
    for (let i = 0; i < descLines.length; i++) page.drawText(descLines[i], { x: MARGIN, y: startY - i * 12, size: 9.5, font: helv, color: INK });
    for (let i = 0; i < itemLines.length; i++) page.drawText(itemLines[i], { x: ITEM_X, y: startY - i * 12, size: 9.5, font: helv, color: SOFT });
    const amt = money(it.amount_cents);
    page.drawText(amt, { x: AMOUNT_X - mono.widthOfTextAtSize(amt, 9.5), y: startY, size: 9.5, font: mono, color: INK });
    y = startY - rows * 12 + 12;
    y -= 16;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 }, thickness: 0.4, color: RULE });
  }
  ensure(24);
  y -= 4;
  text('Total estimated', MARGIN, 10.5, bold);
  const total = money(row.total_cents);
  page.drawText(total, { x: AMOUNT_X - bold.widthOfTextAtSize(total, 12), y, size: 12, font: bold, color: INK });
  y -= 26;

  // Reason.
  ensure(30);
  text('Reason', MARGIN, 8.5, helv, SOFT);
  y -= 13;
  for (const line of wrap(row.reason, helv, 10, width)) {
    ensure(14);
    text(line, MARGIN, 10, helv);
    y -= 13;
  }
  y -= 6;
  ensure(16);
  text('The requester affirmed that all items above are accurate to the best of their knowledge.', MARGIN, 8.5, helv, SOFT);
  y -= 48; // leave room for the signature images, which draw upward from the baseline

  // Signatures side by side.
  const colW = (width - 24) / 2;
  const sigH = 34;
  ensure(sigH + 46);
  const sigTop = y;
  const drawSig = async (x: number, dataUrl: string | null, who: string, role: string, when: string | null) => {
    if (dataUrl) {
      const bytes = dataUrlToBytes(dataUrl);
      if (bytes) {
        try {
          const img = await doc.embedPng(bytes);
          const h = sigH;
          const w = Math.min((img.width / img.height) * h, colW);
          page.drawImage(img, { x, y: sigTop, width: w, height: h });
        } catch {
          /* skip broken signature image */
        }
      }
    }
    page.drawLine({ start: { x, y: sigTop - 6 }, end: { x: x + colW, y: sigTop - 6 }, thickness: 0.8, color: INK });
    page.drawText(`${who} · ${role}`, { x, y: sigTop - 18, size: 9, font: bold, color: INK });
    if (when) page.drawText(`Signed ${when}`, { x, y: sigTop - 30, size: 7.5, font: mono, color: SOFT });
  };
  await drawSig(MARGIN, row.requester_signature, row.requester_name, 'Requester', fmtEt(row.submitted_at));
  await drawSig(MARGIN + colW + 24, row.approver_signature, row.approver_name, 'Approver', row.decided_at ? fmtEt(row.decided_at) : null);
  y = sigTop - 52;

  // Audit trail.
  const audit = [
    `${fmtEt(row.submitted_at)} · Submitted by ${row.requester_name} (${row.requester_email})${row.requester_ip ? ` · IP ${row.requester_ip}` : ''}`,
    `${fmtEt(row.submitted_at)} · Approver resolved to ${row.approver_name} (${row.approver_email}) · notification sent`,
  ];
  if (row.decided_at) {
    audit.push(
      `${fmtEt(row.decided_at)} · ${row.status === 'approved' ? 'Approved and signed' : 'Declined'} by ${row.approver_name} (${row.approver_email})${row.approver_ip ? ` · IP ${row.approver_ip}` : ''}`
    );
  }
  const auditLines = audit.flatMap((line) => wrap(line, mono, 7, width - 24));
  const boxH = auditLines.length * 10 + 26;
  ensure(boxH + 10);
  page.drawRectangle({ x: MARGIN, y: y - boxH + 10, width, height: boxH, color: CREAM });
  page.drawText('AUDIT TRAIL', { x: MARGIN + 12, y: y - 6, size: 7, font: mono, color: SOFT });
  let ay = y - 18;
  for (const line of auditLines) {
    page.drawText(line, { x: MARGIN + 12, y: ay, size: 7, font: mono, color: INK });
    ay -= 10;
  }

  return doc.save();
}
