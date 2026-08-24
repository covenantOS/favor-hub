import type { Env } from '../http';
import { fmtEt, money, type ExpenseItemRow, type ExpenseRow } from './db';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

interface Mail {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>;
}

async function sendResend(env: Env, mail: Mail): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('[expenses] RESEND_API_KEY missing; skipped email', mail.subject);
    return false;
  }
  if (!mail.to.length) return false;
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: mail.to, cc: mail.cc, subject: mail.subject, html: mail.html, attachments: mail.attachments }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('[expenses] email failed', res.status, detail.slice(0, 240));
    return false;
  }
  return true;
}

function dedupe(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function travelLine(row: ExpenseRow): string {
  const bits = [row.travel_dates, row.travel_city].filter(Boolean) as string[];
  return bits.length ? bits.map(esc).join(' · ') : 'No travel';
}

function itemsTable(row: ExpenseRow, items: ExpenseItemRow[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:7px 4px;border-bottom:1px solid #eee9dd">${esc(it.description)}${it.item ? ` <span style="color:#8f8a7c">· ${esc(it.item)}</span>` : ''}</td>
         <td style="padding:7px 4px;border-bottom:1px solid #eee9dd;text-align:right;font-family:Menlo,Consolas,monospace;white-space:nowrap">${money(it.amount_cents)}</td></tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin:0 0 6px">${rows}
    <tr><td style="padding:12px 4px 0;font-weight:700">Total estimated</td>
    <td style="padding:12px 4px 0;text-align:right;font-family:Menlo,Consolas,monospace;font-weight:700;font-size:16px">${money(row.total_cents)}</td></tr></table>`;
}

function shell(kicker: string, inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#efece4;font-family:-apple-system,'Segoe UI',sans-serif;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border-top:4px solid #0c7a26;padding:28px">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8b957b;font-weight:600;margin-bottom:10px">${kicker}</div>
      ${inner}
      <div style="margin-top:22px;padding-top:14px;border-top:1px solid #eee9dd;font-size:11.5px;color:#8f8a7c;line-height:1.6">
        Favor International · Valrico, FL · This record is kept in the Favor Hub expense log.
      </div>
    </div>
  </body></html>`;
}

export async function emailApprover(env: Env, row: ExpenseRow, items: ExpenseItemRow[], reviewUrl: string): Promise<boolean> {
  const html = shell(
    'Favor Hub · Expense request',
    `<h1 style="font-size:22px;color:#0d0f0c;margin:0 0 6px">${esc(row.requester_name)} needs your approval</h1>
     <p style="font-size:14px;color:#5a5648;margin:0 0 18px">${travelLine(row)} · submitted ${fmtEt(row.submitted_at)}</p>
     ${itemsTable(row, items)}
     <div style="background:#f4efe4;border-radius:8px;padding:12px 14px;font-size:13.5px;color:#2a2722;margin:14px 0 18px">${esc(row.reason)}</div>
     <p style="margin:0 0 18px"><a href="${reviewUrl}" style="display:inline-block;background:#0c7a26;color:#fffdf9;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px;font-size:14px">Review &amp; sign</a></p>
     <p style="font-size:11.5px;color:#8f8a7c;margin:0">This link is private to you and stops working once the request is decided. You are receiving this because you are the assigned expense approver.</p>`
  );
  return sendResend(env, {
    to: [row.approver_email],
    subject: `Expense request ${row.doc_number} · ${row.requester_name} · ${money(row.total_cents)}`,
    html,
  });
}

export async function emailApproved(
  env: Env,
  row: ExpenseRow,
  items: ExpenseItemRow[],
  distribution: string[],
  pdf: Uint8Array
): Promise<boolean> {
  const html = shell(
    'Favor Hub · Expense request approved',
    `<h1 style="font-size:22px;color:#0d0f0c;margin:0 0 6px">${esc(row.doc_number)} · ${esc(row.requester_name)}</h1>
     <p style="font-size:14px;color:#5a5648;margin:0 0 16px">${travelLine(row)}</p>
     <div style="background:#eef7ee;border:1px solid #cfe8cf;border-radius:10px;padding:12px 14px;font-size:13.5px;margin:0 0 16px">
       <b>Approved by ${esc(row.approver_name)}</b> on ${row.decided_at ? fmtEt(row.decided_at) : ''}. Requested by ${esc(row.requester_name)}.
     </div>
     ${itemsTable(row, items)}
     <div style="background:#f4efe4;border-radius:8px;padding:12px 14px;font-size:13.5px;color:#2a2722;margin:14px 0 0">${esc(row.reason)}</div>
     <p style="font-size:12px;color:#8f8a7c;margin:14px 0 0">The signed document is attached as a PDF.</p>`
  );
  return sendResend(env, {
    to: dedupe([row.requester_email, row.approver_email, ...distribution]),
    subject: `Approved: ${row.doc_number} · ${row.requester_name} · ${money(row.total_cents)}`,
    html,
    attachments: [{ filename: `FAVOR-${row.doc_number}-signed.pdf`, content: toBase64(pdf) }],
  });
}

export async function emailDeclined(env: Env, row: ExpenseRow, items: ExpenseItemRow[]): Promise<boolean> {
  const html = shell(
    'Favor Hub · Expense request declined',
    `<h1 style="font-size:22px;color:#0d0f0c;margin:0 0 6px">${esc(row.doc_number)} · ${esc(row.requester_name)}</h1>
     <p style="font-size:14px;color:#5a5648;margin:0 0 16px">${travelLine(row)}</p>
     <div style="background:#faeee8;border:1px solid #ecd2c4;border-radius:10px;padding:12px 14px;font-size:13.5px;margin:0 0 16px">
       <b>Declined by ${esc(row.approver_name)}</b> on ${row.decided_at ? fmtEt(row.decided_at) : ''}.${row.decline_note ? ` Note: ${esc(row.decline_note)}` : ''}
     </div>
     ${itemsTable(row, items)}
     <p style="font-size:13px;color:#5a5648;margin:14px 0 0">Fix what the note asks for and submit again from the dash.</p>`
  );
  return sendResend(env, {
    to: [row.requester_email],
    cc: row.approver_email.toLowerCase() === row.requester_email.toLowerCase() ? undefined : [row.approver_email],
    subject: `Declined: ${row.doc_number} · ${row.requester_name} · ${money(row.total_cents)}`,
    html,
  });
}
