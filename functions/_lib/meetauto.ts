// Meetings that work before, during and after the call.
//   Before   prepSheet: attendees, the partners among them with their giving, open tasks between you and each person, what is still open
//            from past meetings with them, and the last meeting's decisions.
//   During   extractLive and liveList: decisions and action items caught from the live transcript as they are said.
//   After    afterNotes: partners the meeting may be logged against (proposed only), and the summary posted to the chosen channel.
//            logPartner is the only path to Blackbaud and it needs the host's explicit confirm.
//   Always   askMeetings: one question across every meeting the person may read.
// Partner reads and the Blackbaud write go through `source` and `writer`, which tests replace so nothing real is touched.
import { HttpError, nowIso } from './http';
import { chatJson, plain, stamp, TEXT_MODELS } from './clipai';

// Meetings charge their own budget line and do not take the Clips voice, which describes a screen recording and strips names.
export const MEET_AI = { feature: 'meet-notes', voice: 'You work for Favor International, a Christian nonprofit, and read the transcript of a live staff meeting. Write plainly. Never invent facts, names, dates or numbers. Do not use em dashes. Do not mention artificial intelligence.' };
import { clean, emailsOf, getMeeting, isHost, ledPeople, mayJoin, refuseJoin, mayReadNotes, type Meeting, type MeetEnv } from './meet';
import * as chat from './chat/db';
import { MEETINGS_ID } from './chat/text';
import { hydrateAttachments } from './chat/hydrate';
import { publish, type LiveEnv } from './chat/live';

type User = { email: string; name: string; role: string };

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
function safeJson<T>(s: unknown, d: T): T {
  try {
    const v = JSON.parse(String(s ?? ''));
    return v == null ? d : (v as T);
  } catch {
    return d;
  }
}
const etDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (iso: string): string => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : '');
const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------- pure helpers

const STOP = new Set('a an the and or of to in on at for with about what who when where why how did do does we our us you your i me my is are was were be been it its that this these those from by as not any all have has had will would could should can said say tell told meeting meetings last past ever discuss discussed decide decided decision decisions talk talked agree agreed'.split(' '));

