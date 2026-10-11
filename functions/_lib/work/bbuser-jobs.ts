// Blackbaud user requests. SKY has no user endpoint, so Admin > Blackbaud users saves a request here (bb_user_jobs) and the desktop
// automation (webview/nxt_user_jobs.py) claims it, runs it in the Blackbaud web view and reports back. The hub never touches Blackbaud.
//
//   queued     an admin asked; nothing has run.
//   running    the desktop has it.
//   checked    the desktop ran every step up to the confirm screen and stopped there (a dry run). Nothing changed in Blackbaud.
//   done       the desktop confirmed it and read the user back.
//   failed     the desktop stopped and said why (the result line).
//   cancelled  an admin took it back before the desktop claimed it.
import { HttpError, newId, nowIso, type Env } from '../http';
import { loadUsers } from './bbusers';

export const KINDS = ['add', 'access', 'deactivate'] as const;
export type Kind = (typeof KINDS)[number];
export const STATES = ['queued', 'running', 'checked', 'done', 'failed', 'cancelled'] as const;
export type State = (typeof STATES)[number];
/** States that still wait on the desktop or on a go-ahead. A second request for the same person and kind is refused while one is open. */
export const OPEN: State[] = ['queued', 'running', 'checked'];

/** The role each feature area offers at Favor (read from the Add user form 2026-10-06). One level per area. */
export const ROLE_AREAS: Record<string, { label: string; levels: string[] }> = {
  fundraising: { label: 'Fundraising', levels: ['View Only', 'Update', 'Manage Opportunities', 'Fundraiser Permissions'] },
  analysis: { label: 'Analysis', levels: ['View Only'] },
  marketing: { label: 'Marketing', levels: ['View Only', 'Emails'] },
  events: { label: 'Events', levels: ['Update'] },
};
/** The database view security groups (read 2026-10-06). */
export const GROUPS = [
  'Appeal Management', 'Campaign Management', 'Constituent Management', 'Event Management', 'Export', 'Fund Management', 'Gift Processing',
  'Membership Management', 'Merge Duplicates', 'Post to the GL', 'Proposals/Opportunities', 'Query', 'Supervisor users', 'View Only Everything',
  'View-Financial', 'View-General',
];
/** The two shortcuts the form offers. "Normal user" is the set Will accepted for a staff member on 2026-10-06. */
export const PRESETS: Record<string, Access> = {
  normal: { solutionAdmin: false, roles: { fundraising: 'View Only', analysis: 'View Only', marketing: 'View Only' }, groups: ['Query', 'View Only Everything'] },
  solution_admin: { solutionAdmin: true, roles: {}, groups: [] },
};

export interface Access {
  solutionAdmin: boolean;
  roles: Record<string, string>;
  groups: string[];
}

export interface JobInput {
  kind?: string;
  email?: string;
  first?: string;
  last?: string;
  preset?: string;
  access?: Partial<Access>;
}

export interface JobRow {
  id: string;
  kind: Kind;
  target_email: string;
  target_name: string;
  payload: string;
  state: State;
  requested_by: string;
  requested_email: string;
  requested_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  attempts: number;
  result: string;
}

const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The access a request asks for, checked against the lists above. A preset fills what the request leaves out. */
export function cleanAccess(input: JobInput): Access {
  const base = input.preset ? PRESETS[input.preset] : undefined;
  if (input.preset && !base) throw new HttpError(400, 'bad_preset', 'Pick Normal user or Solution admin, or set the access by hand.');
  const given = input.access && typeof input.access === 'object' ? input.access : undefined;
  const solutionAdmin = given && given.solutionAdmin !== undefined ? given.solutionAdmin === true : base ? base.solutionAdmin : false;
  const rolesIn = given && given.roles && typeof given.roles === 'object' ? given.roles : base ? base.roles : {};
  const roles: Record<string, string> = {};
  for (const [area, level] of Object.entries(rolesIn)) {
    const a = ROLE_AREAS[area];
    if (!a) throw new HttpError(400, 'bad_role', 'That is not a Blackbaud feature area.');
    if (!level) continue;
    const hit = a.levels.find((l) => l.toLowerCase() === String(level).toLowerCase());
    if (!hit) throw new HttpError(400, 'bad_role', `${a.label} has no role called ${clean(level, 40)}.`);
    roles[area] = hit;
  }
  const groupsIn = Array.isArray(given?.groups) ? (given!.groups as unknown[]) : base ? base.groups : [];
  const groups: string[] = [];
  for (const g of groupsIn) {
    const hit = GROUPS.find((x) => x.toLowerCase() === String(g).toLowerCase());
    if (!hit) throw new HttpError(400, 'bad_group', `${clean(g, 40)} is not a database view security group.`);
    if (!groups.includes(hit)) groups.push(hit);
  }
  if (!solutionAdmin && !Object.keys(roles).length && !groups.length) throw new HttpError(400, 'no_access', 'Give the user at least one role or group, or make them a solution admin.');
  return { solutionAdmin, roles, groups };
}

