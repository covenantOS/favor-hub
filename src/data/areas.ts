// The hub's navigation, in one file. The sidebar (slim rail and full), the tab row under the header,
// the phone bottom bar, Ctrl K and the old-URL redirects all read this list. A new page is one entry
// in a page list below. Nothing else in the layout changes.
//
// `need` is an access flag from /api/hub/nav (admin, kpi, expenseLog, workCenter, clips, meetings).
// `team` is a KPI dashboard team. `count` is a key of the counts that answer returns.
// `also` lists other nav ids (the `nav` prop a page passes to the App layout) that belong to the page.

export type Need = 'admin' | 'kpi' | 'expenseLog' | 'workCenter' | 'clips' | 'meetings' | 'chat' | 'projects' | 'hr' | 'mail';

export interface NavPage {
  id: string;
  label: string;
  href: string;
  /** What Ctrl K shows under the title. */
  desc: string;
  keywords?: string;
  need?: Need;
  team?: string;
  count?: string;
  also?: string[];
  /** Help article slug for the page's Learn link. */
  learn?: string;
  /** A page that opens another site. */
  ext?: boolean;
  /** The page keeps its own frame (the KPI dashboard swaps its tab inside the page). */
  kpiPage?: string;
  /** Pages tested to swap in place without a full reload. */
  swap?: boolean;
}

export interface NavArea {
  id: string;
  label: string;
  /** The word under the icon in the slim rail. */
  short?: string;
  icon: string;
  /** G then this key jumps to the area. */
  key: string;
  /** Lower number wins a place on the five-slot phone bar. */
  barRank: number;
  /** Sits at the foot of the rail instead of the top. */
  foot?: boolean;
  beta?: boolean;
  /** Tools pop out of the rail as a small menu. */
  pop?: boolean;
  pages: NavPage[];
}

