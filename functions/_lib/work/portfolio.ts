// My partners: every partner a director holds, with who has gone quiet and what they give. Read only, from the D1 mirror.
//
// "Held" means a current assignment of the director as Regional Development Director, Prospect Steward or Church Engagement
// Director. A contact is a completed Email, Phone call or Meeting action. Mailings are left out on purpose: a printed receipt
// letter is not a relationship touch. Giving is the household's credited giving under the shared rule (shared/giving.ts, read through
// givingForMany): gifts the partner or spouse gave plus gifts sent through a DAF, foundation or business that name them, once each,
// RecurringGift schedules never counted, their payments counted.
import { openActionSql } from '../hub/actions';
import type { Q } from './partner';
import { givingForMany, type MirrorQ, type PartnerGiving } from '../gifts/partner-giving';
import { addMonths, throughName } from '../../../shared/giving';

/** Assignment types that make a partner part of a director's portfolio. */
export const HELD_TYPES = "('Regional Development Director (RDD)', 'Prospect Steward', 'Church Engagement Director')";

export interface PortfolioRow {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  /** Days since the last contact, or null when the mirror holds none. */
  quiet: number | null;
  last: { date: string; how: string } | null;
  /** The latest credited gift. soft is true when it was sent through another record (a DAF, foundation or business); through names it. */
  gift: { date: string; amount: number; soft?: boolean; through?: string } | null;
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
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const HOW: Record<string, string> = { 'Phone call': 'Call', Email: 'Email', Meeting: 'Visit' };

/** Household giving for these partners under the shared credit rule, read in chunks so one mirror read stays small. */
async function creditedGiving(q: Q, ids: string[], today: string) {
  const out = new Map<string, PartnerGiving>();
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += 400) parts.push(ids.slice(i, i + 400));
  for (const m of await Promise.all(parts.map((p) => givingForMany(q as unknown as MirrorQ, p, today)))) for (const [k, v] of m) out.set(k, v);
  return out;
}

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
  const y1 = addMonths(today, -12);
  const y2 = addMonths(today, -24);
  const lastYearKey = String(Number(today.slice(0, 4)) - 1);
  if (!ids.length) return { fid, today, held: 0, rows: [], stats: { held: 0, quiet90: 0, gaveNoContact: 0, lapsed: 0, noPhone: 0 } };

  const [names, giving, contacts, phones, opens] = await Promise.all([
    q<any>(
      `SELECT id, COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name,
              json_extract(raw_json, '$.address.city') AS city, json_extract(raw_json, '$.address.state') AS st, COALESCE(deceased, 0) AS gone, COALESCE(inactive, 0) AS off,
              constituent_lookup_id AS lk
         FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`,
      [J]
    ),
    creditedGiving(q, ids, today),
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
  ]);

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
  const rows: PortfolioRow[] = [];
  for (const n of names) {
    if (Number(n.gone) === 1 || Number(n.off) === 1) continue;
    const cid = String(n.id);
    const g = giving.get(cid);
    const lastG = g ? g.gifts[0] : undefined;
    const via = lastG && lastG.via ? g!.through.find((t) => t.id === lastG.via) : undefined;
    const lastc = byC.get(cid) || '';
    const [cd, cat] = lastc.split('|');
    const ph = byP.get(cid) as any;
    const place = [n.city, n.st].filter(Boolean).join(', ');
    rows.push({
      cid,
      lookup: String(n.lk || ''),
      name: String(n.name || '').replace(/\s+/g, ' ').trim() || `Record ${cid}`,
      place,
      quiet: cd ? Math.max(0, daysBetween(cd, today)) : null,
      last: cd ? { date: cd, how: HOW[cat] || cat } : null,
      gift: lastG ? { date: lastG.date, amount: lastG.amount, ...(via ? { soft: true, through: throughName(via) } : lastG.via ? { soft: true } : {}) } : null,
      l12: g ? g.last12 : 0,
      p12: g ? Math.round(g.gifts.filter((x) => x.date > y2 && x.date <= y1).reduce((t, x) => t + x.amount, 0) * 100) / 100 : 0,
      life: g ? g.total : 0,
      gifts: g ? g.count : 0,
      ytd: g ? g.ytd : 0,
      lastYear: g ? g.years.find((y) => y.year === lastYearKey)?.total || 0 : 0,
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
