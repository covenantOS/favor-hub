// My partners: every partner a director holds, with who has gone quiet and what they give. Read only, from the D1 mirror.
//
// "Held" means a current assignment of the director as Regional Development Director, Prospect Steward or Church Engagement
// Director. A contact is a completed Email, Phone call or Meeting action. Mailings are left out on purpose: a printed receipt
// letter is not a relationship touch. Giving counts gifts the partner gave plus soft credits that name them.
import { openActionSql } from '../hub/actions';
import type { Q } from './partner';

/** Assignment types that make a partner part of a director's portfolio. */
export const HELD_TYPES = "('Regional Development Director (RDD)', 'Prospect Steward', 'Church Engagement Director')";
const GIVEN = "('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')";

export interface PortfolioRow {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  /** Days since the last contact, or null when the mirror holds none. */
  quiet: number | null;
  last: { date: string; how: string } | null;
  gift: { date: string; amount: number } | null;
  l12: number;
  p12: number;
  life: number;
  gifts: number;
  /** Gave in the calendar year to date / in the calendar year before. */
  ytd: number;
  lastYear: number;
  next: { id: string; due: string; summary: string; planned?: boolean } | null;
  phone: string | null;
  /** The partner has a phone on file, but every number is marked do not call. */
  dnc: boolean;
}

