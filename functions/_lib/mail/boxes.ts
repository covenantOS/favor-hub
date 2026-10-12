// More than one mailbox in Mail. A person connects other Favor Google accounts (an accounting or admin inbox, a second account of
// their own) through Google's consent screen. Each is stored encrypted against its owner and the mailbox address (hub_mailboxes,
// db/mail-boxes.sql), and only that owner can reach it: every lookup here takes the signed-in person as the owner.
// Only favorintl.org Workspace accounts are accepted, checked on the verified id_token the way the sign-in is.
import type { Env } from '../http';
import { clientId, open, seal, tokenUrl } from '../hub/google';

export const MAX_BOXES = 5;
export const BOX_COLORS = ['#2f6f9f', '#a8741a', '#7a4aa8', '#3d7a35', '#b24a2f'];

export interface Box {
  mailbox: string;
  name: string;
  color: string;
  scopes: string;
}

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** What the id_token must say before a mailbox is stored: a verified favorintl.org address that is not the person's own sign-in. */
export function boxClaims(claims: any, owner: string): { ok: true; email: string; name: string } | { ok: false; why: 'failed' | 'domain' | 'same' } {
  const email = lower(claims?.email);
  if (!email || claims?.email_verified === false || claims?.email_verified === 'false') return { ok: false, why: 'failed' };
  if (!email.endsWith('@favorintl.org') || (claims?.hd && lower(claims.hd) !== 'favorintl.org')) return { ok: false, why: 'domain' };
  if (email === lower(owner)) return { ok: false, why: 'same' };
  return { ok: true, email, name: String(claims?.name || '').slice(0, 120) };
}

export async function listBoxes(env: Env, owner: string): Promise<Box[]> {
  const r = await env.DB.prepare('SELECT mailbox, name, color, scopes FROM hub_mailboxes WHERE owner = ? ORDER BY connected_at, mailbox').bind(lower(owner)).all<Box>().catch(() => ({ results: [] as Box[] }));
  return r.results || [];
}

export async function addBox(env: Env, owner: string, mailbox: string, name: string, refresh: string, scopes: string): Promise<{ ok: boolean; why?: 'limit' }> {
  const have = await listBoxes(env, owner);
  const mine = have.find((b) => b.mailbox === mailbox);
  if (!mine && have.length >= MAX_BOXES) return { ok: false, why: 'limit' };
  const used = new Set(have.map((b) => b.color));
  const color = mine?.color || BOX_COLORS.find((c) => !used.has(c)) || BOX_COLORS[have.length % BOX_COLORS.length];
  await env.DB.prepare(
    `INSERT INTO hub_mailboxes (owner, mailbox, name, color, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, mailbox) DO UPDATE SET refresh_enc = excluded.refresh_enc, scopes = excluded.scopes, name = excluded.name, connected_at = excluded.connected_at`
  ).bind(lower(owner), mailbox, name, color, await seal(env, refresh), scopes, new Date().toISOString()).run();
  return { ok: true };
}

const TOKENS = new Map<string, { token: string; exp: number }>();

/** A fresh access token for one of the person's own connected mailboxes, or null when it is not theirs or Google refused it. */
export async function boxToken(env: Env, owner: string, mailbox: string): Promise<{ token: string; scopes: string } | null> {
  const row = await env.DB.prepare('SELECT refresh_enc, scopes FROM hub_mailboxes WHERE owner = ? AND mailbox = ?').bind(lower(owner), lower(mailbox)).first<{ refresh_enc: string; scopes: string }>().catch(() => null);
  if (!row) return null;
  const ck = lower(owner) + '|' + lower(mailbox) + '|' + row.refresh_enc.slice(-24);
  const hit = TOKENS.get(ck);
  if (hit && hit.exp > Date.now()) return { token: hit.token, scopes: row.scopes };
  const refresh = await open(env, row.refresh_enc);
  const res = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: clientId(env), client_secret: env.GOOGLE_CLIENT_SECRET || '', grant_type: 'refresh_token' }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (data.error === 'invalid_grant') {
    await env.DB.prepare('DELETE FROM hub_mailboxes WHERE owner = ? AND mailbox = ?').bind(lower(owner), lower(mailbox)).run();
    return null;
  }
  if (!res.ok) throw new Error(data.error_description || `refresh ${res.status}`);
  if (TOKENS.size > 200) TOKENS.clear();
  TOKENS.set(ck, { token: data.access_token, exp: Date.now() + Math.max(60, Number(data.expires_in) || 3000) * 1000 - 120000 });
  return { token: data.access_token, scopes: row.scopes };
}

/** Removes a mailbox: the token is revoked at Google, and the saved snoozes, answers and category moves for it are dropped. */
export async function removeBox(env: Env, owner: string, mailbox: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT refresh_enc FROM hub_mailboxes WHERE owner = ? AND mailbox = ?').bind(lower(owner), lower(mailbox)).first<{ refresh_enc: string }>().catch(() => null);
  if (!row) return false;
  const token = await open(env, row.refresh_enc).catch(() => '');
  if (token) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => undefined);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hub_mailboxes WHERE owner = ? AND mailbox = ?').bind(lower(owner), lower(mailbox)),
    env.DB.prepare('DELETE FROM hub_mail_snooze WHERE email = ?').bind(lower(mailbox)),
    env.DB.prepare('DELETE FROM hub_mail_class WHERE email = ?').bind(lower(mailbox)),
    env.DB.prepare('DELETE FROM hub_mail_cat WHERE email = ?').bind(lower(mailbox)),
    env.DB.prepare('DELETE FROM hub_mail_rows WHERE mailbox = ?').bind(lower(mailbox)),
  ]).catch(() => undefined);
  for (const k of [...TOKENS.keys()]) if (k.startsWith(lower(owner) + '|' + lower(mailbox) + '|')) TOKENS.delete(k);
  return true;
}
