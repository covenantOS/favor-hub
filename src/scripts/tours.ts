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
    at: '#bc-compose',
    title: 'Ask in plain words',
    body: 'Type a question and press Enter. Answers come back as cards and tables you can press, not only text: a partner card, team numbers by quarter and month, a chart, steps from the manuals. When a question could mean two things, you get buttons to pick from. It is new, so press Not right when an answer is off.',
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'brain-read',
    page: '/brain/',
    at: '.bc-starters',
    title: 'Change how it read you',
    body: 'Under each answer, "How I read it" shows the year, state or team it used. Press one and pick another, and the answer redraws in place. Follow-up buttons under the newest answer ask the next question for you.',
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'brain-chats',
    page: '/brain/',
    at: '#bc-rail',
    title: 'Your chats',
    body: 'Every conversation is kept for 30 days. Search them, rename one, pin the ones you come back to, or delete one. Ctrl Shift O starts a new chat. The icon at the top right of the chat hides the hub menu so the chat gets the whole window.',
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'brain-sheets',
    page: '/brain/',
    at: '[data-sheets]',
    title: 'Open a list in Google Sheets',
    body: 'Beside Copy and CSV on every list, Open in Google Sheets makes a private sheet in your own Drive. The first time, Google asks once for permission. Only you can open the sheet until you share it, and it holds partner information, so keep it inside Favor.',
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'brain-connect',
    page: '/brain/',
    at: '[data-act="connect"]',
    title: 'Use it from Claude or ChatGPT',
    body: 'Your own AI can compare two lists, combine answers and follow up on anything you ask. This opens the steps; follow them once.',
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'brain-access',
    page: '/brain/',
    at: '#bc-menu',
    title: 'What you can ask about',
    body: 'The three dots hold What you can ask about. Your role decides it. If your work needs more, press Ask Will, say why, and Will decides.',
    added: '2026-10-10',
    side: 'left',
  },
  {
    id: 'brain-admin',
    page: '/brain/admin/',
    via: 'brain-admin',
    at: '.b-atabs',
    title: 'Who may ask about what',
    body: 'Access requests wait here for your decision, People shows what each person can see with your changes in gold, Activity lists every question, Names shows questions it could not place or whose fund or campaign name missed, and iWave shows the credits, the screenings waiting for your approval and the log.',
    for: (w) => w.admin,
    added: '2026-10-09',
    side: 'bottom',
  },
  {
    id: 'work-center',
    page: '/work/',
    via: 'work',
    at: '#wc-board',
    title: 'Finish many actions at once',
    body: 'Pick a fundraiser, tick the actions you want or press Shift and click for a range, then press Mark complete. One date and one shared line go on all of them, and every batch can be undone from Recent for 24 hours. Large batches go out overnight by themselves, and the lists refresh through the day.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'partner-page',
    page: '/work/partner/',
    via: 'work',
    at: '#pv-search',
    title: 'Find any partner',
    body: 'Type a name, an email, a phone number, a street address or a lookup id. The partner page shows contact details, giving by year, the largest and last gift, recurring gifts, open actions, notes, who holds the partner and the iWave rating. Every partner name in the Work Center opens it, and so does the search at the top of every page.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'clips',
    at: '#clip-cam',
    title: 'Record a clip from any page',
    body: 'Press the camera at the top right. Pick the full screen, a window or a tab, turn the camera and microphone on or off, and press Start recording. The camera shows as a round bubble you can drag anywhere. When you stop, the clip gets a title, a summary and chapters on its own, and you get a link. Only signed-in Favor staff can open it unless you turn on Anyone with the link.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
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
    body: 'Notes from the hub, Favor Brain, the help docs and this tour land here. Mark each one seen, fixed or not now, and write a reply the sender reads. New notes show on Today and beside Feedback in the menu.',
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
