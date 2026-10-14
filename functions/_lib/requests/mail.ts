// Sending request email. Three locks sit in front of every send:
//   1. the notice gate (requests.notify and requests.notify.only), checked again here, so an address the gate refuses can
//      never be mailed whatever called this;
//   2. the admin switch requests.email (on unless an admin turns it off);
//   3. the person's own choice in request_email_prefs: now (one email per event), daily (a summary each weekday morning) or off.
// request_email_log takes a row per notice before the send, so one notice is never emailed twice. The person who acted gets no
// notice, so they get no email. Before db/request-email.sql is applied nothing is sent.
import { holdIfQuiet } from '../quiet';
import { nowIso, type Env } from '../http';
import { effective } from '../admin/settings';
import { getRequest } from '../db';
import { staffDirectory, type Person } from '../people';
import { buildNotice, buildSummary, type MailEntry, type MailKind, type MailRequest, type SummaryGroup } from './email';
import { commentsOf, noticeGate, taskOf, tellPeople, type Actor, type TaskEnv } from './tasks';
import { plainMentions } from './views';

export type MailMode = 'now' | 'daily' | 'off';
const MODES: MailMode[] = ['now', 'daily', 'off'];
const ORIGIN = 'https://dash.favorintl.org';
const TZ = 'America/New_York';
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export async function mailMode(env: Env, email: string): Promise<MailMode> {
  const row = await env.DB.prepare('SELECT mode FROM request_email_prefs WHERE email = ?').bind(lower(email)).first<{ mode: string }>().catch(() => null);
  return MODES.includes(row?.mode as MailMode) ? (row!.mode as MailMode) : 'now';
}

export async function setMailMode(env: Env, email: string, mode: unknown): Promise<MailMode> {
  const m = MODES.find((x) => x === mode);
  if (!m) throw new Error('bad_mode');
  await env.DB.prepare(
    'INSERT INTO request_email_prefs (email, mode, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at'
  )
    .bind(lower(email), m, nowIso())
    .run();
  return m;
}

