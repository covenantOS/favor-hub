// Blackbaud for the foundation list.
//
// Reads come from the RE NXT mirror through the sync worker's read-only query
// endpoint. Writes go through favorintl.org's guarded upkeep route, which
// holds the Blackbaud connection, a daily allowance and a ledger of every
// write. This file never talks to Blackbaud directly.

import { nowIso, type Env } from '../http';
import { getContact, getFoundation, getSetting, logEvent, setSetting, words, type Contact, type Foundation } from './db';

/** The record Blackbaud counts a contact on when the foundation has none of its own. */
export const CATCH_ALL = { lookup: '21046', system: '34684', name: 'Unsolicited Foundations' };

/**
 * Whose contact it can be, with each person's Blackbaud fundraiser id and the
 * action type their contacts post as. The grant writers post Grants Action,
 * the type for their own conversations with funders.
 */
export const PEOPLE: { name: string; id: string; team: string; type: string }[] = [
  { name: 'Stephanie Brady', id: '10496', team: 'RDDs', type: 'RDD Action' },
  { name: 'Brian Carr', id: '31646', team: 'RDDs', type: 'RDD Action' },
  { name: 'Rick Brown', id: '31681', team: 'RDDs', type: 'RDD Action' },
  { name: 'Celeste Paul', id: '28123', team: 'RDDs', type: 'RDD Action' },
  { name: 'Joe Krol', id: '30812', team: 'Grant writers', type: 'Grants Action' },
  { name: 'Crystal Hall', id: '32295', team: 'Grant writers', type: 'Grants Action' },
  { name: 'Gregory Phipps', id: '33656', team: 'Grant writers', type: 'Grants Action' },
];

/** The action types that count as a contact, written for SQL. The RESERVED (Grant ...) types are grant actions and are counted on their own. */
const CONTACT_TYPES = "'RDD Action', 'Grants Action'";

export const HOWS: Record<string, { category: string; outbound: boolean; tag?: string }> = {
  Call: { category: 'Phone call', outbound: true },
  Voicemail: { category: 'Phone call', outbound: true },
  Text: { category: 'Phone call', outbound: true, tag: 'Texted' },
  Email: { category: 'Email', outbound: true },
  Meeting: { category: 'Meeting', outbound: false },
  Mailing: { category: 'Mailing', outbound: true },
};

/** Tag name on this page -> action custom field category in Blackbaud. */
export const TAGS: Record<string, string> = {
  Scheduling: 'Scheduling',
  Stewardship: 'Stewardship',
  Texted: 'Texted',
  Thanked: 'Thanked',
  Presented: 'Favor Presentation',
};

export const OUTCOMES = [
  'No answer',
  'Left a message',
  'Spoke, wants information',
  'Spoke, not interested',
  'Meeting set',
  'Number does not work',
  'Does not fund this kind of work',
];

const OPS_URLS = ['https://favorintl.org/api/blackbaud/ops', 'https://favor-astro.pages.dev/api/blackbaud/ops'];
const MIRROR_URL = 'https://re-nxt-cloud-sync.super-paper-a785.workers.dev/d1/query';

export interface OpsResult {
  ok: boolean;
  status: number;
  body: any;
  /** The upkeep route has no rule for this call yet. */
  refused?: string;
  /** Nothing is wrong with the request; Blackbaud cannot take it right now. */
  wait?: string;
}

/**
 * Which address reaches the upkeep route from here. The hub and the website
 * share a zone, and one of the two hostnames may not answer a request that
 * starts inside it, so each is asked for the day's ledger (no Blackbaud call)
 * and the first that answers is kept for six hours. Writes then go to that one
 * address only, so a write is never sent twice.
 */
