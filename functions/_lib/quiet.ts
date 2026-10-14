// Quiet hours (Will, 2026-10-14). On for everyone unless they turn it off: 8 PM to 7 AM in the person's own time zone, Eastern when
// none is saved. During quiet hours a phone push or a notice email for that person is held in hub_quiet_held instead of sent. The bell
// still records everything, because the bell reads the notice tables, which are written as before. When the person's quiet hours end,
// the 5-minute work drain sends one summary email and one push covering what was held (deliverHeld).
// An admin's @here in Chat goes through at once. Weekends: off by default; on, Saturday and Sunday are quiet all day.
// Each person changes their hours, the weekend option or turns it off in Settings (GET and POST /api/hub/quiet).
// Before db/quiet-hours.sql is applied, nobody is ever quiet.
import { nowIso, type Env } from './http';
import { isTester } from './testuser';

export type QuietEnv = Pick<Env, 'DB'> & Partial<Env>;

export interface QuietPrefs {
  on: boolean;
  /** Minutes after local midnight. */
  start: number;
  end: number;
  weekends: boolean;
  tz: string;
  /** True when the person saved their own answer. */
  saved: boolean;
}

export const QUIET_DEFAULT = { on: true, start: 20 * 60, end: 7 * 60, weekends: false };
const EASTERN = 'America/New_York';
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export function validTz(tz: unknown): string {
  const t = String(tz || '').trim();
  if (!t) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t });
    return t;
  } catch {
    return '';
  }
}

