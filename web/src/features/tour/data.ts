// The guided tour: who the person is, which tour they get and what each stop says. No page code in this file, so the
// browser, the web app and the tests all read the same steps.
//
// A tour follows a working day. It opens on Today, goes to the two or three screens the person's job uses most, then shows
// the tools everyone shares (Brain, Chat, Meetings, Mail, Projects and the request form) and ends on Help. It never runs
// past 8 stops. Every stop names the page, the thing to point at and one sentence to say.
//
// WHO SEES A STOP. Mail, Chat and Learn are limited to groups, and Meetings and Projects have their own switches. The
// answer from /api/hub/nav already folds those group settings in (access.mail, access.chat, access.learn,
// access.meetings, access.projects), so a stop that names a `need` is left out for anyone who cannot open that tool.
//
// COUNTS come only from the counts in the same nav answer, which are the person's own. A count is spoken only when it is
// above zero; at zero the stop says what the screen is for.
//
// Copy rules: no em dashes, no mention of AI, "partners", one short sentence, labels that state facts. Write {tap} where
// the person presses something; a phone reads "tap" and a computer reads "click".

export type Device = 'phone' | 'desk';

/** What this person may open, from the nav answer's access flags. */
export type Can = {
  work: boolean;
  gifts: boolean;
  chat: boolean;
  mail: boolean;
  learn: boolean;
  meetings: boolean;
  projects: boolean;
  kpi: boolean;
  hr: boolean;
  approver: boolean;
  expenses: boolean;
  admin: boolean;
  /** On the Early access list (or an admin): Alpha and Beta stops show. */
  early: boolean;
};

/** The person's own counts from the nav answer. */
export type Counts = Partial<Record<'workOpen' | 'chatMentions' | 'mailUnread' | 'projectsMine' | 'meetingsNow' | 'expensesWaiting' | 'inbox' | 'learn' | 'evals' | 'receiptsLeft' | 'brainRequests', number>>;

export type Who = {
  email: string;
  first: string;
  role: string;
  /** Jobs from /api/hub/nav: admin, rdd, partner_care, church, grants, support, exec, giftdesk, hr, approver. */
  jobs: string[];
  /** The KPI dashboard teams this person belongs to: rdd, ce, pc, grants, marketing. */
  teams: string[];
  can: Can;
  counts: Counts;
};

/** The parts of the nav answer the tour reads. Loose on purpose: an older answer may lack a key. */
export type NavAnswer = {
  user?: { name?: string; email?: string; role?: string };
  access?: Record<string, unknown>;
  counts?: Record<string, unknown>;
  kpiTeams?: string[];
  jobs?: string[];
};

const flag = (v: unknown) => v === true;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function whoFromNav(d: NavAnswer | null | undefined): Who {
  const a = d?.access || {};
  const c = d?.counts || {};
  const admin = flag(a.admin) || d?.user?.role === 'admin';
  const counts: Counts = {};
  for (const k of ['workOpen', 'chatMentions', 'mailUnread', 'projectsMine', 'meetingsNow', 'expensesWaiting', 'inbox', 'learn', 'evals', 'receiptsLeft', 'brainRequests'] as const) {
    const n = num(c[k]);
    if (n) counts[k] = n;
  }
  return {
    email: String(d?.user?.email || '').toLowerCase(),
    first: String(d?.user?.name || '').trim().split(/\s+/)[0] || '',
    role: String(d?.user?.role || 'staff'),
    jobs: Array.isArray(d?.jobs) ? d!.jobs!.map(String) : [],
    teams: Array.isArray(d?.kpiTeams) ? d!.kpiTeams!.map(String) : [],
    can: {
      work: flag(a.workCenter),
      gifts: flag(a.giftEntry),
      chat: flag(a.chat),
      mail: flag(a.mail),
      learn: flag(a.learn),
      meetings: flag(a.meetings),
      projects: flag(a.projects),
      kpi: flag(a.kpi),
      hr: flag(a.hr),
      approver: flag(a.approver),
      expenses: flag(a.expenseLog) || flag(a.approver),
      admin,
      early: flag(a.early) || admin,
    },
    counts,
  };
}

export type TourId = 'admin' | 'exec' | 'rdd' | 'partner_care' | 'church' | 'grants' | 'support' | 'marketing' | 'staff';

export const TOUR_IDS: TourId[] = ['admin', 'exec', 'rdd', 'partner_care', 'church', 'grants', 'support', 'marketing', 'staff'];

