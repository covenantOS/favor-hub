// Batches, the letter wording, and the print files.

import { HttpError, newId, nowIso, type Env } from '../http';
import { parseCsv } from './csv';
import { cleanCopy, DEFAULT_COPY, type LetterCopy } from './letter';
import { buildPdf, measure, type Fonts } from './pdf';
import {
  appealCode,
  byHousehold,
  giftsFromRows,
  letterFor,
  segmentOf,
  verdict,
  type Gift,
  type Letter,
  type Verdict,
} from './rules';
import { queryThankedOn, queryWaiting } from './worker';

export const DEFAULT_DAYS = 90;

export interface Item {
  id: string;
  lookup: string;
  date: string;
  amount: number;
  type: string;
  segment: string;
  addressee: string;
  sortName: string;
  place: string;
  fund: string;
  constituentLookup: string;
  reason: string;
  key: string;
  canAdd: boolean;
  /** Set when the gift is already in a printing that has not been marked thanked. */
  batch?: { id: string; letterDate: string };
}

export interface View {
  asOf: string;
  days: number;
  appealCode: string;
  letters: Item[];
  held: Item[];
}

/** Today in Eastern time, YYYY-MM-DD. */
export function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function itemOf(g: Gift, v: Verdict): Item {
  return {
    id: g.id,
    lookup: g.lookup,
    date: g.date,
    amount: g.amount,
    type: g.type,
    segment: segmentOf(g),
    addressee: g.addressee || g.name,
    sortName: g.sortName || g.name,
    place: [g.city, g.state || g.country].filter(Boolean).join(', '),
    fund: g.funds.join(', '),
    constituentLookup: g.constituentLookup,
    reason: v.reason,
    key: v.key,
    canAdd: v.canAdd,
  };
}

/** Gifts in printings that are not yet marked, so the same gift is never printed twice. */
async function openBatchGifts(env: Env): Promise<Map<string, { id: string; letterDate: string }>> {
  const rows = await env.DB.prepare(
    `SELECT g.gift_id, b.id, b.letter_date FROM rcp_batch_gifts g JOIN rcp_batches b ON b.id = g.batch_id
     WHERE b.kind = 'new' AND b.status IN ('printing', 'marking') AND g.state <> 'marked'`
  ).all<{ gift_id: string; id: string; letter_date: string }>();
  const out = new Map<string, { id: string; letterDate: string }>();
  for (const r of rows.results) out.set(r.gift_id, { id: r.id, letterDate: r.letter_date });
  return out;
}

export async function loadGifts(env: Env, days: number): Promise<Gift[]> {
  return giftsFromRows(parseCsv(await queryWaiting(env, days)));
}

export async function waitingView(env: Env, days: number): Promise<View> {
  const gifts = await loadGifts(env, days);
  const open = await openBatchGifts(env);
  const letters: Item[] = [];
  const held: Item[] = [];
  for (const g of gifts) {
    const v = verdict(g);
    const item = itemOf(g, v);
    const inBatch = open.get(g.id);
    if (inBatch) item.batch = inBatch;
    (v.letter ? letters : held).push(item);
  }
  const order = (a: Item, b: Item) => a.sortName.localeCompare(b.sortName, 'en', { sensitivity: 'base' }) || a.date.localeCompare(b.date);
  letters.sort(order);
  held.sort((a, b) => a.key.localeCompare(b.key) || order(a, b));
  const today = todayEastern();
  return { asOf: nowIso(), days, appealCode: appealCode(today), letters, held };
}

/* ------------------------------------------------------------ wording */

export async function getCopy(env: Env): Promise<LetterCopy> {
  const row = await env.DB.prepare("SELECT value FROM rcp_settings WHERE key = 'copy'").first<{ value: string }>();
  if (!row) return DEFAULT_COPY;
  try {
    return cleanCopy(JSON.parse(row.value));
  } catch {
    return DEFAULT_COPY;
  }
}

