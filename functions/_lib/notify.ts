import type { RequestRow } from './db';
import type { Env } from './http';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
}

export function firstHttpUrl(text: string): string | null {
  const match = String(text || '').match(/https?:\/\/[^\s)\]>'"]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;]+$/, '');
}

function willEmail(env: Env): string {
  return env.NOTIFY_EMAIL || 'will@favorintl.org';
}

function recipients(env: Env, row: RequestRow): string[] {
  const will = willEmail(env).trim();
  const to: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const email = raw.trim();
    if (!isEmail(email)) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    to.push(email);
  };
  add(will);
  add(row.submitter_email || '');
  return to;
}

async function sendResend(env: Env, payload: { to: string[]; subject: string; html: string }): Promise<void> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[requests] RESEND_API_KEY missing; skipped notify');
    return;
  }
  if (payload.to.length === 0) {
    console.warn('[requests] no notify recipients');
    return;
  }
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: payload.to, subject: payload.subject, html: payload.html }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('[requests] notify failed', res.status, detail.slice(0, 240));
  }
}

export async function notifyNewRequest(env: Env, row: RequestRow): Promise<void> {
  const url = `https://dash.favorintl.org/requests/`;
  const bodyPreview = row.body.length > 800 ? `${row.body.slice(0, 800)}...` : row.body;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#faf8f4;font-family:-apple-system,'Segoe UI',sans-serif;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fffdf9;border-radius:12px;border-top:4px solid #5a7250;padding:24px">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8b957b">Favor Hub · New request</div>
      <h1 style="font-size:20px;color:#2a2722;margin:8px 0 12px">${esc(row.title)}</h1>
      <p style="font-size:14px;color:#5a5648;margin:0 0 16px">${esc(row.submitter_name)}${row.submitter_email ? ` · ${esc(row.submitter_email)}` : ''} · ${esc(row.surface)}${row.page_url ? ` · ${esc(row.page_url)}` : ''}</p>
      <pre style="white-space:pre-wrap;font-size:13px;line-height:1.5;color:#2a2722;background:#f4efe4;padding:14px;border-radius:8px;margin:0 0 18px">${esc(bodyPreview)}</pre>
      <p style="margin:0"><a href="${url}" style="color:#5a7250;font-weight:600">Open the board</a></p>
    </div>
  </body></html>`;
  await sendResend(env, {
    to: [willEmail(env)],
    subject: `New request: ${row.title}`,
    html,
  });
}

export async function notifyRequestDone(
  env: Env,
  row: RequestRow,
  extra: { pageUrl?: string | null; note?: string } = {}
): Promise<void> {
  const pageUrl = extra.pageUrl || row.page_url || firstHttpUrl(extra.note || '') || '';
  const board = 'https://dash.favorintl.org/requests/';
  const pageBlock = pageUrl
    ? `<p style="margin:0 0 18px"><a href="${esc(pageUrl)}" style="display:inline-block;background:#5a7250;color:#fffdf9;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Open the page</a></p>
       <p style="font-size:13px;color:#5a5648;margin:0 0 18px;word-break:break-all">${esc(pageUrl)}</p>`
    : '';
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#faf8f4;font-family:-apple-system,'Segoe UI',sans-serif;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fffdf9;border-radius:12px;border-top:4px solid #5a7250;padding:24px">
      <div style="width:48px;height:48px;border-radius:24px;background:#5a7250;color:#fffdf9;font-size:28px;line-height:48px;text-align:center;margin:0 0 16px">✓</div>
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8b957b">Favor Hub · Done</div>
      <h1 style="font-size:20px;color:#2a2722;margin:8px 0 12px">${esc(row.title)}</h1>
      <p style="font-size:14px;color:#5a5648;margin:0 0 16px">This request is done.${row.submitter_name ? ` ${esc(row.submitter_name)} asked for it.` : ''}</p>
      ${pageBlock}
      <p style="margin:0"><a href="${board}" style="color:#5a7250;font-weight:600">Open the board</a></p>
    </div>
  </body></html>`;
  await sendResend(env, {
    to: recipients(env, row),
    subject: `Done: ${row.title}`,
    html,
  });
}
