// Online gifts review: each online gift with the partner's comment and the designation FavorOS reads from it, Partner Care's
// approval, and the audit trail.
//   Sources: the favorintl.org giving form (gifts go straight into Blackbaud through the API, no batch), Blackbaud donation form
//   batches once approved, and Fundraise Up (international giving; admins enter those in Blackbaud by hand, matched here by the
//   payout amount and date).
//   Writes: SKY API cannot change the fund on a saved gift (a PATCH of gift_splits returns 200 and changes nothing), so an approved
//   change of designation is queued for the desktop's Blackbaud web view runner, like the credit queue. Writes are off by default
//   (og:apply) and limited to the test record (og:test_only) until an admin lifts the limit.
//   Batches in Blackbaud (BBMS installments, donation forms, mail) still need Approve in Blackbaud: SKY has no route to approve one.
import { fundByCode, fundFromAnswer, modelPrompt, parseReference, readDesignation, wantsModel, type Fund, type Parsed, type Reading } from './read.ts';

type Row = Record<string, any>;
export type Q = (sql: string, params: unknown[]) => Promise<Row[]>;
export interface D1Like {
  prepare(sql: string): { bind(...p: unknown[]): any; first<T = Row>(): Promise<T | null>; all<T = Row>(): Promise<{ results?: T[] }>; run(): Promise<unknown> };
}
export interface OpsLike {
  (method: string, path: string, body?: unknown): Promise<{ ok: boolean; status?: number; body?: any; wait?: string; refused?: string }>;
}
export interface FruDonation {
  id: string;
  created: string;
  status: string;
  usd: number;
  payout: number;
  amount: string;
  currency: string;
  first: string;
  last: string;
  comment: string;
  designation: string;
  recurring: boolean;
}
export interface Deps {
  db: D1Like;
  mirror: Q;
  ops?: OpsLike;
  /** A model binding already wrapped by the daily AI guard (aiFor(env.AI, 'online-gift-reading')). Absent: rules only. */
  ai?: { run(model: string, input: unknown): Promise<unknown> } | null;
  fru?: (fromIso: string) => Promise<FruDonation[]>;
  now?: () => Date;
}
export interface Viewer {
  email: string;
  name: string;
  admin: boolean;
  tester: boolean;
}

export const TEST_RECORD = '27202';
export const SETTING_APPLY = 'og:apply';
export const SETTING_TEST_ONLY = 'og:test_only';
export const MODEL = '@cf/meta/llama-3.2-3b-instruct';
const MODEL_CALLS_PER_LOAD = 3;
const REF_READS_PER_LOAD = 10;
const CACHE_MS = 10 * 60 * 1000;
export const TESTER_REFUSAL = 'This is the FavorOS test user. It cannot write to Blackbaud, send email or notify staff.';
export const BLACKBAUD_HOME = 'https://host.nxt.blackbaud.com/?envid=p-5_k5FlbubEyEQnUJw7C9Rw';
export const giftLink = (id: string) => `https://host.nxt.blackbaud.com/gift/page/${id}?envid=p-5_k5FlbubEyEQnUJw7C9Rw&svcid=renxt`;

/** Fundraise Up sends amounts as strings with thousands commas ("1,987.15"). */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

const nowIso = (d: Deps) => (d.now ? d.now() : new Date()).toISOString();