/** The local minute of the day and weekday (0 Sunday) for one instant in one time zone. */
export function localClock(now: Date, tz: string): { min: number; dow: number; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) || EASTERN, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { min: (Number(get('hour')) % 24) * 60 + Number(get('minute')), dow, day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** True when these hours hold the instant. Pure, so tests cover it directly. */
export function inQuiet(p: Pick<QuietPrefs, 'on' | 'start' | 'end' | 'weekends' | 'tz'>, now: Date): boolean {
  if (!p.on) return false;
  const { min, dow } = localClock(now, p.tz);
  if (p.weekends && (dow === 0 || dow === 6)) return true;
  if (p.start === p.end) return false;
  return p.start > p.end ? min >= p.start || min < p.end : min >= p.start && min < p.end;
}

async function ready(env: QuietEnv): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM hub_quiet_held LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** Each person's hours. No saved row means the default, in the time zone from their scheduling settings, else Eastern. */
export async function quietPrefsFor(env: QuietEnv, emails: string[]): Promise<Map<string, QuietPrefs>> {
  const list = [...new Set(emails.map(lower).filter(Boolean))];
  const out = new Map<string, QuietPrefs>();
  if (!list.length) return out;
  const marks = list.map(() => '?').join(',');
  const saved = await env.DB.prepare(`SELECT email, on_quiet, start_min, end_min, weekends, tz FROM hub_quiet WHERE email IN (${marks})`).bind(...list).all<{ email: string; on_quiet: number; start_min: number; end_min: number; weekends: number; tz: string }>().then((r) => r.results || []).catch(() => []);
  const zones = await env.DB.prepare(`SELECT email, tz FROM hub_sched_prefs WHERE email IN (${marks})`).bind(...list).all<{ email: string; tz: string }>().then((r) => r.results || []).catch(() => []);
  const zoneOf = new Map(zones.map((z) => [lower(z.email), validTz(z.tz)]));
  const rowOf = new Map(saved.map((r) => [lower(r.email), r]));
  for (const e of list) {
    const r = rowOf.get(e);
    const tz = (r && validTz(r.tz)) || zoneOf.get(e) || EASTERN;
    out.set(e, r ? { on: r.on_quiet !== 0, start: r.start_min, end: r.end_min, weekends: r.weekends !== 0, tz, saved: true } : { ...QUIET_DEFAULT, tz, saved: false });
  }
  return out;
}

/** The people in this list who are in quiet hours right now. Empty before the tables exist. */
export async function quietNow(env: QuietEnv, emails: string[], now = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  if (!emails.length || !(await ready(env))) return out;
  for (const [e, p] of await quietPrefsFor(env, emails)) if (inQuiet(p, now)) out.add(e);
  return out;
}

export interface HeldItem {
  kind: 'push' | 'chat' | 'request' | 'project';
  title: string;
  body?: string;
  url?: string;
  /** A Chat message id, so one message held as both a push and an email shows once in the summary. */
  messageId?: number | null;
}

export async function hold(env: QuietEnv, email: string, item: HeldItem, now = new Date()): Promise<void> {
  await env.DB.prepare('INSERT INTO hub_quiet_held (email, kind, title, body, url, message_id, held_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(lower(email), item.kind, item.title.slice(0, 200), String(item.body || '').slice(0, 400), String(item.url || ''), item.messageId ?? null, now.toISOString())
    .run();
}

/** Holds the item when the person is in quiet hours. True when held (the caller then sends nothing). */
export async function holdIfQuiet(env: QuietEnv, email: string, item: HeldItem, now = new Date()): Promise<boolean> {
  const q = await quietNow(env, [email], now).catch(() => new Set<string>());
  if (!q.has(lower(email))) return false;
  await hold(env, email, item, now);
  return true;
}

export async function saveQuiet(env: QuietEnv, email: string, input: { on?: unknown; start?: unknown; end?: unknown; weekends?: unknown; tz?: unknown }): Promise<QuietPrefs> {
  const cur = (await quietPrefsFor(env, [email])).get(lower(email))!;
  const minute = (v: unknown, d: number) => {
    if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) {
      const [h, m] = v.split(':').map(Number);
      if (h! < 24 && m! < 60) return h! * 60 + m!;
    }
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < 1440 ? n : d;
  };
  const next = {
    on: input.on === undefined ? cur.on : input.on === true,
    start: input.start === undefined ? cur.start : minute(input.start, cur.start),
    end: input.end === undefined ? cur.end : minute(input.end, cur.end),
    weekends: input.weekends === undefined ? cur.weekends : input.weekends === true,
    tz: input.tz === undefined ? (cur.saved ? cur.tz : '') : validTz(input.tz),
  };
  await env.DB.prepare(
    `INSERT INTO hub_quiet (email, on_quiet, start_min, end_min, weekends, tz, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET on_quiet = excluded.on_quiet, start_min = excluded.start_min, end_min = excluded.end_min, weekends = excluded.weekends, tz = excluded.tz, updated_at = excluded.updated_at`
  )
    .bind(lower(email), next.on ? 1 : 0, next.start, next.end, next.weekends ? 1 : 0, next.tz, nowIso())
    .run();
  return (await quietPrefsFor(env, [email])).get(lower(email))!;
}

/* ------------------------------------------------------------------ the summary when quiet hours end */

const ORIGIN = 'https://dash.favorintl.org';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface HeldRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  url: string;
  message_id: number | null;
  held_at: string;
}

