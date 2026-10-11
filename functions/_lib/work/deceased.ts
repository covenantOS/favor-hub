// What follows a deceased mark outside Blackbaud. The Record tab marks the Blackbaud record (records.ts). After Blackbaud keeps that
// mark, this runs once per change and carries it to the other places that would still contact the person:
//   mirror       the hub's copy of the record is re-read at once (the sync worker's /record-refresh), so every Work Center list sees it.
//   ghl          the GoHighLevel contact found by the record's emails (or its Blackbaud id in a custom field) gets Do Not Disturb on every
//                channel it does not already block, the tag "deceased", and a removal from the published workflows.
//   portal       my.favorintl.org is told not to email the person and not to let the account sign in (portal_blocks in the portal's database).
//   workcenter   open reminders the hub holds for the partner are closed; the Blackbaud actions stay as they are and the Work Center,
//                Asks and the morning email leave them out because the copy now says deceased.
// Marking active again reverses the Do Not Disturb the hub set, the tag and the portal block. A channel that was blocked before (an
// unsubscribe) keeps its own mark: the hub writes its own code on the channels it blocks and clears only those.
// Every effect is one row in the audit log (Admin > Audit log, area "records") and one in the Work Center event log.
import { nowIso, type Env } from '../http';
import { mirror, mirrorRecordRefresh } from '../foundations/blackbaud';
import { readOnly } from './repo';
import { logEvent } from './db';

export const DECEASED_TAG = 'deceased';
/** The code the hub writes on a channel it blocks, so reversing it never touches a block somebody else made. */
export const DND_CODE = 'hub-deceased';
export const CHANNELS = ['Call', 'Email', 'SMS', 'WhatsApp', 'GMB', 'FB'] as const;
/** Workflows removed per contact, at most. */
export const WORKFLOW_CAP = 60;

export interface Effect {
  effect: 'mirror' | 'ghl' | 'portal' | 'workcenter';
  ok: boolean;
  detail: string;
}

export interface EffectInput {
  cid: string;
  on: boolean;
  actor: string;
  email: string;
  batchId?: string;
}

export interface EffectDeps {
  fetch?: typeof fetch;
  refresh?: typeof mirrorRecordRefresh;
  emails?: (env: Env, cid: string) => Promise<string[]>;
  /** Workflows to leave per contact (tests and live checks pass 0, because a removal cannot be undone). */
  workflowCap?: number;
}

const ID = /^\d{1,12}$/;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** Every email the record has ever held, from the hub's copy of Blackbaud (inactive ones too: an old address may still be a contact). */
export async function recordEmails(env: Env, cid: string): Promise<string[]> {
  const rows = await mirror<{ e: string }>(env, readOnly('SELECT email_address AS e FROM emails WHERE constituent_record_id = ?1 LIMIT 40'), [cid]).catch(() => []);
  return [...new Set(rows.map((r) => lower(r.e)).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)))];
}

/* ------------------------------------------------------------------------------------------------------ GoHighLevel */

interface Ghl { base: string; head: Record<string, string>; loc: string; f: typeof fetch }

