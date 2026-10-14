// The meeting follow-up email. Off by default (hub_meeting_assist_prefs.followup_on).
//   After a meeting with people outside Favor, when its notes are ready (afterNotes), each Favor host or made host:
//     - with it on: gets a draft to the outside attendees, from the notes and action items, written the way they write (their own
//       recent sent mail is the example), kept in hub_meeting_followups. FavorOS opens it in the composer for editing. It is never
//       sent from here.
//     - with it off and never asked: gets one suggestion with a short how it works and a Turn on switch. Once, ever.
// The draft comes from a model through the AI budget guard; past the cap, or with no model, a plain draft from the notes is used.
import { HttpError, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { isHiddenAccount, isTester } from '../testuser';
import { emailsOf, ledPeople, mayReadNotes, type Meeting, type MeetEnv } from '../meet';
import { prefsFor } from './prep';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const FAVOR = /@favorintl\.org$/i;
const ET = 'America/New_York';

export interface Draft { to: string[]; subject: string; body: string }

interface Ctx { m: Meeting; outside: Array<{ email: string; name: string }>; actions: Array<{ text: string; owner_name: string; owner_email: string; due: string }>; decisions: string[] }

async function contextOf(env: Env, id: string): Promise<Ctx | null> {
  const m = await env.DB.prepare('SELECT * FROM hub_meetings WHERE id = ?').bind(id).first<Meeting>().catch(() => null);
  if (!m || m.status !== 'ended' || m.notes_status !== 'ready') return null;
  const names = new Map<string, string>();
  try { for (const i of JSON.parse(m.invitees || '[]') as Array<{ email?: string; name?: string }>) if (i && i.email) names.set(lower(i.email), i.name || ''); } catch { /* none */ }
  const outside = emailsOf(m.invitees).filter((e) => e && !FAVOR.test(e) && !e.startsWith('guest:') && !isHiddenAccount(e) && !/example\.test$/.test(e)).map((e) => ({ email: e, name: names.get(e) || '' }));
  if (!outside.length) return null;
  const actions = (await env.DB.prepare('SELECT text, owner_name, owner_email, due FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx LIMIT 10').bind(id).all<Ctx['actions'][number]>().catch(() => ({ results: [] as Ctx['actions'] }))).results || [];
  let decisions: string[] = [];
  try { decisions = ((JSON.parse(m.notes_json || '{}') as { decisions?: Array<{ text?: string } | string> }).decisions || []).map((d) => (typeof d === 'string' ? d : d.text || '')).filter(Boolean).slice(0, 5); } catch { /* none */ }
  return { m, outside, actions, decisions };
}

const firstName = (n: string, email: string) => (n || email.split('@')[0]).trim().split(/[\s.]+/)[0].replace(/^./, (c) => c.toUpperCase());

/** The plain draft: no model, only what the notes say. Also the fallback. */
export function plainDraft(c: Ctx, me: { name: string }): Draft {
  const hello = c.outside.length === 1 ? `Hi ${firstName(c.outside[0].name, c.outside[0].email)},` : `Hi ${c.outside.map((p) => firstName(p.name, p.email)).slice(0, 3).join(', ')},`;
  const day = new Date(c.m.started_at || c.m.created_at).toLocaleDateString('en-US', { timeZone: ET, weekday: 'long' });
  const lines = [hello, '', `Thank you for meeting with me ${day}.`];
  if (c.m.summary) lines.push('', String(c.m.summary).replace(/\s*[—–]\s*/g, ', ').slice(0, 700));
  const next = c.actions.filter((a) => a.text);
  if (next.length) lines.push('', 'Next steps:', ...next.slice(0, 6).map((a) => `- ${a.text}${a.owner_name ? ` (${a.owner_name})` : ''}${a.due ? `, ${a.due}` : ''}`));
  lines.push('', 'Thank you,', me.name.split(' ')[0] || me.name);
  return { to: c.outside.map((p) => p.email), subject: `Following up: ${c.m.title || 'our meeting'}`.slice(0, 140), body: lines.join('\n') };
}

/** Up to three short pieces of the person's own sent mail, for how they write. Their own mailbox rows only. */
async function voiceOf(env: Env, email: string): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT row_json FROM hub_mail_rows WHERE mailbox = ? AND row_json LIKE '%"fromMe":true%' ORDER BY at DESC LIMIT 12`).bind(lower(email)).all<{ row_json: string }>().catch(() => ({ results: [] as Array<{ row_json: string }> }));
  const out: string[] = [];
  for (const x of r.results || []) {
    try {
      const row = JSON.parse(x.row_json) as { snippet?: string; bulk?: boolean };
      if (row.snippet && !row.bulk && row.snippet.length > 40) out.push(row.snippet.slice(0, 220));
    } catch { /* skip */ }
    if (out.length >= 3) break;
  }
  return out;
}

export async function draftFor(env: Env, user: { email: string; name: string }, c: Ctx): Promise<Draft> {
  const base = plainDraft(c, user);
  try {
    const { chatJson } = await import('../clipai');
    const voice = await voiceOf(env, user.email);
    const system = 'You draft a short follow-up email after a meeting, for a staff member of Favor International, a Christian nonprofit. Write in first person as that person, warm and plain, under 170 words. Use only facts from the notes. Never invent names, dates, amounts or promises. Never use em dashes. Never mention artificial intelligence or that this was drafted for them. Call supporters partners, never donors. Answer as JSON {"subject": string, "body": string}.';
    const prompt = [
      `Sender: ${user.name}`,
      `To: ${c.outside.map((p) => `${p.name || p.email} <${p.email}>`).join(', ')}`,
      `Meeting: ${c.m.title}`,
      `Summary: ${String(c.m.summary || '').slice(0, 1500)}`,
      c.decisions.length ? `Decisions:\n${c.decisions.map((d) => '- ' + d).join('\n')}` : '',
      c.actions.length ? `Action items:\n${c.actions.map((a) => `- ${a.text}${a.owner_name ? ` (owner ${a.owner_name})` : ''}${a.due ? ` due ${a.due}` : ''}`).join('\n')}` : '',
      voice.length ? `How ${user.name.split(' ')[0]} writes (recent emails):\n${voice.map((v) => '> ' + v).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const r = await chatJson<{ subject?: string; body?: string }>(env as never, system, prompt, 600, undefined, { feature: 'meet-followup', json: true });
    const body = String(r.body || '').replace(/\s*[—–]\s*/g, ', ').replace(/\bdonors?\b/gi, (w) => (/s$/i.test(w) ? 'partners' : 'partner')).trim();
    if (body.length < 40) return base;
    return { to: base.to, subject: String(r.subject || base.subject).replace(/\s*[—–]\s*/g, ', ').slice(0, 140), body: body.slice(0, 4000) };
  } catch {
    return base;
  }
}

