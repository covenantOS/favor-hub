// First-gift letters: the list, the print files and marking the gifts acknowledged in Blackbaud.
//
// The waiting list is Receipts' own Blackbaud read (receipts/store.ts waitingGifts, the gifts Blackbaud shows as not acknowledged), cut down to
// the acquisition first gifts (classify.ts). The rules for who gets a letter are Receipts' (receipts/rules.ts verdict) with no $10 floor. A print
// file is made, downloaded and printed, and only then are its gifts marked acknowledged, through the same sync-worker route Receipts uses
// (receipts/worker.ts acknowledge) and the same print and mark locks (receipts/store.ts).
import { HttpError, newId, nowIso, type Env } from '../http';
import { mirrorQ } from '../work/partner';
import { getSetting, setSetting } from '../work/db';
import { lettersPdf } from '../work/letters-pdf';
import { checkGifts, summarize, type CheckSummary, type Issue } from '../receipts/check';
import { addressKeyOf, combineLetters, inPrintOrder, letterFor, verdict, type Gift, type Letter } from '../receipts/rules';
import { sampleGifts, todayEastern, waitingGifts, loadGifts } from '../receipts/store';
import { acknowledge } from '../receipts/worker';
import { acquisitionFirstGifts, type AcqGift } from './classify';
import { openFglGifts } from './hold';
import { cleanWording, DEFAULT_WORDING, docFor, signerOf, type SignerKey, type Wording } from './wording';

export const FGL_DAYS = 90;
const WORDING_KEY = 'fgl:wording';
/** First gifts of any size get a letter; Receipts' $10 floor does not apply (acquisition gifts of $5 were always thanked). */
const MIN_FIRST_GIFT = 0;

export interface FglItem {
  id: string;
  lookup: string;
  date: string;
  amount: number;
  type: string;
  addressee: string;
  sortName: string;
  place: string;
  fund: string;
  appeals: string[];
  constituentLookup: string;
  addressKey: string;
  reason: string;
  key: string;
  canAdd: boolean;
  issues?: Issue[];
  batch?: { id: string; letterDate: string };
}

export interface FglView {
  ok: true;
  sample: boolean;
  asOf: string;
  days: number;
  letters: FglItem[];
  held: FglItem[];
  check: CheckSummary;
  wording: Wording;
  /** Gifts waiting in Blackbaud that are not acquisition first gifts; they stay on Receipts. */
  receiptsKeep: number;
}

/** The sample list the FavorOS test user sees: made-up partners, one of each problem, no Blackbaud or mirror read. */
export function sampleFgl(): { gifts: Gift[]; acq: Map<string, AcqGift> } {
  const base = sampleGifts().slice(0, 10);
  const g = (i: number, over: Partial<Gift>): Gift => ({
    id: `sample${i}`, lookup: `S-${i}`, date: todayEastern(), amount: 25, type: 'One-Time Gift', constituency: 'Individual', constituentLookup: `90${i}`,
    name: `Sample Partner ${i}`, sortName: `Partner, Sample ${i}`, organization: false, deceased: false, inactive: false, addressee: `Sample Partner ${i}`, salutation: 'Sam',
    solicitCodes: [], addressLines: ['12 Maple Street'], city: 'Tampa', state: 'FL', zip: '33601', country: 'United States', sendMail: true, funds: ['General GIFT Program'], softCredits: [], ...over,
  });
  const extra = [
    g(11, { name: 'Sample Foundation', addressee: 'Sample Family Foundation', organization: true, constituency: 'Foundation' }),
    g(12, { name: 'Abroad Partner', addressee: 'Abroad Partner', country: 'Canada', state: 'ON', zip: 'K1A 0B1' }),
    g(13, { name: 'No Address', addressee: 'No Address', addressLines: [], city: '', zip: '' }),
    g(14, { name: 'Do Not Mail', addressee: 'Do Not Mail', solicitCodes: ['Do Not Mail'] }),
    g(15, { name: 'Deceased Partner', addressee: 'Deceased Partner', deceased: true }),
    g(16, { name: 'Inactive Partner', addressee: 'Inactive Partner', inactive: true }),
    g(17, { name: 'Five Dollar Partner', addressee: 'Five Dollar Partner', amount: 5, addressLines: ['3 Cedar Way'], zip: '33602' }),
  ];
  const amounts = [25, 50, 100, 10, 15, 5, 35, 20, 40, 60];
  const gifts = [...base.map((b, i) => ({ ...b, amount: amounts[i] ?? 25, funds: ['General GIFT Program'] })), ...extra];
  const acq = new Map(gifts.map((x) => [x.id, { giftId: x.id, appeals: ['K254-GIFT'], credited: [x.constituentLookup] }]));
  return { gifts, acq };
}

