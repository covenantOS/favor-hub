// Add a partner from Entry. Support finds a sheet row that matches no record, checks Blackbaud for the same person (the mirror at once,
// Blackbaud's own duplicate search on a pause and again on save), ticks "None of these is the same person", and adds the record.
//
// The create step has a stand-in sender. The stand-in builds the same calls and checks them against the keys Blackbaud takes, answers
// with made-up ids, and sends nothing. The agent key and every role test are limited to it, so a test never makes a real record.
import { HttpError, newId, nowIso, type Env } from '../http';
import { mirror, type OpsCall, type OpsManyResult } from '../foundations/blackbaud';
import { digits } from '../actions/intake';
import { idemKey } from '../actions/outbox';
import { liveQuery, mergeLive, probeOf, probeReady, rankCandidates, type Cand, type LiveHit, type Match, type Probe } from '../actions/partner-match';
import { addMeter, listStaff, logEvent } from './db';
import { readOnly } from './repo';
import { entryOwners, entryPatch } from './entry';
import { todayEt, type Ctx } from './service';

export const CODES = ['Prospect', 'Partner', 'Church'] as const;
export type Code = (typeof CODES)[number];

/** Support and admins add partners. A director asks Support. */
export function mayAddPartner(ctx: Ctx): boolean {
  const s = ctx.scope;
  return !s || s.all || s.role === 'admin' || s.role === 'support';
}

const MAX_LIVE_PER_MINUTE = 12;

const jsonIds = (ids: string[]) => JSON.stringify(ids);