/** Runs when a meeting's notes are ready. A draft for hosts who turned it on; one suggestion for hosts never asked. */
export async function followupAfterNotes(env: MeetEnv, id: string): Promise<number> {
  const c = await contextOf(env, id);
  if (!c) return 0;
  const hosts = [...new Set([lower(c.m.host_email), ...emailsOf(c.m.cohosts)])].filter((e) => FAVOR.test(e));
  let n = 0;
  for (const email of hosts) {
    if (isTester(email) && !c.outside.every((p) => isHiddenAccount(p.email))) continue;
    const u = await env.DB.prepare('SELECT name, blocked FROM hub_users WHERE lower(email) = ?').bind(email).first<{ name: string; blocked: number }>().catch(() => null);
    if (!u || u.blocked) continue;
    const prefs = await prefsFor(env, email);
    const had = await env.DB.prepare('SELECT 1 AS ok FROM hub_meeting_followups WHERE meeting_id = ? AND email = ?').bind(id, email).first().catch(() => null);
    if (had) continue;
    const now = nowIso();
    if (prefs.followup_on) {
      const d = await draftFor(env, { email, name: u.name || email }, c);
      await env.DB.prepare(`INSERT OR IGNORE INTO hub_meeting_followups (meeting_id, email, state, to_list, subject, body, created_at, updated_at) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?)`)
        .bind(id, email, JSON.stringify(d.to), d.subject, d.body, now, now).run();
      n++;
    } else if (!prefs.followup_offered_at && !prefs.followup_offer_closed) {
      await env.DB.prepare(`INSERT OR IGNORE INTO hub_meeting_followups (meeting_id, email, state, to_list, subject, body, created_at, updated_at) VALUES (?, ?, 'offer', '[]', '', '', ?, ?)`).bind(id, email, now, now).run();
      n++;
    }
  }
  return n;
}

