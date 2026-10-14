// Meeting prep packs. Fifteen minutes before a meeting with partners or staff, one card per attendee: their giving (partners, for
// people with the Work Center), the last contact, open tasks between you, recent emails and chats with them, what they asked you
// for, and the last meeting with them (notes the person may read, with open action items). Shown by the dock and on the meeting's
// prep page. Built when the page asks (every couple of minutes while FavorOS is open), kept ten minutes in hub_prep_packs.
// Skipped: internal repeating meetings unless the person asked for them, meetings with nobody else, more than 25 people,
// all-day and declined calendar events. Each person can turn packs off (hub_meeting_assist_prefs).
// Privacy: every piece is read as the person the pack is for: their own direct messages, their own saved mail, tasks and requests
// between the two of them, meeting notes only where mayReadNotes allows, giving only with the Work Center.
import { HttpError, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { isHiddenAccount, isTester } from '../testuser';
import { emailsOf, getMeeting, ledPeople, mayJoin, mayReadNotes, testMeetingHidden, type Meeting, type MeetEnv } from '../meet';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const FAVOR = /@favorintl\.org$/i;
const ET = 'America/New_York';
const LEAD_MS = 15 * 60000;
const KEEP_MS = 10 * 60000;

export interface Prefs { prep_on: boolean; prep_recurring: boolean; followup_on: boolean; followup_offered_at: string | null; followup_offer_closed: boolean }

export async function prefsFor(env: Env, email: string): Promise<Prefs> {
  const r = await env.DB.prepare('SELECT * FROM hub_meeting_assist_prefs WHERE email = ?').bind(lower(email)).first<{ prep_on: number; prep_recurring: number; followup_on: number; followup_offered_at: string | null; followup_offer_closed: number }>().catch(() => null);
  return { prep_on: r ? !!r.prep_on : true, prep_recurring: !!r?.prep_recurring, followup_on: !!r?.followup_on, followup_offered_at: r?.followup_offered_at || null, followup_offer_closed: !!r?.followup_offer_closed };
}

export async function setPrefs(env: Env, email: string, b: Record<string, unknown>): Promise<Prefs> {
  const cur = await prefsFor(env, email);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const next = {
    prep_on: bool(b.prep_on, cur.prep_on),
    prep_recurring: bool(b.prep_recurring, cur.prep_recurring),
    followup_on: bool(b.followup_on, cur.followup_on),
    followup_offer_closed: bool(b.followup_offer_closed, cur.followup_offer_closed) || bool(b.followup_on, false),
  };
  await env.DB.prepare(
    `INSERT INTO hub_meeting_assist_prefs (email, prep_on, prep_recurring, followup_on, followup_offered_at, followup_offer_closed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET prep_on = excluded.prep_on, prep_recurring = excluded.prep_recurring, followup_on = excluded.followup_on, followup_offer_closed = excluded.followup_offer_closed, updated_at = excluded.updated_at`
  ).bind(lower(email), next.prep_on ? 1 : 0, next.prep_recurring ? 1 : 0, next.followup_on ? 1 : 0, cur.followup_offered_at, next.followup_offer_closed ? 1 : 0, nowIso()).run();
  return prefsFor(env, email);
}

export interface Card {
  email: string;
  name: string;
  kind: 'partner' | 'staff' | 'guest';
  sub: string;
  partnerId: string | null;
  partnerUrl: string | null;
  giving: { lifetime: number; last12: number; last: { amount: number; date: string } | null } | null;
  lastContact: { date: string; what: string } | null;
  open: Array<{ text: string; due: string }>;
  tasks: Array<{ title: string; due: string; mine: boolean; url: string }>;
  asked: Array<{ title: string; url: string; kind: 'request' | 'task' | 'action' }>;
  chats: Array<{ who: string; text: string; at: string; url: string }>;
  emails: Array<{ subject: string; snippet: string; at: string; url: string }>;
  lastMeeting: { title: string; date: string; summary: string; actions: Array<{ text: string; owner: string }>; url: string } | null;
}

export interface Pack {
  key: string;
  meeting: { id: string | null; title: string; start: string; end: string | null; url: string; prepUrl: string | null; source: 'favor' | 'google' };
  cards: Card[];
  builtAt: string;
  seen: boolean;
}

interface Candidate { key: string; id: string | null; title: string; start: string; end: string | null; url: string; others: Array<{ email: string; name: string }>; recurring: boolean; source: 'favor' | 'google' }

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: ET });

