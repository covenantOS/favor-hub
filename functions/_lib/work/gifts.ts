// Gifts to thank (Work Center tab 5). One row per gift on a partner a director holds, soft credits included, until someone thanks it.
// Read only from the D1 mirror, laid over the hub's own thank-you records (act_thanks) so a thank-you shows at once, before the
// mirror has read the new Blackbaud action back. Pure shaping in shapeGifts; the queries sit in loadGifts. No Blackbaud calls here.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import type { Env } from '../http';
import { readOnly, FUNDRAISERS_SQL, FUNDS_SQL } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';

/** The gift types that count as money received. A RecurringGift row is the pledge; its payments are the gifts. */
export const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
/** The assignment types that make someone the partner's director. Partner Care keeps its own thank-you process. */
export const HOLD_TYPES = ['Regional Development Director (RDD)', 'Prospect Steward', 'Church Engagement Director'] as const;
/** How far back a gift can be owed. Older gifts are not asked about. act_settings thank_days changes it. */
export const DEFAULT_DAYS = 21;
const PAY: Record<string, string> = { PersonalCheck: 'Check', CreditCard: 'Card', Cash: 'Cash', DirectDebit: 'Bank draft', PayPal: 'PayPal', Other: 'Other' };

const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => (v == null ? '' : String(v));
function parse<T = any>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export interface RawGift {
  id: string;
  giver: string;
  amount: number;
  gdate: string;
  added: string;
  gtype: string;
  pm: string;
  splits: string | null;
  soft: string | null;
  link: string | null;
  comment: string | null;
}
export interface RawHold { cid: string; fid: string; type: string }
export interface RawEvidence { cid: string; d: string; cat: string; tag: number }
export interface RawFacts { id: string; name: string; kind: string; city: string; st: string; deceased: number; inactive: number }
export interface RawStats { cid: string; n: number; total: number; mx: number; firstd: string }
export interface RawLast { cid: string; d: string }
export interface RawPhone { cid: string; number: string; dnc: number; prim: number; type: string }
export interface RawMonthly { link: string; firstd: string }
export interface RawThank { gift_id: string; cid: string; how: string; outcome: string; created_at: string; actor: string; remind_on: string | null }

export interface GiftRow {
  key: string;
  giftId: string;
  cid: string;
  amount: number;
  date: string;
  added: string;
  /** Whole days since the gift date, Eastern. */
  ageDays: number;
  /** Hours since Blackbaud had the gift. */
  hours: number;
  type: string;
  pay: string;
  fund: string;
  comment: string;
  soft: { giverId: string; giver: string } | null;
  partner: {
    name: string;
    kind: string;
    place: string;
    lifetime: number;
    count: number;
    lastContact: string;
    phone: string | null;
    doNotCall: boolean;
    deceased: boolean;
  };
  badges: string[];
  /** The directors who hold this partner (Blackbaud fundraiser ids). */
  owners: string[];
  /** Open thank-you tasks about this gift; the service fills these from the board. */
  taskIds: string[];
  /** Set when a thank-you is on record at or after the gift date. */
  thanked: { date: string; by: string; how: string } | null;
  /** Set when someone left a message and the gift is still owed. */
  left: { date: string; how: string; by: string; remind: string } | null;
}

export interface RawGifts {
  gifts: RawGift[];
  holds: RawHold[];
  evidence: RawEvidence[];
  facts: RawFacts[];
  stats: RawStats[];
  last: RawLast[];
  phones: RawPhone[];
  monthly: RawMonthly[];
  funds: { id: string; name: string }[];
  thanks: RawThank[];
  fundraisers: { id: string; first: string; last: string; active: number }[];
}

export interface Shaped {
  rows: GiftRow[];
  thankedWeek: Record<string, number>;
  /** Thank-yous made today in this hub, for the shelf under the list. */
  today: { giftId: string; cid: string; name: string; how: string; by: string; amount: number; owners: string[] }[];
}

/** Monday of the week the date falls in. */
export function weekStart(iso: string): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/**
 * Turn the mirror's rows into the list. A gift is owed to the directors who hold the partner it counts for: the giver, and each
 * soft-credited partner. It stops being owed when a thank-you is on record for the giver or the credited partner dated on or
 * after the gift: an action with the Thanked tag, a completed Mailing or Phone call, or a thank-you made in this hub.
 */