function itemOf(g: Gift, reason: string, key: string, canAdd: boolean, appeals: string[]): FglItem {
  return {
    id: g.id,
    lookup: g.lookup,
    date: g.date,
    amount: g.amount,
    type: g.type,
    addressee: g.addressee || g.name,
    sortName: g.sortName || g.name,
    place: [g.city, g.state || g.country].filter(Boolean).join(', '),
    fund: g.funds.join(', '),
    appeals,
    constituentLookup: g.constituentLookup,
    addressKey: addressKeyOf(g.addressLines, g.zip),
    reason,
    key,
    canAdd,
  };
}

/** The check's fix text says "receipt"; this page prints letters. */
const asLetter = (t: string): string => t.replace(/receipts/g, 'letters').replace(/receipt/g, 'letter');

export async function getWording(env: Env): Promise<{ wording: Wording; saved: { updated_at: string } | null }> {
  const row = await env.DB.prepare('SELECT value, updated_at FROM act_settings WHERE key = ? LIMIT 1').bind(WORDING_KEY).first<{ value: string; updated_at: string }>().catch(() => null);
  if (!row) return { wording: DEFAULT_WORDING, saved: null };
  try {
    return { wording: cleanWording(JSON.parse(row.value)), saved: { updated_at: row.updated_at } };
  } catch {
    return { wording: DEFAULT_WORDING, saved: null };
  }
}

