// Grant actions (Work Center tab "Grants"): the RESERVED (Grant ...) actions on foundations, read from the D1 copy of Blackbaud. The grants
// team logged every request, letter of inquiry and report by hand in Blackbaud, with the PDF attached to the action. This lists them by
// foundation and kind, and the log form writes one action (and the file) in a single batch. Read only here: no Blackbaud calls.
//
// Mirror rules that shape the SQL: the endpoint refuses any statement whose text contains insert, update, replace, upsert, delete,
// drop, alter or create anywhere (readOnly checks it).
import { readOnly, FUNDRAISERS_SQL } from './repo';
import type { Q } from './partner';
import { addDays } from '../actions/completion';

export const KINDS = ['request', 'loi', 'report', 'task', 'cultivation', 'conversation'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_TYPE: Record<Kind, string> = {
  request: 'RESERVED (Grant Request)',
  loi: 'RESERVED (Grant LOI)',
  report: 'RESERVED (Grant Report)',
  task: 'RESERVED (Grant General Task)',
  cultivation: 'RESERVED (Grant Cultivation)',
  // A grant writer's own conversation with a funder (Rachel Cox, 2026-10-08): the Grants Action type, table entry 2624.
  conversation: 'Grants Action',
};
export const KIND_LABEL: Record<Kind, string> = { request: 'Request', loi: 'LOI', report: 'Report', task: 'General task', cultivation: 'Cultivation', conversation: 'Conversation' };
export const kindOfType = (t: string): Kind | null => (KINDS.find((k) => KIND_TYPE[k] === t) as Kind | undefined) ?? null;

/** How it was sent, and the Blackbaud category that records it. */
export const HOWS = ['portal', 'email', 'mail', 'call', 'meeting'] as const;
export type How = (typeof HOWS)[number];
export const HOW_CATEGORY: Record<How, string> = { portal: 'Task/Other', email: 'Email', mail: 'Mailing', call: 'Phone call', meeting: 'Meeting' };
export const HOW_LABEL: Record<How, string> = { portal: 'Funder portal or other', email: 'Email', mail: 'Mail', call: 'Call', meeting: 'Meeting' };

/** How far back the tab looks. */
export const GRANT_MONTHS = 24;

export const GRANTS_SQL = readOnly(`SELECT a.id AS id, a.constituent_record_id AS cid, a.action_type AS type, a.action_category AS category,
       substr(a.action_date_due, 1, 10) AS due, substr(a.action_completed_date, 1, 10) AS done, json_extract(a.raw_json, '$.completed') AS completed,
       a.action_summary AS summary, substr(COALESCE(a.action_description, ''), 1, 600) AS description, json_extract(a.raw_json, '$.fundraisers') AS frs,
       substr(a.date_added, 1, 10) AS added,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name,
       json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st
  FROM actions a LEFT JOIN constituents c ON c.id = a.constituent_record_id
 WHERE (a.action_type LIKE 'RESERVED (Grant%' OR a.action_type = 'Grants Action') AND substr(a.date_added, 1, 10) >= ?1
 ORDER BY COALESCE(substr(a.action_completed_date, 1, 10), substr(a.action_date_due, 1, 10)) DESC, a.id DESC LIMIT 700`);

const text = (v: unknown): string => (v == null ? '' : String(v));
function parse<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export interface GrantRow {
  id: string;
  cid: string;
  foundation: string;
  place: string;
  kind: Kind | null;
  kindLabel: string;
  category: string;
  /** The day it was sent, or the due date of a task still open. */
  date: string;
  open: boolean;
  summary: string;
  description: string;
  who: string[];
  /** The file the hub attached when it logged this one. Files attached in Blackbaud itself are not known here. */
  file: string | null;
  /** Logged from this tab and not yet read back from Blackbaud. */
  local?: boolean;
  /** A report: the award it reports on, the foundation's awarded opportunity closest before the due date. */
  award?: { id: string; name: string; amount: number; date: string; status: string } | null;
}

export interface RawGrant { id: string; cid: string; type: string; category: string; due: string; done: string; completed: unknown; summary: string; description: string; frs: unknown; added: string; name: string; city: string; st: string }

export function shape(raw: RawGrant[], names: Map<string, string>, files: Map<string, string>): GrantRow[] {
  return raw.map((r) => {
    const kind = kindOfType(text(r.type));
    const open = !(r.completed === 1 || r.completed === true || r.completed === '1' || r.completed === 'true');
    return {
      id: String(r.id), cid: String(r.cid), foundation: text(r.name) || `Record ${r.cid}`, place: [r.city, r.st].filter(Boolean).join(', '), kind,
      kindLabel: kind ? KIND_LABEL[kind] : text(r.type).replace(/^RESERVED \(Grant\s*/, '').replace(/\)$/, '') || 'Grant', category: text(r.category),
      date: open ? text(r.due) : text(r.done) || text(r.due), open, summary: text(r.summary), description: text(r.description),
      who: parse<unknown[]>(r.frs, []).map((f) => names.get(String(f)) || '').filter(Boolean), file: files.get(String(r.id)) || null,
    };
  });
}

const AWARDS_SQL = readOnly(`SELECT id AS id, constituent_record_id AS cid, name AS name, status AS status, COALESCE(funded_amount, ask_amount, 0) AS amount,
       substr(COALESCE(funded_date, ask_date, date_added), 1, 10) AS d FROM opportunities
 WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(inactive, 0) = 0 AND status LIKE 'Awarded%'`);

export interface RawAward { id: string; cid: string; name: string; status: string; amount: number; d: string }

/**
 * The award a report belongs to: the foundation's awarded opportunity, the one whose award date is closest before the report's date
 * (or the latest one when all come after). A name that carries the report's year wins a tie. None when the foundation has no award.
 */
export function awardFor(r: Pick<GrantRow, 'cid' | 'date'>, awards: RawAward[]): GrantRow['award'] {
  const mine = awards.filter((a) => String(a.cid) === String(r.cid));
  if (!mine.length) return null;
  const yr = (r.date || '').slice(0, 4);
  const score = (a: RawAward) => {
    const before = a.d && r.date && a.d <= r.date ? 1 : 0;
    const named = yr && String(a.name || '').includes(yr) ? 1 : 0;
    return [named, before, a.d || ''] as const;
  };
  const best = mine.slice().sort((a, b) => {
    const x = score(a), y = score(b);
    return y[0] - x[0] || y[1] - x[1] || (x[2] < y[2] ? 1 : x[2] > y[2] ? -1 : 0);
  })[0];
  return { id: String(best.id), name: text(best.name) || 'Award', amount: Number(best.amount) || 0, date: text(best.d), status: text(best.status) };
}

export async function loadGrants(q: Q, today: string, files: Map<string, string>): Promise<GrantRow[]> {
  const since = addDays(today, -GRANT_MONTHS * 31);
  const [raw, frs] = await Promise.all([q<RawGrant>(GRANTS_SQL, [since]), q<{ id: string; first: string; last: string }>(FUNDRAISERS_SQL, [])]);
  const names = new Map(frs.map((f) => [String(f.id), `${text(f.first)} ${text(f.last)}`.trim()]));
  const rows = shape(raw, names, files);
  const reportCids = [...new Set(rows.filter((r) => r.kind === 'report').map((r) => r.cid))];
  if (reportCids.length) {
    const awards = await q<RawAward>(AWARDS_SQL, [JSON.stringify(reportCids)]).catch(() => [] as RawAward[]);
    for (const r of rows) if (r.kind === 'report') r.award = awardFor(r, awards);
  }
  return rows;
}