export async function setting(db: D1Like, key: string, fallback = ''): Promise<string> {
  const r = await db.prepare(`SELECT value FROM act_settings WHERE key = ?1`).bind(key).first<{ value: string }>().catch(() => null);
  return r ? r.value : fallback;
}
export async function putSetting(db: D1Like, key: string, value: string, at: string): Promise<void> {
  await db.prepare(`INSERT INTO act_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, at).run();
}
async function log(d: Deps, key: string, actor: string, event: string, note = ''): Promise<void> {
  await d.db.prepare(`INSERT INTO og_log (gift_key, at, actor, event, note) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(key, nowIso(d), actor, event, note.slice(0, 400)).run();
}

export async function fundsOf(mirror: Q): Promise<Fund[]> {
  const rows = await mirror(`SELECT id AS id, fund_id AS code, fund_description AS name FROM funds WHERE COALESCE(fund_inactive, 0) = 0`, []);
  const out = rows.map((r) => ({ id: String(r.id), code: String(r.code ?? ''), name: String(r.name ?? r.code ?? '') }));
  // Where Needed Most first, then by name.
  return out.sort((a, b) => (a.code === 'Where Needed Most' ? -1 : b.code === 'Where Needed Most' ? 1 : a.name.localeCompare(b.name)));
}

// ---- Blackbaud batches (read only) ----
export interface BatchInfo {
  at: string;
  waiting: Array<{ number: string; description: string; gifts: number; amount: number; added: string; by: string }>;
  formBatches: string[];
  error?: string;
}

/** Unapproved batches waiting in Blackbaud, and the numbers of the recent donation form batches. Cached ten minutes. */
export async function batchInfo(d: Deps): Promise<BatchInfo> {
  const cached = await setting(d.db, 'og:bb');
  if (cached) {
    try {
      const c = JSON.parse(cached) as BatchInfo;
      if (Date.now() - Date.parse(c.at) < CACHE_MS) return c;
    } catch {
      // read again
    }
  }
  const info: BatchInfo = { at: nowIso(d), waiting: [], formBatches: [] };
  if (!d.ops) return { ...info, error: 'no connection' };
  const open = await d.ops('GET', '/gift-batch/v1/giftbatches?approved=false&limit=50');
  if (open.ok && open.body) {
    info.waiting = (open.body.giftbatches || open.body.value || []).map((b: Row) => ({
      number: String(b.batch_number || ''), description: String(b.batch_description || ''), gifts: Number(b.number_of_gifts) || 0, amount: Number(b.actual_amount) || 0,
      added: String(b.date_added || ''), by: String(b.added_by || ''),
    }));
  } else info.error = open.wait || open.refused || 'batches not read';
  const head = await d.ops('GET', '/gift-batch/v1/giftbatches?approved=true&search_text=Donation%20forms&limit=1');
  const count = head.ok ? Number(head.body?.count) || 0 : 0;
  if (count) {
    const tail = await d.ops('GET', `/gift-batch/v1/giftbatches?approved=true&search_text=Donation%20forms&limit=40&offset=${Math.max(0, count - 40)}`);
    if (tail.ok) info.formBatches = (tail.body?.giftbatches || tail.body?.value || []).map((b: Row) => String(b.batch_number || '')).filter(Boolean);
  }
  await putSetting(d.db, 'og:bb', JSON.stringify(info), info.at);
  return info;
}

// ---- the gifts ----
export interface GiftRow {
  key: string;
  source: 'website' | 'form' | 'fundraise up';
  giftId: string | null;
  recordId: string | null;
  lookup: string | null;
  name: string;
  amount: number;
  /** For an international gift: what the partner gave in their own currency ("533.00 GBP"). */
  original: string;
  date: string;
  addedAt: string;
  monthly: boolean;
  tribute: boolean;
  comment: string;
  currentFund: string;
  splits: number;
  read: Reading;
  inBlackbaud: boolean;
  test: boolean;
  review: Row | null;
  /** The sync worker's open finding on this gift (og_flags), or null. */
  flag: RowFlag | null;
}

export interface RowFlag {
  key: string;
  kind: 'note' | 'fru-fund' | 'fru-missing';
  /** The Blackbaud fund system id the partner or Fundraise Up asked for. */
  wantedFund: string;
  words: string;
  /** Days since the gift came in. */
  days: number;
}

export interface BatchFlag {
  key: string;
  batchId: string;
  number: string;
  gifts: number;
  amount: number;
  by: string;
  days: number;
  link: string;
}

export interface CheckHealth {
  name: string;
  label: string;
  lastOk: string;
  lastError: string;
  /** ok: ran well in the last two days. stale: last good run is older. failing: the last run failed after the last good one. none: never ran. */
  state: 'ok' | 'stale' | 'failing' | 'none';
}

export const CHECKS: Array<[string, string]> = [['notes', 'Website notes'], ['fundraise', 'Fundraise Up'], ['batches', 'Batches']];
export const batchLink = (id: string) => `https://host.nxt.blackbaud.com/gift-batch/batch-review/${id}?envid=p-5_k5FlbubEyEQnUJw7C9Rw`;
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etDay = (d: Date) => ET.format(d);
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to.slice(0, 10) + 'T12:00:00Z') - Date.parse(from.slice(0, 10) + 'T12:00:00Z')) / 86400000));

/** Open findings from the sync worker's online gift checks. The tables may not exist before the worker's first run. */
export async function openFlags(mirror: Q): Promise<Row[]> {
  try {
    return await mirror(`SELECT * FROM og_flags WHERE resolved_at IS NULL ORDER BY first_seen`, []);
  } catch {
    return [];
  }
}