export interface Who { actor: string; email: string }

/** Save one request. Refused when the user is already listed (add), is not listed (access, deactivate), or already has an open request. */
export async function createJob(env: Env, who: Who, input: JobInput): Promise<JobRow> {
  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) throw new HttpError(400, 'bad_kind', 'Pick add, change access or deactivate.');
  const email = clean(input.email, 160).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email', 'Enter the user\'s email address.');
  const snap = await loadUsers(env);
  const listed = (snap?.users || []).find((u) => u.email.toLowerCase() === email);
  let name = listed ? listed.name : '';
  let payload: Record<string, unknown> = {};

  if (kind === 'add') {
    const first = clean(input.first, 60);
    const last = clean(input.last, 60);
    if (!first || !last) throw new HttpError(400, 'bad_name', 'Enter the first and last name.');
    if (listed) throw new HttpError(409, 'already_listed', listed.active ? 'That email already has a Blackbaud login.' : 'That email has an inactive Blackbaud login. Reactivating one is done in Blackbaud.');
    name = `${first} ${last}`;
    payload = { first, last, access: cleanAccess(input) };
  } else {
    if (!listed) throw new HttpError(404, 'not_listed', snap ? 'No Blackbaud login has that email.' : 'The users list has not been read yet.');
    if (!listed.active) throw new HttpError(409, 'inactive', 'That login is already inactive.');
    if (email === who.email.toLowerCase()) throw new HttpError(403, 'own_login', 'Ask another admin to change your own login.');
    if (kind === 'access') payload = { access: cleanAccess(input) };
  }

  const dup = await env.DB.prepare(`SELECT id FROM bb_user_jobs WHERE target_email = ? AND kind = ? AND state IN ('queued','running','checked') LIMIT 1`).bind(email, kind).first();
  if (dup) throw new HttpError(409, 'already_waiting', 'There is already an open request of that kind for this user. Wait for it or cancel it first.');

  const id = newId('bbj');
  const at = nowIso();
  await env.DB.prepare('INSERT INTO bb_user_jobs (id, kind, target_email, target_name, payload, state, requested_by, requested_email, requested_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, kind, email, name, JSON.stringify(payload), 'queued', who.actor, who.email, at)
    .run();
  await auditJob(env, who, id, kind, email, 'requested', null);
  return (await env.DB.prepare('SELECT * FROM bb_user_jobs WHERE id = ?').bind(id).first<JobRow>())!;
}

async function auditJob(env: Env, who: Who, id: string, kind: string, email: string, what: string, note: string | null): Promise<void> {
  const word = { add: 'Add Blackbaud user', access: 'Change Blackbaud access', deactivate: 'Deactivate Blackbaud user' }[kind] || kind;
  await env.DB.prepare('INSERT INTO hub_audit (at, actor, area, key, label, before_value, after_value, note) VALUES (?,?,?,?,?,?,?,?)')
    .bind(nowIso(), who.email || who.actor, 'bbusers', `job:${id}`, `${word}: ${email}`, null, what, note || '')
    .run()
    .catch(() => undefined);
}

