// Pieces the four partner and mailing lists share: the gift credit rule the KPI dashboard uses, the household rule,
// date arithmetic that matches the KPI worker, and name and address formatting.
//
// Credit rule (re-nxt-cloud-sync src/kpi-builders/donor-kpis.js): a gift counts for each soft credit recipient,
// otherwise for the constituent on the gift. Recurring gift setups (type RecurringGift) are left out and their
// payments count. Households are spouses linked by spouse_id, counted once.
import type { Row } from '../types';

export const SQL_MARK = (id: string) => `-- b3:${id}\n`;

/** Credited gifts up to ?1 (as of date). One row per recipient and gift. */
export const CREDIT_CTE = `
WITH g AS (
  SELECT id, DATE(gift_date) AS d, gift_amount AS amt, constituent_record_id AS cid,
         CASE WHEN soft_credits IS NOT NULL AND json_valid(soft_credits) THEN soft_credits ELSE '[]' END AS sc
  FROM gifts
  WHERE gift_amount > 0 AND gift_type <> 'RecurringGift' AND gift_date IS NOT NULL AND DATE(gift_date) <= ?1
),
cr AS (
  SELECT g.id AS gid, g.d AS d,
         MIN(g.amt, COALESCE(NULLIF(CAST(json_extract(j.value, '$.amount.value') AS REAL), 0), g.amt)) AS a,
         CAST(json_extract(j.value, '$.constituent_id') AS TEXT) AS rid
  FROM g, json_each(g.sc) AS j
  WHERE json_extract(j.value, '$.constituent_id') IS NOT NULL
  UNION ALL
  SELECT g.id, g.d, g.amt, g.cid FROM g
  WHERE g.cid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM json_each(g.sc) AS j2 WHERE json_extract(j2.value, '$.constituent_id') IS NOT NULL)
),
ranked AS (
  SELECT rid, gid, d, a,
         ROW_NUMBER() OVER (PARTITION BY rid ORDER BY d DESC, CAST(gid AS INTEGER) DESC) AS rl,
         ROW_NUMBER() OVER (PARTITION BY rid ORDER BY d ASC, CAST(gid AS INTEGER) ASC) AS rf,
         ROW_NUMBER() OVER (PARTITION BY rid ORDER BY a DESC, d DESC) AS rb,
         SUM(a) OVER (PARTITION BY rid) AS total,
         COUNT(*) OVER (PARTITION BY rid) AS n
  FROM cr
)`;

export interface Credit {
  rid: string;
  n: number;
  first_d: string;
  last_d: string;
  total: number;
  big: number;
  last_amt: number;
}

/** One row per credited constituent: first and last gift date, count, total, largest and the last amount. */
export const CREDIT_ROWS_SQL =
  SQL_MARK('credits') +
  CREDIT_CTE +
  `
SELECT l.rid AS rid, l.n AS n, f.d AS first_d, l.d AS last_d, ROUND(l.total, 2) AS total, b.a AS big, l.a AS last_amt
FROM ranked l
JOIN ranked f ON f.rid = l.rid AND f.rf = 1
JOIN ranked b ON b.rid = l.rid AND b.rb = 1
WHERE l.rl = 1`;

// ---- dates ----
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Calendar month arithmetic that clamps to the last day of the month, the same as the KPI worker. */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return iso(target);
}

// ---- households ----
export interface Con {
  id: string | number;
  spouse_id?: string | number | null;
  deceased?: number | null;
  inactive?: number | null;
}

export interface Households {
  hid(id: string | number): string;
  isLiving(h: string): boolean;
  members: Map<string, string[]>;
}