export async function saveWording(env: Env, value: unknown, actor: string): Promise<Wording> {
  const w = cleanWording(value);
  const before = await getSetting(env, WORDING_KEY, '');
  await setSetting(env, WORDING_KEY, JSON.stringify(w));
  await env.DB.prepare('INSERT INTO rcp_log (at, actor, kind, batch_id, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), actor, 'fgl_wording', '', before.slice(0, 2000)).run().catch(() => undefined);
  return w;
}

/** Gifts in a receipts print file that is not marked yet. Those gifts are on a printed receipt already; they are not offered a letter. */
async function openReceiptGifts(env: Env): Promise<Map<string, { id: string; letterDate: string }>> {
  const rows = await env.DB.prepare(
    `SELECT g.gift_id, b.id, b.letter_date FROM rcp_batch_gifts g JOIN rcp_batches b ON b.id = g.batch_id
     WHERE b.kind = 'new' AND b.status IN ('printing', 'marking') AND g.state <> 'marked'`
  ).all<{ gift_id: string; id: string; letter_date: string }>();
  return new Map(rows.results.map((r) => [r.gift_id, { id: r.id, letterDate: r.letter_date }]));
}

async function waitingAcquisition(env: Env, days: number, fresh: boolean, defer: ((p: Promise<unknown>) => void) | undefined, sample: boolean) {
  if (sample) {
    const s = sampleFgl();
    return { gifts: s.gifts, acq: s.acq, at: nowIso(), total: s.gifts.length };
  }
  const got = await waitingGifts(env, days, fresh, defer);
  const acq = await acquisitionFirstGifts(mirrorQ(env), got.gifts.map((g) => g.id));
  return { gifts: got.gifts.filter((g) => acq.has(g.id)), acq, at: got.at, total: got.gifts.length };
}

export async function fglView(env: Env, o: { days: number; fresh?: boolean; defer?: (p: Promise<unknown>) => void; sample?: boolean }): Promise<FglView> {
  const sample = Boolean(o.sample);
  const { gifts, acq, at, total } = await waitingAcquisition(env, o.days, Boolean(o.fresh), o.defer, sample);
  const none = new Map<string, { id: string; letterDate: string }>();
  const [openFgl, openRcp, { wording }] = await Promise.all([sample ? none : openFglGifts(env), sample ? none : openReceiptGifts(env), getWording(env)]);
  const letters: FglItem[] = [];
  const held: FglItem[] = [];
  const printing = gifts.filter((g) => !openRcp.has(g.id) && verdict(g, MIN_FIRST_GIFT).letter);
  const flags = checkGifts(printing, wording.greeting);
  for (const g of gifts) {
    const appeals = acq.get(g.id)?.appeals || [];
    const inRcp = openRcp.get(g.id);
    if (inRcp) {
      held.push(itemOf(g, `In the ${inRcp.letterDate} receipts print file`, 'in_receipts', false, appeals));
      continue;
    }
    const v = verdict(g, MIN_FIRST_GIFT);
    const item = itemOf(g, v.reason, v.key, v.canAdd, appeals);
    const inFile = openFgl.get(g.id);
    if (inFile) item.batch = inFile;
    const issues = v.letter ? flags.get(g.id) : undefined;
    if (issues && issues.length) item.issues = issues.map((i) => ({ ...i, text: asLetter(i.text), fix: asLetter(i.fix) }));
    (v.letter ? letters : held).push(item);
  }
  const order = (a: FglItem, b: FglItem) => a.sortName.localeCompare(b.sortName, 'en', { sensitivity: 'base' }) || a.date.localeCompare(b.date);
  letters.sort(order);
  held.sort((a, b) => a.key.localeCompare(b.key) || order(a, b));
  const check = summarize(printing.filter((g) => !openFgl.has(g.id)), flags);
  return { ok: true, sample, asOf: at, days: o.days, letters, held, check, wording, receiptsKeep: Math.max(0, total - gifts.length) };
}

/* ------------------------------------------------------------ batches */

export interface FglBatchRow {
  id: string;
  letter_date: string;
  count: number;
  gifts: number;
  amount: number;
  first_gift: string;
  last_gift: string;
  appeals: string;
  signer: string;
  pdf_key: string;
  letters: string;
  wording: string;
  marked: number;
  mark_failed: number;
  status: string;
  simulated: number;
  created_by: string;
  created_at: string;
  marked_by: string;
  marked_at: string | null;
  downloaded_at: string | null;
}

export function batchSummary(b: FglBatchRow): Record<string, unknown> {
  return {
    id: b.id,
    letterDate: b.letter_date,
    count: b.count,
    gifts: b.gifts || b.count,
    amount: b.amount,
    firstGift: b.first_gift,
    lastGift: b.last_gift,
    appeals: b.appeals ? b.appeals.split(',') : [],
    signer: b.signer,
    signerName: signerOf(b.signer).name,
    marked: b.marked,
    markFailed: b.mark_failed,
    status: b.status,
    simulated: Boolean(b.simulated),
    createdBy: b.created_by,
    createdAt: b.created_at,
    markedBy: b.marked_by,
    markedAt: b.marked_at,
    downloadedAt: b.downloaded_at || null,
  };
}

const COLS = `id, letter_date, count, gifts, amount, first_gift, last_gift, appeals, signer, pdf_key, '' AS letters, '' AS wording, marked, mark_failed, status, simulated,
  created_by, created_at, marked_by, marked_at, downloaded_at`;

export async function listBatches(env: Env): Promise<FglBatchRow[]> {
  const rows = await env.DB.prepare(`SELECT ${COLS} FROM fgl_batches WHERE status <> 'cancelled' ORDER BY created_at DESC LIMIT 60`).all<FglBatchRow>();
  return rows.results;
}

export async function getBatch(env: Env, id: string): Promise<FglBatchRow> {
  const row = await env.DB.prepare('SELECT * FROM fgl_batches WHERE id = ?').bind(id).first<FglBatchRow>();
  if (!row) throw new HttpError(404, 'not_found', 'That print file is not on the list.');
  return row;
}

export async function openFile(env: Env): Promise<{ id: string; letter_date: string } | null> {
  return env.DB.prepare("SELECT id, letter_date FROM fgl_batches WHERE status IN ('printing', 'marking') ORDER BY created_at LIMIT 1").first<{ id: string; letter_date: string }>();
}

export async function logEvent(env: Env, actor: string, kind: string, batchId: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO rcp_log (at, actor, kind, batch_id, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), actor, kind, batchId, detail.slice(0, 2000)).run().catch(() => undefined);
}

