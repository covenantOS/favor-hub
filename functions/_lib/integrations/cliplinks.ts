// Clip replies and clips tied into the rest of FavorOS.
//   placeClip()        a clip recorded in place as a reply: a Chat message (posted by the page through the Chat API, so pushes
//                      and mentions work as usual), a comment on a task or a request, an email reply or a partner. The clip's
//                      own sharing level decides who can watch (the page sets it with the clip's Share options first).
//   fromClipComment()  a comment on the clip lands in the Chat thread under the clip and in the task's comments, as its author
//   fromChatReply()    a reply in that Chat thread lands on the clip as a comment (called from the Chat route after a thread post)
//   fromTaskComment()  a comment on the task lands on the clip (the project event hook)
//                      hub_clip_mirror holds each pair, so nothing is copied twice or back again.
//   markTask()/markAdjust()  a clip comment made into a task (linked both ways) or marked as an adjustment
//   contact log        a clip sent to a partner can be suggested for the contact log when its sender ticks the box; nothing is
//                      logged until someone with the Work Center presses Log it.
import { HttpError, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { isTester, TESTER_REFUSAL } from '../testuser';
import { ID_RE, mayWatch, rowId, type ClipsEnv } from '../clips';
import * as store from '../chat/db';
import { hydrateAttachments } from '../chat/hydrate';
import { publish, type LiveEnv } from '../chat/live';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const ORIGIN = 'https://dash.favorintl.org';
export const PLACE_KINDS = ['chat', 'mail', 'task', 'request', 'partner'] as const;
type PlaceKind = (typeof PLACE_KINDS)[number];

interface ClipRow { id: string; owner_email: string; owner_name: string; title: string; summary: string; status: string; duration_ms: number; share: number; staff_link: number; access: string | null }

const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const actorOf = (u: { email: string; name?: string; role?: string }) => ({ email: lower(u.email), name: u.name || u.email, admin: u.role === 'admin' });

async function clipOf(env: Env, id: string): Promise<ClipRow> {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not_found', 'That clip does not exist.');
  const c = await env.DB.prepare(`SELECT id, owner_email, owner_name, title, summary, status, duration_ms, share, staff_link, access FROM hub_clips WHERE id = ? AND status IN ('ready', 'processing')`).bind(id).first<ClipRow>();
  if (!c) throw new HttpError(404, 'not_found', 'That clip does not exist.');
  return c;
}

const clipLine = (c: ClipRow, at?: number) => `Clip: ${c.title || 'Untitled clip'} ${ORIGIN}/c/${c.id}${at ? `?t=${Math.floor(at)}` : ''}`;

async function live(env: Env, row: store.MessageRow): Promise<void> {
  if (!(env as unknown as LiveEnv).CHAT_ROOM) return;
  const [msg] = await store.shape(env as never, [row], (a, ch) => hydrateAttachments(env as never, a, ch));
  await publish(env as unknown as LiveEnv, store.audienceOf(row, await store.membersOf(env as never, row.channel_id)), { type: 'message', message: msg });
}

/* ------------------------------------------------------------------------------------------------ the reply */

export async function placeClip(env: Env, user: HubUser, b: Record<string, unknown>): Promise<{ ok: true; posted: PlaceKind | 'none'; suggested: boolean }> {
  const c = await clipOf(env, String(b.clip_id || ''));
  const me = lower(user.email);
  if (lower(c.owner_email) !== me) throw new HttpError(403, 'owner_only', 'Only the person who recorded the clip can send it.');
  const kind = lower(b.kind) as PlaceKind;
  const ref = String(b.ref ?? '').trim().slice(0, 120);
  if (!PLACE_KINDS.includes(kind) || !ref) throw new HttpError(400, 'bad_place', 'Pick where the clip goes.');
  let posted: PlaceKind | 'none' = 'none';
  let messageId: number | null = null;
  let placeRef = ref;
  if (kind === 'chat') {
    // The page posts the clip with the Chat API; here it is tied to that message so comments flow both ways.
    const msg = await store.getMessage(env as never, Number(b.message_id) || 0);
    if (!msg || msg.channel_id !== ref || lower(msg.email) !== me || !String(msg.attachments || '').includes(c.id)) throw new HttpError(400, 'bad_message', 'That message does not carry this clip.');
    messageId = msg.id;
    posted = 'chat';
  } else if (kind === 'task') {
    const { addComment } = await import('../projects/tasks');
    const { fire } = await import('../projects/hooks');
    const actor = actorOf(user);
    const made = await addComment(env, actor, ref, { body: clipLine(c) }, { source: 'clip' });
    placeRef = made.task.id;
    await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_mirror (clip_comment_id, kind, other_id, created_at) VALUES (?, ?, ?, ?)').bind(`place:${c.id}`, 'task', made.comment.id, nowIso()).run();
    await fire(env, { kind: 'task.comment', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { comment: made.comment }, told: made.told }).catch(() => undefined);
    posted = 'task';
  } else if (kind === 'request') {
    const { addComment, readable } = await import('../requests/tasks');
    const row = await readable(env as never, ref, actorOf(user));
    await addComment(env as never, row, actorOf(user), clipLine(c), { source: 'board' });
    posted = 'request';
  } else if (kind === 'partner') {
    if (!/^\d{1,12}$/.test(ref)) throw new HttpError(400, 'bad_place', 'That partner record is not valid.');
  }
  await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_places (clip_id, kind, ref, message_id, by_email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(c.id, kind, placeRef, messageId, me, nowIso())
    .run();
  let suggested = false;
  if (kind === 'partner' && b.suggest_log === true) {
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO hub_clip_contact_log (clip_id, partner_id, by_email, state, summary, detail, created_at, updated_at) VALUES (?, ?, ?, 'suggested', ?, ?, ?, ?)
      ON CONFLICT(clip_id, partner_id) DO UPDATE SET state = CASE WHEN state = 'logged' THEN state ELSE 'suggested' END, updated_at = excluded.updated_at`)
      .bind(c.id, ref, me, `Sent a short video: ${c.title || 'Clip'}`.slice(0, 200), `${c.summary ? c.summary.slice(0, 600) + '\n\n' : ''}${ORIGIN}/c/${c.id}`, now, now)
      .run();
    suggested = true;
  }
  return { ok: true, posted, suggested };
}

/* ------------------------------------------------------------------------------------------------ comments, both ways */

async function mirrored(env: Env, kind: string, otherId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM hub_clip_mirror WHERE kind = ? AND other_id = ?').bind(kind, otherId).first().catch(() => null));
}

/** A new comment on the clip: copied under the clip in each Chat thread and onto each task it was sent to, as its author. */
export async function fromClipComment(env: Env, clipId: string, comment: { id: string; at_seconds: number; author_email: string; author_name: string; body: string }, author: HubUser): Promise<number> {
  const places = (await env.DB.prepare('SELECT kind, ref, message_id FROM hub_clip_places WHERE clip_id = ?').bind(clipId).all<{ kind: string; ref: string; message_id: number | null }>().catch(() => ({ results: [] as Array<{ kind: string; ref: string; message_id: number | null }> }))).results || [];
  if (!places.length) return 0;
  const me = lower(author.email);
  const text = `${comment.at_seconds ? `At ${stamp(comment.at_seconds)}: ` : ''}${comment.body}`.slice(0, 3000);
  let n = 0;
  for (const p of places) {
    try {
      if (p.kind === 'chat' && p.message_id) {
        if (!(await store.isMember(env as never, p.ref, me))) continue;
        const posted = await store.post(env as never, { channel_id: p.ref, email: me, body: text, thread_id: p.message_id });
        await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_mirror (clip_comment_id, kind, other_id, created_at) VALUES (?, ?, ?, ?)').bind(comment.id, 'chat', String(posted.message.id), nowIso()).run();
        await live(env, posted.message).catch(() => undefined);
        n++;
      } else if (p.kind === 'task') {
        const { addComment } = await import('../projects/tasks');
        const made = await addComment(env, actorOf(author), p.ref, { body: text }, { source: 'clip' }).catch(() => null);
        if (!made) continue;
        await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_mirror (clip_comment_id, kind, other_id, created_at) VALUES (?, ?, ?, ?)').bind(comment.id, 'task', made.comment.id, nowIso()).run();
        n++;
      }
    } catch (err) {
      console.warn('[clips] mirror out', p.kind, String((err as Error)?.message || err).slice(0, 160));
    }
  }
  return n;
}

async function addClipComment(env: Env, clip: ClipRow, user: { email: string; name: string }, body: string, kind: 'chat' | 'task', otherId: string): Promise<boolean> {
  const text = String(body || '').trim().slice(0, 2000);
  if (!text) return false;
  const id = rowId('cm');
  await env.DB.prepare('INSERT INTO hub_clip_comments (id, clip_id, at_seconds, author_email, author_name, body, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)').bind(id, clip.id, lower(user.email), user.name || user.email, text, nowIso()).run();
  await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_mirror (clip_comment_id, kind, other_id, created_at) VALUES (?, ?, ?, ?)').bind(id, kind, otherId, nowIso()).run();
  return true;
}

/** A reply in the Chat thread under a clip lands on the clip, when its author may watch the clip. */
export async function fromChatReply(env: Env, msg: { id: number; thread_id: number | null; channel_id: string; email: string; body: string }, user: HubUser): Promise<boolean> {
  if (!msg.thread_id || !msg.body) return false;
  const p = await env.DB.prepare(`SELECT clip_id FROM hub_clip_places WHERE kind = 'chat' AND message_id = ? AND ref = ?`).bind(msg.thread_id, msg.channel_id).first<{ clip_id: string }>().catch(() => null);
  if (!p) return false;
  if (await mirrored(env, 'chat', String(msg.id))) return false;
  const clip = await clipOf(env, p.clip_id).catch(() => null);
  if (!clip || !(await mayWatch(env as ClipsEnv, user, clip as never))) return false;
  return addClipComment(env, clip, { email: user.email, name: user.name }, msg.body, 'chat', String(msg.id));
}

/** A comment on a task a clip was sent to lands on the clip (the project hook). Copies made from the clip are skipped. */
export async function fromTaskComment(env: Env, ev: { kind: string; actor: string; actorName?: string; task?: { id: string } | null; detail?: Record<string, unknown> }): Promise<void> {
  if (ev.kind !== 'task.comment' || !ev.task) return;
  const comment = (ev.detail?.comment || null) as { id?: string; body?: string; source?: string } | null;
  if (!comment?.id || comment.source === 'clip' || comment.source === 'meeting') return;
  const rows = (await env.DB.prepare(`SELECT clip_id FROM hub_clip_places WHERE kind = 'task' AND ref = ?`).bind(ev.task.id).all<{ clip_id: string }>().catch(() => ({ results: [] as Array<{ clip_id: string }> }))).results || [];
  if (!rows.length || (await mirrored(env, 'task', comment.id))) return;
  const u = await env.DB.prepare('SELECT email, name, role FROM hub_users WHERE lower(email) = ?').bind(lower(ev.actor)).first<{ email: string; name: string; role: string }>().catch(() => null);
  const user = { email: lower(ev.actor), name: u?.name || ev.actorName || ev.actor, role: u?.role || 'staff', picture: '', via: 'google', kpi: false } as unknown as HubUser;
  for (const r of rows) {
    const clip = await clipOf(env, r.clip_id).catch(() => null);
    if (!clip || !(await mayWatch(env as ClipsEnv, user, clip as never))) continue;
    await addClipComment(env, clip, { email: user.email, name: user.name }, String(comment.body || ''), 'task', comment.id);
  }
}

/* ------------------------------------------------------------------------------------------------ make it a task, mark an adjustment */

interface CommentRow { id: string; clip_id: string; at_seconds: number; author_email: string; author_name: string; body: string }

async function commentFor(env: Env, user: HubUser, cid: string): Promise<{ c: CommentRow; clip: ClipRow }> {
  const c = await env.DB.prepare('SELECT id, clip_id, at_seconds, author_email, author_name, body FROM hub_clip_comments WHERE id = ?').bind(cid).first<CommentRow>();
  if (!c) throw new HttpError(404, 'not_found', 'That comment is gone.');
  const clip = await clipOf(env, c.clip_id);
  if (!(await mayWatch(env as ClipsEnv, user, clip as never))) throw new HttpError(404, 'not_found', 'That comment is gone.');
  const me = lower(user.email);
  if (me !== lower(clip.owner_email) && me !== lower(c.author_email) && user.role !== 'admin') throw new HttpError(403, 'forbidden', 'The person who recorded the clip or who wrote the comment can do that.');
  return { c, clip };
}

export interface Mark { comment_id: string; task: { id: string; code: string | null; status: string; url: string } | null; adjustment: boolean; adjustment_done: boolean }

export async function marksFor(env: Env, user: HubUser, clipId: string): Promise<{ ok: true; marks: Mark[] }> {
  const clip = await clipOf(env, clipId);
  if (!(await mayWatch(env as ClipsEnv, user, clip as never))) throw new HttpError(404, 'not_found', 'That clip does not exist.');
  const r = await env.DB.prepare(
    `SELECT k.clip_comment_id, k.task_id, k.adjustment, k.adjustment_done, t.code, t.status FROM hub_clip_comment_marks k LEFT JOIN hub_tasks t ON t.id = k.task_id WHERE k.clip_id = ?`
  ).bind(clip.id).all<{ clip_comment_id: string; task_id: string | null; adjustment: number; adjustment_done: number; code: string | null; status: string | null }>().catch(() => ({ results: [] as never[] }));
  return {
    ok: true,
    marks: (r.results || []).map((x) => ({
      comment_id: x.clip_comment_id,
      task: x.task_id && x.status && x.status !== 'dropped' ? { id: x.task_id, code: x.code, status: x.status, url: `/projects/?t=${encodeURIComponent(x.task_id)}` } : null,
      adjustment: !!x.adjustment,
      adjustment_done: !!x.adjustment_done,
    })),
  };
}

async function upsertMark(env: Env, c: CommentRow, me: string, fields: { task_id?: string; adjustment?: number; adjustment_done?: number }): Promise<void> {
  const prev = await env.DB.prepare('SELECT * FROM hub_clip_comment_marks WHERE clip_comment_id = ?').bind(c.id).first<{ task_id: string | null; adjustment: number; adjustment_done: number }>();
  await env.DB.prepare(
    `INSERT INTO hub_clip_comment_marks (clip_comment_id, clip_id, task_id, adjustment, adjustment_done, by_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(clip_comment_id) DO UPDATE SET task_id = excluded.task_id, adjustment = excluded.adjustment, adjustment_done = excluded.adjustment_done, by_email = excluded.by_email, updated_at = excluded.updated_at`
  ).bind(c.id, c.clip_id, fields.task_id ?? prev?.task_id ?? null, fields.adjustment ?? prev?.adjustment ?? 0, fields.adjustment_done ?? prev?.adjustment_done ?? 0, me, nowIso()).run();
}

/** "Make this a task": a task for the person pressing (or the owner they pick) that opens the clip at the comment's moment. */
export async function markTask(env: Env, user: HubUser, cid: string, b: Record<string, unknown>): Promise<{ ok: true; task: { id: string; code: string | null; url: string; existing: boolean } }> {
  const { c, clip } = await commentFor(env, user, cid);
  const had = await env.DB.prepare(`SELECT k.task_id, t.code FROM hub_clip_comment_marks k JOIN hub_tasks t ON t.id = k.task_id WHERE k.clip_comment_id = ? AND t.status <> 'dropped'`).bind(c.id).first<{ task_id: string; code: string | null }>().catch(() => null);
  if (had) return { ok: true, task: { id: had.task_id, code: had.code, url: `/projects/?t=${encodeURIComponent(had.task_id)}`, existing: true } };
  const { createTask } = await import('../projects/tasks');
  const { fire } = await import('../projects/hooks');
  const actor = actorOf(user);
  const where = `${ORIGIN}/c/${clip.id}${c.at_seconds ? `?t=${Math.floor(c.at_seconds)}` : ''}`;
  const made = await createTask(env, actor, {
    title: c.body.replace(/\s+/g, ' ').slice(0, 300),
    project_id: typeof b.project_id === 'string' && b.project_id ? b.project_id : undefined,
    owner_email: typeof b.owner_email === 'string' && b.owner_email ? b.owner_email : undefined,
    description: `From ${c.author_name || c.author_email}'s comment on the clip "${clip.title || 'Untitled clip'}"${c.at_seconds ? ` at ${stamp(c.at_seconds)}` : ''}: ${where}\n\n${c.body}`,
  });
  if (!made.existing) await fire(env, { kind: 'task.created', actor: actor.email, actorName: actor.name, task: made.task, project: made.project, detail: { from: 'clip', clip: clip.id, comment: c.id }, told: made.told });
  await upsertMark(env, c, actor.email, { task_id: made.task.id });
  return { ok: true, task: { id: made.task.id, code: made.task.code, url: `/projects/?t=${encodeURIComponent(made.task.id)}`, existing: made.existing } };
}

/** Marks a comment as an adjustment to make (on), clears it (off), or ticks it done. */
export async function markAdjust(env: Env, user: HubUser, cid: string, b: Record<string, unknown>): Promise<{ ok: true; adjustment: boolean; adjustment_done: boolean }> {
  const { c } = await commentFor(env, user, cid);
  const on = b.on === undefined ? true : !!b.on;
  const done = on && !!b.done;
  await upsertMark(env, c, lower(user.email), { adjustment: on ? 1 : 0, adjustment_done: done ? 1 : 0 });
  return { ok: true, adjustment: on, adjustment_done: done };
}

/* ------------------------------------------------------------------------------------------------ the contact log, by choice */

export async function logSuggestions(env: Env, user: HubUser, partnerId: string) {
  const r = await env.DB.prepare(
    `SELECT l.clip_id, l.partner_id, l.summary, l.state, l.created_at, c.title FROM hub_clip_contact_log l JOIN hub_clips c ON c.id = l.clip_id
      WHERE l.partner_id = ? AND l.state IN ('suggested', 'failed') AND lower(l.by_email) = ? ORDER BY l.created_at DESC LIMIT 5`
  ).bind(partnerId, lower(user.email)).all<{ clip_id: string; partner_id: string; summary: string; state: string; created_at: string; title: string }>().catch(() => ({ results: [] as never[] }));
  return { ok: true, suggestions: (r.results || []).map((x) => ({ clip_id: x.clip_id, partner_id: x.partner_id, title: x.title || 'Clip', summary: x.summary, state: x.state, at: x.created_at })) };
}

export interface LogWriter { log(env: Env, user: HubUser, cid: string, f: { summary: string; description: string; date: string }): Promise<{ state: 'logged' | 'queued'; detail: string }> }

const defaultLogWriter: LogWriter = {
  async log(env, user, cid, f) {
    const [{ workAccessFor }, { scopeFor }, { blackbaudRepo }, edit, svc] = await Promise.all([import('../work/gate'), import('../work/role'), import('../work/repo'), import('../work/edit'), import('../work/service')]);
    const admin = user.role === 'admin';
    const access = await workAccessFor(env, user.email, admin);
    if (!access.ok) throw new HttpError(403, 'no_work_center', 'Logging on a partner record needs the Work Center.');
    const scope = (await scopeFor(env, user.email, admin)) || undefined;
    const ctx = { env, repo: blackbaudRepo(env), actor: user.name || user.email, email: user.email, scope } as import('../work/service').Ctx;
    const me = await edit.meFor(env, user.email);
    const types = await edit.typesByFundraiser(env);
    let fid = me.fid;
    if (!fid) fid = (await edit.partnerContext(ctx, cid).catch(() => ({ holders: [] as Array<{ fid: string }> }))).holders[0]?.fid || null;
    const set = { category: 'Email', type: (fid && types[fid]) || me.type || 'RDD Action', date: f.date, summary: f.summary, description: f.description, fundraisers: fid ? [fid] : [], completed: true, status: 'Completed', direction: 'Outbound' };
    const made = (await svc.createBatch(ctx, { op: 'new', cids: [cid], set, req: `clip-${cid}-${f.summary.length}-${f.date}` } as never)) as { batch?: { id: string }; message?: string };
    if (!made.batch) throw new HttpError(409, 'not_logged', String(made.message || 'Blackbaud did not take it. Nothing was logged.'));
    let left = 1;
    for (let i = 0; i < 3 && left > 0; i++) {
      const r = await svc.runBatch(ctx, made.batch.id);
      left = r.left;
      const failed = r.items.find((x) => x.state === 'failed');
      if (failed) throw new HttpError(502, 'bb_refused', failed.error ? `Blackbaud said: ${failed.error}` : 'Blackbaud turned it down. Nothing was logged.');
      if (r.held) break;
    }
    return { state: left ? 'queued' : 'logged', detail: left ? 'Saved. The Work Center sends it to Blackbaud within minutes.' : 'Logged on the record.' };
  },
};
/** Tests swap this. The live site always uses the default. */
export const logWriter: { current: LogWriter } = { current: defaultLogWriter };

export async function actOnSuggestion(env: Env, user: HubUser, b: Record<string, unknown>): Promise<{ ok: true; state: string; detail: string }> {
  const clipId = String(b.clip_id || '');
  const pid = String(b.partner_id || '');
  const row = await env.DB.prepare('SELECT * FROM hub_clip_contact_log WHERE clip_id = ? AND partner_id = ?').bind(clipId, pid).first<{ by_email: string; state: string; summary: string; detail: string; created_at: string }>();
  if (!row || lower(row.by_email) !== lower(user.email)) throw new HttpError(404, 'not_found', 'That suggestion is gone.');
  if (b.action === 'dismiss') {
    await env.DB.prepare(`UPDATE hub_clip_contact_log SET state = 'dismissed', updated_at = ? WHERE clip_id = ? AND partner_id = ?`).bind(nowIso(), clipId, pid).run();
    return { ok: true, state: 'dismissed', detail: '' };
  }
  if (b.action !== 'log' || b.confirm !== true) throw new HttpError(400, 'confirm', 'Press Log it to log this contact.');
  if (isTester(user.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  if (row.state === 'logged') return { ok: true, state: 'logged', detail: 'Already logged.' };
  const date = new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  try {
    const r = await logWriter.current.log(env, user, pid, { summary: row.summary, description: row.detail, date });
    await env.DB.prepare(`UPDATE hub_clip_contact_log SET state = 'logged', updated_at = ? WHERE clip_id = ? AND partner_id = ?`).bind(nowIso(), clipId, pid).run();
    return { ok: true, state: r.state, detail: r.detail };
  } catch (err) {
    await env.DB.prepare(`UPDATE hub_clip_contact_log SET state = 'failed', updated_at = ? WHERE clip_id = ? AND partner_id = ?`).bind(nowIso(), clipId, pid).run();
    throw err;
  }
}