export async function listJobs(env: Env, limit = 30): Promise<JobRow[]> {
  const r = await env.DB.prepare('SELECT * FROM bb_user_jobs ORDER BY requested_at DESC, id DESC LIMIT ?').bind(Math.min(100, Math.max(1, limit))).all<JobRow>().catch(() => ({ results: [] as JobRow[] }));
  return r.results;
}

export async function cancelJob(env: Env, who: Who, id: string): Promise<JobRow> {
  const out = await env.DB.prepare(`UPDATE bb_user_jobs SET state = 'cancelled', finished_at = ?, result = 'Cancelled before the desktop took it.' WHERE id = ? AND state IN ('queued','checked')`).bind(nowIso(), id).run();
  const row = await env.DB.prepare('SELECT * FROM bb_user_jobs WHERE id = ?').bind(id).first<JobRow>();
  if (!row) throw new HttpError(404, 'no_job', 'No such request.');
  if (!Number(out.meta?.changes)) throw new HttpError(409, 'not_cancellable', row.state === 'running' ? 'The desktop is running it now.' : 'That request has finished.');
  await auditJob(env, who, id, row.kind, row.target_email, 'cancelled', null);
  return row;
}

/** A request the desktop holds for longer than this is handed back (or failed after three tries). */
export const STALE_MINUTES = 30;
export const MAX_ATTEMPTS = 3;

/**
 * The desktop asks for its next request. The oldest queued one goes to it. With takeChecked (the desktop is allowed to apply) a request
 * it only checked before goes too. Returns null when nothing waits. One request at a time: nothing is handed out while another runs.
 */
export async function claimJob(env: Env, opts: { takeChecked?: boolean } = {}): Promise<JobRow | null> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
  await env.DB.prepare(`UPDATE bb_user_jobs SET state = 'failed', finished_at = ?, result = 'The desktop stopped answering three times.' WHERE state = 'running' AND claimed_at < ? AND attempts >= ?`).bind(nowIso(), cutoff, MAX_ATTEMPTS).run();
  await env.DB.prepare(`UPDATE bb_user_jobs SET state = 'queued', result = 'The desktop stopped answering; trying again.' WHERE state = 'running' AND claimed_at < ?`).bind(cutoff).run();
  const busy = await env.DB.prepare(`SELECT id FROM bb_user_jobs WHERE state = 'running' LIMIT 1`).first();
  if (busy) return null;
  const states = opts.takeChecked ? `('queued','checked')` : `('queued')`;
  const row = await env.DB.prepare(`SELECT * FROM bb_user_jobs WHERE state IN ${states} ORDER BY requested_at, id LIMIT 1`).first<JobRow>();
  if (!row) return null;
  const upd = await env.DB.prepare(`UPDATE bb_user_jobs SET state = 'running', claimed_at = ?, attempts = attempts + 1, result = '' WHERE id = ? AND state IN ${states}`).bind(nowIso(), row.id).run();
  if (!Number(upd.meta?.changes)) return null;
  return { ...row, state: 'running', attempts: row.attempts + 1 };
}

export async function reportJob(env: Env, who: Who, input: { id?: string; state?: string; result?: string }): Promise<JobRow> {
  const id = clean(input.id, 60);
  const state = ['checked', 'done', 'failed'].find((s) => s === input.state) as State | undefined;
  if (!state) throw new HttpError(400, 'bad_state', 'Report checked, done or failed.');
  const result = clean(input.result, 400);
  const out = await env.DB.prepare(`UPDATE bb_user_jobs SET state = ?, result = ?, finished_at = ? WHERE id = ? AND state = 'running'`).bind(state, result, nowIso(), id).run();
  const row = await env.DB.prepare('SELECT * FROM bb_user_jobs WHERE id = ?').bind(id).first<JobRow>();
  if (!row) throw new HttpError(404, 'no_job', 'No such request.');
  if (!Number(out.meta?.changes)) throw new HttpError(409, 'not_running', 'That request is not running.');
  await auditJob(env, who, id, row.kind, row.target_email, state, result);
  return row;
}

/** The plain-words status line the page shows. */
export function statusWords(s: State): string {
  return { queued: 'Waiting for the desktop', running: 'Running on the desktop', checked: 'Checked, not applied', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' }[s];
}
