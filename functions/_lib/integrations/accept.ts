// Accept on a request: one press turns it into everything it needs.
//   1. The request moves to Approved and gets an owner (the person accepting unless they pick someone).
//   2. A Projects task is made for it (hub_tasks.request_id), in the project picked, and fires task.created so a synced project
//      sends it on to Asana the usual way.
//   3. The person who asked hears about it: a card in a Chat direct message from the owner when they are in the Chat group,
//      otherwise one email. Both pass the request notice gate (requests.notify), so a closed gate tells nobody.
//   4. The owner is offered focus time on their own calendar (holdFocus), through their own Google connection.
//   5. When the task is done the request is done, which sends the done email the board has always sent (taskDoneToRequest),
//      and a request marked done ticks its task (requestDoneToTask).
// Testers: a request accepted by a tester tells nobody and never writes to a calendar (the middleware refuses their writes too).
import { HttpError, newId, nowIso, type Env } from '../http';
import { addEvent as addRequestEvent, getRequest, setStatus, type RequestRow } from '../db';
import { notifyRequestDone } from '../notify';
import { isTester } from '../testuser';
import { isBlocked } from '../blocked';
import { allowedAmong } from '../access';
import { staffDirectory } from '../people';
import { addFollower, noticeGate, taskOf, toldDone, upsertTask, type Actor, type TaskEnv } from '../requests/tasks';
import { emailOn, send } from '../requests/mail';
import { C, LOGO, brandRow, esc, shell } from '../requests/email';
import { postCard } from '../chat/tasks';
import type { TaskRow as HubTask, ProjectRow } from '../projects/db';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
export const ORIGIN = 'https://dash.favorintl.org';
const ET = 'America/New_York';

export interface AcceptOptions {
  ok: true;
  request: { id: string; title: string; status: string; submitter: { email: string; name: string } };
  projects: Array<{ id: string; key: string; name: string; synced: boolean }>;
  owner: string;
  task: { id: string; code: string | null; url: string } | null;
  requester: { email: string; name: string; staff: boolean; chat: boolean; told: boolean; via: 'chat' | 'email' | 'none' };
  focus: { mine: boolean; ready: boolean; holds: Array<{ id: string; start: string; end: string }> };
}

export interface AcceptResult {
  ok: true;
  task: { id: string; code: string | null; title: string; url: string; project: string | null; synced: boolean; existing: boolean };
  told: { via: 'chat' | 'email' | 'none'; email: string; why: string };
  focus: { offer: boolean; ready: boolean };
}

