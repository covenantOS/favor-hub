// The Friday status update, written from what moved in the project during the last seven days.
//   facts     read from hub_tasks and hub_task_events: done, started, slipped, reassigned, new, late, due next week, waiting
//   text      the lists come straight from the facts; a model may phrase the opening sentence from those same facts and nothing else
//   posting   to the project's Chat channel as the project lead, only when a project owner has turned the update on
//   schedule  runDue() runs on the meeting reminder tick and posts Fridays from 3 PM Eastern, once per week per project
import { HttpError, nowIso, type Env } from '../../http';
import { aiFor } from '../../ai/guard';
import { staffDirectory } from '../../people';
import * as store from '../../chat/db';
import { cleanBody } from '../../chat/text';
import { ensureProjectChannel } from '../links/chat';
import { need, projectStanding, type Actor } from '../access';
import { addEvent, lower, projectOf, todayEastern, type ProjectRow } from '../db';
import { addDays, dn, weekStart } from './workload';

export interface Line {
  code: string | null;
  title: string;
  who: string;
  note?: string;
}
export interface Facts {
  project: { key: string; name: string };
  week: string;
  since: string;
  done: Line[];
  started: Line[];
  slipped: Line[];
  reassigned: Line[];
  created: Line[];
  late: Line[];
  next: Line[];
  waiting: Line[];
  counts: { done: number; open: number; late: number; comments: number; created: number };
}

const SHOW = 8;

interface TRow {
  id: string;
  code: string | null;
  title: string;
  owner_email: string | null;
  due_date: string | null;
  status: string;
  done_at: string | null;
  created_at: string;
}