/** One line per held thing, a Chat message once even when it was held as both a push and an email. Newest last. */
export function summaryLines(rows: HeldRow[]): HeldRow[] {
  const seen = new Set<string>();
  const out: HeldRow[] = [];
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const k = r.message_id ? `m${r.message_id}` : `${r.kind}|${r.title}|${r.body}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function buildQuietSummary(name: string, lines: HeldRow[]): { subject: string; html: string; text: string } {
  const n = lines.length;
  const subject = n === 1 ? `While your quiet hours were on: ${lines[0]!.title}` : `While your quiet hours were on: ${n} notices`;
  const link = (u: string) => (u.startsWith('http') ? u : ORIGIN + (u || '/'));
  const items = lines.slice(0, 40);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2a24">
<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:12px;padding:22px">
<p style="margin:0 0 14px;font-size:15px">Good morning${name ? ', ' + esc(name.split(' ')[0]!) : ''}. Here is what came in during your quiet hours.</p>
${items.map((l) => `<div style="padding:10px 0;border-top:1px solid #eee"><a href="${esc(link(l.url))}" style="color:#1f5a40;font-weight:600;text-decoration:none;font-size:14px">${esc(l.title)}</a>${l.body ? `<div style="font-size:13px;color:#555;margin-top:3px">${esc(l.body)}</div>` : ''}</div>`).join('')}
${n > items.length ? `<p style="font-size:13px;color:#555">And ${n - items.length} more in the bell.</p>` : ''}
<p style="margin:16px 0 0"><a href="${ORIGIN}/" style="display:inline-block;background:#1f5a40;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open FavorOS</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#777">Change your quiet hours from the bell in FavorOS.</p>
</div></div></body></html>`;
  const text = `Here is what came in during your quiet hours.\n\n${items.map((l) => `- ${l.title}${l.body ? ': ' + l.body : ''}\n  ${link(l.url)}`).join('\n')}\n\nChange your quiet hours from the bell in FavorOS.`;
  return { subject, html, text };
}

export interface DeliverDeps {
  sendMail: (to: string, mail: { subject: string; html: string; text: string }) => Promise<boolean>;
  push: (to: string, payload: { title: string; body: string; url: string; tag: string }) => Promise<number>;
}

/** For every person whose quiet hours are over and who has held items: one email and one push, then the rows are marked sent. */
export async function deliverHeld(env: QuietEnv, deps: DeliverDeps, now = new Date()): Promise<{ people: number; items: number }> {
  const out = { people: 0, items: 0 };
  if (!(await ready(env))) return out;
  const who = ((await env.DB.prepare('SELECT DISTINCT email FROM hub_quiet_held WHERE sent_at IS NULL LIMIT 200').all<{ email: string }>()).results || []).map((r) => lower(r.email));
  if (!who.length) return out;
  const quiet = await quietNow(env, who, now);
  for (const email of who) {
    if (quiet.has(email)) continue;
    // Take the rows first, so two passes at once never send the summary twice.
    const tag = `taking:${now.toISOString()}:${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare('UPDATE hub_quiet_held SET sent_at = ? WHERE email = ? AND sent_at IS NULL').bind(tag, email).run();
    const rows = (await env.DB.prepare('SELECT id, kind, title, body, url, message_id, held_at FROM hub_quiet_held WHERE email = ? AND sent_at = ?').bind(email, tag).all<HeldRow>()).results || [];
    if (!rows.length) continue;
    if (isTester(email)) {
      // The test users never get mail or pushes; their rows are closed as they are.
      await env.DB.prepare('UPDATE hub_quiet_held SET sent_at = ? WHERE email = ? AND sent_at = ?').bind('tester:' + now.toISOString(), email, tag).run();
      continue;
    }
    const lines = summaryLines(rows);
    const person = await env.DB.prepare('SELECT name FROM hub_users WHERE lower(email) = ?').bind(email).first<{ name: string }>().catch(() => null);
    const mail = buildQuietSummary(person?.name || '', lines);
    const ok = await deps.sendMail(email, mail).catch(() => false);
    await deps.push(email, { title: lines.length === 1 ? lines[0]!.title : `${lines.length} notices from your quiet hours`, body: lines.slice(0, 3).map((l) => l.title).join(' · ').slice(0, 160), url: lines.length === 1 ? lines[0]!.url || '/' : '/', tag: 'quiet-summary' }).catch(() => 0);
    // Marked done either way: a failed email is not retried every five minutes, and the bell still holds every notice.
    await env.DB.prepare('UPDATE hub_quiet_held SET sent_at = ? WHERE email = ? AND sent_at = ?').bind(ok ? now.toISOString() : 'failed:' + now.toISOString(), email, tag).run();
    if (ok) {
      out.people++;
      out.items += lines.length;
    }
  }
  return out;
}
