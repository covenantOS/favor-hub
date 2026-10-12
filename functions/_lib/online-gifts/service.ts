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
export async function onlineGifts(mirror: Q, from: string, formBatches: string[]): Promise<Row[]> {
  return mirror(
    `${MIRROR_SQL} WHERE DATE(g.gift_date) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ('Donation', 'RecurringGiftPayment')
       AND (g.gift_comments LIKE '%via favorintl.org%' OR json_extract(g.raw_json, '$.source') = 'realtime-web' OR json_extract(g.raw_json, '$.batch_number') IN (SELECT value FROM json_each(?2)))
       AND COALESCE(g.gift_comments, '') NOT LIKE 'DIAGNOSTIC%'
     ORDER BY g.date_added DESC LIMIT 300`,
    [from, JSON.stringify(formBatches)]
  );
}

/** Gifts entered by hand without a batch (payment Other or PayPal), the way the admins enter Fundraise Up payouts. */
async function handEntered(mirror: Q, from: string): Promise<Row[]> {
  return mirror(`${MIRROR_SQL} WHERE DATE(g.gift_date) >= ?1 AND g.gift_amount > 0 AND g.gift_type = 'Donation' AND g.gift_payment_method IN ('Other', 'PayPal') AND json_extract(g.raw_json, '$.batch_number') IS NULL`, [from]);
}

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** The Blackbaud gift an admin entered for a Fundraise Up donation: the payout amount to the cent, dated from the day before to ten days after. */
export function matchFru(f: FruDonation, candidates: Row[], used: Set<string>): Row | null {
  const day = f.created.slice(0, 10);
  const hits = candidates.filter((g) => !used.has(String(g.id)) && Math.abs(Number(g.amt) - f.payout) < 0.005 && g.d >= addDays(day, -1) && g.d <= addDays(day, 10));
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
}

export async function overview(d: Deps, viewer: Viewer, from: string, opts: { showTest?: boolean } = {}): Promise<Overview> {
  const [funds, batches] = await Promise.all([fundsOf(d.mirror), batchInfo(d)]);
  const fundIds = new Set(funds.map((f) => f.id));
  const formSet = new Set(batches.formBatches);
  const re = await onlineGifts(d.mirror, from, batches.formBatches);
  let fru: FruDonation[] = [];
  let fruOk = true;
  if (d.fru) {
    try {
      fru = (await d.fru(from)).filter((f) => f.status === 'succeeded' && f.created.slice(0, 10) >= from);
    } catch {
      fruOk = false;
    }
  } else fruOk = false;
  const hand = fru.length ? await handEntered(d.mirror, addDays(from, -1)) : [];

  const items: Array<{ key: string; base: Omit<GiftRow, 'read' | 'review' | 'key'>; parsed: Parsed }> = [];
  for (const g of re) {
    const splits = splitsOf(g.splits);
    const fromForm = !!g.batch && formSet.has(String(g.batch));
    const parsed = parseReference(g.ref, { fromForm });
    items.push({
      key: `re:${g.id}`, parsed,
      base: {
        source: parsed.source === 'website' || g.src === 'realtime-web' ? 'website' : 'form', giftId: String(g.id), recordId: g.cid ? String(g.cid) : null, lookup: g.lookup ? String(g.lookup) : null,
        name: String(g.name || 'Partner'), amount: Number(g.amt) || 0, original: '', date: String(g.d), addedAt: String(g.added || ''), monthly: g.type === 'RecurringGiftPayment' || parsed.monthly,
        tribute: parsed.tribute, comment: parsed.note, currentFund: String(splits[0]?.fund_id ?? ''), splits: splits.length, inBlackbaud: true, test: String(g.cid) === TEST_RECORD,
      },
    });
  }
  const used = new Set<string>();
  for (const f of fru) {
    const m = matchFru(f, hand, used);
    const des = fundByCode(funds, f.designation);
    const splits = m ? splitsOf(m.splits) : [];
    items.push({
      key: m ? `re:${m.id}` : `fru:${f.id}`,
      parsed: { source: 'other', formDesignation: f.designation, note: f.comment, monthly: f.recurring, tribute: false },
      base: {
        source: 'fundraise up', giftId: m ? String(m.id) : null, recordId: m?.cid ? String(m.cid) : null, lookup: m?.lookup ? String(m.lookup) : null,
        name: m ? String(m.name || '') : `${f.first} ${f.last}`.trim() || 'Partner', amount: m ? Number(m.amt) : f.payout, original: f.currency.toLowerCase() === 'usd' ? '' : `${f.amount} ${f.currency.toUpperCase()}`,
        date: f.created.slice(0, 10), addedAt: f.created, monthly: f.recurring, tribute: false, comment: f.comment, currentFund: m ? String(splits[0]?.fund_id ?? '') : des?.id || '',
        splits: m ? splits.length : 1, inBlackbaud: !!m, test: !!m && String(m.cid) === TEST_RECORD,
      },
    });
  }
  // A Fundraise Up gift matched to a Blackbaud gift replaces nothing on the giving form side; drop exact duplicates by key.
  const byKey = new Map(items.map((i) => [i.key, i]));
  const list = [...byKey.values()].filter((i) => !i.base.test || opts.showTest || viewer.tester);

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
  for (const i of list) {
    let read = readDesignation(i.parsed, i.base.currentFund, funds);
    if (read.by !== 'comment' && i.parsed.note && wantsModel(i.parsed.note)) {
      const s = seen.get(i.key);
      if (s?.model_state === 'done') read = readDesignation(i.parsed, i.base.currentFund, funds, s.model_fund ? { fundId: String(s.model_fund) } : null);
      else if (!reviews.has(i.key) && calls < MODEL_CALLS_PER_LOAD) {
        calls++;
        const m = await modelRead(d, i.key, i.parsed.note, funds);
        if (m !== 'held') read = readDesignation(i.parsed, i.base.currentFund, funds, m);
      }
    }
    if (read.fundId && !fundIds.has(read.fundId)) read = { ...read, by: 'none' };
    rows.push({ key: i.key, ...i.base, read, review: reviews.get(i.key) || null });
  }
  rows.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  return {
    from, rows, funds, batches, fruOk,
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

export async function approve(d: Deps, viewer: Viewer, items: ApproveItem[], from: string): Promise<ApproveResult[]> {
  if (!items.length) return [];
  if (items.length > 200) throw new Error('too many');
  const ov = await overview(d, viewer, from, { showTest: true });
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
      const usd = Number(r.amount_in_default_currency) || 0;
      const fee = (Number(r.processing_fee?.amount_in_default_currency) || 0) + (Number(r.platform_fee?.amount_in_default_currency) || 0);
      out.push({
        id: String(r.id), created: String(r.created_at || ''), status: String(r.status || ''), usd, payout: Number(r.payout?.amount_in_default_currency) || Math.round((usd - fee) * 100) / 100,
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