export function shapeGifts(raw: RawGifts, o: { today: string; nowMs: number }): Shaped {
  const holds = new Map<string, Set<string>>();
  for (const h of raw.holds) (holds.get(h.cid) || holds.set(h.cid, new Set()).get(h.cid)!).add(h.fid);
  const live = new Set(raw.fundraisers.filter((f) => num(f.active) === 1).map((f) => String(f.id)));
  const facts = new Map(raw.facts.map((f) => [String(f.id), f]));
  const stats = new Map(raw.stats.map((s) => [String(s.cid), s]));
  const last = new Map(raw.last.map((l) => [String(l.cid), day(l.d)]));
  const funds = new Map(raw.funds.map((f) => [String(f.id), f.name]));
  const monthlyFirst = new Map(raw.monthly.map((m) => [String(m.link), day(m.firstd)]));
  const phones = new Map<string, RawPhone[]>();
  for (const p of raw.phones) (phones.get(String(p.cid)) || phones.set(String(p.cid), []).get(String(p.cid))!).push(p);
  const evid = new Map<string, RawEvidence[]>();
  for (const e of raw.evidence) (evid.get(String(e.cid)) || evid.set(String(e.cid), []).get(String(e.cid))!).push(e);
  const thanks = new Map<string, RawThank[]>();
  for (const t of raw.thanks) (thanks.get(`${t.gift_id}|${t.cid}`) || thanks.set(`${t.gift_id}|${t.cid}`, []).get(`${t.gift_id}|${t.cid}`)!).push(t);
  const nameOf = (id: string): string => facts.get(id)?.name || `Record ${id}`;
  const fundOf = (splits: unknown): string => [...new Set(parse<any[]>(splits, []).map((s) => funds.get(String(s?.fund_id)) || '').filter(Boolean))].join(', ');

  const rows: GiftRow[] = [];
  const thankedWeek: Record<string, number> = {};
  const wk = weekStart(o.today);
  const shelf: Shaped['today'] = [];
  const seenShelf = new Set<string>();

  for (const g of raw.gifts) {
    const soft = parse<any[]>(g.soft, []);
    // The partners this gift counts for, with the amount each is credited. The giver counts for the full gift.
    const credited: { cid: string; amount: number; soft: boolean }[] = [{ cid: String(g.giver), amount: num(g.amount), soft: false }];
    for (const s of soft) {
      const c = String(s?.constituent_id || '');
      const a = num(s?.amount?.value);
      if (c && c !== String(g.giver) && a > 0 && !credited.some((x) => x.cid === c)) credited.push({ cid: c, amount: a, soft: true });
    }
    for (const c of credited) {
      const owners = [...(holds.get(c.cid) || [])];
      if (!owners.length) continue;
      const f = facts.get(c.cid);
      const st = stats.get(c.cid);
      const date = day(g.gdate);
      // Thank-you evidence on the credited partner or, for a soft credit, on the giver too.
      const who = c.soft ? [c.cid, String(g.giver)] : [c.cid];
      let thankedOn = '';
      let thankedBy = '';
      let thankedHow = '';
      for (const w of who) for (const e of evid.get(w) || []) if (e.d >= date && (!thankedOn || e.d < thankedOn)) { thankedOn = e.d; thankedBy = 'Blackbaud'; thankedHow = e.cat; }
      const mine = (thanks.get(`${g.id}|${c.cid}`) || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const done = mine.find((t) => t.outcome === 'talked' || t.outcome === 'sent');
      if (done) {
        const d = day(done.created_at);
        if (!thankedOn || d < thankedOn) { thankedOn = d; thankedBy = done.actor; thankedHow = done.how; }
        if (d === o.today && !seenShelf.has(`${g.id}|${c.cid}`)) { seenShelf.add(`${g.id}|${c.cid}`); shelf.push({ giftId: String(g.id), cid: c.cid, name: nameOf(c.cid), how: done.how, by: done.actor, amount: c.amount, owners }); }
      }
      if (thankedOn) {
        if (thankedOn >= wk) for (const ow of owners) thankedWeek[ow] = (thankedWeek[ow] || 0) + 1;
        continue;
      }
      const left = mine.find((t) => t.outcome === 'left');
      const lifetime = st ? num(st.total) : 0;
      const count = st ? num(st.n) : 0;
      const badges: string[] = [];
      const isPayment = g.gtype === 'RecurringGiftPayment';
      const first = st ? day(st.firstd) : '';
      // A recurring payment is a gift to thank only when it is the first one: later months are the same pledge.
      if (isPayment) {
        const firstPay = g.link ? monthlyFirst.get(String(g.link)) : '';
        if (firstPay && date > firstPay) continue;
        badges.push(count <= 1 || (first && date <= first) ? 'First gift' : 'First monthly gift');
      } else if (!c.soft && first && date <= first && count <= 1) badges.push('First gift');
      if (!c.soft && st && count > 1 && c.amount >= num(st.mx) && c.amount > 0) badges.push('Largest gift');
      if (c.amount >= 1000) badges.push('$1,000 and up');
      if (c.soft) badges.push('Soft credit');
      const ph = (phones.get(c.cid) || []).slice().sort((a, b) => num(b.prim) - num(a.prim));
      const callable = ph.find((p) => num(p.dnc) !== 1);
      const addedMs = Date.parse(g.added || '') || Date.parse(date + 'T12:00:00-04:00');
      rows.push({
        key: `${g.id}:${c.cid}`,
        giftId: String(g.id),
        cid: c.cid,
        amount: c.amount,
        date,
        added: text(g.added),
        ageDays: Math.max(0, daysBetween(date, o.today)),
        hours: Math.max(0, Math.round((o.nowMs - addedMs) / 3600000)),
        type: text(g.gtype),
        pay: isPayment ? 'Monthly, ' + (PAY[g.pm] || g.pm || 'gift').toLowerCase() : PAY[g.pm] || text(g.pm),
        fund: fundOf(g.splits) || 'No fund on file',
        comment: text(g.comment).slice(0, 200),
        soft: c.soft ? { giverId: String(g.giver), giver: nameOf(String(g.giver)) } : null,
        partner: {
          name: nameOf(c.cid),
          kind: f ? text(f.kind) : '',
          place: f ? [f.city, f.st].filter(Boolean).join(', ') : '',
          lifetime,
          count,
          lastContact: last.get(c.cid) || '',
          phone: callable ? text(callable.number) : null,
          doNotCall: ph.length > 0 && !callable,
          deceased: !!f && num(f.deceased) === 1,
        },
        badges,
        owners: owners.filter((x) => live.has(x)),
        taskIds: [],
        thanked: null,
        left: left ? { date: day(left.created_at), how: left.how, by: left.actor, remind: text(left.remind_on) } : null,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.added < b.added ? -1 : a.key < b.key ? -1 : 1));
  return { rows: rows.filter((r) => r.owners.length), thankedWeek, today: shelf };
}

/* ------------------------------------------------------------------ queries */

const GIFTS_SINCE_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.date_added AS added,
       g.gift_type AS gtype, g.gift_payment_method AS pm, g.gift_splits AS splits, g.soft_credits AS soft, g.linked_gift_id AS link, g.gift_comments AS comment
  FROM gifts g WHERE substr(g.gift_date, 1, 10) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
 ORDER BY g.gift_date, g.id LIMIT 2500`);

const GIFTS_PARTNER_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS giver, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gdate, g.date_added AS added,
       g.gift_type AS gtype, g.gift_payment_method AS pm, g.gift_splits AS splits, g.soft_credits AS soft, g.linked_gift_id AS link, g.gift_comments AS comment
  FROM gifts g WHERE substr(g.gift_date, 1, 10) >= ?1 AND g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND COALESCE(g.gift_status, 'Active') = 'Active'
   AND (g.constituent_record_id = ?2 OR g.soft_credits LIKE ?3) ORDER BY g.gift_date, g.id LIMIT 200`);

const HOLDS_SQL = readOnly(`SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid, assignment_type AS type FROM assignments
  WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND assignment_type IN (SELECT value FROM json_each(?2))
    AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?3)`);

const EVIDENCE_SQL = readOnly(`SELECT a.constituent_record_id AS cid, substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) AS d, a.action_category AS cat, COALESCE(t.thanked, 0) AS tag
  FROM actions a LEFT JOIN action_tags t ON t.id = a.id
 WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND json_extract(a.raw_json, '$.completed') = 1
   AND substr(COALESCE(a.action_completed_date, a.action_date_due), 1, 10) >= ?2 AND (COALESCE(t.thanked, 0) = 1 OR a.action_category IN ('Mailing', 'Phone call'))`);

const FACTS_SQL = readOnly(`SELECT c.id AS id, COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       c.constituent_type AS kind, json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st, c.deceased AS deceased, c.inactive AS inactive
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`);

const STATS_SQL = readOnly(`SELECT constituent_record_id AS cid, COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total, COALESCE(MAX(gift_amount), 0) AS mx, MIN(substr(gift_date, 1, 10)) AS firstd
  FROM gifts WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND gift_amount > 0 AND gift_type IN ${GIVEN} GROUP BY 1`);

const LAST_SQL = readOnly(`SELECT constituent_record_id AS cid, MAX(substr(COALESCE(action_completed_date, action_date_due), 1, 10)) AS d FROM actions
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND json_extract(raw_json, '$.completed') = 1 AND action_category IN ('Email', 'Phone call', 'Meeting', 'Mailing') GROUP BY 1`);

const PHONES_SQL = readOnly(`SELECT constituent_record_id AS cid, phone_number AS number, do_not_call AS dnc, is_primary AS prim, phone_type AS type FROM phones
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0`);

const MONTHLY_SQL = readOnly(`SELECT linked_gift_id AS link, MIN(substr(gift_date, 1, 10)) AS firstd FROM gifts
 WHERE linked_gift_id IN (SELECT value FROM json_each(?1)) AND gift_type = 'RecurringGiftPayment' GROUP BY 1`);

/** The hub's own thank-you records for these gifts. A batch that was undone, or that Blackbaud turned down in part, does not count. */
export async function hubThanks(env: Env, giftIds: string[]): Promise<RawThank[]> {
  if (!giftIds.length || !env.DB) return [];
  const out: RawThank[] = [];
  for (let i = 0; i < giftIds.length; i += 80) {
    const part = giftIds.slice(i, i + 80);
    const r = await env.DB.prepare(
      `SELECT t.gift_id, t.cid, t.how, t.outcome, t.created_at, t.actor, t.remind_on FROM act_thanks t
         LEFT JOIN act_batches b ON b.id = t.batch_id
        WHERE t.gift_id IN (${part.map(() => '?').join(',')}) AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done'))`
    ).bind(...part).all<RawThank>().catch(() => ({ results: [] as RawThank[] }));
    out.push(...r.results);
  }
  return out;
}

const chunkOf = <T>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export interface LoadOpts {
  today: string;
  nowMs?: number;
  days?: number;
  /** One partner only: the drawer's card and the call brief. */
  cid?: string;
}

/** Everything the list needs, read from the mirror in a few queries, then shaped. */
export async function loadGifts(env: Env, q: Q, o: LoadOpts): Promise<Shaped> {
  const days = o.days || DEFAULT_DAYS;
  const since = addDays(o.today, -days);
  const gifts = o.cid
    ? await q<RawGift>(GIFTS_PARTNER_SQL, [since, o.cid, `%"constituent_id":"${o.cid}"%`])
    : await q<RawGift>(GIFTS_SINCE_SQL, [since]);
  // Every partner a gift counts for: the giver and each soft-credited partner.
  const cids = new Set<string>();
  for (const g of gifts) {
    cids.add(String(g.giver));
    for (const s of parse<any[]>(g.soft, [])) if (s?.constituent_id) cids.add(String(s.constituent_id));
  }
  const all = [...cids];
  const hold = async (): Promise<RawHold[]> => {
    const out: RawHold[] = [];
    for (const part of chunkOf(all, 400)) out.push(...(await q<RawHold>(HOLDS_SQL, [JSON.stringify(part), JSON.stringify(HOLD_TYPES), o.today])));
    return out;
  };
  const holds = await hold();
  const held = [...new Set(holds.map((h) => String(h.cid)))];
  // Only partners a director holds matter from here on; a giver of a soft credit counts as evidence of thanks, so include the givers of those gifts.
  const need = new Set(held);
  for (const g of gifts) {
    const soft = parse<any[]>(g.soft, []);
    if (soft.some((s) => held.includes(String(s?.constituent_id)))) need.add(String(g.giver));
  }
  const needList = [...need];
  const each = async <T>(sql: string, extra: unknown[] = []): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunkOf(needList, 400)) out.push(...(await q<T>(sql, [JSON.stringify(part), ...extra])));
    return out;
  };
  const fundIds = new Set<string>();
  for (const g of gifts) for (const s of parse<any[]>(g.splits, [])) if (s?.fund_id != null) fundIds.add(String(s.fund_id));
  const links = [...new Set(gifts.filter((g) => g.gtype === 'RecurringGiftPayment' && g.link).map((g) => String(g.link)))];
  const [evidence, facts, stats, last, phones, monthly, funds, fundraisers, thanks] = await Promise.all([
    each<RawEvidence>(EVIDENCE_SQL, [since]),
    each<RawFacts>(FACTS_SQL),
    each<RawStats>(STATS_SQL),
    each<RawLast>(LAST_SQL),
    each<RawPhone>(PHONES_SQL),
    links.length ? q<RawMonthly>(MONTHLY_SQL, [JSON.stringify(links)]) : Promise.resolve([] as RawMonthly[]),
    fundIds.size ? q<{ id: string; name: string }>(FUNDS_SQL, [JSON.stringify([...fundIds])]) : Promise.resolve([] as { id: string; name: string }[]),
    q<any>(FUNDRAISERS_SQL),
    hubThanks(env, gifts.map((g) => String(g.id))),
  ]);
  return shapeGifts(
    { gifts, holds, evidence, facts, stats, last, phones, monthly, funds, thanks, fundraisers: fundraisers.map((f: any) => ({ id: String(f.id), first: text(f.first), last: text(f.last), active: num(f.active) })) },
    { today: o.today, nowMs: o.nowMs || Date.now() }
  );
}

export const STAT_KEYS = ['owed', 'over24', 'first', 'big', 'week'] as const;
