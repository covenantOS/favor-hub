// The guided tours. Each step names the page it happens on, the thing to point at, and what to say.
// A step can press something for the person (open search, switch a tab) or type an example into a
// box; it never sends, saves or signs anything. Steps carry who they are for, so each person gets
// the tour for their own work, and a date when the thing is new, which drives "What's new".

export type Who = {
  admin: boolean;
  approver: boolean;
  expenseLog: boolean;
  kpi: boolean;
  teams: string[];
  leader: boolean;
  first: string;
};

export type Step = {
  id: string;
  /** Path the step happens on; the tour goes there first. Empty means any page. */
  page?: string;
  /** What to point at. Missing or not found: the card shows in the middle of the screen. */
  at?: string;
  title: string;
  body: string | ((w: Who) => string);
  /** Press this before pointing (after the pointer moves to it). */
  press?: string;
  /** Type this into the element at `at`, letter by letter. */
  type?: string;
  /** Press this when leaving the step (close what `press` opened). */
  undo?: string;
  /** Who sees the step. Missing: everyone. */
  for?: (w: Who) => boolean;
  /** The date the thing became new, YYYY-MM-DD, for What's new. */
  added?: string;
  /** The menu item the pointer presses to get to `page`. */
  via?: string;
  side?: 'right' | 'left' | 'top' | 'bottom';
};

const team = (t: string) => (w: Who) => w.teams.includes(t);
const any = (...fs: Array<(w: Who) => boolean>) => (w: Who) => fs.some((f) => f(w));
const receiptsPeople = (w: Who) => w.admin || w.leader || w.teams.includes('marketing') || w.teams.includes('pc');
const foundationPeople = (w: Who) => w.admin || w.leader || w.teams.includes('grants') || w.teams.includes('rdd');

export function roleName(w: Who): string {
  if (w.admin) return 'the hub admin';
  if (w.leader) return 'leadership';
  const names: Record<string, string> = { rdd: 'the RDD team', pc: 'Partner Care', ce: 'Church Engagement', grants: 'Grants', marketing: 'Marketing' };
  const mine = w.teams.map((t) => names[t]).filter(Boolean);
  if (mine.length) return mine.join(' and ');
  return 'every Favor staff member';
}

