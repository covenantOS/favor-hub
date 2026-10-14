// Evaluation emails: one designed card per event (kickoff, feedback asked, reminder, summary shared, ready to sign).
// They go through the same gate as every other notice (hub setting requests.notify: on for everyone, or only the addresses listed
// in requests.notify.only). Nothing leaves while the gate is closed for that person. A reminder is sent once (eval_nudges).
import type { Env } from '../http';
import { nowIso } from '../http';
import { noticeGate } from '../requests/tasks';
import { isBlocked } from '../blocked';

const LOGO = 'https://dash.favorintl.org/images/favor-icon.png';
const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24' };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

export interface MailInput {
  heading: string;
  lines: string[];
  button: string;
  path: string;
  origin?: string;
}

export function mailHtml(m: MailInput): string {
  const origin = (m.origin || 'https://dash.favorintl.org').replace(/\/$/, '');
  return `<!DOCTYPE html><html><body style="margin:0;background:${C.bg};font-family:Arial,sans-serif;padding:24px">
<div style="max-width:520px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:24px">
<img src="${LOGO}" width="36" height="36" alt="" style="display:block;border-radius:8px;margin:0 0 14px" />
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.ink3}">FavorOS, Evaluations</div>
<h1 style="font-size:20px;line-height:1.3;color:${C.ink};margin:8px 0 12px">${esc(m.heading)}</h1>
${m.lines.map((l) => `<p style="font-size:14px;line-height:1.55;color:${C.ink2};margin:0 0 10px">${esc(l)}</p>`).join('')}
<p style="margin:18px 0 0"><a href="${esc(origin + m.path)}" style="display:inline-block;background:${C.green};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:9px">${esc(m.button)}</a></p>
</div></body></html>`;
}

async function resend(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key) return false;
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) console.error('[evals] mail failed', res.status);
  return res.ok;
}

/** Sends one email if the notice gate lets this person hear it. Returns true when it was sent. */
export async function tell(env: Env, to: string, subject: string, m: MailInput): Promise<boolean> {
  const email = String(to || '').trim().toLowerCase();
  if (!email) return false;
  const gate = await noticeGate(env).catch(() => (() => false) as (e: string) => boolean);
  if (!gate(email)) return false;
  if (await isBlocked(env, email)) return false; // a departed employee or reviewer gets no reminders
  return resend(env, email, subject, mailHtml(m)).catch(() => false);
}

/** Like tell, but only the first time for this key. The key is written even when the gate was closed, so opening the gate later does not release a backlog. */
export async function tellOnce(env: Env, key: string, to: string, subject: string, m: MailInput): Promise<boolean> {
  const had = await env.DB.prepare('SELECT 1 AS ok FROM eval_nudges WHERE key = ?').bind(key).first().catch(() => null);
  if (had) return false;
  await env.DB.prepare('INSERT OR IGNORE INTO eval_nudges (key, sent_at) VALUES (?, ?)').bind(key, nowIso()).run();
  return tell(env, to, subject, m);
}
