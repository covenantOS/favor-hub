// Invented people and numbers for the app's tests (unit and Playwright). Nothing here is real data: the repo is public.
import type { DayResponse, KpiResponse, NavResponse, TodayResponse } from '@shared/schemas';

const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();

export const user = { email: 'test.admin@favorintl.org', name: 'Test Admin', picture: '', role: 'admin' as const, via: 'google' as const, kpi: true };

export const nav: NavResponse = {
  ok: true,
  user,
  access: { admin: true, kpi: true, workCenter: true, clips: true, clipsRecord: true, meetings: true, chat: true, projects: true, tasks: true, bell: true, hr: true, mail: true, expenseLog: true },
  counts: { board: 3, workOpen: 12, chatMentions: 2, mailUnread: 7, receiptsLeft: 4, projectsMine: 1, evals: 0 },
  kpiTeams: ['rdd', 'pc', 'ce', 'grants', 'marketing'],
};

export const staffNav: NavResponse = {
  ok: true,
  user: { ...user, email: 'test.staff@favorintl.org', name: 'Test Staff', role: 'staff', kpi: false },
  access: { admin: false, kpi: false, clips: true, clipsRecord: true, bell: true },
  counts: { board: 1 },
  kpiTeams: [],
};

export const today: TodayResponse = {
  ok: true,
  user,
  access: nav.access,
  cards: [
    { id: 'requests', label: 'Requests', n: 3, what: 'waiting for your review', note: '1 past due', warn: false, href: '/requests/', cta: 'Open' },
    { id: 'receipts', label: 'Receipts', n: 4, what: 'thank-yous ready to print', note: '', warn: true, href: '/receipts/', cta: 'Open', amount: 1250.5 },
    { id: 'meetings', label: 'Meetings', n: 1, what: 'on now', note: '', warn: false, href: '/meet/', cta: 'Join' },
  ],
  mine: [
    { kind: 'request', title: 'Banner for the fall event', status: 'In motion', at: iso(-600), href: '/requests/?r=1' },
    { kind: 'expense', title: 'Airfare, Nashville', status: 'Approved', at: iso(-1200), href: '/expenses/' },
  ],
  activity: Array.from({ length: 11 }, (_, i) => ({ at: iso(-60 * (i + 1) * (i > 4 ? 9 : 1)), app: i % 2 ? 'Requests' : 'Receipts', text: `Invented activity line number ${i + 1}`, href: i % 3 ? '/requests/' : '' })),
};

export const day: DayResponse = {
  ok: true,
  blackbaud: {
    linked: true,
    total: 14,
    overdue: 2,
    actions: [
      { id: 'a1', due: new Date(Date.now() - 86400000).toISOString().slice(0, 10), type: 'Phone call', category: 'Call', summary: 'Call about the spring gift', cid: '101', partner: 'Sample Partner One' },
      { id: 'a2', due: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10), type: 'Task', category: 'Task', summary: 'Send the annual report', cid: '102', partner: 'Sample Partner Two' },
    ],
  },
  google: {
    connected: true,
    mayWrite: true,
    mailUnread: 7,
    events: [
      { id: 'e1', start: iso(-20), end: iso(40), allDay: false, title: 'Weekly team check-in', link: 'https://calendar.google.com/x', meet: 'https://meet.google.com/aaa', phone: '', provider: 'meet', source: 'Google Meet', people: ['sample@example.org'], hub: '', organizer: true, canEdit: true, declined: false },
      { id: 'e2', start: iso(180), end: iso(240), allDay: false, title: 'Board prep', link: '', meet: '', phone: '', provider: 'favor', source: 'Favor Meetings', people: [], hub: 'abcdef0123456789abcdef01', organizer: true, canEdit: false, declined: false },
    ],
    mail: [{ id: 'm1', threadId: 't1', from: 'Sample Sender', fromEmail: 'sender@example.org', subject: 'Question about the report', date: iso(-90), link: 'https://mail.google.com/x' }],
    files: [{ id: 'f1', name: 'Q4 plan', link: 'https://docs.google.com/x', modified: iso(-300), by: 'Colleague Name', mime: 'application/vnd.google-apps.document' }],
    partners: { 'sample@example.org': { name: 'Sample Partner One', id: '101' } },
  },
};

export const kpi: KpiResponse = {
  ok: true,
  summary: {
    asOf: '2026-10-12',
    lastUpdated: iso(-120),
    raised: 4_120_000,
    goal: 6_000_000,
    raisedLastYear: 3_800_000,
    teams: [
      { key: 'rdd', name: 'RDD', amount: 2_000_000, goal: 3_000_000, measure: 'raised' },
      { key: 'pc', name: 'Partner Care', amount: 900_000, goal: 1_200_000, measure: 'raised' },
      { key: 'grants', name: 'Grants', amount: 300_000, goal: 800_000, measure: 'awarded' },
    ],
  },
};
