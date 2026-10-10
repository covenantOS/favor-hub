// Signed-in phones. A device token is a random string the app keeps in the iOS Keychain. The hub stores only its SHA-256, so a read of
// the database cannot sign anyone in. A token stops working when it expires (90 days), when the phone, the person or an admin
// revokes it, and the moment hub_users.blocked is set for the email (the lookup joins hub_users).
import { newId, nowIso, type Env } from '../http';

export const DEVICE_PREFIX = 'fdv_';
export const DEVICE_DAYS = 90;
/** One person keeps at most this many phones signed in. A new sign-in past the limit signs out the oldest. */
export const MAX_DEVICES = 8;
const TOUCH_MS = 60 * 60 * 1000;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DeviceSession {
  token: string;
  email: string;
  expires_at: string;
  id: string;
}

export async function createDevice(env: Env, email: string, name: string, ip: string, userAgent: string): Promise<DeviceSession> {
  const token = DEVICE_PREFIX + randomHex(32);
  const id = newId('dev');
  const now = nowIso();
  const expires = new Date(Date.now() + DEVICE_DAYS * 86400000).toISOString();
  await env.DB.prepare(
    'INSERT INTO hub_devices (id, token_hash, email, name, created_at, last_seen, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, await sha256Hex(token), email, name.slice(0, 80), now, now, expires, ip, userAgent.slice(0, 200))
    .run();
  // Keep the newest MAX_DEVICES live phones for this person.
  const live = (
    await env.DB.prepare('SELECT id FROM hub_devices WHERE email = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC').bind(email, now).all<{ id: string }>()
  ).results;
  for (const old of live.slice(MAX_DEVICES)) {
    await env.DB.prepare("UPDATE hub_devices SET revoked_at = ?, revoked_by = 'limit' WHERE id = ?").bind(now, old.id).run();
  }
  return { token, email, expires_at: expires, id };
}

export interface DeviceUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

/** The person behind a device token, or null when the token is unknown, expired, revoked or the person is blocked. */
export async function resolveDevice(env: Env, token: string): Promise<DeviceUser | null> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT d.id, d.last_seen, u.email, u.name, u.picture, u.role, u.blocked
       FROM hub_devices d JOIN hub_users u ON u.email = d.email
      WHERE d.token_hash = ? AND d.revoked_at IS NULL AND d.expires_at > ? LIMIT 1`
  )
    .bind(hash, nowIso())
    .first<{ id: string; last_seen: string; email: string; name: string; picture: string; role: string; blocked: number }>();
  if (!row || row.blocked) return null;
  if (Date.now() - Date.parse(row.last_seen) > TOUCH_MS) {
    await env.DB.prepare('UPDATE hub_devices SET last_seen = ? WHERE id = ?').bind(nowIso(), row.id).run().catch(() => undefined);
  }
  return { id: row.id, email: row.email, name: row.name, picture: row.picture, role: row.role };
}

/** Revoke the phone this token belongs to. Returns whether a live row was found. */
export async function revokeByToken(env: Env, token: string, by: string): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE hub_devices SET revoked_at = ?, revoked_by = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(nowIso(), by, await sha256Hex(token))
    .run();
  return Number(r.meta?.changes || 0) > 0;
}

/** Revoke every live phone for an email. Returns how many were signed out. */
export async function revokeAll(env: Env, email: string, by: string): Promise<number> {
  const r = await env.DB.prepare('UPDATE hub_devices SET revoked_at = ?, revoked_by = ? WHERE email = ? AND revoked_at IS NULL')
    .bind(nowIso(), by, email.toLowerCase())
    .run();
  return Number(r.meta?.changes || 0);
}

/** Revoke one live phone of an email by its device id. Returns 1 when found, 0 when not. */
export async function revokeOne(env: Env, email: string, deviceId: string, by: string): Promise<number> {
  const r = await env.DB.prepare('UPDATE hub_devices SET revoked_at = ?, revoked_by = ? WHERE id = ? AND email = ? AND revoked_at IS NULL')
    .bind(nowIso(), by, deviceId, email.toLowerCase())
    .run();
  return Number(r.meta?.changes || 0);
}

export async function listDevices(env: Env, email: string) {
  return (
    await env.DB.prepare('SELECT id, name, created_at, last_seen, expires_at, revoked_at, revoked_by FROM hub_devices WHERE email = ? ORDER BY created_at DESC LIMIT 50')
      .bind(email.toLowerCase())
      .all<Record<string, unknown>>()
  ).results;
}
