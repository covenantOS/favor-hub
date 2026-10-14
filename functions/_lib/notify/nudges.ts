// "Did you see this?" A person tagged on a task (mentioned, assigned, or added by someone else) who has not opened the task or
// commented on it gets a nudge on the first weekday morning 1 business day after the tag, and a second one 3 business days after.
// Then it stops. If they still have not opened it on the next business day, the person who tagged them gets one notice in FavorOS
// (which also emails them, per their choice). Nudges go out 8:00 to 10:59 AM Eastern on weekdays only.
// Writes are batched: one read of every open row, one batch to close rows, one batch to stamp the nudges sent.
import type { Env } from '../http';
import { tell } from '../projects/notices';
import { lower } from '../projects/db';
import { C, btn, esc, getPrefsMap, shell, taskFor, type MailTask } from '../projects/links/email';
import { ORIGIN, TZ, dirMap, nameOf, noticeGate, plain, short, taskUrl } from '../projects/links/shared';
import { sendMail } from './send';

export interface NudgeResult {
  closed: number;
  first: number;
  second: number;
  told: number;
  emails: number;
  note?: string;
}

interface Row {
  email: string;
  task_id: string;
  actor_email: string;
  kind: string;
  body: string;
  tagged_at: string;
  n1_at: string | null;
  n2_at: string | null;
  status: string | null;
  seen: number;
  replied: number;
}

const etDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Weekdays after day a, up to and including day b (YYYY-MM-DD, Eastern). */
export function businessDays(a: string, b: string): number {
  let n = 0;
  const end = Date.parse(b + 'T12:00:00Z');
  for (let t = Date.parse(a + 'T12:00:00Z') + 86400000; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

export function morningWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const dow = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return dow !== 'Sat' && dow !== 'Sun' && hour >= 8 && hour < 11;
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'Someone';

export interface NudgeItem {
  actor: string;
  tagged_at: string;
  note: string;
  task: MailTask;
}

/** One nudge email for one person: a single task in full, or several as a short list. */
export function buildNudge(items: NudgeItem[]): { subject: string; html: string; text: string } {
  if (items.length === 1) {
    const i = items[0];
    const line = `${first(i.actor)} tagged you in this task on ${dayLabel(i.tagged_at)}.`;
    const note = i.note && i.note !== i.task.title ? i.note : '';
    const inner =
      `<tr><td style="padding:22px 28px 0"><div style="font:400 13.5px/1.4 Arial,sans-serif;color:${C.ink2}">Did you see this? ${esc(line)}</div>` +
      `<div style="padding-top:6px;font:400 22px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${esc(i.task.title)}</div></td></tr>` +
      (note ? `<tr><td style="padding:12px 28px 0"><div style="background:${C.bg};border-radius:14px;padding:14px 16px;font:400 14px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(short(note, 700))}</div></td></tr>` : '') +
      `<tr><td style="padding:16px 28px 0">${btn(i.task.url, 'Open the task', true)}</td></tr>` +
      `<tr><td style="padding:20px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">Opening the task or replying on it stops these reminders.</div></td></tr>`;
    return {
      subject: `Did you see this? ${first(i.actor)} tagged you in ${short(i.task.title, 60)}`,
      html: shell(inner, 'Favor Projects', { t: 'Waiting on you', bg: C.sun, fg: '#7a5410' }),
      text: [`Did you see this? ${line}`, i.task.title, ...(note ? ['', short(note, 700)] : []), '', `Open the task: ${i.task.url}`, '', 'Opening the task or replying on it stops these reminders.'].join('\n'),
    };
  }
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:12px 28px 0"><div style="border:1px solid ${C.line};border-radius:16px;padding:14px 16px"><a href="${esc(i.task.url)}" style="font:400 18px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(i.task.title)}</a>` +
        `<div style="padding-top:4px;font:400 13px/1.45 Arial,sans-serif;color:${C.ink2}">${esc(first(i.actor))} tagged you on ${esc(dayLabel(i.tagged_at))}</div></div></td></tr>`
    )
    .join('');
  const inner =
    `<tr><td style="padding:22px 28px 0"><div style="font:400 22px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">Did you see these?</div><div style="padding-top:6px;font:400 14px/1.45 Arial,sans-serif;color:${C.ink2}">${items.length} tasks you were tagged in are waiting on you.</div></td></tr>` +
    rows +
    `<tr><td style="padding:16px 28px 0">${btn(`${ORIGIN}/projects/`, 'Open My tasks', true)}</td></tr>` +
    `<tr><td style="padding:20px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">Opening a task or replying on it stops these reminders.</div></td></tr>`;
  return {
    subject: `Did you see these? ${items.length} tasks are waiting on you`,
    html: shell(inner, 'Favor Projects'),
    text: ['Did you see these?', `${items.length} tasks you were tagged in are waiting on you.`, '', ...items.flatMap((i) => [`${i.task.title} (${first(i.actor)} tagged you on ${dayLabel(i.tagged_at)})`, `  ${i.task.url}`, '']), 'Opening a task or replying on it stops these reminders.'].join('\n'),
  };
}

/** The open nudge rows with what stops them. Null before db/notify.sql. */
async function openRows(env: Env): Promise<Row[] | null> {
  const r = await env.DB.prepare(
    `SELECT g.email, g.task_id, g.actor_email, g.kind, g.body, g.tagged_at, g.n1_at, g.n2_at, t.status,
            EXISTS (SELECT 1 FROM hub_task_seen s WHERE s.email = g.email AND s.task_id = g.task_id AND s.at >= g.tagged_at) AS seen,
            EXISTS (SELECT 1 FROM hub_task_comments c WHERE c.task_id = g.task_id AND lower(c.author_email) = g.email AND c.created_at >= g.tagged_at AND c.deleted_at IS NULL) AS replied
       FROM hub_task_nudges g LEFT JOIN hub_tasks t ON t.id = g.task_id
      WHERE g.done_at IS NULL ORDER BY g.tagged_at LIMIT 400`
  )
    .all<Row>()
    .catch(() => null);
  return r ? r.results || [] : null;
}

/** Open, unseen tags for one person (the morning email lists them). */
export async function waitingFor(env: Env, email: string): Promise<{ title: string; url: string; actor_email: string; tagged_at: string }[]> {
  const r = await env.DB.prepare(
    `SELECT t.id, t.code, t.title, p.key AS pkey, g.actor_email, g.tagged_at FROM hub_task_nudges g JOIN hub_tasks t ON t.id = g.task_id LEFT JOIN hub_projects p ON p.id = t.project_id
      WHERE g.email = ? AND g.done_at IS NULL AND t.status NOT IN ('done', 'dropped')
        AND NOT EXISTS (SELECT 1 FROM hub_task_seen s WHERE s.email = g.email AND s.task_id = g.task_id AND s.at >= g.tagged_at)
      ORDER BY g.tagged_at LIMIT 10`
  )
    .bind(lower(email))
    .all<{ id: string; code: string | null; title: string; pkey: string | null; actor_email: string; tagged_at: string }>()
    .catch(() => null);
  return (r?.results || []).map((x) => ({ title: x.title, url: taskUrl({ id: x.id, code: x.code }, x.pkey ? { key: x.pkey } : null, ORIGIN), actor_email: x.actor_email, tagged_at: x.tagged_at }));
}

/**
 * The pass. Closing rows runs on every call; sending runs only in the weekday morning window. Safe to run every 5 minutes: each
 * nudge is stamped, a second nudge never goes out the same Eastern day as the first, and the tagger is told once.
 */
export async function nudgePass(env: Env, now = new Date()): Promise<NudgeResult> {
  const out: NudgeResult = { closed: 0, first: 0, second: 0, told: 0, emails: 0 };
  const rows = await openRows(env);
  if (!rows) return { ...out, note: 'tables not applied' };
  if (!rows.length) return out;
  const stamp = now.toISOString();
  const close: { r: Row; why: string }[] = [];
  const live: Row[] = [];
  for (const r of rows) {
    if (r.status === 'done' || r.status === 'dropped' || r.status === null) close.push({ r, why: 'closed' });
    else if (Number(r.seen)) close.push({ r, why: 'seen' });
    else if (Number(r.replied)) close.push({ r, why: 'replied' });
    else live.push(r);
  }
  const done = (list: { r: Row; why: string }[]) =>
    list.length
      ? env.DB.batch(list.map(({ r, why }) => env.DB.prepare('UPDATE hub_task_nudges SET done_at = ?, done_why = ? WHERE email = ? AND task_id = ? AND done_at IS NULL').bind(stamp, why, r.email, r.task_id)))
      : Promise.resolve([]);
  await done(close);
  out.closed = close.length;
  if (!morningWindow(now)) return { ...out, note: 'outside the weekday morning window' };

  const today = etDate(now);
  const gate = await noticeGate(env);
  const prefs = await getPrefsMap(env, [...new Set(live.map((r) => r.email))]);
  const n1: Row[] = [];
  const n2: Row[] = [];
  const tellRows: Row[] = [];
  const off: { r: Row; why: string }[] = [];
  for (const r of live) {
    const b = businessDays(etDate(new Date(r.tagged_at)), today);
    if (!gate(r.email)) continue;
    if (prefs.get(r.email) === 'off') { off.push({ r, why: 'off' }); continue; }
    if (!r.n1_at) { if (b >= 1) n1.push(r); }
    else if (!r.n2_at) { if (b >= 3 && etDate(new Date(r.n1_at)) < today) n2.push(r); }
    else if (businessDays(etDate(new Date(r.n2_at)), today) >= 1) tellRows.push(r);
  }
  await done(off);
  out.closed += off.length;

  // Nudges: one email per person, covering every task due a nudge today.
  const dir = await dirMap(env);
  const byPerson = new Map<string, Row[]>();
  for (const r of [...n1, ...n2]) byPerson.set(r.email, [...(byPerson.get(r.email) || []), r]);
  const stamps: { r: Row; col: 'n1_at' | 'n2_at' }[] = [];
  for (const [to, list] of byPerson) {
    const items: NudgeItem[] = [];
    for (const r of list) {
      const task = await taskFor(env, r.task_id, dir);
      if (task) items.push({ actor: nameOf(dir, r.actor_email), tagged_at: r.tagged_at, note: plain(r.body, dir), task });
    }
    if (!items.length) continue;
    const mail = buildNudge(items);
    const actor = list.length === 1 ? lower(list[0].actor_email) : '';
    const ok = await sendMail(env, { to, ...mail, fromName: actor ? `${nameOf(dir, actor)} via FavorOS` : 'Favor Projects', replyTo: actor || undefined }).catch(() => false);
    if (!ok) continue;
    out.emails++;
    for (const r of list) stamps.push({ r, col: r.n1_at ? 'n2_at' : 'n1_at' });
  }
  if (stamps.length) {
    await env.DB.batch([
      ...stamps.map(({ r, col }) => env.DB.prepare(`UPDATE hub_task_nudges SET ${col} = ? WHERE email = ? AND task_id = ?`).bind(stamp, r.email, r.task_id)),
      ...stamps.map(({ r }) => env.DB.prepare(`INSERT OR IGNORE INTO hub_task_mail_log (notice_id, email, mode, state, at) VALUES (?, ?, 'nudge', 'sent', ?)`).bind(`ndg_${r.task_id}_${r.email}_${stamp}`, r.email, stamp)),
    ]);
    out.first = stamps.filter((s) => s.col === 'n1_at').length;
    out.second = stamps.filter((s) => s.col === 'n2_at').length;
  }

  // Still unseen a business day after the second nudge: the tagger hears once, in FavorOS (and by email per their choice).
  for (const r of tellRows) {
    const who = nameOf(dir, r.email);
    await tell(env, r.task_id, 'system', [{ email: r.actor_email, kind: 'unseen', body: `${who} has not opened this since you tagged them on ${dayLabel(r.tagged_at)}. Two reminders went out.` }]);
  }
  if (tellRows.length) {
    await env.DB.batch(tellRows.map((r) => env.DB.prepare(`UPDATE hub_task_nudges SET told_at = ?, done_at = ?, done_why = 'told' WHERE email = ? AND task_id = ?`).bind(stamp, stamp, r.email, r.task_id)));
    out.told = tellRows.length;
  }
  return out;
}
