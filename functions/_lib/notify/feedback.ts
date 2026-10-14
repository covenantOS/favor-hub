// Feedback replies by email. When a note is marked fixed (with a reply, or "Updated." when it has none), the person who sent it gets one email with their question,
// the reply and a button to ask again. The poll catches every way a row gets there: the admin feedback screen, the helper below,
// and agents who mark rows fixed straight in D1. reply_mailed keeps the reply text that went out, so each reply is emailed once
// and a changed reply is emailed again. Rows marked 'held' were answered before this shipped and wait for Will's yes.
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { C, btn, esc, shell } from '../projects/links/email';
import { ORIGIN } from '../projects/links/shared';
import { mayMail, sendMail } from './send';

const WILL = 'will@favorintl.org';
const BRAIN = new Set(['brain', 'hub-brain']);

interface Row {
  id: number;
  email: string;
  name: string | null;
  source: string;
  question: string | null;
  comment: string | null;
  reply: string;
  handled_by: string | null;
}

export interface FeedbackResult {
  sent: number;
  skipped: number;
  failed: number;
  note?: string;
}

const firstName = (n: string | null, email: string) => String(n || '').trim().split(/\s+/)[0] || email.split('@')[0];
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s);

export function buildFeedbackMail(r: Row, from: { name: string }): { subject: string; html: string; text: string } {
  const brain = BRAIN.has(r.source);
  const asked = String(r.question || '').trim();
  const note = String(r.comment || '').trim();
  const reply = String(r.reply || '').trim();
  const href = brain && asked ? `${ORIGIN}/brain/?ask=${encodeURIComponent(asked.slice(0, 600))}` : `${ORIGIN}/feedback/`;
  const cta = brain && asked ? 'Ask it again in FavorOS' : 'Open your feedback in FavorOS';
  const hi = `Hi ${firstName(r.name, r.email)},`;
  const lead = brain ? 'I updated Favor Brain after your note on this question.' : 'I made a change after your feedback.';
  const box = (label: string, body: string) =>
    `<tr><td style="padding:12px 28px 0"><div style="font:700 11.5px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${C.ink3};padding-bottom:6px">${esc(label)}</div>` +
    `<div style="background:${C.bg};border-radius:14px;padding:14px 16px;font:400 14.5px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(clip(body, 900))}</div></td></tr>`;
  const inner =
    `<tr><td style="padding:22px 28px 0;font:400 15px/1.55 Arial,sans-serif;color:${C.ink}">${esc(hi)}<br><br>${esc(lead)}</td></tr>` +
    (asked ? box('Your question', asked) : '') +
    (note ? box(asked ? 'Your note' : 'Your feedback', note) : '') +
    box('My reply', reply) +
    `<tr><td style="padding:18px 28px 0">${btn(href, cta, true)}</td></tr>` +
    `<tr><td style="padding:16px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">My reply also stays with your note on the Feedback page in FavorOS.<br>${esc(from.name)}</div></td></tr>`;
  const text = [
    hi,
    '',
    lead,
    ...(asked ? ['', 'Your question:', asked] : []),
    ...(note ? ['', asked ? 'Your note:' : 'Your feedback:', note] : []),
    '',
    'My reply:',
    reply,
    '',
    `${cta}: ${href}`,
    '',
    'My reply also stays with your note on the Feedback page in FavorOS.',
    from.name,
  ].join('\n');
  return { subject: brain ? 'Updated: your Favor Brain question' : 'Updated: your FavorOS feedback', html: shell(inner, 'FavorOS'), text };
}