/** Spouses linked by spouse_id count once. A household drops out of LYBUNT and lapsed only when every known member is deceased or inactive. */
export function buildHouseholds(cons: Con[]): Households {
  const parent = new Map<string, string>();
  for (const c of cons) parent.set(String(c.id), String(c.id));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let node = x;
    while (parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  for (const c of cons) {
    const spouse = c.spouse_id == null ? null : String(c.spouse_id);
    if (!spouse || !parent.has(spouse)) continue;
    const a = find(String(c.id));
    const b = find(spouse);
    if (a === b) continue;
    if (Number(a) <= Number(b)) parent.set(b, a);
    else parent.set(a, b);
  }
  const living = new Map<string, boolean>();
  const members = new Map<string, string[]>();
  for (const c of cons) {
    const h = find(String(c.id));
    const alive = !Number(c.deceased) && !Number(c.inactive);
    living.set(h, Boolean(living.get(h)) || alive);
    const list = members.get(h);
    if (list) list.push(String(c.id));
    else members.set(h, [String(c.id)]);
  }
  return {
    hid: (id) => {
      const s = String(id);
      return parent.has(s) ? find(s) : s;
    },
    isLiving: (h) => living.get(h) ?? true,
    members,
  };
}

export type Status = 'active' | 'lybunt' | 'lapsed' | 'gone';

/** The KPI rule: a gift after t12 is active; otherwise a living household whose last gift is after t24 is LYBUNT, a living one before is lapsed. */
export function statusOf(last: string, living: boolean, t12: string, t24: string): Status {
  if (last > t12) return 'active';
  if (living && last > t24) return 'lybunt';
  if (living) return 'lapsed';
  return 'gone';
}

export interface HouseholdGiving {
  hid: string;
  first: string;
  last: string;
  n: number;
  total: number;
  big: number;
  lastAmt: number;
  living: boolean;
}

/** Group the credited constituents by household and say where each one stands. */
export function groupGiving(credits: Credit[], hh: Households): Map<string, HouseholdGiving> {
  const out = new Map<string, HouseholdGiving>();
  for (const c of credits) {
    const h = hh.hid(c.rid);
    const cur = out.get(h);
    if (!cur) {
      out.set(h, { hid: h, first: c.first_d, last: c.last_d, n: Number(c.n), total: Number(c.total), big: Number(c.big), lastAmt: Number(c.last_amt), living: hh.isLiving(h) });
      continue;
    }
    if (c.first_d < cur.first) cur.first = c.first_d;
    if (c.last_d > cur.last || (c.last_d === cur.last && Number(c.last_amt) > cur.lastAmt)) {
      cur.last = c.last_d;
      cur.lastAmt = Number(c.last_amt);
    }
    cur.n += Number(c.n);
    cur.total = Math.round((cur.total + Number(c.total)) * 100) / 100;
    if (Number(c.big) > cur.big) cur.big = Number(c.big);
  }
  return out;
}

export function countStatus(giving: Map<string, HouseholdGiving>, t12: string, t24: string): { active: number; lybunt: number; lapsed: number } {
  const n = { active: 0, lybunt: 0, lapsed: 0 };
  for (const g of giving.values()) {
    const s = statusOf(g.last, g.living, t12, t24);
    if (s !== 'gone') n[s] += 1;
  }
  return n;
}

// ---- names and addresses ----
export interface Person {
  id?: string;
  lookup?: string | null;
  type?: string | null;
  first?: string | null;
  last?: string | null;
  org?: string | null;
  sf?: string | null;
  sl?: string | null;
}

const t = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** "Jerry & Diana Mokma", "Jerry Mokma & Diana Smith", or the organization name. */
export function displayName(p: Person): string {
  if (t(p.org) && !t(p.first) && !t(p.last)) return t(p.org);
  const first = t(p.first);
  const last = t(p.last);
  const sf = t(p.sf);
  const sl = t(p.sl);
  if (sf) {
    if (!sl || sl === last) return `${first} & ${sf} ${last}`.replace(/\s+/g, ' ').trim();
    return `${first} ${last} & ${sf} ${sl}`.replace(/\s+/g, ' ').trim();
  }
  return `${first} ${last}`.replace(/\s+/g, ' ').trim() || t(p.org);
}

/** "Jerry and Diana" for a couple, "Jerry" alone. */
export function salutation(p: Person): string {
  const first = t(p.first);
  const sf = t(p.sf);
  if (!first && t(p.org)) return t(p.org);
  return sf ? `${first} and ${sf}` : first;
}

/** Address lines come as one text with line breaks. */
export function splitLines(lines: unknown): { line1: string; line2: string } {
  const parts = t(lines)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return { line1: parts[0] || '', line2: parts.slice(1).join(', ') };
}

export const like = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';

/** Fundraiser assignments that are still open, as "Name" for a person and "Partner Care" for the team. */
export function holderLabel(rows: Row[]): string {
  const names: string[] = [];
  const add = (x: string) => {
    if (x && !names.includes(x)) names.push(x);
  };
  const rank = (type: string) => (/RDD|Regional/i.test(type) ? 0 : /Church/i.test(type) ? 1 : /Foundation/i.test(type) ? 2 : /Partner Care/i.test(type) ? 3 : 4);
  const sorted = [...rows].sort((a, b) => rank(t(a.type)) - rank(t(b.type)));
  for (const r of sorted) {
    if (/Prospect Steward/i.test(t(r.type)) && rows.length > 1) continue;
    add(/Partner Care/i.test(t(r.type)) ? 'Partner Care' : `${t(r.first)} ${t(r.last)}`.trim());
  }
  return names.join(', ');
}

/** Run a list of ids through an IN-list query in chunks. */
export async function inChunks<T>(ids: string[], run: (json: string) => Promise<T[]>, size = 1500): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await run(JSON.stringify(ids.slice(i, i + size)))));
  return out;
}