/** The worker's record of each Fundraise Up donation and the Blackbaud gift it matched. */
async function fruMatchesOf(mirror: Q, since: string, ids: string[]): Promise<Map<string, Row>> {
  try {
    const rows = await mirror(`SELECT fru_id, gift_id, comment, designation_name, recurring, amount, currency FROM fru_matches WHERE created_at >= ?1 OR fru_id IN (SELECT value FROM json_each(?2))`, [since, JSON.stringify(ids)]);
    return new Map(rows.map((r) => [String(r.fru_id), r]));
  } catch {
    return new Map();
  }
}

/** The three checks' last runs. A check is stale when its last good run is over two days old or a failure came after it. */
export async function checkHealth(mirror: Q, now: Date): Promise<CheckHealth[]> {
  let rows: Row[] = [];
  try {
    rows = await mirror(`SELECT check_name, last_run, last_ok, last_error, last_error_at FROM og_check_status`, []);
  } catch {
    rows = [];
  }
  return CHECKS.map(([name, label]) => {
    const r = rows.find((x) => String(x.check_name) === name);
    const lastOk = r?.last_ok ? String(r.last_ok) : '';
    const lastError = r?.last_error_at ? String(r.last_error_at) : '';
    let state: CheckHealth['state'] = 'none';
    if (r) {
      if (lastError && (!lastOk || Date.parse(lastError) > Date.parse(lastOk))) state = 'failing';
      else if (!lastOk) state = 'none';
      else state = now.getTime() - Date.parse(lastOk) > 2 * 86400000 ? 'stale' : 'ok';
    }
    return { name, label, lastOk, lastError, state };
  });
}

const MIRROR_SQL = `SELECT g.id AS id, DATE(g.gift_date) AS d, g.date_added AS added, g.gift_amount AS amt, g.gift_type AS type, g.gift_payment_method AS pm,
    g.gift_comments AS ref, g.constituent_record_id AS cid, json_extract(g.raw_json, '$.batch_number') AS batch, json_extract(g.raw_json, '$.source') AS src,
    g.gift_splits AS splits, c.constituent_lookup_id AS lookup,
    COALESCE(NULLIF(c.organization_name, ''), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
  FROM gifts g LEFT JOIN constituents c ON c.id = g.constituent_record_id`;