/** The words of a question worth searching for: no filler, three letters or more, at most eight, order kept. */
export function keywords(q: string): string[] {
  const out: string[] = [];
  for (const w of lower(q).replace(/[^a-z0-9$\s'-]/g, ' ').split(/\s+/)) {
    const t = w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '');
    if (t.length < 3 || STOP.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

const tokens = (s: string): Set<string> => new Set(lower(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
/** How much two sentences overlap, 0 to 1. Used to tell a repeated item from a new one. */
export function overlap(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}
const SAME = 0.7;

export interface Person { name: string; email: string }

/** The person a spoken name means: a full name, else a first name that only one person in the room carries. Empty when unsure. */
export function pickPerson(list: Person[], who: string, strict = false): Person | null {
  const w = lower(who);
  if (!w) return null;
  const full = list.filter((p) => lower(p.name) === w);
  if (full.length === 1) return full[0];
  if (strict) return null;
  const first = list.filter((p) => lower(p.name).split(/\s+/)[0] === w.split(/\s+/)[0]);
  return first.length === 1 ? first[0] : null;
}

export interface NotesLike { decisions: Array<{ t: number; text: string }>; actions: Array<{ text: string; owner: string; due: string; t: number }> }
export interface LiveRow { kind: string; text: string; owner_name: string; owner_email: string; due: string; t: number; dismissed: number }

/**
 * The final notes with what the call already caught: an item the people kept stays when the final reading missed it, an item they
 * dismissed does not come back, and the owner a person set by hand wins.
 */
export function mergeLive<T extends NotesLike>(notes: T, live: LiveRow[]): T {
  const out = { ...notes, decisions: [...notes.decisions], actions: [...notes.actions] };
  for (const l of live) {
    const list = l.kind === 'decision' ? out.decisions : out.actions;
    const hit = list.findIndex((x) => overlap(x.text, l.text) >= SAME);
    if (l.dismissed) {
      if (hit >= 0) list.splice(hit, 1);
      continue;
    }
    if (hit >= 0) {
      if (l.kind !== 'decision' && l.owner_name) (list[hit] as { owner: string }).owner = l.owner_name;
      continue;
    }
    if (l.kind === 'decision') out.decisions.push({ t: l.t, text: l.text });
    else out.actions.push({ text: l.text, owner: l.owner_name, due: l.due, t: l.t });
  }
  out.decisions.sort((a, b) => a.t - b.t);
  out.actions.sort((a, b) => a.t - b.t);
  out.decisions = out.decisions.slice(0, 12);
  out.actions = out.actions.slice(0, 20);
  return out;
}

// ---------------------------------------------------------------- partners: where they come from and where a log goes

export interface PartnerCard {
  id: string;
  name: string;
  place: string;
  lifetime: number;
  last12: number;
  count: number;
  last: { amount: number; date: string; fund: string } | null;
  largest: { amount: number; date: string } | null;
  lastContact: { date: string; category: string; summary: string } | null;
  open: Array<{ what: string; due: string }>;
  holders: string[];
}
export interface PartnerSource {
  /** Which of these addresses belong to a partner. */
  byEmail(env: MeetEnv, emails: string[]): Promise<Record<string, { id: string; name: string }>>;
  card(env: MeetEnv, id: string): Promise<PartnerCard | null>;
  /** The partners a Favor fundraiser holds now and what those partners gave in the last 12 months. */
  portfolio(env: MeetEnv, fid: string): Promise<{ count: number; last12: number } | null>;
  search(env: MeetEnv, text: string): Promise<Array<{ id: string; name: string; place: string }>>;
}
export interface PartnerWrite { summary: string; description: string; date: string }
export interface Writer {
  /** One completed Meeting action on the partner's record. Called only after the host's confirm. */
  log(env: MeetEnv, user: User, meetingId: string, cid: string, f: PartnerWrite): Promise<{ batchId: string; state: 'logged' | 'queued'; detail: string }>;
}

const defaultSource: PartnerSource = {
  async byEmail(env, emails) {
    const { partnerMap } = await import('./mail/partners');
    return partnerMap(env, emails);
  },
  async card(env, id) {
    const [{ loadPartner, mirrorQ }] = await Promise.all([import('./work/partner')]);
    const q = mirrorQ(env);
    const p = await loadPartner(q, id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      place: p.place,
      lifetime: p.giving.total,
      last12: p.giving.last12,
      count: p.giving.count,
      last: p.giving.last ? { amount: p.giving.last.amount, date: p.giving.last.date, fund: p.giving.last.fund } : null,
      largest: p.giving.largest ? { amount: p.giving.largest.amount, date: p.giving.largest.date } : null,
      lastContact: p.lastContact ? { date: p.lastContact.date, category: p.lastContact.category, summary: p.lastContact.summary } : null,
      open: (p.actions.open || []).slice(0, 3).map((a) => ({ what: a.summary || a.type, due: a.due })),
      holders: (p.assignments || []).filter((a) => a.current).map((a) => a.name),
    };
  },
  async portfolio(env, fid) {
    const { mirror } = await import('./foundations/blackbaud');
    const { readOnly } = await import('./work/repo');
    const { GIVEN } = await import('./work/gifts');
    const held = await mirror<{ n: number }>(
      env,
      readOnly(`SELECT COUNT(DISTINCT constituent_record_id) AS n FROM assignments WHERE assignment_fundraiser_id = ?1 AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now'))`),
      [fid]
    );
    const gave = await mirror<{ s: number }>(
      env,
      readOnly(`SELECT COALESCE(SUM(g.gift_amount), 0) AS s FROM gifts g WHERE g.gift_amount > 0 AND g.gift_type IN ${GIVEN} AND substr(g.gift_date, 1, 10) >= date('now', '-365 day')
        AND g.constituent_record_id IN (SELECT constituent_record_id FROM assignments WHERE assignment_fundraiser_id = ?1 AND (assignment_to_date IS NULL OR substr(assignment_to_date, 1, 10) >= date('now')))`),
      [fid]
    );
    return { count: Number(held[0]?.n) || 0, last12: Number(gave[0]?.s) || 0 };
  },
  async search(env, text) {
    const { blackbaudRepo } = await import('./work/repo');
    const { searchPartners, mirrorQ } = await import('./work/partner');
    const repo = blackbaudRepo(env);
    const hits = await searchPartners(repo, mirrorQ(env), text, undefined, 8);
    return hits.map((h: any) => ({ id: String(h.id), name: String(h.name || ''), place: String(h.place || h.loc || '') }));
  },
};

const defaultWriter: Writer = {
  async log(env, user, meetingId, cid, f) {
    const [{ workAccessFor }, { scopeFor }, { blackbaudRepo }, edit, svc] = await Promise.all([import('./work/gate'), import('./work/role'), import('./work/repo'), import('./work/edit'), import('./work/service')]);
    const admin = user.role === 'admin';
    const access = await workAccessFor(env, user.email, admin);
    if (!access.ok) throw new HttpError(403, 'no_work_center', 'Logging on a partner record needs the Work Center. Ask Partner Care or the Support Team to log this meeting.');
    const scope = (await scopeFor(env, user.email, admin)) || undefined;
    const ctx = { env, repo: blackbaudRepo(env), actor: user.name || user.email, email: user.email, scope } as import('./work/service').Ctx;
    const me = await edit.meFor(env, user.email);
    const types = await edit.typesByFundraiser(env);
    let fid = me.fid;
    if (!fid) fid = (await edit.partnerContext(ctx, cid).catch(() => ({ holders: [] as Array<{ fid: string }> }))).holders[0]?.fid || null;
    const set = { category: 'Meeting', type: (fid && types[fid]) || me.type || 'RDD Action', date: f.date, summary: f.summary, description: f.description, fundraisers: fid ? [fid] : [], completed: true, status: 'Completed' };
    const made = (await svc.createBatch(ctx, { op: 'new', cids: [cid], set, req: `meet-${meetingId}-${cid}` } as never)) as { batch?: { id: string }; ok?: boolean; message?: string };
    if (!made.batch) throw new HttpError(409, 'not_logged', String(made.message || 'Blackbaud did not take it. Nothing was logged.'));
    let left = 1;
    for (let i = 0; i < 3 && left > 0; i++) {
      const r = await svc.runBatch(ctx, made.batch.id);
      left = r.left;
      const failed = r.items.find((x) => x.state === 'failed');
      if (failed) throw new HttpError(502, 'bb_refused', failed.error ? `Blackbaud said: ${failed.error}` : 'Blackbaud turned it down. Nothing was logged.');
      if (r.held) break;
    }
    return { batchId: made.batch.id, state: left ? 'queued' : 'logged', detail: left ? 'Saved. The Work Center sends it to Blackbaud within minutes.' : 'Logged on the record.' };
  },
};

/** Tests swap these. The live site always uses the defaults. */
export const source: { current: PartnerSource } = { current: defaultSource };
export const writer: { current: Writer } = { current: defaultWriter };

// ---------------------------------------------------------------- before: the prep sheet

interface Invitee { email?: string; name?: string; team?: string; guest?: boolean }
interface DirRow { email: string; name: string; title: string; team: string }

const FAVOR = /@favorintl\.org$/i;

export interface PrepSheet {
  ok: true;
  meeting: { id: string; title: string; agenda: string; startsAt: string | null; endsAt: string | null; hostName: string; hostEmail: string; status: string; durationMin: number; roomUrl: string };
  attendees: Array<{
    email: string; name: string; team: string; title: string; role: 'host' | 'invited'; staff: boolean; you: boolean;
    between: Array<{ id: string; title: string; due: string; mine: boolean; url: string }>;
    held: { count: number; last12: number } | null;
    partnerId: string | null;
  }>;
  partners: Array<PartnerCard & { email: string; url: string; detail: boolean }>;
  openItems: Array<{ meetingId: string; title: string; date: string; text: string; owner: string; due: string }>;
  last: { id: string; title: string; date: string; summary: string; decisions: string[]; open: Array<{ text: string; owner: string; due: string }> } | null;
  line: string;
  hasAgenda: boolean;
}

async function workOk(env: MeetEnv, user: User): Promise<boolean> {
  try {
    const { workAccessFor } = await import('./work/gate');
    return (await workAccessFor(env, user.email, user.role === 'admin')).ok;
  } catch {
    return false;
  }
}

export async function prepSheet(env: MeetEnv, user: User, id: string, origin = ''): Promise<PrepSheet> {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never)) throw refuseJoin(m);
  const me = lower(user.email);
  const invitees = safeJson<Invitee[]>(m.invitees, []);
  const roster = new Map<string, { email: string; name: string; role: 'host' | 'invited'; guest: boolean }>();
  roster.set(lower(m.host_email), { email: lower(m.host_email), name: m.host_name || m.host_email, role: 'host', guest: false });
  for (const e of emailsOf(m.cohosts)) if (!roster.has(e)) roster.set(e, { email: e, name: '', role: 'host', guest: false });
  for (const i of invitees) if (i.email && !roster.has(lower(i.email))) roster.set(lower(i.email), { email: lower(i.email), name: i.name || '', role: 'invited', guest: !!i.guest });
  const emails = [...roster.keys()];
  const dir = new Map<string, DirRow>();
  try {
    const rows = (await env.DB.prepare(`SELECT lower(email) AS email, name, title, team FROM meet_directory WHERE active = 1 AND lower(email) IN (${emails.map(() => '?').join(',')})`).bind(...emails).all<DirRow>()).results || [];
    for (const r of rows) dir.set(r.email, r);
  } catch { /* the directory is a convenience */ }
  const staffOf = (e: string) => dir.has(e) || FAVOR.test(e);

  // Partners among the attendees: an address outside Favor that belongs to a partner record.
  const outside = emails.filter((e) => !staffOf(e));
  let pmap: Record<string, { id: string; name: string }> = {};
  if (outside.length) pmap = await source.current.byEmail(env, outside).catch(() => ({}));
  const detail = await workOk(env, user);
  const partners: PrepSheet['partners'] = [];
  for (const e of outside) {
    const hit = pmap[e];
    if (!hit) continue;
    const card = detail ? await source.current.card(env, hit.id).catch(() => null) : null;
    partners.push({ ...(card || { id: hit.id, name: hit.name, place: '', lifetime: 0, last12: 0, count: 0, last: null, largest: null, lastContact: null, open: [], holders: [] }), email: e, url: `/work/partner/${hit.id}`, detail: !!card });
  }

  // Fundraiser ids of the staff attending, for the size of the portfolio each holds.
  const fids = new Map<string, string>();
  try {
    const staffEmails = emails.filter(staffOf);
    if (staffEmails.length) {
      const rows = (await env.DB.prepare(`SELECT lower(email) AS email, bb_fundraiser_id AS fid FROM act_staff WHERE active = 1 AND bb_fundraiser_id IS NOT NULL AND lower(email) IN (${staffEmails.map(() => '?').join(',')})`).bind(...staffEmails).all<{ email: string; fid: string }>()).results || [];
      for (const r of rows) fids.set(r.email, String(r.fid));
    }
  } catch { /* no staff list here */ }
  const held = new Map<string, { count: number; last12: number } | null>();
  if (detail) {
    await Promise.all([...fids].map(async ([e, fid]) => {
      held.set(e, await source.current.portfolio(env, fid).catch(() => null));
    }));
  }

  // Open tasks between the viewer and each other attendee, in both directions.
  const between = new Map<string, PrepSheet['attendees'][number]['between']>();
  try {
    for (const e of emails) {
      if (e === me || !staffOf(e)) continue;
      const rows = (await env.DB.prepare(
        `SELECT id, title, due_date, lower(owner_email) AS owner FROM hub_tasks
          WHERE status NOT IN ('done', 'dropped') AND ((lower(owner_email) = ?1 AND lower(created_by) = ?2) OR (lower(owner_email) = ?2 AND lower(created_by) = ?1))
          ORDER BY due_date IS NULL, due_date LIMIT 4`
      ).bind(me, e).all<{ id: string; title: string; due_date: string | null; owner: string }>()).results || [];
      between.set(e, rows.map((r) => ({ id: r.id, title: r.title, due: r.due_date || '', mine: r.owner === me, url: `/projects/?t=${r.id}` })));
    }
  } catch { /* projects not set up here */ }

  const attendees: PrepSheet['attendees'] = emails.map((e) => {
    const r = roster.get(e)!;
    const d = dir.get(e);
    return {
      email: e, name: d?.name || r.name || e, team: d?.team || '', title: d?.title || '', role: r.role, staff: staffOf(e), you: e === me,
      between: between.get(e) || [], held: held.get(e) || null, partnerId: pmap[e]?.id || null,
    };
  });

  // What is still open from earlier meetings with these people, and the last meeting like this one.
  const led = await ledPeople(env, user.email);
  const readable = (r: Meeting) => mayReadNotes(r, user as never, led);
  const openItems: PrepSheet['openItems'] = [];
  try {
    const staffEmails = emails.filter((e) => staffOf(e) && e !== me);
    if (staffEmails.length) {
      const rows = (await env.DB.prepare(
        `SELECT a.meeting_id, a.text, a.owner_name, a.due, m.title, m.started_at, m.created_at, m.status, m.host_email, m.cohosts, m.invitees, m.access
           FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id
          WHERE a.done = 0 AND m.id != ? AND lower(a.owner_email) IN (${staffEmails.map(() => '?').join(',')})
            AND NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.meeting_id = a.meeting_id AND t.meeting_action_idx = a.idx AND t.status IN ('done', 'dropped'))
          ORDER BY m.started_at DESC LIMIT 30`
      ).bind(id, ...staffEmails).all<Meeting & { meeting_id: string; text: string; owner_name: string; due: string }>()).results || [];
      for (const r of rows) {
        if (!readable(r as Meeting)) continue;
        openItems.push({ meetingId: r.meeting_id, title: r.title, date: etDay(r.started_at || r.created_at), text: r.text, owner: r.owner_name, due: r.due });
        if (openItems.length >= 8) break;
      }
    }
  } catch { /* none */ }

  let last: PrepSheet['last'] = null;
  try {
    const set = new Set(emails);
    const cand = (await env.DB.prepare(
      `SELECT id, title, summary, notes_json, series_id, started_at, created_at, ended_at, status, host_email, cohosts, invitees, access FROM hub_meetings
        WHERE status = 'ended' AND id != ? AND notes_status = 'ready' ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 250`
    ).bind(id).all<Meeting & { series_id: string }>()).results || [];
    let best: (Meeting & { series_id: string }) | null = null;
    for (const c of cand) {
      if (!readable(c)) continue;
      if (m.series_id && c.series_id === m.series_id) { best = c; break; }
      const theirs = new Set([lower(c.host_email), ...emailsOf(c.cohosts), ...emailsOf(c.invitees)]);
      let both = 0;
      for (const e of set) if (theirs.has(e)) both++;
      const union = set.size + theirs.size - both;
      if (set.size > 1 && both >= 2 && both / union >= 0.6) { best = c; break; }
    }
    if (best) {
      const n = safeJson<{ decisions?: Array<{ text: string }> }>(best.notes_json, {});
      const open = (await env.DB.prepare('SELECT text, owner_name, due FROM hub_meeting_actions WHERE meeting_id = ? AND done = 0 ORDER BY idx LIMIT 6').bind(best.id).all<{ text: string; owner_name: string; due: string }>()).results || [];
      last = { id: best.id, title: best.title, date: etDay(best.started_at || best.created_at), summary: best.summary || '', decisions: (n.decisions || []).map((d) => d.text).slice(0, 6), open: open.map((o) => ({ text: o.text, owner: o.owner_name, due: o.due })) };
    }
  } catch { /* none */ }

  const others = attendees.filter((a) => !a.you);
  const bits: string[] = [];
  if (partners.length) bits.push(partners.length === 1 ? `${partners[0].name} is a partner` : `${partners.length} partners attending`);
  const open = others.reduce((n, a) => n + a.between.length, 0);
  if (open) bits.push(`${open} open ${open === 1 ? 'task' : 'tasks'} between you`);
  if (last) bits.push(`last time ${shortDay(last.date)}${last.decisions.length ? `: ${last.decisions[0].replace(/[.\s]+$/, '')}` : ''}`);
  else if (openItems.length) bits.push(`${openItems.length} open ${openItems.length === 1 ? 'item' : 'items'} from past meetings`);
  const line = bits.length ? bits.join('. ') + '.' : m.agenda ? clean(m.agenda, 120) : `${others.length || 'No'} ${others.length === 1 ? 'other person' : 'other people'} invited.`;
  return {
    ok: true,
    meeting: { id: m.id, title: m.title, agenda: m.agenda, startsAt: m.starts_at, endsAt: m.ends_at, hostName: m.host_name, hostEmail: m.host_email, status: m.status, durationMin: m.duration_min, roomUrl: `${origin}/meet/room/?m=${m.id}` },
    attendees, partners, openItems, last, line, hasAgenda: !!m.agenda.trim(),
  };
}

// ---------------------------------------------------------------- during: live notes

interface LineRow { n: number; t: number; who: string; text: string }
export interface LiveItem { idx: number; kind: 'action' | 'decision'; text: string; owner: string; ownerEmail: string; due: string; t: number; dismissed: boolean; byHand: boolean }
const LIVE_EVERY_MS = 40_000;

/** Everyone who is in or invited to a meeting, for matching a spoken name. */
export async function rosterOf(env: MeetEnv, m: Meeting): Promise<Person[]> {
  const seen = new Map<string, Person>();
  const add = (email: string, name: string) => {
    const e = lower(email);
    if (!e || e.startsWith('guest:')) return;
    const cur = seen.get(e);
    if (!cur || (!cur.name && name)) seen.set(e, { email: e, name: name || cur?.name || '' });
  };
  const here = (await env.DB.prepare('SELECT DISTINCT name, email FROM hub_meeting_presence WHERE meeting_id = ?').bind(m.id).all<{ name: string; email: string }>().catch(() => ({ results: [] as Array<{ name: string; email: string }> }))).results || [];
  for (const p of here) add(p.email, p.name);
  for (const i of safeJson<Invitee[]>(m.invitees, [])) if (i.email) add(i.email, i.name || '');
  add(m.host_email, m.host_name);
  // The staff directory names a person better than a booking's own text does.
  const all = [...seen.keys()];
  if (all.length) {
    const rows = (await env.DB.prepare(`SELECT lower(email) AS email, name FROM meet_directory WHERE lower(email) IN (${all.map(() => '?').join(',')})`).bind(...all).all<{ email: string; name: string }>().catch(() => ({ results: [] as Array<{ email: string; name: string }> }))).results || [];
    for (const r of rows) if (r.name) seen.set(r.email, { email: r.email, name: r.name });
  }
  return [...seen.values()].filter((p) => p.name);
}

const LIVE_PROMPT =
  'You listen to a staff meeting at a nonprofit as it happens and note decisions and action items. You get the people in the meeting, what is already noted, and the newest transcript lines (each with a time and, when the system could tell, the speaker). ' +
  'Return key items: an array of at most 6 objects {kind, text, owner, due, t}. kind is "action" for something a person commits to do or is asked to do, or "decision" for something the group agreed. text is one plain sentence of at most 25 words. ' +
  'owner is a person from the list who was named or who said "I will", else empty. due is a date or phrase said aloud, else empty. t is the seconds from the line. ' +
  'Skip anything already noted, questions, and small talk. Use only what the lines say. Do not invent names, dates, numbers or dollar amounts. No em dashes. Return an empty array when nothing new was said.';

/** Reads the lines said since the last pass and adds what they hold. Safe to call often: it runs at most every 40 seconds per meeting. */
export async function extractLive(env: MeetEnv, mt: Meeting, opts: { force?: boolean } = {}): Promise<number> {
  const id = mt.id;
  await env.DB.prepare('INSERT OR IGNORE INTO hub_meeting_live_state (meeting_id, upto_n, at_ms) VALUES (?, -1, 0)').bind(id).run();
  const st = await env.DB.prepare('SELECT upto_n, at_ms FROM hub_meeting_live_state WHERE meeting_id = ?').bind(id).first<{ upto_n: number; at_ms: number }>();
  if (!st) return 0;
  const now = Date.now();
  if (!opts.force && now - st.at_ms < LIVE_EVERY_MS) return 0;
  const lines = (await env.DB.prepare('SELECT n, t, who, text FROM hub_meeting_lines WHERE meeting_id = ? AND n > ? ORDER BY n LIMIT 120').bind(id, st.upto_n).all<LineRow>()).results || [];
  if (lines.length < (opts.force ? 1 : 3)) return 0;
  const upto = lines[lines.length - 1].n;
  // The lock: only the pass that moves at_ms from the value it read goes on.
  const lock = await env.DB.prepare('UPDATE hub_meeting_live_state SET at_ms = ?, upto_n = ? WHERE meeting_id = ? AND at_ms = ?').bind(now, upto, id, st.at_ms).run();
  if (lock.meta.changes !== 1) return 0;
  const people = await rosterOf(env, mt);
  const have = (await env.DB.prepare('SELECT idx, kind, text FROM hub_meeting_live WHERE meeting_id = ? ORDER BY idx').bind(id).all<{ idx: number; kind: string; text: string }>()).results || [];
  let out: { items?: unknown };
  try {
    out = await chatJson<{ items?: unknown }>(
      env as never,
      LIVE_PROMPT,
      `Meeting: ${mt.title}\nPeople: ${people.map((p) => p.name).join(', ') || 'unknown'}\nAlready noted:\n${have.slice(-25).map((h) => `- (${h.kind}) ${h.text}`).join('\n') || '- nothing yet'}\n\nNewest lines:\n${lines.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n').slice(-9000)}`,
      700,
      TEXT_MODELS,
      MEET_AI
    );
  } catch (err) {
    // The lines go back to be read on the next pass.
    await env.DB.prepare('UPDATE hub_meeting_live_state SET upto_n = ? WHERE meeting_id = ?').bind(st.upto_n, id).run();
    console.warn('[meet] live read', id, err);
    return 0;
  }
  const raw = (Array.isArray(out.items) ? (out.items as Array<Record<string, unknown>>) : []).slice(0, 6);
  let next = (have.length ? have[have.length - 1].idx : -1) + 1;
  let added = 0;
  const stmts = [];
  const known = have.map((h) => h.text);
  for (const it of raw) {
    const text = plain(it.text, 300);
    const kind = it.kind === 'decision' ? 'decision' : 'action';
    if (!text || known.some((k) => overlap(k, text) >= SAME)) continue;
    const who = plain(it.owner, 80);
    const person = kind === 'action' ? pickPerson(people, who) : null;
    known.push(text);
    stmts.push(env.DB.prepare('INSERT INTO hub_meeting_live (meeting_id, idx, kind, text, owner_name, owner_email, due, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, next++, kind, text, person ? person.name : who, person ? person.email : '', plain(it.due, 60), Math.max(0, Math.round(Number(it.t) || lines[0].t))));
    added++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return added;
}

const liveItem = (r: { idx: number; kind: string; text: string; owner_name: string; owner_email: string; due: string; t: number; dismissed: number; by_hand: number }): LiveItem => ({
  idx: r.idx, kind: r.kind === 'decision' ? 'decision' : 'action', text: r.text, owner: r.owner_name, ownerEmail: r.owner_email, due: r.due, t: r.t, dismissed: !!r.dismissed, byHand: !!r.by_hand,
});

export async function liveList(env: MeetEnv, user: User, id: string): Promise<{ ok: true; items: LiveItem[]; status: string }> {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never)) throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const rows = (await env.DB.prepare('SELECT idx, kind, text, owner_name, owner_email, due, t, dismissed, by_hand FROM hub_meeting_live WHERE meeting_id = ? ORDER BY t, idx').bind(id).all<Parameters<typeof liveItem>[0]>()).results || [];
  return { ok: true, items: rows.map(liveItem), status: m.status };
}

/** Anyone in the room adds an item by hand. A host dismisses, restores or gives an item an owner. */
export async function livePost(env: MeetEnv, user: User, id: string, b: Record<string, unknown>): Promise<{ ok: true; items: LiveItem[] }> {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user as never) || m.status === 'cancelled') throw new HttpError(404, 'not_found', 'That meeting does not exist.');
  const people = await rosterOf(env, m);
  if (b.add && typeof b.add === 'object') {
    const a = b.add as Record<string, unknown>;
    const text = plain(a.text, 300);
    if (!text) throw new HttpError(400, 'empty', 'Write the item first.');
    const kind = a.kind === 'decision' ? 'decision' : 'action';
    const owner = lower(a.owner);
    const person = owner ? people.find((p) => p.email === owner) || pickPerson(people, owner) : null;
    const next = ((await env.DB.prepare('SELECT COALESCE(MAX(idx), -1) AS n FROM hub_meeting_live WHERE meeting_id = ?').bind(id).first<{ n: number }>())?.n ?? -1) + 1;
    const started = Date.parse(m.started_at || m.created_at) || Date.now();
    await env.DB.prepare('INSERT INTO hub_meeting_live (meeting_id, idx, kind, text, owner_name, owner_email, due, t, by_hand) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)')
      .bind(id, next, kind, text, person ? person.name : '', person ? person.email : '', plain(a.due, 60), Math.max(0, Math.round((Date.now() - started) / 1000))).run();
  } else {
    if (!isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only a host can change what the meeting caught.');
    const idx = Number(b.idx);
    const row = await env.DB.prepare('SELECT idx FROM hub_meeting_live WHERE meeting_id = ? AND idx = ?').bind(id, idx).first();
    if (!row) throw new HttpError(404, 'not_found', 'That item is not there.');
    if (typeof b.dismissed === 'boolean') await env.DB.prepare('UPDATE hub_meeting_live SET dismissed = ? WHERE meeting_id = ? AND idx = ?').bind(b.dismissed ? 1 : 0, id, idx).run();
    if (typeof b.owner === 'string') {
      const want = lower(b.owner);
      const person = want ? people.find((p) => p.email === want) || pickPerson(people, want) : null;
      if (want && !person) throw new HttpError(400, 'owner', 'Pick someone who is in or invited to this meeting.');
      await env.DB.prepare('UPDATE hub_meeting_live SET owner_name = ?, owner_email = ? WHERE meeting_id = ? AND idx = ?').bind(person ? person.name : '', person ? person.email : '', id, idx).run();
    }
    if (typeof b.text === 'string' && plain(b.text, 300)) await env.DB.prepare('UPDATE hub_meeting_live SET text = ? WHERE meeting_id = ? AND idx = ?').bind(plain(b.text, 300), id, idx).run();
  }
  return { ok: true, items: (await liveList(env, user, id)).items };
}

/** The notes pass calls this: the final lists with what the call caught folded in. */
export async function foldLive<T extends NotesLike>(env: MeetEnv, id: string, notes: T): Promise<T> {
  try {
    const rows = (await env.DB.prepare('SELECT kind, text, owner_name, owner_email, due, t, dismissed FROM hub_meeting_live WHERE meeting_id = ? ORDER BY idx').bind(id).all<LiveRow>()).results || [];
    return rows.length ? mergeLive(notes, rows) : notes;
  } catch {
    return notes;
  }
}

// ---------------------------------------------------------------- after: partners to log, summary to the channel

export interface PartnerRow { cid: string; name: string; source: string; state: string; summary: string; detail: string; confirmedBy: string; confirmedAt: string | null; url: string }
const partnerRow = (r: { cid: string; name: string; source: string; state: string; summary: string; detail: string; confirmed_by: string; confirmed_at: string | null }): PartnerRow => ({
  cid: r.cid, name: r.name, source: r.source, state: r.state, summary: r.summary, detail: r.detail, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, url: `/work/partner/${r.cid}`,
});

/** An invitee whose address matches a partner makes a proposal. Nothing is written to Blackbaud here. */
export async function proposePartners(env: MeetEnv, id: string): Promise<number> {
  const m = await getMeeting(env, id);
  const outside = [...new Set(safeJson<Invitee[]>(m.invitees, []).map((i) => lower(i.email)).filter((e) => e && !FAVOR.test(e)))];
  if (!outside.length) return 0;
  const hits = await source.current.byEmail(env, outside).catch(() => ({}) as Record<string, { id: string; name: string }>);
  let n = 0;
  for (const h of Object.values(hits)) {
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO hub_meeting_partner (meeting_id, cid, name, source, state, summary) VALUES (?, ?, ?, 'email', 'proposed', ?)`).bind(id, h.id, h.name, clean(m.title, 200)).run();
    n += r.meta.changes;
  }
  return n;
}

export async function partnersOf(env: MeetEnv, user: User, id: string): Promise<PartnerRow[]> {
  const m = await getMeeting(env, id);
  if (!isHost(m, user.email) && user.role !== 'admin') return [];
  const rows = (await env.DB.prepare(`SELECT cid, name, source, state, summary, detail, confirmed_by, confirmed_at FROM hub_meeting_partner WHERE meeting_id = ? AND state != 'dismissed' ORDER BY rowid`).bind(id)
    .all<Parameters<typeof partnerRow>[0]>().catch(() => ({ results: [] as Array<Parameters<typeof partnerRow>[0]> }))).results || [];
  return rows.map(partnerRow);
}

/** Partners waiting for a host's yes, across meetings, for the Meetings home. */
export async function pendingPartners(env: MeetEnv, user: User): Promise<Array<{ meetingId: string; title: string; date: string; cid: string; name: string }>> {
  const me = lower(user.email);
  const rows = (await env.DB.prepare(
    `SELECT p.meeting_id, p.cid, p.name, m.title, m.started_at, m.created_at FROM hub_meeting_partner p JOIN hub_meetings m ON m.id = p.meeting_id
      WHERE p.state IN ('proposed', 'failed') AND m.status = 'ended' AND m.notes_status = 'ready' AND (lower(m.host_email) = ?1 OR instr(lower(m.cohosts), '"' || ?1 || '"') > 0) ORDER BY m.ended_at DESC LIMIT 20`
  ).bind(me).all<{ meeting_id: string; cid: string; name: string; title: string; started_at: string | null; created_at: string }>().catch(() => ({ results: [] }))).results || [];
  return rows.map((r) => ({ meetingId: r.meeting_id, title: r.title, date: etDay(r.started_at || r.created_at), cid: r.cid, name: r.name }));
}

export async function partnerSearch(env: MeetEnv, user: User, id: string, text: string) {
  const m = await getMeeting(env, id);
  if (!isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only the host can pick the partner.');
  if (!(await workOk(env, user))) throw new HttpError(403, 'no_work_center', 'Finding a partner needs the Work Center. Ask Partner Care or the Support Team.');
  const t = clean(text, 80);
  if (t.length < 2) return { ok: true, hits: [] };
  return { ok: true, hits: (await source.current.search(env, t).catch(() => [])).slice(0, 8) };
}

/** The host's choices on a partner: add one by hand, dismiss one, or log the meeting. Only `log` with confirm: true reaches Blackbaud. */
export async function partnerAct(env: MeetEnv, user: User, id: string, b: Record<string, unknown>) {
  const m = await getMeeting(env, id);
  if (!isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only the host can log this meeting on a partner.');
  if (m.status !== 'ended') throw new HttpError(400, 'not_over', 'Log the meeting after it ends.');
  const cid = clean(b.cid, 12);
  if (!/^\d{1,12}$/.test(cid)) throw new HttpError(400, 'no_partner', 'Pick the partner first.');
  const act = String(b.action || '');
  if (act === 'add') {
    const name = clean(b.name, 120);
    await env.DB.prepare(`INSERT INTO hub_meeting_partner (meeting_id, cid, name, source, state, summary) VALUES (?, ?, ?, 'host', 'proposed', ?)
      ON CONFLICT(meeting_id, cid) DO UPDATE SET state = CASE WHEN state = 'dismissed' THEN 'proposed' ELSE state END`).bind(id, cid, name, clean(m.title, 200)).run();
    return { ok: true, partners: await partnersOf(env, user, id) };
  }
  const row = await env.DB.prepare('SELECT cid, name, state, summary FROM hub_meeting_partner WHERE meeting_id = ? AND cid = ?').bind(id, cid).first<{ cid: string; name: string; state: string; summary: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'That partner is not on this meeting.');
  if (act === 'dismiss') {
    if (row.state === 'logged' || row.state === 'sending') throw new HttpError(409, 'logged', 'This meeting is already logged on that partner.');
    await env.DB.prepare(`UPDATE hub_meeting_partner SET state = 'dismissed' WHERE meeting_id = ? AND cid = ?`).bind(id, cid).run();
    return { ok: true, partners: await partnersOf(env, user, id) };
  }
  if (act !== 'log') throw new HttpError(400, 'bad_action', 'Unknown choice.');
  if (b.confirm !== true) throw new HttpError(400, 'confirm', 'Press Log in Blackbaud to confirm. Nothing was written.');
  if (row.state === 'logged' || row.state === 'sending') throw new HttpError(409, 'logged', 'This meeting is already logged on that partner.');
  const claim = await env.DB.prepare(`UPDATE hub_meeting_partner SET state = 'sending', confirmed_by = ?, confirmed_at = ? WHERE meeting_id = ? AND cid = ? AND state IN ('proposed', 'failed')`).bind(lower(user.email), nowIso(), id, cid).run();
  if (claim.meta.changes !== 1) throw new HttpError(409, 'busy', 'That partner is being logged. Reload the page.');
  const summary = clean(b.summary, 255) || row.summary || clean(m.title, 200);
  try {
    const description = clean(b.note, 4000) || (await describeMeeting(env, m));
    const res = await writer.current.log(env, user, id, cid, { summary, description, date: etDay(m.started_at || m.created_at) });
    await env.DB.prepare(`UPDATE hub_meeting_partner SET state = 'logged', summary = ?, batch_id = ?, detail = ? WHERE meeting_id = ? AND cid = ?`).bind(summary, res.batchId, res.detail, id, cid).run();
  } catch (err) {
    const why = err instanceof Error ? err.message : 'It did not go through.';
    await env.DB.prepare(`UPDATE hub_meeting_partner SET state = 'failed', summary = ?, detail = ? WHERE meeting_id = ? AND cid = ?`).bind(summary, why.slice(0, 240), id, cid).run();
    throw err;
  }
  return { ok: true, partners: await partnersOf(env, user, id) };
}

/** What goes in the Blackbaud action's description: the date, who from Favor was there, the summary, the decisions and the follow-ups. No outside addresses. */
export async function describeMeeting(env: MeetEnv, m: Meeting): Promise<string> {
  const n = safeJson<{ decisions?: Array<{ text: string }> }>(m.notes_json, {});
  const staff = (await rosterOf(env, m)).filter((p) => FAVOR.test(p.email)).sort((x, y) => Number(y.email === lower(m.host_email)) - Number(x.email === lower(m.host_email))).map((p) => p.name);
  const acts = (await env.DB.prepare('SELECT text, owner_name, due FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx LIMIT 10').bind(m.id).all<{ text: string; owner_name: string; due: string }>().catch(() => ({ results: [] }))).results || [];
  const lines = [`Meeting on ${shortDay(etDay(m.started_at || m.created_at))}, held in FavorOS Meetings.`];
  if (staff.length) lines.push(`From Favor: ${staff.join(', ')}.`);
  if (m.summary) lines.push('', m.summary);
  if ((n.decisions || []).length) lines.push('', 'Decisions', ...(n.decisions || []).slice(0, 6).map((d) => `- ${d.text}`));
  if (acts.length) lines.push('', 'Follow-up', ...acts.map((a) => `- ${a.owner_name ? a.owner_name + ': ' : ''}${a.text}${a.due ? ' (' + a.due + ')' : ''}`));
  return lines.join('\n').slice(0, 4000);
}

/** The chat channels a person may choose to post a meeting's summary to. */
export async function meetChannels(env: MeetEnv, user: User) {
  const list = await chat.listChannels(env, user.email).catch(() => []);
  return { ok: true, channels: list.filter((c) => c.kind === 'public' || c.kind === 'private').map((c) => ({ id: c.id, name: c.name, kind: c.kind })) };
}

/** Sets the channel for a meeting's summary. The host must be a member of it. An empty id clears it. */
export async function setPostChannel(env: MeetEnv, user: User, id: string, channelId: string): Promise<void> {
  const m = await getMeeting(env, id);
  if (!isHost(m, user.email) && user.role !== 'admin') throw new HttpError(403, 'host_only', 'Only the host can choose where the summary goes.');
  if (channelId && !(await chat.isMember(env, channelId, user.email))) throw new HttpError(400, 'channel', 'Pick a channel you are in.');
  await env.DB.prepare('UPDATE hub_meetings SET post_channel = ? WHERE id = ?').bind(channelId, id).run();
}

/** The summary, decisions and action items as a channel message from the Meetings voice, with each owner mentioned so they are notified. */
export function summaryBody(m: Pick<Meeting, 'title' | 'summary' | 'started_at' | 'created_at'>, notes: { decisions?: Array<{ text: string }> }, actions: Array<{ text: string; owner_name: string; owner_email: string; due: string }>): string {
  const lines = [`Notes from ${m.title || 'the meeting'}, ${shortDay(etDay(m.started_at || m.created_at))}.`, '', String(m.summary || '').slice(0, 900)];
  const dec = (notes.decisions || []).slice(0, 5);
  if (dec.length) lines.push('', 'Decisions', ...dec.map((d) => `- ${d.text}`));
  if (actions.length) {
    lines.push('', 'Action items', ...actions.slice(0, 10).map((a) => `- ${a.owner_email ? `<@${a.owner_email}> ` : a.owner_name ? a.owner_name + ': ' : ''}${a.text}${a.due ? ' (due ' + a.due + ')' : ''}`));
  }
  return lines.join('\n').trim().slice(0, 3800);
}

/** Posts the summary to the channel the host chose. Once only. A meeting started from a channel already has its own post. */
export async function postSummary(env: MeetEnv, id: string): Promise<boolean> {
  const m = (await getMeeting(env, id)) as Meeting & { post_channel?: string; summary_posted?: number };
  if (!m.post_channel || m.summary_posted || !m.summary) return false;
  const linked = await env.DB.prepare('SELECT 1 AS ok FROM chat_meetings WHERE meeting_id = ?').bind(id).first().catch(() => null);
  if (linked) return false;
  const claim = await env.DB.prepare('UPDATE hub_meetings SET summary_posted = 1 WHERE id = ? AND summary_posted = 0').bind(id).run();
  if (claim.meta.changes !== 1) return false;
  try {
    const acts = (await env.DB.prepare('SELECT text, owner_name, owner_email, due FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx').bind(id).all<{ text: string; owner_name: string; owner_email: string; due: string }>()).results || [];
    const posted = await chat.post(env, {
      channel_id: m.post_channel, email: MEETINGS_ID, body: summaryBody(m, safeJson(m.notes_json, {}), acts), attachments: [{ type: 'meeting', id }],
    });
    const [msg] = await chat.shape(env, [posted.message], (a) => hydrateAttachments(env, a));
    await publish(env as LiveEnv, posted.members, { type: 'message', message: msg });
    return true;
  } catch (err) {
    await env.DB.prepare('UPDATE hub_meetings SET summary_posted = 0 WHERE id = ?').bind(id).run();
    throw err;
  }
}

/** Runs right after the notes are made. A failure in one step never undoes the notes or stops the next step. */
export async function afterNotes(env: MeetEnv, id: string): Promise<void> {
  try { await proposePartners(env, id); } catch (err) { console.warn('[meet] partners', id, err); }
  try { await postSummary(env, id); } catch (err) { console.warn('[meet] summary post', id, err); }
}

// ---------------------------------------------------------------- always: ask across every meeting

export interface MeetingAnswer {
  ok: true;
  answer: string;
  sources: Array<{ id: string; title: string; date: string; t: number; text: string }>;
  searched: number;
}

const ASK_PROMPT =
  'You answer a question for a staff member from the notes and transcripts of past staff meetings at a nonprofit. Each meeting has a number. Meetings are separate: never blend facts, decisions or action items from different meetings into one list. Answer meeting by meeting, naming the meeting and its date for every item, and put the source meeting number of each item in sources. ' +
  'Return keys: answer (plain sentences, one short group per meeting that matters, each beginning with the meeting title and date; say so when the meetings do not cover it; name the meeting and its date when it matters) and sources (array of at most 6 objects {m: meeting number, t: seconds into that meeting or 0, text: the short passage or fact that supports the answer}). ' +
  'Use only what is given. Do not invent names, numbers, dates or dollar amounts. Never repeat a partner\'s personal details. No em dashes.';

/** One question across every meeting this person may read: the notes and the transcript lines that mention the question's words. */
export async function askMeetings(env: MeetEnv, user: User, qRaw: unknown): Promise<MeetingAnswer> {
  const q = clean(qRaw, 300);
  if (!q) throw new HttpError(400, 'bad_question', 'Type a question first.');
  const led = await ledPeople(env, user.email);
  const all = (await env.DB.prepare(
    `SELECT id, title, summary, notes_json, started_at, created_at, ended_at, status, host_email, host_name, cohosts, invitees, access FROM hub_meetings
      WHERE status = 'ended' AND notes_status = 'ready' ORDER BY COALESCE(ended_at, created_at) DESC LIMIT 800`
  ).all<Meeting>()).results || [];
  const mine = all.filter((m) => mayReadNotes(m, user as never, led));
  if (!mine.length) return { ok: true, answer: 'You have no finished meetings with notes yet.', sources: [], searched: 0 };
  const words = keywords(q);
  const byId = new Map(mine.map((m) => [m.id, m]));
  const score = new Map<string, number>();
  const hits = new Map<string, Array<{ t: number; who: string; text: string }>>();
  const hasWord = (s: string, w: string) => lower(s).includes(w);
  for (const m of mine) {
    let s = 0;
    for (const w of words) {
      if (hasWord(m.title, w)) s += 4;
      if (hasWord(m.summary || '', w)) s += 3;
      if (hasWord(m.notes_json || '', w)) s += 2;
    }
    if (s) score.set(m.id, s);
  }
  if (words.length) {
    const cond = words.map((_, i) => `instr(lower(text), ?${i + 1}) > 0`).join(' OR ');
    const lines = (await env.DB.prepare(`SELECT meeting_id, t, who, text FROM hub_meeting_lines WHERE ${cond} ORDER BY meeting_id DESC, t LIMIT 2500`).bind(...words).all<{ meeting_id: string; t: number; who: string; text: string }>()).results || [];
    for (const l of lines) {
      if (!byId.has(l.meeting_id)) continue;
      const list = hits.get(l.meeting_id) || hits.set(l.meeting_id, []).get(l.meeting_id)!;
      if (list.length < 40) list.push({ t: l.t, who: l.who, text: l.text });
      score.set(l.meeting_id, (score.get(l.meeting_id) || 0) + words.filter((w) => hasWord(l.text, w)).length);
    }
  }
  let picked = [...score.entries()].sort((a, b) => b[1] - a[1] || (byId.get(b[0])!.ended_at || '').localeCompare(byId.get(a[0])!.ended_at || '')).slice(0, 7).map(([id]) => byId.get(id)!);
  const matched = picked.length > 0;
  // A question with no words in common with any meeting reads the newest meetings, so "what did we cover lately" still answers.
  if (!matched) picked = mine.slice(0, 6);
  let budget = 15000;
  const blocks: string[] = [];
  picked.forEach((m, i) => {
    const n = safeJson<{ decisions?: Array<{ text: string }>; actions?: Array<{ text: string; owner: string }> }>(m.notes_json, {});
    const parts = [`Meeting ${i + 1}: ${m.title}, ${etDay(m.started_at || m.created_at)}, host ${m.host_name || m.host_email}`, `Summary: ${m.summary || 'none'}`];
    if ((n.decisions || []).length) parts.push('Decisions: ' + (n.decisions || []).map((d) => d.text).join('; '));
    if ((n.actions || []).length) parts.push('Action items: ' + (n.actions || []).map((a) => (a.owner ? a.owner + ': ' : '') + a.text).join('; '));
    const h = (hits.get(m.id) || []).slice(0, 8);
    if (h.length) parts.push('Said in the meeting:\n' + h.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n'));
    let block = parts.join('\n');
    if (block.length > budget) block = block.slice(0, Math.max(400, budget));
    budget -= block.length;
    blocks.push(block);
  });
  const out = await chatJson<{ answer?: unknown; sources?: unknown }>(env as never, ASK_PROMPT, `Question: ${q}\n\n${blocks.join('\n\n')}`, 800, TEXT_MODELS, MEET_AI);
  const sources = (Array.isArray(out.sources) ? (out.sources as Array<Record<string, unknown>>) : []).slice(0, 6).flatMap((s) => {
    const m = picked[Number(s.m) - 1];
    const text = plain(s.text, 240);
    return m && text ? [{ id: m.id, title: m.title, date: etDay(m.started_at || m.created_at), t: Math.max(0, Math.round(Number(s.t) || 0)), text }] : [];
  });
  return { ok: true, answer: plain(out.answer, 700) || 'The meetings do not say.', sources, searched: mine.length };
}