async function probeOps(env: Env): Promise<string> {
  for (const url of OPS_URLS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${url}?log=2000-01-01`, {
        headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY || '', 'User-Agent': 'Mozilla/5.0 favor-hub-foundations' },
        signal: ctl.signal,
      });
      const data = (await res.json().catch(() => null)) as any;
      if (res.ok && data && data.ok === true) return url;
    } catch {
      // try the next address
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

export async function opsUrl(env: Env): Promise<string> {
  if (env.BLACKBAUD_OPS_URL) return env.BLACKBAUD_OPS_URL;
  const cached = await getSetting(env, 'ops_url');
  if (cached) {
    const [url, at] = cached.split('|');
    if (url && Date.now() - Date.parse(at) < 6 * 3600000) return url;
  }
  const found = await probeOps(env);
  if (found) await setSetting(env, 'ops_url', `${found}|${nowIso()}`);
  return found || OPS_URLS[0];
}

/** Can this page reach Blackbaud's two doors right now? Makes no Blackbaud call. */
export async function connection(env: Env): Promise<{ blackbaud: boolean; mirror: boolean }> {
  let blackbaud = false;
  if (env.BLACKBAUD_SETUP_KEY) {
    const found = env.BLACKBAUD_OPS_URL || (await probeOps(env));
    blackbaud = Boolean(found);
    if (found && !env.BLACKBAUD_OPS_URL) await setSetting(env, 'ops_url', `${found}|${nowIso()}`);
  }
  let mirrorOk = false;
  try {
    const rows = await mirror<{ n: number }>(env, 'SELECT 1 AS n');
    mirrorOk = rows.length === 1;
  } catch {
    mirrorOk = false;
  }
  return { blackbaud, mirror: mirrorOk };
}

export async function ops(env: Env, method: string, path: string, body?: unknown): Promise<OpsResult> {
  if (!env.BLACKBAUD_SETUP_KEY) {
    return { ok: false, status: 0, body: null, wait: 'The Blackbaud connection is not set up on the hub yet.' };
  }
  const url = await opsUrl(env);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Setup-Key': env.BLACKBAUD_SETUP_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 favor-hub-foundations',
      },
      body: JSON.stringify(body === undefined ? { method, path } : { method, path, body }),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!data) return { ok: false, status: res.status, body: null, wait: 'Blackbaud did not answer. It will try again.' };
    if (data.error === 'daily_cap' || data.error === 'quota_stop') {
      return { ok: false, status: 429, body: data, wait: "Blackbaud is at today's limit. This posts after the reset." };
    }
    if (!Array.isArray(data.results)) {
      return { ok: false, status: res.status, body: data, wait: 'The Blackbaud connection turned the call away. It will try again.' };
    }
    const r = data.results[0] || {};
    if (r.status === 0 && r.body && r.body.refused) {
      return { ok: false, status: 0, body: r.body, refused: String(r.body.refused) };
    }
    if (r.status === 429 || r.status >= 500) {
      return { ok: false, status: r.status, body: r.body, wait: 'Blackbaud is busy. It will try again.' };
    }
    return { ok: Boolean(r.ok), status: Number(r.status) || 0, body: r.body };
  } catch {
    return { ok: false, status: 0, body: null, wait: 'Blackbaud did not answer. It will try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export interface OpsCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface OpsManyResult {
  /** One answer per call that ran, in order. A call past the end of this list did not run. */
  results: Array<{ ok: boolean; status: number; body: any; refused?: string }>;
  /** Nothing ran, or the answer was lost. After a lost answer a create may have succeeded. */
  wait?: string;
  /** True when the request left the hub and no answer came back, so any create in it may have landed. */
  lost?: boolean;
  callsToday?: number;
  cap?: number;
}

/**
 * Up to 15 calls in one request to the upkeep route, run in order. A refused, throttled or forbidden call ends the batch, so
 * `results` can be shorter than `calls`. Every call, a read included, counts against the day's cap.
 */
export async function opsMany(env: Env, calls: OpsCall[]): Promise<OpsManyResult> {
  if (!env.BLACKBAUD_SETUP_KEY) return { results: [], wait: 'The Blackbaud connection is not set up on the hub yet.' };
  if (calls.length < 1 || calls.length > 15) throw new Error('send between 1 and 15 calls');
  const url = await opsUrl(env);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 28000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 favor-hub-work' },
      body: JSON.stringify({ calls }),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!data) return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
    if (data.error === 'daily_cap' || data.error === 'quota_stop') return { results: [], wait: "Blackbaud is at today's limit. This posts after the reset." };
    if (!Array.isArray(data.results)) return { results: [], wait: 'The Blackbaud connection turned the call away. It will try again.' };
    const results = data.results.map((r: any) =>
      r.status === 0 && r.body && r.body.refused
        ? { ok: false, status: 0, body: r.body, refused: String(r.body.refused) }
        : { ok: Boolean(r.ok), status: Number(r.status) || 0, body: r.body }
    );
    return { results, callsToday: Number(data.calls_today) || undefined, cap: Number(data.cap) || undefined };
  } catch {
    return { results: [], wait: 'Blackbaud did not answer. It will try again.', lost: true };
  } finally {
    clearTimeout(timer);
  }
}

export function sayWhy(body: any): string {
  if (!body) return 'Blackbaud turned it down.';
  if (typeof body === 'string') return body.slice(0, 240);
  if (Array.isArray(body) && body[0]) return String(body[0].message || body[0].error_name || JSON.stringify(body[0])).slice(0, 240);
  return String(body.message || body.title || body.error || JSON.stringify(body)).slice(0, 240);
}

/** Read-only SQL against the RE NXT mirror. The endpoint turns away any statement that could write. */
export async function mirror<T = Record<string, any>>(env: Env, sql: string, params: unknown[] = []): Promise<T[]> {
  if (!env.MIRROR_API_KEY) throw new Error('mirror key missing');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(env.MIRROR_QUERY_URL || MIRROR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.MIRROR_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok || !Array.isArray(data)) throw new Error(`mirror ${res.status}`);
    return data as T[];
  } finally {
    clearTimeout(timer);
  }
}

export interface BbOrg {
  lookup_id: string;
  system_id: string;
  name: string;
  where: string;
  made: string;
  codes: string[];
  held: string[];
  gifts: number;
  gift_total: number;
  last_gift: string;
  contacts: number;
  last_contact: string;
  grant_actions: number;
  last_grant: string;
}

const ORG_FIELDS = `
  k.id, k.constituent_lookup_id AS l, k.organization_name AS n, k.date_added AS da, k.raw_json,
  (SELECT COUNT(*) FROM gifts g WHERE g.constituent_record_id = k.id AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift') AS g,
  (SELECT SUM(g.gift_amount) FROM gifts g WHERE g.constituent_record_id = k.id AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift') AS t,
  (SELECT MAX(g.gift_date) FROM gifts g WHERE g.constituent_record_id = k.id AND g.gift_amount > 0 AND g.gift_type <> 'RecurringGift') AS lg,
  (SELECT COUNT(*) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_date_due <= ?1) AS a,
  (SELECT MAX(a.action_date_due) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_date_due <= ?1) AS la,
  (SELECT COUNT(*) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_type LIKE 'RESERVED (Grant%') AS gr,
  (SELECT MAX(a.action_date_due) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_type LIKE 'RESERVED (Grant%' AND a.action_date_due <= ?1) AS lgr`;

async function shapeOrgs(env: Env, rows: any[]): Promise<BbOrg[]> {
  if (!rows.length) return [];
  const marks = rows.map((_, i) => `?${i + 1}`).join(',');
  const codes = await mirror<{ c: string; raw_json: string }>(
    env,
    `SELECT constituent_record_id AS c, raw_json FROM constituent_codes WHERE constituent_record_id IN (${marks})`,
    rows.map((r) => r.id)
  ).catch(() => []);
  const byOrg: Record<string, { s: number; d: string }[]> = {};
  for (const c of codes) {
    try {
      const j = JSON.parse(c.raw_json || '{}');
      // The mirror keeps ended codes (inactive true) since the sync worker pulls them; a card shows current codes only.
      if (j.inactive === true || j.inactive === 'true') continue;
      (byOrg[c.c] = byOrg[c.c] || []).push({ s: Number(j.sequence) || 9, d: String(j.description || '') });
    } catch {
      // skip a code row that will not parse
    }
  }
  return rows.map((r) => {
    let raw: any = {};
    try {
      raw = JSON.parse(r.raw_json || '{}');
    } catch {
      raw = {};
    }
    const addr = raw.address || {};
    const city = String(addr.city || '').trim();
    const where = [city ? city.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '', String(addr.state || '').trim()]
      .filter(Boolean)
      .join(', ');
    return {
      lookup_id: String(r.l || ''),
      system_id: String(r.id),
      name: String(r.n || '').trim(),
      where,
      made: String(r.da || '').slice(0, 10),
      codes: (byOrg[r.id] || []).sort((a, b) => a.s - b.s).map((c) => c.d).filter(Boolean),
      held: (raw.constituent_assigned_fundraisers || []).map((f: any) => String(f.fundraiser_name || '')).filter(Boolean),
      gifts: Number(r.g) || 0,
      gift_total: Math.round(Number(r.t) || 0),
      last_gift: String(r.lg || '').slice(0, 10),
      contacts: Number(r.a) || 0,
      last_contact: String(r.la || '').slice(0, 10),
      grant_actions: Number(r.gr) || 0,
      last_grant: String(r.lgr || '').slice(0, 10),
    };
  });
}

function todayStamp(): string {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00:00';
}

/** Organizations in Blackbaud whose name holds every word of the search. */
export async function searchOrgs(env: Env, query: string, limit = 12): Promise<BbOrg[]> {
  const toks = words(query).filter((w) => w.length > 1).slice(0, 5);
  if (!toks.length) return [];
  const where = toks.map((_, i) => `k.organization_name LIKE ?${i + 2}`).join(' AND ');
  const rows = await mirror(
    env,
    `SELECT ${ORG_FIELDS} FROM constituents k
     WHERE k.constituent_type = 'Organization' AND k.inactive = 0 AND k.id <> '${CATCH_ALL.system}' AND ${where}
     ORDER BY g DESC, a DESC LIMIT ${Math.min(Math.max(limit, 1), 25)}`,
    [todayStamp(), ...toks.map((t) => `%${t}%`)]
  );
  return shapeOrgs(env, rows);
}

export async function orgByLookup(env: Env, lookupId: string): Promise<BbOrg | null> {
  const rows = await mirror(
    env,
    `SELECT ${ORG_FIELDS} FROM constituents k WHERE k.constituent_lookup_id = ?2 AND k.constituent_type = 'Organization' LIMIT 1`,
    [todayStamp(), lookupId]
  );
  const shaped = await shapeOrgs(env, rows);
  return shaped[0] || null;
}

/** Foundation records that hold nothing but contacts from RDDs and grant writers: made at a first call, never took a gift or a grant request. */
export async function thinRecords(env: Env): Promise<{ lookup_id: string; name: string; made: string; contacts: number; last: string }[]> {
  const rows = await mirror(
    env,
    `SELECT k.constituent_lookup_id AS l, k.organization_name AS n, k.date_added AS da,
       (SELECT COUNT(*) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_type IN (${CONTACT_TYPES})) AS contacts,
       (SELECT COUNT(*) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_type NOT IN (${CONTACT_TYPES}, 'RESERVED (Review New Constituent Record)')) AS other,
       (SELECT MAX(a.action_date_due) FROM actions a WHERE a.constituent_record_id = k.id AND a.action_type IN (${CONTACT_TYPES})) AS last,
       (SELECT COUNT(*) FROM gifts g WHERE g.constituent_record_id = k.id AND g.gift_amount > 0) AS g,
       (SELECT COUNT(*) FROM opportunities o WHERE o.constituent_record_id = k.id) AS op
     FROM constituents k
     WHERE k.constituent_type = 'Organization' AND k.inactive = 0 AND k.id <> '${CATCH_ALL.system}'
       AND k.date_added >= '2026-03-01' AND k.raw_json LIKE '%Joe Krol%'
     ORDER BY k.date_added`
  );
  return rows
    .filter((r: any) => Number(r.contacts) > 0 && !Number(r.other) && !Number(r.g) && !Number(r.op))
    .map((r: any) => ({
      lookup_id: String(r.l),
      name: String(r.n || '').trim(),
      made: String(r.da || '').slice(0, 10),
      contacts: Number(r.contacts),
      last: String(r.last || '').slice(0, 10),
    }));
}

/* ------------------------------------------------------------------ writes */

/**
 * The action type a contact posts as, from the person whose id is on it. The
 * contact keeps that id in rdd_id, a grant writer's included. An id not on
 * the list, as on an older or imported contact, posts as RDD Action.
 */
function actionType(fundraiserId: string): string {
  return PEOPLE.find((p) => p.id === fundraiserId)?.type || 'RDD Action';
}

export function actionBody(constituentSystemId: string, c: Pick<Contact, 'contact_date' | 'how' | 'category' | 'rdd_id' | 'summary' | 'note'>): Record<string, unknown> {
  const date = `${c.contact_date}T00:00:00`;
  const body: Record<string, unknown> = {
    constituent_id: constituentSystemId,
    category: c.category,
    type: actionType(c.rdd_id),
    date,
    summary: c.summary.slice(0, 255),
    description: c.note,
    completed: true,
    completed_date: date,
    priority: 'Normal',
  };
  if (HOWS[c.how]?.outbound) body.direction = 'Outbound';
  if (c.rdd_id) body.fundraisers = [c.rdd_id];
  return body;
}

async function setContact(env: Env, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  await env.DB.prepare(`UPDATE fnd_contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), nowIso(), id)
    .run();
}

async function tagValue(env: Env, category: string): Promise<string> {
  const key = `tagvalue:${category}`;
  const cached = await getSetting(env, key);
  if (cached) return cached;
  const r = await ops(env, 'GET', `/constituent/v1/actions/customfields/categories/values?category_name=${encodeURIComponent(category)}`);
  const list: string[] = r.ok && r.body && Array.isArray(r.body.value) ? r.body.value.map(String) : [];
  const value = list.find((v) => v.toLowerCase() === category.toLowerCase()) || list[0] || category;
  if (list.length) await setSetting(env, key, value);
  return value;
}

/**
 * Whether the upkeep route can make a given kind of write yet. An empty body
 * tells them apart with nothing changed: the route turns it away when it has
 * no rule, and Blackbaud rejects it as incomplete when the route lets it by.
 * The answer is kept for half an hour.
 */
export async function ruleLive(env: Env, key: 'tags' | 'create'): Promise<boolean> {
  const cached = await getSetting(env, `rule:${key}`);
  if (cached) {
    const [v, at] = cached.split('|');
    if (Date.now() - Date.parse(at) < 30 * 60000) return v === '1';
  }
  const path = key === 'tags' ? '/constituent/v1/actions/customfields' : '/constituent/v1/constituents';
  const r = await ops(env, 'POST', path, {});
  if (r.wait) return cached ? cached.startsWith('1') : false;
  const live = !r.refused;
  await setSetting(env, `rule:${key}`, `${live ? 1 : 0}|${nowIso()}`);
  return live;
}

/** Put a contact's tags on its Blackbaud action. Waits quietly when the upkeep route cannot do that yet. */
export async function postTags(env: Env, contactId: string, actor: string): Promise<void> {
  const c = await getContact(env, contactId);
  if (!c || !c.bb_action_id || c.bb_state !== 'posted') return;
  let tags: string[] = [];
  try {
    tags = JSON.parse(c.tags || '[]');
  } catch {
    tags = [];
  }
  const implied = HOWS[c.how]?.tag;
  if (implied && !tags.includes(implied)) tags.push(implied);
  if (!tags.length) {
    if (c.bb_tags_state !== 'none') await setContact(env, c.id, { bb_tags_state: 'none' });
    return;
  }
  if (!(await ruleLive(env, 'tags'))) {
    if (c.bb_tags_state !== 'waiting') await setContact(env, c.id, { bb_tags_state: 'waiting' });
    return;
  }
  const already = (await getSetting(env, `tagsdone:${c.id}`)).split('|').filter(Boolean);
  for (const tag of tags) {
    if (already.includes(tag)) continue;
    const category = TAGS[tag];
    if (!category) continue;
    const path = '/constituent/v1/actions/customfields';
    const r = await ops(env, 'POST', path, {
      parent_id: c.bb_action_id,
      category,
      value: await tagValue(env, category),
      date: `${c.contact_date}T00:00:00`,
    });
    await logEvent(env, { foundation_id: c.foundation_id, contact_id: c.id, kind: 'tag', actor, method: 'POST', path, ok: r.ok, status: r.status, detail: r.ok ? tag : r.refused || r.wait || sayWhy(r.body) });
    if (!r.ok) {
      await setContact(env, c.id, { bb_tags_state: 'waiting' });
      return;
    }
    already.push(tag);
    await setSetting(env, `tagsdone:${c.id}`, already.join('|'));
  }
  await setContact(env, c.id, { bb_tags_state: 'posted' });
}

/** Send one contact to Blackbaud as an action of its person's type. Safe to call again: a posted contact is never posted twice. */
export async function postContact(env: Env, contactId: string, actor: string): Promise<Contact | null> {
  const c = await getContact(env, contactId);
  if (!c) return null;
  if (c.bb_state === 'posted' && c.bb_action_id) {
    if (c.bb_tags_state === 'waiting') await postTags(env, c.id, actor);
    return getContact(env, contactId);
  }
  if ((await getSetting(env, 'posting', 'on')) !== 'on') {
    await setContact(env, c.id, { bb_state: 'held', bb_error: 'Posting to Blackbaud is switched off.' });
    return getContact(env, contactId);
  }
  const f = (await getFoundation(env, c.foundation_id)) as Foundation | null;
  if (!f) return c;
  const target = f.bb_system_id && f.bb_lookup_id ? { system: f.bb_system_id, lookup: f.bb_lookup_id } : CATCH_ALL;
  const path = '/constituent/v1/actions';
  const r = await ops(env, 'POST', path, actionBody(target.system, c));
  const newId = r.ok && r.body && r.body.id ? String(r.body.id) : '';
  await logEvent(env, {
    foundation_id: f.id,
    contact_id: c.id,
    kind: 'post_contact',
    actor,
    method: 'POST',
    path,
    ok: Boolean(newId),
    status: r.status,
    detail: newId ? `action ${newId} on #${target.lookup}: ${c.summary}` : r.refused || r.wait || sayWhy(r.body),
  });
  if (newId) {
    await setContact(env, c.id, { bb_action_id: newId, bb_on: target.lookup, bb_state: 'posted', bb_error: '' });
    await postTags(env, c.id, actor);
  } else if (r.wait) {
    await setContact(env, c.id, { bb_state: 'pending', bb_error: r.wait });
  } else {
    await setContact(env, c.id, { bb_state: 'failed', bb_error: r.refused ? 'The Blackbaud connection does not allow this yet.' : sayWhy(r.body) });
  }
  return getContact(env, contactId);
}

/** Take a contact made on this page back out of Blackbaud. */
export async function unpostContact(env: Env, c: Contact, actor: string): Promise<{ ok: boolean; message?: string }> {
  if (!c.bb_action_id || c.bb_state !== 'posted') return { ok: true };
  const path = `/constituent/v1/actions/${c.bb_action_id}`;
  const r = await ops(env, 'DELETE', path);
  const gone = r.ok || r.status === 404;
  await logEvent(env, {
    foundation_id: c.foundation_id,
    contact_id: c.id,
    kind: 'delete_contact',
    actor,
    method: 'DELETE',
    path,
    ok: gone,
    status: r.status,
    detail: gone ? `action ${c.bb_action_id} removed from #${c.bb_on}` : r.refused || r.wait || sayWhy(r.body),
  });
  return gone ? { ok: true } : { ok: false, message: r.wait || 'Blackbaud would not remove it. Try again in a minute.' };
}

/** Try again on anything that did not reach Blackbaud. Called when the page opens and from the activity tab. */
export async function retryWaiting(env: Env, actor: string, max = 6): Promise<number> {
  const waitingTags = (await env.DB.prepare("SELECT COUNT(*) AS n FROM fnd_contacts WHERE source = 'app' AND bb_state = 'posted' AND bb_tags_state = 'waiting'").first<{ n: number }>())?.n || 0;
  const tagsToo = waitingTags > 0 && (await ruleLive(env, 'tags'));
  const rows = await env.DB.prepare(
    `SELECT id FROM fnd_contacts
     WHERE source = 'app' AND (bb_state IN ('pending', 'held') ${tagsToo ? "OR (bb_state = 'posted' AND bb_tags_state = 'waiting')" : ''})
     ORDER BY updated_at LIMIT ?`
  )
    .bind(max)
    .all<{ id: string }>();
  let n = 0;
  for (const row of rows.results) {
    await postContact(env, row.id, actor || 'retry');
    n++;
  }
  return n;
}
