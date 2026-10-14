// FavorOS entities: the things a person meets on every page (a colleague, a partner, a fund, an appeal code, a task, a request, a meeting,
// a clip, a course) resolved to one shape for the chip, the hover card and the phone sheet (public/js/favor-entity.js), and for the Chat
// card and Search. Every kind applies the signed-in person's access here, so a card never shows more than the page it stands for would.
// A thing a person may not read comes back `restricted`: the page keeps the name it already printed and the card shows only that.
import type { Env } from '../http';
import type { HubUser } from '../session';
import { staffDirectory } from '../people';
import { mirrorQ, SYSTEM_ID } from '../work/partner';
import { FUNDRAISERS_SQL } from '../work/repo';
import { actorOf, projectsFlag, visibleTask } from '../projects/access';
import { dueLabel, STATUS_WORD, taskUrl } from '../projects/links/shared';
import { requestHit } from '../requests/views';
import { hrefFor } from '../learn/assign';
import type { Access } from './today';
import { emailsOf, isHost, ledPeople, mayJoin, mayReadNotes, wasPresent } from '../meet';

export const KINDS = ['person', 'partner', 'fund', 'appeal', 'task', 'request', 'meeting', 'clip', 'file', 'course'] as const;
export type Kind = (typeof KINDS)[number];

export interface Fact {
  k: string;
  v: string;
}

