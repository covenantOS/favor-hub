// Churches: every church partner in the D1 mirror, who gave, who holds the relationship and when anyone last spoke to them. Read only.
//
// A church is a record with an active Church constituent code. Giving counts gifts whose own constituency is Church; the RecurringGift
// pledge row is left out because its payments are the gifts. The cadence is the Church Engagement manual's: thank at once, then call
// every three months, so the next call is the last contact (or the last gift, when nobody has spoken to them) plus 90 days.
import { openActionSql } from '../hub/actions';
import type { Q } from './partner';

export const CALL_EVERY_DAYS = 90;
export const SOON_DAYS = 21;

export const REGIONS = ['Southeast', 'South', 'Midwest', 'West', 'Northeast'] as const;
export type Region = (typeof REGIONS)[number] | 'Other';

const BY_STATE: Record<Exclude<Region, 'Other'>, string> = {
  Southeast: 'FL GA SC NC',
  South: 'AL MS LA TN KY AR TX OK VA WV',
  Midwest: 'OH IN IL MI WI MN IA MO KS NE SD ND',
  West: 'CA OR WA NV AZ UT CO ID MT WY NM AK HI',
  Northeast: 'ME NH VT MA RI CT NY NJ PA DE MD DC',
};
const REGION_OF = new Map<string, Region>();
for (const [r, list] of Object.entries(BY_STATE)) for (const s of list.split(' ')) REGION_OF.set(s, r as Region);
export const regionOf = (state: string | null | undefined): Region => REGION_OF.get(String(state || '').trim().toUpperCase()) || 'Other';

export interface ChurchRow {
  cid: string;
  lookup: string;
  name: string;
  city: string;
  state: string;
  region: Region;
  pastor: string | null;
  holder: string | null;
  ytd: number;
  lastYear: number;
  gifts: number;
  lastGift: string | null;
  lastContact: string | null;
  /** Gifts since January of last year that Blackbaud still lists as not acknowledged. */
  toThank: number;
  call: { by: string; overdue: boolean; soon: boolean } | null;
}