async function projectsFor(env: Env, actor: Actor): Promise<AcceptOptions['projects']> {
  try {
    const { listProjects } = await import('../projects/projects');
    const { projectStanding } = await import('../projects/access');
    const { syncedProject } = await import('../projects/sync');
    const list = await listProjects(env, actor);
    const out: AcceptOptions['projects'] = [];
    for (const p of list) {
      if (p.status === 'archived' || p.status === 'done') continue;
      if (!(await projectStanding(env, actor, p as ProjectRow)).edit) continue;
      out.push({ id: p.id, key: p.key, name: p.name, synced: !!(await syncedProject(env, p.id).catch(() => null)) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Whether the requester can be reached in Chat: a Favor address, not blocked, and inside the Chat access group. */
async function chatReach(env: Env, email: string): Promise<boolean> {
  if (!FAVOR.test(email) || isTester(email)) return false;
  if (await isBlocked(env, email).catch(() => true)) return false;
  return (await allowedAmong(env, 'chat', [email]).catch(() => [] as string[])).includes(email);
}

async function calendarReady(env: Env, email: string): Promise<boolean> {
  try {
    const { mayBook } = await import('../meetcal');
    return (await mayBook(env as never, email)).ok;
  } catch {
    return false;
  }
}

export async function linkedTask(env: Env, requestId: string): Promise<HubTask | null> {
  return env.DB.prepare(`SELECT * FROM hub_tasks WHERE request_id = ? AND status <> 'dropped' ORDER BY created_at LIMIT 1`).bind(requestId).first<HubTask>().catch(() => null);
}

async function holdsOf(env: Env, requestId: string, email: string) {
  const r = await env.DB.prepare('SELECT id, starts_at, ends_at FROM hub_focus_holds WHERE request_id = ? AND email = ? AND removed_at IS NULL ORDER BY starts_at')
    .bind(requestId, lower(email))
    .all<{ id: string; starts_at: string; ends_at: string }>()
    .catch(() => ({ results: [] as Array<{ id: string; starts_at: string; ends_at: string }> }));
  return (r.results || []).map((h) => ({ id: h.id, start: h.starts_at, end: h.ends_at }));
}

const taskUrl = (t: Pick<HubTask, 'id'>) => `/projects/?t=${encodeURIComponent(t.id)}`;

/** What the Accept sheet needs: the projects this person may add to, who asked, and whether they are in Chat. */
export async function acceptOptions(env: TaskEnv, row: RequestRow, actor: Actor): Promise<AcceptOptions> {
  if (!actor.admin) throw new HttpError(403, 'forbidden', 'Only a FavorOS admin can accept a request.');
  const t = await taskOf(env, row.id).catch(() => null);
  const owner = lower(t?.owner_email || actor.email);
  const submitter = lower(row.submitter_email);
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [lower(p.email), p]));
  const chat = submitter ? await chatReach(env, submitter) : false;
  const gate = await noticeGate(env);
  const linked = await linkedTask(env, row.id);
  const mine = owner === lower(actor.email);
  return {
    ok: true,
    request: { id: row.id, title: row.title, status: row.status, submitter: { email: submitter, name: dir.get(submitter)?.name || row.submitter_name || submitter } },
    projects: await projectsFor(env, actor),
    owner,
    task: linked ? { id: linked.id, code: linked.code, url: taskUrl(linked) } : null,
    requester: {
      email: submitter,
      name: dir.get(submitter)?.name || row.submitter_name || '',
      staff: FAVOR.test(submitter),
      chat,
      told: !!submitter && gate(submitter) && !isTester(submitter),
      via: !submitter || submitter === owner ? 'none' : chat ? 'chat' : 'email',
    },
    focus: { mine, ready: mine ? await calendarReady(env, actor.email) : false, holds: mine ? await holdsOf(env, row.id, actor.email) : [] },
  };
}

function acceptedEmail(row: RequestRow, owner: { name: string; email: string }, task: { code: string | null }, to: { name: string }) {
  const open = `${ORIGIN}/requests/?r=${encodeURIComponent(row.id)}`;
  const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'Someone';
  const line = `<b>${esc(owner.name)}</b> accepted your request and is working on it.`;
  const inner =
    brandRow('Accepted') +
    `<tr><td class="fv-pad" style="padding:22px 28px 0;font:400 15px/1.5 Arial,sans-serif;color:${C.ink2}">Hi ${esc(first(to.name))}, ${line.replace(/<b>/g, `<b style="color:${C.ink}">`)}</td></tr>` +
    `<tr><td class="fv-pad" style="padding:14px 28px 0"><a href="${esc(open)}" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(row.title)}</a></td></tr>` +
    (task.code ? `<tr><td class="fv-pad" style="padding:8px 28px 0;font:600 13px/1.4 Arial,sans-serif;color:${C.ink3}">Task ${esc(task.code)}</td></tr>` : '') +
    `<tr><td class="fv-pad" style="padding:18px 28px 0"><a href="${esc(open)}" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">Open the request &rarr;</a></td></tr>` +
    `<tr><td class="fv-pad" style="padding:20px 28px 24px"><div style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">You get one more email when it is done. <img src="${LOGO}" alt="" width="1" height="1" style="border:0" /></div></td></tr>`;
  const text = [`Hi ${first(to.name)}, ${owner.name} accepted your request and is working on it.`, row.title, task.code ? `Task ${task.code}` : '', '', `Open the request: ${open}`, '', 'You get one more email when it is done.'].filter((x, i) => x || i > 2).join('\n');
  return { subject: `Accepted: ${row.title}`.slice(0, 140), html: shell(inner, `${owner.name} is working on it`), text };
}

/**
 * Accept. Admins only (triage stays with hub admins). Safe to press twice: the task is found again by its request id and the
 * person who asked is told once (the history row 'accepted' marks it).
 */
export async function acceptRequest(env: TaskEnv, row: RequestRow, actor: Actor, b: Record<string, unknown>): Promise<AcceptResult> {
  if (!actor.admin) throw new HttpError(403, 'forbidden', 'Only a FavorOS admin can accept a request.');
  if (row.status === 'done' || row.status === 'declined') throw new HttpError(400, 'bad_status', 'This request is already closed.');
  const dir = new Map((await staffDirectory(env).catch(() => [])).map((p) => [lower(p.email), p]));
  const ownerEmail = lower(b.owner_email || (await taskOf(env, row.id).catch(() => null))?.owner_email || actor.email);
  if (!FAVOR.test(ownerEmail) || !dir.has(ownerEmail)) throw new HttpError(400, 'unknown_person', 'Pick the owner from the staff list.');
  if (isTester(actor.email) && !isTester(ownerEmail)) throw new HttpError(403, 'test_user', 'The test user can only accept for a test user.');
  const due = typeof b.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;

  // 1. Approved, with an owner.
  const fresh = row.status === 'inbox' ? await setStatus(env, row.id, 'approved', actor.name.split(' ')[0] || actor.name) : row;
  const prevTask = await taskOf(env, row.id).catch(() => null);
  await upsertTask(env, row.id, {
    owner_email: ownerEmail,
    ...(prevTask?.owner_email !== ownerEmail ? { sent_by: actor.email, sent_at: nowIso() } : {}),
    ...(due ? { due_date: due } : {}),
  });
  await addFollower(env, row.id, ownerEmail, 'owner');

  // 2. The task.
  const { createTask } = await import('../projects/tasks');
  const { fire } = await import('../projects/hooks');
  const projectId = typeof b.project_id === 'string' && b.project_id ? b.project_id : undefined;
  const asked = row.submitter_name || row.submitter_email || 'someone';
  const made = await createTask(env, actor, {
    title: row.title.slice(0, 300),
    project_id: projectId,
    owner_email: ownerEmail,
    due_date: due || undefined,
    description: `Request from ${asked}: ${ORIGIN}/requests/?r=${encodeURIComponent(row.id)}\n\n${String(row.body || '').slice(0, 4000)}`,
    request_id: row.id,
  });
  // The person who asked follows the task without a second notice: Accept tells them once, below.
  const asker = lower(row.submitter_email);
  if (!made.existing && FAVOR.test(asker) && asker !== ownerEmail && !isTester(actor.email) && !isTester(asker)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')`).bind(made.task.id, asker).run().catch(() => undefined);
  }
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'request', request: row.id }, told: made.told });
  let synced = false;
  if (made.project) {
    const { syncedProject } = await import('../projects/sync');
    synced = !!(await syncedProject(env, made.project.id).catch(() => null));
  }

  // 3. Tell the person who asked, once.
  const submitter = lower(row.submitter_email);
  let told: AcceptResult['told'] = { via: 'none', email: submitter, why: '' };
  const already = await env.DB.prepare(`SELECT 1 AS ok FROM events WHERE request_id = ? AND kind = 'accepted' LIMIT 1`).bind(row.id).first().catch(() => null);
  if (!submitter) told.why = 'Nobody to tell: the request has no email.';
  else if (submitter === ownerEmail) told.why = 'The person who asked is the owner.';
  else if (already) told.why = 'Already told when it was first accepted.';
  else if (isTester(actor.email) || isTester(submitter)) told.why = 'Test accounts tell nobody.';
  else if (await isBlocked(env, submitter).catch(() => true)) told.why = 'That person no longer has FavorOS.';
  else if (!(await noticeGate(env))(submitter)) told.why = 'Request notices are off, so nobody was told.';
  else if (await chatReach(env, submitter)) {
    await postCard(env, { from: ownerEmail, to: submitter, requestId: row.id, kind: 'accepted', note: typeof b.note === 'string' ? b.note.slice(0, 600) : '' });
    told = { via: 'chat', email: submitter, why: '' };
  } else if (await emailOn(env)) {
    const owner = { email: ownerEmail, name: dir.get(ownerEmail)?.name || ownerEmail };
    const ok = await send(env, { to: submitter, ...acceptedEmail(fresh, owner, made.task, { name: dir.get(submitter)?.name || row.submitter_name || '' }) }).catch(() => false);
    told = ok ? { via: 'email', email: submitter, why: '' } : { via: 'none', email: submitter, why: 'The email did not go out.' };
  } else told.why = 'Request email is switched off.';
  if (told.via !== 'none' || !already) {
    await env.DB.prepare(`INSERT INTO events (id, request_id, kind, actor, payload, created_at) VALUES (?, ?, 'accepted', ?, ?, ?)`)
      .bind(newId('evt'), row.id, actor.name, JSON.stringify({ owner: ownerEmail, task: made.task.id, code: made.task.code, told: told.via }), nowIso())
      .run()
      .catch(() => undefined);
  }

  const mine = ownerEmail === lower(actor.email);
  return {
    ok: true,
    task: { id: made.task.id, code: made.task.code, title: made.task.title, url: taskUrl(made.task), project: made.project?.name || null, synced, existing: made.existing },
    told,
    focus: { offer: mine, ready: mine ? await calendarReady(env, actor.email) : false },
  };
}

