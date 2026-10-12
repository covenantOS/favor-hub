// Onboarding email, in Favor's look (the request emails in requests/email.ts): one card, a short list, one button. Three kinds:
//   steps     the steps a person owns in a new run, sent once when the run starts
//   welcome   the new hire's first-day page, sent when FavorOS access is added
//   late      steps that are due or late, from the weekday morning pass
// Every send goes through the notice gate (requests.notify, requests.notify.only) and the admin switch requests.email, and nobody
// is mailed twice for the same step on the same day (onb_reminders). Pure builders; the sender is the one the hub already uses.
import { nowIso, type Env } from '../http';
import { effective } from '../admin/settings';
import { noticeGate } from './tasks';

const ORIGIN = 'https://dash.favorintl.org';
const LOGO = 'https://dash.favorintl.org/images/favor-icon.png';
const TZ = 'America/New_York';
const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24', leaf: '#e6efdc', sun: '#fbe9c6', red: '#b3412b' };
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const dayWord = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

export interface Line {
  title: string;
  due?: string | null;
  late?: boolean;
}

export interface MailIn {
  pill: string;
  title: string;
  intro: string;
  lines: Line[];
  button: { label: string; url: string };
  foot: string;
}

export function buildMail(m: MailIn): { subject: string; html: string; text: string } {
  const rows = m.lines
    .map(
      (l) =>
        `<tr><td class="fv-line" style="padding:10px 0;border-top:1px solid ${C.line};font:400 15px/1.4 Arial,sans-serif;color:${C.ink}">${esc(l.title)}</td>` +
        `<td class="fv-line" align="right" style="padding:10px 0 10px 12px;border-top:1px solid ${C.line};font:600 13px/1.4 Arial,sans-serif;white-space:nowrap;color:${l.late ? C.red : C.ink2}">${l.due ? esc((l.late ? 'Late, ' : '') + dayWord(l.due)) : ''}</td></tr>`
    )
    .join('');
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">` +
    `<style>@media (prefers-color-scheme:dark){.fv-bg{background:#171a15!important}.fv-card{background:#20241d!important;border-color:#343a2f!important}.fv-ink{color:#f1eee4!important}.fv-ink2{color:#c9c5b8!important}.fv-line{border-color:#343a2f!important;color:#f1eee4!important}.fv-btn{background:#3f7a35!important}}@media (max-width:480px){.fv-pad{padding-left:20px!important;padding-right:20px!important}}</style></head>` +
    `<body class="fv-bg" style="margin:0;padding:0;background:${C.bg}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-bg" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-card" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;border-collapse:separate">` +
    `<tr><td class="fv-pad" style="padding:20px 28px 0"><table role="presentation" width="100%"><tr><td style="font:600 13px/1 Arial,sans-serif;color:${C.ink3}"><img src="${LOGO}" alt="" width="28" height="24" style="vertical-align:middle;border:0" />&nbsp; FavorOS</td>` +
    `<td align="right"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${C.leaf};color:${C.green};font:700 12px/1 Arial,sans-serif">${esc(m.pill)}</span></td></tr></table></td></tr>` +
    `<tr><td class="fv-pad" style="padding:20px 28px 0"><div class="fv-ink" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${esc(m.title)}</div>` +
    `<div class="fv-ink2" style="margin-top:10px;font:400 15px/1.55 Arial,sans-serif;color:${C.ink2}">${esc(m.intro)}</div></td></tr>` +
    (rows ? `<tr><td class="fv-pad" style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` : '') +
    `<tr><td class="fv-pad" style="padding:22px 28px 0"><a class="fv-btn" href="${esc(m.button.url)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:${C.green};color:#ffffff;font:700 15px/1 Arial,sans-serif;text-decoration:none">${esc(m.button.label)}</a></td></tr>` +
    `<tr><td class="fv-pad" style="padding:20px 28px 24px"><div class="fv-ink2" style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">${esc(m.foot)}</div></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = [m.title, '', m.intro, '', ...m.lines.map((l) => `- ${l.title}${l.due ? ` (${l.late ? 'late, ' : ''}${dayWord(l.due)})` : ''}`), '', `${m.button.label}: ${m.button.url}`, '', m.foot].join('\n');
  return { subject: m.title, html, text };
}

export interface Outbox {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends through Resend, the sender the hub already uses. Tests collect the mail in MAIL_HOOK and nothing leaves the process. */
async function send(env: Env, m: Outbox): Promise<boolean> {
  const hook = (env as unknown as { MAIL_HOOK?: (m: Outbox) => Promise<boolean> | boolean }).MAIL_HOOK;
  if (hook) return !!(await hook(m));
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[onboarding] RESEND_API_KEY missing; email skipped');
    return false;
  }
  const from = (env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>').replace(/^[^<]*</, 'FavorOS <');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) console.error('[onboarding] email failed', res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

/** True when this address may be emailed right now: the gate allows it and an admin has not turned request email off. */
export async function mayMail(env: Env, email: string): Promise<boolean> {
  if ((lower(await effective(env, 'requests.email', undefined, 'on').catch(() => 'on'))) === 'off') return false;
  return (await noticeGate(env))(email);
}

export async function sendMail(env: Env, to: string, mail: { subject: string; html: string; text: string }): Promise<boolean> {
  if (!(await mayMail(env, to))) return false;
  return send(env, { to: lower(to), ...mail }).catch(() => false);
}

export const runUrl = (id: string) => `${ORIGIN}/onboarding/run/?id=${encodeURIComponent(id)}`;
export const welcomeUrl = `${ORIGIN}/welcome/`;
export const todayEt = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: TZ });

/* ------------------------------------------------------------------------------------------------ the morning pass */

export interface PassResult {
  day: string;
  mailed: number;
  notes: string[];
}

/**
 * The weekday morning pass (called from the Work Center digest, after 8:00 AM Eastern): each owner of an open step that is due
 * today, due tomorrow or late gets one email listing them, at most once a day. Nothing on a weekend.
 */
export async function reminderPass(env: Env, now = new Date()): Promise<PassResult> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const dow = parts.find((p) => p.type === 'weekday')?.value || '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const day = todayEt(now);
  const out: PassResult = { day, mailed: 0, notes: [] };
  if (dow === 'Sat' || dow === 'Sun') return { ...out, notes: ['weekend'] };
  if (hour < 8) return { ...out, notes: ['before 8:00 AM'] };
  const tomorrow = todayEt(new Date(now.getTime() + 86400000));
  let rows: Array<{ id: string; run_id: string; title: string; owner_email: string; due_date: string; name: string }> = [];
  try {
    rows =
      (
        await env.DB.prepare(
          `SELECT s.id, s.run_id, s.title, s.owner_email, s.due_date, r.name FROM onb_steps s JOIN onb_runs r ON r.id = s.run_id
            WHERE s.status = 'open' AND r.status = 'active' AND s.owner_email <> '' AND s.due_date IS NOT NULL AND s.due_date <= ?
              AND NOT EXISTS (SELECT 1 FROM onb_reminders x WHERE x.step_id = s.id AND x.day = ?)
            ORDER BY s.owner_email, s.due_date`
        )
          .bind(tomorrow, day)
          .all<{ id: string; run_id: string; title: string; owner_email: string; due_date: string; name: string }>()
      ).results || [];
  } catch {
    return { ...out, notes: ['tables not applied'] };
  }
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.owner_email, [...(by.get(r.owner_email) || []), r]);
  for (const [email, list] of by) {
    if (!(await mayMail(env, email))) continue;
    const lines: Line[] = list.slice(0, 12).map((r) => ({ title: `${r.title} (${r.name})`, due: r.due_date, late: r.due_date < day }));
    const mail = buildMail({
      pill: list.some((r) => r.due_date < day) ? 'Late' : 'Due soon',
      title: list.length === 1 ? 'An onboarding step is due' : `${list.length} onboarding steps are due`,
      intro: 'These steps are due tomorrow, due today or late. Mark each one done in FavorOS when it is finished.',
      lines,
      button: { label: 'Open the steps', url: `${ORIGIN}/onboarding/` },
      foot: 'You get this because you own these steps.',
    });
    const ok = await send(env, { to: email, ...mail }).catch(() => false);
    for (const r of list) await env.DB.prepare('INSERT OR IGNORE INTO onb_reminders (step_id, kind, day, sent_at) VALUES (?, ?, ?, ?)').bind(r.id, r.due_date < day ? 'late' : 'due', day, nowIso()).run().catch(() => null);
    if (ok) out.mailed++;
  }
  return out;
}
