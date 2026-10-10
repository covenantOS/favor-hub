// The one file that knows Blackbaud. Screens and routes call ActionsRepo; this adapter reads the D1 mirror (mirror()) and writes
// through favorintl.org's guarded upkeep route (opsMany()). When Favor's own database replaces Blackbaud, a second adapter
// implements the same interface and nothing above it changes.
//
// Mirror rules that shape the SQL (hub research 7.1): the endpoint refuses any statement whose text contains insert, update,
// replace, upsert, delete, drop, alter or create anywhere, column aliases included; D1 takes 100 bound values, so lists of ids go
// as one JSON parameter read with json_each(?); the copy is up to 12 hours old and keeps deleted rows.
import type { Env } from '../http';
import { mirror, mirrorRefresh, opsMany, type OpsCall, type OpsManyResult } from '../foundations/blackbaud';
import { openActionSql } from '../hub/actions';
import { actionFromSlim, type SlimActionRow, type SlimAssignmentRow, type SlimGiftRow } from '../actions/rows';
import { applyOverlay, shapeBoard, TEAM_LABEL, type BoardRow, type OpenRow, type People } from '../actions/board';
import { digits, nameKeys, norm, type DoneAction, type Lookups } from '../actions/intake';
import { chunk } from '../actions/batch';
import { addDays } from '../actions/completion';

/** The statement text the mirror refuses. Every builder in this file passes through it in the tests. */
export const MIRROR_REFUSES = /insert|update|replace|upsert|delete|drop|alter|create/i;

export function readOnly(sql: string): string {
  if (MIRROR_REFUSES.test(sql)) throw new Error('mirror would refuse this statement: ' + (sql.match(MIRROR_REFUSES) || [''])[0]);
  return sql;
}

const OPEN_COLUMNS = `a.id AS id, a.constituent_record_id AS cid, substr(a.action_date_due, 1, 10) AS due, substr(a.date_added, 1, 19) AS added,
       substr(a.date_modified, 1, 19) AS modified, a.action_type AS type, a.action_category AS category, a.action_summary AS summary,
       substr(COALESCE(a.action_description, ''), 1, 2000) AS description, json_extract(a.raw_json, '$.completed') AS completed,
       substr(a.action_completed_date, 1, 10) AS completed_date, json_extract(a.raw_json, '$.status') AS status,
       json_extract(a.raw_json, '$.computed_status') AS computed, json_extract(a.raw_json, '$.fundraisers') AS frs`;

/** Every open action whose partner record is in the mirror, with the partner's display fields. */
export function openActionsSql(limit = 3000): string {
  return readOnly(`SELECT ${OPEN_COLUMNS}, a.date_modified AS modfull, a.action_priority_level AS priority, c.constituent_lookup_id AS lookup,
       COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS partner,
       json_extract(c.raw_json, '$.address.city') AS city, json_extract(c.raw_json, '$.address.state') AS st, c.deceased AS deceased
  FROM actions a JOIN constituents c ON c.id = a.constituent_record_id
 WHERE ${openActionSql('a')}
 ORDER BY a.action_date_due LIMIT ${Math.floor(limit)}`);
}

/** Open actions with no partner record left in the mirror (the health route counts them). */
export const ORPHAN_SQL = readOnly(`SELECT COUNT(*) AS n FROM actions a LEFT JOIN constituents c ON c.id = a.constituent_record_id WHERE ${openActionSql('a')} AND c.id IS NULL`);

export const LATER_SQL = readOnly(`SELECT ${OPEN_COLUMNS} FROM actions a
 WHERE a.constituent_record_id IN (SELECT value FROM json_each(?1)) AND json_extract(a.raw_json, '$.completed') = 1 AND a.date_added >= ?2
 ORDER BY a.date_added`);

export const GIFTS_SQL = readOnly(`SELECT g.id AS id, g.constituent_record_id AS cid, g.gift_amount AS amount, substr(g.gift_date, 1, 10) AS gift_date,
       substr(g.date_added, 1, 10) AS added, g.gift_type AS gift_type, g.gift_status AS gift_status, g.soft_credits AS soft, g.fundraiser_credits AS credits,
       g.gift_splits AS splits
  FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND g.gift_date >= ?2 AND g.gift_amount > 0
   AND g.gift_type IN ('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other') ORDER BY g.gift_date`);

export const ASSIGN_SQL = readOnly(`SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid, assignment_type AS type
  FROM assignments WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= ?2)`);