/** Is this meeting worth a pack: somebody else, not too many, and not an internal repeating meeting unless asked. */
export function relevant(c: Pick<Candidate, 'others' | 'recurring'>, prefs: Pick<Prefs, 'prep_recurring'>): boolean {
  if (!c.others.length || c.others.length > 25) return false;
  const internal = c.others.every((p) => FAVOR.test(p.email));
  if (internal && c.recurring && !prefs.prep_recurring) return false;
  return true;
}

async function favorCandidates(env: MeetEnv, user: HubUser, from: number, to: number): Promise<Candidate[]> {
  const me = lower(user.email);
  const rows = (await env.DB.prepare(
    `SELECT * FROM hub_meetings WHERE status = 'scheduled' AND starts_at IS NOT NULL AND starts_at >= ?1 AND starts_at <= ?2
       AND (lower(host_email) = ?3 OR lower(cohosts) LIKE ?4 OR lower(invitees) LIKE ?4) LIMIT 20`
  ).bind(new Date(from).toISOString(), new Date(to).toISOString(), me, `%"${me}"%`).all<Meeting>().catch(() => ({ results: [] as Meeting[] }))).results || [];
  const out: Candidate[] = [];
  for (const m of rows) {
    if (!mayJoin(m, user) || testMeetingHidden(m, me)) continue;
    const names = new Map<string, string>();
    try { for (const i of JSON.parse(m.invitees || '[]') as Array<{ email?: string; name?: string }>) if (i && i.email) names.set(lower(i.email), i.name || ''); } catch { /* none */ }
    const all = [lower(m.host_email), ...emailsOf(m.cohosts), ...emailsOf(m.invitees)].filter((e) => e && e !== me && !e.startsWith('guest:'));
    const others = [...new Set(all)].filter((e) => !isHiddenAccount(e) || isHiddenAccount(me)).map((e) => ({ email: e, name: names.get(e) || (e === lower(m.host_email) ? m.host_name : '') || '' }));
    out.push({ key: m.id, id: m.id, title: m.title || 'Meeting', start: m.starts_at as string, end: m.ends_at, url: `/meet/room/?m=${m.id}`, others, recurring: !!m.series_id, source: 'favor' });
  }
  return out;
}

async function googleCandidates(env: MeetEnv, user: HubUser, from: number, to: number, skipRoom: Set<string>): Promise<Candidate[]> {
  if (isTester(user.email)) return [];
  try {
    const { calFetch } = await import('../meetcal');
    const q = `/events?singleEvents=true&orderBy=startTime&maxResults=20&timeMin=${encodeURIComponent(new Date(from).toISOString())}&timeMax=${encodeURIComponent(new Date(to).toISOString())}`;
    const r = await calFetch(env, lower(user.email), q);
    if (!r.ok) return [];
    const j = (await r.json().catch(() => ({}))) as { items?: Array<{ id: string; summary?: string; description?: string; htmlLink?: string; recurringEventId?: string; status?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string }; attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }> }> };
    const me = lower(user.email);
    const out: Candidate[] = [];
    for (const e of j.items || []) {
      if (e.status === 'cancelled' || !e.start?.dateTime) continue; // all-day events have no prep
      const self = (e.attendees || []).find((a) => a.self || lower(a.email) === me);
      if (self && self.responseStatus === 'declined') continue;
      const room = /\/meet\/room\/\?m=([0-9a-f]{24})/.exec(e.description || '');
      if (room && skipRoom.has(room[1])) continue; // already a FavorOS meeting in the list
      const others = (e.attendees || []).filter((a) => a.email && !a.self && !a.resource && lower(a.email) !== me && !/calendar\.google\.com$/i.test(String(a.email))).map((a) => ({ email: lower(a.email), name: a.displayName || '' }));
      out.push({ key: `g:${e.id}`, id: null, title: e.summary || 'Meeting', start: new Date(e.start.dateTime).toISOString(), end: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null, url: e.htmlLink || '', others, recurring: !!e.recurringEventId, source: 'google' });
    }
    return out;
  } catch {
    return []; // no calendar connection: FavorOS meetings only
  }
}

