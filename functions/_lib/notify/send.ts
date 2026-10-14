// One sender for feedback replies, task tags and nudges. Tests set env.MAIL_HOOK and nothing leaves the process. The hub setting
// notify.only (a list of addresses) holds every send to those addresses while it is set: a live test run sets it to the test
// accounts so nobody else can be reached, and clears it after.
import type { Env } from '../http';
import { effective } from '../admin/settings';
import { isBlocked } from '../blocked';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const onlyCache = new WeakMap<object, Promise<Set<string> | null>>();

/** The addresses mail is held to, or null when every address may be mailed. Read once per request. */
export function onlyList(env: Env): Promise<Set<string> | null> {
  const key = env as unknown as object;
  let p = onlyCache.get(key);
  if (!p) {
    p = effective(env, 'notify.only', undefined, '')
      .catch(() => '')
      .then((v) => {
        const list = String(v || '').split(/[\s,;]+/).map(lower).filter(Boolean);
        return list.length ? new Set(list) : null;
      });
    onlyCache.set(key, p);
  }
  return p;
}

export async function mayMail(env: Env, to: string): Promise<boolean> {
  const only = await onlyList(env);
  return !only || only.has(lower(to));
}

export async function sendMail(env: Env, m: Mail): Promise<boolean> {
  if (!(await mayMail(env, m.to))) return false;
  // A blocked or offboarded person gets no mail, whatever still points at them.
  if (await isBlocked(env, m.to)) return false;
  const hook = (env as unknown as { MAIL_HOOK?: (m: Mail) => Promise<boolean> | boolean }).MAIL_HOOK;
  if (hook) return !!(await hook(m));
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[notify] RESEND_API_KEY missing; email skipped');
    return false;
  }
  const name = String(m.fromName || 'FavorOS').replace(/[<>"]/g, '');
  const from = (env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>').replace(/^[^<]*</, `${name} <`);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  if (!res.ok) console.error('[notify] email failed', res.status, (await res.text()).slice(0, 200));
  return res.ok;
}