const splitsOf = (s: unknown): Row[] => {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Mirror gifts that came in online since `from`: the giving form, its same-minute copies, and Blackbaud donation form batches. */
export async function onlineGifts(mirror: Q, from: string, formBatches: string[], giftId = ''): Promise<Row[]> {
  // One gift opened by its ID (?gift=) is listed whatever its date.
  const one = giftId ? await mirror(`${MIRROR_SQL} WHERE g.id = ?1 AND g.gift_amount > 0 AND g.gift_type IN ('Donation', 'RecurringGiftPayment')`, [giftId]) : [];
  const rows = await mirror(
    `${MIRROR_SQL} WHERE DATE(g.gift_date) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ('Donation', 'RecurringGiftPayment')
       AND (g.gift_comments LIKE '%via favorintl.org%' OR json_extract(g.raw_json, '$.source') = 'realtime-web' OR json_extract(g.raw_json, '$.batch_number') IN (SELECT value FROM json_each(?2)))
       AND COALESCE(g.gift_comments, '') NOT LIKE 'DIAGNOSTIC%'
     ORDER BY g.date_added DESC LIMIT 300`,
    [from, JSON.stringify(formBatches)]
  );
  return [...one.filter((o) => !rows.some((r) => String(r.id) === String(o.id))), ...rows];
}

/** Gifts entered by hand without a batch (payment Other or PayPal), the way the admins enter Fundraise Up payouts. */
async function handEntered(mirror: Q, from: string): Promise<Row[]> {
  return mirror(`${MIRROR_SQL} WHERE DATE(g.gift_date) >= ?1 AND g.gift_amount > 0 AND g.gift_type = 'Donation' AND g.gift_payment_method IN ('Other', 'PayPal') AND json_extract(g.raw_json, '$.batch_number') IS NULL`, [from]);
}

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The Blackbaud gift an admin entered for a Fundraise Up donation. The worker's match (fru_matches.gift_id) is the record when it
 * has one. Otherwise: the payout or the gross USD amount to the cent (the admin desk entered most at the gross), dated from three
 * days before to 21 days after, the partner's last name preferred.
 */
export function matchFru(f: FruDonation, candidates: Row[], used: Set<string>, mappedGiftId = ''): Row | null {
  if (mappedGiftId) {
    const m = candidates.find((g) => String(g.id) === mappedGiftId);
    if (m && !used.has(mappedGiftId)) {
      used.add(mappedGiftId);
      return m;
    }
  }
  const day = f.created.slice(0, 10);
  const same = (g: Row, amt: number) => amt > 0 && Math.abs(Number(g.amt) - amt) < 0.005;
  const hits = candidates.filter((g) => !used.has(String(g.id)) && (same(g, f.payout) || same(g, f.usd)) && g.d >= addDays(day, -3) && g.d <= addDays(day, 21));
  if (!hits.length) return null;
  const last = f.last.trim().toLowerCase();
  const named = hits.find((g) => last && String(g.name || '').toLowerCase().includes(last));
  const pick = named || (hits.length === 1 ? hits[0] : null);
  if (pick) used.add(String(pick.id));
  return pick;
}

async function seenOf(db: D1Like, keys: string[]): Promise<Map<string, Row>> {
  if (!keys.length) return new Map();
  const r = await db.prepare(`SELECT * FROM og_seen WHERE gift_key IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(keys)).all<Row>();
  return new Map((r.results || []).map((x) => [String(x.gift_key), x]));
}
async function reviewsOf(db: D1Like, keys: string[]): Promise<Map<string, Row>> {
  if (!keys.length) return new Map();
  const r = await db.prepare(`SELECT * FROM og_review WHERE gift_key IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(keys)).all<Row>();
  return new Map((r.results || []).map((x) => [String(x.gift_key), x]));
}

/** Ask the model once for a comment the rules could not place. Held by the guard: nothing is stored and the rules stand. */
async function modelRead(d: Deps, key: string, note: string, funds: Fund[]): Promise<{ fundId: string } | null | 'held'> {
  if (!d.ai) return 'held';
  try {
    const p = modelPrompt(note, funds);
    const out = await d.ai.run(MODEL, { messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], max_tokens: 24, temperature: 0 });
    const f = fundFromAnswer(out, funds);
    await d.db.prepare(`INSERT INTO og_seen (gift_key, model_fund, model_state, at) VALUES (?1, ?2, 'done', ?3) ON CONFLICT(gift_key) DO UPDATE SET model_fund = excluded.model_fund, model_state = 'done', at = excluded.at`).bind(key, f ? f.id : null, nowIso(d)).run();
    return f ? { fundId: f.id } : null;
  } catch {
    // AiPaused (today's allowance, switched off) or a failed call: the rules' reading stands, and the next load may try again.
    return 'held';
  }
}

export interface Overview {
  from: string;
  rows: GiftRow[];
  funds: Fund[];
  batches: BatchInfo;
  apply: boolean;
  testLimit: string;
  fruOk: boolean;
  flags: { count: number; changes: number; differs: number; missing: number; batches: number };
  batchFlags: BatchFlag[];
  health: CheckHealth[];
}

