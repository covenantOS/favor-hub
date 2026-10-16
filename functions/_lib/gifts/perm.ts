// Who may open Gift entry, who may send a deposit to Blackbaud, and the amount that needs a second approver. Everything here is
// off until an admin switches it on: ge_person is empty at first, and the hub setting ge.second_cents is unset (off).
// Admins always open the page. Posting is never implied by a role: a person posts only when an admin switched that person on.
import { hubDel, hubGet, hubPut } from '../admin/settings';
import { HttpError, nowIso, type Env } from '../http';
import { isEarly } from '../early';
import { notTesterSql } from '../testuser';
import { logEvent } from './store';

export const SECOND_KEY = 'ge.second_cents';
export const POSTING_OFF = 'Posting is not switched on';

export async function secondCents(env: Env): Promise<number> {
  const row = await hubGet(env, SECOND_KEY);
  const n = row ? Math.round(Number(row.value)) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function setSecondCents(env: Env, by: string, cents: number): Promise<number> {
  if (!Number.isFinite(cents) || cents < 0 || cents > 100_000_000_00) throw new HttpError(400, 'bad_amount', 'Enter an amount in dollars, or 0 to turn the second approval off.');
  if (cents === 0) await hubDel(env, SECOND_KEY);
  else await hubPut(env, SECOND_KEY, String(Math.round(cents)), by);
  await logEvent(env, { kind: 'second_amount_set', actor: by, detail: { cents: Math.round(cents) } });
  return secondCents(env);
}

export interface Person {
  email: string;
  access: boolean;
  posting: boolean;
}

export async function personOf(env: Env, email: string): Promise<Person> {
  const row = await env.DB.prepare('SELECT email, access, posting FROM ge_person WHERE email = ? LIMIT 1').bind(email.toLowerCase()).first<{ email: string; access: number; posting: number }>().catch(() => null);
  return { email: email.toLowerCase(), access: !!(row && row.access), posting: !!(row && row.posting) };
}

/** An admin, or a person an admin gave access (the admin desk and Partner Care). Regional directors have neither. */
export async function mayOpen(env: Env, user: { email: string; role: string }): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (await isEarly(env, user).catch(() => false)) return true;
  return (await personOf(env, user.email)).access;
}

export async function mayPost(env: Env, email: string): Promise<boolean> {
  return (await personOf(env, email)).posting;
}

export interface PersonRow {
  email: string;
  name: string;
  role: string;
  access: boolean;
  posting: boolean;
}

/** Admins and everyone an admin gave access or posting to. The testers are left out. */
export async function listPeople(env: Env): Promise<PersonRow[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT u.email AS email, u.name AS name, u.role AS role, COALESCE(p.access, 0) AS access, COALESCE(p.posting, 0) AS posting
         FROM hub_users u LEFT JOIN ge_person p ON p.email = lower(u.email)
        WHERE u.blocked = 0 AND ${notTesterSql('u.email')} AND (u.role = 'admin' OR p.access = 1 OR p.posting = 1)
        ORDER BY u.name`
    ).all<{ email: string; name: string; role: string; access: number; posting: number }>()
  ).results;
  return rows.map((r) => ({ email: r.email.toLowerCase(), name: r.name, role: r.role, access: r.role === 'admin' || !!r.access, posting: !!r.posting }));
}

/** Staff an admin could add: signed-in accounts that are not blocked, not field staff and not already listed. */
export async function candidates(env: Env): Promise<{ email: string; name: string }[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT u.email AS email, u.name AS name FROM hub_users u LEFT JOIN ge_person p ON p.email = lower(u.email)
        WHERE u.blocked = 0 AND u.role = 'staff' AND ${notTesterSql('u.email')} AND COALESCE(p.access, 0) = 0 AND COALESCE(p.posting, 0) = 0 ORDER BY u.name LIMIT 300`
    ).all<{ email: string; name: string }>()
  ).results;
  return rows.map((r) => ({ email: r.email.toLowerCase(), name: r.name }));
}

export async function setPerson(env: Env, by: string, email: string, set: { access?: boolean; posting?: boolean }): Promise<Person> {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new HttpError(400, 'bad_email', 'Pick a person.');
  const known = await env.DB.prepare('SELECT email, role FROM hub_users WHERE lower(email) = ? AND blocked = 0 LIMIT 1').bind(e).first<{ email: string; role: string }>();
  if (!known) throw new HttpError(404, 'no_person', 'That person has not signed in to FavorOS.');
  const cur = await personOf(env, e);
  const next = { access: set.access ?? cur.access, posting: set.posting ?? cur.posting };
  // A person who posts must also be able to open the page.
  if (next.posting) next.access = true;
  await env.DB.prepare(
    `INSERT INTO ge_person (email, access, posting, set_by, set_at) VALUES (?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET access = excluded.access, posting = excluded.posting, set_by = excluded.set_by, set_at = excluded.set_at`
  )
    .bind(e, next.access ? 1 : 0, next.posting ? 1 : 0, by, nowIso())
    .run();
  await logEvent(env, { kind: 'person_set', actor: by, detail: { email: e, access: next.access, posting: next.posting } });
  return personOf(env, e);
}
