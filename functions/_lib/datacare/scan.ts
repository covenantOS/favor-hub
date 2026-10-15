// Data care scan. Reads the RE NXT mirror (read-only) and keeps two lists in the hub database: partners who gave in the last 12 months
// and have no mailable address (dc_flag), and possible duplicate pairs (dc_pair). A rebuild never loses a decision: a pair marked
// Not the same stays that way, a queued or merged pair keeps its state, a flag marked fixed keeps its date.
//
// Mirror rules (see work/repo.ts): the endpoint turns away any statement whose text holds insert, update, replace, upsert, delete,
// drop, alter or create, aliases included, and D1 takes 100 bound values, so id lists go in as one JSON parameter.
import { mirror } from '../foundations/blackbaud';
import { newId, nowIso, type Env } from '../http';
import { MIN_SCORE, pairId, scorePair } from './score';
import { notTestPartnerSql } from '../testpartners.ts';

const REFUSES = /insert|update|replace|upsert|delete|drop|alter|create/i;
const ro = (sql: string): string => {
  if (REFUSES.test(sql)) throw new Error('mirror would refuse this statement: ' + (sql.match(REFUSES) || [''])[0]);
  return sql;
};

/** Today's date in Eastern time, YYYY-MM-DD. The 12 months are counted from it. */
export function easternDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function yearBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A usable mailing address: active, not marked Do not mail, with something on the street lines. */
const GOOD_ADDRESS = `EXISTS (SELECT 1 FROM addresses a WHERE a.constituent_record_id = c.id AND COALESCE(a.is_inactive, 0) = 0 AND COALESCE(a.do_not_mail, 0) = 0 AND COALESCE(a.address_lines, '') <> '')`;

export const FLAGGED_SQL = ro(`SELECT c.id AS cid, c.constituent_lookup_id AS lookup,
       COALESCE(NULLIF(trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), c.organization_name, '') AS name,
       SUM(g.gift_amount) AS gave, COUNT(g.id) AS gifts, MAX(substr(g.gift_date, 1, 10)) AS last_gift,
       (SELECT e.email_address FROM emails e WHERE e.constituent_record_id = c.id AND COALESCE(e.is_inactive, 0) = 0 ORDER BY e.is_primary DESC LIMIT 1) AS email,
       (SELECT group_concat(DISTINCT CASE WHEN COALESCE(a.do_not_mail, 0) = 1 AND COALESCE(a.is_inactive, 0) = 0 AND COALESCE(a.address_lines, '') <> '' THEN 'dnm'
                                          WHEN COALESCE(a.is_inactive, 0) = 1 THEN 'inactive' ELSE 'no_street' END) FROM addresses a WHERE a.constituent_record_id = c.id) AS kinds
  FROM constituents c JOIN gifts g ON g.constituent_record_id = c.id
 WHERE c.no_valid_address = 1 AND COALESCE(c.deceased, 0) = 0 AND g.gift_amount > 0 AND g.gift_date >= ?1 AND ${notTestPartnerSql('c.id')}
 GROUP BY c.id ORDER BY gave DESC`);

export const GOOD_NOW_SQL = ro(`SELECT c.id AS cid, COALESCE(c.deceased, 0) AS dead,
       (SELECT a.formatted_address FROM addresses a WHERE a.constituent_record_id = c.id AND COALESCE(a.is_inactive, 0) = 0 AND COALESCE(a.do_not_mail, 0) = 0 AND COALESCE(a.address_lines, '') <> '' ORDER BY a.is_primary DESC LIMIT 1) AS addr
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1)) AND (${GOOD_ADDRESS} OR COALESCE(c.deceased, 0) = 1)`);

export const SHARED_EMAIL_SQL = ro(`SELECT lower(trim(email_address)) AS e, group_concat(DISTINCT constituent_record_id) AS ids
  FROM emails WHERE COALESCE(is_inactive, 0) = 0 AND email_address LIKE '%@%' AND email_address NOT LIKE '%@favorintl.org' AND ${notTestPartnerSql('constituent_record_id')} GROUP BY 1 HAVING COUNT(DISTINCT constituent_record_id) > 1`);

