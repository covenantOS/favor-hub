// The hub's navigation, in one file. The sidebar (slim rail and full), the tab row under the header,
// the phone bottom bar, Ctrl K and the old-URL redirects all read this list. A new page is one entry
// in a page list below. Nothing else in the layout changes.
//
// `need` is an access flag from /api/hub/nav (admin, kpi, expenseLog, workCenter, clips, meetings).
// `team` is a KPI dashboard team. `count` is a key of the counts that answer returns.
// `also` lists other nav ids (the `nav` prop a page passes to the App layout) that belong to the page.

export type Need = 'admin' | 'kpi' | 'expenseLog' | 'workCenter' | 'clips' | 'meetings';

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
      { id: 'work-home', label: 'Overview', href: '/work-home/', desc: 'Every work tool and what is waiting in each', keywords: 'work home overview tools', swap: true },
      { id: 'work', label: 'Work Center', href: '/work/', desc: 'Finish many Blackbaud actions together, enter the week, thank gifts', keywords: 'work center bulk select complete actions thank you entry tracking stale reassign reschedule support partner', need: 'workCenter', count: 'workOpen', learn: 'work-center', swap: true },
      { id: 'board', label: 'Requests', href: '/requests/', desc: 'Request board: inbox, approved, in motion, done', keywords: 'request board kanban review approve website portal app marketing', count: 'inbox', also: ['new'], learn: 'request-board', swap: true },
      { id: 'expense', label: 'Expenses', href: '/expenses/new', desc: 'Expense request, signed online', keywords: 'expense request travel pre-travel approval signature purchase', learn: 'expense-request' },
      { id: 'receipts', label: 'Thank-yous', href: '/receipts/', desc: 'Thank-you receipts Blackbaud has waiting', keywords: 'thank you receipt receipts letter letters ty acknowledgement print mail', count: 'receiptsLeft', learn: 'thank-you-receipts', swap: true },
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
    id: 'ask',
    label: 'Favor Brain',
    short: 'Brain',
    icon: 'brain',
    key: 'b',
    barRank: 4,
    beta: true,
    pages: [
      { id: 'brain', label: 'Chat', href: '/brain/', desc: 'Ask about partners, giving, team numbers and the manuals', keywords: 'brain favor ask ai claude chatgpt question query beta chat', learn: 'ask-favor', swap: true },
      { id: 'connect-ai', label: 'Connect an AI app', href: '/help/connect-your-ai/', desc: 'Use the same answers from Claude or ChatGPT', keywords: 'connect claude chatgpt mcp connector ai app', learn: 'connect-your-ai' },
    ],
  },
  {
    id: 'kpi',
    label: 'Reporting',
    short: 'Reporting',
    icon: 'chart',
    key: 'k',
    barRank: 5,
    pages: [
      { id: 'kpi', label: 'Executive', href: '/dashboard/', desc: "The year's numbers", keywords: 'kpi dashboard revenue goals executive year', need: 'kpi', kpiPage: '/', learn: 'kpi-dashboard', swap: true },
      { id: 'reports', label: 'Reports', href: '/reports/', desc: 'Daily revenue, lists and yearly reports, with CSV and Google Sheets', keywords: 'reports report blackbaud query queries daily revenue ytd income lybunt lapsed mailing list export csv sheets tax receipts prayer', learn: 'reports', swap: true },
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
      { id: 'admin-audit', label: 'Audit log', href: '/admin/audit/', desc: 'Every settings change with who made it, when, and the before and after values', keywords: 'audit log history changes who changed settings', need: 'admin', learn: 'admin-home' },
      { id: 'brain-admin', label: 'Brain requests', href: '/brain/admin/', desc: 'Access requests, who can ask about what, every question asked', keywords: 'brain admin access requests iwave approvals names', need: 'admin', count: 'brainRequests' },
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
      { id: 'videos', label: 'Videos', href: '/help/videos/', desc: 'The hub, Favor Brain and Blackbaud on video, with captions', keywords: 'video videos training tutorial learn blackbaud raisers edge', swap: true },
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
  ['/reporting', '/dashboard/'],
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