export async function overview(d: Deps, viewer: Viewer, from: string, opts: { showTest?: boolean; giftId?: string } = {}): Promise<Overview> {
  const [funds, batches] = await Promise.all([fundsOf(d.mirror), batchInfo(d)]);
  const fundIds = new Set(funds.map((f) => f.id));
  const formSet = new Set(batches.formBatches);
  const re = await onlineGifts(d.mirror, from, batches.formBatches, opts.giftId);
  const allFlags = await openFlags(d.mirror);
  const giftFlags = new Map<string, Row>();
  const missingFlags = new Map<string, Row>();
  for (const fl of allFlags) {
    if ((fl.kind === 'note' || fl.kind === 'fru-fund') && fl.gift_id) giftFlags.set(String(fl.gift_id), fl);
    else if (fl.kind === 'fru-missing' && fl.fru_id) missingFlags.set(String(fl.fru_id), fl);
  }
  // A flagged gift shows whatever its date, like ?gift= does for one gift.
  const wantIds = [...giftFlags.keys()].filter((id) => !re.some((r) => String(r.id) === id));
  if (wantIds.length) {
    const extra = await d.mirror(`${MIRROR_SQL} WHERE g.id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(wantIds)]).catch(() => [] as Row[]);
    re.push(...extra);
  }
  let fru: FruDonation[] = [];
  let fruOk = true;
  if (d.fru) {
    try {
      fru = (await d.fru(from)).filter((f) => f.status === 'succeeded' && f.created.slice(0, 10) >= from);
    } catch {
      fruOk = false;
    }
  } else fruOk = false;
  const matches = await fruMatchesOf(d.mirror, addDays(from, -5), [...missingFlags.keys()]);
  const hand = fru.length ? await handEntered(d.mirror, addDays(from, -4)) : [];
  // The worker's match is the record: bring in any matched gift the date window above did not reach.
  const mappedIds = fru.map((x) => String(matches.get(x.id)?.gift_id || '')).filter((id) => id && !hand.some((h) => String(h.id) === id));
  if (mappedIds.length) hand.push(...(await d.mirror(`${MIRROR_SQL} WHERE g.id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(mappedIds)]).catch(() => [] as Row[])));

  const items: Array<{ key: string; base: Omit<GiftRow, 'read' | 'review' | 'key' | 'flag'>; parsed: Parsed; flag?: Row }> = [];
  for (const g of re) {
    const splits = splitsOf(g.splits);
    const fromForm = !!g.batch && formSet.has(String(g.batch));
    const parsed = parseReference(g.ref, { fromForm });
    const fl = giftFlags.get(String(g.id));
    items.push({
      key: `re:${g.id}`, parsed, flag: fl,
      base: {
        source: fl?.kind === 'fru-fund' ? 'fundraise up' : parsed.source === 'website' || g.src === 'realtime-web' ? 'website' : 'form', giftId: String(g.id), recordId: g.cid ? String(g.cid) : null, lookup: g.lookup ? String(g.lookup) : null,
        name: String(g.name || 'Partner'), amount: Number(g.amt) || 0, original: '', date: String(g.d), addedAt: String(g.added || ''), monthly: g.type === 'RecurringGiftPayment' || parsed.monthly,
        tribute: parsed.tribute, comment: parsed.note, currentFund: String(splits[0]?.fund_id ?? ''), splits: splits.length, inBlackbaud: true, test: String(g.cid) === TEST_RECORD,
      },
    });
  }
  const used = new Set<string>();
  for (const f of fru) {
    const m = matchFru(f, hand, used, String(matches.get(f.id)?.gift_id || ''));
    const des = fundByCode(funds, f.designation);
    const splits = m ? splitsOf(m.splits) : [];
    items.push({
      key: m ? `re:${m.id}` : `fru:${f.id}`,
      flag: m ? giftFlags.get(String(m.id)) : missingFlags.get(f.id),
      parsed: { source: 'other', formDesignation: f.designation, note: f.comment, monthly: f.recurring, tribute: false },
      base: {
        source: 'fundraise up', giftId: m ? String(m.id) : null, recordId: m?.cid ? String(m.cid) : null, lookup: m?.lookup ? String(m.lookup) : null,
        name: m ? String(m.name || '') : `${f.first} ${f.last}`.trim() || 'Partner', amount: m ? Number(m.amt) : f.payout, original: f.currency.toLowerCase() === 'usd' ? '' : `${f.amount} ${f.currency.toUpperCase()}`,
        date: f.created.slice(0, 10), addedAt: f.created, monthly: f.recurring, tribute: false, comment: f.comment, currentFund: m ? String(splits[0]?.fund_id ?? '') : des?.id || '',
        splits: m ? splits.length : 1, inBlackbaud: !!m, test: !!m && String(m.cid) === TEST_RECORD,
      },
    });
  }
  // A Fundraise Up gift the worker found no Blackbaud entry for, older than the list's dates: listed from the flag.
  for (const [id, fl] of missingFlags) {
    if (items.some((i) => i.key === `fru:${id}`)) continue;
    const mt = matches.get(id);
    const words = String(fl.words || mt?.designation_name || '');
    const des = fundByCode(funds, words);
    const day = String(fl.gift_date || '').slice(0, 10);
    items.push({
      key: `fru:${id}`, flag: fl,
      parsed: { source: 'other', formDesignation: words, note: String(mt?.comment || ''), monthly: !!mt?.recurring, tribute: false },
      base: {
        source: 'fundraise up', giftId: null, recordId: null, lookup: null, name: String(fl.partner || 'Partner'), amount: Number(fl.amount) || 0,
        original: mt && String(mt.currency || 'usd').toLowerCase() !== 'usd' ? `${mt.amount} ${String(mt.currency).toUpperCase()}` : '', date: day, addedAt: day, monthly: !!mt?.recurring, tribute: false,
        comment: String(mt?.comment || ''), currentFund: des?.id || '', splits: 1, inBlackbaud: false, test: false,
      },
    });
  }
  // A Fundraise Up gift matched to a Blackbaud gift replaces nothing on the giving form side; drop exact duplicates by key.
  const byKey = new Map(items.map((i) => [i.key, i]));
  const list = [...byKey.values()].filter((i) => !i.base.test || opts.showTest || viewer.tester || (!!opts.giftId && i.base.giftId === opts.giftId));

  // Comments the mirror does not hold yet (a gift the giving form wrote in the last hours): read each once from Blackbaud.
  const seen = await seenOf(d.db, list.map((i) => i.key));
  let refReads = 0;
  for (const i of list) {
    if (i.base.source !== 'website' || i.parsed.note || i.parsed.formDesignation || !i.base.giftId) continue;
    const s = seen.get(i.key);
    let ref = s?.ref as string | undefined;
    if (ref == null && d.ops && refReads < REF_READS_PER_LOAD) {
      refReads++;
      const r = await d.ops('GET', `/gift/v1/gifts/${i.base.giftId}`);
      if (r.ok && r.body) {
        ref = String(r.body.reference || '');
        await d.db.prepare(`INSERT INTO og_seen (gift_key, ref, at) VALUES (?1, ?2, ?3) ON CONFLICT(gift_key) DO UPDATE SET ref = excluded.ref`).bind(i.key, ref, nowIso(d)).run();
        seen.set(i.key, { ...(s || {}), ref });
      }
    }
    if (ref) {
      i.parsed = parseReference(ref);
      i.base.comment = i.parsed.note;
      i.base.monthly = i.base.monthly || i.parsed.monthly;
      i.base.tribute = i.parsed.tribute;
    }
  }

  const reviews = await reviewsOf(d.db, list.map((i) => i.key));
  let calls = 0;
  const rows: GiftRow[] = [];
  const nowMs = Date.parse(nowIso(d));
  for (const i of list) {
    // The runner read the new fund back from Blackbaud. Until the mirror's next sync shows it, that reading is the gift's fund.
    const rv = reviews.get(i.key);
    if (rv && rv.state === 'applied' && rv.applied_at && nowMs - Date.parse(String(rv.applied_at)) < 36 * 3600000) i.base.currentFund = String(rv.chosen_fund);
    let read = readDesignation(i.parsed, i.base.currentFund, funds);
    const wanted = i.flag && i.flag.kind !== 'fru-missing' ? String(i.flag.wanted_fund || '') : '';
    if (!wanted && read.by !== 'comment' && i.parsed.note && wantsModel(i.parsed.note)) {
      const s = seen.get(i.key);
      if (s?.model_state === 'done') read = readDesignation(i.parsed, i.base.currentFund, funds, s.model_fund ? { fundId: String(s.model_fund) } : null);
      else if (!reviews.has(i.key) && calls < MODEL_CALLS_PER_LOAD) {
        calls++;
        const m = await modelRead(d, i.key, i.parsed.note, funds);
        if (m !== 'held') read = readDesignation(i.parsed, i.base.currentFund, funds, m);
      }
    }
    // A flag names the fund the partner or Fundraise Up asked for; it is the preselected designation.
    if (wanted && fundIds.has(wanted)) read = { fundId: wanted, by: i.flag!.kind === 'note' ? 'comment' : 'form', word: String(i.flag!.words || ''), also: [] };
    if (read.fundId && !fundIds.has(read.fundId)) read = { ...read, by: 'none' };
    const fl = i.flag;
    const flag: RowFlag | null = fl ? { key: String(fl.flag_key), kind: fl.kind, wantedFund: String(fl.wanted_fund || ''), words: String(fl.words || ''), days: daysBetween(String(fl.gift_date || i.base.date), etDay(new Date(nowMs))) } : null;
    rows.push({ key: i.key, ...i.base, read, review: reviews.get(i.key) || null, flag });
  }
  rows.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  const today = etDay(new Date(nowMs));
  const batchFlags: BatchFlag[] = allFlags
    .filter((fl) => fl.kind === 'batch')
    .map((fl) => {
      const m = /(\d+)\s+gifts?(?:,\s*created by\s+(.+))?/i.exec(String(fl.detail || ''));
      return { key: String(fl.flag_key), batchId: String(fl.batch_id || ''), number: String(fl.batch_number || ''), gifts: m ? Number(m[1]) : 0, amount: Number(fl.amount) || 0, by: m?.[2] ? m[2].trim() : '', days: daysBetween(String(fl.gift_date || today), today), link: batchLink(String(fl.batch_id || '')) };
    })
    .sort((a, b) => b.days - a.days);
  const kindCount = (k: string) => rows.filter((r) => r.flag?.kind === k).length;
  const flags = { changes: kindCount('note'), differs: kindCount('fru-fund'), missing: kindCount('fru-missing'), batches: batchFlags.length, count: 0 };
  flags.count = flags.changes + flags.differs + flags.missing + flags.batches;
  return {
    from, rows, funds, batches, fruOk, flags, batchFlags, health: await checkHealth(d.mirror, new Date(nowMs)),
    apply: (await setting(d.db, SETTING_APPLY, 'off')) === 'on',
    testLimit: await setting(d.db, SETTING_TEST_ONLY, TEST_RECORD),
  };
}