export const STEPS: Step[] = [
  {
    id: 'today',
    page: '/',
    via: 'home',
    at: '.h-head',
    title: 'Today is your home page',
    body: 'The hub opens here every morning. It greets you, shows the date, and lists what is waiting on you.',
    side: 'bottom',
  },
  {
    id: 'today-cards',
    page: '/',
    at: '.h-board',
    title: 'What needs you',
    body: 'Things waiting on you sit on the left, with a button that takes you straight to the work. On the right are your Blackbaud actions due this week, and once you connect Google, your meetings, new files and who emailed you.',
    side: 'bottom',
  },
  {
    id: 'today-year',
    page: '/',
    at: '#t-year-wrap',
    title: 'Where the year stands',
    body: "Money raised against the year's goal and each team's progress, from the KPI dashboard's own numbers.",
    for: (w) => w.kpi,
    side: 'top',
  },
  {
    id: 'menu',
    at: '.h-side nav',
    title: 'Every tool lives in the menu',
    body: 'Work tools sit at the top. A number beside a tool shows how much is waiting there for you. Your KPI dashboard tabs are below them.',
    side: 'right',
  },
  {
    id: 'search',
    at: '#cmdk .cmdk__panel',
    press: '[data-cmdk-open]',
    type: 'receipts',
    undo: '[data-cmdk-close]',
    title: 'Search finds any tool',
    body: 'Press Ctrl and K together on any page (Command and K on a Mac), type a few letters, and press Enter. It finds tools, help topics and videos.',
    side: 'bottom',
  },
  {
    id: 'request',
    page: '/requests/new',
    via: 'new',
    at: '#route-text',
    type: 'Could we add the October newsletter to the website?',
    title: 'Make a request, in your own words',
    body: 'Say what you need the way you would tell a coworker, then press Continue. The hub suggests where it goes: the request board, the Marketing team or an expense request. Nothing is sent until you finish the form.',
    side: 'bottom',
  },
  {
    id: 'board',
    page: '/requests/',
    via: 'board',
    at: '#req-board',
    title: 'The request board',
    body: (w) =>
      w.admin
        ? 'Every request and where it stands: Inbox, Approved, In motion and Done. Drag a card to move it. Finishing a card emails the person who asked.'
        : 'Every request and where it stands: Inbox, Approved, In motion and Done. Press a card to read it. You get an email when yours is done.',
    side: 'top',
  },
  {
    id: 'expense',
    page: '/expenses/new',
    via: 'expense',
    at: '.make-sheet',
    title: 'Expense requests are signed online',
    body: 'Use this before a purchase or a trip: add each expense, say why it is needed, sign, and send. The approver signs online and you get the signed copy by email.',
    side: 'right',
  },
  {
    id: 'expense-log',
    page: '/expenses/',
    via: 'expenses',
    at: '#exp-admin',
    title: 'The expense log',
    body: 'Every expense request, its status and the signed PDF. Press a request to read it and sign. A number in the menu shows how many wait for you.',
    for: (w) => w.expenseLog,
    side: 'top',
  },
  {
    id: 'receipts',
    page: '/receipts/',
    via: 'receipts',
    at: '#rcp-stats',
    title: 'Thank-you receipts',
    body: 'Every gift Blackbaud has not thanked yet. Make the print file, print it on the receipt paper, then come back and mark the gifts thanked so they never print twice.',
    for: receiptsPeople,
    side: 'bottom',
  },
  {
    id: 'foundations',
    page: '/foundations/',
    via: 'foundations',
    at: '#fnd-q',
    type: 'Foundation',
    title: 'Check a foundation before you call',
    body: 'One search covers this list and every organization in Blackbaud, so you can see who already talked to them and when. After a call, open the foundation and log the contact; it posts to Blackbaud for you.',
    for: foundationPeople,
    side: 'bottom',
  },
  {
    id: 'kpi',
    page: '/dashboard/',
    via: 'kpi',
    at: '#kpi-frame',
    title: 'The KPI dashboard',
    body: (w) =>
      w.leader || w.admin
        ? 'The Executive page has the year at a glance. Every team tab is in the menu under KPI dashboard, and Definitions explains how each number is counted.'
        : 'The Executive page has the year at a glance. Your team tab is in the menu under KPI dashboard, and Definitions explains how each number is counted.',
    for: (w) => w.kpi,
    side: 'left',
  },
  {
    id: 'kpi-team',
    at: '.h-nav__item[data-kpi-team]:not([hidden])',
    title: 'Your team tab',
    body: 'Your team goal, revenue by quarter and your own measures. The numbers rebuild from Raiser\'s Edge at 5 a.m. and 5 p.m. Eastern.',
    for: (w) => w.kpi && !w.leader && !w.admin && w.teams.length > 0,
    side: 'right',
  },
  {
    id: 'brain',
    page: '/brain/',
    via: 'brain',
    at: '.b-addr',
    title: 'Ask Favor, in beta',
    body: 'Connect Claude or ChatGPT to Favor once, then ask in plain words: "How many active partners do we have in Texas?" It reads Blackbaud, the KPI dashboard and the manuals, and only reads. It is new, so tell us when an answer is off.',
    added: '2026-10-09',
    side: 'bottom',
  },
  {
    id: 'brain-access',
    page: '/brain/',
    at: '.b-access',
    title: 'What you can ask about',
    body: 'Your role decides what Ask Favor can show you. If your work needs more, press Ask for it, say why, and Will decides.',
    added: '2026-10-09',
    side: 'left',
  },
  {
    id: 'brain-admin',
    page: '/brain/',
    at: '#admin',
    title: 'Who may ask about what',
    body: 'Access requests wait here for your decision. The People table shows what each person can see, and your changes show in gold. Contact lists are yours alone unless you give them to someone.',
    for: (w) => w.admin,
    added: '2026-10-09',
    side: 'top',
  },
  {
    id: 'feedback',
    at: '#h-fb',
    title: 'Tell us what you think',
    body: 'Something wrong, confusing, or a good idea? Press Feedback on any page. Your note goes to Will with the page you were on, and his answer shows under Feedback in the menu.',
    added: '2026-10-09',
    side: 'bottom',
  },
  {
    id: 'feedback-admin',
    page: '/feedback/',
    via: 'feedback',
    at: '#fb-list',
    title: 'Every note in one place',
    body: 'Notes from the hub, Ask Favor, the help docs and this tour land here. Mark each one seen, fixed or not now, and write a reply the sender reads. New notes show on Today and beside Feedback in the menu.',
    for: (w) => w.admin,
    added: '2026-10-09',
    side: 'top',
  },
  {
    id: 'docs',
    at: '[data-nav-id="docs"]',
    title: 'Help docs and training videos',
    body: 'Look up how anything works, from making a request to reading the KPI dashboard. The training videos are here too, with captions.',
    added: '2026-10-09',
    side: 'right',
  },
  {
    id: 'sound',
    at: '[data-sound-switch]',
    title: 'Sounds',
    body: 'The hub makes a soft sound when you press a main button or something finishes. Press the speaker to turn sounds off or on.',
    added: '2026-10-09',
    side: 'top',
  },
  {
    id: 'help',
    at: '#h-help',
    title: 'Come back any time',
    body: 'Press Help and what\'s new to take this tour again. A green dot on it means something new is waiting to be shown.',
    side: 'top',
  },
];

export function stepsFor(w: Who, mode: 'full' | 'new', since: string): Step[] {
  const mine = STEPS.filter((s) => !s.for || s.for(w));
  if (mode === 'full') return mine;
  const fresh = mine.filter((s) => s.added && s.added > since);
  return fresh.length ? fresh : mine.filter((s) => s.added);
}

export function latestAdded(): string {
  return STEPS.reduce((m, s) => (s.added && s.added > m ? s.added : m), '');
}
