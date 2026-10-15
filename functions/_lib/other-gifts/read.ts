// Other gifts: what the page shows. The gifts already in Blackbaud come from the D1 mirror (payment method Other: DAF grants, foundation
// transfers, wires, stock, Stripe and Fundraise Up), the gifts waiting in a batch come from the hub's own tables, and a gift the hub
// posted shows once, from the hub's row. Read only: nothing here writes to Blackbaud.
import type { Env } from '../http';
import { notTesterSql, TESTERS } from '../testuser';
import { readOnly, type ActionsRepo } from '../work/repo';
import type { Q } from '../work/partner';
import { loadCatalog } from '../gifts/match';
import { batchCounts } from './store';
import { KIND_LABEL, letterState, NEEDS_LETTER, parseJson, type Kind, type OgBatch, type OgGift } from './rules';

export const WINDOW_DAYS = 30;

export type RowKind = Kind | 'business';
export const ROW_LABEL: Record<RowKind, string> = { ...KIND_LABEL, wire: 'Wire or online', business: 'Business or church' };
export const TABS: { id: 'all' | RowKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'daf', label: 'DAF' },
  { id: 'foundation', label: 'Foundation' },
  { id: 'wire', label: 'Wire or online' },
  { id: 'stock', label: 'Stock' },
  { id: 'phone', label: 'Phone' },
  { id: 'business', label: 'Business and church' },
];

/** How a gift already in Blackbaud is classed: the channel the hub wrote into its Reference, else the giver's constituency. */
const KIND_SQL = `CASE
  WHEN ref LIKE '%[Channel: DAF]%' THEN 'daf'
  WHEN ref LIKE '%[Channel: Foundation]%' THEN 'foundation'
  WHEN ref LIKE '%[Channel: Wire]%' THEN 'wire'
  WHEN ref LIKE '%[Channel: Stock]%' THEN 'stock'
  WHEN ref LIKE '%[Channel: Phone]%' THEN 'phone'
  WHEN con IN ('DAF Provider', 'Donor Advised Fund') THEN 'daf'
  WHEN con = 'Foundation' THEN 'foundation'
  WHEN con IN ('Church', 'Ministry', 'Business') THEN 'business'
  ELSE 'wire' END`;

const BASE = `FROM (SELECT g.id AS id, substr(g.gift_date, 1, 10) AS d, g.gift_amount AS amt, g.gift_constituency AS con, g.constituent_record_id AS cid,
        g.soft_credits AS sc, g.gift_splits AS sp, json_extract(g.raw_json, '$.reference') AS ref
   FROM gifts g WHERE g.gift_payment_method = 'Other' AND g.gift_amount > 0 AND substr(g.gift_date, 1, 10) >= ?1
     AND g.id NOT IN (SELECT value FROM json_each(?2))) t`;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (today: string, n: number) => isoDay(new Date(Date.parse(today + 'T12:00:00Z') - n * 86400000));