export const FUNDS_SQL = readOnly('SELECT id AS id, fund_description AS name FROM funds WHERE id IN (SELECT value FROM json_each(?1))');

export const FUNDRAISERS_SQL = readOnly(`SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last, fundraiser_type AS type,
       substr(fundraiser_end_date, 1, 10) AS endd, fundraiser_active AS active FROM fundraisers`);

export const SYNCED_SQL = readOnly("SELECT MAX(run_at) AS at FROM sync_log WHERE table_name = '__complete__' AND sync_status = 'success'");

export interface PartnerHit {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  holders: string[];
  deceased: boolean;
}

export interface BoardData {
  rows: BoardRow[];
  people: People;
  synced: string; // ISO UTC time of the mirror's last complete sync
  orphans: number;
}

export interface WeekCount {
  fid: string;
  type: string;
  thisWeek: number;
  lastWeek: number;
  lastByMon3: number;
}

export interface ActionsRepo {
  synced(): Promise<string>;
  loadBoard(today: string, staff: StaffPeople[]): Promise<BoardData>;
  partners(q: string, owner?: string, limit?: number): Promise<PartnerHit[]>;
  partnersByIds(ids: string[]): Promise<PartnerHit[]>;
  lookups(rows: { email: string; phone: string; name: string }[], owner: string): Promise<Lookups>;
  doneActions(since: string, owners: string[]): Promise<DoneAction[]>;
  weekCounts(owners: string[], w: { thisStart: string; thisEnd: string; lastStart: string; lastEnd: string; mondayCutoff: string }): Promise<WeekCount[]>;
  send(calls: OpsCall[]): Promise<OpsManyResult>;
  /** The mirror's own date_modified for each action id it holds, so the freshness check can tell a current copy from a stale one. */
  modifiedOf(ids: string[]): Promise<Map<string, string>>;
  /** Ask the sync worker to refresh these actions so the overlay drops once the mirror matches. maxCalls is the SKY cost the worker can spend. */
  refreshMirror(ids: string[], tags: boolean): Promise<{ ok: boolean; runId?: string; maxCalls: number; wait?: string }>;
}

export interface StaffPeople {
  fid: string;
  name: string;
  team: string;
  active: boolean;
}

const jsonIds = (ids: string[]) => JSON.stringify(ids);

