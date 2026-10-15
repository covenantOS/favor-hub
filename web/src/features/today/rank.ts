// The Needs you list: which rows there are, what they say, and in what order. Pure functions with no browser access, so the same rules run on
// the server, in the browser and in tests/today-rank.test.mjs. Ported from public/js/today3.js (items, thanksList) on 2026-10-15.
// Every count and amount here is the server's own; nothing is recomputed from raw rows except the grouping the page has always done.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

export const TZ = 'America/New_York';
export const n0 = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
export const plural = (n: unknown, one: string, many?: string) => n0(n) + ' ' + (Number(n) === 1 ? one : many || one + 's');
const neg = (n: number) => (n < 0 ? '-' : '');
export const money0 = (n: unknown) => neg(Math.round(Number(n) || 0)) + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US');
export const money = (n: unknown) => {
  const v = Number(n) || 0;
  return neg(v) + '$' + (Math.round(v) === v ? Math.abs(v).toLocaleString('en-US') : Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
export const compact = (v: unknown) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 999500 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + 'K' : s + '$' + Math.round(a);
};
export const et = (t: string | number | Date, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString('en-US', { timeZone: TZ, ...o });
export const clock = (iso: string | number) => et(iso, { hour: 'numeric', minute: '2-digit' });
export const dayKey = (t: string | number | Date) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 9", with the year when it is not this one. */
export const fd = (iso: string, today: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!m || !d) return '';
  return MON[m - 1] + ' ' + d + (y === Number(today.slice(0, 4)) ? '' : ', ' + y);
};
export const ago = (iso: string | undefined, now: number) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.round(h / 24);
  if (d < 7) return d + 'd';
  return et(t, { month: 'short', day: 'numeric' });
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The 24-hour thank-you clock (the same words as public/js/thank.js clock and functions/_lib/work/thank-clock.ts). */
export function thankClock(due: string | undefined, now: number): { label: string; late: boolean; soon?: boolean } {
  const t = Date.parse(due || '');
  if (!t) return { label: '', late: false };
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) {
    const h = Math.floor(-mins / 60);
    return { label: h < 1 ? 'Overdue' : h < 24 ? 'Overdue ' + h + ' h' : 'Overdue ' + Math.floor(h / 24) + 'd', late: true };
  }
  const dd = dayKey(t);
  const td = dayKey(now);
  const days = Math.round((Date.parse(dd + 'T12:00:00Z') - Date.parse(td + 'T12:00:00Z')) / 86400000);
  let label: string;
  if (mins < 60) label = 'Due in ' + mins + ' min';
  else if (days === 0) label = mins <= 720 ? 'Due in ' + Math.round(mins / 60) + ' h' : 'Due today';
  else if (mins <= 480) label = 'Due in ' + Math.round(mins / 60) + ' h';
  else if (days === 1) label = 'Due tomorrow';
  else label = days < 7 ? 'Due ' + WD[new Date(dd + 'T12:00:00Z').getUTCDay()] : 'Due ' + fd(dd, td);
  return { label, late: false, soon: mins <= 360 };
}

/* ---------------------------------------------------------------- types */
export type Tone = 'terra' | 'sun' | 'dusk' | 'sky' | 'leaf' | 'teal' | 'gold' | 'slate';
export interface TypeDef { label: string; tone: Tone; icon: string; cat: 'work' | 'msg' | 'partners' | 'waiting' }
export const TYPE: Record<string, TypeDef> = {
  approval: { label: 'Approval', tone: 'terra', icon: 'expense', cat: 'work' },
  review: { label: 'Request', tone: 'sun', icon: 'request', cat: 'work' },
  request: { label: 'Request', tone: 'sun', icon: 'request', cat: 'work' },
  handoff: { label: 'Hand-off', tone: 'dusk', icon: 'handoff', cat: 'work' },
  reply: { label: 'Reply', tone: 'terra', icon: 'chat', cat: 'msg' },
  chat: { label: 'Chat', tone: 'sky', icon: 'chat', cat: 'msg' },
  mail: { label: 'Mail', tone: 'sky', icon: 'mail', cat: 'msg' },
  task: { label: 'Task', tone: 'leaf', icon: 'task', cat: 'work' },
  meeting: { label: 'Meeting', tone: 'teal', icon: 'meeting', cat: 'work' },
  flag: { label: 'Flag', tone: 'sun', icon: 'flag', cat: 'work' },
  actions: { label: 'Actions', tone: 'leaf', icon: 'task', cat: 'work' },
  thank: { label: 'Thank', tone: 'gold', icon: 'phone', cat: 'partners' },
  moment: { label: 'Call', tone: 'gold', icon: 'star', cat: 'partners' },
  eval: { label: 'Evaluation', tone: 'dusk', icon: 'note', cat: 'work' },
  feedback: { label: 'Feedback', tone: 'slate', icon: 'note', cat: 'work' },
  learn: { label: 'Course', tone: 'sun', icon: 'learn', cat: 'work' },
  receipts: { label: 'Receipts', tone: 'sky', icon: 'mail', cat: 'work' },
  waiting: { label: 'Waiting', tone: 'slate', icon: 'clock', cat: 'waiting' },
  project: { label: 'Task', tone: 'leaf', icon: 'task', cat: 'work' },
};
export const TABS: [string, string][] = [['all', 'All'], ['msg', 'Messages'], ['work', 'Work'], ['partners', 'Partners'], ['waiting', 'Waiting on others']];
export const SHOW = 8;

