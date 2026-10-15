// The hub's navigation, in one file. The sidebar (slim rail and full), the tab row under the header,
// the phone bottom bar, Ctrl K and the old-URL redirects all read this list. A new page is one entry
// in a page list below. Nothing else in the layout changes.
//
// `need` is an access flag from /api/hub/nav (admin, kpi, expenseLog, workCenter, clips, meetings).
// `team` is a KPI dashboard team. `count` is a key of the counts that answer returns.
// `also` lists other nav ids (the `nav` prop a page passes to the App layout) that belong to the page.
// `jobs` says whose daily work a page or an area is (the jobs /api/hub/nav returns for the signed-in person). An area with
// jobs sits in the rail for those people and under More for everyone else; a page with jobs comes first in the tab row for
// those people and sits in the row's More menu for everyone else. Nothing is locked by a job: `need` alone decides access.

export type Need = 'admin' | 'giftEntry' | 'kpi' | 'expenseLog' | 'workCenter' | 'clips' | 'meetings' | 'chat' | 'projects' | 'hr' | 'mail' | 'learn' | 'learnAdmin';

/** The jobs /api/hub/nav works out for a person (functions/_lib/hub/jobs.ts). Admins hold every job. */
export type Job = 'admin' | 'rdd' | 'partner_care' | 'church' | 'grants' | 'support' | 'exec' | 'giftdesk' | 'hr' | 'approver';

/** Who a job is, as the More menus name it. */
export const JOB_LABEL: Record<Job, string> = {
  admin: 'Admins',
  rdd: 'Regional directors',
  partner_care: 'Partner Care',
  church: 'Church Engagement',
  grants: 'Grants',
  support: 'Support Team',
  exec: 'Leadership',
  giftdesk: 'Admin desk',
  hr: 'HR',
  approver: 'Expense approvers',
};

/** The most tabs a row shows; the rest sit under the row's More menu. */
export const TAB_CAP = 6;

/** The date the Work area was split. Ctrl K shows a moved page's old place ("Was Work > Statements") for a month after. */
export const MOVED_ON = '2026-10-14';
export const MOVED_UNTIL = '2026-11-14';

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
  /** Whose daily work the page is. Without it the page is everyone's. */
  jobs?: Job[];
  /** Pages that sit together under one menu in the tab row (Reporting's Reports and Teams, Staff's Learning). */
  group?: string;
  /** False keeps the page out of the menu and the tab row; it still resolves for its header and Ctrl K. */
  menu?: false;
  /** Where the page used to sit, for Ctrl K's "Was" line in the month after the move. */
  was?: string;
  /** A small note beside the header title (Projects: Synced with Asana). */
  note?: string;
  /** A page out of the tab row (menu: false) lights this page's tab while it is open (New expense request lights Expenses). */
  parent?: string;
}

export interface NavArea {
  id: string;
  label: string;
  /** The word under the icon in the slim rail. */
  short?: string;
  icon: string;
  /** G then this key jumps to the area. */
  key: string;
  /** Lower number wins a place on the five-slot phone bar. The rail draws the areas in the same order. */
  barRank: number;
  /** Sits at the foot of the rail instead of the top. */
  foot?: boolean;
  beta?: boolean;
  /** Tools pop out of the rail as a small menu. */
  pop?: boolean;
  /** Whose daily work the area is. Without it the area is in everyone's rail. */
  jobs?: Job[];
  pages: NavPage[];
}

const PARTNER_JOBS: Job[] = ['rdd', 'partner_care', 'church', 'grants', 'support', 'exec'];
const GIFT_JOBS: Job[] = ['giftdesk', 'partner_care', 'support'];