export const TOUR_LABEL: Record<TourId, string> = {
  admin: 'FavorOS admins',
  exec: 'Leadership',
  rdd: 'Regional directors',
  partner_care: 'Partner Care',
  church: 'Church Engagement',
  grants: 'Grants',
  support: 'the Support Team',
  marketing: 'Marketing',
  staff: 'every staff member',
};

/** Which tour a person gets. An admin first, then a job, then the leaders (all five dashboard teams, no job of their own), then Marketing, then the fallback. */
export function pickTour(w: Who): TourId {
  if (w.can.admin) return 'admin';
  if (w.jobs.includes('exec')) return 'exec';
  if (w.jobs.includes('rdd')) return 'rdd';
  if (w.jobs.includes('partner_care')) return 'partner_care';
  if (w.jobs.includes('church')) return 'church';
  if (w.jobs.includes('grants')) return 'grants';
  if (w.jobs.includes('support') || w.jobs.includes('giftdesk')) return 'support';
  if (w.teams.length >= 5) return 'exec';
  if (w.teams.includes('marketing')) return 'marketing';
  return 'staff';
}

/** The tour an admin previews with ?as=. Older preset names still work. */
export function tourFromAs(as: string | null | undefined): TourId | null {
  const key = String(as || '').trim().toLowerCase();
  const alias: Record<string, TourId> = { pc: 'partner_care', ce: 'church', leader: 'exec', leadership: 'exec', 'partner-care': 'partner_care' };
  const id = (alias[key] || key) as TourId;
  return TOUR_IDS.includes(id) ? id : null;
}

type Side = 'right' | 'left' | 'top' | 'bottom';
type Need = keyof Can;

export type StepDef = {
  id: string;
  /** The path the stop happens on, with the view when the page has several. Empty means whatever page the person is on. */
  page?: string;
  /** The menu item the pointer presses to get there (an id from src/data/areas.ts). */
  via?: string;
  /** What to point at, in order. The first one on the screen wins. None on the screen: the stop is left out. */
  at: string[];
  title: string;
  body: (w: Who) => string;
  need?: Need;
  side?: Side;
  /** What changes on a phone. */
  phone?: Partial<Pick<StepDef, 'at' | 'title' | 'body' | 'side'>>;
};

export type Step = Omit<StepDef, 'body' | 'need' | 'phone'> & { body: string };

const n = (v: number | undefined) => v || 0;
const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);

/* ---------------------------------------------------------------------------------------------- the stops */

const TODAY_NO_WEEK = 'Today shows what is waiting on you: actions due today and gifts to thank.';
const TODAY_PARTNERS = 'Today shows what is waiting on you: actions due today, gifts to thank and your week.';
const TODAY_GENERAL = 'Today shows what is waiting on you, most urgent first.';

const today = (body: string): StepDef => ({
  id: 'today',
  page: '/',
  via: 'home',
  at: ['#td-needs', '#t-cards', '.h-hello'],
  title: 'Start on Today',
  body: () => body,
  side: 'right',
  phone: { side: 'bottom' },
});

const actions = (extra = ''): StepDef => ({
  id: 'actions',
  page: '/work/?view=open',
  via: 'work',
  at: ['#wc-board', '#view', '.wc-sheet'],
  title: 'Your actions',
  need: 'work',
  body: (w) => (n(w.counts.workOpen) ? `${w.counts.workOpen} ${plural(w.counts.workOpen!, 'action or gift to thank is', 'actions and gifts to thank are')} waiting on you here.` : `Your open actions and the gifts waiting for your thank-you are listed here.${extra}`),
  side: 'right',
});

const mine = (body: string): StepDef => ({
  id: 'mine',
  page: '/work/?view=mine',
  via: 'partners-mine',
  at: ['#wc-board', '#view', '.wc-sheet'],
  title: 'Your partners',
  need: 'work',
  body: () => body,
  side: 'right',
});

const week: StepDef = {
  id: 'week',
  page: '/work/?view=week',
  via: 'partners-week',
  at: ['#view', '#wc-board', '.wc-sheet'],
  title: 'Your week',
  need: 'work',
  body: () => "This week's connections, meetings and one-on-ones are counted against your goals here.",
  side: 'right',
};

const kpi = (id: string, page: string, via: string, title: string, body: string): StepDef => ({
  id,
  page,
  via,
  at: ['#h-tabs', '.h-tabs'],
  title,
  need: 'kpi',
  body: () => body,
  side: 'bottom',
});

const highlights: StepDef = {
  id: 'highlights',
  page: '/highlights/',
  via: 'reporting',
  at: ['.rg-pace-grid', '#rg-week', '.rg-pace'],
  title: 'The week in plain words',
  need: 'kpi',
  body: () => 'Each goal shows where it ends the year, and each team has its week written out.',
  side: 'bottom',
};