export interface ChurchesList {
  today: string;
  stats: { givingYtd: number; goal: number; churchesOnFile: number; churchesGave: number; giftsYtd: number; dueSoon: number; quiet90: number; quiet90Of: number; newsletter: number };
  rows: ChurchRow[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const CHURCH_CODE = `SELECT constituent_record_id FROM constituent_codes WHERE code_description = 'Church' AND COALESCE(is_inactive, 0) = 0`;
const CHURCH_GIFT = `gift_constituency = 'Church' AND gift_type <> 'RecurringGift' AND gift_amount > 0`;
const CONTACT = `action_category IN ('Email', 'Phone call', 'Meeting')
  AND (action_completed_date IS NOT NULL OR COALESCE(json_extract(raw_json, '$.completed'), 0) IN (1, 'true'))`;

/** `goal` is Church Engagement's annual goal for the year of `today`, read from fundraiser_goals by the caller (goals/store.ts churchGoal). */
export async function loadChurches(q: Q, today: string, goal: number): Promise<ChurchesList> {
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const lastStart = `${year - 1}-01-01`;
  const [gifts, totals, onFile, news] = await Promise.all([
    q<any>(
      `SELECT constituent_record_id AS cid, COUNT(*) AS n,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?1 THEN gift_amount ELSE 0 END) AS ytd,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?2 AND substr(gift_date, 1, 10) < ?1 THEN gift_amount ELSE 0 END) AS lastyr,
              MAX(substr(gift_date, 1, 10)) AS lastg,
              SUM(CASE WHEN acknowledgment_status = 'NotAcknowledged' THEN 1 ELSE 0 END) AS tothank
         FROM gifts WHERE ${CHURCH_GIFT} AND substr(gift_date, 1, 10) >= ?2 GROUP BY 1`,
      [yearStart, lastStart]
    ),
    q<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total, COUNT(DISTINCT constituent_record_id) AS churches FROM gifts WHERE ${CHURCH_GIFT} AND substr(gift_date, 1, 10) >= ?1`, [yearStart]),
    q<any>(`SELECT COUNT(DISTINCT c.id) AS n FROM constituents c WHERE c.id IN (${CHURCH_CODE}) AND COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0`),
    q<any>(
      `SELECT COUNT(DISTINCT c.id) AS n FROM constituents c JOIN emails e ON e.constituent_record_id = c.id
        WHERE c.id IN (${CHURCH_CODE}) AND COALESCE(c.inactive, 0) = 0 AND COALESCE(c.deceased, 0) = 0 AND COALESCE(c.requests_no_email, 0) = 0
          AND e.email_address LIKE '%@%'`
    ).catch(() => [{ n: 0 }]),
  ]);
  const ids = gifts.map((g: any) => String(g.cid));
  const J = JSON.stringify(ids);
  const [names, pastors, holders, contacts] = ids.length
    ? await Promise.all([
        q<any>(
          `SELECT id, constituent_lookup_id AS lk, COALESCE(NULLIF(trim(organization_name), ''), json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name,
                  json_extract(raw_json, '$.address.city') AS city, json_extract(raw_json, '$.address.state') AS st
             FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
          [J]
        ),
        q<any>(
          `SELECT constituent_id AS cid, name, type, position FROM constituent_relationships
            WHERE constituent_id IN (SELECT value FROM json_each(?1)) AND (type LIKE '%Pastor%' OR position LIKE '%Pastor%') AND end_date IS NULL`,
          [J]
        ),
        q<any>(
          `SELECT s.constituent_record_id AS cid, f.fundraiser_first_name || ' ' || f.fundraiser_last_name AS name
             FROM assignments s JOIN fundraisers f ON f.id = s.assignment_fundraiser_id
            WHERE s.constituent_record_id IN (SELECT value FROM json_each(?1)) AND s.assignment_type = 'Church Engagement Director'
              AND (s.assignment_to_date IS NULL OR substr(s.assignment_to_date, 1, 10) >= ?2)`,
          [J, today]
        ),
        q<any>(
          `SELECT constituent_record_id AS cid, MAX(substr(COALESCE(action_completed_date, action_date_due), 1, 10)) AS last
             FROM actions WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND ${CONTACT} GROUP BY 1`,
          [J]
        ),
      ])
    : [[], [], [], []];
  const nameBy = new Map(names.map((n: any) => [String(n.id), n]));
  const pastorBy = new Map<string, string>();
  const rank = (p: any) => (/senior|lead/i.test(`${p.position} ${p.type}`) ? 0 : /^pastor$/i.test(String(p.type || '')) ? 1 : 2);
  for (const p of [...pastors].sort((a: any, b: any) => rank(a) - rank(b))) if (!pastorBy.has(String(p.cid)) && p.name) pastorBy.set(String(p.cid), String(p.name));
  const holderBy = new Map<string, string>();
  for (const h of holders) if (!holderBy.has(String(h.cid))) holderBy.set(String(h.cid), String(h.name));
  const contactBy = new Map(contacts.map((c: any) => [String(c.cid), c.last ? String(c.last) : null]));

  const rows: ChurchRow[] = [];
  for (const g of gifts) {
    const cid = String(g.cid);
    const n = nameBy.get(cid);
    if (!n) continue;
    const lastContact = contactBy.get(cid) || null;
    const lastGift = g.lastg ? String(g.lastg) : null;
    const base = lastContact || lastGift;
    const by = base ? addDays(base, CALL_EVERY_DAYS) : null;
    const state = String(n.st || '');
    rows.push({
      cid,
      lookup: String(n.lk || ''),
      name: String(n.name || '').trim(),
      city: String(n.city || ''),
      state,
      region: regionOf(state),
      pastor: pastorBy.get(cid) || null,
      holder: holderBy.get(cid) || null,
      ytd: Math.round(num(g.ytd)),
      lastYear: Math.round(num(g.lastyr)),
      gifts: num(g.n),
      lastGift,
      lastContact,
      toThank: num(g.tothank),
      call: by ? { by, overdue: by < today, soon: by >= today && daysBetween(today, by) <= SOON_DAYS } : null,
    });
  }
  rows.sort((a, b) => b.ytd - a.ytd || b.lastYear - a.lastYear || a.name.localeCompare(b.name));
  const cutoff = addDays(today, -CALL_EVERY_DAYS);
  const quiet = rows.filter((r) => !r.lastContact || r.lastContact < cutoff).length;
  const t = totals[0] || {};
  return {
    today,
    stats: {
      givingYtd: Math.round(num(t.total)),
      goal,
      churchesOnFile: num(onFile[0] && onFile[0].n),
      churchesGave: num(t.churches),
      giftsYtd: num(t.n),
      dueSoon: rows.filter((r) => r.call && (r.call.overdue || r.call.soon)).length,
      quiet90: quiet,
      quiet90Of: rows.length,
      newsletter: num(news[0] && news[0].n),
    },
    rows,
  };
}

export interface ChurchDetail {
  cid: string;
  years: { year: number; total: number }[];
  people: { name: string; role: string }[];
  recent: { date: string; kind: string; summary: string; done: boolean }[];
  openTasks: number;
}

/** One church for the side panel: giving by year since three years back, the people at the church and the latest actions. */
export async function loadChurchDetail(q: Q, cid: string, today: string): Promise<ChurchDetail | null> {
  const ok = await q<any>(`SELECT 1 AS x FROM constituent_codes WHERE constituent_record_id = ?1 AND code_description = 'Church' AND COALESCE(is_inactive, 0) = 0 LIMIT 1`, [cid]);
  if (!ok.length) return null;
  const year = Number(today.slice(0, 4));
  const [yrs, ppl, acts, open] = await Promise.all([
    q<any>(
      `SELECT substr(gift_date, 1, 4) AS y, SUM(gift_amount) AS t FROM gifts WHERE constituent_record_id = ?1 AND gift_type <> 'RecurringGift' AND gift_amount > 0 AND substr(gift_date, 1, 4) >= ?2 GROUP BY 1`,
      [cid, String(year - 3)]
    ),
    q<any>(
      `SELECT name, COALESCE(NULLIF(position, ''), type) AS role FROM constituent_relationships WHERE constituent_id = ?1 AND end_date IS NULL AND name IS NOT NULL
        ORDER BY CASE WHEN type LIKE '%Pastor%' OR position LIKE '%Pastor%' THEN 0 ELSE 1 END, name LIMIT 8`,
      [cid]
    ),
    q<any>(
      `SELECT substr(COALESCE(action_completed_date, action_date_due), 1, 10) AS d, action_category AS cat, action_type AS type, action_summary AS s,
              CASE WHEN action_completed_date IS NOT NULL THEN 1 ELSE 0 END AS done
         FROM actions WHERE constituent_record_id = ?1 ORDER BY COALESCE(action_completed_date, action_date_due) DESC LIMIT 5`,
      [cid]
    ),
    q<any>(`SELECT COUNT(*) AS n FROM actions a WHERE a.constituent_record_id = ?1 AND ${openActionSql('a')}`, [cid]),
  ]);
  const by = new Map(yrs.map((r: any) => [Number(r.y), num(r.t)]));
  return {
    cid,
    years: [year - 3, year - 2, year - 1, year].map((y) => ({ year: y, total: Math.round(by.get(y) || 0) })),
    people: ppl.map((p: any) => ({ name: String(p.name), role: String(p.role || '') })),
    recent: acts.map((a: any) => ({ date: String(a.d || ''), kind: String(a.cat || a.type || ''), summary: String(a.s || ''), done: Number(a.done) === 1 })),
    openTasks: num(open[0] && open[0].n),
  };
}