export const PEOPLE_SQL = ro(`SELECT c.id AS id, c.constituent_lookup_id AS lookup, c.constituent_type AS type, COALESCE(c.first_name, '') AS first, COALESCE(c.last_name, '') AS last,
       c.spouse_id AS spouse, COALESCE(c.deceased, 0) AS dead, COALESCE(c.inactive, 0) AS inactive,
       (SELECT substr(a.address_postal_code, 1, 5) FROM addresses a WHERE a.id = c.primary_address_id) AS zip
  FROM constituents c WHERE c.id IN (SELECT value FROM json_each(?1))`);

export const SPOUSES_SQL = ro(`SELECT constituent_id AS a, relation_id AS b FROM constituent_relationships WHERE is_spouse = 1 AND constituent_id IN (SELECT value FROM json_each(?1))`);

export type WhyKey = 'dnm' | 'no_street' | 'inactive' | 'none';

/** The one reason shown: Do not mail wins (the partner may have asked), then a record with no street line, then inactive. */
export function whyOf(kinds: string | null): WhyKey {
  const k = String(kinds || '').split(',');
  if (k.includes('dnm')) return 'dnm';
  if (k.includes('no_street')) return 'no_street';
  if (k.includes('inactive')) return 'inactive';
  return 'none';
}

export interface FlagRow {
  cid: string;
  lookup: string;
  name: string;
  gave: number;
  gifts: number;
  last_gift: string | null;
  email: string | null;
  why: WhyKey;
}

export async function readFlagged(env: Env, since: string): Promise<FlagRow[]> {
  const rows = await mirror<any>(env, FLAGGED_SQL, [since]);
  return rows.map((r) => ({ cid: String(r.cid), lookup: String(r.lookup || ''), name: String(r.name || ''), gave: Number(r.gave || 0), gifts: Number(r.gifts || 0), last_gift: r.last_gift || null, email: r.email || null, why: whyOf(r.kinds) }));
}

export interface PairRow {
  id: string;
  a: string;
  b: string;
  an: string;
  bn: string;
  al: string;
  bl: string;
  score: number;
  why: string;
}

const MAX_GROUP = 4;

export async function readPairs(env: Env): Promise<PairRow[]> {
  const shared = await mirror<{ e: string; ids: string }>(env, SHARED_EMAIL_SQL);
  const groups = shared.map((r) => ({ e: r.e, ids: [...new Set(String(r.ids).split(',').filter(Boolean))] })).filter((g) => g.ids.length > 1 && g.ids.length <= MAX_GROUP);
  const all = [...new Set(groups.flatMap((g) => g.ids))];
  if (!all.length) return [];
  const people = new Map<string, any>();
  for (const p of await mirror<any>(env, PEOPLE_SQL, [JSON.stringify(all)])) people.set(String(p.id), p);
  const spouse = new Set<string>();
  for (const r of await mirror<any>(env, SPOUSES_SQL, [JSON.stringify(all)])) {
    spouse.add(pairId(String(r.a), String(r.b)));
  }
  const best = new Map<string, PairRow>();
  for (const g of groups) {
    for (let i = 0; i < g.ids.length; i++) {
      for (let j = i + 1; j < g.ids.length; j++) {
        const x = people.get(g.ids[i]);
        const y = people.get(g.ids[j]);
        if (!x || !y) continue;
        if (x.type !== 'Individual' || y.type !== 'Individual') continue;
        if (x.dead || y.dead || x.inactive || y.inactive) continue;
        const id = pairId(g.ids[i], g.ids[j]);
        if (spouse.has(id) || String(x.spouse) === String(y.id) || String(y.spouse) === String(x.id)) continue;
        const [a, b] = id.split('-');
        const [pa, pb] = a === String(x.id) ? [x, y] : [y, x];
        const s = scorePair({ a: { first: x.first, last: x.last }, b: { first: y.first, last: y.last }, group: g.ids.length, sameZip: !!x.zip && x.zip === y.zip });
        if (s.score < MIN_SCORE) continue;
        const prev = best.get(id);
        if (!prev || s.score > prev.score) best.set(id, { id, a, b, an: `${pa.first} ${pa.last}`.trim(), bn: `${pb.first} ${pb.last}`.trim(), al: String(pa.lookup || ''), bl: String(pb.lookup || ''), score: s.score, why: s.why });
      }
    }
  }
  return [...best.values()].sort((p, q) => q.score - p.score || p.id.localeCompare(q.id));
}

