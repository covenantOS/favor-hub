// One partner, read from the D1 mirror: contact details, household, giving, recurring gifts, actions, notes, assignments, iWave,
// last contact, opportunities and constituent codes. The Work Center's partner page, its side panel and the iPhone route all read
// this one module, so a partner reads the same everywhere. Read only; nothing here writes to Blackbaud or to the mirror.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it), and a list of ids goes in as one JSON parameter read with json_each(?).
import type { Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { openActionSql } from '../hub/actions';
import { etParts } from '../actions/intake';
import { FUNDRAISERS_SQL, SYNCED_SQL, readOnly, type ActionsRepo, type PartnerHit } from './repo';

export type Q = <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** The gift types that count as money received. A RecurringGift row is the pledge; its payments are the gifts. */
const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";
/** Categories that count as a contact with the partner. Task/Other is paperwork. */
const CONTACT_CATEGORIES = "('Email', 'Phone call', 'Meeting', 'Mailing')";

export const SYSTEM_ID = /^\d{1,12}$/;

const ACTION_COLUMNS = `a.id AS id, substr(a.action_date_due, 1, 10) AS due, substr(a.action_completed_date, 1, 10) AS done,
       substr(a.date_added, 1, 10) AS added, a.action_type AS type, a.action_category AS category, a.action_summary AS summary,
       substr(COALESCE(a.action_description, ''), 1, 1500) AS description, a.action_direction AS direction,
       json_extract(a.raw_json, '$.outcome') AS outcome, json_extract(a.raw_json, '$.fundraisers') AS frs,
       json_extract(a.raw_json, '$.completed') AS completed`;

export interface PartnerGift {
  id: string;
  amount: number;
  date: string;
  type: string;
  fund: string;
  status: string;
  /** Set when the credit is a soft credit to this partner for someone else's gift. */
  soft: boolean;
  comment: string;
}

export interface PartnerAction {
  id: string;
  due: string;
  done: string;
  added: string;
  type: string;
  category: string;
  summary: string;
  description: string;
  direction: string;
  outcome: string;
  open: boolean;
  fundraisers: { id: string; name: string }[];
}

export interface PartnerView {
  id: string;
  lookup: string;
  name: string;
  kind: 'Individual' | 'Organization';
  place: string;
  deceased: boolean;
  inactive: boolean;
  addedOn: string;
  contact: {
    address: { lines: string; city: string; state: string; zip: string; country: string; doNotMail: boolean } | null;
    otherAddresses: number;
    emails: { address: string; primary: boolean; doNotEmail: boolean }[];
    phones: { number: string; type: string; primary: boolean; doNotCall: boolean }[];
  };
  household: { id: string; name: string; lookup: string; relation: string }[];
  giving: {
    total: number;
    count: number;
    firstDate: string;
    ytd: number;
    last12: number;
    years: { year: string; total: number; count: number; soft: number }[];
    largest: PartnerGift | null;
    last: PartnerGift | null;
    recent: PartnerGift[];
    soft: { total: number; count: number; recent: PartnerGift[] };
  };
  recurring: { id: string; amount: number; status: string; since: string; fund: string; lastPayment: string; lastAmount: number | null; payments: number }[];
  actions: { openCount: number; open: PartnerAction[]; recent: PartnerAction[] };
  notes: { id: string; date: string; type: string; category: string; summary: string; text: string; by: string }[];
  assignments: { fid: string; name: string; type: string; from: string; to: string; current: boolean }[];
  iwave: {
    overall: number | null;
    affinity: number | null;
    propensity: number | null;
    rfm: number | null;
    capacity: number | null;
    capacityBand: string;
    ratedOn: string;
    source: string;
  } | null;
  lastContact: { date: string; category: string; type: string; summary: string; by: string } | null;
  opportunities: { id: string; name: string; purpose: string; status: string; ask: number; expected: number; funded: number; askDate: string; expectedDate: string; fundedDate: string; deadline: string; by: string[] }[];
  codes: string[];
  flags: { doNotCall: boolean; doNotEmail: boolean; doNotMail: boolean };
  synced: string;
  /** The same partner as the iPhone contract's Partner card, so the mobile route returns it unchanged. */
  card: {
    id: string;
    name: string;
    place: string;
    phone: string | null;
    email: string | null;
    last_gift_cents: number | null;
    last_gift_date: string | null;
    year_to_date_cents: number;
    last_contact_date: string | null;
    last_contact_kind: 'call' | 'visit' | 'text' | null;
  };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');
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

function fundIdsOf(splits: unknown): string[] {
  const out: string[] = [];
  for (const s of parse<any[]>(splits, [])) if (s && s.fund_id != null) out.push(String(s.fund_id));
  return out;
}

const centsOf = (n: number) => Math.round(n * 100);

function kindOf(category: string): 'call' | 'visit' | 'text' | null {
  const c = category.toLowerCase();
  if (c.includes('phone')) return 'call';
  if (c.includes('meeting')) return 'visit';
  if (c.includes('email') || c.includes('mailing')) return 'text';
  return null;
}

/** The mirror's own reader, bound to one environment. Tests pass a stand-in with the same signature. */
export function mirrorQ(env: Env): Q {
  return (sql, params = []) => mirror(env, readOnly(sql), params) as Promise<any[]>;
}

export async function loadPartner(q: Q, id: string, today: string = etParts(new Date()).date): Promise<PartnerView | null> {
  if (!SYSTEM_ID.test(id)) return null;
  const rows = await q<any>(
    `SELECT id, constituent_lookup_id AS lookup, constituent_type AS ctype, first_name AS first, last_name AS last, preferred_name AS preferred,
            organization_name AS org, title, spouse_id AS spouse, spouse_first_name AS sfirst, spouse_last_name AS slast, inactive, deceased,
            substr(date_added, 1, 10) AS added, raw_json AS raw FROM constituents WHERE id = ?1`,
    [id]
  );
  const k = rows[0];
  if (!k) return null;
  const raw = parse<any>(k.raw, {});
  const yearStart = today.slice(0, 4) + '-01-01';
  const lastYear = String(Number(today.slice(0, 4)) - 1) + today.slice(4);
  const like = `%"constituent_id":"${id}"%`;

  const [emails, phones, addresses, own, byYear, largest, lastGift, ytdRow, last12Row, softRows, recurringRows, paymentRows, openRows, openN, doneRows, noteRows, contactRows,
    assigns, iwRows, bbIw, oppRows, codeRows, fundraisers, synced, spouseRows] = await Promise.all([
    q<any>('SELECT email_address AS address, is_primary AS prim, do_not_email AS dne FROM emails WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 8', [id]),
    q<any>('SELECT phone_number AS number, phone_type AS type, is_primary AS prim, do_not_call AS dnc FROM phones WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 8', [id]),
    q<any>(
      `SELECT address_lines AS lines, address_city AS city, address_state AS state, address_postal_code AS zip, address_country AS country, do_not_mail AS dnm, is_primary AS prim
         FROM addresses WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 6`,
      [id]
    ),
    q<any>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total, MIN(substr(gift_date, 1, 10)) AS first FROM gifts
        WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN}`,
      [id]
    ),
    q<any>(
      `SELECT substr(gift_date, 1, 4) AS yr, COUNT(*) AS n, SUM(gift_amount) AS total FROM gifts
        WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
      [id]
    ),
    q<any>(
      `SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS gdate, gift_type AS gtype, gift_status AS gstatus, gift_splits AS splits, gift_comments AS comment
         FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} ORDER BY gift_amount DESC, gift_date DESC LIMIT 1`,
      [id]
    ),
    q<any>(
      `SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS gdate, gift_type AS gtype, gift_status AS gstatus, gift_splits AS splits, gift_comments AS comment
         FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} ORDER BY gift_date DESC LIMIT 30`,
      [id]
    ),
    q<any>(`SELECT COALESCE(SUM(gift_amount), 0) AS total FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} AND substr(gift_date, 1, 10) >= ?2`, [id, yearStart]),
    q<any>(`SELECT COALESCE(SUM(gift_amount), 0) AS total FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ${GIVEN} AND substr(gift_date, 1, 10) > ?2`, [id, lastYear]),
    q<any>(
      `SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS gdate, gift_type AS gtype, gift_status AS gstatus, gift_splits AS splits, gift_comments AS comment, soft_credits AS soft
         FROM gifts WHERE soft_credits LIKE ?1 AND gift_amount > 0 ORDER BY gift_date DESC LIMIT 200`,
      [like]
    ),
    q<any>(
      `SELECT id, gift_amount AS amount, gift_status AS status, substr(gift_date, 1, 10) AS since, gift_splits AS splits FROM gifts
        WHERE constituent_record_id = ?1 AND gift_type = 'RecurringGift' ORDER BY CASE gift_status WHEN 'Active' THEN 0 WHEN 'Held' THEN 1 ELSE 2 END, gift_date DESC LIMIT 12`,
      [id]
    ),
    // Payments carry the same partner id, so they read through the partner index; linked_gift_id has no index of its own.
    q<any>(
      `SELECT linked_gift_id AS link, substr(gift_date, 1, 10) AS pdate, gift_amount AS amount FROM gifts
        WHERE constituent_record_id = ?1 AND gift_type = 'RecurringGiftPayment' AND linked_gift_id IS NOT NULL ORDER BY gift_date DESC LIMIT 600`,
      [id]
    ),
    q<any>(`SELECT ${ACTION_COLUMNS} FROM actions a WHERE a.constituent_record_id = ?1 AND ${openActionSql('a')} ORDER BY a.action_date_due LIMIT 25`, [id]),
    q<any>(`SELECT COUNT(*) AS n FROM actions a WHERE a.constituent_record_id = ?1 AND ${openActionSql('a')}`, [id]),
    q<any>(
      `SELECT ${ACTION_COLUMNS} FROM actions a WHERE a.constituent_record_id = ?1 AND NOT (${openActionSql('a')})
        ORDER BY COALESCE(a.action_completed_date, a.action_date_due, a.date_added) DESC LIMIT 15`,
      [id]
    ),
    q<any>(
      `SELECT ${ACTION_COLUMNS} FROM actions a WHERE a.constituent_record_id = ?1 AND length(trim(COALESCE(a.action_description, ''))) > 0
        ORDER BY COALESCE(a.action_completed_date, a.action_date_due, a.date_added) DESC LIMIT 12`,
      [id]
    ),
    q<any>(
      `SELECT ${ACTION_COLUMNS} FROM actions a WHERE a.constituent_record_id = ?1 AND NOT (${openActionSql('a')}) AND a.action_category IN ${CONTACT_CATEGORIES}
        ORDER BY COALESCE(a.action_completed_date, a.action_date_due) DESC LIMIT 1`,
      [id]
    ),
    q<any>(
      `SELECT assignment_fundraiser_id AS fid, assignment_type AS type, substr(assignment_from_date, 1, 10) AS fromd, substr(assignment_to_date, 1, 10) AS tod
         FROM assignments WHERE constituent_record_id = ?1 ORDER BY (assignment_to_date IS NULL) DESC, assignment_to_date DESC LIMIT 20`,
      [id]
    ),
    q<any>('SELECT overall, affinity, propensity, rfm, estimated_capacity AS cap, capacity_band AS band, capacity_low AS low, capacity_high AS high, overall_date AS odate, scored_at FROM iwave_ratings WHERE constituent_record_id = ?1', [id]),
    q<any>('SELECT score, capacity, score_date AS sdate, ratings_json AS ratings FROM bb_iwave_ratings WHERE constituent_record_id = ?1', [id]),
    q<any>(
      `SELECT id, name, purpose, status, ask_amount AS ask, expected_amount AS expected, funded_amount AS funded, substr(ask_date, 1, 10) AS askd,
              substr(expected_date, 1, 10) AS expd, substr(funded_date, 1, 10) AS fundd, substr(deadline, 1, 10) AS deadline, fundraisers AS frs
         FROM opportunities WHERE constituent_record_id = ?1 AND COALESCE(inactive, 0) = 0 ORDER BY date_added DESC LIMIT 20`,
      [id]
    ),
    q<any>("SELECT COALESCE(code_description, json_extract(raw_json, '$.description')) AS d FROM constituent_codes WHERE constituent_record_id = ?1 AND COALESCE(json_extract(raw_json, '$.inactive'), 0) = 0 LIMIT 20", [id]),
    q<any>(FUNDRAISERS_SQL),
    q<any>(SYNCED_SQL).catch(() => []),
    k.spouse
      ? q<any>('SELECT id, constituent_lookup_id AS lookup, first_name AS first, last_name AS last, preferred_name AS preferred, deceased FROM constituents WHERE id = ?1', [String(k.spouse)])
      : Promise.resolve([] as any[]),
  ]);

  // Names for fundraisers and funds.
  const fname = new Map<string, string>();
  for (const f of fundraisers) fname.set(String(f.id), `${f.first ?? ''} ${f.last ?? ''}`.trim() || `Fundraiser ${f.id}`);
  const fundIds = new Set<string>();
  for (const g of [...largest, ...lastGift, ...softRows, ...recurringRows]) for (const f of fundIdsOf(g.splits)) fundIds.add(f);
  const funds = new Map<string, string>();
  if (fundIds.size) {
    for (const f of await q<{ id: string; name: string }>('SELECT id AS id, fund_description AS name FROM funds WHERE id IN (SELECT value FROM json_each(?1))', [JSON.stringify([...fundIds])])) funds.set(String(f.id), f.name || '');
  }
  const fundOf = (splits: unknown) => [...new Set(fundIdsOf(splits).map((f) => funds.get(f) || ''))].filter(Boolean).join(', ');

  const giftOf = (g: any, soft = false): PartnerGift => ({
    id: String(g.id),
    amount: num(g.amount),
    date: text(g.gdate),
    type: text(g.gtype),
    fund: fundOf(g.splits),
    status: text(g.gstatus),
    soft,
    comment: text(g.comment).slice(0, 300),
  });
  const actionOf = (a: any, open: boolean): PartnerAction => ({
    id: String(a.id),
    due: text(a.due),
    done: text(a.done),
    added: text(a.added),
    type: text(a.type),
    category: text(a.category),
    summary: text(a.summary),
    description: text(a.description),
    direction: text(a.direction),
    outcome: text(a.outcome),
    open,
    fundraisers: parse<any[]>(a.frs, []).map((f) => ({ id: String(f), name: fname.get(String(f)) || `Fundraiser ${f}` })),
  });

  // Soft credits: the amount credited to this partner is the entry that names them, not the gift's full amount.
  const softGifts: PartnerGift[] = [];
  const softYears = new Map<string, { total: number; count: number }>();
  let softTotal = 0;
  for (const g of softRows) {
    const mine = parse<any[]>(g.soft, []).filter((s) => String(s.constituent_id) === id);
    if (!mine.length) continue;
    const amount = mine.reduce((t, s) => t + num(s.amount?.value), 0);
    if (!(amount > 0)) continue;
    softTotal += amount;
    const y = text(g.gdate).slice(0, 4);
    const row = softYears.get(y) || { total: 0, count: 0 };
    row.total += amount;
    row.count += 1;
    softYears.set(y, row);
    softGifts.push({ ...giftOf(g, true), amount });
  }

  const years = new Map<string, { year: string; total: number; count: number; soft: number }>();
  for (const y of byYear) years.set(text(y.yr), { year: text(y.yr), total: num(y.total), count: num(y.n), soft: 0 });
  for (const [y, v] of softYears) {
    const row = years.get(y) || { year: y, total: 0, count: 0, soft: 0 };
    row.soft = v.total;
    years.set(y, row);
  }

  // Contact details. The record's own address and the address table agree on the preferred one; the table lists the others.
  const prefAddr = addresses.find((a: any) => Number(a.prim) === 1) || addresses[0];
  const rawAddr = raw.address && (raw.address.address_lines || raw.address.city) ? raw.address : null;
  const addr = prefAddr
    ? { lines: text(prefAddr.lines).replace(/\r?\n/g, ', '), city: text(prefAddr.city), state: text(prefAddr.state), zip: text(prefAddr.zip), country: text(prefAddr.country), doNotMail: Number(prefAddr.dnm) === 1 }
    : rawAddr
      ? { lines: text(rawAddr.address_lines).replace(/\r?\n/g, ', '), city: text(rawAddr.city), state: text(rawAddr.state), zip: text(rawAddr.postal_code), country: text(rawAddr.country), doNotMail: !!rawAddr.do_not_mail }
      : null;
  const emailList = emails.map((e: any) => ({ address: text(e.address), primary: Number(e.prim) === 1, doNotEmail: Number(e.dne) === 1 }));
  if (!emailList.length && raw.email && raw.email.address) emailList.push({ address: text(raw.email.address), primary: true, doNotEmail: !!raw.email.do_not_email });
  const phoneList = phones.map((p: any) => ({ number: text(p.number), type: text(p.type), primary: Number(p.prim) === 1, doNotCall: Number(p.dnc) === 1 }));

  const kind: 'Individual' | 'Organization' = text(k.ctype) === 'Organization' || (!k.first && k.org) ? 'Organization' : 'Individual';
  const name = text(raw.name) || (kind === 'Organization' ? text(k.org) : `${text(k.first)} ${text(k.last)}`.trim()) || `Record ${id}`;
  const place = [addr?.city, addr?.state].filter(Boolean).join(', ');

  const household = spouseRows.map((s: any) => ({
    id: String(s.id),
    name: `${text(s.preferred) || text(s.first)} ${text(s.last)}`.trim() || `Record ${s.id}`,
    lookup: text(s.lookup),
    relation: 'Spouse',
  }));
  if (!household.length && k.spouse) household.push({ id: String(k.spouse), name: `${text(k.sfirst)} ${text(k.slast)}`.trim() || `Record ${k.spouse}`, lookup: '', relation: 'Spouse' });

  const lc = contactRows[0];
  const lcDate = lc ? text(lc.done) || text(lc.due) : '';
  const lcFrs = lc ? parse<any[]>(lc.frs, []).map((f) => fname.get(String(f)) || `Fundraiser ${f}`) : [];
  const lastContact = lc ? { date: lcDate, category: text(lc.category), type: text(lc.type), summary: text(lc.summary), by: lcFrs.join(', ') } : null;

  const i = iwRows[0];
  const b = bbIw[0];
  const bbRatings = parse<any[]>(b?.ratings, []);
  let iwave: PartnerView['iwave'] = null;
  if (i && (i.overall != null || i.cap != null || i.affinity != null || i.propensity != null || i.rfm != null)) {
    iwave = {
      overall: i.overall == null ? null : num(i.overall),
      affinity: i.affinity == null ? null : num(i.affinity),
      propensity: i.propensity == null ? null : num(i.propensity),
      rfm: i.rfm == null ? null : num(i.rfm),
      capacity: i.cap == null ? null : num(i.cap),
      capacityBand: text(i.band),
      ratedOn: day(i.odate) || day(i.scored_at),
      source: 'iWave',
    };
  } else if (b && (b.score != null || b.capacity != null || bbRatings.length)) {
    iwave = {
      overall: b.score == null ? null : num(b.score),
      affinity: null,
      propensity: null,
      rfm: null,
      capacity: b.capacity == null ? null : num(b.capacity),
      capacityBand: '',
      ratedOn: day(b.sdate),
      source: 'Blackbaud rating',
    };
  }

  const assignments = assigns.map((a: any) => {
    const to = text(a.tod);
    return { fid: String(a.fid), name: fname.get(String(a.fid)) || `Fundraiser ${a.fid}`, type: text(a.type), from: text(a.fromd), to, current: !to || to >= today };
  });

  // Payments arrive newest first, so the first one seen for a pledge is its last payment.
  const paid = new Map<string, { date: string; amount: number; n: number }>();
  for (const p of paymentRows) {
    const key = String(p.link);
    const seen = paid.get(key);
    if (seen) seen.n += 1;
    else paid.set(key, { date: text(p.pdate), amount: num(p.amount), n: 1 });
  }

  const total = num(own[0]?.total);
  const gifts = lastGift.map((g: any) => giftOf(g));
  const largestGift = largest[0] ? giftOf(largest[0]) : null;
  const lastOne = gifts[0] || null;
  const ytd = num(ytdRow[0]?.total);
  const phone = phoneList.find((p) => p.primary) || phoneList[0];
  const mail = emailList.find((e) => e.primary) || emailList[0];

  return {
    id,
    lookup: text(k.lookup),
    name,
    kind,
    place,
    deceased: Number(k.deceased) === 1,
    inactive: Number(k.inactive) === 1,
    addedOn: text(k.added),
    contact: {
      address: addr,
      otherAddresses: Math.max(0, addresses.length - 1),
      emails: emailList,
      phones: phoneList,
    },
    household,
    giving: {
      total,
      count: num(own[0]?.n),
      firstDate: text(own[0]?.first),
      ytd,
      last12: num(last12Row[0]?.total),
      years: [...years.values()].sort((a, c) => (a.year < c.year ? 1 : -1)),
      largest: largestGift,
      last: lastOne,
      recent: gifts.slice(0, 25),
      soft: { total: softTotal, count: softGifts.length, recent: softGifts.slice(0, 10) },
    },
    recurring: recurringRows.map((r: any) => ({
      id: String(r.id),
      amount: num(r.amount),
      status: text(r.status),
      since: text(r.since),
      fund: fundOf(r.splits),
      lastPayment: paid.get(String(r.id))?.date || '',
      lastAmount: paid.get(String(r.id))?.amount ?? null,
      payments: paid.get(String(r.id))?.n || 0,
    })),
    actions: { openCount: num(openN[0]?.n), open: openRows.map((a: any) => actionOf(a, true)), recent: doneRows.map((a: any) => actionOf(a, false)) },
    notes: noteRows.map((a: any) => ({
      id: String(a.id),
      date: text(a.done) || text(a.due) || text(a.added),
      type: text(a.type),
      category: text(a.category),
      summary: text(a.summary),
      text: text(a.description),
      by: parse<any[]>(a.frs, []).map((f) => fname.get(String(f)) || `Fundraiser ${f}`).join(', '),
    })),
    assignments,
    iwave,
    lastContact,
    opportunities: oppRows.map((o: any) => ({
      id: String(o.id),
      name: text(o.name),
      purpose: text(o.purpose),
      status: text(o.status),
      ask: num(o.ask),
      expected: num(o.expected),
      funded: num(o.funded),
      askDate: text(o.askd),
      expectedDate: text(o.expd),
      fundedDate: text(o.fundd),
      deadline: text(o.deadline),
      by: parse<any[]>(o.frs, []).map((f) => fname.get(String(f?.id ?? f)) || text(f?.name) || `Fundraiser ${f?.id ?? f}`),
    })),
    codes: [...new Set(codeRows.map((c: any) => text(c.d)).filter(Boolean))],
    flags: {
      doNotCall: phoneList.length > 0 && phoneList.every((p) => p.doNotCall),
      doNotEmail: emailList.length > 0 && emailList.every((e) => e.doNotEmail),
      doNotMail: !!addr?.doNotMail,
    },
    synced: (() => {
      const at = synced[0]?.at;
      return at ? (String(at).includes('T') ? String(at) : String(at).replace(' ', 'T') + 'Z') : '';
    })(),
    card: {
      id,
      name,
      place,
      phone: phone ? phone.number : null,
      email: mail ? mail.address : null,
      last_gift_cents: lastOne ? centsOf(lastOne.amount) : null,
      last_gift_date: lastOne ? lastOne.date : null,
      year_to_date_cents: centsOf(ytd),
      last_contact_date: lastContact ? lastContact.date : null,
      last_contact_kind: lastContact ? kindOf(lastContact.category) : null,
    },
  };
}