// ---- approval ----
export interface ApproveItem {
  key: string;
  fundId: string;
}
export interface ApproveResult {
  key: string;
  state: string;
  result: string;
}

/** What approving a designation does, decided from facts only. */
export function decideState(f: { inBlackbaud: boolean; from: string; to: string; splits: number; record: string; tester: boolean; applyOn: boolean; testOnly: string[] }): { state: string; result: string } {
  if (!f.inBlackbaud) return { state: 'noted', result: 'Not in Blackbaud yet' };
  if (f.from === f.to) return { state: 'approved', result: 'Designation unchanged' };
  if (f.splits > 1) return { state: 'held', result: 'Split gift: change the funds in Blackbaud' };
  if (f.tester && f.record !== TEST_RECORD) return { state: 'held', result: TESTER_REFUSAL };
  if (!f.applyOn) return { state: 'held', result: 'Writes to Blackbaud are off' };
  if (f.testOnly.length && !f.testOnly.includes(f.record)) return { state: 'held', result: `Writes are limited to record ${f.testOnly.join(', ')}` };
  return { state: 'queued', result: 'Waiting for the Blackbaud web view' };
}

export async function approve(d: Deps, viewer: Viewer, items: ApproveItem[], from: string, giftId = ''): Promise<ApproveResult[]> {
  if (!items.length) return [];
  if (items.length > 200) throw new Error('too many');
  const ov = await overview(d, viewer, from, { showTest: true, giftId });
  const rows = new Map(ov.rows.map((r) => [r.key, r]));
  const fundIds = new Set(ov.funds.map((f) => f.id));
  const applyOn = ov.apply;
  const testOnly = ov.testLimit.split(',').map((x) => x.trim()).filter(Boolean);
  const out: ApproveResult[] = [];
  for (const it of items) {
    const r = rows.get(String(it.key));
    if (!r) {
      out.push({ key: it.key, state: 'missing', result: 'That gift is not in the list any more' });
      continue;
    }
    const to = String(it.fundId || '');
    if (!fundIds.has(to)) {
      out.push({ key: it.key, state: 'missing', result: 'Pick a designation' });
      continue;
    }
    if (r.review && (r.review.state === 'applied' || r.review.state === 'approved') && r.review.chosen_fund === to && r.currentFund === to) {
      out.push({ key: it.key, state: r.review.state, result: r.review.result || '' });
      continue;
    }
    const s = decideState({ inBlackbaud: r.inBlackbaud, from: r.currentFund, to, splits: r.splits, record: String(r.recordId || ''), tester: viewer.tester, applyOn, testOnly });
    const at = nowIso(d);
    await d.db.prepare(
      `INSERT INTO og_review (gift_key, source, gift_id, record_id, amount, gift_date, from_fund, read_fund, read_by, chosen_fund, state, result, approved_by, approved_name, approved_at, applied_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL)
       ON CONFLICT(gift_key) DO UPDATE SET from_fund = excluded.from_fund, read_fund = excluded.read_fund, read_by = excluded.read_by, chosen_fund = excluded.chosen_fund,
         state = excluded.state, result = excluded.result, approved_by = excluded.approved_by, approved_name = excluded.approved_name, approved_at = excluded.approved_at, applied_at = NULL`
    ).bind(r.key, r.source, r.giftId, r.recordId, r.amount, r.date, r.currentFund, r.read.fundId, r.read.by, to, s.state, s.result, viewer.email, viewer.name, at).run();
    await log(d, r.key, viewer.email, 'approved', `${fundName(ov.funds, r.currentFund)} to ${fundName(ov.funds, to)}`);
    await log(d, r.key, 'hub', s.state, s.result);
    out.push({ key: r.key, state: s.state, result: s.result });
  }
  return out;
}