const inboxKind = (k: string) => ({ mention: 'chat', dm: 'chat', reply: 'chat', task: 'task', request: 'request', review: 'review', meeting: 'meeting', handoff: 'handoff', pickup: 'handoff', expense: 'approval', mail: 'mail', flag: 'flag' } as Record<string, string>)[k] || 'chat';
export const INBOX_RANK: Record<string, number> = { approval: 86, review: 84, handoff: 84, chat: 68, task: 66, request: 62, meeting: 60, flag: 58, mail: 55 };
// Hub counts that repeat a kind the Inbox already lists one by one are left out (a request to review shows as its own row).
const CARD_DUPE: Record<string, string[]> = { requests: ['review', 'request'], expenses: ['approval'], 'projects-assigned': ['task'] };
const CARD_TYPE: Record<string, string> = { requests: 'review', expenses: 'approval', 'projects-due': 'project', 'projects-assigned': 'project', 'projects-news': 'project', tasks: 'project', 'tasks-waiting': 'project', 'tasks-news': 'project', meetings: 'meeting', evals: 'eval', feedback: 'feedback', learn: 'learn', receipts: 'receipts', foundations: 'task', brain: 'feedback' };
const CARD_RANK: Record<string, number> = { 'projects-due': 80, evals: 74, requests: 76, expenses: 82, 'projects-assigned': 64, tasks: 64, receipts: 52, learn: 46, meetings: 44, 'projects-news': 40, 'tasks-news': 40, 'tasks-waiting': 38, feedback: 34, foundations: 30, brain: 30 };

export interface Thank {
  g: J;
  src: 'brief' | 'gifts';
  late: boolean;
  soon: boolean;
  label: string;
  due?: string;
}
export interface GroupRow {
  key: string;
  title: string;
  sub: string;
  href: string;
  pid?: string;
  chip?: string;
  late?: boolean;
  moment?: J;
  wait?: Item;
  thank?: Thank;
}
export interface Item {
  id: string;
  t: string;
  title: string;
  sub: string;
  when: string;
  chip?: string;
  ts: number;
  rank: number;
  href?: string;
  src?: J;
  kind: 'inbox' | 'wait-in' | 'wait-out' | 'mine' | 'card' | 'group' | 'thank';
  late?: boolean;
  card?: J;
  rows?: GroupRow[];
  more?: { href: string; text: string };
  pid?: string;
  thank?: Thank;
  count?: number;
}

export interface Inputs {
  today: J | null;
  inbox: J[];
  waiting: J[];
  brief: J | null;
  gifts: J | null;
  home: J | null;
  gone: ReadonlySet<string>;
  now: number;
}

export function thanksList(i: Inputs): Thank[] {
  const by = new Map<string, Thank>();
  const b = i.brief;
  if (b && b.thanks) {
    for (const g of (b.thanks.rows || []).concat(b.thanks.older || [])) {
      const c = g.due ? thankClock(g.due, i.now) : { label: '', late: false, soon: false };
      by.set(String(g.giftId), { g, src: 'brief', late: !!c.late || (!!g.due && Date.parse(g.due) < i.now), soon: !!c.soon, label: c.label, due: g.due });
    }
  }
  const tg = i.gifts && i.gifts.gifts;
  if (tg) {
    for (const g of tg) {
      if (!g.thank || g.thank.state === 'done' || g.thank.state === 'task') continue;
      const k = String(g.giftId);
      if (by.has(k)) continue;
      const due = g.thank.due;
      const late = !!g.thank.late || (!!due && Date.parse(due) < i.now);
      by.set(k, {
        g: { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, team: g.team, through: g.soft && g.through ? g.through : '', tasks: (g.taskIds || []).length, left: g.thank.state === 'left' ? { date: g.thank.on, by: g.thank.by, how: g.thank.how } : null, due },
        src: 'gifts', late, soon: false, label: '', due,
      });
    }
  }
  return [...by.values()].filter((t) => !i.gone.has('gift:' + t.g.giftId)).sort((a, b2) => (Date.parse(a.due || '') || 9e15) - (Date.parse(b2.due || '') || 9e15));
}