/** Letters for the gifts asked for, read fresh from Blackbaud. Gifts that changed since the list was loaded come back in `skipped`. */
export async function lettersFor(env: Env, ids: string[], days: number, sample: boolean): Promise<{ letters: Letter[]; skipped: { id: string; why: string }[]; appeals: string[] }> {
  let gifts: Gift[];
  let acq: Map<string, AcqGift>;
  if (sample) {
    const s = sampleFgl();
    gifts = s.gifts;
    acq = s.acq;
  } else {
    gifts = await loadGifts(env, days);
    acq = await acquisitionFirstGifts(mirrorQ(env), gifts.map((g) => g.id));
  }
  const byId = new Map(gifts.map((g) => [g.id, g]));
  const none = new Map<string, { id: string; letterDate: string }>();
  const [openFgl, openRcp] = await Promise.all([sample ? none : openFglGifts(env), sample ? none : openReceiptGifts(env)]);
  const letters: Letter[] = [];
  const skipped: { id: string; why: string }[] = [];
  const appeals = new Set<string>();
  for (const id of new Set(ids)) {
    const g = byId.get(id);
    if (!g) {
      skipped.push({ id, why: 'no longer waiting in Blackbaud' });
      continue;
    }
    const a = acq.get(id);
    if (!a) {
      skipped.push({ id, why: 'not a first gift from an acquisition mailing' });
      continue;
    }
    if (openFgl.has(id)) {
      skipped.push({ id, why: 'already in a print file that is not marked yet' });
      continue;
    }
    if (openRcp.has(id)) {
      skipped.push({ id, why: 'already in a receipts print file that is not marked yet' });
      continue;
    }
    const v = verdict(g, MIN_FIRST_GIFT);
    if (!v.letter) {
      skipped.push({ id, why: v.reason });
      continue;
    }
    letters.push(letterFor(g));
    for (const c of a.appeals) appeals.add(c);
  }
  return { letters, skipped, appeals: [...appeals].sort() };
}

export async function makeBatch(env: Env, o: { letters: Letter[]; letterDate: string; signer: SignerKey; appeals: string[]; actor: string; simulated: boolean }): Promise<FglBatchRow> {
  if (o.letters.length === 0) throw new HttpError(400, 'empty', 'There are no letters to print.');
  const letters = inPrintOrder(combineLetters(o.letters));
  const giftIds = letters.flatMap((l) => (l.gifts && l.gifts.length ? l.gifts.map((x) => x.id) : [l.giftId]));
  const { wording } = await getWording(env);
  const docs = letters.map((l) => docFor(l, wording, o.letterDate, o.signer));
  const pdf = await lettersPdf(docs, `First-gift letters, ${o.letterDate}`);
  const id = newId('fg');
  const pdfKey = `first-gift-letters/${id}.pdf`;
  await env.UPLOADS.put(pdfKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });
  const at = nowIso();
  const dates = letters.flatMap((l) => (l.gifts && l.gifts.length ? l.gifts.map((x) => x.date) : [l.giftDate])).sort();
  const row: FglBatchRow = {
    id,
    letter_date: o.letterDate,
    count: letters.length,
    gifts: giftIds.length,
    amount: Math.round(letters.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    first_gift: dates[0] || '',
    last_gift: dates[dates.length - 1] || '',
    appeals: o.appeals.join(','),
    signer: o.signer,
    pdf_key: pdfKey,
    letters: JSON.stringify(docs),
    wording: JSON.stringify(wording),
    marked: 0,
    mark_failed: 0,
    status: 'printing',
    simulated: o.simulated ? 1 : 0,
    created_by: o.actor,
    created_at: at,
    marked_by: '',
    marked_at: null,
    downloaded_at: null,
  };
  const stmts = [
    env.DB.prepare(
      `INSERT INTO fgl_batches (id, letter_date, count, gifts, amount, first_gift, last_gift, appeals, signer, pdf_key, letters, wording, marked, mark_failed, status, simulated,
        created_by, created_at, marked_by, marked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'printing', ?, ?, ?, '', NULL)`
    ).bind(row.id, row.letter_date, row.count, row.gifts, row.amount, row.first_gift, row.last_gift, row.appeals, row.signer, row.pdf_key, row.letters, row.wording, row.simulated, row.created_by, row.created_at),
  ];
  for (const giftId of giftIds) stmts.push(env.DB.prepare("INSERT INTO fgl_batch_gifts (batch_id, gift_id, state, detail, updated_at) VALUES (?, ?, 'waiting', '', ?)").bind(id, giftId, at));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return row;
}