export interface EntityOut {
  kind: Kind;
  id: string;
  title: string;
  sub: string;
  /** Where Open goes. Empty for a person (their card opens a message instead). */
  url: string;
  facts: Fact[];
  /** What the card offers: open, message, task, brain, send. The client adds nothing the server left out. */
  acts: string[];
  pic?: string;
  /** The person may not read this, so only the name the page printed shows. */
  restricted?: boolean;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const ymd = (s: unknown) => String(s || '').slice(0, 10);
const day = (s: string) => (s ? new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '');
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const jsonList = (s: unknown): any[] => {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const restricted = (kind: Kind, id: string): EntityOut => ({ kind, id, title: '', sub: '', url: '', facts: [], acts: [], restricted: true });

async function person(env: Env, access: Access, id: string): Promise<EntityOut | null> {
  const dir = await staffDirectory(env);
  const key = lower(id);
  const p = dir.find((x) => x.email === key) || dir.find((x) => lower(x.name) === key);
  if (!p) return null;
  const facts: Fact[] = [];
  if (p.team) facts.push({ k: 'Team', v: p.team });
  facts.push({ k: 'Email', v: p.email });
  return { kind: 'person', id: p.email, title: p.name, sub: p.title || p.team, url: '', facts, acts: [...(access.chat ? ['message'] : []), 'task', 'brain', 'send'], pic: p.picture || undefined };
}

/** Name, lifetime giving, last gift and holder, from the same copy of Blackbaud as the Work Center. Only people who may open the Work Center see it. */
async function partner(env: Env, access: Access, idIn: string): Promise<EntityOut | null> {
  let id = idIn;
  if (!access.workCenter) return restricted('partner', id);
  const q = mirrorQ(env);
  // "L4453" is a Lookup ID (what the Favor Brain names a partner by); a bare number is the Blackbaud system id the Work Center links use.
  const byLookup = /^L(\d{1,12})$/i.exec(id);
  if (byLookup) id = String((await q<any>('SELECT id FROM constituents WHERE constituent_lookup_id = ?1 LIMIT 1', [byLookup[1]]))[0]?.id || '');
  if (!SYSTEM_ID.test(id)) return null;
  const [row, own, last, assigns, fr, addr] = await Promise.all([
    q<any>("SELECT constituent_lookup_id AS lookup, deceased, json_extract(raw_json, '$.name') AS name, organization_name AS org, first_name AS first, last_name AS last FROM constituents WHERE id = ?1", [id]),
    q<any>("SELECT COUNT(*) AS n, COALESCE(SUM(gift_amount), 0) AS total FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other')", [id]),
    q<any>("SELECT gift_amount AS amount, substr(gift_date, 1, 10) AS gdate FROM gifts WHERE constituent_record_id = ?1 AND gift_amount > 0 AND gift_type IN ('Donation', 'RecurringGiftPayment', 'GiftInKind', 'Stock/Property', 'Other') ORDER BY gift_date DESC LIMIT 1", [id]),
    q<any>('SELECT assignment_fundraiser_id AS fid, substr(assignment_to_date, 1, 10) AS tod FROM assignments WHERE constituent_record_id = ?1 ORDER BY (assignment_to_date IS NULL) DESC, assignment_to_date DESC LIMIT 10', [id]),
    q<any>(FUNDRAISERS_SQL),
    q<any>('SELECT address_city AS city, address_state AS state FROM addresses WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 ORDER BY is_primary DESC LIMIT 1', [id]),
  ]);
  const k = row[0];
  if (!k) return null;
  const name = String(k.name || k.org || `${k.first || ''} ${k.last || ''}`.trim() || `Record ${id}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const names = new Map<string, string>(fr.map((f: any) => [String(f.id), `${f.first ?? ''} ${f.last ?? ''}`.trim()]));
  const holders = assigns.filter((a: any) => !a.tod || a.tod >= today).map((a: any) => names.get(String(a.fid)) || '').filter(Boolean);
  const place = [addr[0]?.city, addr[0]?.state].filter(Boolean).join(', ');
  const total = Number(own[0]?.total) || 0;
  const n = Number(own[0]?.n) || 0;
  const facts: Fact[] = [];
  if (k.lookup) facts.push({ k: 'Lookup ID', v: String(k.lookup) });
  facts.push({ k: 'Lifetime giving', v: n ? `${money(total)} in ${n.toLocaleString('en-US')} ${n === 1 ? 'gift' : 'gifts'}` : 'No gifts on record' });
  if (last[0]) facts.push({ k: 'Last gift', v: `${money(Number(last[0].amount) || 0)} on ${day(last[0].gdate)}` });
  facts.push({ k: 'Held by', v: holders.length ? [...new Set(holders)].join(', ') : 'No one' });
  return { kind: 'partner', id, title: name, sub: [place, k.deceased ? 'deceased' : ''].filter(Boolean).join(' · '), url: `/work/partner/${id}`, facts, acts: ['open', 'task', 'brain', 'send'] };
}

async function fund(env: Env, access: Access, id: string): Promise<EntityOut | null> {
  if (!access.workCenter) return restricted('fund', id);
  const rows = await mirrorQ(env)<any>('SELECT id, fund_description AS name FROM funds WHERE id = ?1 OR lower(fund_description) = ?2 LIMIT 1', [id, lower(id)]).catch(() => []);
  const f = rows[0];
  if (!f) return null;
  const facts: Fact[] = [{ k: 'Fund ID', v: String(f.id) }];
  return { kind: 'fund', id: String(f.id), title: String(f.name || `Fund ${f.id}`), sub: 'Fund', url: '', facts, acts: ['brain', 'send'] };
}

async function appeal(env: Env, access: Access, id: string): Promise<EntityOut | null> {
  if (!access.workCenter) return restricted('appeal', id);
  const code = String(id).trim().toUpperCase();
  const rows = await mirrorQ(env)<any>("SELECT id, appeal_id AS code, appeal_description AS description, appeal_category AS cat, substr(appeal_start_date, 1, 10) AS start, appeal_inactive AS inactive FROM appeals WHERE upper(appeal_id) = ?1 LIMIT 1", [code]).catch(() => []);
  const a = rows[0];
  if (!a) return null;
  const facts: Fact[] = [];
  if (a.cat) facts.push({ k: 'Category', v: String(a.cat) });
  if (a.start) facts.push({ k: 'Starts', v: day(a.start) });
  facts.push({ k: 'Status', v: Number(a.inactive) ? 'Inactive' : 'Active' });
  return { kind: 'appeal', id: String(a.code), title: String(a.code), sub: String(a.description || 'Appeal code'), url: '', facts, acts: ['brain', 'send'] };
}

async function task(env: Env, request: Request, user: HubUser, id: string): Promise<EntityOut | null> {
  if (!(await projectsFlag(env, user).catch(() => false))) return restricted('task', id);
  const actor = actorOf(request, user);
  if (!actor) return restricted('task', id);
  const vis = visibleTask(actor, 't');
  const t = await env.DB.prepare(
    `SELECT t.id, t.code, t.title, t.status, t.owner_email, t.due_date, t.due_time, p.key AS pkey, p.name AS pname
       FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id WHERE (lower(t.id) = lower(?) OR t.code = ?) AND ${vis.sql} LIMIT 1`
  )
    .bind(id, id.toUpperCase(), ...vis.args)
    .first<any>()
    .catch(() => null);
  if (!t) return null;
  const dir = await staffDirectory(env);
  const owner = t.owner_email ? dir.find((p) => p.email === lower(t.owner_email))?.name || String(t.owner_email) : '';
  const facts: Fact[] = [{ k: 'Status', v: STATUS_WORD[t.status] || t.status }];
  if (owner) facts.push({ k: 'Owner', v: owner });
  if (t.due_date) facts.push({ k: 'Due', v: dueLabel(t.due_date, t.due_time) });
  if (t.pname) facts.push({ k: 'Project', v: String(t.pname) });
  return { kind: 'task', id: String(t.code || t.id), title: String(t.title), sub: [t.code, t.pname].filter(Boolean).join(' · ') || 'Task', url: taskUrl({ id: t.id, code: t.code }, t.pkey ? { key: t.pkey } : null), facts, acts: ['open', 'brain', 'send'] };
}

async function requestOf(env: Env, request: Request, user: HubUser, id: string): Promise<EntityOut | null> {
  const actor = actorOf(request, user);
  if (!actor) return restricted('request', id);
  const h = await requestHit(env, actor, id).catch(() => null);
  if (!h) return null;
  const facts: Fact[] = [{ k: 'Status', v: h.status }];
  if (h.owner) facts.push({ k: 'Owner', v: h.owner });
  if (h.waiting_on) facts.push({ k: 'Waiting on', v: h.waiting_on });
  facts.push({ k: 'Asked by', v: h.asked_by });
  if (h.due_date) facts.push({ k: 'Due', v: day(h.due_date) });
  return { kind: 'request', id: h.id, title: h.title, sub: 'Request', url: h.url, facts, acts: ['open', 'task', 'brain', 'send'] };
}

async function meeting(env: Env, user: HubUser, id: string): Promise<EntityOut | null> {
  // The same rule as the meeting and its notes: whoever may join it or read its notes. A guest link (access = guests) opens the
  // room to outside guests only, so it never shows the meeting to staff who are not on it (privacy pass 2026-10-14).
  const m = await env.DB.prepare(
    `SELECT id, title, status, host_email, host_name, cohosts, invitees, access, starts_at, started_at, ended_at, notes_status FROM hub_meetings WHERE id = ?1 LIMIT 1`
  )
    .bind(id)
    .first<any>()
    .catch(() => null);
  if (!m) return null;
  const onIt = user.role === 'admin' || isHost(m, user.email) || emailsOf(m.invitees).includes(lower(user.email));
  if (!onIt && !mayJoin(m, user) && !mayReadNotes(m, user, await ledPeople(env as never, user.email), await wasPresent(env as never, m.id, user.email))) return null;
  const ended = m.status === 'ended' || m.status === 'cancelled';
  const facts: Fact[] = [{ k: 'Status', v: m.status === 'live' ? 'Live now' : m.status === 'cancelled' ? 'Cancelled' : ended ? 'Ended' : 'Scheduled' }];
  const at = m.starts_at || m.started_at;
  if (at) facts.push({ k: ended ? 'Was' : 'When', v: when(at) });
  if (m.host_name) facts.push({ k: 'Host', v: m.host_name });
  const notes = m.notes_status === 'ready';
  if (notes) facts.push({ k: 'Notes', v: 'Ready' });
  return { kind: 'meeting', id: m.id, title: m.title || 'Meeting', sub: 'Meeting', url: ended && notes ? `/meet/notes/?m=${m.id}` : `/meet/room/?m=${m.id}`, facts, acts: ['open', 'task', 'brain', 'send'] };
}

async function clip(env: Env, id: string): Promise<EntityOut | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const c = await env.DB.prepare("SELECT id, title, owner_name, duration_ms, created_at FROM hub_clips WHERE id = ? AND status IN ('ready', 'processing')").bind(id).first<any>().catch(() => null);
  if (!c) return null;
  const facts: Fact[] = [{ k: 'By', v: c.owner_name }];
  if (c.duration_ms) facts.push({ k: 'Length', v: `${Math.floor(c.duration_ms / 60000)}:${String(Math.round((c.duration_ms % 60000) / 1000)).padStart(2, '0')}` });
  facts.push({ k: 'Made', v: day(ymd(c.created_at)) });
  return { kind: 'clip', id: c.id, title: c.title || 'Untitled clip', sub: 'Clip', url: `/c/${c.id}`, facts, acts: ['open', 'task', 'brain', 'send'] };
}

async function course(env: Env, id: string): Promise<EntityOut | null> {
  const c = await env.DB.prepare("SELECT id, slug, title, summary, audience, (SELECT COUNT(*) FROM learn_lessons l WHERE l.course_id = learn_courses.id) AS lessons FROM learn_courses WHERE (id = ? OR slug = ?) AND status = 'published' LIMIT 1").bind(id, id).first<any>().catch(() => null);
  if (!c) return null;
  const facts: Fact[] = [{ k: 'Lessons', v: String(c.lessons || 0) }];
  if (c.audience) facts.push({ k: 'For', v: String(c.audience) });
  return { kind: 'course', id: c.slug, title: c.title, sub: String(c.summary || 'Course').slice(0, 120), url: hrefFor('course', c.slug), facts, acts: ['open', 'brain', 'send'] };
}

export async function resolveEntity(env: Env, request: Request, user: HubUser, access: Access, kind: string, idRaw: string): Promise<EntityOut | null> {
  const id = String(idRaw || '').trim().slice(0, 160);
  if (!id || !(KINDS as readonly string[]).includes(kind)) return null;
  switch (kind as Kind) {
    case 'person':
      return person(env, access, id);
    case 'partner':
      return partner(env, access, id);
    case 'fund':
      return fund(env, access, id);
    case 'appeal':
      return appeal(env, access, id);
    case 'task':
      return task(env, request, user, id);
    case 'request':
      return requestOf(env, request, user, id);
    case 'meeting':
      return meeting(env, user, id);
    case 'clip':
      return clip(env, id);
    case 'course':
      return course(env, id);
    case 'file':
      // A Drive file is a link the page already holds; the card shows what the page printed.
      return null;
  }
}
