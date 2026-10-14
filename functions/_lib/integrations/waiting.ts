// Today's "Waiting on" list: what this person is waiting on from others, and the questions others are waiting on them to answer.
//   Mail       emails you sent with no reply after three days (Mail's own rule, smart.ts waitingOn)
//   Chat       your questions in a direct message, or to someone you named in a channel, with no answer after two hours
//   Chat       questions to you (a direct message or a mention) you have not answered after an hour
//   Tasks      tasks you gave someone that have not moved in three days
//   Requests   requests you sent on that have not moved in three days
//   Meetings   action items from meetings you ran, owned by someone else, due or past due and not done
// Each line you wait on has Nudge, sent in the line's own channel: a reply on the email thread, a message in the same Chat
// conversation, a comment on the task or request that names the person, and for a meeting item a Chat message (or an email to
// someone outside the Chat group). One nudge a line a day. "Stop waiting" takes a line off without touching its source.
import { HttpError, newId, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { accessOf } from '../hub/today';
import { staffDirectory } from '../people';
import { allowedAmong } from '../access';
import { isTester, isHiddenAccount, TESTER_REFUSAL } from '../testuser';
import { mailboxOf } from './mailbox';
import { waitingOn } from '../mail/smart';
import { mayReach, ping, postChat } from './ping';
import { plainText } from './inbox';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clip = (s: unknown, n: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t;
};
const H = 3600e3;
const DAY = 24 * H;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export type WaitKind = 'mail' | 'chat' | 'chat-in' | 'task' | 'request' | 'meeting';
export interface WaitItem {
  id: string;
  kind: WaitKind;
  /** out: you wait on them. in: they wait on you. */
  dir: 'out' | 'in';
  app: 'Mail' | 'Chat' | 'Projects' | 'Requests' | 'Meetings';
  title: string;
  text: string;
  who: { email: string; name: string };
  since: string;
  days: number;
  href: string;
  /** How Nudge reaches them, or null when there is nothing to nudge (a question waiting on you). */
  nudge: { channel: 'mail' | 'chat' | 'email' | 'task' | 'request'; label: string } | null;
  /** The nudge text the sheet starts from; the person can change it. */
  draft: string;
  nudged: string | null;
}

/** A question: a question mark that ends a sentence, outside links. */
export function isQuestion(body: string): boolean {
  const t = String(body || '').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]+>/g, ' ');
  return /\?(\s|$|["')\]])/.test(t);
}

async function dirMap(env: Env): Promise<Map<string, string>> {
  const dir = await staffDirectory(env).catch(() => []);
  return new Map(dir.map((p) => [p.email, p.name]));
}

async function nudgedToday(env: Env, me: string): Promise<Map<string, string>> {
  const r = await env.DB.prepare('SELECT item, MAX(at) AS at FROM hub_nudges WHERE email = ? AND at > ? GROUP BY item').bind(me, new Date(Date.now() - 7 * DAY).toISOString()).all<{ item: string; at: string }>().catch(() => ({ results: [] as Array<{ item: string; at: string }> }));
  return new Map((r.results || []).map((x) => [x.item, x.at]));
}

async function cleared(env: Env, me: string): Promise<Set<string>> {
  const r = await env.DB.prepare('SELECT item FROM hub_today_cleared WHERE email = ?').bind(me).all<{ item: string }>().catch(() => ({ results: [] as Array<{ item: string }> }));
  return new Set((r.results || []).map((x) => x.item));
}

/** The part read from this hub's own tables. */
export async function fastWaiting(env: Env, request: Request, user: HubUser): Promise<WaitItem[]> {
  const me = lower(user.email);
  const tester = isTester(me);
  const access = await accessOf(env, request, user);
  const dir = await dirMap(env);
  const nameOf = (e: string) => dir.get(lower(e)) || (lower(e) === 'tester2@favorintl.org' ? 'FavorOS Tester Two' : lower(e) === 'tester@favorintl.org' ? 'FavorOS Tester' : String(e || '').split('@')[0]);
  // Real staff never see a line about a test account, and a tester sees only lines about the other tester.
  const visible = (e: string) => (tester ? isTester(e) : !isHiddenAccount(e));
  const out: WaitItem[] = [];
  const jobs: Array<Promise<unknown>> = [];
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();

  if (access.chat) {
    // Your questions with no answer.
    jobs.push(
      (async () => {
        const rows = (await env.DB.prepare(
          `SELECT m.id, m.channel_id, m.thread_id, m.body, m.created_at, c.kind, c.name FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id AND c.archived = 0
            WHERE m.email = ?1 AND m.deleted_at IS NULL AND m.visible_to IS NULL AND m.created_at > ?2 AND m.created_at < ?3 AND m.body LIKE '%?%'
              AND c.id IN (SELECT channel_id FROM chat_members WHERE email = ?1)
            ORDER BY m.id DESC LIMIT 60`
        ).bind(me, since7, new Date(Date.now() - 2 * H).toISOString()).all<{ id: number; channel_id: string; thread_id: number | null; body: string; created_at: string; kind: string; name: string }>()).results || [];
        const seenCh = new Set<string>();
        for (const m of rows) {
          if (!isQuestion(m.body)) continue;
          const key = m.channel_id + '|' + (m.thread_id || 0);
          if (seenCh.has(key)) continue;
          const dm = m.kind === 'dm' || m.kind === 'group';
          let targets: string[];
          if (dm) targets = ((await env.DB.prepare('SELECT email FROM chat_members WHERE channel_id = ? AND email <> ?').bind(m.channel_id, me).all<{ email: string }>()).results || []).map((x) => lower(x.email));
          else targets = [...String(m.body).matchAll(/<@([^>|]+@[^>|]+)(?:\|[^>]*)?>/g)].map((x) => lower(x[1])).filter((e) => e !== me);
          targets = targets.filter((e) => e && !['brain', 'meetings', 'gifts'].includes(e) && visible(e));
          if (!targets.length) continue;
          seenCh.add(key);
          // Answered: someone it was for wrote after it, in the same conversation (a DM) or in its thread (a channel).
          const ph = targets.map(() => '?').join(',');
          const root = m.thread_id || m.id;
          const answered = await env.DB.prepare(
            dm
              ? `SELECT 1 AS ok FROM chat_messages WHERE channel_id = ? AND id > ? AND deleted_at IS NULL AND lower(email) IN (${ph}) LIMIT 1`
              : `SELECT 1 AS ok FROM chat_messages WHERE channel_id = ? AND id > ? AND deleted_at IS NULL AND lower(email) IN (${ph}) AND (thread_id = ${Number(root)} OR id = ${Number(root)} OR ${m.thread_id ? '0' : '1'} = 1) LIMIT 1`
          ).bind(m.channel_id, m.id, ...targets).first().catch(() => ({ ok: 1 }));
          if (answered) continue;
          const who = targets[0];
          const where = dm ? (m.kind === 'dm' ? 'a direct message' : 'a group message') : '#' + m.name;
          out.push({
            id: `wc:${m.id}`,
            kind: 'chat',
            dir: 'out',
            app: 'Chat',
            title: `Your question to ${targets.length > 1 ? nameOf(who) + ' and ' + (targets.length - 1) + ' more' : nameOf(who)} in ${where}`,
            text: clip(plainText(m.body, dir), 200),
            who: { email: who, name: nameOf(who) },
            since: m.created_at,
            days: daysSince(m.created_at),
            href: `/chat/?c=${encodeURIComponent(m.channel_id)}&m=${m.id}${m.thread_id ? '&t=' + m.thread_id : ''}`,
            nudge: { channel: 'chat', label: 'Nudge in Chat' },
            draft: dm ? 'Following up on my question above.' : `<@${who}> following up on my question above.`,
            nudged: null,
          });
        }
      })().catch((e) => console.warn('[waiting] chat out', String(e).slice(0, 160)))
    );
    // Questions to you that you have not answered.
    jobs.push(
      (async () => {
        const rows = (await env.DB.prepare(
          `SELECT m.id, m.channel_id, m.thread_id, m.email, m.body, m.created_at, c.kind, c.name FROM chat_mentions n JOIN chat_messages m ON m.id = n.message_id JOIN chat_channels c ON c.id = n.channel_id AND c.archived = 0
            WHERE n.email = ?1 AND n.kind IN ('dm', 'mention') AND m.deleted_at IS NULL AND (m.visible_to IS NULL OR m.visible_to = ?1) AND m.created_at > ?2 AND m.created_at < ?3
              AND (c.kind = 'public' OR c.id IN (SELECT channel_id FROM chat_members WHERE email = ?1))
            ORDER BY m.id DESC LIMIT 40`
        ).bind(me, since7, new Date(Date.now() - H).toISOString()).all<{ id: number; channel_id: string; thread_id: number | null; email: string; body: string; created_at: string; kind: string; name: string }>()).results || [];
        const seen = new Set<string>();
        for (const m of rows) {
          if (!isQuestion(m.body) || !visible(m.email) || ['brain', 'meetings', 'gifts'].includes(lower(m.email))) continue;
          const key = m.channel_id + '|' + (m.thread_id || 0);
          if (seen.has(key)) continue;
          seen.add(key);
          const dm = m.kind === 'dm' || m.kind === 'group';
          const root = m.thread_id || m.id;
          const answered = await env.DB.prepare(
            dm
              ? 'SELECT 1 AS ok FROM chat_messages WHERE channel_id = ? AND id > ? AND email = ? AND deleted_at IS NULL LIMIT 1'
              : `SELECT 1 AS ok FROM chat_messages WHERE channel_id = ? AND id > ? AND email = ? AND deleted_at IS NULL AND (thread_id = ${Number(root)} OR ${m.thread_id ? '0' : '1'} = 1) LIMIT 1`
          ).bind(m.channel_id, m.id, me).first().catch(() => ({ ok: 1 }));
          if (answered) continue;
          const where = dm ? (m.kind === 'dm' ? 'a direct message' : 'a group message') : '#' + m.name;
          out.push({
            id: `wi:${m.id}`,
            kind: 'chat-in',
            dir: 'in',
            app: 'Chat',
            title: `${nameOf(m.email)} asked you in ${where}`,
            text: clip(plainText(m.body, dir), 200),
            who: { email: lower(m.email), name: nameOf(m.email) },
            since: m.created_at,
            days: daysSince(m.created_at),
            href: `/chat/?c=${encodeURIComponent(m.channel_id)}&m=${m.id}${m.thread_id ? '&t=' + m.thread_id : ''}`,
            nudge: null,
            draft: '',
            nudged: null,
          });
        }
      })().catch((e) => console.warn('[waiting] chat in', String(e).slice(0, 160)))
    );
  }

  // Tasks you gave someone that have not moved in three days.
  jobs.push(
    env.DB.prepare(
      `SELECT id, title, owner_email, status, due_date, updated_at, created_at FROM hub_tasks
        WHERE lower(created_by) = ?1 AND owner_email IS NOT NULL AND lower(owner_email) <> ?1 AND status IN ('open', 'doing', 'waiting')
          AND COALESCE(updated_at, created_at) < ?2 AND COALESCE(updated_at, created_at) > ?3
        ORDER BY COALESCE(updated_at, created_at) LIMIT 25`
    )
      .bind(me, new Date(Date.now() - 3 * DAY).toISOString(), new Date(Date.now() - 60 * DAY).toISOString())
      .all<{ id: string; title: string; owner_email: string; status: string; due_date: string | null; updated_at: string | null; created_at: string }>()
      .then((r) => {
        for (const t of r.results || []) {
          const who = lower(t.owner_email);
          if (!visible(who)) continue;
          const at = t.updated_at || t.created_at;
          const late = t.due_date && t.due_date < todayEt();
          out.push({
            id: `wt:${t.id}`,
            kind: 'task',
            dir: 'out',
            app: 'Projects',
            title: `${nameOf(who)} has your task: ${clip(t.title, 90)}`,
            text: `No change in ${daysSince(at)} days${late ? `, past its due date of ${t.due_date}` : t.due_date ? `, due ${t.due_date}` : ''}`,
            who: { email: who, name: nameOf(who) },
            since: at,
            days: daysSince(at),
            href: `/projects/?t=${encodeURIComponent(t.id)}`,
            nudge: { channel: 'task', label: 'Nudge on the task' },
            draft: `<@${who}> checking in on this one. Where does it stand?`,
            nudged: null,
          });
        }
      })
      .catch(() => undefined)
  );
  // Requests you sent on that have not moved in three days.
  if (!tester) {
    jobs.push(
      env.DB.prepare(
        `SELECT q.id, q.title, t.owner_email, t.sent_at, q.updated_at FROM request_tasks t JOIN requests q ON q.id = t.request_id
          WHERE lower(t.sent_by) = ?1 AND t.owner_email IS NOT NULL AND lower(t.owner_email) <> ?1 AND q.status NOT IN ('done', 'declined')
            AND q.updated_at < ?2 AND q.updated_at > ?3 ORDER BY q.updated_at LIMIT 20`
      )
        .bind(me, new Date(Date.now() - 3 * DAY).toISOString(), new Date(Date.now() - 60 * DAY).toISOString())
        .all<{ id: string; title: string; owner_email: string; sent_at: string | null; updated_at: string }>()
        .then((r) => {
          for (const q of r.results || []) {
            const who = lower(q.owner_email);
            if (!visible(who)) continue;
            out.push({
              id: `wr:${q.id}`,
              kind: 'request',
              dir: 'out',
              app: 'Requests',
              title: `${nameOf(who)} has your request: ${clip(q.title, 90)}`,
              text: `No change in ${daysSince(q.updated_at)} days`,
              who: { email: who, name: nameOf(who) },
              since: q.updated_at,
              days: daysSince(q.updated_at),
              href: `/requests/?r=${encodeURIComponent(q.id)}`,
              nudge: { channel: 'request', label: 'Nudge on the request' },
              draft: `<@${who}> checking in on this one. Where does it stand?`,
              nudged: null,
            });
          }
        })
        .catch(() => undefined)
    );
  }
  // Action items from meetings you ran, owned by someone else, due today or before and not done. Items already turned into tasks are
  // left to the task line.
  if (access.meetings) {
    jobs.push(
      (async () => {
        const rows = (await env.DB.prepare(
          `SELECT a.meeting_id, a.idx, a.text, a.owner_email, a.owner_name, a.due, m.title, m.starts_at, m.ended_at FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id
            WHERE a.done = 0 AND a.owner_email <> '' AND lower(a.owner_email) <> ?1 AND (lower(m.host_email) = ?1 OR instr(lower(m.cohosts), '"' || ?1 || '"') > 0)
              AND m.status = 'ended' AND COALESCE(m.ended_at, m.starts_at) > ?2
              AND NOT EXISTS (SELECT 1 FROM hub_tasks t WHERE t.meeting_id = a.meeting_id AND t.meeting_action_idx = a.idx AND t.status <> 'dropped')
            ORDER BY COALESCE(m.ended_at, m.starts_at) DESC LIMIT 40`
        ).bind(me, new Date(Date.now() - 45 * DAY).toISOString()).all<{ meeting_id: string; idx: number; text: string; owner_email: string; owner_name: string; due: string; title: string; starts_at: string | null; ended_at: string | null }>()).results || [];
        const { parseWhen } = await import('../projects/links/chat');
        const today = todayEt();
        const chatters = new Set(await allowedAmong(env, 'chat', [me, ...rows.map((r) => lower(r.owner_email))]).catch(() => [] as string[]));
        for (const a of rows) {
          const who = lower(a.owner_email);
          if (!visible(who)) continue;
          const held = a.ended_at || a.starts_at || '';
          const due = parseWhen(a.due, held ? new Date(held) : new Date());
          const stale = !due && held && daysSince(held) >= 3;
          if (!(due && due <= today) && !stale) continue;
          const viaChat = tester || (chatters.has(me) && chatters.has(who));
          out.push({
            id: `wa:${a.meeting_id}.${a.idx}`,
            kind: 'meeting',
            dir: 'out',
            app: 'Meetings',
            title: `${a.owner_name || nameOf(who)}: ${clip(a.text, 110)}`,
            text: `From ${clip(a.title || 'a meeting', 70)}${due ? (due < today ? `, due ${due}` : ', due today') : `, ${daysSince(held)} days ago`}`,
            who: { email: who, name: a.owner_name || nameOf(who) },
            since: held,
            days: daysSince(held),
            href: `/meet/library/?m=${encodeURIComponent(a.meeting_id)}`,
            nudge: { channel: viaChat ? 'chat' : 'email', label: viaChat ? 'Nudge in Chat' : 'Nudge by email' },
            draft: `Checking in on your action item from ${a.title || 'our meeting'}: "${clip(a.text, 160)}". Is it done?`,
            nudged: null,
          });
        }
      })().catch((e) => console.warn('[waiting] meetings', String(e).slice(0, 160)))
    );
  }
  await Promise.all(jobs);
  const [gone, nudged] = await Promise.all([cleared(env, me), nudgedToday(env, me)]);
  return order(out.filter((i) => !gone.has(i.id)).map((i) => ({ ...i, nudged: nudged.get(i.id) || null })));
}

/** Oldest wait first within each side, the lines waiting on you first. */
const order = (list: WaitItem[]) => list.sort((a, b) => (a.dir !== b.dir ? (a.dir === 'in' ? -1 : 1) : a.since < b.since ? -1 : a.since > b.since ? 1 : 0)).slice(0, 60);

/** The Mail part: sent with no reply after three days. */
export async function mailWaiting(env: Env, user: HubUser, fetcher: typeof fetch = fetch): Promise<{ items: WaitItem[]; connected: boolean }> {
  const box = await mailboxOf(env, user, fetcher);
  if (!box) return { items: [], connected: false };
  const me = lower(user.email);
  const rows = await waitingOn(box.ctx, box.gm, 3);
  const [gone, nudged] = await Promise.all([cleared(env, me), nudgedToday(env, me)]);
  const items: WaitItem[] = [];
  for (const r of rows) {
    const to = r.people?.[0];
    if (!to) continue;
    const id = `wm:${r.id}`;
    if (gone.has(id)) continue;
    const who = to.name || to.email;
    items.push({
      id,
      kind: 'mail',
      dir: 'out',
      app: 'Mail',
      title: `${who}${r.partner ? ' (partner)' : ''} has not answered: ${clip(r.subject || '(no subject)', 90)}`,
      text: clip(r.snippet, 180),
      who: { email: lower(to.email), name: who },
      since: new Date(r.date).toISOString(),
      days: Number(r.waitDays) || daysSince(new Date(r.date).toISOString()),
      href: `/mail/#/SENT/${encodeURIComponent(r.id)}`,
      nudge: box.write ? { channel: 'mail', label: 'Nudge by email' } : null,
      draft: `Hi ${String(to.name || '').split(' ')[0] || 'there'},\n\nFollowing up on my note below. Do you have an answer for me?`,
      nudged: nudged.get(id) || null,
    });
  }
  return { items: items.slice(0, 25), connected: true };
}

/** Sends one nudge in the line's own channel. */
export async function nudge(env: Env, request: Request, user: HubUser, idRaw: unknown, textRaw: unknown, fetcher: typeof fetch = fetch): Promise<{ channel: string; at: string }> {
  const me = lower(user.email);
  const id = String(idRaw || '');
  const text = String(textRaw || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  if (!text) throw new HttpError(400, 'empty', 'Write the nudge first.');
  const m = /^(wm|wc|wt|wr|wa):([A-Za-z0-9_.-]{1,80})$/.exec(id);
  if (!m) throw new HttpError(400, 'bad_item', 'That line cannot be nudged.');
  const done = await env.DB.prepare('SELECT at FROM hub_nudges WHERE email = ? AND item = ? AND at > ? LIMIT 1').bind(me, id, new Date(Date.now() - 20 * H).toISOString()).first<{ at: string }>().catch(() => null);
  if (done) throw new HttpError(409, 'nudged', 'You nudged this today. Give it a day.');
  const [, kind, ref] = m;
  let channel = '';
  let to = '';
  if (kind === 'wm') {
    if (!/^[A-Za-z0-9]{6,40}$/.test(ref)) throw new HttpError(400, 'bad_item', 'That conversation was not found.');
    const box = await mailboxOf(env, user, fetcher);
    if (!box || !box.write) throw new HttpError(403, 'mail_scope', 'Nudging by email needs Mail to have permission to send. Open the email in Mail instead.');
    const { shapeMessage } = await import('../mail/gmail');
    const { rawOf } = await import('../mail/mime');
    const { textToHtml } = await import('../mail/sanitize');
    const t = await box.gm.get('/threads/' + ref, { format: 'full' });
    const msgs = ((t?.messages || []) as unknown[]).map((x) => shapeMessage(x)).filter((x) => !x.draft);
    const last = msgs[msgs.length - 1];
    if (!last) throw new HttpError(404, 'not_found', 'That conversation is gone from Gmail.');
    const recips = [...last.to, ...last.cc].filter((a) => lower(a.email) !== me);
    if (!recips.length) throw new HttpError(400, 'no_one', 'Nobody else is on that email.');
    to = lower(recips[0].email);
    const subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`;
    const raw = rawOf({ from: { name: user.name || me, email: me }, to: last.to.filter((a) => lower(a.email) !== me), cc: last.cc.filter((a) => lower(a.email) !== me), bcc: [], subject, html: textToHtml(text), inReplyTo: last.messageId, references: [last.references, last.messageId].filter(Boolean).join(' ').trim(), files: [] });
    await box.gm.send('POST', '/messages/send', { raw, threadId: ref });
    channel = 'mail';
  } else if (kind === 'wc') {
    const store = await import('../chat/db');
    const msg = await store.getMessage(env as never, Number(ref) || 0);
    if (!msg || lower(msg.email) !== me || msg.deleted_at) throw new HttpError(404, 'not_found', 'That message is gone.');
    const ch = await store.getChannel(env as never, msg.channel_id);
    if (!ch) throw new HttpError(404, 'not_found', 'That conversation is gone.');
    const dm = ch.kind === 'dm' || ch.kind === 'group';
    const root = msg.thread_id || msg.id;
    await postChat(env, { email: me, name: user.name || me }, msg.channel_id, text, dm && !msg.thread_id ? null : root, fetcher);
    channel = 'chat';
  } else if (kind === 'wt') {
    const { actorOf } = await import('../requests/tasks');
    const { addComment } = await import('../projects/tasks');
    const actor = actorOf(request, user);
    if (!actor) throw new HttpError(401, 'signin', 'Sign in first.');
    await addComment(env, actor, ref, { body: text });
    channel = 'task';
  } else if (kind === 'wr') {
    if (isTester(me)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
    const { actorOf, addComment } = await import('../requests/tasks');
    const { getRequest } = await import('../db');
    const actor = actorOf(request, user);
    const row = await getRequest(env, ref);
    if (!actor || !row) throw new HttpError(404, 'not_found', 'That request is gone.');
    await addComment(env as never, row, actor, text, { source: 'board' });
    channel = 'request';
  } else {
    const [meetingId, idxRaw] = ref.split('.');
    const a = await env.DB.prepare(
      `SELECT a.text, a.owner_email, m.title, m.host_email, m.cohosts FROM hub_meeting_actions a JOIN hub_meetings m ON m.id = a.meeting_id WHERE a.meeting_id = ? AND a.idx = ?`
    ).bind(meetingId, Number(idxRaw) || 0).first<{ text: string; owner_email: string; title: string; host_email: string; cohosts: string }>();
    if (!a || (lower(a.host_email) !== me && !String(a.cohosts || '').toLowerCase().includes(`"${me}"`))) throw new HttpError(404, 'not_found', 'That action item is not from your meeting.');
    to = lower(a.owner_email);
    if (!mayReach(me, to)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
    const sent = await ping(env, { from: { email: me, name: user.name || me }, to, chat: text, subject: `Your action item from ${a.title || 'our meeting'}`, lines: [text], href: `/meet/library/?m=${encodeURIComponent(meetingId)}`, button: 'Open the meeting notes', origin: new URL(request.url).origin }, fetcher);
    if (sent.channel === 'none') throw new HttpError(502, 'not_sent', 'The nudge did not go out. Try again.');
    channel = sent.channel;
  }
  const at = nowIso();
  await env.DB.prepare('INSERT INTO hub_nudges (id, email, item, to_email, channel, at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId('ndg'), me, id, to, channel, at).run();
  return { channel, at };
}

/** "Stop waiting": the line leaves Today. Its source is untouched. */
export async function stopWaiting(env: Env, user: HubUser, idRaw: unknown, undo = false): Promise<void> {
  const id = String(idRaw || '');
  if (!/^(wm|wc|wi|wt|wr|wa|[a-z]{2,5}):[A-Za-z0-9_.@-]{1,80}$/.test(id)) throw new HttpError(400, 'bad_item', 'That line is not on your list.');
  const me = lower(user.email);
  if (undo) await env.DB.prepare('DELETE FROM hub_today_cleared WHERE email = ? AND item = ?').bind(me, id).run();
  else await env.DB.prepare('INSERT OR REPLACE INTO hub_today_cleared (email, item, at) VALUES (?, ?, ?)').bind(me, id, nowIso()).run();
}