export interface Portfolio {
  fid: string;
  today: string;
  held: number;
  rows: PortfolioRow[];
  stats: { held: number; quiet90: number; gaveNoContact: number; lapsed: number; noPhone: number };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const addYears = (ymd: string, n: number) => `${Number(ymd.slice(0, 4)) + n}${ymd.slice(4)}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const HOW: Record<string, string> = { 'Phone call': 'Call', Email: 'Email', Meeting: 'Visit' };

/** The partners a fundraiser holds right now. */
export async function heldIds(q: Q, fid: string, today: string): Promise<string[]> {
  const rows = await q<{ cid: string }>(
    `SELECT DISTINCT constituent_record_id AS cid FROM assignments
      WHERE assignment_fundraiser_id = ?1 AND assignment_type IN ${HELD_TYPES} AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?2)`,
    [fid, today]
  );
  return rows.map((r) => String(r.cid));
}

/** What the hub has saved for these partners and not yet sent to Blackbaud: new open tasks (Plan calls, + Task). */
export interface PlannedTask {
  cid: string;
  id: string;
  due: string;
  summary: string;
}

export async function loadPortfolio(q: Q, fid: string, today: string, planned: PlannedTask[] = []): Promise<Portfolio> {
  const ids = await heldIds(q, fid, today);
  const J = JSON.stringify(ids);
  const y1 = addYears(today, -1);
  const y2 = addYears(today, -2);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const lastStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
  if (!ids.length) return { fid, today, held: 0, rows: [], stats: { held: 0, quiet90: 0, gaveNoContact: 0, lapsed: 0, noPhone: 0 } };

  const [names, gifts, contacts, phones, opens, soft] = await Promise.all([
    q<any>(
      `SELECT id, COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name,
              json_extract(raw_json, '$.address.city') AS city, json_extract(raw_json, '$.address.state') AS st, COALESCE(deceased, 0) AS gone, COALESCE(inactive, 0) AS off,
              constituent_lookup_id AS lk
         FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
      [J]
    ),
    q<any>(
      `SELECT constituent_record_id AS cid, COUNT(*) AS n, SUM(gift_amount) AS total,
              SUM(CASE WHEN substr(gift_date, 1, 10) > ?2 THEN gift_amount ELSE 0 END) AS l12,
              SUM(CASE WHEN substr(gift_date, 1, 10) > ?3 AND substr(gift_date, 1, 10) <= ?2 THEN gift_amount ELSE 0 END) AS p12,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?4 THEN gift_amount ELSE 0 END) AS ytd,
              SUM(CASE WHEN substr(gift_date, 1, 10) >= ?5 AND substr(gift_date, 1, 10) < ?4 THEN gift_amount ELSE 0 END) AS lastyr,
              MAX(substr(gift_date, 1, 10) || '|' || gift_amount) AS lastg
         FROM gifts WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND gift_amount > 0 AND gift_type IN ${GIVEN} GROUP BY 1`,
      [J, y1, y2, yearStart, lastStart]
    ),
    q<any>(
      `SELECT constituent_record_id AS cid, MAX(substr(COALESCE(action_completed_date, action_date_due), 1, 10) || '|' || action_category) AS lastc
         FROM actions a WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND action_category IN ('Email', 'Phone call', 'Meeting')
          AND (action_completed_date IS NOT NULL OR COALESCE(json_extract(raw_json, '$.completed'), 0) IN (1, 'true')) GROUP BY 1`,
      [J]
    ),
    q<any>(
      `SELECT constituent_record_id AS cid, COUNT(*) AS n, MAX(CASE WHEN COALESCE(do_not_call, 0) = 0 THEN phone_number END) AS num
         FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 GROUP BY 1`,
      [J]
    ),
    q<any>(
      `SELECT a.id AS id, a.constituent_record_id AS cid, substr(a.action_date_due, 1, 10) AS due, a.action_summary AS summary
         FROM actions a WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND ${openActionSql('a')} ORDER BY a.action_date_due`,
      [J]
    ),
    // Soft credits name a partner inside the gift's JSON, so one read of the few gifts that carry any is cheaper than a text match per partner.
    q<any>(`SELECT substr(gift_date, 1, 10) AS d, soft_credits AS soft FROM gifts WHERE soft_credits IS NOT NULL AND soft_credits NOT IN ('', '[]') AND gift_amount > 0`),
  ]);

  const byG = new Map(gifts.map((g: any) => [String(g.cid), g]));
  const byC = new Map(contacts.map((c: any) => [String(c.cid), String(c.lastc || '')]));
  const byP = new Map(phones.map((p: any) => [String(p.cid), p]));
  const next = new Map<string, { id: string; due: string; summary: string; planned?: boolean }>();
  for (const o of opens) {
    const k = String(o.cid);
    if (!next.has(k)) next.set(k, { id: String(o.id), due: String(o.due || ''), summary: String(o.summary || '') });
  }
  for (const p of planned) {
    const k = String(p.cid);
    const have = next.get(k);
    if (!have || (p.due && p.due < have.due) || !have.due) {
      if (!have || have.id !== p.id) next.set(k, { id: p.id, due: p.due, summary: p.summary, planned: true });
    }
  }
  // Soft credits: add each credit that names a held partner, in the same windows as their own gifts.
  const idSet = new Set(ids);
  const sc = new Map<string, { total: number; l12: number; p12: number; ytd: number; lastyr: number }>();
  for (const g of soft) {
    let list: any[] = [];
    try {
      list = JSON.parse(String(g.soft));
    } catch {
      continue;
    }
    for (const s of list) {
      const cid = String(s && s.constituent_id);
      if (!idSet.has(cid)) continue;
      const amt = num(s.amount && s.amount.value);
      if (!(amt > 0)) continue;
      const d = String(g.d);
      const r = sc.get(cid) || { total: 0, l12: 0, p12: 0, ytd: 0, lastyr: 0 };
      r.total += amt;
      if (d > y1) r.l12 += amt;
      else if (d > y2) r.p12 += amt;
      if (d >= yearStart) r.ytd += amt;
      else if (d >= lastStart) r.lastyr += amt;
      sc.set(cid, r);
    }
  }

  const rows: PortfolioRow[] = [];
  for (const n of names) {
    if (Number(n.gone) === 1 || Number(n.off) === 1) continue;
    const cid = String(n.id);
    const g = byG.get(cid) as any;
    const s = sc.get(cid);
    const lastc = byC.get(cid) || '';
    const [cd, cat] = lastc.split('|');
    const [gd, ga] = String(g && g.lastg ? g.lastg : '').split('|');
    const ph = byP.get(cid) as any;
    const place = [n.city, n.st].filter(Boolean).join(', ');
    rows.push({
      cid,
      lookup: String(n.lk || ''),
      name: String(n.name || `Record ${cid}`),
      place,
      quiet: cd ? Math.max(0, daysBetween(cd, today)) : null,
      last: cd ? { date: cd, how: HOW[cat] || cat } : null,
      gift: gd ? { date: gd, amount: num(ga) } : null,
      l12: num(g && g.l12) + (s ? s.l12 : 0),
      p12: num(g && g.p12) + (s ? s.p12 : 0),
      life: num(g && g.total) + (s ? s.total : 0),
      gifts: num(g && g.n),
      ytd: num(g && g.ytd) + (s ? s.ytd : 0),
      lastYear: num(g && g.lastyr) + (s ? s.lastyr : 0),
      next: next.get(cid) || null,
      phone: ph && ph.num ? String(ph.num) : null,
      dnc: !!ph && Number(ph.n) > 0 && !ph.num,
    });
  }
  rows.sort((a, b) => b.l12 - a.l12 || b.life - a.life || a.name.localeCompare(b.name));
  return { fid, today, held: rows.length, rows, stats: statsOf(rows) };
}

export const isQuiet = (r: PortfolioRow, days: number) => r.quiet === null || r.quiet >= days;
export const gaveNoContact = (r: PortfolioRow) => r.ytd > 0 && (r.quiet === null || r.quiet >= 30);
export const isLapsed = (r: PortfolioRow) => r.lastYear > 0 && r.ytd <= 0;

export function statsOf(rows: PortfolioRow[]) {
  return {
    held: rows.length,
    quiet90: rows.filter((r) => isQuiet(r, 90)).length,
    gaveNoContact: rows.filter(gaveNoContact).length,
    lapsed: rows.filter(isLapsed).length,
    noPhone: rows.filter((r) => !r.phone).length,
  };
}