export interface ScanResult {
  open: number;
  gave: number;
  fixedNow: number;
  pairs: number;
  review: number;
  at: string;
}

const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export async function setMeta(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare('INSERT INTO dc_meta (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at').bind(k, v, nowIso()).run();
}

export async function getMeta(env: Env, k: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT v FROM dc_meta WHERE k = ?').bind(k).first<{ v: string }>();
  return r ? r.v : null;
}

/** Rebuild both lists. Flags that now have a mailable address become fixed. Safe to run again at any time. */
export async function runScan(env: Env): Promise<ScanResult> {
  const now = nowIso();
  const day = easternDay();
  const since = yearBefore(day);
  const flagged = await readFlagged(env, since);
  const pairs = await readPairs(env);

  // Flags: add or refresh the ones the mirror lists now; a flag marked fixed that shows up again opens again.
  const stmts: D1PreparedStatement[] = [];
  for (const f of flagged) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO dc_flag (cid, lookup, name, kind, why, state, gave, gifts, last_gift, email, first_seen, last_seen)
         VALUES (?, ?, ?, 'no_address', ?, 'open', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cid) DO UPDATE SET lookup = excluded.lookup, name = excluded.name, why = excluded.why, gave = excluded.gave, gifts = excluded.gifts,
           last_gift = excluded.last_gift, email = excluded.email, last_seen = excluded.last_seen,
           state = 'open', fixed_at = NULL, fixed_how = NULL`
      ).bind(f.cid, f.lookup, f.name, f.why, f.gave, f.gifts, f.last_gift, f.email, now, now)
    );
  }
  for (const part of chunk(stmts, 50)) await env.DB.batch(part);

  // Fixed: every open flag the mirror no longer lists, when a mailable address now exists (or the record is marked deceased).
  const open = await env.DB.prepare(`SELECT cid FROM dc_flag WHERE state = 'open' AND kind = 'no_address' AND last_seen < ?`).bind(now).all<{ cid: string }>();
  let fixedNow = 0;
  const ids = (open.results || []).map((r) => r.cid);
  for (const part of chunk(ids, 400)) {
    const good = await mirror<any>(env, GOOD_NOW_SQL, [JSON.stringify(part)]);
    const up = good.map((g) =>
      env.DB.prepare(`UPDATE dc_flag SET state = 'fixed', fixed_at = ?, fixed_how = ?, last_seen = ? WHERE cid = ? AND state = 'open'`).bind(now, g.dead ? 'Record marked deceased' : 'Address now on file', now, String(g.cid))
    );
    for (const p of chunk(up, 50)) await env.DB.batch(p);
    fixedNow += good.length;
  }

  // Pairs: new pairs open for review; known pairs keep their state and take the fresh score.
  const pst = pairs.map((p) =>
    env.DB.prepare(
      `INSERT INTO dc_pair (id, a, b, a_lookup, b_lookup, a_name, b_name, score, why, state, found_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?)
       ON CONFLICT(id) DO UPDATE SET score = excluded.score, why = excluded.why, seen_at = excluded.seen_at, a_name = excluded.a_name, b_name = excluded.b_name, a_lookup = excluded.a_lookup, b_lookup = excluded.b_lookup`
    ).bind(p.id, p.a, p.b, p.al, p.bl, p.an, p.bn, p.score, p.why, now, now)
  );
  for (const part of chunk(pst, 50)) await env.DB.batch(part);
  // A pair the mirror no longer lists (a record was merged or the emails changed) leaves the review list.
  await env.DB.prepare(`UPDATE dc_pair SET state = 'merged', done_at = COALESCE(done_at, ?), result = COALESCE(result, 'No longer a match in the mirror') WHERE state = 'review' AND seen_at < ?`).bind(now, now).run();

  const totals = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(gave), 0) AS g FROM dc_flag WHERE state = 'open' AND kind = 'no_address'`).first<{ n: number; g: number }>();
  const review = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dc_pair WHERE state = 'review'`).first<{ n: number }>();
  const out: ScanResult = { open: Number(totals?.n || 0), gave: Number(totals?.g || 0), fixedNow, pairs: pairs.length, review: Number(review?.n || 0), at: now };
  await setMeta(env, 'scan', JSON.stringify(out));
  void newId;
  return out;
}