async function workOk(env: Env, user: HubUser): Promise<boolean> {
  try {
    const { workAccessFor } = await import('../work/gate');
    return (await workAccessFor(env, user.email, user.role === 'admin')).ok;
  } catch {
    return false;
  }
}

/** The cards for these people, read as this person. Exported for the tests and the prep page. */
export async function cardsFor(env: MeetEnv, user: HubUser, others: Array<{ email: string; name: string }>, skipMeeting = ''): Promise<Card[]> {
  const me = lower(user.email);
  const emails = others.map((o) => lower(o.email)).slice(0, 25);
  if (!emails.length) return [];
  const marks = emails.map(() => '?').join(',');
  const dir = new Map<string, { name: string; title: string; team: string }>();
  const d = await env.DB.prepare(`SELECT lower(email) AS email, name, title, team FROM meet_directory WHERE active = 1 AND lower(email) IN (${marks})`).bind(...emails).all<{ email: string; name: string; title: string; team: string }>().catch(() => ({ results: [] as Array<{ email: string; name: string; title: string; team: string }> }));
  for (const r of d.results || []) dir.set(r.email, r);
  const { source } = await import('../meetauto');
  const outside = emails.filter((e) => !dir.has(e) && !FAVOR.test(e));
  const pmap: Record<string, { id: string; name: string }> = outside.length ? await source.current.byEmail(env, outside).catch(() => ({})) : {};
  const giving = await workOk(env, user);
  let mailOk = false;
  try { const { mayFeature } = await import('../access'); mailOk = await mayFeature(env, 'mail', { email: me, role: user.role, via: user.via }); } catch { mailOk = false; }
  const led = await ledPeople(env, me).catch(() => new Set<string>());
  const cards: Card[] = [];
  for (const e of emails) {
    const given = others.find((o) => lower(o.email) === e);
    const staff = dir.get(e);
    const partner = pmap[e];
    const card: Card = {
      email: e,
      name: staff?.name || partner?.name || given?.name || e,
      kind: staff || FAVOR.test(e) ? 'staff' : partner ? 'partner' : 'guest',
      sub: staff ? [staff.title, staff.team].filter(Boolean).join(', ') : FAVOR.test(e) ? 'Favor' : partner ? 'Partner' : 'Guest',
      partnerId: partner?.id || null,
      partnerUrl: partner ? `/work/partner/${partner.id}` : null,
      giving: null, lastContact: null, open: [], tasks: [], asked: [], chats: [], emails: [], lastMeeting: null,
    };
    if (partner && giving) {
      const pc = await source.current.card(env, partner.id).catch(() => null);
      if (pc) {
        card.giving = { lifetime: pc.lifetime, last12: pc.last12, last: pc.last ? { amount: pc.last.amount, date: pc.last.date } : null };
        card.lastContact = pc.lastContact ? { date: pc.lastContact.date, what: [pc.lastContact.category, pc.lastContact.summary].filter(Boolean).join(': ') } : null;
        card.open = pc.open.slice(0, 3).map((o) => ({ text: o.what, due: o.due }));
      }
    }
    if (card.kind === 'staff') {
      // Open tasks between the two of you, both ways.
      const t = await env.DB.prepare(
        `SELECT id, title, due_date, lower(owner_email) AS owner, lower(created_by) AS by FROM hub_tasks WHERE status NOT IN ('done', 'dropped')
           AND ((lower(owner_email) = ?1 AND lower(created_by) = ?2) OR (lower(owner_email) = ?2 AND lower(created_by) = ?1)) ORDER BY due_date IS NULL, due_date LIMIT 5`
      ).bind(me, e).all<{ id: string; title: string; due_date: string | null; owner: string; by: string }>().catch(() => ({ results: [] as Array<{ id: string; title: string; due_date: string | null; owner: string; by: string }> }));
      for (const x of t.results || []) {
        // A task they gave you shows once, under Asked of you; the rest are the open tasks between you.
        if (x.owner === me && x.by === e) card.asked.push({ title: x.title, url: `/projects/?t=${encodeURIComponent(x.id)}`, kind: 'task' });
        else card.tasks.push({ title: x.title, due: x.due_date || '', mine: x.owner === me, url: `/projects/?t=${encodeURIComponent(x.id)}` });
      }
      // Requests they made that you own and that are still open.
      const rq = await env.DB.prepare(
        `SELECT q.id, q.title FROM requests q JOIN request_tasks t ON t.request_id = q.id WHERE lower(q.submitter_email) = ? AND lower(t.owner_email) = ? AND q.status NOT IN ('done', 'declined') ORDER BY q.created_at DESC LIMIT 3`
      ).bind(e, me).all<{ id: string; title: string }>().catch(() => ({ results: [] as Array<{ id: string; title: string }> }));
      for (const x of rq.results || []) card.asked.push({ title: x.title, url: `/requests/?r=${encodeURIComponent(x.id)}`, kind: 'request' });
      // Your direct messages with them: the last three.
      const key = [me, e].sort().join(',');
      const ch = await env.DB.prepare(`SELECT id FROM chat_channels WHERE kind = 'dm' AND dm_key = ?`).bind(key).first<{ id: string }>().catch(() => null);
      if (ch) {
        const m = await env.DB.prepare(`SELECT id, email, body, created_at FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND body <> '' AND (visible_to IS NULL OR lower(visible_to) = ?) ORDER BY id DESC LIMIT 3`).bind(ch.id, me).all<{ id: number; email: string; body: string; created_at: string }>().catch(() => ({ results: [] as Array<{ id: number; email: string; body: string; created_at: string }> }));
        card.chats = (m.results || []).map((x) => ({ who: lower(x.email) === me ? 'You' : card.name.split(' ')[0], text: String(x.body).replace(/<@([^>|]+)(\|[^>]*)?>/g, '@$1').replace(/\s+/g, ' ').slice(0, 160), at: x.created_at, url: `/chat/?c=${encodeURIComponent(ch.id)}&m=${x.id}` }));
      }
    }
    // Your saved mail with them (Mail keeps each person's own inbox rows).
    if (mailOk) {
      const r = await env.DB.prepare(`SELECT thread_id, row_json FROM hub_mail_rows WHERE mailbox = ? AND row_json LIKE ? ORDER BY at DESC LIMIT 20`).bind(me, `%${e}%`).all<{ thread_id: string; row_json: string }>().catch(() => ({ results: [] as Array<{ thread_id: string; row_json: string }> }));
      const rows: Card['emails'] = [];
      for (const x of r.results || []) {
        try {
          const row = JSON.parse(x.row_json) as { subject?: string; snippet?: string; date?: string; people?: Array<{ email?: string }>; from?: { email?: string }; bulk?: boolean };
          const has = [...(row.people || []), row.from || {}].some((p) => lower(p.email) === e);
          if (!has || row.bulk) continue;
          rows.push({ subject: String(row.subject || '(no subject)').slice(0, 140), snippet: String(row.snippet || '').slice(0, 160), at: String(row.date || ''), url: `/mail/#/INBOX/${encodeURIComponent(x.thread_id)}` });
        } catch { /* a bad row */ }
      }
      card.emails = rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);
    }
    // The last meeting with them that you may read the notes of, with its open action items.
    const past = (await env.DB.prepare(
      `SELECT * FROM hub_meetings WHERE status = 'ended' AND notes_status = 'ready' AND id <> ?1
         AND (lower(host_email) = ?2 OR lower(invitees) LIKE ?3 OR lower(cohosts) LIKE ?3)
         AND (lower(host_email) = ?4 OR lower(invitees) LIKE ?5 OR lower(cohosts) LIKE ?5)
       ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 5`
    ).bind(skipMeeting, e, `%"${e}"%`, me, `%"${me}"%`).all<Meeting>().catch(() => ({ results: [] as Meeting[] }))).results || [];
    const lm = past.find((m) => mayReadNotes(m, user, led));
    if (lm) {
      const acts = (await env.DB.prepare('SELECT text, owner_name, owner_email FROM hub_meeting_actions WHERE meeting_id = ? AND done = 0 AND (lower(owner_email) IN (?, ?) OR owner_email = \'\') ORDER BY idx LIMIT 4').bind(lm.id, e, me).all<{ text: string; owner_name: string; owner_email: string }>().catch(() => ({ results: [] as Array<{ text: string; owner_name: string; owner_email: string }> }))).results || [];
      card.lastMeeting = { title: lm.title || 'Meeting', date: dayOf(lm.started_at || lm.created_at), summary: String(lm.summary || '').slice(0, 280), actions: acts.map((a) => ({ text: a.text, owner: a.owner_name })), url: `/meet/notes/?m=${lm.id}` };
      for (const a of acts) if (lower(a.owner_email) === me) card.asked.push({ title: a.text, url: `/meet/notes/?m=${lm.id}`, kind: 'action' });
    }
    cards.push(card);
  }
  // Partners first, then staff, then guests.
  const rank = { partner: 0, staff: 1, guest: 2 } as const;
  return cards.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