/** Emails every fixed note whose reply has not gone out yet (or one note, by id). Safe to call any number of times. */
export async function feedbackPass(env: Env, opts: { id?: number } = {}): Promise<FeedbackResult> {
  const out: FeedbackResult = { sent: 0, skipped: 0, failed: 0 };
  // Fixed and not yet emailed, or fixed again with a different reply. A note fixed with no reply (agents often mark rows fixed
  // straight in D1) gets the reply "Updated." in the row and in the email.
  const where = `status = 'fixed' AND (reply_mailed_at IS NULL OR COALESCE(reply_mailed, '') <> COALESCE(trim(reply), ''))`;
  const r = await env.DB.prepare(
    `SELECT id, email, name, source, question, comment, reply, handled_by FROM brain_feedback WHERE ${where}${opts.id ? ' AND id = ?' : ''} ORDER BY id LIMIT 25`
  )
    .bind(...(opts.id ? [opts.id] : []))
    .all<Row>()
    .catch(() => null);
  if (!r) return { ...out, note: 'tables not applied' };
  const rows = r.results || [];
  if (!rows.length) return out;
  // Claim each row with the reply as it reads now, in one batch; a row someone else claimed first is left to them.
  const claims = await env.DB.batch(
    rows.map((x) =>
      env.DB.prepare(
        `UPDATE brain_feedback SET reply = COALESCE(NULLIF(trim(reply), ''), 'Updated.'),
                reply_seen_at = CASE WHEN COALESCE(trim(reply), '') = '' THEN NULL ELSE reply_seen_at END,
                reply_mailed = COALESCE(NULLIF(trim(reply), ''), 'Updated.'), reply_mailed_at = 'sending'
          WHERE id = ? AND ${where}`
      ).bind(x.id)
    )
  );
  const mine = rows
    .filter((_x, i) => Number((claims[i]?.meta as { changes?: number } | undefined)?.changes) > 0)
    .map((x) => ({ ...x, reply: String(x.reply || '').trim() || 'Updated.' }));
  if (!mine.length) return out;
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [p.email.toLowerCase(), p]));
  const results: { id: number; state: 'sent' | 'skipped' | 'failed' }[] = [];
  for (const x of mine) {
    const to = String(x.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !(await mayMail(env, to))) {
      results.push({ id: x.id, state: 'skipped' });
      continue;
    }
    const by = String(x.handled_by || '').toLowerCase();
    const sender = /@favorintl\.org$/.test(by) && dir.has(by) ? { email: by, name: dir.get(by)!.name } : { email: WILL, name: dir.get(WILL)?.name || 'Will Hamilton' };
    const mail = buildFeedbackMail(x, sender);
    const ok = await sendMail(env, { to, ...mail, fromName: `${sender.name} via FavorOS`, replyTo: sender.email }).catch(() => false);
    results.push({ id: x.id, state: ok ? 'sent' : 'failed' });
  }
  const at = new Date().toISOString();
  await env.DB.batch(
    results.map((x) =>
      x.state === 'failed'
        ? env.DB.prepare(`UPDATE brain_feedback SET reply_mailed = NULL, reply_mailed_at = NULL WHERE id = ?`).bind(x.id) // try again next pass
        : env.DB.prepare(`UPDATE brain_feedback SET reply_mailed_at = ? WHERE id = ?`).bind(x.state === 'sent' ? at : 'skipped', x.id)
    )
  );
  for (const x of results) out[x.state]++;
  return out;
}

/**
 * The helper for agents and scripts: mark a note fixed with a reply ("Updated." when none is given) and email it now.
 * Agents may also write the row straight in D1; the 5-minute pass sends it then.
 */
export async function markUpdated(env: Env, id: number, opts: { reply?: string; by?: string } = {}): Promise<FeedbackResult> {
  const reply = String(opts.reply || '').trim().slice(0, 2000) || 'Updated.';
  await env.DB.prepare(
    `UPDATE brain_feedback SET status = 'fixed', reply = ?, reply_seen_at = CASE WHEN COALESCE(reply, '') <> ? THEN NULL ELSE reply_seen_at END, handled_by = ?, handled_at = ? WHERE id = ?`
  )
    .bind(reply, reply, String(opts.by || WILL).toLowerCase(), new Date().toISOString(), id)
    .run();
  return feedbackPass(env, { id });
}