export function buildItems(i: Inputs): { items: Item[]; thanks: Thank[] } {
  const out: Item[] = [];
  const T = i.today;
  const today = dayKey(i.now);
  // 1. Inbox, one row each.
  const seen = new Set<string>();
  const kinds = new Set<string>();
  for (const it of i.inbox) {
    if (seen.has(it.id) || i.gone.has(it.id)) continue;
    seen.add(it.id);
    const t = inboxKind(it.kind);
    kinds.add(t);
    out.push({ id: it.id, t, title: it.title, sub: [it.who && it.app === 'Mail' ? it.who : '', it.text].filter(Boolean).join(' · '), when: ago(it.at, i.now), ts: Date.parse(it.at) || 0, rank: INBOX_RANK[t] || 55, href: it.href, src: it, kind: 'inbox' });
  }
  // 2. Waiting on you ranks high; what you wait on folds into one row at the end.
  const wseen = new Set<string>();
  const outs: Item[] = [];
  for (const it of i.waiting) {
    if (wseen.has(it.id) || i.gone.has(it.id)) continue;
    wseen.add(it.id);
    const age = it.days >= 1 ? plural(it.days, 'day') : ago(it.since, i.now);
    if (it.dir === 'in') out.push({ id: it.id, t: 'reply', title: it.title, sub: [it.who && it.who.name, it.app, age + ' waiting'].filter(Boolean).join(' · '), when: '', ts: Date.parse(it.since) || 0, rank: 88, href: it.href, src: it, kind: 'wait-in' });
    else outs.push({ id: it.id, t: 'waiting', title: it.title, sub: [it.app, age, it.text].filter(Boolean).join(' · '), when: '', ts: Date.parse(it.since) || 0, rank: 20, href: it.href, src: it, kind: 'wait-out' });
  }
  for (const m of (T && T.mine) || []) {
    if (/Done|Approved|Declined|Closed|Cancel/i.test(m.status || '')) continue;
    outs.push({ id: 'mine:' + m.href + m.title, t: 'waiting', title: String(m.title || '').trim() || 'Untitled', sub: m.status, when: '', ts: 0, rank: 20, href: m.href, kind: 'mine' });
  }
  // 3. The hub's counts, one row per kind, unless the Inbox lists them.
  for (const c of (T && T.cards) || []) {
    if (!(Number(c.n) > 0)) continue;
    if ((CARD_DUPE[c.id] || []).some((k) => kinds.has(k))) continue;
    if (i.gone.has('card:' + c.id)) continue;
    out.push({ id: 'card:' + c.id, t: CARD_TYPE[c.id] || 'task', title: `${n0(c.n)} ${c.what}`, sub: c.note || '', when: '', ts: 0, rank: c.warn ? 84 : CARD_RANK[c.id] || 40, href: c.href, kind: 'card', card: c, late: !!c.warn || /past due|overdue|late/i.test(c.note || '') });
  }
  // 4. Blackbaud actions due today or late, one row that opens to the list.
  const due = i.home && i.home.work && i.home.work.due;
  if (due && (due.overdue || due.today)) {
    const n = (due.overdue || 0) + (due.today || 0);
    const fr = due.fr ? '&fr=' + encodeURIComponent(due.fr) : '';
    const what = (r: J) => r.summary || (r.type && r.type !== 'No type' ? r.type : '') || 'Action';
    out.push({
      id: 'grp:actions', t: 'actions', title: `${plural(n, 'action')} ${due.scope === 'mine' ? 'of yours ' : ''}due today or late`,
      sub: [due.overdue ? n0(due.overdue) + ' late' : '', due.today ? n0(due.today) + ' due today' : ''].filter(Boolean).join(' · '),
      when: '', rank: due.overdue ? 82 : 72, ts: 0, href: '/work/?view=open' + fr, kind: 'group', late: !!due.overdue, count: n,
      rows: (due.rows || []).map((r: J) => ({ key: 'a' + r.id, title: r.partner, sub: what(r) + (r.place ? ' · ' + r.place : ''), chip: r.late > 0 ? (r.late <= 60 ? plural(r.late, 'day') + ' late' : Math.round(r.late / 7) + ' wk late') : 'Today', late: r.late > 0, href: '/work/?action=' + encodeURIComponent(r.id), pid: r.cid })),
      more: { href: '/work/?view=open' + fr, text: 'Open all in Actions' },
    });
  }
  // 5. Gifts to thank: up to three rows of their own; more than three fold into one row.
  const th = thanksList(i);
  const thankRow = (x: Thank): Item => ({
    id: 'gift:' + x.g.giftId, t: 'thank', title: x.g.name || 'Partner ' + x.g.cid,
    sub: [money(x.g.amount), x.g.through ? 'through ' + x.g.through : '', x.g.fund, x.g.date ? fd(x.g.date, today) : ''].filter(Boolean).join(' · '),
    when: '', chip: x.label || (x.late ? 'Overdue' : ''), late: x.late, rank: x.late ? 92 : x.soon ? 90 : 78, ts: Date.parse(x.due || '') || 0,
    href: '/work/partner/' + encodeURIComponent(x.g.cid), kind: 'thank', pid: x.g.cid, thank: x,
  });
  if (th.length && th.length <= 3) th.forEach((x) => out.push(thankRow(x)));
  else if (th.length) {
    const late = th.filter((x) => x.late).length;
    out.push({
      id: 'grp:thank', t: 'thank', title: `${plural(th.length, 'gift')} to thank`,
      sub: [late ? n0(late) + ' past the 24-hour clock' : '', 'Oldest from ' + (th[0].g.name || 'a partner')].filter(Boolean).join(' · '),
      when: '', rank: late ? 92 : 80, ts: 0, href: '/work/?view=gifts', kind: 'group', late: !!late, count: th.length,
      rows: th.slice(0, 12).map((x) => { const r = thankRow(x); return { key: r.id, title: r.title, sub: r.sub, href: r.href || '', pid: x.g.cid, chip: x.label || (x.late ? 'Overdue' : fd(x.g.date, today)), late: x.late, thank: x }; }),
      more: { href: '/work/?view=gifts', text: 'All gifts to thank' },
    });
  }
  // 6. Moments worth a call.
  const ms = ((i.brief && i.brief.moments) || []).filter((m: J) => !i.gone.has('moment:' + m.id));
  if (ms.length) {
    const KIND: Record<string, string> = { largest: 'Largest gift', first: 'First gift', quiet: 'Gone quiet', anniversary: 'Anniversary' };
    out.push({
      id: 'grp:moments', t: 'moment', title: `${plural(ms.length, 'partner')} worth a call`,
      sub: ms.slice(0, 3).map((m: J) => m.name).join(', ') + (ms.length > 3 ? ' and ' + (ms.length - 3) + ' more' : ''), when: '', rank: 36, ts: 0, kind: 'group', count: ms.length,
      rows: ms.map((m: J) => ({ key: 'm' + m.id, title: m.name, sub: (KIND[m.kind] || m.kind) + ': ' + m.line, href: m.href, pid: m.cid, moment: m })),
    });
  }
  // 7. What you wait on from others, at the end.
  if (outs.length) {
    outs.sort((a, b) => a.ts - b.ts);
    out.push({
      id: 'grp:waiting', t: 'waiting', title: `You are waiting on ${plural(outs.length, 'reply', 'replies')}`,
      sub: [...new Set(outs.map((o) => (o.src && o.src.who && o.src.who.name) || '').filter(Boolean))].slice(0, 3).join(', '), when: '', rank: 20, ts: 0, kind: 'group', count: outs.length,
      rows: outs.map((o) => ({ key: o.id, title: o.title, sub: [o.src && o.src.who && o.src.who.name, o.sub].filter(Boolean).join(' · '), href: o.href || '', wait: o })),
    });
  }
  out.sort((a, b) => b.rank - a.rank || (!!a.late === !!b.late ? 0 : a.late ? -1 : 1) || (a.kind === 'inbox' && b.kind === 'inbox' ? b.ts - a.ts : a.ts - b.ts));
  return { items: out, thanks: th };
}

export const catOf = (it: Item) => (TYPE[it.t] || TYPE.task).cat;

/** What the heading and the status line both say: every row except the Waiting group. */
export const needCount = (items: Item[]) => items.filter((x) => x.t !== 'waiting').length;
export const lateCount = (items: Item[]) => items.filter((x) => x.late).length;

/** "$1.2M", "$450K", "$812": the year-end estimate on the pace line (the same rule as FavorUI.short in public/js/favor-ui.js). */
export function shortMoney(v: unknown): string {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  const f = (x: number) => String(+x.toFixed(1));
  return a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + f(a / 1e3) + 'K' : s + '$' + Math.round(a);
}