/** A person keeps the fund a flag questioned. The worker closes the flag; the log keeps who did it. */
export async function keepFund(
  d: Deps, viewer: Viewer, key: string, resolve: (key: string, by: string, note: string) => Promise<{ ok: boolean; status: number }>
): Promise<{ ok: boolean; code?: 'test_user' | 'no_flag' | 'worker' }> {
  if (viewer.tester) return { ok: false, code: 'test_user' };
  const fl = (await openFlags(d.mirror)).find((x) => String(x.flag_key) === key && (x.kind === 'note' || x.kind === 'fru-fund'));
  if (!fl) return { ok: false, code: 'no_flag' };
  const r = await resolve(key, viewer.email, '');
  if (r.status === 404) return { ok: false, code: 'no_flag' };
  if (!r.ok) return { ok: false, code: 'worker' };
  await log(d, fl.gift_id ? `re:${fl.gift_id}` : key, viewer.email, 'kept', `Kept the fund on ${fl.kind === 'note' ? 'a website note' : 'a Fundraise Up gift'} flag`);
  return { ok: true };
}

const fundName = (funds: Fund[], id: string) => funds.find((f) => f.id === id)?.name || (id ? `fund ${id}` : 'no fund');

// ---- the desktop runner's queue (agent key only) ----
export async function queued(db: D1Like): Promise<Row[]> {
  const r = await db.prepare(`SELECT gift_key, gift_id, record_id, from_fund, chosen_fund AS to_fund, approved_by, approved_at FROM og_review WHERE state = 'queued' ORDER BY approved_at LIMIT 50`).all<Row>();
  return r.results || [];
}
export async function queueDone(d: Deps, key: string, ok: boolean, result: string): Promise<void> {
  const c = await d.db.prepare(`SELECT state FROM og_review WHERE gift_key = ?1`).bind(key).first<Row>();
  if (!c || c.state !== 'queued') throw new Error('not_queued');
  await d.db.prepare(`UPDATE og_review SET state = ?2, applied_at = ?3, result = ?4 WHERE gift_key = ?1`).bind(key, ok ? 'applied' : 'failed', ok ? nowIso(d) : null, result.slice(0, 300)).run();
  await log(d, key, 'runner', ok ? 'applied' : 'failed', result);
}