const churches: StepDef = {
  id: 'churches',
  page: '/churches/',
  via: 'partners-churches',
  at: ['.ch-band', '.ch-list', '.ch-page'],
  title: 'Churches',
  need: 'work',
  body: () => 'Every church partner is here with their giving, their pastor and when the next call is due.',
  side: 'bottom',
};

/** Each tour's own screens, two or three. */
const TEAM: Record<TourId, StepDef[]> = {
  rdd: [
    actions(),
    mine('Every partner you hold is here, with their giving and when anyone last spoke to them.'),
    week,
  ],
  church: [
    actions(),
    mine('Every church and partner you hold is here, with their giving and when anyone last spoke to them.'),
    churches,
  ],
  partner_care: [
    {
      id: 'cadence',
      page: '/work/?view=cadence',
      via: 'partners-cadence',
      at: ['#wc-board', '#view', '.wc-sheet'],
      title: 'Partners due for contact',
      need: 'work',
      body: () => 'Cadence lists the partners due for a card or a call under the Partner Care manual.',
      side: 'right',
    },
    {
      id: 'online-gifts',
      page: '/online-gifts/',
      via: 'online-gifts',
      at: ['#og-app'],
      title: "This morning's online gifts",
      need: 'early',
      body: () => "Each morning's online gifts wait here with the partner's comment, ready for you to approve.",
      side: 'right',
    },
    {
      id: 'recurring',
      page: '/gifts/recurring/',
      via: 'recurring',
      at: ['.rg-list', '#rg-root', '.rg'],
      title: 'Recurring gifts',
      need: 'work',
      body: () => 'Every monthly schedule is here with its declined charges, past-due dates and stopped schedules.',
      side: 'bottom',
    },
  ],
  grants: [
    {
      id: 'foundations',
      page: '/foundations/',
      via: 'foundations',
      at: ['#fnd-q', '#fnd-app'],
      title: 'Check a foundation first',
      body: () => 'One search covers this list and every organization in Blackbaud, and shows who at Favor already talked to them.',
      side: 'bottom',
    },
    {
      id: 'grants',
      page: '/work/?view=grants',
      via: 'partners-grants',
      at: ['#wc-board', '#view', '.wc-sheet'],
      title: 'Grant reports and proposals',
      need: 'work',
      body: () => 'Grant reports, proposals and conversations with funders are listed here.',
      side: 'right',
    },
    actions(),
  ],
  support: [
    {
      id: 'gift-entry',
      page: '/gift-entry/',
      via: 'gift-entry',
      at: ['.ge-card', '#ge-root'],
      title: 'Gift entry',
      need: 'gifts',
      body: () => 'Photograph checks and reply slips here, review each gift and send the batch to Blackbaud.',
      side: 'bottom',
    },
    {
      id: 'entry',
      page: '/work/?view=intake',
      via: 'partners-entry',
      at: ['#wc-board', '#view', '.wc-sheet'],
      title: 'Contacts to enter',
      need: 'work',
      body: () => "The directors' contacts waiting to be entered in Blackbaud are listed here.",
      side: 'right',
    },
    {
      id: 'receipts',
      page: '/receipts/',
      via: 'receipts',
      at: ['#rcp-stats', '#rcp-root'],
      title: 'Receipts',
      need: 'gifts',
      body: () => 'Receipts lists each gift that still needs its printed receipt, and the print file starts here.',
      side: 'bottom',
    },
  ],
  marketing: [
    kpi('marketing', '/dashboard/?page=%2Fmarketing', 'kpi-marketing', 'Marketing numbers', "Your team's numbers are on the Marketing tab, and Definitions says how each is counted."),
    highlights,
  ],
  exec: [
    kpi('executive', '/dashboard/', 'kpi', 'The year at a glance', 'The Executive tab shows the year at a glance, and Definitions says how every number is counted.'),
    highlights,
    {
      id: 'approvals',
      page: '/expenses/',
      via: 'expenses',
      at: ['#exp-log', '#exp-mine'],
      title: 'Expense approvals',
      need: 'expenses',
      body: (w) => (n(w.counts.expensesWaiting) ? `${w.counts.expensesWaiting} expense ${plural(w.counts.expensesWaiting!, 'request waits', 'requests wait')} for your approval.` : 'Expense requests that need your approval are logged here.'),
      side: 'bottom',
    },
    {
      id: 'reports',
      page: '/reports/',
      via: 'reports',
      at: ['.rp-groups', '#rp-root'],
      title: 'Reports',
      need: 'kpi',
      body: () => 'Daily revenue, lists and yearly reports open here, with CSV and Google Sheets.',
      side: 'bottom',
    },
  ],
  admin: [
    {
      id: 'overview',
      page: '/admin/',
      via: 'admin-home',
      at: ['#ad-strip', '#ad-root'],
      title: 'The jobs behind FavorOS',
      need: 'admin',
      body: () => 'Each tile shows when a job last ran and whether it is OK, Late or Failed.',
      side: 'bottom',
    },
    {
      id: 'people',
      page: '/admin/people/',
      via: 'admin-people',
      at: ['#pp-find', '#pp-table'],
      title: 'People and roles',
      need: 'admin',
      body: () => 'Find anyone who can sign in here, and set their role, team and Work Center access.',
      side: 'bottom',
    },
    {
      id: 'inbox',
      page: '/projects/',
      via: 'projects',
      at: ['.pj-seg', '.pj-pane'],
      title: 'The Intake column',
      body: (w) => (n(w.counts.inbox) ? `${w.counts.inbox} ${plural(w.counts.inbox!, 'request waits', 'requests wait')} in Intake for review.` : "New requests land in Intake on your team's board, where you accept, ask or decline."),
      side: 'right',
      phone: { at: ['.pj-seg'] },
    },
  ],
  staff: [
    {
      id: 'expenses',
      page: '/expenses/',
      via: 'expenses',
      at: ['#exp-mine', '.exp-page'],
      title: 'Expenses',
      body: () => 'Your expense requests are here with their status, and a new request is signed online.',
      side: 'bottom',
    },
    {
      id: 'numbers',
      page: '/dashboard/',
      via: 'kpi',
      at: ['#h-tabs', '.h-tabs'],
      title: 'The numbers',
      need: 'kpi',
      body: () => 'Reporting opens on the year at a glance, and Definitions says how each number is counted.',
      side: 'bottom',
    },
  ],
};

