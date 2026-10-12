// Learn reminders. They ride the request board's notice system: the same gate (requests.notify and requests.notify.only), the same
// admin email switch (requests.email) and the same personal choice (request_email_prefs: now, daily or none). A notice is saved only
// for a person the gate lets through, and email goes only for a person the gate lets through, so with notices off nobody is told.
//   assigned    right away, and by email at once for people who chose one email per event
//   due_soon    three days before the due date
//   due_today   on the due date
//   overdue     the day after, then once a week, four times at most
// The weekday morning pass (functions/api/work/digest.ts) writes the due reminders and emails whatever is waiting, one email per person.
import { nowIso, type Env } from '../http';
import { staffDirectory } from '../people';
import { emailOn, mailMode, send } from '../requests/mail';
import { noticeGate, type Actor, type TaskEnv } from '../requests/tasks';
import { buildLearnMail, type LearnItem, type LearnKind } from './email';
import { addDays, lower, today, ET } from './db';

export interface AssignmentFacts {
  id: string;
  email: string;
  kind: 'course' | 'path';
  title: string;
  due_date: string | null;
  note: string;
  href: string;
  minutes: number;
  lessons: number;
  /** A task in Projects tells the person already, so no second email goes out. */
  quiet?: boolean;
}

const itemOf = (kind: LearnKind, a: AssignmentFacts, actor: string, at: string): LearnItem => ({
  kind,
  title: a.title,
  what: a.kind,
  due_date: a.due_date,
  minutes: a.minutes,
  lessons: a.lessons,
  href: a.href,
  note: kind === 'assigned' ? a.note : '',
  actor,
  at,
});

