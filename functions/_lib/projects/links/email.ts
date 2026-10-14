// Project email, in Favor's look (the same card, colors and buttons as the meeting reminder in meetcal.ts and the request notices).
// Three locks sit in front of every send:
//   1. the notice gate (requests.notify and requests.notify.only), checked here again, so an address the gate refuses is never mailed;
//   2. the admin switch projects.email (on unless an admin turns it off);
//   3. the person's own choice in hub_project_prefs: now (one email per notice), daily (a summary each weekday morning) or off.
// hub_task_mail_log takes a row per notice before the send, so one notice is never emailed twice. Only notices made in the last
// 15 minutes go out as "now" mail and only the last day's go into a summary: nothing older than the change that made it is mailed.
import { holdIfQuiet } from '../../quiet';
import { isBlocked } from '../../blocked';
import { nowIso, type Env } from '../../http';
import { effective } from '../../admin/settings';
import { staffDirectory, type Person } from '../../people';
import { lower } from '../db';
import { dueSoonSweep } from '../notices';
import { sendMail } from '../../notify/send';
import { ORIGIN, TZ, dirMap, dueLabel, nameOf, noticeGate, plain, short, STATUS_WORD, taskUrl, todayEt, addDays } from './shared';

export type MailMode = 'now' | 'daily' | 'off';
const MODES: MailMode[] = ['now', 'daily', 'off'];
const FRESH_MS = 15 * 60_000;

