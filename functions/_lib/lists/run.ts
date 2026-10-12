// Runs a list spec against the lr_* snapshot: the live count, a page of rows, every row for an export, the menus the builder
// offers and the tie-out against the KPI dashboard. The database is passed in as a function so tests can use node:sqlite.
import { compile, emptySpec, plan, type ListSpec, type Scope, MAX_ROWS } from './criteria.ts';

type Row = Record<string, any>;
export type Q = (sql: string, params: unknown[]) => Promise<Row[]>;

/** D1 wants exactly as many bound values as the highest ?N in the statement. */
export function bindFor(sql: string, params: unknown[]): unknown[] {
  const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return used.length ? params.slice(0, Math.max(...used)) : [];
}

const exec = (q: Q, sql: string, params: unknown[]) => q(sql, bindFor(sql, params));

export interface Counted {
  n: number;
  total: number;
  partners: number;
}

export async function countList(q: Q, spec: ListSpec, today: string, scope: Scope): Promise<Counted> {
  const pl = plan(spec, today, scope, { limit: 1, offset: 0 });
  const r = (await exec(q, pl.countSql, pl.params))[0] || {};
  return { n: Number(r.n || 0), total: Number(r.total || 0), partners: Number(r.partners || 0) };
}

export interface Page {
  columns: Array<{ key: string; label: string; type: string }>;
  rows: Row[];
  count: Counted;
  page: number;
  pageSize: number;
}

export interface Live {
  /** Read-only SQL against the Blackbaud mirror. */
  mirror: Q;
  /** May this person see email addresses and phone numbers. */
  contacts: boolean;
}

const MAIL_SQL = `SELECT c.id AS rid, c.primary_addressee AS addressee, c.primary_salutation AS salutation, a.address_lines AS address FROM constituents c
  LEFT JOIN addresses a ON a.id = CASE WHEN EXISTS (SELECT 1 FROM addresses p WHERE p.id = c.primary_address_id AND COALESCE(p.is_inactive, 0) = 0) THEN c.primary_address_id
    ELSE (SELECT x.id FROM addresses x WHERE x.constituent_record_id = c.id AND COALESCE(x.is_inactive, 0) = 0 ORDER BY COALESCE(x.is_primary, 0) DESC, x.date_modified DESC LIMIT 1) END
  WHERE c.id IN (SELECT value FROM json_each(?1))`;
const EMAIL_SQL = `SELECT constituent_record_id AS rid, email_address AS v FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 AND COALESCE(do_not_email, 0) = 0 AND email_address IS NOT NULL ORDER BY COALESCE(is_primary, 0) DESC`;
const PHONE_SQL = `SELECT constituent_record_id AS rid, phone_number AS v FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND COALESCE(is_inactive, 0) = 0 AND COALESCE(do_not_call, 0) = 0 AND phone_number IS NOT NULL ORDER BY COALESCE(is_primary, 0) DESC`;

/** Fill the mailing and contact columns from the mirror for the rows in hand, in chunks. The snapshot never holds them. */
export async function fillLive(rows: Row[], cols: Array<{ key: string; live?: string }>, live?: Live): Promise<void> {
  const need = cols.filter((c) => c.live);
  if (!need.length || !live || !rows.length) return;
  const rids = [...new Set(rows.map((r) => String(r._rid || '')).filter(Boolean))];
  const by = new Map<string, Row>();
  const get = (rid: string) => by.get(rid) || by.set(rid, {}).get(rid)!;
  for (let i = 0; i < rids.length; i += 2500) {
    const json = JSON.stringify(rids.slice(i, i + 2500));
    const [mail, email, phone] = await Promise.all([
      need.some((c) => c.live === 'mail') ? live.mirror(MAIL_SQL, [json]) : Promise.resolve([]),
      need.some((c) => c.key === 'email') ? live.mirror(EMAIL_SQL, [json]) : Promise.resolve([]),
      need.some((c) => c.key === 'phone') ? live.mirror(PHONE_SQL, [json]) : Promise.resolve([]),
    ]);
    for (const m of mail) Object.assign(get(String(m.rid)), { addressee: m.addressee, salutation: m.salutation, address: m.address ? String(m.address).split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join(', ') : '' });
    for (const e of email) if (get(String(e.rid)).email === undefined) get(String(e.rid)).email = e.v;
    for (const p of phone) if (get(String(p.rid)).phone === undefined) get(String(p.rid)).phone = p.v;
  }
  for (const r of rows) Object.assign(r, by.get(String(r._rid)) || {});
}

/** How many partners the mail-ready rule leaves out of this list. */
export async function mailLeftOut(q: Q, spec: ListSpec, today: string, scope: Scope): Promise<number> {
  if (!spec.partner.mailReady || spec.kind !== 'partners') return 0;
  const all = await countList(q, { ...spec, partner: { ...spec.partner, mailReady: false } }, today, scope);
  const kept = await countList(q, spec, today, scope);
  return all.n - kept.n;
}

export async function pageOf(q: Q, spec: ListSpec, today: string, scope: Scope, page: number, pageSize: number, live?: Live): Promise<Page> {
  const count = await countList(q, spec, today, scope);
  const pl = plan(spec, today, scope, { limit: pageSize, offset: Math.max(0, page - 1) * pageSize, contacts: live?.contacts });
  const rows = await exec(q, pl.listSql, pl.params);
  await fillLive(rows, pl.columns, live);
  return { columns: pl.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, count, page, pageSize };
}