export interface Summary {
  month: { label: string; cents: number; gifts: number; softGifts: number };
  lastMonth: { label: string; cents: number; gifts: number };
  year: { cents: number; gifts: number; lastYearCents: number };
  waiting: { gifts: number; cents: number };
  lettersToAttach: number;
  windowDays: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function summary(env: Env, q: Q, today: string): Promise<Summary> {
  const ym = today.slice(0, 7);
  const prev = new Date(Date.parse(ym + '-15T12:00:00Z'));
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const pym = isoDay(prev).slice(0, 7);
  const jan1 = today.slice(0, 4) + '-01-01';
  const lyToday = String(Number(today.slice(0, 4)) - 1) + today.slice(4);
  const lyJan1 = String(Number(today.slice(0, 4)) - 1) + '-01-01';
  const rows = await q<{ m_amt: number; m_n: number; m_soft: number; p_amt: number; p_n: number; y_amt: number; y_n: number; ly_amt: number }>(
    readOnly(
      `SELECT SUM(CASE WHEN substr(gift_date, 1, 7) = ?1 THEN gift_amount ELSE 0 END) AS m_amt,
              SUM(CASE WHEN substr(gift_date, 1, 7) = ?1 THEN 1 ELSE 0 END) AS m_n,
              SUM(CASE WHEN substr(gift_date, 1, 7) = ?1 AND soft_credits IS NOT NULL AND soft_credits <> '[]' THEN 1 ELSE 0 END) AS m_soft,
              SUM(CASE WHEN substr(gift_date, 1, 7) = ?2 THEN gift_amount ELSE 0 END) AS p_amt,
              SUM(CASE WHEN substr(gift_date, 1, 7) = ?2 THEN 1 ELSE 0 END) AS p_n,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?3 THEN gift_amount ELSE 0 END) AS y_amt,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?3 THEN 1 ELSE 0 END) AS y_n,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?4 AND substr(gift_date, 1, 10) <= ?5 THEN gift_amount ELSE 0 END) AS ly_amt
         FROM gifts WHERE gift_payment_method = 'Other' AND gift_amount > 0 AND substr(gift_date, 1, 10) >= ?4`
    ),
    [ym, pym, jan1, lyJan1, lyToday]
  );
  const r = rows[0] || ({} as any);
  const waiting = await batchCounts(env);
  const lettersRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM og_gift g JOIN og_batch b ON b.id = g.batch_id
      WHERE g.status <> 'removed' AND b.status <> 'removed' AND g.kind IN (${NEEDS_LETTER.map((k) => `'${k}'`).join(', ')})
        AND COALESCE(g.letter_status, '') <> 'done' AND ${notTesterSql('b.created_by_email')}`
  ).first<{ n: number }>();
  return {
    month: { label: MONTHS[Number(ym.slice(5)) - 1], cents: Math.round((Number(r.m_amt) || 0) * 100), gifts: Number(r.m_n) || 0, softGifts: Number(r.m_soft) || 0 },
    lastMonth: { label: MONTHS[Number(pym.slice(5)) - 1], cents: Math.round((Number(r.p_amt) || 0) * 100), gifts: Number(r.p_n) || 0 },
    year: { cents: Math.round((Number(r.y_amt) || 0) * 100), gifts: Number(r.y_n) || 0, lastYearCents: Math.round((Number(r.ly_amt) || 0) * 100) },
    waiting: { gifts: waiting.waiting, cents: waiting.waitingCents },
    lettersToAttach: Number(lettersRow?.n) || 0,
    windowDays: WINDOW_DAYS,
  };
}

export interface ListRow {
  id: string;
  source: 'hub' | 'blackbaud';
  date: string;
  fromId: string;
  fromName: string;
  recommendedId: string;
  recommendedName: string;
  kind: RowKind;
  kindLabel: string;
  fund: string;
  amountCents: number;
  letter: 'attached' | 'pending' | 'failed' | 'needed' | 'none' | 'unknown';
  check: 'draft' | 'waiting' | 'posting' | 'approved' | 'needs_person';
  checkBy: string;
  batchId: string;
  batchName: string;
  giftId: string;
}

export interface ListAnswer {
  rows: ListRow[];
  total: number;
  tabs: { id: string; label: string; count: number }[];
  page: number;
  size: number;
}

const CHECK_OF = (g: OgGift, b: OgBatch): ListRow['check'] => {
  if (g.status === 'posted') return 'approved';
  if (g.status === 'failed') return 'needs_person';
  if (b.status === 'open') return 'draft';
  if (b.status === 'waiting') return 'waiting';
  if (b.status === 'needs_person') return 'needs_person';
  return 'posting';
};

const rowKindOfHub = (k: Kind): RowKind => k;

export async function list(
  env: Env,
  q: Q,
  repo: ActionsRepo,
  opts: { today: string; tab: string; term: string; page: number; size: number; viewerIsTester: boolean }
): Promise<ListAnswer> {
  const since = daysAgo(opts.today, WINDOW_DAYS);
  const who = opts.viewerIsTester ? `lower(b.created_by_email) IN (${TESTERS.map((e) => `'${e}'`).join(', ')})` : notTesterSql('b.created_by_email');
  // Hub rows: everything waiting or recently posted, newest first. A posted gift shows from here once, so its Blackbaud id is left out below.
  const hubAll = (
    await env.DB.prepare(
      `SELECT g.*, b.name AS b_name, b.status AS b_status, b.approved_by AS b_approved_by FROM og_gift g JOIN og_batch b ON b.id = g.batch_id
        WHERE g.status <> 'removed' AND b.status <> 'removed' AND ${who} AND (g.status <> 'posted' OR substr(g.posted_at, 1, 10) >= ?)
        ORDER BY COALESCE(g.gift_date, substr(g.created_at, 1, 10)) DESC, g.created_at DESC LIMIT 300`
    )
      .bind(since)
      .all<OgGift & { b_name: string; b_status: OgBatch['status']; b_approved_by: string | null }>()
  ).results;
  const postedIds = (
    await env.DB.prepare("SELECT bb_gift_id AS id FROM og_gift WHERE bb_gift_id IS NOT NULL AND status = 'posted' ORDER BY posted_at DESC LIMIT 1000").all<{ id: string }>()
  ).results.map((r) => String(r.id));

  const term = opts.term.trim().toLowerCase();
  const tabOf = (k: RowKind) => opts.tab === 'all' || opts.tab === k;
  const hubRows = hubAll.filter((g) => tabOf(rowKindOfHub(g.kind)) && (!term || [g.partner_name, g.soft_partner_name, g.fund_name, g.fund_named, g.ref_text].some((s) => (s || '').toLowerCase().includes(term))));

  // The Blackbaud side: counts by kind for the tabs, then this page.
  const idsJson = JSON.stringify(postedIds);
  const counts = await q<{ k: string; n: number }>(readOnly(`SELECT ${KIND_SQL} AS k, COUNT(*) AS n ${BASE} GROUP BY 1`), [since, idsJson]);
  const bbCount = (k: string) => Number(counts.find((c) => c.k === k)?.n) || 0;
  const hubCount = (k: string) => hubAll.filter((g) => k === 'all' || g.kind === k).length;
  const tabs = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.id === 'all' ? counts.reduce((s, c) => s + Number(c.n), 0) + hubAll.length : bbCount(t.id) + hubCount(t.id),
  }));

  const offset = (opts.page - 1) * opts.size;
  const hubSlice = hubRows.slice(offset, offset + opts.size);
  const bbOffset = Math.max(0, offset - hubRows.length);
  const bbLimit = opts.size - hubSlice.length;
  const params: unknown[] = [since, idsJson];
  let kindWhere = '';
  let termWhere = '';
  if (opts.tab !== 'all') {
    params.push(opts.tab);
    kindWhere = ` AND k = ?${params.length}`;
  }
  if (term) {
    params.push(`%${term.replace(/[%_]/g, '')}%`);
    const p = `?${params.length}`;
    termWhere = ` AND (lower(COALESCE(ref, '')) LIKE ${p} OR cid IN (SELECT id FROM constituents WHERE lower(COALESCE(organization_name, '') || ' ' || COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ${p}))`;
  }
  let bbRows: { id: string; d: string; amt: number; con: string; cid: string; sc: string | null; sp: string | null; k: string }[] = [];
  if (bbLimit > 0) {
    const sql = `SELECT id, d, amt, con, cid, sc, sp, k FROM (SELECT t.*, ${KIND_SQL} AS k ${BASE}) WHERE 1 = 1${kindWhere}${termWhere} ORDER BY d DESC, id DESC LIMIT ${bbLimit} OFFSET ${bbOffset}`;
    bbRows = await q(readOnly(sql), params);
  }
  const totalSql = `SELECT COUNT(*) AS n FROM (SELECT t.*, ${KIND_SQL} AS k ${BASE}) WHERE 1 = 1${kindWhere}${termWhere}`;
  const bbTotal = Number((await q<{ n: number }>(readOnly(totalSql), params))[0]?.n) || 0;

  // Names and funds.
  const softOf = (sc: string | null): string => {
    const arr = parseJson<{ constituent_id?: string }[]>(sc, []);
    return arr[0]?.constituent_id ? String(arr[0].constituent_id) : '';
  };
  const ids = new Set<string>();
  for (const r of bbRows) {
    if (r.cid) ids.add(String(r.cid));
    const s = softOf(r.sc);
    if (s) ids.add(s);
  }
  const nameOf = new Map<string, string>();
  if (ids.size) for (const h of await repo.partnersByIds([...ids])) nameOf.set(String(h.cid), h.name);
  const cat = await loadCatalog(q).catch(() => ({ funds: [], appeals: [] }));
  const fundName = new Map(cat.funds.map((f) => [f.id, f.name]));

  const rows: ListRow[] = [
    ...hubSlice.map<ListRow>((g) => ({
      id: g.id,
      source: 'hub',
      date: g.gift_date || g.created_at.slice(0, 10),
      fromId: g.partner_id || '',
      fromName: g.partner_name || 'Not picked yet',
      recommendedId: g.soft_partner_id || '',
      recommendedName: g.soft_partner_name || '',
      kind: rowKindOfHub(g.kind),
      kindLabel: ROW_LABEL[g.kind === 'wire' ? 'wire' : g.kind],
      fund: g.fund_name || '',
      amountCents: g.amount_cents || 0,
      letter: letterState(g),
      check: CHECK_OF(g, { status: g.b_status } as OgBatch),
      checkBy: g.status === 'posted' ? g.b_approved_by || '' : '',
      batchId: g.batch_id,
      batchName: g.b_name,
      giftId: g.bb_gift_id || '',
    })),
    ...bbRows.map<ListRow>((r) => {
      const sp = parseJson<{ fund_id?: string }[]>(r.sp, []);
      const soft = softOf(r.sc);
      return {
        id: String(r.id),
        source: 'blackbaud',
        date: r.d,
        fromId: String(r.cid || ''),
        fromName: nameOf.get(String(r.cid)) || 'Partner ' + r.cid,
        recommendedId: soft,
        recommendedName: soft ? nameOf.get(soft) || 'Partner ' + soft : '',
        kind: r.k as RowKind,
        kindLabel: ROW_LABEL[r.k as RowKind] || 'Wire or online',
        fund: (sp[0]?.fund_id && fundName.get(String(sp[0].fund_id))) || '',
        amountCents: Math.round((Number(r.amt) || 0) * 100),
        letter: 'unknown',
        check: 'approved',
        checkBy: '',
        batchId: '',
        batchName: '',
        giftId: String(r.id),
      };
    }),
  ];
  return { rows, total: hubRows.length + bbTotal, tabs, page: opts.page, size: opts.size };
}

export interface Recommender {
  id: string;
  lookup: string;
  name: string;
  place: string;
  usedBefore: number;
  lastDate: string;
}

/**
 * Who recommended gifts from this sponsor before: the soft credits on that partner's gifts in the last three years, most used first.
 * With a search term, the partner search results join the list and the ones already used for this sponsor come first.
 */
export async function recommenders(q: Q, repo: ActionsRepo, sponsorId: string, term: string, searchHits: { cid: string; lookup: string; name: string; place: string }[]): Promise<Recommender[]> {
  const since = String(Number(new Date().toISOString().slice(0, 4)) - 3) + '-01-01';
  const rows = await q<{ sc: string; d: string }>(
    readOnly(`SELECT soft_credits AS sc, substr(gift_date, 1, 10) AS d FROM gifts WHERE constituent_record_id = ?1 AND soft_credits IS NOT NULL AND soft_credits <> '[]' AND substr(gift_date, 1, 10) >= ?2 ORDER BY gift_date DESC LIMIT 1500`),
    [sponsorId, since]
  );
  const used = new Map<string, { n: number; last: string }>();
  for (const r of rows) {
    for (const s of parseJson<{ constituent_id?: string }[]>(r.sc, [])) {
      const id = String(s.constituent_id || '');
      if (!id) continue;
      const cur = used.get(id);
      if (cur) cur.n++;
      else used.set(id, { n: 1, last: r.d });
    }
  }
  const out = new Map<string, Recommender>();
  const top = [...used.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([id]) => id);
  const wantNames = term.trim().length >= 2 ? [] : top;
  if (wantNames.length) {
    for (const h of await repo.partnersByIds(wantNames)) {
      const u = used.get(String(h.cid))!;
      out.set(String(h.cid), { id: String(h.cid), lookup: h.lookup, name: h.name, place: h.place, usedBefore: u.n, lastDate: u.last });
    }
  }
  for (const h of searchHits) {
    const u = used.get(String(h.cid));
    out.set(String(h.cid), { id: String(h.cid), lookup: h.lookup, name: h.name, place: h.place, usedBefore: u?.n || 0, lastDate: u?.last || '' });
  }
  return [...out.values()].sort((a, b) => b.usedBefore - a.usedBefore);
}

/** A possible duplicate: another gift from the same partner for the same amount within two days, in a batch or in Blackbaud. */
export async function findDuplicate(env: Env, q: Q, g: Pick<OgGift, 'id' | 'partner_id' | 'amount_cents' | 'gift_date'>): Promise<string | null> {
  if (!g.partner_id || !g.amount_cents || !g.gift_date) return null;
  const lo = daysAgo(g.gift_date, 2);
  const hi = isoDay(new Date(Date.parse(g.gift_date + 'T12:00:00Z') + 2 * 86400000));
  const inHub = await env.DB.prepare(
    "SELECT g.id, b.name FROM og_gift g JOIN og_batch b ON b.id = g.batch_id WHERE g.partner_id = ? AND g.amount_cents = ? AND g.gift_date BETWEEN ? AND ? AND g.id <> ? AND g.status <> 'removed' AND b.status <> 'removed' LIMIT 1"
  )
    .bind(g.partner_id, g.amount_cents, lo, hi, g.id)
    .first<{ id: string; name: string }>();
  if (inHub) return `Another gift from this partner for the same amount is already in ${inHub.name}.`;
  try {
    const bb = await q<{ id: string; d: string }>(
      readOnly(`SELECT id, substr(gift_date, 1, 10) AS d FROM gifts WHERE constituent_record_id = ?1 AND ABS(gift_amount - ?2) < 0.005 AND substr(gift_date, 1, 10) BETWEEN ?3 AND ?4 AND gift_type <> 'RecurringGift' LIMIT 1`),
      [g.partner_id, (g.amount_cents || 0) / 100, lo, hi]
    );
    if (bb[0]) return `Blackbaud already has a gift from this partner for the same amount on ${bb[0].d}.`;
  } catch {
    /* the mirror being slow never blocks entry */
  }
  return null;
}