export const AREAS: NavArea[] = [
  {
    id: 'today',
    label: 'Today',
    icon: 'home',
    key: 't',
    barRank: 1,
    pages: [
      { id: 'home', label: 'Today', href: '/', desc: 'What is waiting on you', keywords: 'home start due waiting', learn: 'today', swap: true },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    icon: 'work',
    key: 'w',
    barRank: 2,
    pages: [
      { id: 'work-home', label: 'Overview', href: '/work-home/', desc: 'Every work tool and what is waiting in each', keywords: 'work home overview tools', learn: 'work-center', swap: true },
      { id: 'work', label: 'Work Center', href: '/work/', desc: 'Finish many Blackbaud actions together, enter the week, thank gifts', keywords: 'work center bulk select complete actions thank you entry tracking stale reassign reschedule support partner', need: 'workCenter', count: 'workOpen', learn: 'work-center', swap: true },
      { id: 'board', label: 'Requests', href: '/requests/', desc: 'Request board: inbox, approved, in motion, done', keywords: 'request board kanban review approve website portal app marketing', count: 'board', also: ['new'], learn: 'request-board', swap: true },
      { id: 'projects', label: 'Projects', href: '/projects/', desc: 'Projects, task lists, boards, calendar and timeline', keywords: 'projects project tasks task list board calendar timeline gantt assign due asana todo my tasks', need: 'projects', count: 'projectsMine', also: ['project'], learn: 'projects' },
      { id: 'expense', label: 'Expenses', href: '/expenses/new', desc: 'Expense request, signed online', keywords: 'expense request travel pre-travel approval signature purchase', learn: 'expense-request' },
      { id: 'receipts', label: 'Receipts', href: '/receipts/', desc: 'Thank-you receipts Blackbaud has waiting', keywords: 'thank you receipt receipts ty acknowledgement print mail', count: 'receiptsLeft', learn: 'thank-you-receipts', swap: true },
      { id: 'statements', label: 'Statements', href: '/statements/', desc: 'Giving statements on request and the January year-end statements', keywords: 'giving statement statements year-end tax january annual receipt pdf print mail partner', learn: 'giving-statements', swap: true },
      { id: 'evals', label: 'Evaluations', href: '/evaluations/', need: 'hr', desc: 'Your evaluation, the feedback you owe a colleague and your team’s reviews', keywords: 'evaluation evaluations review reviews self assessment feedback 360 performance development plan goals rre supervisor hr', count: 'evals', also: ['evals-admin'], learn: 'evaluations' },
      { id: 'foundations', label: 'Foundations', href: '/foundations/', desc: 'Check a foundation, log a contact', keywords: 'foundation foundations prospect grant rdd blackbaud unsolicited contact call', learn: 'foundation-prospects', swap: true },
    ],
  },
  {
    id: 'meet',
    label: 'Meetings',
    icon: 'video',
    key: 'm',
    barRank: 3,
    pages: [
      { id: 'meet', label: 'Day', href: '/meet/', desc: 'Start and join meetings', keywords: 'meeting meetings join start room video call', need: 'meetings', count: 'meetingsNow', learn: 'meetings', swap: true },
      { id: 'meet-book', label: 'Book', href: '/meet/book/', desc: 'Book a meeting from everyone’s calendars', keywords: 'book meeting schedule calendar invite', need: 'meetings', learn: 'meetings', swap: true },
      { id: 'meet-notes', label: 'Notes', href: '/meet/library/', desc: 'Notes, action items and transcripts from meetings', keywords: 'meeting notes transcript action items recording', need: 'meetings', learn: 'meetings', swap: true },
      { id: 'clips', label: 'Clips', href: '/clips/', desc: 'Your recorded clips, searchable by what was said', keywords: 'clips clip loom screen record recording video walkthrough share link transcript', need: 'clips', learn: 'clips' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: 'chat',
    key: 'c',
    barRank: 2.4,
    pages: [
      { id: 'chat', label: 'Chat', href: '/chat/', desc: 'Channels, direct messages and threads, with clips, meetings, Drive files and Favor Brain', keywords: 'chat message messages channel channels dm direct thread slack team talk mention', need: 'chat', count: 'chatMentions', learn: 'chat', swap: true },
    ],
  },
  {
    id: 'mail',
    label: 'Mail',
    icon: 'mail',
    key: 'e',
    // Behind More on the phone bar (four areas and More stay five).
    barRank: 4,
    pages: [
      { id: 'mail', label: 'Mail', href: '/mail/', desc: 'Your Gmail inside FavorOS: read, reply, archive, labels, drafts and search', keywords: 'mail email gmail inbox reply forward compose send draft archive label star snooze', need: 'mail', count: 'mailUnread', learn: 'mail' },
    ],
  },
  {
    id: 'ask',
    label: 'Favor Brain',
    short: 'Brain',
    icon: 'brain',
    key: 'b',
    barRank: 2.6,
    beta: true,
    pages: [
      { id: 'brain', label: 'Brain', href: '/brain/', desc: 'Ask about partners, giving, team numbers and the manuals', keywords: 'brain favor ask ai claude chatgpt question query beta chat', learn: 'ask-favor', swap: true },
      { id: 'connect-ai', label: 'Connect an AI app', href: '/help/connect-your-ai/', desc: 'Use the same answers from Claude or ChatGPT', keywords: 'connect claude chatgpt mcp connector ai app', learn: 'connect-your-ai' },
    ],
  },
  // learn: begin
  {
    id: 'learn',
    label: 'Learn',
    icon: 'book',
    key: 'l',
    barRank: 6,
    pages: [
      { id: 'learn', label: 'My learning', href: '/learn/', desc: 'Courses and paths assigned to you, and where you left off', keywords: 'learn learning course courses lms training lesson quiz certificate path onboarding assigned due', need: 'hr', count: 'learn', also: ['learn-course', 'learn-path', 'learn-cert'], learn: 'learn' },
      { id: 'learn-catalog', label: 'Catalog', href: '/learn/catalog/', desc: 'Every course and learning path', keywords: 'learn catalog courses paths training all', need: 'hr', learn: 'learn' },
      { id: 'practice', label: 'Practice', href: '/learn/practice/', desc: 'A pretend partner record for practicing gift entry and logging a call', keywords: 'practice pretend sample training gift entry log call new hire first week sandbox', need: 'hr', learn: 'learn' },
      { id: 'learn-admin', label: 'Manage', href: '/learn/admin/', desc: 'Build courses and paths, assign them, and see who has finished', keywords: 'learn manage admin author build course path assign report overdue scores hr', need: 'hr', learn: 'learn' },
    ],
  },
  // learn: end
  {
    id: 'kpi',
    label: 'Reporting',
    short: 'Reporting',
    icon: 'chart',
    key: 'k',
    barRank: 5,
    pages: [
      { id: 'kpi', label: 'Executive', href: '/dashboard/', desc: "The year's numbers", keywords: 'kpi dashboard revenue goals executive year', need: 'kpi', kpiPage: '/', learn: 'kpi-dashboard', swap: true },
      { id: 'reporting', label: 'Highlights', href: '/highlights/', desc: 'Where each goal ends the year, the week in plain language for each team, and your pinned Favor Brain answers', keywords: 'highlights pace pacing projection year end goal weekly week summary my dashboard pinned pins brain explain', need: 'kpi', learn: 'reporting' },
      { id: 'reports', label: 'Reports', href: '/reports/', desc: 'Daily revenue, lists and yearly reports, with CSV and Google Sheets', keywords: 'reports report blackbaud query queries daily revenue ytd income lybunt lapsed mailing list export csv sheets tax receipts prayer', learn: 'reports', swap: true },
      { id: 'lists', label: 'Lists', href: '/lists/', desc: 'Build a list of partners or gifts from menus, watch the count, save it for yourself or a team, and open it in Google Sheets', keywords: 'lists list builder partners gifts lybunt lapsed active major acquisition holder state zip fund appeal mailing export csv sheets saved segment', need: 'workCenter', learn: 'lists-and-downloads' },
      { id: 'kpi-rdds', label: 'RDD team', href: '/dashboard/?page=%2Frdds', desc: 'Regional directors', keywords: 'rdd regional directors team kpi', need: 'kpi', team: 'rdd', kpiPage: '/rdds' },
      { id: 'kpi-pc', label: 'Partner Care', href: '/dashboard/?page=%2Fpc', desc: 'Partner Care team numbers', keywords: 'partner care pc kpi', need: 'kpi', team: 'pc', kpiPage: '/pc' },
      { id: 'kpi-ce', label: 'Church Engagement', href: '/dashboard/?page=%2Fce', desc: 'Church Engagement team numbers', keywords: 'church engagement ce kpi', need: 'kpi', team: 'ce', kpiPage: '/ce' },
      { id: 'kpi-grants', label: 'Grants', href: '/dashboard/?page=%2Fgrants', desc: 'Grants team numbers', keywords: 'grants kpi foundations', need: 'kpi', team: 'grants', kpiPage: '/grants' },
      { id: 'kpi-marketing', label: 'Marketing', href: '/dashboard/?page=%2Fmarketing', desc: 'Marketing team numbers', keywords: 'marketing kpi', need: 'kpi', team: 'marketing', kpiPage: '/marketing' },
      { id: 'kpi-definitions', label: 'Definitions', href: '/dashboard/?page=%2Fdefinitions', desc: 'How each number is counted', keywords: 'definitions active lybunt lapsed major partner counted', need: 'kpi', kpiPage: '/definitions', learn: 'kpi-definitions' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'shield',
    key: 'x',
    barRank: 9,
    foot: true,
    pages: [
      { id: 'admin-home', label: 'Overview', href: '/admin/', desc: 'Health of the Blackbaud copy, the morning jobs, the sender and the call meter, with every setting one click away', keywords: 'admin overview health status settings jobs sync meter iwave', need: 'admin', learn: 'admin-home' },
      { id: 'admin-people', label: 'People and roles', href: '/admin/people/', desc: 'Who can sign in, their role, team, fundraiser link and Work Center access, with an act as preview', keywords: 'people users roles admin block team fundraiser work center access act as preview staff', need: 'admin', learn: 'admin-home' },
      { id: 'admin-settings', label: 'Settings', href: '/admin/work-center/', desc: 'Work Center, Meetings, Favor Brain, Clips, Reports, Expenses, Thank-you receipts and Giving statements and Projects settings', keywords: 'receipts mileage substitute settings work center cap lane rollout start meetings guests recording folder reminder brain connect titles clips storage reports roles expenses approver', need: 'admin', also: ['admin-work', 'admin-meetings', 'admin-brain', 'admin-clips', 'admin-reports', 'admin-expenses', 'admin-receipts', 'admin-statements', 'admin-chat', 'admin-projects'], learn: 'admin-home' },
      { id: 'admin-bbusers', label: 'Blackbaud users', href: '/admin/blackbaud-users/', desc: 'Everyone with a Blackbaud login, their status and what each product lets them do', keywords: 'blackbaud users logins access roles inactive admin raisers edge security', need: 'admin', learn: 'admin-home' },
      { id: 'onboarding', label: 'Onboarding', href: '/onboarding/', desc: 'Start a new hire or an exit: the checklist, who owns each step, and what FavorOS sets up', keywords: 'onboarding offboarding new hire start staff exit leaving checklist welcome orientation hr', need: 'hr', also: ['onboarding-run'], learn: 'onboarding' },
      { id: 'admin-appeals', label: 'Appeal codes', href: '/admin/appeal-codes/', desc: 'Build an appeal code from the scheme and create it in Blackbaud, and keep the funds and campaigns waiting to be created', keywords: 'appeal codes campaign fund lookup newsletter letter mailing create blackbaud scheme', need: 'admin', learn: 'admin-home' },
      { id: 'admin-tours', label: 'Tours', href: '/admin/tours/', desc: 'Who finished the tour and each release', keywords: 'tours tour walkthrough walkthroughs adoption finished new in favoros release send again onboarding training', need: 'admin', learn: 'guided-tour' },
      { id: 'admin-audit', label: 'Audit log', href: '/admin/audit/', desc: 'Every settings change with who made it, when, and the before and after values', keywords: 'audit log history changes who changed settings', need: 'admin', learn: 'admin-home' },
      { id: 'brain-admin', label: 'Brain requests', href: '/brain/admin/', desc: 'Access requests, who can ask about what, every question asked', keywords: 'brain admin access requests iwave approvals names', need: 'admin', count: 'brainRequests', learn: 'ask-favor' },
      { id: 'expenses', label: 'Expense log', href: '/expenses/', desc: 'Statuses, signed PDFs, approver schedule', keywords: 'expense log approver schedule pdf admin', need: 'expenseLog', count: 'expensesWaiting', learn: 'expense-log' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'help',
    key: 'h',
    barRank: 9,
    foot: true,
    pages: [
      { id: 'docs', label: 'Docs', href: '/help/', desc: 'How every tool works, with search', keywords: 'help guide how docs documentation article manual faq', learn: 'getting-started', swap: true },
      { id: 'videos', label: 'Videos', href: '/help/videos/', desc: 'FavorOS, Favor Brain and Blackbaud on video, with captions', keywords: 'video videos training tutorial learn blackbaud raisers edge', swap: true },
      { id: 'welcome', label: 'Welcome', href: '/welcome/', need: 'hr', desc: 'Your first week: who to meet, what is due, the FavorOS tour', keywords: 'welcome first day first week new hire onboarding orientation meet team', learn: 'welcome' },
      { id: 'feedback', label: 'Feedback', href: '/feedback/', desc: "Your notes and Will's answers", keywords: 'feedback note bug wrong idea suggestion problem report', count: 'feedback', learn: 'feedback', swap: true },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'tools',
    key: 'o',
    barRank: 9,
    foot: true,
    pop: true,
    pages: [
      { id: 'tool-blackbaud', label: 'Blackbaud', href: 'https://app.blackbaud.com/signin/?redirectUrl=https://app.blackbaud.com/', desc: 'Partner records', keywords: 'crm donors blackbaud raisers edge', ext: true },
      { id: 'tool-paycom', label: 'Paycom', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', desc: 'Time sheet, time off and expenses cards', keywords: 'paycom timesheet punch clock in out pto vacation time off accruals cards reimbursement', ext: true },
    ],
  },
];

/** Old and short URLs that still land in the right place. Mirrored in public/_redirects (a test keeps them equal). */
export const REDIRECTS: Array<[string, string]> = [
  ['/today', '/'],
  ['/kpi', '/dashboard/'],
  ['/work/home', '/work-home/'],
  ['/dashboards', '/dashboard/'],
  ['/ask', '/brain/'],
  ['/meetings', '/meet/'],
  ['/requests/board', '/requests/'],
  ['/expenses/request', '/expenses/new'],
  ['/receipts/thank-yous', '/receipts/'],
  ['/thank-yous', '/receipts/'],
  ['/foundation', '/foundations/'],
  ['/docs', '/help/'],
  ['/videos', '/help/videos/'],
];

/** Pages that exist but are not in the menu: the area and tab they sit under. */
export const EXTRA_NAV: Record<string, string> = {
  // route prefix -> nav id
};

/** Paths that swap in place (the page body only). */
export const SWAP_PATHS = Array.from(new Set(AREAS.flatMap((a) => a.pages.filter((p) => p.swap && !p.ext).map((p) => p.href.split('?')[0].replace(/\/?$/, '/')))));

/** Pages that always load whole, from any page: the Work Center keeps its state in globals other Work scripts read, and the dashboard keeps its own frame. */
export const FULL_LOAD_PATHS = ['/work/', '/dashboard/'];

export const NAV_IDS = new Map<string, { area: NavArea; page: NavPage }>();
for (const area of AREAS) {
  for (const page of area.pages) {
    NAV_IDS.set(page.id, { area, page });
    for (const alt of page.also || []) NAV_IDS.set(alt, { area, page });
  }
}

export function resolveNav(navId: string) {
  return NAV_IDS.get(navId) || null;
}

/** Everything Ctrl K lists for the hub's own pages. */
export function paletteItems() {
  const rows: Array<Record<string, unknown>> = [];
  for (const area of AREAS) {
    for (const p of area.pages) {
      rows.push({
        title: p.label,
        desc: `${area.label}${p.label === area.label ? '' : ' › ' + p.label} · ${p.desc}`,
        href: p.href,
        tags: `${area.label} ${p.label} ${p.keywords || ''}`.toLowerCase(),
        external: !!p.ext,
        group: area.label,
        need: p.need || '',
        team: p.team || '',
      });
    }
  }
  return rows;
}