/**
 * Global search for the partner page: name, email and phone as the Entry type-ahead reads them, plus a lookup id or system id typed
 * alone, and a street address (a number and a word). Returns the same hit rows as ActionsRepo.partners so one list shape serves both.
 */
export async function searchPartners(repo: ActionsRepo, q: Q, raw: string, owner?: string, limit = 8): Promise<PartnerHit[]> {
  const t = raw.trim().slice(0, 80);
  if (t.length < 2) return [];
  if (/^\d{1,9}$/.test(t)) {
    const rows = await q<{ id: string }>('SELECT id FROM constituents WHERE (constituent_lookup_id = ?1 OR id = ?1) AND COALESCE(inactive, 0) = 0 LIMIT 5', [t]);
    if (rows.length) return repo.partnersByIds(rows.map((r) => String(r.id)));
    if (t.length < 7) return [];
  }
  if (!t.includes('@') && /\d/.test(t) && /[a-z]{3,}/i.test(t) && t.replace(/\D/g, '').length < 7) {
    const toks = t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1).slice(0, 5);
    if (toks.length >= 2) {
      const rows = await q<{ id: string }>(
        `SELECT DISTINCT constituent_record_id AS id FROM addresses WHERE COALESCE(is_inactive, 0) = 0 AND ${toks.map(() => '(lower(address_lines) LIKE ? OR lower(address_city) LIKE ?)').join(' AND ')} LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
        toks.flatMap((w) => [`%${w}%`, `%${w}%`])
      );
      if (rows.length) return repo.partnersByIds(rows.map((r) => String(r.id)));
    }
  }
  return repo.partners(t, owner, limit);
}