export interface Outbox {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/* ------------------------------------------------------------------------------------------------ choices */

export async function getPrefs(env: Env, email: string): Promise<{ mail_mode: MailMode; calendar: boolean }> {
  const row = await env.DB.prepare('SELECT mail_mode, calendar FROM hub_project_prefs WHERE email = ?').bind(lower(email)).first<{ mail_mode: string; calendar: number }>().catch(() => null);
  return { mail_mode: MODES.includes(row?.mail_mode as MailMode) ? (row!.mail_mode as MailMode) : 'now', calendar: row ? !!row.calendar : true };
}

/** Each listed person's email choice (no row means now), in one read. */
export async function getPrefsMap(env: Env, emails: string[]): Promise<Map<string, MailMode>> {
  const out = new Map<string, MailMode>();
  if (!emails.length) return out;
  const r = await env.DB.prepare(`SELECT email, mail_mode FROM hub_project_prefs WHERE email IN (${emails.map(() => '?').join(',')})`).bind(...emails.map(lower)).all<{ email: string; mail_mode: string }>().catch(() => null);
  for (const x of r?.results || []) if (MODES.includes(x.mail_mode as MailMode)) out.set(lower(x.email), x.mail_mode as MailMode);
  return out;
}

export async function setPrefs(env: Env, email: string, b: { mail_mode?: unknown; calendar?: unknown }): Promise<{ mail_mode: MailMode; calendar: boolean }> {
  const cur = await getPrefs(env, email);
  const mode = b.mail_mode === undefined ? cur.mail_mode : MODES.find((m) => m === b.mail_mode);
  if (!mode) throw new Error('bad_mode');
  const cal = b.calendar === undefined ? cur.calendar : b.calendar === true;
  await env.DB.prepare(
    `INSERT INTO hub_project_prefs (email, mail_mode, calendar, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET mail_mode = excluded.mail_mode, calendar = excluded.calendar, updated_at = excluded.updated_at`
  ).bind(lower(email), mode, cal ? 1 : 0, nowIso()).run();
  return { mail_mode: mode, calendar: cal };
}

export async function emailOn(env: Env): Promise<boolean> {
  const v = lower(await effective(env, 'projects.email', undefined, 'on').catch(() => 'on'));
  if (v === 'off') return false;
  try {
    await env.DB.prepare('SELECT notice_id FROM hub_task_mail_log LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------ the look */

const LOGO = `${ORIGIN}/images/favor-icon.png`;
export const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24', leaf: '#e6efdc', sun: '#fbe9c6', sky: '#e1edf5', red: '#b3412b' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const initials = (n: string) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export type NoticeKind = 'assigned' | 'mentioned' | 'followed' | 'comment' | 'waiting' | 'due_soon' | 'done' | 'unseen';
/** The kinds that tag a person: these mail at once (the first one even past an email choice) and get nudges. */
export const TAG_KINDS: NoticeKind[] = ['mentioned', 'assigned', 'followed'];
export interface MailTask {
  id: string;
  code: string | null;
  title: string;
  status: string;
  owner: string;
  due_date: string | null;
  due_time: string | null;
  project: string;
  url: string;
}

const HEAD: Record<NoticeKind, (actor: string) => { pill: string; bg: string; fg: string; line: string; subject: (t: string) => string }> = {
  assigned: (a) => ({ pill: 'Assigned to you', bg: C.leaf, fg: C.green, line: `${first(a)} gave you a task`, subject: (t) => `${first(a)} gave you a task: ${t}` }),
  mentioned: (a) => ({ pill: 'Tagged', bg: C.sky, fg: '#25506d', line: `${first(a)} tagged you`, subject: (t) => `${first(a)} tagged you in ${t}` }),
  followed: (a) => ({ pill: 'Added', bg: C.sky, fg: '#25506d', line: `${first(a)} added you to a task`, subject: (t) => `${first(a)} added you to ${t}` }),
  unseen: () => ({ pill: 'Not opened', bg: C.sun, fg: '#7a5410', line: 'Not opened yet', subject: (t) => `Not opened yet: ${t}` }),
  comment: (a) => ({ pill: 'New comment', bg: C.sky, fg: '#25506d', line: `${first(a)} commented`, subject: (t) => `${first(a)} commented on ${t}` }),
  waiting: (a) => ({ pill: 'Waiting on you', bg: C.sun, fg: '#7a5410', line: `${first(a)} is waiting on you`, subject: (t) => `Waiting on you: ${t}` }),
  due_soon: () => ({ pill: 'Due soon', bg: C.sun, fg: '#7a5410', line: 'A task of yours is due', subject: (t) => `Due soon: ${t}` }),
  done: (a) => ({ pill: 'Finished', bg: C.leaf, fg: C.green, line: `${first(a)} finished a task`, subject: (t) => `Finished: ${t}` }),
};

export const btn = (href: string, text: string, primary: boolean) =>
  primary
    ? `<a href="${esc(href)}" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">${esc(text)} &rarr;</a>`
    : `<a href="${esc(href)}" style="display:inline-block;white-space:nowrap;margin:0 8px 8px 0;padding:10px 14px;border:1px solid ${C.line};border-radius:12px;background:#ffffff;font:600 13px/1 Arial,sans-serif;color:${C.ink};text-decoration:none">${esc(text)}</a>`;

const chip = (t: string) => `<span style="display:inline-block;white-space:nowrap;margin:0 6px 6px 0;padding:7px 11px;border-radius:999px;background:${C.bg};font:400 13px/1.2 Arial,sans-serif;color:${C.ink2}">${esc(t)}</span>`;

export function shell(inner: string, label: string, pill?: { t: string; bg: string; fg: string }): string {
  return (
    `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:${C.bg}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;border-collapse:separate">` +
    `<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:600 13px/1 Arial,sans-serif;color:${C.ink3}"><img src="${LOGO}" alt="" width="28" height="24" style="vertical-align:middle;border:0" />&nbsp; ${esc(label)}</td>` +
    (pill ? `<td align="right"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${pill.bg};color:${pill.fg};font:700 12px/1 Arial,sans-serif">${esc(pill.t)}</span></td>` : '') +
    `</tr></table></td></tr>${inner}</table></td></tr></table></body></html>`
  );
}

export interface NoticeMail {
  kind: NoticeKind;
  to: { name: string; email: string };
  actor: { name: string; picture?: string };
  task: MailTask;
  note: string;
  origin?: string;
}

/** One notice as an email: the actor, the task and where it stands as chips, the note, one Open button. */
export function buildNotice(m: NoticeMail): { subject: string; html: string; text: string } {
  const h = HEAD[m.kind](m.actor.name);
  const t = m.task;
  const due = t.due_date ? dueLabel(t.due_date, t.due_time) : '';
  const chips = [t.code || '', t.project, STATUS_WORD[t.status] || t.status, t.owner ? `Owner ${t.owner}` : '', due ? `Due ${due}` : ''].filter(Boolean);
  const note = m.note && m.kind !== 'due_soon' && m.kind !== 'done' ? m.note : '';
  const inner =
    `<tr><td style="padding:22px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="top" style="padding:0 12px 0 0"><span style="display:inline-block;width:40px;height:40px;border-radius:999px;background:${C.leaf};color:${C.green};font:700 14px/40px Arial,sans-serif;text-align:center">${esc(initials(m.actor.name))}</span></td>` +
    `<td valign="middle"><div style="font:400 13.5px/1.4 Arial,sans-serif;color:${C.ink2}">${esc(h.line)}</div>` +
    `<div style="padding-top:4px;font:400 22px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${esc(t.title)}</div></td></tr></table></td></tr>` +
    `<tr><td style="padding:14px 28px 0;font-size:0">${chips.map(chip).join('')}</td></tr>` +
    (note ? `<tr><td style="padding:12px 28px 0"><div style="background:${C.bg};border-radius:14px;padding:14px 16px;font:400 14px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(short(note, 700))}</div></td></tr>` : '') +
    `<tr><td style="padding:16px 28px 0">${btn(t.url, 'Open the task', true)}</td></tr>` +
    `<tr><td style="padding:20px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">Change how you get project email from the bell in FavorOS.</div></td></tr>`;
  const text = [h.line, t.title, chips.join(' · '), ...(note ? ['', short(note, 700)] : []), '', `Open the task: ${t.url}`].join('\n');
  return { subject: h.subject(short(t.title, 70)), html: shell(inner, 'Favor Projects', { t: h.pill, bg: h.bg, fg: h.fg }), text };
}

export interface SummaryItem {
  kind: NoticeKind;
  actor: string;
  note: string;
  task: MailTask;
}

/** The daily summary: a day's notices grouped by task. */
export function buildSummary(m: { to: { name: string; email: string }; items: SummaryItem[]; origin?: string; now?: Date }): { subject: string; html: string; text: string } {
  const groups = new Map<string, { task: MailTask; lines: string[] }>();
  for (const i of m.items) {
    const g = groups.get(i.task.id) || { task: i.task, lines: [] };
    const h = HEAD[i.kind](i.actor);
    g.lines.push(i.kind === 'due_soon' ? `Due ${i.task.due_date ? dueLabel(i.task.due_date, i.task.due_time) : 'soon'}` : `${h.line}${i.note && i.kind !== 'done' ? ': ' + short(i.note, 120) : ''}`);
    groups.set(i.task.id, g);
  }
  const list = [...groups.values()];
  const day = (m.now || new Date()).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const rows = list.map((g) =>
    `<tr><td style="padding:14px 28px 0"><div style="border:1px solid ${C.line};border-radius:16px;padding:14px 16px"><a href="${esc(g.task.url)}" style="font:400 18px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(g.task.title)}</a>` +
    `<div style="padding-top:4px;font:400 12.5px/1.4 Arial,sans-serif;color:${C.ink3}">${esc([g.task.code, g.task.project].filter(Boolean).join(' · '))}</div>` +
    g.lines.slice(0, 4).map((l) => `<div style="padding-top:6px;font:400 14px/1.5 Arial,sans-serif;color:${C.ink2}">${esc(l)}</div>`).join('') +
    `</div></td></tr>`
  ).join('');
  const inner =
    `<tr><td style="padding:22px 28px 0"><div style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${list.length === 1 ? '1 task has news' : `${list.length} tasks have news`}</div><div style="padding-top:6px;font:400 14px/1.45 Arial,sans-serif;color:${C.ink2}">${esc(day)}</div></td></tr>` +
    rows +
    `<tr><td style="padding:16px 28px 0">${btn(`${ORIGIN}/projects/`, 'Open My tasks', true)}</td></tr><tr><td style="padding:20px 28px 24px"></td></tr>`;
  const text = [`${list.length === 1 ? '1 task has news' : `${list.length} tasks have news`} (${day})`, '', ...list.flatMap((g) => [`${g.task.title} (${[g.task.code, g.task.project].filter(Boolean).join(', ')})`, ...g.lines.map((l) => `  ${l}`), `  ${g.task.url}`, ''])].join('\n');
  return { subject: list.length === 1 ? `Task news: ${short(list[0].task.title, 60)}` : `${list.length} tasks have news`, html: shell(inner, 'Favor Projects'), text };
}

/* ------------------------------------------------------------------------------------------------ sending */

export async function send(env: Env, m: Outbox & { fromName?: string; replyTo?: string }): Promise<boolean> {
  if (await isBlocked(env, m.to)) return false; // sendMail checks too; this keeps the rule visible at the call site
  return sendMail(env, { ...m, fromName: m.fromName || 'Favor Projects' });
}

async function lock(env: Env, id: string, email: string, mode: string): Promise<boolean> {
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO hub_task_mail_log (notice_id, email, mode, state, at) VALUES (?, ?, ?, 'sending', ?)`).bind(id, email, mode, nowIso()).run();
  return Number((r.meta as { changes?: number }).changes) > 0;
}
const settle = (env: Env, ids: string[], ok: boolean) =>
  ids.length ? env.DB.prepare(`UPDATE hub_task_mail_log SET state = ? WHERE notice_id IN (${ids.map(() => '?').join(',')})`).bind(ok ? 'sent' : 'failed', ...ids).run() : Promise.resolve(null);

interface NoticeRow {
  id: string;
  email: string;
  task_id: string;
  kind: NoticeKind;
  actor_email: string;
  body: string;
  created_at: string;
}

export async function taskFor(env: Env, id: string, dir: Map<string, Person>): Promise<MailTask | null> {
  const r = await env.DB.prepare(
    `SELECT t.id, t.code, t.title, t.status, t.owner_email, t.due_date, t.due_time, p.key AS pkey, p.name AS pname FROM hub_tasks t LEFT JOIN hub_projects p ON p.id = t.project_id WHERE t.id = ?`
  ).bind(id).first<{ id: string; code: string | null; title: string; status: string; owner_email: string | null; due_date: string | null; due_time: string | null; pkey: string | null; pname: string | null }>().catch(() => null);
  if (!r) return null;
  return {
    id: r.id, code: r.code, title: r.title, status: r.status, owner: nameOf(dir, r.owner_email), due_date: r.due_date, due_time: r.due_time, project: r.pname || '',
    url: taskUrl(r, r.pkey ? { key: r.pkey } : null, ORIGIN),
  };
}

const actorName = (dir: Map<string, Person>, email: string) => (email === 'system' || !email ? 'Favor Projects' : nameOf(dir, email));

const HOLD_MS = 3 * 60_000;
const RANK: Record<string, number> = { mentioned: 0, assigned: 1, followed: 2, waiting: 3, comment: 4, unseen: 5, done: 6, due_soon: 7 };

/** People who have opened a task in FavorOS, or been sent a project email, among those given. */
async function knownPeople(env: Env, emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!emails.length) return out;
  const ph = emails.map(() => '?').join(',');
  const r = await env.DB.prepare(
    `SELECT email FROM hub_task_seen WHERE email IN (${ph}) UNION SELECT email FROM hub_task_mail_log WHERE email IN (${ph})`
  ).bind(...emails, ...emails).all<{ email: string }>().catch(() => null);
  if (!r) {
    // Before db/notify.sql: only the mail log counts.
    const m = await env.DB.prepare(`SELECT DISTINCT email FROM hub_task_mail_log WHERE email IN (${ph})`).bind(...emails).all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }));
    for (const x of m.results || []) out.add(lower(x.email));
    return out;
  }
  for (const x of r.results || []) out.add(lower(x.email));
  return out;
}

/**
 * Emails notices made in the last 15 minutes. Called after every task change and by the 5-minute cron; the log row makes a second
 * call harmless. A burst is one email: once a person has had a project email, anything newer waits until 3 minutes have passed
 * since it and then goes out together. Tags (mentioned, assigned, added) go to people who chose one email per notice, and the
 * first one also reaches a person who has never opened Projects, whatever their choice. Returns how many emails went out.
 */
export async function mailFresh(env: Env, now = new Date()): Promise<number> {
  if (!(await emailOn(env))) return 0;
  const rows =
    (
      await env.DB.prepare(
        `SELECT n.id, n.email, n.task_id, n.kind, n.actor_email, n.body, n.created_at FROM hub_task_notices n
          WHERE n.read_at IS NULL AND n.created_at > ? AND NOT EXISTS (SELECT 1 FROM hub_task_mail_log l WHERE l.notice_id = n.id) ORDER BY n.created_at LIMIT 100`
      ).bind(new Date(now.getTime() - FRESH_MS).toISOString()).all<NoticeRow>().catch(() => ({ results: [] as NoticeRow[] }))
    ).results || [];
  if (!rows.length) return 0;
  const gate = await noticeGate(env);
  const byPerson = new Map<string, NoticeRow[]>();
  for (const n of rows) {
    const to = lower(n.email);
    if (!gate(to) || to === lower(n.actor_email)) continue;
    byPerson.set(to, [...(byPerson.get(to) || []), n]);
  }
  if (!byPerson.size) return 0;
  const emails = [...byPerson.keys()];
  const ph = emails.map(() => '?').join(',');
  const prefRows = (await env.DB.prepare(`SELECT email, mail_mode FROM hub_project_prefs WHERE email IN (${ph})`).bind(...emails).all<{ email: string; mail_mode: string }>().catch(() => ({ results: [] as { email: string; mail_mode: string }[] }))).results || [];
  const mode = new Map(prefRows.map((r) => [lower(r.email), r.mail_mode]));
  const recent = (await env.DB.prepare(`SELECT email, MAX(at) AS at FROM hub_task_mail_log WHERE email IN (${ph}) AND mode IN ('now', 'nudge') AND at > ? GROUP BY email`).bind(...emails, new Date(now.getTime() - HOLD_MS).toISOString()).all<{ email: string; at: string }>().catch(() => ({ results: [] as { email: string; at: string }[] }))).results || [];
  const held = new Set(recent.map((r) => lower(r.email)));
  const known = await knownPeople(env, emails);
  const dir = await dirMap(env);
  let sent = 0;
  for (const [to, list] of byPerson) {
    if (held.has(to)) continue; // the next pass sends these together
    const m = (mode.get(to) as MailMode) || 'now';
    const firstTag = !known.has(to) && list.some((n) => TAG_KINDS.includes(n.kind));
    const mine = m === 'now' ? list : firstTag ? list.filter((n) => TAG_KINDS.includes(n.kind)) : [];
    if (!mine.length) continue;
    const locks = await env.DB.batch(mine.map((n) => env.DB.prepare(`INSERT OR IGNORE INTO hub_task_mail_log (notice_id, email, mode, state, at) VALUES (?, ?, 'now', 'sending', ?)`).bind(n.id, to, nowIso())));
    const got = mine.filter((_n, i) => Number((locks[i]?.meta as { changes?: number } | undefined)?.changes) > 0);
    if (!got.length) continue;
    const tasks = new Map<string, MailTask>();
    for (const id of new Set(got.map((n) => n.task_id))) {
      const t = await taskFor(env, id, dir);
      if (t) tasks.set(id, t);
    }
    const live = got.filter((n) => tasks.has(n.task_id));
    if (!live.length) { await settle(env, got.map((n) => n.id), false); continue; }
    live.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || a.created_at.localeCompare(b.created_at));
    const lead = live[0];
    const actorEmail = lower(lead.actor_email);
    const actor = actorName(dir, actorEmail);
    let mail: { subject: string; html: string; text: string };
    if (tasks.size === 1) {
      // One task: the most important notice leads; the other notes (a burst of comments) follow it in order.
      const notes = [...new Set(live.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map((n) => plain(n.body, dir)).filter((x) => x && x !== tasks.get(lead.task_id)!.title))];
      mail = buildNotice({ kind: lead.kind, to: { email: to, name: nameOf(dir, to) }, actor: { name: actor }, task: tasks.get(lead.task_id)!, note: notes.join('\n\n') });
    } else {
      mail = buildSummary({ to: { email: to, name: nameOf(dir, to) }, items: live.map((n) => ({ kind: n.kind, actor: actorName(dir, lower(n.actor_email)), note: plain(n.body, dir), task: tasks.get(n.task_id)! })), now });
    }
    const person = TAG_KINDS.includes(lead.kind) && FAVOR_MAIL.test(actorEmail);
    // Quiet hours (quiet.ts): held for the morning summary instead.
    if (await holdIfQuiet(env, to, { kind: 'project', title: `${actor}: ${tasks.get(lead.task_id)!.title}`, body: plain(lead.body, dir).slice(0, 200), url: tasks.get(lead.task_id)!.url }, now).catch(() => false)) {
      await env.DB.prepare(`UPDATE hub_task_mail_log SET state = 'held' WHERE notice_id IN (${got.map(() => '?').join(',')})`).bind(...got.map((n) => n.id)).run();
      continue;
    }
    const ok = await send(env, { to, ...mail, ...(person ? { fromName: `${actor} via FavorOS`, replyTo: actorEmail } : {}) }).catch(() => false);
    await settle(env, got.map((n) => n.id), ok);
    if (ok) sent++;
  }
  return sent;
}
const FAVOR_MAIL = /^[a-z0-9._%+-]+@favorintl\.org$/;

export interface DailyResult { day: string; due: number; summaries: number; notes: string[] }

/**
 * The weekday morning pass (the Work Center's digest cron calls it): due-soon notices for tasks due today or tomorrow, then one
 * summary for each person who chose the daily summary and has unread, unmailed notices from the last day. Nothing before 8:00 AM
 * Eastern or on a weekend.
 */
export async function dailyPass(env: Env, now = new Date()): Promise<DailyResult> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const dow = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const today = todayEt(now);
  const out: DailyResult = { day: today, due: 0, summaries: 0, notes: [] };
  if (dow === 'Sat' || dow === 'Sun') return { ...out, notes: ['weekend'] };
  if (hour < 8) return { ...out, notes: ['before 8:00 AM'] };
  try {
    out.due = await dueSoonSweep(env, today, addDays(today, 1));
  } catch {
    return { ...out, notes: ['tables not applied'] };
  }
  if (!(await emailOn(env))) return { ...out, notes: ['email off'] };
  const gate = await noticeGate(env);
  const dir = await dirMap(env);
  // Due-soon notices made just now go out as "now" mail for people who chose that; the rest wait for their summary.
  await mailFresh(env, now);
  const people = (await env.DB.prepare(`SELECT email FROM hub_project_prefs WHERE mail_mode = 'daily'`).all<{ email: string }>()).results || [];
  for (const p of people) {
    const email = lower(p.email);
    if (!gate(email)) continue;
    const rows =
      (
        await env.DB.prepare(
          `SELECT n.id, n.email, n.task_id, n.kind, n.actor_email, n.body, n.created_at FROM hub_task_notices n
            WHERE n.email = ? AND n.read_at IS NULL AND n.created_at > ? AND NOT EXISTS (SELECT 1 FROM hub_task_mail_log l WHERE l.notice_id = n.id) ORDER BY n.created_at`
        ).bind(email, new Date(now.getTime() - 86400000).toISOString()).all<NoticeRow>()
      ).results || [];
    const mine: NoticeRow[] = [];
    for (const r of rows) if (await lock(env, r.id, email, 'daily')) mine.push(r);
    if (!mine.length) continue;
    const items: SummaryItem[] = [];
    for (const r of mine) {
      const task = await taskFor(env, r.task_id, dir);
      if (task) items.push({ kind: r.kind, actor: actorName(dir, lower(r.actor_email)), note: plain(r.body, dir), task });
    }
    if (!items.length) { await settle(env, mine.map((r) => r.id), false); continue; }
    const mail = buildSummary({ to: { email, name: nameOf(dir, email) }, items, now });
    const ok = await send(env, { to: email, ...mail }).catch(() => false);
    await settle(env, mine.map((r) => r.id), ok);
    if (ok) out.summaries++;
  }
  return out;
}

export { staffDirectory };