export async function factsFor(env: Env, p: ProjectRow, today = todayEastern(), now = new Date()): Promise<Facts> {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const dir = new Map((await staffDirectory(env)).map((x) => [x.email, x.name]));
  const who = (e: string | null) => (e ? dir.get(lower(e)) || lower(e).split('@')[0] : 'No owner');
  const line = (t: { code: string | null; title: string; owner_email: string | null }, note?: string): Line => ({ code: t.code, title: t.title, who: who(t.owner_email), ...(note ? { note } : {}) });
  const q = async (sql: string, ...a: unknown[]) => ((await env.DB.prepare(sql).bind(...a).all<TRow>()).results || []) as TRow[];
  const base = 'SELECT id, code, title, owner_email, due_date, status, done_at, created_at FROM hub_tasks WHERE project_id = ?';
  const [done, created, open, events, comments] = await Promise.all([
    q(`${base} AND status = 'done' AND done_at >= ? ORDER BY done_at`, p.id, since),
    q(`${base} AND status <> 'dropped' AND created_at >= ? ORDER BY created_at`, p.id, since),
    q(`${base} AND status NOT IN ('done', 'dropped') ORDER BY due_date`, p.id),
    env.DB.prepare(`SELECT e.task_id, e.kind, e.detail FROM hub_task_events e WHERE e.project_id = ? AND e.created_at >= ? AND e.kind IN ('updated', 'reopened') ORDER BY e.created_at`)
      .bind(p.id, since)
      .all<{ task_id: string; kind: string; detail: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_task_comments c JOIN hub_tasks t ON t.id = c.task_id WHERE t.project_id = ? AND c.created_at >= ? AND c.deleted_at IS NULL`).bind(p.id, since).first<{ n: number }>(),
  ]);
  const byId = new Map<string, TRow>();
  for (const t of [...done, ...created, ...open]) byId.set(t.id, t);
  const started: Line[] = [];
  const slipped: Line[] = [];
  const reassigned: Line[] = [];
  const seen = { s: new Set<string>(), l: new Set<string>(), r: new Set<string>() };
  for (const e of events.results || []) {
    let d: { from?: Record<string, unknown>; to?: Record<string, unknown> } = {};
    try {
      d = JSON.parse(e.detail || '{}');
    } catch {
      continue;
    }
    const t = byId.get(e.task_id) || ((await env.DB.prepare('SELECT id, code, title, owner_email, due_date, status, done_at, created_at FROM hub_tasks WHERE id = ?').bind(e.task_id).first<TRow>()) ?? null);
    if (!t) continue;
    const f = d.from || {};
    const to = d.to || {};
    if (to.status === 'doing' && f.status !== 'doing' && !seen.s.has(t.id) && t.status !== 'done') {
      seen.s.add(t.id);
      started.push(line(t));
    }
    if (typeof to.due_date === 'string' && typeof f.due_date === 'string' && to.due_date > f.due_date && !seen.l.has(t.id)) {
      seen.l.add(t.id);
      slipped.push(line(t, `${f.due_date} to ${to.due_date}`));
    }
    if ('owner_email' in to && to.owner_email !== f.owner_email && !seen.r.has(t.id)) {
      seen.r.add(t.id);
      reassigned.push(line(t, `to ${who(String(to.owner_email || ''))}`));
    }
  }
  const late = open.filter((t) => t.due_date && t.due_date < today);
  const next = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7));
  const waiting = open.filter((t) => t.status === 'waiting');
  return {
    project: { key: p.key, name: p.name },
    week: weekStart(today),
    since,
    done: done.slice(-SHOW * 2).map((t) => line(t)),
    started: started.slice(0, SHOW),
    slipped: slipped.slice(0, SHOW),
    reassigned: reassigned.slice(0, SHOW),
    created: created.slice(0, SHOW).map((t) => line(t)),
    late: late.slice(0, SHOW).map((t) => line(t, `${dn(today) - dn(t.due_date as string)} days late`)),
    next: next.slice(0, SHOW + 2).map((t) => line(t, `due ${t.due_date}`)),
    waiting: waiting.slice(0, SHOW).map((t) => line(t)),
    counts: { done: done.length, open: open.length, late: late.length, comments: Number(comments?.n) || 0, created: created.length },
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (s: string) => `${MON[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const plain = (s: string) => s.replace(/\s*[–—]\s*/g, ', ');

/** The opening sentence from the counts alone, used when the model is off or answers badly. */
export function summaryOf(f: Facts): string {
  const c = f.counts;
  if (!c.done && !c.created && !c.comments && !f.started.length) return `Nothing moved this week. ${plural(c.open, 'task')} ${c.open === 1 ? 'is' : 'are'} open${c.late ? `, ${c.late} late` : ''}.`;
  const bits = [c.done ? `${plural(c.done, 'task')} finished` : '', f.started.length ? `${plural(f.started.length, 'task')} started` : '', c.created ? `${plural(c.created, 'new task')} added` : ''].filter(Boolean);
  return `${bits.join(', ')}. ${plural(c.open, 'task')} left open${c.late ? `, ${c.late} of them late` : ''}.`;
}

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** One or two sentences phrased by the model from the facts. Falls back to the counts. */
async function opening(env: Env, f: Facts): Promise<string> {
  const fallback = summaryOf(f);
  if (!env.AI) return fallback;
  try {
    const run = aiFor(env.AI, 'plan-status')!.run(MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You write the opening of a weekly project status note for a nonprofit team. Use only the JSON facts you are given. Write one or two plain sentences, under 45 words, in the past tense. Name no one who is not in the facts. Do not state any number that is not in the facts. No dashes, no emoji, no adjectives of praise, no mention of AI.',
        },
        { role: 'user', content: JSON.stringify({ project: f.project.name, counts: f.counts, done: f.done.map((t) => t.title), late: f.late.map((t) => t.title), slipped: f.slipped.length, started: f.started.map((t) => t.title) }) },
      ],
      max_tokens: 140,
      temperature: 0.2,
    }) as Promise<{ response?: string }>;
    const res = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), 15000))]);
    const t = res && typeof res.response === 'string' ? plain(res.response.replace(/\s+/g, ' ').trim()) : '';
    // A number the facts do not hold means the model made it up.
    const known = new Set<string>([...JSON.stringify(f).match(/\d+/g) || []]);
    const ok = t.length >= 20 && t.length <= 320 && (t.match(/\d+/g) || []).every((n) => known.has(n));
    return ok ? t : fallback;
  } catch {
    return fallback;
  }
}

function list(title: string, rows: Line[], extra = 0): string {
  if (!rows.length) return '';
  const more = extra > rows.length ? `\n- and ${extra - rows.length} more` : '';
  return `\n${title}\n${rows.map((r) => `- ${plain(r.title)}${r.who ? ` (${r.who}${r.note ? `, ${r.note}` : ''})` : r.note ? ` (${r.note})` : ''}`).join('\n')}${more}`;
}

export async function textFor(env: Env, f: Facts): Promise<string> {
  const head = `Friday update, ${f.project.name}. Week of ${short(f.week)}.`;
  const parts = [
    await opening(env, f),
    list('Done', f.done, f.counts.done),
    list('Started', f.started),
    list('Pushed back', f.slipped),
    list('Late', f.late, f.counts.late),
    list('Waiting', f.waiting),
    list('Due in the next 7 days', f.next),
  ].map((x) => x.trim()).filter(Boolean);
  return cleanBody([head, ...parts].join('\n\n'));
}

/* ---------------------------------------------------------------- the switch and the post */

export interface StatusRow {
  enabled: boolean;
  enabled_by: string;
  enabled_at: string | null;
  last_week: string | null;
  last_posted_at: string | null;
  last_error: string;
}