async function candidatesFor(env: Env, p: Probe): Promise<Cand[]> {
  const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => mirror<T>(env, readOnly(sql), params);
  const ids = new Set<string>();
  const ph = digits(p.phone);
  if (ph) {
    const rows = await q<{ cid: string; n: string }>('SELECT constituent_record_id AS cid, phone_number AS n FROM phones WHERE phone_number LIKE ?1 LIMIT 60', [`%${ph.slice(0, 3)}%${ph.slice(3, 6)}%${ph.slice(6)}%`]).catch(() => []);
    for (const r of rows) if (digits(r.n) === ph) ids.add(String(r.cid));
  }
  const em = p.email.trim().toLowerCase();
  if (em.includes('@')) {
    for (const r of await q<{ cid: string }>('SELECT constituent_record_id AS cid FROM emails WHERE lower(email_address) = ?1 LIMIT 30', [em]).catch(() => [])) ids.add(String(r.cid));
    const dom = em.split('@')[1];
    if (p.kind === 'organization' && dom && dom.includes('.')) {
      for (const r of await q<{ cid: string }>('SELECT constituent_record_id AS cid FROM emails WHERE lower(email_address) LIKE ?1 LIMIT 40', [`%@${dom}`]).catch(() => [])) ids.add(String(r.cid));
    }
  }
  const city = p.city.trim().toLowerCase();
  const lasts = [p.last, p.kind === 'household' ? p.spouseLast || p.last : ''].map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
  for (const last of new Set(lasts)) {
    const rows = await q<{ id: string }>(
      `SELECT k.id AS id FROM constituents k WHERE k.inactive = 0 AND lower(k.last_name) = ?1
        ORDER BY CASE WHEN lower(json_extract(k.raw_json, '$.address.city')) = ?2 THEN 0 ELSE 1 END LIMIT 80`,
      [last, city]
    ).catch(() => []);
    for (const r of rows) ids.add(String(r.id));
  }
  if (p.kind === 'organization' && p.org.trim().length >= 3) {
    const name = p.org.trim().toLowerCase();
    for (const r of await q<{ id: string }>('SELECT k.id AS id FROM constituents k WHERE k.inactive = 0 AND lower(k.organization_name) LIKE ?1 LIMIT 40', [`%${name}%`]).catch(() => [])) ids.add(String(r.id));
  }
  const all = [...ids].slice(0, 120);
  if (!all.length) return [];
  const [rows, phones, emails, gifts, holders] = await Promise.all([
    q<any>(
      `SELECT k.id AS id, k.constituent_lookup_id AS lookup, k.constituent_type AS ctype, k.first_name AS first, k.last_name AS last, k.organization_name AS org,
              json_extract(k.raw_json, '$.address.city') AS city, json_extract(k.raw_json, '$.address.state') AS st, json_extract(k.raw_json, '$.address.postal_code') AS zip,
              k.deceased AS deceased, k.inactive AS inactive, substr(json_extract(k.raw_json, '$.date_added'), 1, 10) AS since
         FROM constituents k WHERE k.id IN (SELECT value FROM json_each(?1))`,
      [jsonIds(all)]
    ),
    q<{ cid: string; n: string }>('SELECT constituent_record_id AS cid, phone_number AS n FROM phones WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND is_inactive = 0', [jsonIds(all)]).catch(() => []),
    q<{ cid: string; e: string }>('SELECT constituent_record_id AS cid, lower(email_address) AS e FROM emails WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND is_inactive = 0', [jsonIds(all)]).catch(() => []),
    q<{ cid: string; n: number; last: string; amt: number }>(
      `SELECT g.constituent_record_id AS cid, COUNT(*) AS n, MAX(substr(g.gift_date, 1, 10)) AS last,
              (SELECT g2.gift_amount FROM gifts g2 WHERE g2.constituent_record_id = g.constituent_record_id AND g2.gift_amount > 0 ORDER BY g2.gift_date DESC LIMIT 1) AS amt
         FROM gifts g WHERE g.constituent_record_id IN (SELECT value FROM json_each(?1)) AND g.gift_amount > 0 GROUP BY g.constituent_record_id`,
      [jsonIds(all)]
    ).catch(() => []),
    q<{ cid: string; fid: string }>(
      "SELECT constituent_record_id AS cid, assignment_fundraiser_id AS fid FROM assignments WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now'))",
      [jsonIds(all)]
    ).catch(() => []),
  ]);
  const by = <T extends { cid: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(String(x.cid), (m.get(String(x.cid)) || []).concat(x));
    return m;
  };
  const phBy = by(phones);
  const emBy = by(emails);
  const gf = new Map(gifts.map((g) => [String(g.cid), g]));
  const hd = by(holders);
  return rows.map((r: any) => ({
    cid: String(r.id), lookup: String(r.lookup || ''), type: String(r.ctype || 'Individual'), first: String(r.first || ''), last: String(r.last || ''), org: String(r.org || ''),
    city: String(r.city || ''), state: String(r.st || ''), zip: String(r.zip || ''),
    phones: (phBy.get(String(r.id)) || []).map((x) => digits(x.n)).filter(Boolean), emails: (emBy.get(String(r.id)) || []).map((x) => x.e).filter(Boolean),
    deceased: r.deceased === 1 || r.deceased === '1' || r.deceased === true, inactive: r.inactive === 1 || r.inactive === '1', since: String(r.since || ''),
    gifts: Number(gf.get(String(r.id))?.n) || 0, lastGift: String(gf.get(String(r.id))?.last || ''), lastAmount: Number(gf.get(String(r.id))?.amt) || 0,
    holders: (hd.get(String(r.id)) || []).map((x) => String(x.fid)),
  }));
}

export interface MatchesOut {
  ok: true;
  matches: Match[];
  live: 'ran' | 'skipped' | 'failed';
  calls: number;
  ready: boolean;
}