/** The tools every tour can include. A tour keeps the first ones its order allows. */
const SHARED: Record<string, StepDef> = {
  brain: {
    id: 'brain',
    page: '/brain/',
    via: 'brain',
    at: ['.bc-compose', '#bc-compose', '.bc-starters', '.bc-pane'],
    title: 'Ask Favor Brain',
    body: () => 'Ask about a partner, a team number or a manual in plain words, and the answer comes back as cards and tables.',
    side: 'top',
  },
  chat: {
    id: 'chat',
    page: '/chat/',
    via: 'chat',
    at: ['.ch-list', '.ch-side', '#chat-root'],
    title: 'Chat',
    need: 'chat',
    body: (w) => (n(w.counts.chatMentions) ? `${w.counts.chatMentions} ${plural(w.counts.chatMentions!, 'mention or unread message waits', 'mentions and unread messages wait')} for you in Chat.` : 'Channels and direct messages are listed here, and a message can become a task.'),
    side: 'right',
  },
  meetings: {
    id: 'meetings',
    page: '/meet/',
    via: 'meet',
    at: ['.dv-bar', '#mt-day', '.dv'],
    title: 'Meetings',
    need: 'meetings',
    body: (w) => (n(w.counts.meetingsNow) ? 'A meeting is running now, and Calendar starts or joins any meeting.' : 'Calendar starts or joins a meeting, and the notes and action items follow in Notes.'),
    side: 'bottom',
  },
  mail: {
    id: 'mail',
    page: '/mail/',
    via: 'mail',
    at: ['.ml-compose', '.ml-pn[aria-label="New message"]', '.ml-side'],
    title: 'Mail',
    need: 'mail',
    body: () => 'Compose starts a new message in your Favor Gmail, right inside FavorOS.',
    side: 'right',
    phone: { side: 'bottom' },
  },
  projects: {
    id: 'projects',
    page: '/projects/',
    via: 'projects',
    at: ['.pj-seg', '.pj-ph', '#pj-root'],
    title: 'Projects',
    need: 'projects',
    body: (w) => (n(w.counts.projectsMine) ? `Projects has ${w.counts.projectsMine} ${plural(w.counts.projectsMine!, 'item', 'items')} waiting on you, and My tasks lists your own work.` : 'My tasks, your projects, boards and the calendar are all here, and requests you send are one tab over.'),
    side: 'bottom',
  },
  request: {
    id: 'request',
    page: '/projects/',
    via: 'projects',
    at: ['.pj-seg', '.pj-pane'],
    title: 'Requests you send',
    body: () => 'Press Make a request, say what you need, and follow it under My requests until the email says it is done.',
    side: 'bottom',
  },
  learn: {
    id: 'learn',
    page: '/learn/',
    via: 'learn',
    at: ['#ln', '.ln-head'],
    title: 'Learning',
    need: 'learn',
    body: (w) => (n(w.counts.learn) ? `${w.counts.learn} ${plural(w.counts.learn!, 'course or path is', 'courses and paths are')} assigned to you, with where you left off.` : 'Courses and paths assigned to you are here, with where you left off.'),
    side: 'bottom',
  },
};