async function packFor(env: MeetEnv, user: HubUser, c: Candidate): Promise<Pack> {
  const me = lower(user.email);
  const had = await env.DB.prepare('SELECT built_at, pack, seen_at FROM hub_prep_packs WHERE meeting_id = ? AND email = ?').bind(c.key, me).first<{ built_at: string; pack: string; seen_at: string | null }>().catch(() => null);
  const meeting = { id: c.id, title: c.title, start: c.start, end: c.end, url: c.url, prepUrl: c.id ? `/meet/prep/?m=${c.id}` : null, source: c.source };
  if (had && Date.now() - Date.parse(had.built_at) < KEEP_MS) {
    try { return { key: c.key, meeting, cards: JSON.parse(had.pack) as Card[], builtAt: had.built_at, seen: !!had.seen_at }; } catch { /* rebuild */ }
  }
  const cards = await cardsFor(env, user, c.others, c.id || '');
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO hub_prep_packs (meeting_id, email, built_at, pack, seen_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(meeting_id, email) DO UPDATE SET built_at = excluded.built_at, pack = excluded.pack`
  ).bind(c.key, me, at, JSON.stringify(cards)).run().catch(() => undefined);
  return { key: c.key, meeting, cards, builtAt: at, seen: !!had?.seen_at };
}

/** The packs for meetings that start in the next 15 minutes (or started in the last 5), for the dock. */
export async function upcomingPacks(env: MeetEnv, user: HubUser, now = Date.now()): Promise<{ ok: true; on: boolean; packs: Pack[] }> {
  if (user.via === 'agent' || user.role === 'field') return { ok: true, on: false, packs: [] };
  const prefs = await prefsFor(env, user.email);
  if (!prefs.prep_on) return { ok: true, on: false, packs: [] };
  const from = now - 5 * 60000;
  const to = now + LEAD_MS;
  const favor = await favorCandidates(env, user, from, to);
  const google = await googleCandidates(env, user, from, to, new Set(favor.map((f) => f.id as string)));
  const list = [...favor, ...google].filter((c) => relevant(c, prefs)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  const packs: Pack[] = [];
  for (const c of list) packs.push(await packFor(env, user, c));
  return { ok: true, on: true, packs };
}

/** The pack for one FavorOS meeting, for its prep page, any time before it. Same rule as the prep page: the person may join it. */
export async function meetingPack(env: MeetEnv, user: HubUser, id: string): Promise<{ ok: true; pack: Pack }> {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const [c] = await favorCandidates(env, user, 0, Date.parse('2100-01-01'))
    .then((list) => list.filter((x) => x.id === id))
    .catch(() => [] as Candidate[]);
  const me = lower(user.email);
  const cand: Candidate = c || {
    key: m.id, id: m.id, title: m.title || 'Meeting', start: m.starts_at || m.created_at, end: m.ends_at, url: `/meet/room/?m=${m.id}`,
    others: [...new Set([lower(m.host_email), ...emailsOf(m.cohosts), ...emailsOf(m.invitees)])].filter((e) => e && e !== me && !e.startsWith('guest:') && (!isHiddenAccount(e) || isHiddenAccount(me))).map((e) => ({ email: e, name: '' })),
    recurring: !!m.series_id, source: 'favor',
  };
  return { ok: true, pack: await packFor(env, user, cand) };
}

export async function markSeen(env: Env, user: HubUser, key: string): Promise<void> {
  await env.DB.prepare('UPDATE hub_prep_packs SET seen_at = ? WHERE meeting_id = ? AND email = ? AND seen_at IS NULL').bind(nowIso(), String(key).slice(0, 200), lower(user.email)).run();
}