/** The admin switch and whether the tables are there. */
export async function emailOn(env: Env): Promise<boolean> {
  const v = lower(await effective(env, 'requests.email', undefined, 'on').catch(() => 'on'));
  if (v === 'off') return false;
  try {
    await env.DB.prepare('SELECT notice_id FROM request_email_log LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export interface Outbox {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The display name on the From line. Request email when empty. */
  fromName?: string;
}

/** Sends through Resend, the sender the hub already uses. Returns false when there is no key or the send failed. */
export async function send(env: Env, m: Outbox): Promise<boolean> {
  const hook = (env as unknown as { MAIL_HOOK?: (m: Outbox) => Promise<boolean> | boolean }).MAIL_HOOK;
  if (hook) return !!(await hook(m)); // tests collect the mail here; nothing leaves the process
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[requests] RESEND_API_KEY missing; request email skipped');
    return false;
  }
  const from = (env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>').replace(/^[^<]*</, (m.fromName || 'Favor Requests') + ' <');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) console.error('[requests] email failed', res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

/** Takes the once-only row for a notice. False when another pass already has it. */
async function lock(env: Env, noticeId: number, email: string, mode: string): Promise<boolean> {
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO request_email_log (notice_id, email, mode, state, at) VALUES (?, ?, ?, 'sending', ?)`).bind(noticeId, email, mode, nowIso()).run();
  return Number((r.meta as { changes?: number }).changes) > 0;
}
const settle = (env: Env, ids: number[], ok: boolean) =>
  ids.length ? env.DB.prepare(`UPDATE request_email_log SET state = ? WHERE notice_id IN (${ids.map(() => '?').join(',')})`).bind(ok ? 'sent' : 'failed', ...ids).run() : Promise.resolve(null);

function dueWord(date: string, now = new Date()): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  return date < today ? 'and late' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

async function requestFor(env: Env, id: string, dir: Map<string, Person>): Promise<MailRequest | null> {
  const row = await getRequest(env, id);
  if (!row) return null;
  const t = await taskOf(env, id);
  const name = (e?: string | null) => (e ? dir.get(e)?.name || e.split('@')[0] : '');
  return { id, title: row.title, status: row.status, owner: name(t?.owner_email), due_date: t?.due_date || null, waiting_on: name(t?.waiting_on) };
}

const personOf = (dir: Map<string, Person>, email: string, fallback = '') => ({ name: dir.get(lower(email))?.name || fallback || lower(email).split('@')[0] || 'Favor Requests', picture: dir.get(lower(email))?.picture || '' });

/** Called right after notices are written: emails the people who chose one email per event. */
export async function mailNotices(env: TaskEnv, requestId: string, actor: Actor, made: Array<{ id: number; email: string; kind: MailKind; note: string }>): Promise<number> {
  if (!made.length || !(await emailOn(env))) return 0;
  const gate = await noticeGate(env);
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const request = await requestFor(env, requestId, dir);
  if (!request) return 0;
  const comments = (await commentsOf(env, requestId)).filter((c) => !c.deleted_at);
  let sent = 0;
  for (const n of made) {
    if (!gate(n.email) || n.email === actor.email) continue;
    if ((await mailMode(env, n.email)) !== 'now') continue;
    if (!(await lock(env, n.id, n.email, 'now'))) continue;
    // Quiet hours (quiet.ts): held for the morning summary instead.
    if (await holdIfQuiet(env, n.email, { kind: 'request', title: `${personOf(dir, actor.email, actor.name).name}: ${request.title}`, body: (n.kind === 'due' ? '' : plainMentions(n.note, dir)).slice(0, 200), url: `/requests/?r=${encodeURIComponent(requestId)}` }, env.CLOCK || new Date()).catch(() => false)) {
      await env.DB.prepare(`UPDATE request_email_log SET state = 'held' WHERE notice_id = ?`).bind(n.id).run();
      continue;
    }
    // The thread before this entry: every comment but the one this notice is about.
    const noteText = n.kind === 'due' ? '' : plainMentions(n.note, dir);
    const earlier: MailEntry[] = comments
      .filter((c) => c.body !== n.note)
      .slice(-2)
      .map((c) => ({ who: personOf(dir, c.email, c.name), body: plainMentions(c.body, dir), at: c.created_at }));
    const mail = buildNotice({
      kind: n.kind,
      to: { email: n.email, name: dir.get(n.email)?.name || n.email },
      actor: personOf(dir, actor.email, actor.name),
      request,
      note: noteText,
      thread: earlier,
      origin: ORIGIN,
      dueWord: n.kind === 'due' ? dueWord(n.note, env.CLOCK) : undefined,
      now: env.CLOCK,
    });
    const ok = await send(env, { to: n.email, ...mail }).catch(() => false);
    await settle(env, [n.id], ok);
    if (ok) sent++;
  }
  return sent;
}

export interface DailyResult {
  day: string;
  due: number;
  summaries: number;
  notes: string[];
}

/**
 * The weekday morning pass (the Work Center's digest cron calls it): a "due" notice for the owner of each open request due
 * today or tomorrow, once per due date, then one summary email for each person who chose the daily summary and has
 * something unread that was never emailed. Nothing before 8:00 AM Eastern or on a weekend.
 */
export async function dailyPass(base: TaskEnv, now = new Date()): Promise<DailyResult> {
  const env: TaskEnv = Object.assign(Object.create(base) as TaskEnv, { CLOCK: now });
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const dow = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const out: DailyResult = { day: today, due: 0, summaries: 0, notes: [] };
  if (dow === 'Sat' || dow === 'Sun') return { ...out, notes: ['weekend'] };
  if (hour < 8) return { ...out, notes: ['before 8:00 AM'] };
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  let due: Array<{ request_id: string; owner_email: string; due_date: string }> = [];
  try {
    due = (
      await env.DB.prepare(
        `SELECT t.request_id, t.owner_email, t.due_date FROM request_tasks t JOIN requests q ON q.id = t.request_id
          WHERE t.owner_email IS NOT NULL AND t.due_date IN (?, ?) AND q.status NOT IN ('done', 'declined')
            AND NOT EXISTS (SELECT 1 FROM request_notices n WHERE n.request_id = t.request_id AND n.email = t.owner_email AND n.kind = 'due' AND n.note = t.due_date)`
      )
        .bind(today, tomorrow)
        .all<{ request_id: string; owner_email: string; due_date: string }>()
    ).results || [];
  } catch {
    return { ...out, notes: ['tables not applied'] };
  }
  const system: Actor = { email: '', name: 'Favor Requests', admin: false };
  for (const d of due) out.due += (await tellPeople(env, d.request_id, system, [{ email: d.owner_email, kind: 'due', note: d.due_date }])).length;

  if (!(await emailOn(env))) return { ...out, notes: ['email off'] };
  const gate = await noticeGate(env);
  const dir = new Map((await staffDirectory(env)).map((p) => [p.email, p]));
  const people = (await env.DB.prepare(`SELECT email, updated_at FROM request_email_prefs WHERE mode = 'daily'`).all<{ email: string; updated_at: string }>()).results || [];
  for (const p of people) {
    const email = lower(p.email);
    if (!gate(email)) continue;
    const rows =
      (
        await env.DB.prepare(
          `SELECT n.id, n.request_id, n.kind, n.actor_email, n.actor_name, n.note, n.created_at FROM request_notices n
            WHERE n.email = ? AND n.read_at IS NULL AND n.created_at > ? AND n.id NOT IN (SELECT notice_id FROM request_email_log) ORDER BY n.id`
        )
          // Nothing from before the person chose the summary, and nothing older than a week: old events never fire.
          .bind(email, [new Date(now.getTime() - 7 * 86400000).toISOString(), p.updated_at || ''].sort().pop())
          .all<{ id: number; request_id: string; kind: MailKind; actor_email: string; actor_name: string; note: string; created_at: string }>()
      ).results || [];
    const mine: typeof rows = [];
    for (const r of rows) if (await lock(env, r.id, email, 'daily')) mine.push(r);
    if (!mine.length) continue;
    const groups = new Map<string, SummaryGroup>();
    for (const r of mine) {
      let g = groups.get(r.request_id);
      if (!g) {
        const request = await requestFor(env, r.request_id, dir);
        if (!request) continue;
        g = { request, items: [] };
        groups.set(r.request_id, g);
      }
      g.items.push({ kind: r.kind, actor: personOf(dir, r.actor_email, r.actor_name), note: r.kind === 'due' ? '' : plainMentions(r.note, dir), at: r.created_at, dueWord: r.kind === 'due' ? dueWord(r.note, now) : undefined });
    }
    if (!groups.size) continue;
    const mail = buildSummary({ to: { email, name: dir.get(email)?.name || email }, groups: [...groups.values()].reverse(), origin: ORIGIN, now });
    const ok = await send(env, { to: email, ...mail }).catch(() => false);
    await settle(env, mine.map((r) => r.id), ok);
    if (ok) out.summaries++;
  }
  return out;
}