/** The order the shared stops are shown in. */
const SHARED_ORDER = ['brain', 'chat', 'meetings', 'mail', 'projects', 'request', 'learn'] as const;

/** Which shared stops a tour prefers when the 8-stop limit forces a choice, most wanted first. */
const SHARED_PREFER: Record<TourId, string[]> = {
  rdd: ['mail', 'chat', 'projects', 'brain', 'request', 'meetings', 'learn'],
  church: ['mail', 'chat', 'projects', 'brain', 'request', 'meetings', 'learn'],
  partner_care: ['chat', 'projects', 'brain', 'request', 'mail', 'meetings', 'learn'],
  grants: ['brain', 'projects', 'chat', 'request', 'mail', 'meetings', 'learn'],
  support: ['request', 'projects', 'chat', 'brain', 'mail', 'meetings', 'learn'],
  marketing: ['projects', 'request', 'chat', 'brain', 'mail', 'meetings', 'learn'],
  exec: ['brain', 'chat', 'meetings', 'mail', 'projects', 'request', 'learn'],
  admin: ['projects', 'request', 'chat', 'mail', 'brain', 'meetings', 'learn'],
  staff: ['request', 'projects', 'brain', 'learn', 'chat', 'mail', 'meetings'],
};

const TODAY_BODY: Record<TourId, string> = {
  rdd: TODAY_PARTNERS,
  church: TODAY_NO_WEEK,
  partner_care: TODAY_NO_WEEK,
  grants: TODAY_GENERAL,
  support: TODAY_GENERAL,
  marketing: TODAY_GENERAL,
  exec: 'Today shows what is waiting on you, most urgent first, with the approvals that need you.',
  admin: 'Today shows what is waiting on you, most urgent first, including requests to review.',
  staff: TODAY_GENERAL,
};

const HELP: StepDef = {
  id: 'help',
  page: '/help/',
  via: 'docs',
  at: ['.hd-hero__acts', '.hd-search', '.hd-hero'],
  title: 'Help',
  body: () => "Every page has a ? button for its guide, and you can replay this tour or open What's new from here whenever you want.",
  side: 'bottom',
};

/** The most stops any tour has. */
export const MAX_STEPS = 8;

const allowed = (d: StepDef, w: Who) => !d.need || w.can[d.need];

/** The stop as one device reads it. */
export function resolve(d: StepDef, w: Who, device: Device): Step {
  const p = device === 'phone' ? d.phone : undefined;
  const body = (p?.body || d.body)(w);
  return { id: d.id, page: d.page, via: d.via, at: p?.at || d.at, title: p?.title || d.title, body, side: p?.side || d.side };
}

/** The ordered stops for one tour and one person. Always Today first and Help last, 5 to 8 stops. */
export function tourDefs(id: TourId, w: Who): StepDef[] {
  const head = [today(TODAY_BODY[id]), ...TEAM[id].filter((s) => allowed(s, w))];
  const room = MAX_STEPS - head.length - 1;
  const pool = SHARED_PREFER[id].filter((k) => allowed(SHARED[k], w));
  const keep = new Set(pool.slice(0, Math.max(0, room)));
  const shared = SHARED_ORDER.filter((k) => keep.has(k)).map((k) => SHARED[k]);
  return [...head, ...shared, HELP];
}

export function tourFor(id: TourId, w: Who, device: Device): Step[] {
  return tourDefs(id, w).map((d) => resolve(d, w, device));
}

/** {tap} and {Tap} become the word for the device. */
export function say(text: string, device: Device): string {
  const word = device === 'phone' ? 'tap' : 'click';
  return text.replace(/\{tap\}/g, word).replace(/\{Tap\}/g, word[0].toUpperCase() + word.slice(1));
}

/** The pages a tour visits, for the tests and the walk. */
export function tourPages(id: TourId, w: Who): string[] {
  return tourDefs(id, w).map((d) => d.page || '(any page)');
}

export const allStepDefs = (): StepDef[] => [
  today(''),
  ...Object.values(TEAM).flat(),
  ...Object.values(SHARED),
  HELP,
];