const CHUNK = 40;
const BUDGET_MS = 20_000;

/**
 * Mark the next gifts in a print file acknowledged in Blackbaud, dated the day on the letters. The page calls this until nothing is left.
 * A simulated file (made by the FavorOS test user) is marked here and nothing is sent to Blackbaud.
 */
export async function markNext(env: Env, batch: FglBatchRow, actor: string, retry: boolean): Promise<{ marked: number; failed: number; waiting: number; stopped: string }> {
  let stopped = '';
  let sent = 0;
  const started = Date.now();
  let again = retry;
  for (let round = 0; round < 12; round++) {
    const pending = await env.DB.prepare(
      `SELECT gift_id FROM fgl_batch_gifts WHERE batch_id = ? AND (state = 'waiting' OR (state = 'failed' AND ? = 1)) ORDER BY gift_id LIMIT ${CHUNK}`
    )
      .bind(batch.id, again ? 1 : 0)
      .all<{ gift_id: string }>();
    again = false;
    const ids = pending.results.map((r) => r.gift_id);
    if (!ids.length) break;
    const at = nowIso();
    if (batch.simulated) {
      await env.DB.batch(
        ids.map((gid) => env.DB.prepare("UPDATE fgl_batch_gifts SET state = 'marked', detail = 'simulated, nothing sent to Blackbaud', updated_at = ? WHERE batch_id = ? AND gift_id = ?").bind(at, batch.id, gid))
      );
      sent += ids.length;
      continue;
    }
    const out = await acknowledge(env, batch.id, batch.letter_date, ids);
    sent += ids.length;
    stopped = out.stopped;
    const stmts = out.results.map((r) =>
      env.DB.prepare('UPDATE fgl_batch_gifts SET state = ?, detail = ?, updated_at = ? WHERE batch_id = ? AND gift_id = ?').bind(
        r.ok ? 'marked' : stopped && r.status === 0 ? 'waiting' : 'failed',
        r.ok ? '' : `${r.status || ''} ${r.detail || ''}`.trim().slice(0, 300),
        at,
        batch.id,
        r.id
      )
    );
    if (stmts.length) await env.DB.batch(stmts);
    if (stopped || Date.now() - started > BUDGET_MS) break;
  }
  const counts = await env.DB.prepare("SELECT SUM(state = 'marked') AS marked, SUM(state = 'failed') AS failed, SUM(state = 'waiting') AS waiting FROM fgl_batch_gifts WHERE batch_id = ?")
    .bind(batch.id)
    .first<{ marked: number; failed: number; waiting: number }>();
  const marked = Number(counts?.marked) || 0;
  const failed = Number(counts?.failed) || 0;
  const waiting = Number(counts?.waiting) || 0;
  const done = waiting === 0 && failed === 0;
  await env.DB.prepare('UPDATE fgl_batches SET marked = ?, mark_failed = ?, status = ?, marked_by = ?, marked_at = ? WHERE id = ?')
    .bind(marked, failed, done ? 'done' : 'marking', actor, done ? nowIso() : null, batch.id)
    .run();
  if (done && sent > 0) await logEvent(env, actor, 'fgl_marked', batch.id, `${marked} gifts marked acknowledged, dated ${batch.letter_date}${batch.simulated ? ' (simulated)' : ''}`);
  return { marked, failed, waiting, stopped };
}
