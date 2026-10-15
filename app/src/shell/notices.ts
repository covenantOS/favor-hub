// One notification list. The bell used to read five sources and draw each its own way (public/js/wc-bell.js). They keep their own read state
// on the server; this module turns each answer into the same row so the bell draws one list, and the badge is one number.
import { oneLine, nameFromEmail, todayEt, whenLabel } from '@/lib/format';
import type { HubNotice } from '@shared/schemas';
import type { z } from 'zod';
import type { chatNotice, projectNotice, reminderRow, requestNotice } from '@shared/schemas';

export interface NoticeRow {
  /** Unique across sources. */
  key: string;
  source: string;
  head: string;
  txt: string;
  href: string;
  /** The small label at the left: a time, "Now", or a count. */
  when: string;
  warn: boolean;
  /** How to clear it on the server, when it has a read state of its own. */
  read?: { kind: 'request' | 'project' | 'chat'; id: string };
  /** A reminder from the Work Center, with Done and Later. */
  reminder?: { id: string; cid: string };
}

type Reminder = z.infer<typeof reminderRow>;
type ReqN = z.infer<typeof requestNotice>;
type ProjN = z.infer<typeof projectNotice>;
type ChatN = z.infer<typeof chatNotice>;

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const TK_WORD: Record<string, string> = { sent: 'sent you', mention: 'named you on', comment: 'commented on', waiting: 'is waiting on you for', done: 'finished', accepted: 'accepted' };

const dueWord = (d: string) => {
  const t = todayEt();
  return d === t ? 'today' : d === addDays(t, 1) ? 'tomorrow' : d < t ? 'and late' : 'soon';
};

export function fromReminders(rows: Reminder[]): NoticeRow[] {
  return rows.map((r) => ({
    key: 'rem:' + r.id,
    source: 'Reminders',
    head: r.title,
    txt: r.note || '',
    href: r.cid ? '/work/partner/' + r.cid : '/work/',
    when: r.bucket === 'now' ? 'Now' : r.bucket === 'tomorrow' ? 'Tomorrow' : whenLabel(r.at),
    warn: r.bucket === 'now',
    reminder: { id: r.id, cid: r.cid || '' },
  }));
}

export function fromRequests(items: ReqN[]): NoticeRow[] {
  return items.map((it) => ({
    key: 'req:' + it.id,
    source: 'Requests',
    head: it.kind === 'due' ? 'Due ' + dueWord(String(it.note || '')) + ': ' + it.title : (it.actor_name || 'Someone') + ' ' + (TK_WORD[it.kind] || 'updated') + ' ' + it.title,
    txt: it.kind === 'due' ? '' : oneLine(String(it.note || '')),
    href: '/requests/?r=' + encodeURIComponent(it.request_id),
    when: whenLabel(it.created_at),
    warn: false,
    read: { kind: 'request', id: it.id },
  }));
}

export function fromProjects(items: ProjN[]): NoticeRow[] {
  return items.map((it) => ({
    key: 'proj:' + it.id,
    source: 'Projects',
    head: it.head + ' ' + it.title,
    txt: it.txt || '',
    href: it.url,
    when: whenLabel(it.created_at),
    warn: false,
    read: { kind: 'project', id: it.id },
  }));
}

export function fromChat(items: ChatN[]): NoticeRow[] {
  return items.map((it) => {
    const who = it.from === 'brain' ? 'Favor Brain' : it.from === 'meetings' ? 'Favor Meetings' : it.from_name ? it.from_name : nameFromEmail(String(it.from || ''));
    const where = it.channel_kind === 'public' || it.channel_kind === 'private' ? '#' + it.channel_name : 'direct message';
    return {
      key: 'chat:' + it.id,
      source: 'Chat',
      head: it.kind === 'dm' ? who + ' sent you a message' : it.kind === 'reply' ? who + ' replied in a thread' : who + ' mentioned you',
      txt: oneLine(it.body || ''),
      href: '/chat/?c=' + encodeURIComponent(it.channel_id) + '&m=' + it.id + (it.thread_id ? '&t=' + it.thread_id : ''),
      when: where,
      warn: false,
      read: { kind: 'chat', id: it.id },
    };
  });
}

export function fromHub(items: HubNotice[]): NoticeRow[] {
  return items.map((it) => ({
    key: 'hub:' + it.id,
    source: it.source,
    head: it.head,
    txt: it.txt,
    href: it.href,
    when: it.at ? whenLabel(it.at) : it.n.toLocaleString('en-US'),
    warn: it.warn,
  }));
}

/** The groups the bell lists, in the order it lists them: what is happening now first, reminders last. */
export const GROUP_ORDER = ['Meetings', 'Learning', 'Evaluations', 'Mail', 'Expenses', 'Receipts', 'Feedback', 'Favor Brain', 'Projects', 'Requests', 'Chat', 'Reminders'];

export function grouped(rows: NoticeRow[]): Array<[string, NoticeRow[]]> {
  const by = new Map<string, NoticeRow[]>();
  for (const r of rows) by.set(r.source, [...(by.get(r.source) || []), r]);
  return [...by.entries()].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99));
}

/** The badge: the number of things waiting across every source, 99+ past two digits. */
// The bell's number caps at 9+, as the classic bell does (wc-bell.js), so the header never changes width between pages.
export const badge = (total: number) => (total > 9 ? '9+' : total ? String(total) : '');