/** What waits for this person: drafts ready to open, and the one-time suggestion. The last three days only. */
export async function myFollowups(env: Env, user: HubUser) {
  const me = lower(user.email);
  const r = await env.DB.prepare(
    `SELECT f.meeting_id, f.state, f.to_list, f.subject, f.body, f.created_at, m.title FROM hub_meeting_followups f JOIN hub_meetings m ON m.id = f.meeting_id
      WHERE f.email = ? AND f.state IN ('ready', 'offer') AND f.created_at > ? ORDER BY f.created_at DESC LIMIT 5`
  ).bind(me, new Date(Date.now() - 3 * 86400000).toISOString()).all<{ meeting_id: string; state: string; to_list: string; subject: string; body: string; created_at: string; title: string }>().catch(() => ({ results: [] as never[] }));
  const prefs = await prefsFor(env, me);
  const list = (r.results || []).filter((x) => x.state === 'ready' || (!prefs.followup_on && !prefs.followup_offer_closed));
  // The suggestion shows once, ever: the first time it is handed out it counts as offered.
  if (list.some((x) => x.state === 'offer') && !prefs.followup_offered_at) {
    await env.DB.prepare(`INSERT INTO hub_meeting_assist_prefs (email, followup_offered_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET followup_offered_at = excluded.followup_offered_at`).bind(me, nowIso(), nowIso()).run().catch(() => undefined);
  }
  const seenOffer = prefs.followup_offered_at && Date.now() - Date.parse(prefs.followup_offered_at) > 6 * 3600000;
  return {
    ok: true,
    on: prefs.followup_on,
    items: list
      .filter((x) => x.state === 'ready' || !seenOffer)
      .slice(0, 3)
      .map((x) => ({ meeting_id: x.meeting_id, title: x.title || 'Meeting', state: x.state, to: safe(x.to_list), subject: x.subject, body: x.body, at: x.created_at })),
  };
}
const safe = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

/** Open (the page puts it in the composer), dismiss, or make the draft now (right after turning it on from the suggestion). */
export async function actOnFollowup(env: Env, user: HubUser, meetingId: string, b: Record<string, unknown>) {
  const me = lower(user.email);
  const row = await env.DB.prepare('SELECT * FROM hub_meeting_followups WHERE meeting_id = ? AND email = ?').bind(meetingId, me).first<{ state: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'That follow-up is gone.');
  const action = String(b.action || '');
  if (action === 'opened' || action === 'dismiss') {
    await env.DB.prepare('UPDATE hub_meeting_followups SET state = ?, updated_at = ? WHERE meeting_id = ? AND email = ?').bind(action === 'opened' ? 'opened' : 'dismissed', nowIso(), meetingId, me).run();
    return { ok: true };
  }
  if (action === 'draft') {
    const prefs = await prefsFor(env, me);
    if (!prefs.followup_on) throw new HttpError(409, 'off', 'Turn on follow-up emails first.');
    const c = await contextOf(env, meetingId);
    if (!c) throw new HttpError(404, 'not_found', 'That meeting has no notes yet.');
    const led = await ledPeople(env as MeetEnv, me).catch(() => new Set<string>());
    if (!mayReadNotes(c.m, user, led)) throw new HttpError(404, 'not_found', 'That follow-up is gone.');
    const d = await draftFor(env, { email: me, name: user.name || me }, c);
    await env.DB.prepare(`UPDATE hub_meeting_followups SET state = 'ready', to_list = ?, subject = ?, body = ?, updated_at = ? WHERE meeting_id = ? AND email = ?`).bind(JSON.stringify(d.to), d.subject, d.body, nowIso(), meetingId, me).run();
    return { ok: true, draft: d };
  }
  throw new HttpError(400, 'bad_action', 'Pick open, dismiss or draft.');
}