/** Saves a notice for the person when the gate allows it. Returns the notice id, or 0 when nobody was told. */
export async function tell(env: TaskEnv, kind: LearnKind, a: AssignmentFacts, actor: Actor | null): Promise<number> {
  const gate = await noticeGate(env);
  const to = lower(a.email);
  if (!gate(to) || (actor && lower(actor.email) === to)) return 0;
  const now = env.CLOCK ? env.CLOCK.toISOString() : nowIso();
  const r = await env.DB.prepare(
    'INSERT INTO learn_notices (email, kind, assignment_id, title, note, href, actor_email, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(to, kind, a.id, a.title.slice(0, 200), a.note.slice(0, 600), a.href, actor ? lower(actor.email) : '', actor?.name || '', now)
    .run();
  const nid = Number((r.meta as { last_row_id?: number }).last_row_id) || 0;
  // One email for each event goes out now for a person who chose that; the morning pass carries the rest.
  if (kind === 'assigned' && nid && !a.quiet) {
    const mail = mailOne(env, nid, to, itemOf(kind, a, actor?.name || '', now)).catch((err) => console.error('[learn] mail', err));
    if (env.DEFER) env.DEFER(mail);
    else await mail;
  }
  return nid;
}

async function nameOf(env: Env, email: string): Promise<string> {
  const p = (await staffDirectory(env)).find((x) => x.email === email);
  return p?.name || email.split('@')[0] || email;
}

async function mailOne(env: TaskEnv, noticeId: number, email: string, item: LearnItem): Promise<boolean> {
  if (!(await emailOn(env)) || (await mailMode(env, email)) !== 'now') return false;
  const gate = await noticeGate(env);
  if (!gate(email)) return false;
  // The row is claimed before the send, so a second pass never mails the same notice twice.
  const claim = await env.DB.prepare('UPDATE learn_notices SET emailed_at = ? WHERE id = ? AND emailed_at IS NULL').bind(nowIso(), noticeId).run();
  if (!Number((claim.meta as { changes?: number }).changes)) return false;
  const mail = buildLearnMail({ to: { email, name: await nameOf(env, email) }, items: [item], now: env.CLOCK });
  const ok = await send(env, { to: email, ...mail }).catch(() => false);
  if (!ok) await env.DB.prepare('UPDATE learn_notices SET emailed_at = NULL WHERE id = ?').bind(noticeId).run();
  return ok;
}

export interface NoticeOut {
  id: number;
  kind: string;
  title: string;
  note: string;
  href: string;
  actor_name: string;
  created_at: string;
}

export async function noticesFor(env: Env, email: string, limit = 20): Promise<{ count: number; items: NoticeOut[] }> {
  const me = lower(email);
  try {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM learn_notices WHERE email = ? AND read_at IS NULL').bind(me).first<{ n: number }>();
    const rows = await env.DB.prepare('SELECT id, kind, title, note, href, actor_name, created_at FROM learn_notices WHERE email = ? AND read_at IS NULL ORDER BY id DESC LIMIT ?').bind(me, limit).all<NoticeOut>();
    return { count: Number(c?.n) || 0, items: rows.results || [] };
  } catch {
    return { count: 0, items: [] };
  }
}

export async function readNotices(env: Env, email: string, opts: { id?: number | null } = {}): Promise<void> {
  const now = nowIso();
  if (opts.id) await env.DB.prepare('UPDATE learn_notices SET read_at = ? WHERE email = ? AND id = ? AND read_at IS NULL').bind(now, lower(email), opts.id).run();
  else await env.DB.prepare('UPDATE learn_notices SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(now, lower(email)).run();
}

/** A person's notices about one assignment are read once they open it. */
export async function readFor(env: Env, email: string, assignmentIds: string[]): Promise<void> {
  if (!assignmentIds.length) return;
  await env.DB.prepare(`UPDATE learn_notices SET read_at = ? WHERE email = ? AND read_at IS NULL AND assignment_id IN (${assignmentIds.map(() => '?').join(',')})`)
    .bind(nowIso(), lower(email), ...assignmentIds)
    .run();
}

/* ------------------------------------------------------------------------------------------------ the morning pass */

export interface LearnDaily {
  day: string;
  reminders: number;
  emails: number;
  notes: string[];
}

interface OpenRow {
  id: string;
  email: string;
  kind: 'course' | 'path';
  target_id: string;
  due_date: string;
  note: string;
  title: string;
  slug: string;
  lessons: number;
  minutes: number;
}

/**
 * Called by the weekday morning cron. Writes "due soon" (three days ahead), "due today" and "overdue" reminders once each, then emails
 * each person who has unemailed notices. Nothing before 8:00 AM Eastern or on a weekend.
 */
export async function learnDailyPass(base: TaskEnv, now = new Date()): Promise<LearnDaily> {
  const env: TaskEnv = Object.assign(Object.create(base) as TaskEnv, { CLOCK: now });
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const dow = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const day = today(now);
  const out: LearnDaily = { day, reminders: 0, emails: 0, notes: [] };
  if (dow === 'Sat' || dow === 'Sun') return { ...out, notes: ['weekend'] };
  if (hour < 8) return { ...out, notes: ['before 8:00 AM'] };

  let rows: OpenRow[] = [];
  try {
    rows = ((await env.DB.prepare(
      `SELECT a.id, a.email, a.kind, a.target_id, a.due_date, a.note,
              COALESCE(c.title, p.title) AS title, COALESCE(c.slug, p.slug) AS slug,
              COALESCE((SELECT COUNT(*) FROM learn_lessons l WHERE l.course_id = a.target_id), 0) AS lessons,
              COALESCE((SELECT SUM(minutes) FROM learn_lessons l WHERE l.course_id = a.target_id), 0) AS minutes
         FROM learn_assignments a LEFT JOIN learn_courses c ON a.kind = 'course' AND c.id = a.target_id LEFT JOIN learn_paths p ON a.kind = 'path' AND p.id = a.target_id
        WHERE a.closed_at IS NULL AND a.due_date IS NOT NULL AND a.due_date <= ?`
    ).bind(addDays(day, 3)).all<OpenRow>()).results || []) as OpenRow[];
  } catch {
    return { ...out, notes: ['tables not applied'] };
  }
  const gate = await noticeGate(env);
  for (const r of rows) {
    if (!gate(r.email) || !r.title) continue;
    const facts: AssignmentFacts = {
      id: r.id,
      email: r.email,
      kind: r.kind,
      title: r.title,
      due_date: r.due_date,
      note: '',
      href: `/learn/${r.kind === 'path' ? 'p' : 'c'}/?${r.kind === 'path' ? 'p' : 'c'}=${encodeURIComponent(r.slug)}`,
      minutes: Number(r.minutes) || 0,
      lessons: r.kind === 'course' ? Number(r.lessons) || 0 : 0,
    };
    const had = async (kind: string, sinceIso?: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS last FROM learn_notices WHERE assignment_id = ? AND kind = ? ${sinceIso ? 'AND created_at > ?' : ''}`).bind(...(sinceIso ? [r.id, kind, sinceIso] : [r.id, kind])).first<{ n: number; last: string | null }>()) || { n: 0, last: null };
    let kind: LearnKind | null = null;
    if (r.due_date === day) kind = 'due_today';
    else if (r.due_date === addDays(day, 3)) kind = 'due_soon';
    else if (r.due_date < day) kind = 'overdue';
    if (!kind) continue;
    if (kind === 'overdue') {
      const h = await had('overdue');
      // Four at most, a week apart.
      if (Number(h.n) >= 4 || (h.last && Date.parse(h.last) > now.getTime() - 6.5 * 86400000)) continue;
    } else if (Number((await had(kind)).n)) continue;
    if (await tell(env, kind, facts, null)) out.reminders++;
  }

  // One email per person with notices not yet emailed, for people who chose one email per event or the daily summary.
  if (!(await emailOn(env))) return { ...out, notes: ['email off'] };
  const unmailed = ((await env.DB.prepare('SELECT id, email, kind, title, note, href, actor_name, created_at FROM learn_notices WHERE emailed_at IS NULL AND created_at > ? ORDER BY id').bind(new Date(now.getTime() - 3 * 86400000).toISOString()).all<{ id: number; email: string; kind: LearnKind; title: string; note: string; href: string; actor_name: string; created_at: string }>()).results || []);
  const byPerson = new Map<string, typeof unmailed>();
  for (const n of unmailed) byPerson.set(n.email, [...(byPerson.get(n.email) || []), n]);
  for (const [email, list] of byPerson) {
    if (!gate(email) || (await mailMode(env, email)) === 'off') continue;
    // Claim every row first so a second run in the same morning sends nothing.
    const mine: typeof list = [];
    for (const n of list) {
      const c = await env.DB.prepare('UPDATE learn_notices SET emailed_at = ? WHERE id = ? AND emailed_at IS NULL').bind(nowIso(), n.id).run();
      if (Number((c.meta as { changes?: number }).changes)) mine.push(n);
    }
    if (!mine.length) continue;
    const items: LearnItem[] = [];
    const seen = new Set<string>();
    for (const n of mine.slice().reverse()) {
      const key = n.href;
      if (seen.has(key)) continue;
      seen.add(key);
      const facts = await env.DB.prepare('SELECT a.due_date FROM learn_assignments a WHERE a.id = (SELECT assignment_id FROM learn_notices WHERE id = ?)').bind(n.id).first<{ due_date: string | null }>().catch(() => null);
      items.push({ kind: n.kind, title: n.title, what: n.href.startsWith('/learn/p/') ? 'path' : 'course', due_date: facts?.due_date || null, minutes: 0, lessons: 0, href: n.href, note: n.kind === 'assigned' ? n.note : '', actor: n.actor_name, at: n.created_at });
    }
    const mail = buildLearnMail({ to: { email, name: await nameOf(env, email) }, items, now });
    const ok = await send(env, { to: email, ...mail }).catch(() => false);
    if (ok) out.emails++;
    else await env.DB.prepare(`UPDATE learn_notices SET emailed_at = NULL WHERE id IN (${mine.map(() => '?').join(',')})`).bind(...mine.map((n) => n.id)).run();
  }
  return out;
}