/* ------------------------------------------------------------------------------------------------ focus time */

/** Up to three open stretches on the owner's own calendar in the next five working days, from the scheduling assistant. */
export async function focusSlots(env: Env, actor: Actor, minutesRaw: unknown): Promise<{ ok: true; minutes: number; slots: Array<{ start: string; end: string; label: string }> }> {
  const minutes = [30, 60, 90, 120].includes(Number(minutesRaw)) ? Number(minutesRaw) : 60;
  const { assistant } = await import('../meetsched');
  const now = Date.now();
  const a = await assistant(env as never, lower(actor.email), { emails: [], durationMin: minutes, from: new Date(now).toISOString(), to: new Date(now + 7 * 86400000).toISOString(), limit: 6, stepMin: 30 });
  const slots = (a.slots || []).filter((s) => s.score >= 1000).slice(0, 3).map((s) => ({
    start: s.start,
    end: s.end,
    label: new Date(s.start).toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  }));
  return { ok: true, minutes, slots };
}

/** Puts a busy "Focus" block on the owner's own primary calendar. Only the owner may, and Google tells nobody (no guests). */
export async function holdFocus(env: TaskEnv, row: RequestRow, actor: Actor, b: Record<string, unknown>): Promise<{ ok: true; hold: { id: string; start: string; end: string } }> {
  const t = await taskOf(env, row.id).catch(() => null);
  if (lower(t?.owner_email) !== lower(actor.email)) throw new HttpError(403, 'owner_only', 'Focus time goes on the owner\'s own calendar. Only the owner can hold it.');
  if (isTester(actor.email)) throw new HttpError(403, 'test_user', 'The test user has no calendar.');
  const start = Date.parse(String(b.start || ''));
  const minutes = [30, 60, 90, 120].includes(Number(b.minutes)) ? Number(b.minutes) : 60;
  if (!start || start < Date.now() - 5 * 60000) throw new HttpError(400, 'bad_time', 'Pick a time that has not passed.');
  const end = start + minutes * 60000;
  const { calFetch } = await import('../meetcal');
  const url = `${ORIGIN}/requests/?r=${encodeURIComponent(row.id)}`;
  const r = await calFetch(env as never, lower(actor.email), '/events?sendUpdates=none', {
    method: 'POST',
    body: {
      summary: `Focus: ${row.title}`.slice(0, 200),
      description: `Time held in FavorOS for this request: ${url}`,
      start: { dateTime: new Date(start).toISOString(), timeZone: ET },
      end: { dateTime: new Date(end).toISOString(), timeZone: ET },
      transparency: 'opaque',
      visibility: 'default',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
      source: { title: 'FavorOS', url },
      extendedProperties: { private: { favorRequest: row.id } },
    },
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new HttpError(502, 'calendar', 'Google Calendar did not take the focus time' + (j.error?.message ? ': ' + j.error.message : '.'));
  const hold = { id: newId('fcs'), start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  await env.DB.prepare('INSERT INTO hub_focus_holds (id, request_id, email, event_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(hold.id, row.id, lower(actor.email), j.id, hold.start, hold.end, nowIso())
    .run();
  return { ok: true, hold };
}

export async function dropFocus(env: TaskEnv, row: RequestRow, actor: Actor, holdId: string): Promise<{ ok: true }> {
  const h = await env.DB.prepare('SELECT * FROM hub_focus_holds WHERE id = ? AND request_id = ? AND removed_at IS NULL').bind(holdId, row.id).first<{ email: string; event_id: string }>();
  if (!h) throw new HttpError(404, 'not_found', 'That focus time is already gone.');
  if (lower(h.email) !== lower(actor.email)) throw new HttpError(403, 'owner_only', 'Only the person whose calendar it is can remove it.');
  const { calFetch } = await import('../meetcal');
  const r = await calFetch(env as never, lower(actor.email), `/events/${encodeURIComponent(h.event_id)}?sendUpdates=none`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new HttpError(502, 'calendar', 'Google Calendar did not remove it.');
  await env.DB.prepare('UPDATE hub_focus_holds SET removed_at = ? WHERE id = ?').bind(nowIso(), holdId).run();
  return { ok: true };
}

/* ------------------------------------------------------------------------------------------------ done, both ways */

/**
 * The task made from a request was ticked: the request is done and the person who asked gets the done email. Runs from the
 * project event hook (task.done) and from the drain sweep for tasks ticked in Asana, which change the table without an event.
 */
export async function taskDoneToRequest(env: TaskEnv, task: Pick<HubTask, 'id' | 'request_id' | 'status' | 'done_by'>, actorName = 'FavorOS'): Promise<boolean> {
  if (!task.request_id || task.status !== 'done') return false;
  const row = await getRequest(env, task.request_id).catch(() => null);
  if (!row || row.status === 'done' || row.status === 'declined') return false;
  // One pass wins: the update that moves it to done is the claim, so the email goes once.
  const now = nowIso();
  const claim = await env.DB.prepare(`UPDATE requests SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done', 'declined')`).bind(now, now, row.id).run();
  if (Number((claim.meta as { changes?: number }).changes) !== 1) return false;
  await addRequestEvent(env, row.id, 'status', actorName, { from: row.status, to: 'done', via: 'task' }).catch(() => undefined);
  const next = (await getRequest(env, row.id)) || { ...row, status: 'done' as const, completed_at: now };
  const by = lower(task.done_by);
  await notifyRequestDone(env, next, { pageUrl: next.page_url }).catch((err) => console.error('[accept] done notify', err));
  await toldDone(env, row.id, { email: by || 'agent', name: actorName, admin: true }).catch(() => undefined);
  return true;
}

/** The request was marked done on the board: its task is ticked too, once, and Asana hears about it through the usual hook. */
export async function requestDoneToTask(env: Env, requestId: string, actor: Actor): Promise<boolean> {
  const t = await linkedTask(env, requestId);
  if (!t || t.status === 'done') return false;
  const now = nowIso();
  const claim = await env.DB.prepare(`UPDATE hub_tasks SET status = 'done', done_at = ?, done_by = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done', 'dropped')`)
    .bind(now, FAVOR.test(actor.email) ? actor.email : null, now, t.id)
    .run();
  if (Number((claim.meta as { changes?: number }).changes) !== 1) return false;
  const { addEvent, projectOf } = await import('../projects/db');
  await addEvent(env, { task_id: t.id, project_id: t.project_id, actor: actor.email, kind: 'done', detail: { from: 'request' } }).catch(() => undefined);
  const { fire } = await import('../projects/hooks');
  const project = t.project_id ? await projectOf(env, t.project_id).catch(() => null) : null;
  await fire(env, { kind: 'task.done', actor: actor.email, actorName: actor.name, task: { ...t, status: 'done', done_at: now, updated_at: now }, project, detail: { fields: ['status'], before: t, from: 'request' } });
  return true;
}

/** The drain sweep: requests still open whose task was ticked (in Asana, or anywhere an event did not fire). Bounded. */
export async function sweepDoneTasks(env: TaskEnv, max = 20): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT t.id, t.request_id, t.status, t.done_by FROM hub_tasks t JOIN requests q ON q.id = t.request_id
      WHERE t.status = 'done' AND q.status NOT IN ('done', 'declined') AND t.done_at > ? LIMIT ?`
  )
    .bind(new Date(Date.now() - 14 * 86400000).toISOString(), max)
    .all<{ id: string; request_id: string; status: string; done_by: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; request_id: string; status: string; done_by: string | null }> }));
  let n = 0;
  for (const t of r.results || []) if (await taskDoneToRequest(env, t as never).catch(() => false)) n++;
  return n;
}

/** The project hook: a ticked task made from a request closes the request. Nothing else is touched. */
export async function onTaskEvent(env: Env, ev: { kind: string; actor: string; actorName?: string; task?: HubTask | null; detail?: Record<string, unknown> }): Promise<void> {
  if (ev.kind !== 'task.done' || !ev.task?.request_id) return;
  if (ev.detail && ev.detail.from === 'request') return; // the request closed it; nothing to send back
  await taskDoneToRequest(env as TaskEnv, ev.task, ev.actorName || ev.actor);
}