export async function saveCopy(env: Env, copy: LetterCopy, actor: string): Promise<void> {
  const before = await getCopy(env);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rcp_settings (key, value, updated_by, updated_at) VALUES ('copy', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    ).bind(JSON.stringify(copy), actor, at),
    env.DB.prepare("INSERT INTO rcp_log (at, actor, kind, detail) VALUES (?, ?, 'wording', ?)").bind(at, actor, JSON.stringify(before)),
  ]);
}

export async function logEvent(env: Env, actor: string, kind: string, batchId: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO rcp_log (at, actor, kind, batch_id, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), actor, kind, batchId, detail.slice(0, 2000)).run();
}

/* ------------------------------------------------------------- assets */

async function asset(env: Env, path: string): Promise<Uint8Array> {
  const res = await env.ASSETS.fetch(new Request(`https://hub.local${path}`));
  if (!res.ok) throw new HttpError(500, 'asset', `A file the letters need is missing (${path}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fonts(env: Env): Promise<Fonts> {
  const [mono, monoBold, sans] = await Promise.all([
    asset(env, '/receipts/fonts/CourierPrime-Regular.ttf'),
    asset(env, '/receipts/fonts/CourierPrime-Bold.ttf'),
    asset(env, '/receipts/fonts/Arimo-Regular.ttf'),
  ]);
  return { mono, monoBold, sans };
}

export async function signature(env: Env): Promise<Uint8Array> {
  const obj = await env.UPLOADS.get('receipts/signature.png');
  if (!obj) throw new HttpError(500, 'signature', "Carole's signature is missing from the hub's storage.");
  return new Uint8Array(await new Response(obj.body).arrayBuffer());
}

export async function paper(env: Env): Promise<Uint8Array> {
  return asset(env, '/receipts/paper-front.jpg');
}

/* ------------------------------------------------------------ batches */

export interface BatchRow {
  id: string;
  kind: string;
  letter_date: string;
  appeal_code: string;
  count: number;
  amount: number;
  regular: number;
  major: number;
  recurring: number;
  first_gift: string;
  last_gift: string;
  source_date: string;
  pdf_key: string;
  letters: string;
  copy: string;
  marked: number;
  mark_failed: number;
  status: string;
  created_by: string;
  created_at: string;
  marked_by: string;
  marked_at: string | null;
}

export function batchSummary(b: BatchRow): Record<string, unknown> {
  return {
    id: b.id,
    kind: b.kind,
    letterDate: b.letter_date,
    appealCode: b.appeal_code,
    count: b.count,
    amount: b.amount,
    regular: b.regular,
    major: b.major,
    recurring: b.recurring,
    firstGift: b.first_gift,
    lastGift: b.last_gift,
    sourceDate: b.source_date,
    marked: b.marked,
    markFailed: b.mark_failed,
    status: b.status,
    createdBy: b.created_by,
    createdAt: b.created_at,
    markedBy: b.marked_by,
    markedAt: b.marked_at,
  };
}

export async function getBatch(env: Env, id: string): Promise<BatchRow> {
  const row = await env.DB.prepare('SELECT * FROM rcp_batches WHERE id = ?').bind(id).first<BatchRow>();
  if (!row) throw new HttpError(404, 'not_found', 'That printing is not on the list.');
  return row;
}

export async function makeBatch(
  env: Env,
  opts: { letters: Letter[]; letterDate: string; kind: 'new' | 'reprint'; sourceDate?: string; actor: string }
): Promise<BatchRow> {
  if (opts.letters.length === 0) throw new HttpError(400, 'empty', 'There are no letters to print.');
  const letters = [...opts.letters].sort(byHousehold);
  const copy = await getCopy(env);
  if (!measure(copy).fits) throw new HttpError(400, 'too_long', 'The letter wording is too long for the page. Shorten it under Letter wording.');
  const code = appealCode(opts.letterDate);
  const pdf = await buildPdf({
    letters,
    letterDate: opts.letterDate,
    appealCode: code,
    copy,
    fonts: await fonts(env),
    signature: await signature(env),
    title: `Thank-you receipts, ${opts.letterDate}`,
  });
  const id = newId('rb');
  const pdfKey = `receipts/${id}.pdf`;
  await env.UPLOADS.put(pdfKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });
  const at = nowIso();
  const dates = letters.map((l) => l.giftDate).sort();
  const count = (s: string) => letters.filter((l) => l.segment === s).length;
  const row: BatchRow = {
    id,
    kind: opts.kind,
    letter_date: opts.letterDate,
    appeal_code: code,
    count: letters.length,
    amount: Math.round(letters.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    regular: count('regular'),
    major: count('major'),
    recurring: count('recurring'),
    first_gift: dates[0] || '',
    last_gift: dates[dates.length - 1] || '',
    source_date: opts.sourceDate || '',
    pdf_key: pdfKey,
    letters: JSON.stringify(letters),
    copy: JSON.stringify(copy),
    marked: 0,
    mark_failed: 0,
    status: opts.kind === 'reprint' ? 'reprint' : 'printing',
    created_by: opts.actor,
    created_at: at,
    marked_by: '',
    marked_at: null,
  };
  const stmts = [
    env.DB.prepare(
      `INSERT INTO rcp_batches (id, kind, letter_date, appeal_code, count, amount, regular, major, recurring, first_gift, last_gift, source_date,
        pdf_key, letters, copy, marked, mark_failed, status, created_by, created_at, marked_by, marked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, '', NULL)`
    ).bind(
      row.id, row.kind, row.letter_date, row.appeal_code, row.count, row.amount, row.regular, row.major, row.recurring,
      row.first_gift, row.last_gift, row.source_date, row.pdf_key, row.letters, row.copy, row.status, row.created_by, row.created_at
    ),
  ];
  if (opts.kind === 'new') {
    for (const l of letters) {
      stmts.push(env.DB.prepare("INSERT INTO rcp_batch_gifts (batch_id, gift_id, state, detail, updated_at) VALUES (?, ?, 'waiting', '', ?)").bind(id, l.giftId, at));
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return row;
}

/** Letters for the gifts asked for, read fresh from Blackbaud. Gifts that changed since the list was loaded come back in `skipped`. */
export async function lettersFor(
  env: Env,
  ids: string[],
  added: string[],
  days: number
): Promise<{ letters: Letter[]; skipped: { id: string; why: string }[] }> {
  const gifts = await loadGifts(env, days);
  const byId = new Map(gifts.map((g) => [g.id, g]));
  const open = await openBatchGifts(env);
  const letters: Letter[] = [];
  const skipped: { id: string; why: string }[] = [];
  const want = new Set([...ids, ...added]);
  for (const id of want) {
    const g = byId.get(id);
    if (!g) {
      skipped.push({ id, why: 'no longer waiting in Blackbaud' });
      continue;
    }
    if (open.has(id)) {
      skipped.push({ id, why: 'already in a printing that is not marked yet' });
      continue;
    }
    const v = verdict(g);
    if (!v.letter && !(v.canAdd && added.includes(id))) {
      skipped.push({ id, why: v.reason });
      continue;
    }
    letters.push(letterFor(g));
  }
  return { letters, skipped };
}

/** Letters for the gifts Blackbaud shows as thanked on a past day, for printing a run again. */
export async function lettersThankedOn(env: Env, date: string): Promise<{ letters: Letter[]; held: number }> {
  const gifts = giftsFromRows(parseCsv(await queryThankedOn(env, date)));
  const letters: Letter[] = [];
  let held = 0;
  for (const g of gifts) {
    if (verdict(g).letter) letters.push(letterFor(g));
    else held += 1;
  }
  return { letters, held };
}
