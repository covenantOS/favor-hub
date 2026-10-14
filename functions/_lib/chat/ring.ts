// Ringing people into a huddle, the way Slack does (Will, 2026-10-14). The caller presses Huddle on a person (a direct message,
// a profile card, a people list, the dock) or Ring in the room's People panel. Each person rung gets:
//   - a 'ring' event on every open FavorOS tab (the chat socket), which shows a ringing toast with a sound, Join and Decline;
//   - a web push for a phone or a closed browser, with Join and Decline on the notice.
// The ring lasts RING_MS. Join or Decline on one device stops it on the others ('ring_end'). The caller's room hears each answer
// through the meeting sync (ringsFor) and the caller's other tabs through 'ring_state'. Nobody answers, the caller hangs up or the
// person is in quiet hours: the ring is missed and a "Missed huddle" note lands in the direct message between the two, which
// is how the person finds out (during quiet hours that note's push waits for the morning summary, like any other).
// Who may be rung is Chat's own directory for the caller: the Chat access group, no blocked people, and the test accounts ring
// only each other.
import { HttpError, type Env } from '../http';
import type { HubUser } from '../session';
import * as store from './db';
import { publish, type LiveEnv } from './live';
import { hydrateAttachments } from './hydrate';
import { pushForPost, pushToPeople, type PushEnv } from '../push';
import { quietNow } from '../quiet';
import { hex } from '../meet';

export const RING_MS = 30_000;
/** A caller rings at most this many people a minute. */
const RING_CAP = 20;
export type RingEnv = LiveEnv & PushEnv;
export type RingState = 'ringing' | 'joined' | 'declined' | 'missed';

export interface RingRow {
  id: string;
  meeting_id: string;
  channel_id: string;
  from_email: string;
  from_name: string;
  to_email: string;
  to_name: string;
  state: RingState;
  why: string;
  note: string;
  created_at: number;
  ends_at: number;
  answered_at: number;
}