export const AREAS: NavArea[] = [
  {
    id: 'today',
    label: 'Today',
    icon: 'home',
    key: 't',
    barRank: 1,
    pages: [
      { id: 'home', label: 'Today', href: '/', desc: 'What is waiting on you, with your work: due today, gifts to thank and your week', keywords: 'home start due waiting work overview todays work gifts to thank week team', learn: 'today', swap: true },
    ],
  },
  {
    id: 'partners',
    label: 'Partners',
    icon: 'users',
    key: 'p',
    barRank: 2,
    jobs: PARTNER_JOBS,
    pages: [
      { id: 'work', label: 'Actions', href: '/work/', desc: 'Open actions on your partners: finish many together, thank gifts, enter the week', keywords: 'work center actions bulk select complete thank you entry tracking stale reassign reschedule support partner partners', need: 'workCenter', count: 'workOpen', learn: 'work-center', swap: true, jobs: PARTNER_JOBS, was: 'Work > Work Center' },
      { id: 'partners-all', label: 'All partners', href: '/partners/', desc: 'Every partner record in Blackbaud, givers or not: search, filter, sort, save a view and export', keywords: 'all partners directory every partner record constituent search find crm lookup id email phone address individual household organization church foundation lybunt lapsed tags star saved view export duplicates merge', need: 'workCenter', learn: 'work-center', swap: true, jobs: PARTNER_JOBS },
      { id: 'partners-thank', label: 'Gifts to thank', href: '/work/?view=gifts', desc: 'Gifts on your partners waiting for your thank-you, on the 24-hour clock', keywords: 'gifts to thank thank you thanks new gift call text email 24 hour clock partner', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['rdd', 'partner_care', 'church'], was: 'Work > Work Center > Gifts to thank' },
      { id: 'partners-mine', label: 'My partners', href: '/work/?view=mine', desc: 'Every partner you hold, with their giving and when anyone last spoke to them', keywords: 'my partners portfolio holder rdd director church relationship', need: 'workCenter', learn: 'my-partners-and-reminders', swap: true, jobs: ['rdd', 'church'], was: 'Work > Work Center > My partners' },
      { id: 'partners-asks', label: 'Asks', href: '/work/?view=asks', desc: 'Every ask from the last year: asked, closing, past the close date, gave', keywords: 'asks ask amount of ask opportunity close pipeline director', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['rdd', 'support'], was: 'Work > Work Center > Asks' },
      { id: 'partners-cadence', label: 'Cadence', href: '/work/?view=cadence', desc: 'The partners due for contact under the Partner Care manual', keywords: 'cadence partner care contact due first time monthly quarterly card call text', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['partner_care'], was: 'Work > Work Center > Cadence' },
      { id: 'partners-week', label: 'My week', href: '/work/?view=week', desc: "This week's connections, meetings and one-on-ones against your goals, and the weekly report", keywords: 'my week weekly report goals connections meetings one on ones tracking sheet director', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['rdd', 'church'], was: 'Work > Work Center > Reports > My week' },
      { id: 'partners-entry', label: 'Entry', href: '/work/?view=intake', desc: "The directors' contacts waiting to be entered in Blackbaud", keywords: 'entry intake enter contacts tracking sheet support team queue', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['support'], was: 'Work > Work Center > Gifts > Entry' },
      { id: 'partners-grants', label: 'Grants', href: '/work/?view=grants', desc: 'Grant reports, proposals and conversations with funders', keywords: 'grants grant report proposal funder conversation award foundation', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['grants', 'support'], was: 'Work > Work Center > Grants' },
      { id: 'foundations', label: 'Foundations', href: '/foundations/', desc: 'Check a foundation, log a contact', keywords: 'foundation foundations prospect grant rdd blackbaud unsolicited contact call', learn: 'foundation-prospects', jobs: ['grants', 'rdd', 'support'], was: 'Work > Foundations' },
    ],
  },
  {
    id: 'gifts',
    label: 'Gifts',
    icon: 'gift',
    key: 'g',
    barRank: 3,
    jobs: GIFT_JOBS,
    pages: [
      { id: 'gifts-home', label: 'Overview', href: '/gifts/', desc: 'The gift day on one screen: the mail, online gifts, review, Blackbaud, receipts and thank-you letters', keywords: 'gifts overview gift day deposits mail online review blackbaud receipts letters chart month', need: 'giftEntry', learn: 'gift-entry', swap: true, jobs: GIFT_JOBS },
      { id: 'gift-entry', label: 'Gift entry', href: '/gift-entry/', desc: 'Photograph checks and reply slips, review each gift, approve, and send the batch to Blackbaud', keywords: 'gift entry check checks photo photograph reply slip deposit tape batch approve mail day white mail', need: 'giftEntry', learn: 'gift-entry', jobs: ['giftdesk', 'support'], was: 'Work > Gift entry', swap: true },
      { id: 'online-gifts', label: 'Online gifts', href: '/online-gifts/', desc: "Each morning's online gifts with the partner's comment and designation, approved by Partner Care", keywords: 'online gifts website giving form fundraise up international comment comments designation designate fund approve batch partner care morning', need: 'giftEntry', learn: 'online-gifts', jobs: ['partner_care'], was: 'Work > Online gifts', swap: true },
      { id: 'recurring', label: 'Recurring', href: '/gifts/recurring/', desc: 'Every monthly and recurring gift schedule with declines, past-due charges and stopped schedules. Change an amount, how often it runs or its status', keywords: 'recurring monthly gifts schedule schedules declined decline past due stopped held amount frequency card bank win back partner care sustaining', need: 'workCenter', learn: 'work-center', jobs: ['giftdesk', 'support', 'partner_care'], was: 'New in Gifts' },
      { id: 'receipts', label: 'Receipts', href: '/receipts/', desc: 'Printed receipts for every gift Blackbaud has waiting', keywords: 'receipt receipts ty acknowledgement print mail printed', need: 'giftEntry', count: 'receiptsLeft', learn: 'thank-you-receipts', swap: true, jobs: ['giftdesk', 'partner_care'], was: 'Work > Receipts' },
      { id: 'letters', label: 'Thank-you letters', href: '/gifts/letters/', desc: 'Handwritten thank-you letters for gifts of $5,000 and up, with where each one stands', keywords: 'hqty thank you letters letter handwritten 5000 major gift signer print mailed', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['support'], was: 'Work > Work Center > HQTY letters' },
      { id: 'statements', label: 'Statements', href: '/statements/', desc: 'Giving statements on request and the January year-end statements', keywords: 'giving statement statements year-end tax january annual pdf print mail partner', learn: 'giving-statements', swap: true, jobs: ['giftdesk', 'partner_care'], was: 'Work > Statements' },
      { id: 'declines', label: 'Declines', href: '/gifts/declines/', desc: 'Declined monthly payments and zeroed gifts with the reason, and the follow-up', keywords: 'declines declined decline card failed monthly recurring payment processor reason follow up', need: 'workCenter', learn: 'work-center', swap: true, jobs: ['giftdesk', 'support', 'partner_care'], was: 'Work > Work Center > Declines' },
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'board',
    key: 'j',
    barRank: 4,
    pages: [
      { id: 'projects', label: 'Projects', href: '/projects/', desc: 'My tasks, projects, task lists, boards, calendar and timeline', keywords: 'projects project tasks task my tasks list board calendar timeline gantt assign due asana todo', need: 'projects', count: 'projectsMine', also: ['project'], learn: 'projects', note: 'Synced with Asana', was: 'Work > Projects', swap: true },
      { id: 'board', label: 'Requests', href: '/requests/', desc: 'Request board: inbox, approved, in motion, done', keywords: 'request requests board kanban review approve website portal app marketing', count: 'board', also: ['new'], learn: 'request-board', swap: true, was: 'Work > Requests' },
    ],
  },
  {
    id: 'meet',
    label: 'Meetings',
    icon: 'video',
    key: 'm',
    barRank: 5,
    pages: [
      { id: 'meet', label: 'Calendar', href: '/meet/', desc: 'Start and join meetings', keywords: 'meeting meetings join start room video call', need: 'meetings', count: 'meetingsNow', learn: 'meetings', swap: true },
      { id: 'meet-book', label: 'Book', href: '/meet/book/', desc: 'Book a meeting from everyone’s calendars', keywords: 'book meeting schedule calendar invite', need: 'meetings', learn: 'meetings', swap: true },
      { id: 'meet-booking', label: 'Booking page', href: '/meet/booking/', desc: 'Your page where partners and staff book time with you', keywords: 'booking page book time with me calendly schedule partner appointment availability', need: 'meetings', learn: 'meetings', swap: true },
      { id: 'meet-notes', label: 'Notes', href: '/meet/library/', desc: 'Notes, action items and transcripts from meetings', keywords: 'meeting notes transcript action items recording', need: 'meetings', learn: 'meetings', swap: true },
      { id: 'clips', label: 'Clips', href: '/clips/', desc: 'Your recorded clips, searchable by what was said', keywords: 'clips clip loom screen record recording video walkthrough share link transcript', need: 'clips', learn: 'clips', swap: true },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: 'chat',
    key: 'c',
    barRank: 6,
    pages: [
      { id: 'chat', label: 'Chat', href: '/chat/', desc: 'Channels, direct messages and threads, with clips, meetings, Drive files and Favor Brain', keywords: 'chat message messages channel channels dm direct thread slack team talk mention', need: 'chat', count: 'chatMentions', learn: 'chat', swap: true },
    ],
  },
  {
    id: 'mail',
    label: 'Mail',
    icon: 'mail',
    key: 'e',
    barRank: 7,
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
    barRank: 8,
    beta: true,
    pages: [
      { id: 'brain', label: 'Brain', href: '/brain/', desc: 'Ask about partners, giving, team numbers and the manuals', keywords: 'brain favor ask ai claude chatgpt question query beta chat', learn: 'ask-favor', swap: true },
      { id: 'connect-ai', label: 'Connect an AI app', href: '/help/connect-your-ai/', desc: 'Use the same answers from Claude or ChatGPT', keywords: 'connect claude chatgpt mcp connector ai app', learn: 'connect-your-ai', menu: false },
    ],
  },
  {
    id: 'kpi',
    label: 'Reporting',
    short: 'Reporting',
    icon: 'chart',
    key: 'k',
    barRank: 9,
    pages: [
      { id: 'kpi', label: 'Executive', href: '/dashboard/', desc: "The year's numbers", keywords: 'kpi dashboard revenue goals executive year', need: 'kpi', kpiPage: '/', learn: 'kpi-dashboard' },
      { id: 'reporting', label: 'Highlights', href: '/highlights/', desc: 'Where each goal ends the year, the week in plain language for each team, and your pinned Favor Brain answers', keywords: 'highlights pace pacing projection year end goal weekly week summary my dashboard pinned pins brain explain', need: 'kpi', learn: 'reporting' },
      { id: 'reports', label: 'Reports', href: '/reports/', desc: 'Daily revenue, lists and yearly reports, with CSV and Google Sheets', keywords: 'reports report blackbaud query queries daily revenue ytd income lybunt lapsed mailing list export csv sheets tax receipts prayer', learn: 'reports', group: 'Reports' },
      { id: 'lists', label: 'Lists', href: '/lists/', desc: 'Build a list of partners or gifts from menus, watch the count, save it for yourself or a team, and open it in Google Sheets', keywords: 'lists list builder partners gifts lybunt lapsed active major acquisition holder state zip fund appeal mailing export csv sheets saved segment', need: 'workCenter', learn: 'lists-and-downloads', group: 'Reports' },
      { id: 'list-reports', label: 'Standard reports', href: '/lists/reports/', desc: 'Giving by fund, appeal and month, credit by fundraiser, portfolio by holder, new and lost partners, LYBUNT and lapsed, retention, actions and grants, each with a drill to the rows', keywords: 'standard reports giving fund appeal month credit fundraiser portfolio holder new lost lybunt lapsed acquisition first time retention actions grants pipeline drill tie out', need: 'workCenter', learn: 'lists-and-downloads', group: 'Reports' },
      { id: 'list-credit', label: 'Credit and assignments', href: '/lists/credit/', desc: "Each gift's fundraiser credit and each partner's assignments with history, proposed fixes by Favor's rules, and approval of a change", keywords: 'credit assignments fundraiser holder gift credit proposal approve approval audit marketing appeal rdd partner care reassign', need: 'workCenter', learn: 'lists-and-downloads', group: 'Reports' },
      { id: 'kpi-rdds', label: 'RDD team', href: '/dashboard/?page=%2Frdds', desc: 'Regional directors', keywords: 'rdd regional directors team kpi', need: 'kpi', team: 'rdd', kpiPage: '/rdds', group: 'Teams' },
      { id: 'kpi-pc', label: 'Partner Care', href: '/dashboard/?page=%2Fpc', desc: 'Partner Care team numbers', keywords: 'partner care pc kpi', need: 'kpi', team: 'pc', kpiPage: '/pc', group: 'Teams' },
      { id: 'kpi-ce', label: 'Church Engagement', href: '/dashboard/?page=%2Fce', desc: 'Church Engagement team numbers', keywords: 'church engagement ce kpi', need: 'kpi', team: 'ce', kpiPage: '/ce', group: 'Teams' },
      { id: 'kpi-grants', label: 'Grants', href: '/dashboard/?page=%2Fgrants', desc: 'Grants team numbers', keywords: 'grants kpi foundations', need: 'kpi', team: 'grants', kpiPage: '/grants', group: 'Teams' },
      { id: 'kpi-marketing', label: 'Marketing', href: '/dashboard/?page=%2Fmarketing', desc: 'Marketing team numbers', keywords: 'marketing kpi', need: 'kpi', team: 'marketing', kpiPage: '/marketing', group: 'Teams' },
      { id: 'kpi-definitions', label: 'Definitions', href: '/dashboard/?page=%2Fdefinitions', desc: 'How each number is counted', keywords: 'definitions active lybunt lapsed major partner counted', need: 'kpi', kpiPage: '/definitions', learn: 'kpi-definitions' },
    ],
  },
  {
    id: 'staff',
    label: 'Staff',
    icon: 'badge',
    key: 's',
    barRank: 10,
    pages: [
      { id: 'expenses', label: 'Expenses', href: '/expenses/', desc: 'Your expense requests with their status and signed PDFs, a new request, and for approvers the log and the schedule', keywords: 'expense expenses request requests log approver approve sign signed pdf schedule travel purchase reimbursement', count: 'expensesWaiting', learn: 'expense-request', swap: true, was: 'Work > Expenses and Admin > Expense log' },
      { id: 'expense', label: 'New expense request', href: '/expenses/new/', desc: 'Expense request, signed online', keywords: 'new expense request travel pre-travel approval signature purchase', learn: 'expense-request', swap: true, menu: false, parent: 'expenses', was: 'Work > Expenses' },
      { id: 'evals', label: 'Evaluations', href: '/evaluations/', need: 'hr', desc: 'Your evaluation, the feedback you owe a colleague and your team’s reviews', keywords: 'evaluation evaluations review reviews self assessment feedback 360 performance development plan goals rre supervisor hr', count: 'evals', also: ['evals-admin'], learn: 'evaluations', was: 'Work > Evaluations', swap: true },
      // learn: begin
      { id: 'learn', label: 'My learning', href: '/learn/', desc: 'Courses and paths assigned to you, and where you left off', keywords: 'learn learning course courses lms training lesson quiz certificate path onboarding assigned due', need: 'learn', count: 'learn', also: ['learn-course', 'learn-path', 'learn-cert'], learn: 'learn', group: 'Learning', was: 'Learn > My learning', swap: true },
      { id: 'learn-catalog', label: 'Catalog', href: '/learn/catalog/', desc: 'Every course and learning path', keywords: 'learn learning catalog courses paths training all', need: 'learn', learn: 'learn', group: 'Learning', was: 'Learn > Catalog', swap: true },
      { id: 'practice', label: 'Practice', href: '/learn/practice/', desc: 'A pretend partner record for practicing gift entry and logging a call', keywords: 'learn learning practice pretend sample training gift entry log call new hire first week sandbox', need: 'learn', learn: 'learn', group: 'Learning', was: 'Learn > Practice', swap: true },
      { id: 'learn-admin', label: 'Manage', href: '/learn/admin/', desc: 'Build courses and paths, assign them, and see who has finished', keywords: 'learn learning manage admin author build course path assign report overdue scores hr', need: 'learnAdmin', learn: 'learn', group: 'Learning', was: 'Learn > Manage', swap: true },
      // learn: end
      { id: 'onboarding', label: 'Onboarding', href: '/onboarding/', desc: 'Start a new hire or an exit: the checklist, who owns each step, and what FavorOS sets up', keywords: 'onboarding offboarding new hire start staff exit leaving checklist welcome orientation hr', need: 'hr', also: ['onboarding-run'], learn: 'onboarding', jobs: ['hr'], was: 'Admin > Onboarding', swap: true },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'shield',
    key: 'x',
    barRank: 20,
    foot: true,
    pages: [
      { id: 'admin-home', label: 'Overview', href: '/admin/', desc: 'Health of the Blackbaud copy, the morning jobs, the sender and the call meter, with every setting one click away', keywords: 'admin overview health status settings jobs sync meter iwave', need: 'admin', learn: 'admin-home' },
      { id: 'admin-people', label: 'People and roles', href: '/admin/people/', desc: 'Who can sign in, their role, team, fundraiser link and Work Center access, with an act as preview', keywords: 'people users roles admin block team fundraiser work center access act as preview staff', need: 'admin', learn: 'admin-home' },
      { id: 'admin-settings', label: 'Settings', href: '/admin/work-center/', desc: 'Work Center, Meetings, Favor Brain, Clips, Reports, Expenses, Thank-you receipts and Giving statements and Projects settings', keywords: 'receipts mileage substitute settings work center cap lane rollout start meetings guests recording folder reminder brain connect titles clips storage reports roles expenses approver', need: 'admin', also: ['admin-work', 'admin-gifts', 'admin-meetings', 'admin-brain', 'admin-clips', 'admin-reports', 'admin-expenses', 'admin-receipts', 'admin-statements', 'admin-chat', 'admin-projects', 'admin-ai'], learn: 'admin-home' },
      { id: 'admin-bbusers', label: 'Blackbaud users', href: '/admin/blackbaud-users/', desc: 'Everyone with a Blackbaud login, their status and what each product lets them do', keywords: 'blackbaud users logins access roles inactive admin raisers edge security', need: 'admin', learn: 'admin-home' },
      { id: 'admin-appeals', label: 'Appeal codes', href: '/admin/appeal-codes/', desc: 'Build an appeal code from the scheme and create it in Blackbaud, and keep the funds and campaigns waiting to be created', keywords: 'appeal codes campaign fund lookup newsletter letter mailing create blackbaud scheme', need: 'admin', learn: 'admin-home' },
      { id: 'admin-adoption', label: 'Adoption', href: '/admin/adoption/', desc: 'Who uses FavorOS, which areas they open, and what they do there', keywords: 'adoption usage analytics active who uses sign in signed never feedback engagement staff', need: 'admin', learn: 'admin-home' },
      { id: 'admin-tours', label: 'Tours', href: '/admin/tours/', desc: 'Who finished the tour and each release', keywords: 'tours tour walkthrough walkthroughs adoption finished new in favoros release send again onboarding training', need: 'admin', learn: 'guided-tour' },
      { id: 'admin-audit', label: 'Audit log', href: '/admin/audit/', desc: 'Every settings change with who made it, when, and the before and after values', keywords: 'audit log history changes who changed settings', need: 'admin', learn: 'admin-home' },
      { id: 'brain-admin', label: 'Brain requests', href: '/brain/admin/', desc: 'Access requests, who can ask about what, every question asked', keywords: 'brain admin access requests iwave approvals names', need: 'admin', count: 'brainRequests', learn: 'ask-favor' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'help',
    key: 'h',
    barRank: 21,
    foot: true,
    pages: [
      { id: 'docs', label: 'Docs', href: '/help/', desc: 'How every tool works, with search', keywords: 'help guide how docs documentation article manual faq', learn: 'getting-started', swap: true },
      { id: 'changelog', label: "What's new", href: '/changelog/', desc: 'Every change to FavorOS, newest first, by day', keywords: 'whats new what changed changelog changes updates release notes new features fixed improved', swap: true },
      { id: 'videos', label: 'Videos', href: '/help/videos/', desc: 'FavorOS, Favor Brain and Blackbaud on video, with captions', keywords: 'video videos training tutorial learn blackbaud raisers edge', swap: true },
      { id: 'welcome', label: 'Welcome', href: '/welcome/', desc: 'Your first week: who to meet, what is due, the FavorOS tour', keywords: 'welcome first day first week new hire onboarding orientation meet team', learn: 'welcome', swap: true },
      { id: 'feedback', label: 'Feedback', href: '/feedback/', desc: "Your notes and Will's answers", keywords: 'feedback note bug wrong idea suggestion problem report', count: 'feedback', learn: 'feedback', swap: true },
    ],
  },
];

/** Links in the account menu (the avatar at the foot of the rail): other sites staff use every day. */
export const TOOL_LINKS: Array<{ id: string; label: string; href: string; desc: string; keywords: string }> = [
  { id: 'tool-blackbaud', label: 'Blackbaud', href: 'https://app.blackbaud.com/signin/?redirectUrl=https://app.blackbaud.com/', desc: 'Partner records', keywords: 'crm donors blackbaud raisers edge' },
  { id: 'tool-paycom', label: 'Paycom', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', desc: 'Time sheet, time off and expenses cards', keywords: 'paycom timesheet punch clock in out pto vacation time off accruals cards reimbursement' },
];

/** True when a person holding these jobs does this work. Admins hold every job; an empty list is everyone's. */
export function jobMatch(jobs: readonly string[] | null | undefined, mine: readonly string[] | null | undefined): boolean {
  if (!jobs || !jobs.length) return true;
  if (!mine) return true;
  if (mine.includes('admin')) return true;
  return jobs.some((j) => mine.includes(j));
}

/** The people a page or area is for, as the More menus label it: "Partner Care, Admin desk". */
export function jobWho(jobs: readonly Job[] | undefined): string {
  return (jobs || []).filter((j) => j !== 'admin' && j !== 'hr' && j !== 'approver').map((j) => JOB_LABEL[j]).join(', ') || (jobs || []).map((j) => JOB_LABEL[j]).join(', ');
}

export interface TabSlot<T> {
  /** Tabs drawn in the row, in order. */
  row: T[];
  /** Tabs under the row's More menu, in order. */
  more: T[];
  /** The open page sits under More: the More button is drawn as the open tab, and the row never changes shape. */
  moreOn: boolean;
}

/**
 * One area's tab row for one person: the pages of their job first (registry order), at most TAB_CAP in the row, the rest under More.
 * A person with no job in the area gets the registry order. When the open page sits under More, More is drawn as the open tab, so the
 * row keeps its shape from page to page (a tab promoted into the row moved More along). `mine` null means the jobs are
 * not known yet (the menu has not answered), which reads as every job.
 */
export function arrangeTabs<T extends { jobs?: readonly string[]; on?: boolean }>(tabs: T[], mine: readonly string[] | null, cap = TAB_CAP): TabSlot<T> {
  const ownJob = tabs.filter((t) => t.jobs && t.jobs.length && jobMatch(t.jobs, mine));
  const anyJob = ownJob.length > 0;
  const first = anyJob ? tabs.filter((t) => jobMatch(t.jobs, mine)) : tabs.slice();
  const rest = anyJob ? tabs.filter((t) => !jobMatch(t.jobs, mine)) : [];
  const row = first.slice(0, cap);
  const more = first.slice(cap).concat(rest);
  return { row, more, moreOn: more.some((t) => t.on) };
}

/** Areas in the rail for a person, and the areas under the rail's More. `mine` null shows every area in the rail. */
export function railAreas(areas: NavArea[], mine: readonly string[] | null): { rail: NavArea[]; more: NavArea[] } {
  const main = areas.filter((a) => !a.foot);
  return { rail: main.filter((a) => jobMatch(a.jobs, mine)), more: main.filter((a) => !jobMatch(a.jobs, mine)) };
}

/** Old and short URLs that still land in the right place. The middleware applies them (functions/_middleware.ts). */
export const REDIRECTS: Array<[string, string]> = [
  ['/today', '/'],
  ['/kpi', '/dashboard/'],
  ['/work/home', '/'],
  ['/work-home', '/'],
  ['/dashboards', '/dashboard/'],
  ['/ask', '/brain/'],
  ['/meetings', '/meet/'],
  ['/requests/board', '/requests/'],
  ['/expenses/request', '/expenses/new/'],
  ['/receipts/thank-yous', '/receipts/'],
  ['/thank-yous', '/receipts/'],
  ['/foundation', '/foundations/'],
  ['/docs', '/help/'],
  ['/videos', '/help/videos/'],
  // The Work area split into Partners, Gifts, Projects and Staff (2026-10-14).
  ['/directory', '/partners/'],
  ['/constituents', '/partners/'],
  ['/actions', '/work/'],
  ['/gifts/overview', '/gifts/'],
  ['/letters', '/gifts/letters/'],
  ['/hqty', '/gifts/letters/'],
  ['/declines', '/gifts/declines/'],
  ['/staff', '/expenses/'],
  ['/expense-log', '/expenses/'],
  ['/expenses/log', '/expenses/'],
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
        tags: `${area.label} ${p.label} ${p.keywords || ''} ${p.was ? p.was.replace(/>/g, ' ') : ''}`.toLowerCase(),
        external: !!p.ext,
        group: area.label,
        need: p.need || '',
        team: p.team || '',
        area: area.id,
        page: p.id,
        jobs: (p.jobs || area.jobs || []).join(' '),
        was: p.was || '',
        menu: p.menu !== false,
      });
    }
  }
  for (const t of TOOL_LINKS) {
    rows.push({ title: t.label, desc: `Tools › ${t.label} · ${t.desc}`, href: t.href, tags: `tools ${t.label} ${t.keywords}`.toLowerCase(), external: true, group: 'Tools', need: '', team: '', area: 'tools', page: t.id, jobs: '', was: '' });
  }
  return rows;
}
