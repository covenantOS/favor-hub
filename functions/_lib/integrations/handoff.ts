// "Hand this to <person>": an email conversation, a task, a request or a partner moves to a teammate with a note and the context it
// needs, the teammate hears about it (Chat when they are in the Chat group, email when not), and the giver hears when it is picked up.
//
// What moves at the source:
//   task      the owner becomes the teammate (the task's own "given to you" notice fires) and the note is a comment on the task
//   request   the request is sent on to the teammate, the same as Send on in the request panel (the note opens its conversation)
//   mail      a teammate cannot open someone else's Gmail, so the conversation is assigned in Mail (Mail > Assigned lists it) and,
//             unless the giver unticks it, forwarded from the giver's Gmail so the teammate can answer from their own
//   partner   the partner's follow-up: the teammate gets the partner page, the note and what is open. Blackbaud assignments and
//             fundraiser credit do not change here (those stay with Blackbaud and Partner Care).
// Picked up: the teammate opens the hand-off (its link, or Open on Today), presses Got it, or reads the task or request notice.
import { HttpError, newId, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { isTester, TESTER_REFUSAL } from '../testuser';
import { mayReach, peopleFor, ping } from './ping';
import { lastGiftLine, lifetimeLine } from '../../../shared/giving';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clean = (s: unknown, n: number) => String(s || '').replace(/\r\n/g, '\n').trim().slice(0, n);
const one = (s: unknown, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export type HandoffKind = 'mail' | 'task' | 'request' | 'partner';
export const KINDS: HandoffKind[] = ['mail', 'task', 'request', 'partner'];
const WHAT: Record<HandoffKind, string> = { mail: 'an email', task: 'a task', request: 'a request', partner: 'a partner' };

export interface HandoffRow {
  id: string;
  kind: HandoffKind;
  ref_id: string;
  title: string;
  href: string;
  from_email: string;
  from_name: string;
  to_email: string;
  to_name: string;
  note: string;
  context: string;
  channel: string;
  moved: string;
  created_at: string;
  picked_at: string | null;
  told_at: string | null;
  seen_at: string | null;
}

export interface HandoffInput {
  kind: unknown;
  id: unknown;
  to: unknown;
  note: unknown;
  title?: unknown;
  /** Mail only: also forward the conversation from the giver's Gmail (default on). */
  forward?: unknown;
}

interface Moved {
  title: string;
  href: string;
  context: string;
  moved: string;
  /** The source already told the teammate (a request's own notice and Chat card), so no second ping. */
  told?: 'chat' | 'email' | 'none';
}

async function moveTask(env: Env, request: Request, user: HubUser, id: string, to: string, note: string): Promise<Moved> {
  const { actorOf } = await import('../requests/tasks');
  const { taskAccess, patchTask, addComment } = await import('../projects/tasks');
  const actor = actorOf(request, user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in first.');
  const { task, st } = await taskAccess(env, actor, id);
  if (!st.edit) throw new HttpError(403, 'forbidden', 'Only people on this task or its project can hand it off.');
  if (lower(task.owner_email) === to) throw new HttpError(400, 'same', 'That person already owns this task.');
  await patchTask(env, actor, task.id, { owner_email: to });
  if (note) await addComment(env, actor, task.id, { body: `Handed to <@${to}>: ${note}` }).catch(() => undefined);
  return { title: task.title, href: `/projects/?t=${encodeURIComponent(task.id)}`, context: one(task.description, 1200), moved: 'owner' };
}

async function moveRequest(env: Env, request: Request, user: HubUser, id: string, to: string, note: string): Promise<Moved> {
  if (isTester(user.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  const { actorOf, sendTo } = await import('../requests/tasks');
  const { getRequest } = await import('../db');
  const actor = actorOf(request, user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in first.');
  const row = await getRequest(env, id);
  if (!row) throw new HttpError(404, 'not_found', 'That request is gone.');
  await sendTo(env, row, actor, to, note);
  return { title: row.title, href: `/requests/?r=${encodeURIComponent(row.id)}`, context: one((row as { body?: string }).body, 1200), moved: 'sent', told: 'chat' };
}

async function moveMail(env: Env, user: HubUser, id: string, to: string, toName: string, note: string, forward: boolean): Promise<Moved> {
  if (!/^[A-Za-z0-9]{6,40}$/.test(id)) throw new HttpError(400, 'bad_id', 'That conversation was not found.');
  const { mailboxOf } = await import('./mailbox');
  const box = await mailboxOf(env, user);
  if (!box) throw new HttpError(403, 'mail', 'Connect Mail first.');
  const { shapeMessage } = await import('../mail/gmail');
  const { freshText } = await import('../mail/smart');
  const t = await box.gm.get('/threads/' + id, { format: 'full' });
  const msgs = ((t?.messages || []) as unknown[]).map((m) => shapeMessage(m));
  const last = msgs.filter((m) => !(m.labelIds || []).includes('DRAFT')).pop() || msgs[msgs.length - 1];
  if (!last) throw new HttpError(404, 'not_found', 'That conversation is gone from Gmail.');
  const subject = one(last.subject, 200) || '(no subject)';
  const from = last.from ? `${last.from.name || last.from.email} <${last.from.email}>` : '';
  const text = clean(freshText(last), 4000);
  const me = lower(user.email);
  await env.DB.prepare('INSERT INTO hub_mail_assign (id, owner, thread_id, assignee, subject, note, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('a_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12), me, id, to, subject, note.slice(0, 600), 'open', nowIso())
    .run()
    .catch(() => undefined);
  let moved = 'assigned';
  if (forward && box.write) {
    const { rawOf } = await import('../mail/mime');
    const { sanitizeHtml, textToHtml } = await import('../mail/sanitize');
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
    const head = `<p>${esc(note || 'Handing this one to you.')}</p><p>---------- Forwarded message ---------<br>From: ${esc(from)}<br>Date: ${esc(String(last.date || ''))}<br>Subject: ${esc(subject)}</p>`;
    const html = head + (last.html ? sanitizeHtml(String(last.html)) : textToHtml(text));
    const raw = rawOf({ from: { name: user.name || me, email: me }, to: [{ name: toName, email: to }], cc: [], bcc: [], subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`, html, files: [] });
    await box.gm.send('POST', '/messages/send', { raw });
    moved = 'assigned, forwarded';
  }
  return { title: subject, href: `/mail/#/ALL/${encodeURIComponent(id)}`, context: (from ? `From ${from}\n\n` : '') + text, moved };
}

async function movePartner(env: Env, request: Request, user: HubUser, id: string, to: string): Promise<Moved> {
  if (!/^\d{1,12}$/.test(id)) throw new HttpError(400, 'bad_id', 'No partner has that number.');
  const { requireWork, workAccessFor } = await import('../work/gate');
  await requireWork(env, request);
  const role = await env.DB.prepare('SELECT role FROM hub_users WHERE lower(email) = ?').bind(to).first<{ role: string }>().catch(() => null);
  const theirs = await workAccessFor(env as never, to, role?.role === 'admin').catch(() => null);
  if (!isTester(to) && !(theirs && theirs.ok)) throw new HttpError(400, 'no_work', 'That person cannot open partner pages yet. Pick someone with the Work Center.');
  const { mirrorQ } = await import('../work/partner');
  const q = mirrorQ(env);
  const rows = (await q(
    `SELECT COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name FROM constituents c WHERE c.id = ?1`,
    [id]
  ).catch(() => [])) as Array<{ name: unknown }>;
  const name = one(rows[0]?.name, 120) || `Partner ${id}`;
  // The household's credited giving under the shared rule: soft credits through a DAF count, a recurring schedule is not a gift.
  const { partnerGiving } = await import('../gifts/partner-giving');
  const pg = await partnerGiving(q as never, id).catch(() => null);
  const context = pg && pg.last ? `Last gift: ${lastGiftLine(pg)}` : pg ? `Giving: ${lifetimeLine(pg)}` : 'Giving is not available right now';
  return { title: name, href: `/work/partner/${id}`, context, moved: 'follow-up' };
}

/** Hands one thing to a teammate. */
export async function handOff(env: Env, request: Request, user: HubUser, input: HandoffInput): Promise<HandoffRow> {
  const kind = String(input.kind || '') as HandoffKind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'bad_kind', 'That cannot be handed off.');
  const me = lower(user.email);
  const to = lower(input.to);
  const ref = one(input.id, 80);
  if (!ref) throw new HttpError(400, 'bad_id', 'Nothing was picked to hand off.');
  if (!to || to === me) throw new HttpError(400, 'pick', 'Pick someone other than you.');
  if (!mayReach(me, to)) throw new HttpError(400, 'pick', 'Pick someone on the Favor staff list.');
  const people = await peopleFor(env, me);
  const person = people.find((p) => p.email === to);
  if (!person) throw new HttpError(400, 'pick', 'Pick someone on the Favor staff list.');
  const note = clean(input.note, 1500);
  const moved =
    kind === 'task'
      ? await moveTask(env, request, user, ref, to, note)
      : kind === 'request'
        ? await moveRequest(env, request, user, ref, to, note)
        : kind === 'mail'
          ? await moveMail(env, user, ref, to, person.name, note, input.forward !== false)
          : await movePartner(env, request, user, ref, to);
  const id = 'ho_' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
  const row: HandoffRow = {
    id,
    kind,
    ref_id: ref,
    title: one(moved.title || input.title, 200),
    href: moved.href,
    from_email: me,
    from_name: user.name || me,
    to_email: to,
    to_name: person.name,
    note,
    context: moved.context,
    channel: moved.told || '',
    moved: moved.moved,
    created_at: nowIso(),
    picked_at: null,
    told_at: null,
    seen_at: null,
  };
  // The request's own Send on already told them (notice and Chat card). Everything else gets a ping that opens the hand-off.
  if (!moved.told) {
    const giver = user.name || me;
    const lines = [`${giver} handed you ${WHAT[kind]}: ${row.title}.`, note ? `"${note}"` : '', moved.context && kind !== 'mail' ? moved.context.slice(0, 600) : ''];
    const chat = [`Handed to you: **${row.title}**`, note, kind === 'mail' && moved.moved.includes('forwarded') ? 'I forwarded the email to you so you can answer it from your own inbox.' : '', `Open it: ${new URL(request.url).origin}/h/${id}`].filter(Boolean).join('\n\n');
    const sent = await ping(env, { from: { email: me, name: giver }, to, chat, subject: `${giver} handed you ${WHAT[kind]}: ${row.title}`, lines, href: `/h/${id}`, button: 'Open it in FavorOS', origin: new URL(request.url).origin });
    row.channel = sent.channel;
  }
  await env.DB.prepare(
    `INSERT INTO hub_handoffs (id, kind, ref_id, title, href, from_email, from_name, to_email, to_name, note, context, channel, moved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.kind, row.ref_id, row.title, row.href, row.from_email, row.from_name, row.to_email, row.to_name, row.note, row.context.slice(0, 6000), row.channel, row.moved, row.created_at)
    .run();
  return row;
}

/** The receiver picked it up: stamped once, and the giver hears (a line on their Today and a phone notice). */
export async function pickUp(env: Env, user: HubUser, id: string): Promise<HandoffRow | null> {
  const me = lower(user.email);
  const row = await env.DB.prepare('SELECT * FROM hub_handoffs WHERE id = ?').bind(id).first<HandoffRow>();
  if (!row || row.to_email !== me) return row && row.from_email === me ? row : null;
  if (row.picked_at) return row;
  const at = nowIso();
  const r = await env.DB.prepare('UPDATE hub_handoffs SET picked_at = ? WHERE id = ? AND picked_at IS NULL').bind(at, id).run();
  row.picked_at = at;
  if (Number((r.meta as { changes?: number })?.changes) > 0) await tellGiver(env, row);
  return row;
}

async function tellGiver(env: Env, row: HandoffRow): Promise<void> {
  if (!mayReach(row.to_email, row.from_email)) return;
  try {
    const { pushToPeople } = await import('../push');
    await pushToPeople(env as never, [row.from_email], { title: `${row.to_name || row.to_email} picked it up`, body: row.title, url: row.href || '/', tag: 'handoff-' + row.id });
  } catch {
    // no phone notice; the line on Today still shows
  }
  await env.DB.prepare('UPDATE hub_handoffs SET told_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
}

/**
 * Task and request hand-offs count as picked up once the teammate read the source's own notice (they opened the task or the request).
 * Run when either person's Today loads.
 */
export async function syncPickups(env: Env, email: string): Promise<void> {
  const me = lower(email);
  const open = (await env.DB.prepare(`SELECT * FROM hub_handoffs WHERE picked_at IS NULL AND kind IN ('task', 'request') AND (from_email = ?1 OR to_email = ?1) AND created_at > ?2 LIMIT 30`)
    .bind(me, new Date(Date.now() - 30 * 864e5).toISOString())
    .all<HandoffRow>()
    .catch(() => ({ results: [] as HandoffRow[] }))).results || [];
  for (const h of open) {
    const read =
      h.kind === 'task'
        ? await env.DB.prepare(`SELECT read_at FROM hub_task_notices WHERE email = ? AND task_id = ? AND created_at >= ? AND read_at IS NOT NULL LIMIT 1`).bind(h.to_email, h.ref_id, h.created_at.slice(0, 19)).first<{ read_at: string }>().catch(() => null)
        : await env.DB.prepare(`SELECT read_at FROM request_notices WHERE email = ? AND request_id = ? AND kind = 'sent' AND created_at >= ? AND read_at IS NOT NULL LIMIT 1`).bind(h.to_email, h.ref_id, h.created_at.slice(0, 19)).first<{ read_at: string }>().catch(() => null);
    if (!read) continue;
    const r = await env.DB.prepare('UPDATE hub_handoffs SET picked_at = ? WHERE id = ? AND picked_at IS NULL').bind(read.read_at, h.id).run();
    if (Number((r.meta as { changes?: number })?.changes) > 0) await tellGiver(env, { ...h, picked_at: read.read_at });
  }
}

/** One hand-off, for its giver or its receiver only. */
export async function handoffFor(env: Env, user: HubUser, id: string): Promise<HandoffRow> {
  const me = lower(user.email);
  const row = await env.DB.prepare('SELECT * FROM hub_handoffs WHERE id = ?').bind(id).first<HandoffRow>();
  if (!row || (row.to_email !== me && row.from_email !== me)) throw new HttpError(404, 'not_found', 'That hand-off is not yours.');
  return row;
}

/** Hand-offs this person gave in the last 30 days, newest first, with where each stands. */
export async function givenBy(env: Env, email: string): Promise<HandoffRow[]> {
  const r = await env.DB.prepare('SELECT * FROM hub_handoffs WHERE from_email = ? AND created_at > ? ORDER BY created_at DESC LIMIT 40')
    .bind(lower(email), new Date(Date.now() - 30 * 864e5).toISOString())
    .all<HandoffRow>()
    .catch(() => ({ results: [] as HandoffRow[] }));
  return r.results || [];
}

export const handoffStamp = nowIso;
export const handoffId = () => newId('ho');