export async function history(db: D1Like, key: string): Promise<Row[]> {
  return ((await db.prepare(`SELECT at, actor, event, note FROM og_log WHERE gift_key = ?1 ORDER BY id`).bind(key).all<Row>()).results || []) as Row[];
}

// ---- Fundraise Up ----
/** Succeeded and other donations since `from`, newest first, up to three pages of 100. */
export async function fetchFru(key: string, from: string, fetcher: typeof fetch = fetch): Promise<FruDonation[]> {
  const out: FruDonation[] = [];
  let after = '';
  for (let page = 0; page < 3; page++) {
    const url = `https://api.fundraiseup.com/v1/donations?livemode=true&limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`fundraiseup ${res.status}`);
    const data = (await res.json()) as { data?: Row[]; has_more?: boolean };
    const rows = data.data || [];
    for (const r of rows) {
      const usd = num(r.amount_in_default_currency);
      const fee = num(r.processing_fee?.amount_in_default_currency) + num(r.platform_fee?.amount_in_default_currency);
      out.push({
        id: String(r.id), created: String(r.created_at || ''), status: String(r.status || ''), usd, payout: num(r.payout?.amount_in_default_currency) || Math.round((usd - fee) * 100) / 100,
        amount: String(r.amount || ''), currency: String(r.currency || 'usd'), first: String(r.supporter?.first_name || ''), last: String(r.supporter?.last_name || ''),
        comment: String(r.comment || '').trim(), designation: String(r.designation?.name || ''), recurring: !!r.recurring_plan,
      });
    }
    const last = rows[rows.length - 1];
    if (!data.has_more || !last || String(last.created_at || '').slice(0, 10) < from) break;
    after = String(last.id);
  }
  return out;
}
