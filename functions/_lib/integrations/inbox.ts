// Today's Inbox: one feed of what came to this person across FavorOS. Mentions and direct messages in Chat, task notices (given to you,
// mentioned, a comment, waiting on you), request notices, meeting mentions, hand-offs to you and hand-offs picked up, expense requests
// waiting for your signature, and from Mail the conversations that need you or that you flagged with a star.
// Each item says where it came from, and clearing it clears it there: a Chat mention is marked read, a notice read, a hand-off
// picked up, a mail conversation archived (Needs you) or unstarred (flagged). Expense requests and new requests clear only by
// deciding them, so they carry an Open button and no Clear.
// Two parts: 'fast' reads only this hub's tables; 'mail' reads Gmail and is drawn when it lands, so Today never waits on Gmail.
import { HttpError, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { accessOf } from '../hub/today';
import { mayHear, noticesFor as requestNotices, readNotices as readRequestNotices } from '../requests/tasks';
import { noticesFor as taskNotices, readNotices as readTaskNotices } from '../projects/notices';
import { clearInbox, inbox as chatInbox } from '../chat/db';
import { approverEmails } from '../expenses/auth';
import { staffDirectory } from '../people';
import { mailboxOf } from './mailbox';
import { scanInbox, forgetScan } from '../mail/smart';
import { applyLabels } from '../mail/sync';
import { forgetCount } from '../mail/route';
import { isHiddenAccount } from '../testuser';
import { pickUp } from './handoff';
import { guards, isSelf } from './waitrules';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clip = (s: unknown, n: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t;
};
/** Chat and request text with the tokens written as names. */
export function plainText(s: unknown, names: Map<string, string>): string {
  return String(s || '')
    .replace(/<~[pf]:\d+\|([^>]+)>/g, '$1')
    .replace(/<@([^>|]+)(\|[^>]*)?>/g, (_, id: string) => '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' || id === 'here' ? id : names.get(lower(id)) || id.split('@')[0]))
    .replace(/<#[^>]+>/g, '#channel')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

export type InboxKind = 'mention' | 'dm' | 'reply' | 'task' | 'request' | 'meeting' | 'handoff' | 'pickup' | 'expense' | 'review' | 'mail' | 'flag';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  /** The app it came from, shown as the source chip. */
  app: 'Chat' | 'Projects' | 'Requests' | 'Meetings' | 'Hand-off' | 'Expenses' | 'Mail';
  title: string;
  text: string;
  who: string;
  at: string;
  href: string;
  /** The label of the button that clears it at its source, or '' when only deciding it clears it. */
  clear: string;
  open: string;
}

async function names(env: Env): Promise<Map<string, string>> {
  const dir = await staffDirectory(env).catch(() => []);
  return new Map(dir.map((p) => [p.email, p.name]));
}

const TASK_WORD: Record<string, string> = { assigned: 'gave you a task:', mentioned: 'mentioned you on', comment: 'commented on', waiting: 'is waiting on you for', followed: 'added you to', due_soon: 'Due soon:', done: 'finished' };
const REQ_WORD: Record<string, string> = { sent: 'sent you a request:', mention: 'mentioned you on', comment: 'commented on', waiting: 'is waiting on you for', done: 'finished', due: 'Due:' };

/** The part of the inbox read from this hub's own tables. */
export async function fastItems(env: Env, request: Request, user: HubUser): Promise<InboxItem[]> {
  const me = lower(user.email);
  const access = await accessOf(env, request, user);
  const dir = await names(env);
  // Chat and task lines from a blocked or departed account are left out; nobody there can act on them.
  const { gone } = await guards(env, me, dir);
  const nameOf = (e: string) => dir.get(lower(e)) || (isHiddenAccount(e) ? (lower(e).startsWith('tester2') ? 'FavorOS Tester Two' : 'FavorOS Tester') : String(e || '').split('@')[0]);
  const out: InboxItem[] = [];
  const jobs: Array<Promise<void>> = [];
  const handed = new Map<string, string>(); // hand-off id -> task id, for hand-offs waiting on this person
  const viaChat = new Map<string, string>(); // chat item id -> the hand-off its message told them about

  if (access.chat) {
    jobs.push(
      chatInbox(env, me)
        .then((r) => {
          for (const m of r.items) {
            // Favor Brain's answers and the meeting and gift notices are read in Chat itself; the Inbox holds what people wrote.
            if (['brain', 'meetings', 'gifts'].includes(lower(m.from)) || gone.has(lower(m.from))) continue;
            const where = m.channel_kind === 'public' || m.channel_kind === 'private' ? '#' + m.channel_name : m.channel_kind === 'dm' ? 'a direct message' : 'a group message';
            const kind: InboxKind = m.kind === 'dm' ? 'dm' : m.kind === 'reply' ? 'reply' : 'mention';
            const ho = /\/h\/(ho_[a-z0-9]{6,20})/.exec(String(m.body || ''));
            if (ho) viaChat.set(`chat:${m.id}`, ho[1]);
            out.push({
              id: `chat:${m.id}`,
              kind,
              app: 'Chat',
              title: kind === 'dm' ? `${m.from_name || nameOf(m.from)} wrote to you` : kind === 'reply' ? `${m.from_name || nameOf(m.from)} replied in ${where}` : `${m.from_name || nameOf(m.from)} mentioned you in ${where}`,
              text: clip(plainText(m.body, dir), 200),
              who: m.from_name || nameOf(m.from),
              at: m.at,
              href: `/chat/?c=${encodeURIComponent(m.channel_id)}&m=${m.id}${m.thread_id ? '&t=' + m.thread_id : ''}`,
              clear: 'Mark read',
              open: 'Reply',
            });
          }
        })
        .catch(() => undefined)
    );
  }
  // Task notices: given to you, mentioned, a comment, waiting on you.
  jobs.push(
    taskNotices(env, me, 40)
      .then((r) => {
        for (const n of r.notices) {
          if (n.read_at || !['assigned', 'mentioned', 'comment', 'waiting', 'due_soon'].includes(n.kind) || gone.has(lower(n.actor_email))) continue;
          const who = nameOf(n.actor_email);
          out.push({
            id: `tn:${n.id}`,
            kind: 'task',
            app: 'Projects',
            title: n.kind === 'due_soon' ? `Due soon: ${clip(n.title, 90)}` : `${who} ${TASK_WORD[n.kind] || 'updated'} ${clip(n.title, 90)}`,
            text: String(n.body || '').trim() === String(n.title || '').trim() ? '' : clip(plainText(n.body, dir), 200),
            who,
            at: n.created_at,
            href: `/projects/?t=${encodeURIComponent(n.task_id)}`,
            clear: 'Mark read',
            open: 'Open task',
          });
        }
      })
      .catch(() => undefined)
  );
  // Request notices, one line per request (the newest notice on it).
  if (access.tasks) {
    jobs.push(
      (async () => {
        if (!(await mayHear(env, me).catch(() => false))) return;
        const r = await requestNotices(env, me, 40);
        const seen = new Set<string>();
        for (const n of r.items) {
          if (seen.has(n.request_id)) continue;
          seen.add(n.request_id);
          if ((n.status === 'declined' && !access.admin) || gone.has(lower(n.actor_email))) continue;
          const who = n.actor_name || nameOf(n.actor_email);
          out.push({
            id: `rn:${n.request_id}`,
            kind: 'request',
            app: 'Requests',
            title: n.kind === 'due' ? `Due: ${clip(n.title, 90)}` : `${who} ${REQ_WORD[n.kind] || 'updated'} ${clip(n.title, 90)}`,
            text: clip(n.note, 200),
            who,
            at: n.created_at,
            href: `/requests/?r=${encodeURIComponent(n.request_id)}`,
            clear: 'Mark read',
            open: 'Open request',
          });
        }
      })().catch(() => undefined)
    );
  }
  // New requests waiting for an admin's review.
  if (access.admin) {
    jobs.push(
      env.DB.prepare("SELECT id, title, submitter_name, created_at FROM requests WHERE status = 'inbox' ORDER BY created_at LIMIT 6")
        .all<{ id: string; title: string; submitter_name: string; created_at: string }>()
        .then((r) => {
          for (const q of r.results || []) out.push({ id: `rq:${q.id}`, kind: 'review', app: 'Requests', title: `New request from ${q.submitter_name}`, text: clip(q.title, 160), who: q.submitter_name, at: q.created_at, href: `/requests/?r=${encodeURIComponent(q.id)}`, clear: '', open: 'Review' });
        })
        .catch(() => undefined)
    );
  }
  // Mentions in a meeting (someone named you in the live notes).
  if (access.meetings) {
    jobs.push(
      env.DB.prepare(
        `SELECT x.id, x.meeting_id, x.by_name, x.text, x.ts, m.title FROM hub_meeting_mentions x JOIN hub_meetings m ON m.id = x.meeting_id
          WHERE lower(x.email) = ? AND x.seen = 0 ORDER BY x.ts DESC LIMIT 10`
      )
        .bind(me)
        .all<{ id: number; meeting_id: string; by_name: string; text: string; ts: number; title: string }>()
        .then((r) => {
          for (const x of r.results || []) out.push({ id: `mm:${x.id}`, kind: 'meeting', app: 'Meetings', title: `${x.by_name || 'Someone'} mentioned you in ${clip(x.title || 'a meeting', 80)}`, text: clip(x.text, 200), who: x.by_name, at: new Date(Number(x.ts) || 0).toISOString(), href: `/meet/library/?m=${encodeURIComponent(x.meeting_id)}`, clear: 'Mark read', open: 'Open notes' });
        })
        .catch(() => undefined)
    );
  }
  // Hand-offs to you, not yet picked up; and hand-offs you gave that were picked up, until you clear the line.
  jobs.push(
    env.DB.prepare(
      `SELECT id, kind, ref_id, title, href, from_email, from_name, to_email, to_name, note, created_at, picked_at FROM hub_handoffs
        WHERE (to_email = ?1 AND picked_at IS NULL) OR (from_email = ?1 AND picked_at IS NOT NULL AND seen_at IS NULL AND picked_at > ?2)
        ORDER BY created_at DESC LIMIT 20`
    )
      .bind(me, new Date(Date.now() - 14 * 864e5).toISOString())
      .all<{ id: string; kind: string; ref_id: string; title: string; href: string; from_email: string; from_name: string; to_email: string; to_name: string; note: string; created_at: string; picked_at: string | null }>()
      .then((r) => {
        const WHAT: Record<string, string> = { mail: 'an email', task: 'a task', request: 'a request', partner: 'a partner' };
        for (const h of r.results || []) {
          if (h.to_email === me && !h.picked_at) {
            handed.set(h.id, h.kind === 'task' ? h.ref_id : '');
            out.push({ id: `ho:${h.id}`, kind: 'handoff', app: 'Hand-off', title: `${h.from_name || nameOf(h.from_email)} handed you ${WHAT[h.kind] || 'something'}: ${clip(h.title, 90)}`, text: clip(h.note, 200), who: h.from_name || nameOf(h.from_email), at: h.created_at, href: `/h/${h.id}`, clear: 'Got it', open: 'Open' });
          } else {
            out.push({ id: `hp:${h.id}`, kind: 'pickup', app: 'Hand-off', title: `${h.to_name || nameOf(h.to_email)} picked up ${clip(h.title, 90)}`, text: '', who: h.to_name || nameOf(h.to_email), at: String(h.picked_at), href: h.href, clear: 'Clear', open: 'Open' });
          }
        }
      })
      .catch(() => undefined)
  );
  // Expense requests waiting for this person's signature.
  if (access.approver) {
    jobs.push(
      (async () => {
        const rows = (await env.DB.prepare("SELECT id, doc_number, requester_name, total_cents, approver_email, submitted_at FROM expense_requests WHERE status = 'pending' ORDER BY submitted_at LIMIT 40").all<{ id: string; doc_number: string; requester_name: string; total_cents: number; approver_email: string; submitted_at: string }>()).results || [];
        const memo = new Map<string, boolean>();
        for (const e of rows) {
          const k = e.approver_email || '';
          if (!memo.has(k)) memo.set(k, (await approverEmails(env, k).catch(() => new Set<string>())).has(me));
          if (!memo.get(k)) continue;
          const amount = '$' + ((Number(e.total_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          out.push({ id: `exp:${e.id}`, kind: 'expense', app: 'Expenses', title: `${e.requester_name} needs your signature on ${e.doc_number}`, text: amount, who: e.requester_name, at: e.submitted_at, href: `/expenses/review?id=${encodeURIComponent(e.id)}`, clear: '', open: 'Review and sign' });
        }
      })().catch(() => undefined)
    );
  }
  await Promise.all(jobs);
  // One line per hand-off: the Chat message that told them and the task's own "given to you" notice fold into the hand-off line.
  const folded = handed.size
    ? out.filter((i) => {
        if (i.app === 'Chat' && handed.has(viaChat.get(i.id) || '')) return false;
        if (i.app === 'Projects' && [...handed.values()].some((t) => t && i.href.endsWith('?t=' + encodeURIComponent(t)))) return false;
        return true;
      })
    : out;
  return sortItems(await dropCleared(env, me, folded));
}

/** Newest first, items with no clear button (decisions) kept in order with the rest. */
export const sortItems = (list: InboxItem[]) => list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 60);

async function dropCleared(env: Env, me: string, list: InboxItem[]): Promise<InboxItem[]> {
  const r = await env.DB.prepare('SELECT item FROM hub_today_cleared WHERE email = ?').bind(me).all<{ item: string }>().catch(() => ({ results: [] as Array<{ item: string }> }));
  const gone = new Set((r.results || []).map((x) => x.item));
  return gone.size ? list.filter((i) => !gone.has(i.id)) : list;
}

/** The Mail part: conversations that need you (Mail's rule) and the ones you starred, from the newest 60 in the inbox. No model runs here. */
export async function mailItems(env: Env, user: HubUser, fetcher: typeof fetch = fetch): Promise<{ items: InboxItem[]; connected: boolean }> {
  const box = await mailboxOf(env, user, fetcher);
  if (!box) return { items: [], connected: false };
  const scan = await scanInbox(box.ctx, box.gm, '', false);
  const out: InboxItem[] = [];
  // Mail from a volunteer who left still shows, since it is real mail to this person. Mail from their own address or a mailbox they connected does not.
  const { self } = await guards(env, lower(user.email), new Map());
  for (const r of scan.rows) {
    if (!r.ask && !r.starred) continue;
    if (r.from && isSelf(r.from, self)) continue;
    const who = r.from?.name || r.from?.email || '';
    out.push({
      id: r.ask ? `mail:${r.id}` : `star:${r.id}`,
      kind: r.ask ? 'mail' : 'flag',
      app: 'Mail',
      title: clip(r.subject || '(no subject)', 110),
      text: clip(r.snippet, 200),
      who: r.partner ? `${who} (partner)` : who,
      at: new Date(r.date).toISOString(),
      href: `/mail/#/INBOX/${encodeURIComponent(r.id)}`,
      clear: box.write ? (r.ask ? 'Done' : 'Unflag') : '',
      open: 'Open',
    });
  }
  return { items: sortItems(await dropCleared(env, lower(user.email), out)).slice(0, 25), connected: true };
}

/** Clears one item at its source. */
export async function clearItem(env: Env, user: HubUser, id: string, fetcher: typeof fetch = fetch): Promise<{ cleared: boolean }> {
  const me = lower(user.email);
  const m = /^([a-z]{2,5}):([A-Za-z0-9_.@-]{1,80})$/.exec(id);
  if (!m) throw new HttpError(400, 'bad_item', 'That item is not on your list.');
  const [, kind, ref] = m;
  if (kind === 'chat') {
    await clearInbox(env, me, Number(ref) || null);
    return { cleared: true };
  }
  if (kind === 'tn') {
    await readTaskNotices(env, me, { ids: [ref] });
    return { cleared: true };
  }
  if (kind === 'rn') {
    await readRequestNotices(env, me, { request_id: ref });
    return { cleared: true };
  }
  if (kind === 'mm') {
    await env.DB.prepare('UPDATE hub_meeting_mentions SET seen = 1 WHERE id = ? AND lower(email) = ?').bind(Number(ref) || 0, me).run();
    return { cleared: true };
  }
  if (kind === 'ho') {
    await pickUp(env, user, ref);
    return { cleared: true };
  }
  if (kind === 'hp') {
    await env.DB.prepare('UPDATE hub_handoffs SET seen_at = ? WHERE id = ? AND from_email = ?').bind(nowIso(), ref, me).run();
    return { cleared: true };
  }
  if (kind === 'mail' || kind === 'star') {
    const box = await mailboxOf(env, user, fetcher);
    if (!box || !box.write) throw new HttpError(403, 'mail_scope', 'Clearing mail from Today needs Mail to have permission to change your mail. Open it in Mail instead.');
    if (!/^[A-Za-z0-9]{6,40}$/.test(ref)) throw new HttpError(400, 'bad_item', 'That conversation is not on your list.');
    // Needs you: Done archives the conversation, as Done does in Mail. Flagged: Unflag removes the star.
    await box.gm.send('POST', `/threads/${ref}/modify`, kind === 'mail' ? { removeLabelIds: ['INBOX'] } : { removeLabelIds: ['STARRED'] });
    await applyLabels(env, me, ref, [], kind === 'mail' ? ['INBOX'] : ['STARRED']).catch(() => undefined);
    forgetScan(me);
    forgetCount(me);
    return { cleared: true };
  }
  throw new HttpError(400, 'not_clearable', 'Open it to decide it. It leaves the list once it is decided.');
}

/** Undo: the item comes back at its source (unread again, back in the inbox, starred again). A request's notices are read as a group and do not come back. */
export async function unclearItem(env: Env, user: HubUser, id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const me = lower(user.email);
  const m = /^([a-z]{2,5}):([A-Za-z0-9_.@-]{1,80})$/.exec(id);
  if (!m) return;
  const [, kind, ref] = m;
  if (kind === 'chat') await env.DB.prepare('UPDATE chat_mentions SET read_at = NULL WHERE email = ? AND message_id = ?').bind(me, Number(ref) || 0).run();
  else if (kind === 'tn') await env.DB.prepare('UPDATE hub_task_notices SET read_at = NULL WHERE email = ? AND id = ?').bind(me, ref).run();
  else if (kind === 'mm') await env.DB.prepare('UPDATE hub_meeting_mentions SET seen = 0 WHERE id = ? AND lower(email) = ?').bind(Number(ref) || 0, me).run();
  else if (kind === 'hp') await env.DB.prepare('UPDATE hub_handoffs SET seen_at = NULL WHERE id = ? AND from_email = ?').bind(ref, me).run();
  else if ((kind === 'mail' || kind === 'star') && /^[A-Za-z0-9]{6,40}$/.test(ref)) {
    const box = await mailboxOf(env, user, fetcher);
    if (!box || !box.write) return;
    const label = kind === 'mail' ? 'INBOX' : 'STARRED';
    await box.gm.send('POST', `/threads/${ref}/modify`, { addLabelIds: [label] });
    await applyLabels(env, me, ref, [label], []).catch(() => undefined);
    forgetScan(me);
    forgetCount(me);
  }
}