export interface RingCard {
  id: string;
  mid: string;
  from: string;
  fromName: string;
  picture: string;
  title: string;
  /** The other people rung or already in the call, first names, for a group huddle. */
  with: string[];
  url: string;
  /** Milliseconds left to ring, measured on the server, so a wrong clock on the phone does not matter. */
  left: number;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const first = (n: string) => String(n || '').split(' ')[0];

async function ready(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM hub_meet_rings LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

async function cardOf(env: Env, row: RingRow, now = Date.now()): Promise<RingCard> {
  const pic = await env.DB.prepare('SELECT picture FROM hub_users WHERE lower(email) = ?').bind(row.from_email).first<{ picture: string }>().catch(() => null);
  const m = await env.DB.prepare('SELECT title FROM hub_meetings WHERE id = ?').bind(row.meeting_id).first<{ title: string }>().catch(() => null);
  const others = await env.DB.prepare(`SELECT to_name FROM hub_meet_rings WHERE meeting_id = ? AND to_email != ? AND state IN ('ringing', 'joined') AND created_at > ?`)
    .bind(row.meeting_id, row.to_email, now - 10 * 60_000).all<{ to_name: string }>().catch(() => ({ results: [] as Array<{ to_name: string }> }));
  return {
    id: row.id, mid: row.meeting_id, from: row.from_email, fromName: row.from_name || row.from_email, picture: pic?.picture || '', title: m?.title || 'Huddle',
    with: [...new Set((others.results || []).map((o) => first(o.to_name)).filter(Boolean))].slice(0, 6),
    url: `/meet/room/?m=${row.meeting_id}`, left: Math.max(0, row.ends_at - now),
  };
}

/**
 * Rings these people into a meeting. People already ringing for this meeting are left alone; people in quiet hours get the
 * missed note at once. Returns one line per person.
 */
export async function ringPeople(env: RingEnv, caller: { email: string; name: string }, meetingId: string, channelId: string, people: Array<{ email: string; name: string }>, now = Date.now()): Promise<Array<{ id: string; to: string; name: string; state: RingState; why: string }>> {
  if (!(await ready(env))) throw new HttpError(503, 'not_ready', 'Ringing is being set up. Try again in a minute.');
  const me = lower(caller.email);
  const list = people.map((p) => ({ email: lower(p.email), name: p.name || p.email })).filter((p) => p.email && p.email !== me);
  if (!list.length) return [];
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meet_rings WHERE from_email = ? AND created_at > ?').bind(me, now - 60_000).first<{ n: number }>();
  if ((recent?.n || 0) + list.length > RING_CAP) throw new HttpError(429, 'too_many', 'That is a lot of rings in a minute. Wait a moment and try again.');
  const quiet = await quietNow(env, list.map((p) => p.email), new Date(now)).catch(() => new Set<string>());
  const out: Array<{ id: string; to: string; name: string; state: RingState; why: string }> = [];
  for (const p of list) {
    const open = await env.DB.prepare(`SELECT id FROM hub_meet_rings WHERE meeting_id = ? AND to_email = ? AND state = 'ringing' AND ends_at > ?`).bind(meetingId, p.email, now).first<{ id: string }>();
    if (open) { out.push({ id: open.id, to: p.email, name: p.name, state: 'ringing', why: '' }); continue; }
    const row: RingRow = {
      id: hex(12), meeting_id: meetingId, channel_id: channelId || '', from_email: me, from_name: caller.name || me, to_email: p.email, to_name: p.name,
      state: 'ringing', why: '', note: '', created_at: now, ends_at: now + RING_MS, answered_at: 0,
    };
    await env.DB.prepare(
      `INSERT INTO hub_meet_rings (id, meeting_id, channel_id, from_email, from_name, to_email, to_name, state, why, note, created_at, ends_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ringing', '', '', ?, ?, 0)`
    ).bind(row.id, row.meeting_id, row.channel_id, row.from_email, row.from_name, row.to_email, row.to_name, row.created_at, row.ends_at).run();
    if (quiet.has(p.email)) {
      await settle(env, row, 'missed', { why: 'quiet' }, now);
      out.push({ id: row.id, to: p.email, name: p.name, state: 'missed', why: 'quiet' });
      continue;
    }
    const card = await cardOf(env, row, now);
    await publish(env, [p.email], { type: 'ring', ring: card });
    // A phone or a closed browser: the notice carries Join and Decline (public/sw.js). Quiet hours were checked above.
    await pushToPeople(env, [p.email], { title: `${row.from_name} is calling`, body: card.with.length ? `Huddle with ${[first(row.from_name), ...card.with].join(', ')}` : 'Huddle. Tap to join.', url: `${card.url}&ring=${row.id}`, tag: `ring-${row.id}`, ring: row.id }, fetch, { loud: true }).catch(() => 0);
    out.push({ id: row.id, to: p.email, name: p.name, state: 'ringing', why: '' });
  }
  return out;
}

/** Closes a ring once. Tells the person rung (every tab and device stops ringing) and the caller. A missed ring leaves a note. */
export async function settle(env: RingEnv, row: RingRow, state: Exclude<RingState, 'ringing'>, opts: { why?: string; note?: string } = {}, now = Date.now()): Promise<boolean> {
  const why = String(opts.why || '').slice(0, 20);
  const note = String(opts.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const res = await env.DB.prepare(`UPDATE hub_meet_rings SET state = ?, why = ?, note = ?, answered_at = ? WHERE id = ? AND state = 'ringing'`).bind(state, why, note, now, row.id).run();
  if (!res.meta || res.meta.changes !== 1) return false;
  await publish(env, [row.to_email], { type: 'ring_end', id: row.id, state });
  await publish(env, [row.from_email], { type: 'ring_state', id: row.id, mid: row.meeting_id, to: row.to_email, name: row.to_name, state, why, note });
  if (state === 'missed') {
    // The ringing notice on a phone or a closed browser turns into the missed one (same tag). In quiet hours nothing rang, so the
    // note's own push goes the usual way and waits for the morning summary.
    const ch = await missedNote(env, row, why, why === 'quiet').catch((err) => { console.warn('[ring] missed note', err); return ''; });
    if (why !== 'quiet') await pushToPeople(env, [row.to_email], { title: 'Missed huddle', body: `${row.from_name || row.from_email} called`, url: ch ? `/chat/?c=${encodeURIComponent(ch)}` : '/chat/', tag: `ring-${row.id}`, ring: row.id, ringEnd: 'missed' }, fetch, { loud: true }).catch(() => 0);
  }
  if (state === 'declined' && note) await sayInDm(env, { email: row.to_email, name: row.to_name }, row.from_email, note, true).catch((err) => console.warn('[ring] decline note', err));
  return true;
}

/** Posts a line in the direct message between two people, as one of them, and tells the other the way any message does. */
async function sayInDm(env: RingEnv, from: { email: string; name: string }, to: string, body: string, push: boolean): Promise<string> {
  const ch = await store.openConversation(env, from.email, [to]);
  const posted = await store.post(env, { channel_id: ch.id, email: from.email, body });
  const [msg] = await store.shape(env, [posted.message], (a, c) => hydrateAttachments(env, a, c));
  await publish(env, posted.members, { type: 'message', message: msg });
  if (push) await pushForPost(env, { notify: posted.notify, channel: posted.channel, senderName: from.name || from.email, text: body, messageId: posted.message.id, threadId: null }).catch(() => 0);
  return ch.id;
}

async function missedNote(env: RingEnv, row: RingRow, why: string, push: boolean): Promise<string> {
  const body = why === 'quiet' ? 'Missed huddle. Your quiet hours were on, so it did not ring.' : 'Missed huddle.';
  return sayInDm(env, { email: row.from_email, name: row.from_name }, row.to_email, body, push);
}

async function rowOf(env: Env, id: string): Promise<RingRow | null> {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return env.DB.prepare('SELECT * FROM hub_meet_rings WHERE id = ?').bind(id).first<RingRow>();
}

/** Join, Decline (with an optional quick message), Cancel by the caller, or Timeout from either side once the time is up. */
export async function answer(env: RingEnv, user: HubUser, id: string, b: Record<string, unknown>, now = Date.now()): Promise<{ ok: true; state: RingState; mid: string; url: string }> {
  const row = await rowOf(env, id);
  const me = lower(user.email);
  if (!row || (row.to_email !== me && row.from_email !== me)) throw new HttpError(404, 'not_found', 'That call is over.');
  const act = String(b.action || '');
  const url = `/meet/room/?m=${row.meeting_id}`;
  if (row.state !== 'ringing') return { ok: true, state: row.state, mid: row.meeting_id, url };
  if ((act === 'join' || act === 'decline') && row.to_email !== me) throw new HttpError(403, 'not_yours', 'Only the person rung can answer.');
  if (act === 'cancel' && row.from_email !== me) throw new HttpError(403, 'not_yours', 'Only the caller can hang up.');
  if (act === 'join') await settle(env, row, 'joined', {}, now);
  else if (act === 'decline') await settle(env, row, 'declined', { note: typeof b.note === 'string' ? b.note : '' }, now);
  else if (act === 'cancel') await settle(env, row, 'missed', { why: 'hungup' }, now);
  else if (act === 'timeout') { if (now + 1500 < row.ends_at) throw new HttpError(409, 'early', 'Still ringing.'); await settle(env, row, 'missed', { why: 'noanswer' }, now); }
  else throw new HttpError(400, 'bad_action', 'Join, decline or cancel.');
  const after = await rowOf(env, id);
  return { ok: true, state: (after?.state || row.state) as RingState, mid: row.meeting_id, url };
}

/** Rings nobody answered in time become missed. Run by the pending read, the room sync and the five-minute cron. */
export async function expireRings(env: RingEnv, now = Date.now(), where: { to?: string; mid?: string } = {}): Promise<number> {
  if (!(await ready(env))) return 0;
  const filt = where.to ? ' AND to_email = ?' : where.mid ? ' AND meeting_id = ?' : '';
  const args: unknown[] = [now];
  if (where.to) args.push(lower(where.to));
  else if (where.mid) args.push(where.mid);
  const rows = (await env.DB.prepare(`SELECT * FROM hub_meet_rings WHERE state = 'ringing' AND ends_at <= ?${filt} LIMIT 40`).bind(...args).all<RingRow>()).results || [];
  let n = 0;
  for (const r of rows) if (await settle(env, r, 'missed', { why: 'noanswer' }, now)) n++;
  return n;
}

/** The rings this person should see now (a page that opened mid-ring, or a phone opened from the notice). */
export async function pendingFor(env: RingEnv, email: string, now = Date.now()): Promise<RingCard[]> {
  if (!(await ready(env))) return [];
  await expireRings(env, now, { to: email });
  const rows = (await env.DB.prepare(`SELECT * FROM hub_meet_rings WHERE to_email = ? AND state = 'ringing' AND ends_at > ? ORDER BY created_at DESC LIMIT 3`).bind(lower(email), now).all<RingRow>()).results || [];
  const out: RingCard[] = [];
  for (const r of rows) out.push(await cardOf(env, r, now));
  return out;
}

/** The last two minutes of rings for a meeting, for the room: who is ringing, who declined (and what they said), who missed it. */
export async function ringsFor(env: Env, meetingId: string, now = Date.now()): Promise<Array<{ id: string; to: string; name: string; from: string; state: RingState; why: string; note: string; left: number; at: number }>> {
  try {
    const rows = (await env.DB.prepare('SELECT * FROM hub_meet_rings WHERE meeting_id = ? AND created_at > ? ORDER BY created_at').bind(meetingId, now - 120_000).all<RingRow>()).results || [];
    return rows.map((r) => ({ id: r.id, to: r.to_email, name: r.to_name, from: r.from_email, state: r.state, why: r.why, note: r.note, left: Math.max(0, r.ends_at - now), at: r.answered_at || r.created_at }));
  } catch {
    return [];
  }
}

/** The caller left a room nobody else is in, or the meeting ended: whoever is still ringing missed it. */
export async function ringsStop(env: RingEnv, meetingId: string, fromEmail = '', now = Date.now()): Promise<void> {
  if (!(await ready(env))) return;
  const rows = (await env.DB.prepare(`SELECT * FROM hub_meet_rings WHERE meeting_id = ? AND state = 'ringing'${fromEmail ? ' AND from_email = ?' : ''}`).bind(...(fromEmail ? [meetingId, lower(fromEmail)] : [meetingId])).all<RingRow>()).results || [];
  for (const r of rows) await settle(env, r, 'missed', { why: 'hungup' }, now);
}