export async function statusOf(env: Env, projectId: string): Promise<StatusRow> {
  const r = await env.DB.prepare('SELECT enabled, enabled_by, enabled_at, last_week, last_posted_at, last_error FROM hub_project_status WHERE project_id = ?')
    .bind(projectId)
    .first<{ enabled: number; enabled_by: string; enabled_at: string | null; last_week: string | null; last_posted_at: string | null; last_error: string }>()
    .catch(() => null);
  return { enabled: !!r?.enabled, enabled_by: r?.enabled_by || '', enabled_at: r?.enabled_at || null, last_week: r?.last_week || null, last_posted_at: r?.last_posted_at || null, last_error: r?.last_error || '' };
}

/** Only the project's lead or an admin (its owners) turns the update on. Turning it on makes sure the channel exists. */
export async function setEnabled(env: Env, actor: Actor, idOrKey: string, on: boolean): Promise<{ status: StatusRow; channel: { id: string; name: string } | null }> {
  const p = await projectOf(env, idOrKey);
  need((await projectStanding(env, actor, p)).manage, 'Only the project lead or an admin can turn the Friday update on or off.');
  let channel: { id: string; name: string } | null = null;
  if (on) {
    const ch = await ensureProjectChannel(env, p, actor.email);
    channel = { id: ch.id, name: ch.name };
  }
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO hub_project_status (project_id, enabled, enabled_by, enabled_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled, enabled_by = excluded.enabled_by, enabled_at = excluded.enabled_at, last_error = ''`
  )
    .bind(p.id, on ? 1 : 0, actor.email, now)
    .run();
  await addEvent(env, { project_id: p.id, actor: actor.email, kind: on ? 'status_on' : 'status_off' });
  if (!channel && p.chat_channel_id) {
    const c = await store.getChannel(env, p.chat_channel_id).catch(() => null);
    if (c) channel = { id: c.id, name: c.name };
  }
  return { status: await statusOf(env, p.id), channel };
}

export async function channelOf(env: Env, p: ProjectRow): Promise<{ id: string; name: string } | null> {
  if (!p.chat_channel_id) return null;
  const c = await store.getChannel(env, p.chat_channel_id).catch(() => null);
  return c ? { id: c.id, name: c.name } : null;
}

/** Writes this week's update to the project's channel. Throws when the update is off. */
export async function postUpdate(env: Env, p: ProjectRow, by: string, today = todayEastern()): Promise<{ message_id: number; channel: string; text: string }> {
  const st = await statusOf(env, p.id);
  if (!st.enabled) throw new HttpError(409, 'status_off', 'The Friday update is off for this project. A project owner turns it on first.');
  const ch = await ensureProjectChannel(env, p, p.lead_email);
  const text = await textFor(env, await factsFor(env, p, today));
  const posted = await store.post(env, { channel_id: ch.id, email: lower(p.lead_email), body: text });
  const id = posted.message.id;
  await env.DB.prepare('UPDATE hub_project_status SET last_week = ?, last_posted_at = ?, last_message_id = ?, last_error = ? WHERE project_id = ?').bind(weekStart(today), nowIso(), id, '', p.id).run();
  await addEvent(env, { project_id: p.id, actor: by, kind: 'status_posted', detail: { message_id: id } });
  return { message_id: id, channel: ch.name, text };
}

/** Eastern weekday (5 = Friday) and hour. */
export function easternClock(now = new Date()): { dow: number; hour: number; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((x) => x.type === 'weekday')?.value || '';
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour: Number(parts.find((x) => x.type === 'hour')?.value) || 0, day: todayEastern(now) };
}

/** The scheduled pass. Posts for every project that has the update on and has not posted for this week, Fridays from 3 PM Eastern. */
export async function runDue(env: Env, now = new Date()): Promise<{ posted: string[]; failed: string[]; skipped: string }> {
  const clock = easternClock(now);
  if (clock.dow !== 5 || clock.hour < 15) return { posted: [], failed: [], skipped: 'not Friday afternoon' };
  const week = weekStart(clock.day);
  const rows = await env.DB.prepare(
    `SELECT p.* FROM hub_project_status s JOIN hub_projects p ON p.id = s.project_id
      WHERE s.enabled = 1 AND p.status = 'active' AND (s.last_week IS NULL OR s.last_week <> ?) LIMIT 20`
  )
    .bind(week)
    .all<ProjectRow>();
  const posted: string[] = [];
  const failed: string[] = [];
  for (const p of rows.results || []) {
    try {
      await postUpdate(env, p, 'schedule', clock.day);
      posted.push(p.key);
    } catch (err) {
      failed.push(p.key);
      await env.DB.prepare('UPDATE hub_project_status SET last_error = ? WHERE project_id = ?').bind(String((err as Error)?.message || err).slice(0, 300), p.id).run();
    }
  }
  return { posted, failed, skipped: '' };
}