export function blackbaudRepo(env: Env): ActionsRepo {
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => mirror<T>(env, readOnly(sql), params);

  async function synced(): Promise<string> {
    const r = await q<{ at: string | null }>(SYNCED_SQL).catch(() => []);
    const at = r[0]?.at;
    return at ? (at.includes('T') ? at : at.replace(' ', 'T') + 'Z') : '';
  }

  async function byChunks<T>(ids: string[], size: number, fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (const part of chunk(ids, size)) out.push(...(await fn(part)));
    return out;
  }

  async function peopleFor(open: OpenRow[], today: string, staff: StaffPeople[]): Promise<People> {
    const fr = await q<{ id: string; first: string | null; last: string | null; type: string | null; endd: string | null; active: number | null }>(FUNDRAISERS_SQL);
    const people: People = {};
    for (const f of fr) {
      const ended = !!f.endd && f.endd < today;
      people[String(f.id)] = {
        n: `${f.first ?? ''} ${f.last ?? ''}`.trim() || `Fundraiser ${f.id}`,
        team: TEAM_LABEL[f.type || ''] || f.type || '',
        active: Number(f.active) === 1 && !ended ? 1 : 0,
        left: f.endd || null,
        listed: 1,
      };
    }
    // The Support Team and anyone else the staff list names with a Blackbaud id that the fundraisers table lacks.
    for (const s of staff) {
      if (s.fid && !people[s.fid]) people[s.fid] = { n: s.name, team: s.team, active: s.active ? 1 : 0, left: null, listed: 1 };
    }
    const unknown = new Set<string>();
    for (const o of open) {
      try {
        for (const id of JSON.parse(o.frs || '[]')) if (!people[String(id)]) unknown.add(String(id));
      } catch {
        // a row whose fundraisers do not parse has no owner
      }
    }
    if (unknown.size) {
      const names = await q<{ id: string; first: string | null; last: string | null; org: string | null }>(
        'SELECT id AS id, first_name AS first, last_name AS last, organization_name AS org FROM constituents WHERE id IN (SELECT value FROM json_each(?1))',
        [jsonIds([...unknown])]
      );
      for (const n of names) people[String(n.id)] = { n: `${n.first ?? ''} ${n.last ?? ''}`.trim() || n.org || `Fundraiser ${n.id}`, team: '', active: 0, left: null, listed: 0 };
      for (const id of unknown) if (!people[id]) people[id] = { n: `Fundraiser ${id}`, team: '', active: 0, left: null, listed: 0 };
    }
    return people;
  }

  return {
    synced,

    async loadBoard(today, staff) {
      const [open, syncedAt, orph] = await Promise.all([q<OpenRow>(openActionsSql()), synced(), q<{ n: number }>(ORPHAN_SQL).catch(() => [{ n: 0 }])]);
      const cids = [...new Set(open.map((o) => String(o.cid)))];
      const since = addDays(today, -190);
      const [later, gifts, assigns, people] = await Promise.all([
        byChunks(cids, 400, (part) => q<SlimActionRow>(LATER_SQL, [jsonIds(part), since])),
        byChunks(cids, 400, (part) => q<SlimGiftRow>(GIFTS_SQL, [jsonIds(part), since])),
        byChunks(cids, 400, (part) => q<SlimAssignmentRow>(ASSIGN_SQL, [jsonIds(part), today])),
        peopleFor(open, today, staff),
      ]);
      const fundIds = new Set<string>();
      for (const g of gifts) {
        try {
          for (const s of JSON.parse(g.splits || '[]')) if (s.fund_id) fundIds.add(String(s.fund_id));
        } catch {
          // no splits on this gift
        }
      }
      const funds: Record<string, string> = {};
      if (fundIds.size) for (const f of await q<{ id: string; name: string }>(FUNDS_SQL, [jsonIds([...fundIds])])) funds[String(f.id)] = f.name;
      const rows = shapeBoard({ today, open, later, gifts, assigns, funds, people });
      return { rows, people, synced: syncedAt, orphans: Number(orph[0]?.n) || 0 };
    },

    async partners(text, owner, limit = 8) {
      const t = text.trim();
      if (t.length < 2) return [];
      let where = '';
      const params: unknown[] = [];
      if (t.includes('@')) {
        where = 'k.id IN (SELECT constituent_record_id FROM emails WHERE lower(email_address) = ?)';
        params.push(t.toLowerCase());
      } else if (digits(t)) {
        where = 'k.id IN (SELECT constituent_record_id FROM phones WHERE phone_number LIKE ?)';
        params.push('%' + digits(t).slice(-10) + '%');
      } else {
        const toks = norm(t).split(' ').filter((w) => w.length > 1).slice(0, 4);
        if (!toks.length) return [];
        where = toks.map(() => "(k.first_name LIKE ? OR k.last_name LIKE ? OR k.preferred_name LIKE ? OR k.organization_name LIKE ?)").join(' AND ');
        for (const w of toks) params.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
      }
      const rows = await q<any>(
        `SELECT k.id AS id, k.constituent_lookup_id AS lookup, k.constituent_type AS ctype, k.first_name AS first, k.last_name AS last, k.organization_name AS org,
                json_extract(k.raw_json, '$.address.city') AS city, json_extract(k.raw_json, '$.address.state') AS st, k.deceased AS deceased,
                ${owner ? '(SELECT COUNT(*) FROM assignments s WHERE s.constituent_record_id = k.id AND s.assignment_fundraiser_id = ? AND (s.assignment_to_date IS NULL OR substr(s.assignment_to_date, 1, 10) >= date(\'now\')))' : '0'} AS mine
           FROM constituents k WHERE k.inactive = 0 AND ${where} ORDER BY mine DESC, k.last_name, k.first_name LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
        owner ? [owner, ...params] : params
      );
      return shapeHits(rows, await holdersFor(rows.map((r: any) => String(r.id))));
    },

    async partnersByIds(ids) {
      if (!ids.length) return [];
      const rows = await q<any>(
        `SELECT k.id AS id, k.constituent_lookup_id AS lookup, k.constituent_type AS ctype, k.first_name AS first, k.last_name AS last, k.organization_name AS org,
                json_extract(k.raw_json, '$.address.city') AS city, json_extract(k.raw_json, '$.address.state') AS st, k.deceased AS deceased
           FROM constituents k WHERE k.id IN (SELECT value FROM json_each(?1)) LIMIT 500`,
        [jsonIds(ids)]
      );
      return shapeHits(rows, await holdersFor(rows.map((r: any) => String(r.id))));
    },

    async lookups(rows, owner) {
      const emails = [...new Set(rows.map((r) => r.email.toLowerCase()).filter(Boolean))];
      const phones = new Set(rows.map((r) => digits(r.phone)).filter(Boolean));
      const byEmail = new Map<string, string[]>();
      const byPhone = new Map<string, string[]>();
      const byName = new Map<string, string[]>();
      const present = new Set<string>();
      if (emails.length) {
        for (const e of await byChunks(emails, 200, (part) => q<{ e: string; cid: string }>('SELECT lower(email_address) AS e, constituent_record_id AS cid FROM emails WHERE lower(email_address) IN (SELECT value FROM json_each(?1))', [jsonIds(part)]))) {
          byEmail.set(e.e, (byEmail.get(e.e) || []).concat(String(e.cid)));
        }
      }
      if (phones.size) {
        // Phone numbers are stored in many shapes, so ask with a pattern per number (area, exchange, line) and settle the match on the digits here.
        for (const part of chunk([...phones], 40)) {
          const likes = part.map(() => 'phone_number LIKE ?').join(' OR ');
          const found = await q<{ n: string; cid: string }>(
            `SELECT phone_number AS n, constituent_record_id AS cid FROM phones WHERE phone_number IS NOT NULL AND (${likes}) LIMIT 2000`,
            part.map((d) => `%${d.slice(0, 3)}%${d.slice(3, 6)}%${d.slice(6)}%`)
          );
          for (const p of found) {
            const d = digits(p.n);
            if (d && phones.has(d)) byPhone.set(d, (byPhone.get(d) || []).concat(String(p.cid)));
          }
        }
      }
      // Names: fetch every active record that shares a last name (or organization name) with a row, then match the full keys here.
      const lasts = new Set<string>();
      for (const r of rows) {
        const base = r.name.split(' - ')[0];
        if (base.includes(',')) lasts.add(norm(base.split(',')[0]));
        else lasts.add(norm(base).split(' ').pop() || '');
        lasts.add(norm(base));
      }
      lasts.delete('');
      if (lasts.size) {
        const cands = await byChunks([...lasts], 200, (part) =>
          q<any>(
            `SELECT k.id AS id, k.first_name AS first, k.last_name AS last, k.preferred_name AS pref, k.organization_name AS org
               FROM constituents k WHERE k.inactive = 0 AND (lower(k.last_name) IN (SELECT value FROM json_each(?1)) OR lower(k.organization_name) IN (SELECT value FROM json_each(?1)))`,
            [jsonIds(part)]
          ).catch(() => [])
        );
        for (const c of cands) {
          const id = String(c.id);
          const keys = c.org ? [norm(c.org)] : [norm(`${c.first ?? ''} ${c.last ?? ''}`), ...(c.pref && c.pref !== c.first ? [norm(`${c.pref} ${c.last ?? ''}`)] : [])];
          for (const k of keys) if (k) byName.set(k, (byName.get(k) || []).concat(id));
        }
      }
      const all = new Set<string>([...byEmail.values(), ...byPhone.values(), ...byName.values()].flat());
      const holders = new Map<string, string[]>();
      if (all.size) {
        for (const a of await byChunks([...all], 400, (part) => q<{ cid: string; fid: string }>(`SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now'))`, [jsonIds(part)]))) {
          holders.set(String(a.cid), (holders.get(String(a.cid)) || []).concat(String(a.fid)));
        }
        // Every record that came back is active: the name query asked for it, and email or phone owners are checked here.
        const active = await byChunks([...all], 400, (part) => q<{ id: string }>('SELECT id AS id FROM constituents WHERE inactive = 0 AND id IN (SELECT value FROM json_each(?1))', [jsonIds(part)]));
        for (const a of active) present.add(String(a.id));
      }
      void owner;
      return { byEmail, byPhone, byName, holders, present };
    },

    async doneActions(since, owners) {
      if (!owners.length) return [];
      const rows = await q<{ id: string; cid: string; due: string; added: string; cat: string; frs: string }>(
        `SELECT a.id AS id, a.constituent_record_id AS cid, substr(a.action_date_due, 1, 10) AS due, substr(a.date_added, 1, 16) AS added, a.action_category AS cat,
                json_extract(a.raw_json, '$.fundraisers') AS frs
           FROM actions a WHERE a.action_date_due >= ?1 AND json_extract(a.raw_json, '$.completed') = 1
            AND a.action_type IN ('RDD Action', 'CED Action', 'Carole Action', 'Terry Action')
            AND EXISTS (SELECT 1 FROM json_each(a.raw_json, '$.fundraisers') j WHERE j.value IN (SELECT value FROM json_each(?2))) LIMIT 8000`,
        [since, jsonIds(owners)]
      );
      return rows.map((r) => ({ id: String(r.id), cid: String(r.cid), due: r.due, added: r.added, category: r.cat, fundraisers: safeArr(r.frs) }));
    },

    async weekCounts(owners, w) {
      if (!owners.length) return [];
      const rows = await q<{ fid: string; type: string; this_week: number; last_week: number; last_by_mon3: number }>(
        `SELECT j.value AS fid, a.action_type AS type,
                SUM(substr(a.action_date_due, 1, 10) BETWEEN ?1 AND ?2) AS this_week,
                SUM(substr(a.action_date_due, 1, 10) BETWEEN ?3 AND ?4) AS last_week,
                SUM(substr(a.action_date_due, 1, 10) BETWEEN ?3 AND ?4 AND a.date_added <= ?5) AS last_by_mon3
           FROM actions a, json_each(a.raw_json, '$.fundraisers') j
          WHERE a.action_date_due >= ?3 AND a.action_date_due < ?6 AND json_extract(a.raw_json, '$.completed') = 1
            AND a.action_type IN ('RDD Action', 'CED Action', 'Carole Action', 'Terry Action')
            AND j.value IN (SELECT value FROM json_each(?7)) GROUP BY 1, 2`,
        [w.thisStart, w.thisEnd, w.lastStart, w.lastEnd, w.mondayCutoff, addDays(w.thisEnd, 1), jsonIds(owners)]
      );
      return rows.map((r) => ({ fid: String(r.fid), type: r.type, thisWeek: Number(r.this_week) || 0, lastWeek: Number(r.last_week) || 0, lastByMon3: Number(r.last_by_mon3) || 0 }));
    },

    send: (calls) => opsMany(env, calls),

    async modifiedOf(ids) {
      const out = new Map<string, string>();
      for (const part of chunk([...new Set(ids)], 400)) {
        for (const r of await q<{ id: string; mod: string | null }>('SELECT id AS id, date_modified AS mod FROM actions WHERE id IN (SELECT value FROM json_each(?1))', [jsonIds(part)])) out.set(String(r.id), String(r.mod || ''));
      }
      return out;
    },

    // The sync worker's action-refresh source re-reads the actions; the overlay drops once the mirror matches.
    refreshMirror: (ids, tags) => mirrorRefresh(env, ids, tags),
  };

  async function holdersFor(ids: string[]): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    if (!ids.length) return m;
    for (const a of await q<{ cid: string; fid: string }>(`SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now'))`, [jsonIds(ids)])) {
      m.set(String(a.cid), (m.get(String(a.cid)) || []).concat(String(a.fid)));
    }
    return m;
  }
}

function safeArr(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function shapeHits(rows: any[], holders: Map<string, string[]>): PartnerHit[] {
  return rows.map((r) => ({
    cid: String(r.id),
    lookup: String(r.lookup || ''),
    name: (r.ctype === 'Organization' ? r.org : `${r.first ?? ''} ${r.last ?? ''}`).trim() || '(no name)',
    place: [r.city, r.st].filter(Boolean).join(', '),
    holders: holders.get(String(r.id)) || [],
    deceased: r.deceased === 1 || r.deceased === '1' || r.deceased === true,
  }));
}

/* ------------------------------------------------------------------ a short memory for the shaped board */

let memo: { at: number; today: string; data: BoardData } | null = null;
const MEMO_MS = 60_000;

/** The board, reread from the mirror at most once a minute per server instance. Any change made here drops it. */
export async function boardData(repo: ActionsRepo, today: string, staff: StaffPeople[]): Promise<BoardData> {
  if (memo && memo.today === today && Date.now() - memo.at < MEMO_MS) return memo.data;
  const data = await repo.loadBoard(today, staff);
  memo = { at: Date.now(), today, data };
  return data;
}

export function forgetBoard(): void {
  memo = null;
}

export { applyOverlay, actionFromSlim, nameKeys };