/** Every matching row, capped at MAX_ROWS, for CSV and Sheets. */
export async function allRows(q: Q, spec: ListSpec, today: string, scope: Scope, live?: Live): Promise<Pick<Page, 'columns' | 'rows'> & { capped: boolean; count: Counted }> {
  const count = await countList(q, spec, today, scope);
  const pl = plan(spec, today, scope, { limit: MAX_ROWS, offset: 0, contacts: live?.contacts });
  const rows = await exec(q, pl.listSql, pl.params);
  await fillLive(rows, pl.columns, live);
  return { columns: pl.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, capped: count.n > MAX_ROWS, count };
}

export interface Menus {
  states: string[];
  funds: Array<{ id: string; name: string; category: string; inactive: boolean }>;
  appeals: Array<{ id: string; code: string; name: string; category: string }>;
  appealCats: string[];
  fundCats: string[];
  methods: string[];
  holderTypes: string[];
  holders: Array<{ id: string; name: string; team: string }>;
  teams: Array<{ id: string; label: string }>;
  solicit: string[];
  codes: string[];
  attrs: string[];
  rels: string[];
  events: string[];
  firstCats: string[];
}

export const TEAM_LABEL: Record<string, string> = { support: 'Support', rdd: 'RDDs', partner_care: 'Partner Care', church: 'Church Engagement', grants: 'Grants', admin: 'Operations', exec: 'Leadership' };

const col = async (q: Q, sql: string): Promise<string[]> => (await q(sql, [])).map((r) => String(r.v)).filter((v) => v && v !== 'null');

export async function menus(q: Q): Promise<Menus> {
  const [states, funds, appeals, appealCats, fundCats, methods, holderTypes, holders, teams, solicit, codes, attrs, rels, events, firstCats] = await Promise.all([
    col(q, `SELECT DISTINCT upper(state) AS v FROM lr_hh WHERE state IS NOT NULL AND length(state) = 2 ORDER BY 1`),
    q(`SELECT id, name, category, inactive FROM lr_fund ORDER BY inactive, name`, []),
    q(`SELECT id, code, name, category FROM lr_appeal ORDER BY start DESC, code`, []),
    col(q, `SELECT DISTINCT category AS v FROM lr_appeal WHERE category IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT category AS v FROM lr_fund WHERE category IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT method AS v FROM lr_gift WHERE method IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT atype AS v FROM lr_holder ORDER BY 1`),
    q(
      `SELECT f.id AS id, f.name AS name, COALESCE(s.team, '') AS team FROM lr_fr f LEFT JOIN act_staff s ON s.bb_fundraiser_id = f.id AND s.active = 1
        WHERE f.id IN (SELECT DISTINCT fundraiser_id FROM lr_holder) OR f.active = 1 ORDER BY f.name`,
      []
    ),
    col(q, `SELECT DISTINCT team AS v FROM act_staff WHERE active = 1 AND bb_fundraiser_id IS NOT NULL ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'solicit' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'code' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'attr' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'rel' ORDER BY 1`),
    col(q, `SELECT DISTINCT value AS v FROM lr_tag WHERE kind = 'event' ORDER BY 1`),
    col(q, `SELECT DISTINCT first_cat AS v FROM lr_hh WHERE first_cat IS NOT NULL ORDER BY 1`),
  ]);
  return {
    states,
    funds: funds.map((f) => ({ id: String(f.id), name: String(f.name ?? f.id), category: String(f.category ?? ''), inactive: Number(f.inactive) === 1 })),
    appeals: appeals.map((a) => ({ id: String(a.id), code: String(a.code ?? a.id), name: String(a.name ?? ''), category: String(a.category ?? '') })),
    appealCats,
    fundCats,
    methods,
    holderTypes,
    holders: holders.map((h) => ({ id: String(h.id), name: String(h.name), team: String(h.team) })),
    teams: teams.map((t) => ({ id: t, label: TEAM_LABEL[t] || t })),
    solicit,
    codes,
    attrs,
    rels,
    events,
    firstCats,
  };
}

export interface Tie {
  label: string;
  mine: number;
  kpi: number | null;
  status: 'match' | 'differs' | 'none' | 'unavailable';
  note?: string;
}

/**
 * The KPI dashboard counts active households without the living check and LYBUNT and lapsed with it. A list that is only a status
 * (and nothing else) is counted on that basis and compared with the dashboard's own figure. Any other list has no KPI line.
 */
export async function tieOut(q: Q, spec: ListSpec, today: string, kpi: { active: number; lybunt: number; lapsed: number } | null): Promise<Tie | null> {
  const p = spec.partner;
  const base = emptySpec('partners');
  const probe = { ...spec, partner: { ...p, status: [], deceased: 'exclude' }, columns: [], sort: base.sort };
  const plain = JSON.stringify(probe) === JSON.stringify(base);
  if (!plain || p.status.length !== 1) return null;
  const s = p.status[0];
  const basis: ListSpec = { ...spec, partner: { ...p, deceased: s === 'active' ? 'include' : 'exclude' } };
  const mine = (await countList(q, basis, today, { all: true, fids: [] })).n;
  const label = `KPI dashboard, Executive, ${s === 'lybunt' ? 'LYBUNT' : s} partners`;
  if (!kpi) return { label, mine, kpi: null, status: 'unavailable' };
  const theirs = kpi[s];
  if (mine === theirs) return { label, mine, kpi: theirs, status: 'match' };
  // Whole days of difference come from gifts dated today that the dashboard's last build did not yet have.
  const fresh = Number((await q(`SELECT COUNT(*) AS n FROM lr_hh WHERE last_gift = ?1 AND gifts = 1`, [today]))[0]?.n || 0);
  const note = mine - theirs === fresh && fresh > 0 ? `${fresh === 1 ? 'One partner' : fresh + ' partners'} whose first gift is dated today; the dashboard was built before ${fresh === 1 ? 'it' : 'them'} synced.` : 'The dashboard figure is its last build.';
  return { label, mine, kpi: theirs, status: 'differs', note };
}

export { compile };
