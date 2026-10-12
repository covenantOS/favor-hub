// One notification center. The bell reads four sources that keep their own read state (Work Center reminders, request notices, project
// notices, Chat) and this answer for everything else a person is waiting on. Each row is built by the same function the page it opens uses
// (Today's cards, the menu counts, the Meetings list), so a number in the bell is the number on that page and clearing it there clears it here.
// Nothing here has a read state of its own.
import type { Env } from '../http';
import type { HubUser } from '../session';
import { liveMeetingsFor, type Access, waitingCards } from './today';
import { mailUnreadCount } from '../mail/route';

export interface Notice {
  id: string;
  /** The group the bell lists it under. */
  source: 'Meetings' | 'Learning' | 'Evaluations' | 'Mail' | 'Expenses' | 'Receipts' | 'Feedback' | 'Favor Brain' | 'Requests';
  head: string;
  txt: string;
  href: string;
  n: number;
  warn: boolean;
  /** Eastern time the thing happens, for meeting reminders. */
  at?: string;
}

const SOURCE_OF: Record<string, Notice['source']> = { meetings: 'Meetings', learn: 'Learning', evals: 'Evaluations', expenses: 'Expenses', receipts: 'Receipts', feedback: 'Feedback', brain: 'Favor Brain', requests: 'Requests' };

/** Meetings this person can open that start in the next half hour, or began in the last ten minutes and are still on. */
async function startingSoon(env: Env, email: string): Promise<Notice[]> {
  const me = email.toLowerCase();
  const from = new Date(Date.now() - 10 * 60_000).toISOString();
  const to = new Date(Date.now() + 30 * 60_000).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT id, title, starts_at, status FROM hub_meetings m
      WHERE m.status IN ('scheduled', 'live') AND m.starts_at IS NOT NULL AND m.starts_at >= ?1 AND m.starts_at <= ?2
        AND (lower(m.host_email) = ?3 OR instr(lower(m.invitees), '"' || ?3 || '"') > 0 OR instr(lower(m.cohosts), '"' || ?3 || '"') > 0) ORDER BY m.starts_at LIMIT 5`
  ).bind(from, to, me).all<{ id: string; title: string; starts_at: string; status: string }>().catch(() => ({ results: [] }))).results || [];
  return rows.map((r) => ({
    id: 'soon:' + r.id,
    source: 'Meetings' as const,
    head: r.status === 'live' ? 'Started' : 'Starts soon',
    txt: r.title || 'Meeting',
    href: `/meet/room/?m=${r.id}`,
    n: 1,
    warn: false,
    at: r.starts_at,
  }));
}

export async function notificationsFor(env: Env, user: HubUser, access: Access): Promise<{ items: Notice[]; count: number; counts: Record<string, number> }> {
  const [cards, soon, live, mailUnread] = await Promise.all([
    waitingCards(env, user, access).catch(() => []),
    access.meetings ? startingSoon(env, user.email) : Promise.resolve([] as Notice[]),
    access.meetings ? liveMeetingsFor(env, user.email).catch(() => 0) : Promise.resolve(0),
    // Gmail answers in about 150 ms; a slow answer never holds the bell back.
    access.mail ? Promise.race([mailUnreadCount(env, user.email).catch(() => 0), new Promise<number>((r) => setTimeout(() => r(0), 1200))]) : Promise.resolve(0),
  ]);
  const items: Notice[] = [];
  items.push(...soon);
  if (live) items.push({ id: 'live', source: 'Meetings', head: live === 1 ? 'A meeting is on now' : `${live} meetings are on now`, txt: 'Join from the Meetings page', href: '/meet/', n: live, warn: false });
  for (const c of cards) {
    // Request notices, project notices and meeting-less task cards are listed by their own sources in the bell.
    const source = SOURCE_OF[c.id];
    if (!source) continue;
    items.push({ id: 'card:' + c.id, source, head: `${c.n.toLocaleString('en-US')} ${c.what}`, txt: c.note, href: c.href, n: c.n, warn: c.warn });
  }
  if (mailUnread) items.push({ id: 'mail', source: 'Mail', head: `${mailUnread.toLocaleString('en-US')} unread in your Inbox`, txt: 'The same number as the Inbox in Mail', href: '/mail/', n: mailUnread, warn: false });
  const sum: Record<string, number> = {};
  for (const i of items) sum[i.source] = (sum[i.source] || 0) + i.n;
  return { items, count: items.reduce((n, i) => n + i.n, 0), counts: sum };
}