/** The duplicate check. The mirror is read every time (no Blackbaud call); Blackbaud's duplicate search runs when asked (live) and counts one call. */
export async function findMatches(ctx: Ctx, body: Record<string, unknown>, opts: { live: boolean }): Promise<MatchesOut> {
  if (!mayAddPartner(ctx)) throw new HttpError(403, 'not_yours', 'Support adds partners. Ask Support to add this one.');
  const p = probeOf(body);
  if (!probeReady(p)) return { ok: true, matches: [], live: 'skipped', calls: 0, ready: false };
  let matches = rankCandidates(p, await candidatesFor(ctx.env, p).catch(() => []));
  let live: MatchesOut['live'] = 'skipped';
  let calls = 0;
  if (opts.live) {
    const query = liveQuery(p);
    if (query) {
      await limitLive(ctx);
      const res = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/duplicatesearch?${query}` }]);
      calls = res.results.length;
      if (calls) await addMeter(ctx.env, calls, res.callsToday).catch(() => undefined);
      const r = res.results[0];
      if (r && r.ok && r.body && Array.isArray(r.body.value)) {
        live = 'ran';
        matches = mergeLive(p, matches, r.body.value as LiveHit[]);
      } else live = 'failed';
    }
  }
  const names = await holderNames(ctx.env, matches.flatMap((m) => m.holders));
  matches = matches.map((m) => ({ ...m, holders: m.holders.map((h) => names.get(h) || h) }));
  return { ok: true, matches, live, calls, ready: true };
}

async function holderNames(env: Env, fids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!fids.length) return m;
  for (const s of await listStaff(env).catch(() => [])) if (s.bb_fundraiser_id) m.set(String(s.bb_fundraiser_id), s.name);
  const missing = [...new Set(fids)].filter((f) => !m.has(f));
  if (missing.length) {
    const rows = await mirror<{ id: string; first: string; last: string }>(env, readOnly('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers WHERE id IN (SELECT value FROM json_each(?1))'), [jsonIds(missing)]).catch(() => []);
    for (const r of rows) m.set(String(r.id), `${r.first ?? ''} ${r.last ?? ''}`.trim());
  }
  return m;
}

/** A person's live checks are limited so a held key cannot spend the day's allowance. */
async function limitLive(ctx: Ctx): Promise<void> {
  const key = `dupq:${ctx.email}:${new Date().toISOString().slice(0, 16)}`;
  const row = await ctx.env.DB.prepare('SELECT value FROM act_cache WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null);
  const n = Number(row?.value) || 0;
  if (n >= MAX_LIVE_PER_MINUTE) throw new HttpError(429, 'slow_down', 'Too many checks in a minute. Wait a moment and try again.');
  await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(key, String(n + 1), nowIso()).run().catch(() => undefined);
}

/* ------------------------------------------------------------------ adding */

export interface AddInput {
  probe: Probe;
  code: Code;
  holder: string;
  street: string;
  none_same: boolean;
  row: string;
}

export function parseAdd(b: Record<string, unknown>): AddInput {
  const probe = probeOf(b);
  const code = String(b.code || '') as Code;
  const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out: AddInput = { probe, code, holder: clean(b.holder, 20), street: clean(b.street, 100), none_same: b.none_same === true, row: clean(b.row, 40) };
  if (!CODES.includes(code)) throw new HttpError(400, 'bad_code', 'Pick the code: Prospect, Partner or Church.');
  if (probe.kind === 'organization') {
    if (probe.org.length < 3) throw new HttpError(400, 'missing_field', 'Type the organization name.');
  } else {
    if (!probe.first || !probe.last) throw new HttpError(400, 'missing_field', 'Type the first and last name.');
    if (probe.kind === 'household' && !probe.spouseFirst) throw new HttpError(400, 'missing_field', 'Type the spouse\'s first name, or pick Individual.');
  }
  if (probe.phone && digits(probe.phone).length !== 10) throw new HttpError(400, 'bad_phone', 'The phone number needs 10 digits.');
  if (probe.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(probe.email)) throw new HttpError(400, 'bad_email', 'That email address does not look right.');
  if (probe.state && probe.state.length > 30) throw new HttpError(400, 'bad_state', 'Use the two-letter state.');
  return out;
}

/** The Blackbaud assignment type a holder gets: church engagement directors keep their own type; a Prospect gets a Prospect Steward; a Partner gets an RDD. */
export function assignmentType(code: Code, holderTeam: string): string {
  if (holderTeam === 'church') return 'Church Engagement Director';
  return code === 'Prospect' ? 'Prospect Steward' : 'Regional Development Director (RDD)';
}

const PHONE_TYPE = (org: boolean) => (org ? 'Business Phone' : 'Cell Phone');

/** The body of one POST /constituent/v1/constituents. Only keys the upkeep route lets through. */
export function personBody(a: AddInput, who: 'first' | 'spouse'): Record<string, unknown> {
  const p = a.probe;
  const body: Record<string, unknown> = { type: 'Individual', first: who === 'first' ? p.first : p.spouseFirst, last: who === 'first' ? p.last : p.spouseLast || p.last };
  addContact(body, a, who === 'first');
  return body;
}

function addContact(body: Record<string, unknown>, a: AddInput, withReach: boolean): void {
  const p = a.probe;
  const org = p.kind === 'organization';
  if (a.street || p.city || p.state || p.zip) {
    body.address = { type: org ? 'Business' : 'Home', address_lines: a.street, city: p.city, state: p.state, postal_code: p.zip, preferred: true };
  }
  if (withReach && p.email) body.email = { address: p.email, type: 'Email', primary: true };
  if (withReach && digits(p.phone)) body.phone = { number: p.phone, type: PHONE_TYPE(org), primary: true };
}

export function orgBody(a: AddInput): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'Organization', name: a.probe.org };
  addContact(body, a, true);
  return body;
}

export type Sender = (calls: OpsCall[]) => Promise<OpsManyResult>;

const CREATE_KEYS = ['type', 'first', 'last', 'name', 'address', 'email', 'phone'];
const REL_KEYS = ['constituent_id', 'relation_id', 'type', 'reciprocal_type', 'is_spouse'];

/** The stand-in. It checks each call the way the upkeep route does and answers with made-up ids. It sends nothing to Blackbaud. */
export function standInSender(log: OpsCall[]): Sender {
  let next = 900000;
  return async (calls) => {
    const results: OpsManyResult['results'] = [];
    for (const c of calls) {
      log.push(c);
      const body = (c.body || {}) as Record<string, unknown>;
      let ok = true;
      let reply: any = {};
      if (c.method === 'POST' && c.path === '/constituent/v1/constituents') {
        const extra = Object.keys(body).filter((k) => !CREATE_KEYS.includes(k));
        if (extra.length) ok = false;
        reply = ok ? { id: String(++next) } : { refused: `body keys not allowed here: ${extra.join(', ')}` };
      } else if (c.method === 'POST' && c.path === '/constituent/v1/relationships') {
        const extra = Object.keys(body).filter((k) => !REL_KEYS.includes(k));
        if (extra.length) ok = false;
        reply = ok ? { id: String(++next) } : { refused: `body keys not allowed here: ${extra.join(', ')}` };
      } else if (c.method === 'POST' && (c.path === '/constituent/v1/constituentcodes' || c.path === '/fundraising/v1/fundraisers/assignments')) reply = { id: String(++next) };
      else if (c.method === 'GET' && /^\/constituent\/v1\/constituents\/\d+$/.test(c.path)) reply = { id: c.path.split('/').pop(), lookup_id: '99' + c.path.split('/').pop()!.slice(-3) };
      else ok = false;
      results.push({ ok, status: ok ? 200 : 0, body: reply });
    }
    return { results, callsToday: undefined };
  };
}

export interface AddResult {
  ok: true;
  standin: boolean;
  cid: string;
  cid2: string | null;
  lookup: string;
  name: string;
  warnings: string[];
  calls: OpsCall[] | null;
  row: unknown;
}

const nameOf = (p: Probe) => (p.kind === 'organization' ? p.org : p.kind === 'household' ? (p.spouseLast && p.spouseLast !== p.last ? `${p.first} ${p.last} and ${p.spouseFirst} ${p.spouseLast}` : `${p.first} and ${p.spouseFirst} ${p.last}`) : `${p.first} ${p.last}`);

export async function addPartner(ctx: Ctx, body: Record<string, unknown>, mode: { standin: boolean; send?: Sender }): Promise<AddResult> {
  if (!mayAddPartner(ctx)) throw new HttpError(403, 'not_yours', 'Support adds partners. Ask Support to add this one.');
  if (ctx.testCid && !mode.standin) throw new HttpError(403, 'test_only', 'This is a test run, and a test never makes a real record. It uses the stand-in route.');
  const a = parseAdd(body);
  if (!a.none_same) throw new HttpError(400, 'not_confirmed', 'Tick "None of these is the same person" first.');
  const env = ctx.env;
  let holderTeam = '';
  if (a.holder) {
    const owner = (await entryOwners(env)).find((o) => String(o.bb_fundraiser_id) === a.holder);
    if (!owner) throw new HttpError(400, 'bad_holder', 'Pick who holds this partner from the list.');
    if (ctx.scope && !ctx.scope.all && !ctx.scope.fids.has(a.holder)) throw new HttpError(403, 'not_yours', 'That person is not one of the directors you support.');
    holderTeam = owner.team;
  }
  // The check runs again on save, whatever the form showed. Its answer goes in the log with the tick.
  const check = await findMatches(ctx, body, { live: true }).catch(() => null);
  const keyHash = (await idemKey([a.probe.kind, a.probe.first, a.probe.last, a.probe.spouseFirst, a.probe.org, digits(a.probe.phone), a.probe.email, a.probe.city])).slice(0, 24);
  const claim = `addp:${keyHash}`;
  const log: OpsCall[] = [];
  const send: Sender = mode.standin ? standInSender(log) : mode.send || ((c) => ctx.repo.send(c));
  if (!mode.standin) {
    const have = await env.DB.prepare('SELECT value, at FROM act_cache WHERE key = ?').bind(claim).first<{ value: string; at: string }>().catch(() => null);
    if (have && Date.now() - Date.parse(have.at) < 24 * 3600000) {
      if (have.value === 'pending') throw new HttpError(409, 'in_progress', 'This partner is being added. Wait a moment, then check the list.');
      throw new HttpError(409, 'already_added', 'This partner was just added. Search for the name to find the record.');
    }
    await env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(claim, 'pending', nowIso()).run();
  }
  const release = () => (mode.standin ? Promise.resolve() : env.DB.prepare('DELETE FROM act_cache WHERE key = ?').bind(claim).run().catch(() => undefined));
  const warnings: string[] = [];
  let spent = 0;
  const run = async (calls: OpsCall[]) => {
    const res = await send(calls);
    spent += res.results.length;
    if (!mode.standin && res.results.length) await addMeter(env, res.results.length, res.callsToday).catch(() => undefined);
    return res;
  };
  const p = a.probe;
  const first = await run([{ method: 'POST', path: '/constituent/v1/constituents', body: p.kind === 'organization' ? orgBody(a) : personBody(a, 'first') }]);
  const r1 = first.results[0];
  const cid = r1 && r1.ok && r1.body && r1.body.id ? String(r1.body.id) : '';
  if (!cid) {
    // A lost answer may still have made the record: leave the claim so a second press does not make a second one.
    if (!first.lost) await release();
    await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, kind: 'partner_add_failed', ok: false, status: r1?.status, detail: `${nameOf(p)}: ${first.wait || JSON.stringify(r1?.body || '').slice(0, 200)}` }).catch(() => undefined);
    throw new HttpError(502, 'bb_refused', first.lost ? 'Blackbaud did not answer, and the record may have been made. Search for the name before you try again.' : 'Blackbaud did not take the new record. Nothing was added. ' + (r1?.body?.refused || first.wait || '').toString().slice(0, 160));
  }
  let cid2: string | null = null;
  if (p.kind === 'household') {
    const second = await run([{ method: 'POST', path: '/constituent/v1/constituents', body: personBody(a, 'spouse') }]);
    const r2 = second.results[0];
    if (r2 && r2.ok && r2.body && r2.body.id) cid2 = String(r2.body.id);
    else warnings.push(`The spouse's record was not made (${(r2?.body?.refused || second.wait || 'Blackbaud said no').toString().slice(0, 100)}). Add the spouse in Blackbaud.`);
  }
  const rest: OpsCall[] = [{ method: 'POST', path: '/constituent/v1/constituentcodes', body: { constituent_id: cid, description: a.code } }];
  if (cid2) rest.push({ method: 'POST', path: '/constituent/v1/constituentcodes', body: { constituent_id: cid2, description: a.code } });
  if (cid2) rest.push({ method: 'POST', path: '/constituent/v1/relationships', body: { constituent_id: cid, relation_id: cid2, type: 'Spouse', reciprocal_type: 'Spouse', is_spouse: true } });
  if (a.holder) rest.push({ method: 'POST', path: '/fundraising/v1/fundraisers/assignments', body: { constituent_id: cid, fundraiser_id: a.holder, type: assignmentType(a.code, holderTeam), start: `${todayEt()}T00:00:00` } });
  rest.push({ method: 'GET', path: `/constituent/v1/constituents/${cid}` });
  const tail = await run(rest);
  const label = ['The code', cid2 ? 'the spouse\'s code' : '', cid2 ? 'the spouse link' : '', a.holder ? 'the holder' : ''].filter(Boolean);
  const names = label.slice();
  tail.results.slice(0, rest.length - 1).forEach((r, i) => {
    if (!r.ok) warnings.push(`${names[i] || 'One step'} was not saved (${(r.body?.refused || sayShort(r.body)).toString().slice(0, 100)}). Finish it in Blackbaud.`);
  });
  if (tail.results.length < rest.length - 1) warnings.push('Some steps after the record were not sent. Check the record in Blackbaud.');
  const lookupRes = tail.results[rest.length - 1];
  const lookup = lookupRes && lookupRes.ok && lookupRes.body ? String(lookupRes.body.lookup_id || '') : '';
  const name = nameOf(p);
  const place = [p.city, p.state].filter(Boolean).join(', ');
  let row: unknown = null;
  if (!mode.standin) {
    await env.DB.prepare('INSERT OR REPLACE INTO act_new_partners (cid, lookup, name, place, holder, created_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(cid, lookup || null, name, place || null, a.holder || null, ctx.actor, nowIso()).run();
    await env.DB.prepare('UPDATE act_cache SET value = ?, at = ? WHERE key = ?').bind(cid, nowIso(), claim).run().catch(() => undefined);
    if (a.row) {
      row = await entryPatch(ctx, a.row, { constituent_id: cid }).catch((e) => {
        warnings.push('The row was not linked to the new partner: ' + (e instanceof Error ? e.message : 'try Find the partner'));
        return null;
      });
    }
  }
  await logEvent(env, {
    actor: ctx.actor, actor_email: ctx.email, kind: mode.standin ? 'partner_add_standin' : 'partner_added',
    detail: `${name} (${cid}${cid2 ? ', ' + cid2 : ''}) code ${a.code}${a.holder ? ' holder ' + a.holder : ''}; ${spent} calls; matches shown ${check ? check.matches.length : '?'} (${check ? check.live : 'unchecked'}); tick confirmed`,
  }).catch(() => undefined);
  return { ok: true, standin: mode.standin, cid, cid2, lookup, name, warnings, calls: mode.standin ? log : null, row };
}

const sayShort = (b: any): string => (!b ? 'Blackbaud said no' : typeof b === 'string' ? b : Array.isArray(b) && b[0] ? String(b[0].message || b[0].error_name || 'Blackbaud said no') : String(b.message || 'Blackbaud said no'));

void newId;