function ghlOf(env: Env, f: typeof fetch): Ghl | null {
  const e = env as unknown as { GHL_PIT?: string; GHL_LOCATION?: string; GHL_URL?: string };
  if (!e.GHL_PIT || !e.GHL_LOCATION) return null;
  // GoHighLevel answers 429 under a burst and a long run now and then drops a connection: each call is tried up to four times.
  const retrying: typeof fetch = async (input, init) => {
    let last: Response | undefined;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await f(input, init);
        if (r.status !== 429 && r.status < 500) return r;
        last = r;
      } catch (err) {
        if (i === 3) throw err;
      }
      await new Promise((ok) => setTimeout(ok, 300 * (i + 1)));
    }
    return last as Response;
  };
  return {
    base: e.GHL_URL || 'https://services.leadconnectorhq.com',
    head: { Authorization: `Bearer ${e.GHL_PIT}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
    loc: e.GHL_LOCATION,
    f: retrying,
  };
}

interface GhlContact { id: string; email?: string; tags?: string[]; dnd?: boolean; dndSettings?: Record<string, { status?: string; message?: string; code?: string }>; customFields?: { value?: unknown }[] }

async function findContacts(g: Ghl, cid: string, emails: string[]): Promise<GhlContact[]> {
  const found = new Map<string, GhlContact>();
  const search = async (q: string): Promise<GhlContact[]> => {
    const r = await g.f(`${g.base}/contacts/?locationId=${encodeURIComponent(g.loc)}&query=${encodeURIComponent(q)}&limit=20`, { headers: g.head });
    if (!r.ok) throw new Error(`search answered ${r.status}`);
    const j = (await r.json().catch(() => ({}))) as { contacts?: GhlContact[] };
    return Array.isArray(j.contacts) ? j.contacts : [];
  };
  for (const e of emails.slice(0, 8)) for (const c of await search(e)) if (lower(c.email) === e) found.set(c.id, c);
  // A contact that carries the Blackbaud id in a custom field, found by the id itself. Exact value only.
  for (const c of await search(cid)) if ((c.customFields || []).some((cf) => String(cf.value ?? '').trim() === cid)) found.set(c.id, c);
  // The search lists run behind the contact itself (a change shows in the list minutes later), so each match is read again by id. The
  // Do Not Disturb settings used below are the contact's own, never the list's.
  const fresh: GhlContact[] = [];
  for (const c of found.values()) {
    const r = await g.f(`${g.base}/contacts/${c.id}`, { headers: g.head }).catch(() => null);
    const j = r && r.ok ? ((await r.json().catch(() => ({}))) as { contact?: GhlContact }) : {};
    fresh.push(j.contact && j.contact.id === c.id ? j.contact : c);
  }
  return fresh;
}

/** The channels the hub blocks now: those the contact does not block already. */
export function dndOn(c: GhlContact): Record<string, { status: string; message: string; code: string }> {
  const out: Record<string, { status: string; message: string; code: string }> = {};
  for (const ch of CHANNELS) {
    if (c.dndSettings?.[ch]?.status === 'active') continue;
    out[ch] = { status: 'active', message: 'Deceased', code: DND_CODE };
  }
  return out;
}

/** The channels to release: only the ones the hub blocked. The overall flag stays on while any channel is still blocked. */
export function dndOff(c: GhlContact): { settings: Record<string, { status: string; message: string; code: string }>; stillBlocked: boolean } {
  const settings: Record<string, { status: string; message: string; code: string }> = {};
  let still = false;
  for (const ch of CHANNELS) {
    const cur = c.dndSettings?.[ch];
    if (cur?.status === 'active' && cur.code === DND_CODE) settings[ch] = { status: 'inactive', message: '', code: '' };
    else if (cur?.status === 'active') still = true;
  }
  return { settings, stillBlocked: still };
}

async function ghlEffect(env: Env, input: EffectInput, emails: string[], f: typeof fetch, cap = WORKFLOW_CAP): Promise<Effect> {
  const g = ghlOf(env, f);
  if (!g) return { effect: 'ghl', ok: false, detail: 'GoHighLevel is not connected to the hub.' };
  let contacts: GhlContact[];
  try {
    contacts = await findContacts(g, input.cid, emails);
  } catch (e) {
    return { effect: 'ghl', ok: false, detail: `Could not search GoHighLevel (${(e as Error).message}).` };
  }
  if (!contacts.length) return { effect: 'ghl', ok: true, detail: `No GoHighLevel contact matches this record's ${emails.length} email${emails.length === 1 ? '' : 's'} or its Blackbaud id. Nothing to change.` };

  let workflows: { id: string }[] = [];
  if (input.on && cap > 0) {
    const r = await g.f(`${g.base}/workflows/?locationId=${encodeURIComponent(g.loc)}`, { headers: g.head }).catch(() => null);
    const j = r && r.ok ? ((await r.json().catch(() => ({}))) as { workflows?: { id: string; status?: string }[] }) : {};
    workflows = (j.workflows || []).filter((w) => !w.status || w.status === 'published').slice(0, cap);
  }
  const notes: string[] = [];
  let bad = 0;
  for (const c of contacts) {
    const label = `contact ${c.id}`;
    try {
      if (input.on) {
        const settings = dndOn(c);
        const put = await g.f(`${g.base}/contacts/${c.id}`, { method: 'PUT', headers: g.head, body: JSON.stringify({ dnd: true, dndSettings: { ...(c.dndSettings || {}), ...settings } }) });
        if (!put.ok) throw new Error(`do not disturb answered ${put.status}`);
        const tag = await g.f(`${g.base}/contacts/${c.id}/tags`, { method: 'POST', headers: g.head, body: JSON.stringify({ tags: [DECEASED_TAG] }) });
        if (!tag.ok) throw new Error(`tag answered ${tag.status}`);
        let removed = 0;
        for (const w of workflows) {
          const d = await g.f(`${g.base}/contacts/${c.id}/workflow/${w.id}`, { method: 'DELETE', headers: g.head, body: JSON.stringify({}) }).catch(() => null);
          if (d && d.ok) removed++;
        }
        notes.push(`${label}: do not disturb on ${Object.keys(settings).length} channel${Object.keys(settings).length === 1 ? '' : 's'}, tag added, ${removed} of ${workflows.length} workflows answered a removal`);
      } else {
        const { settings, stillBlocked } = dndOff(c);
        if (Object.keys(settings).length || (c.dnd && !stillBlocked)) {
          const put = await g.f(`${g.base}/contacts/${c.id}`, { method: 'PUT', headers: g.head, body: JSON.stringify({ dnd: stillBlocked, dndSettings: { ...(c.dndSettings || {}), ...settings } }) });
          if (!put.ok) throw new Error(`do not disturb answered ${put.status}`);
        }
        const tag = await g.f(`${g.base}/contacts/${c.id}/tags`, { method: 'DELETE', headers: g.head, body: JSON.stringify({ tags: [DECEASED_TAG] }) });
        if (!tag.ok) throw new Error(`tag answered ${tag.status}`);
        notes.push(`${label}: released ${Object.keys(settings).length} channel${Object.keys(settings).length === 1 ? '' : 's'}${stillBlocked ? ', others stay blocked' : ''}, tag removed`);
      }
    } catch (e) {
      bad++;
      notes.push(`${label}: ${(e as Error).message}`);
    }
  }
  return { effect: 'ghl', ok: bad === 0, detail: notes.join('; ') };
}

/* ----------------------------------------------------------------------------------------------------------- portal */

export const PORTAL_BLOCKS_SQL = `CREATE TABLE IF NOT EXISTS portal_blocks (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  blocked_at TEXT NOT NULL,
  blocked_by TEXT NOT NULL,
  PRIMARY KEY (kind, value)
)`;

async function portalEffect(env: Env, input: EffectInput, emails: string[]): Promise<Effect> {
  const db = (env as unknown as { PORTAL_DB?: D1Database }).PORTAL_DB;
  if (!db) return { effect: 'portal', ok: false, detail: 'The giving portal database is not connected to the hub.' };
  const reason = `deceased:${input.cid}`;
  try {
    await db.prepare(PORTAL_BLOCKS_SQL).run();
    const acct = await db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE blackbaud_constituent_id = ?1 OR lower(email) IN (SELECT value FROM json_each(?2))`)
      .bind(input.cid, JSON.stringify(emails))
      .first<{ n: number }>()
      .catch(() => null);
    const accounts = Number(acct?.n) || 0;
    if (input.on) {
      const at = nowIso();
      const ins = db.prepare('INSERT INTO portal_blocks (kind, value, reason, blocked_at, blocked_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(kind, value) DO UPDATE SET reason = excluded.reason, blocked_at = excluded.blocked_at, blocked_by = excluded.blocked_by');
      await db.batch([ins.bind('constituent', input.cid, reason, at, input.email || input.actor), ...emails.map((e) => ins.bind('email', e, reason, at, input.email || input.actor))]);
      return { effect: 'portal', ok: true, detail: `Portal blocked for the record and ${emails.length} email${emails.length === 1 ? '' : 's'}; ${accounts} portal account${accounts === 1 ? '' : 's'} found. No email goes out and sign-in is refused.` };
    }
    const del = await db.prepare('DELETE FROM portal_blocks WHERE reason = ?1').bind(reason).run();
    return { effect: 'portal', ok: true, detail: `Portal block lifted (${Number(del.meta?.changes) || 0} entries removed); ${accounts} portal account${accounts === 1 ? '' : 's'} found.` };
  } catch (e) {
    return { effect: 'portal', ok: false, detail: `The portal block was not saved (${(e as Error).message}).` };
  }
}

/* ------------------------------------------------------------------------------------------------------ Work Center */

async function workcenterEffect(env: Env, input: EffectInput): Promise<Effect> {
  try {
    const open = await mirror<{ n: number }>(env, readOnly(`SELECT COUNT(*) AS n FROM actions WHERE constituent_record_id = ?1 AND json_extract(raw_json, '$.completed') = 0`), [input.cid]).catch(() => []);
    const left = Number(open[0]?.n) || 0;
    if (!input.on) return { effect: 'workcenter', ok: true, detail: 'Nothing to reverse. Closed reminders stay closed.' };
    const r = await env.DB.prepare(`UPDATE act_reminders SET state = 'done', done_at = ?1 WHERE cid = ?2 AND state = 'open'`).bind(nowIso(), input.cid).run();
    const closed = Number(r.meta?.changes) || 0;
    return { effect: 'workcenter', ok: true, detail: `${closed} reminder${closed === 1 ? '' : 's'} closed. ${left} open Blackbaud action${left === 1 ? '' : 's'} stay on the record and are left out of Mine, Asks and the morning email.` };
  } catch (e) {
    return { effect: 'workcenter', ok: false, detail: `Reminders were not closed (${(e as Error).message}).` };
  }
}

/* ----------------------------------------------------------------------------------------------------------- driver */

async function record(env: Env, input: EffectInput, e: Effect): Promise<void> {
  const label = { mirror: 'Hub copy', ghl: 'GoHighLevel', portal: 'Giving portal', workcenter: 'Work Center' }[e.effect];
  await env.DB.prepare('INSERT INTO hub_audit (at, actor, area, key, label, before_value, after_value, note) VALUES (?,?,?,?,?,?,?,?)')
    .bind(nowIso(), input.email || input.actor, 'records', `deceased:${input.cid}`, `${input.on ? 'Marked deceased' : 'Marked active'}: ${label}`, input.on ? 'active' : 'deceased', input.on ? 'deceased' : 'active', `${e.ok ? '' : 'FAILED. '}${e.detail}`.slice(0, 900))
    .run()
    .catch(() => undefined);
  await logEvent(env, { actor: input.actor, actor_email: input.email, batch_id: input.batchId, kind: e.ok ? 'deceased_effect' : 'deceased_effect_failed', ok: e.ok, detail: `${input.cid} ${e.effect}: ${e.detail}` }).catch(() => undefined);
}

/** Run every effect for one record. Each is independent: one failing never stops the others, and every result is logged. */
export async function runDeceasedEffects(env: Env, input: EffectInput, deps: EffectDeps = {}): Promise<Effect[]> {
  if (!ID.test(input.cid)) return [];
  const f = deps.fetch || fetch;
  const out: Effect[] = [];
  const push = async (e: Effect) => { out.push(e); await record(env, input, e); };

  // The hub's copy first, so the emails below are what Blackbaud holds now and every list sees the mark.
  const refresh = deps.refresh || mirrorRecordRefresh;
  const r = await refresh(env, [input.cid]).catch((e) => ({ ok: false, wait: String((e as Error).message) } as { ok: boolean; wait?: string }));
  await push({ effect: 'mirror', ok: r.ok, detail: r.ok ? 'The hub copy of the record is re-reading now.' : `The hub copy updates at the next sync (${r.wait || 'the sync worker did not take the request'}).` });

  const emails = await (deps.emails || recordEmails)(env, input.cid).catch(() => [] as string[]);
  await push(await ghlEffect(env, input, emails, f, deps.workflowCap ?? WORKFLOW_CAP));
  await push(await portalEffect(env, input, emails));
  await push(await workcenterEffect(env, input));
  return out;
}

/* ------------------------------------------------------------------------------------------------ after the drain sends */

const RECORD_PATH = /^\/constituent\/v1\/(?:constituents\/(\d+)$|addresses|phones|emailaddresses|constituentcodes|communicationpreferences)/;

export interface SentRow { id: string; batch_id?: string; op: string; cid: string | null; payload: string | null }

const obj = (s: unknown): any => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/**
 * Called by the drain with the rows Blackbaud just took. A record change (contact rows, codes, solicit codes, flags, deceased or
 * inactive) asks the sync worker to re-read that record, so the hub copy matches the same day. A deceased mark or its reversal also
 * runs the effects above. A row that failed its read-back is left alone.
 */
export async function afterRecordRows(env: Env, who: { actor: string; email: string }, rows: SentRow[], deps: EffectDeps = {}): Promise<{ refreshed: string[]; deceased: { cid: string; on: boolean }[] }> {
  const calls = rows.filter((r) => r.op === 'call').map((r) => ({ row: r, p: obj(r.payload) })).filter((x) => x.p.__call && RECORD_PATH.test(String(x.p.__call.path)));
  if (!calls.length) return { refreshed: [], deceased: [] };
  const failed = new Set<string>();
  const ids = calls.map((x) => x.row.id);
  const marks = ids.map(() => '?').join(',');
  const bad = await env.DB.prepare(`SELECT id FROM act_outbox WHERE id IN (${marks}) AND state IN ('failed', 'needs_human')`).bind(...ids).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));
  for (const b of bad.results) failed.add(String(b.id));

  const deceased = new Map<string, { on: boolean; batchId?: string }>();
  const others = new Set<string>();
  for (const { row, p } of calls) {
    if (failed.has(row.id)) continue;
    const m = RECORD_PATH.exec(String(p.__call.path));
    const cid = String(row.cid || (m && m[1]) || '');
    if (!ID.test(cid)) continue;
    if (p.__call.method === 'PATCH' && m && m[1] && typeof p.deceased === 'boolean') deceased.set(cid, { on: p.deceased === true, batchId: row.batch_id });
    else others.add(cid);
  }
  const refreshed: string[] = [];
  const rest = [...others].filter((c) => !deceased.has(c));
  if (rest.length) {
    const r = await (deps.refresh || mirrorRecordRefresh)(env, rest).catch(() => ({ ok: false }));
    if (r.ok) refreshed.push(...rest.slice(0, 10));
  }
  const out: { cid: string; on: boolean }[] = [];
  for (const [cid, d] of deceased) {
    await runDeceasedEffects(env, { cid, on: d.on, actor: who.actor, email: who.email, batchId: d.batchId }, deps);
    out.push({ cid, on: d.on });
  }
  return { refreshed, deceased: out };
}
