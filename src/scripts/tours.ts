// The guided tours, in three parts. This file is data: no page code, so the tests and the server read it too.
//
//   CORE      The tour a new person gets on their first page: 8 to 10 stops, by role.
//   RELEASES  New features, grouped by the day they shipped. Each feature is one walkthrough of 1 to 4 steps on the real
//             screen, with its help article and training clip, shown only to the people who can open that feature.
//             FavorOS opens "New in FavorOS" by itself for anyone with a walkthrough they have not seen.
//   STEPS     One or two steps for every page, run from Help as "Show me this page".
//
// SHIPPING A FEATURE: add a feature to the newest release below (or start a release with today's date), a step for its
// page in STEPS, a help article in src/content/help, and a line in src/content/help/whats-new.md. A release holds at
// most 8 features. A feature that is not worth a walkthrough gets the What's new line only.
//
// A step names the page it happens on, the thing to point at, and what to say. It can press something for the person
// (open search, switch a tab) or type an example into a box; it never sends, saves or signs anything.
// Copy: write {tap} or {Tap} where the person presses something. A phone reads "tap" and a computer reads "click".

export type Who = {
  admin: boolean;
  approver: boolean;
  expenseLog: boolean;
  /** Opens the Work Center for this person: an admin, or someone whose job touches it. */
  work: boolean;
  kpi: boolean;
  teams: string[];
  leader: boolean;
  first: string;
  /** What /api/hub/nav says this person may open. */
  chat: boolean;
  projects: boolean;
  meetings: boolean;
  /** May record a clip. */
  clips: boolean;
  hr: boolean;
};

/** The parts of a step a phone or a computer may change. */
export type StepParts = {
  page?: string;
  via?: string;
  at?: string;
  /** Point here when `at` is not on the screen (a list with no rows, a card that needs Google connected). */
  alt?: string;
  title?: string;
  body?: string | ((w: Who) => string);
  press?: string;
  type?: string;
  undo?: string;
  side?: 'right' | 'left' | 'top' | 'bottom';
};

export type Step = {
  id: string;
  /** Path the step happens on; the tour goes there first. Empty means any page. */
  page?: string;
  /** What to point at. Missing or not found: the card shows in the middle of the screen. */
  at?: string;
  alt?: string;
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
  /** The date the thing became new, YYYY-MM-DD. */
  added?: string;
  /** The menu item the pointer presses to get to `page`. */
  via?: string;
  side?: 'right' | 'left' | 'top' | 'bottom';
  /** What changes on a phone. `false` leaves the step out on a phone. */
  phone?: StepParts | false;
  /** What changes on a computer. `false` leaves the step out on a computer. */
  desk?: StepParts | false;
  /** Leave the step out when neither `at` nor `alt` is on the screen. */
  skipIfMissing?: boolean;
};

export type Feature = {
  id: string;
  title: string;
  /** A word or two for the top of the step card and the Next button. */
  short: string;
  /** One line for the New in FavorOS list. */
  blurb: string;
  /** An icon name from src/data/icons.ts. */
  icon: string;
  /** Who can open the feature. Missing: everyone. */
  for?: (w: Who) => boolean;
  /** Help article slug (src/content/help). */
  article: string;
  /** Training video slug (src/data/videos.json), when there is one. */
  clip?: string;
  /** 1 to 4 steps. */
  steps: Step[];
};

export type Release = {
  /** The day it shipped, YYYY-MM-DD. */
  id: string;
  title: string;
  features: Feature[];
};

export type Device = 'phone' | 'desk';

const team = (t: string) => (w: Who) => w.teams.includes(t);
const any = (...fs: Array<(w: Who) => boolean>) => (w: Who) => fs.some((f) => f(w));
const receiptsPeople = (w: Who) => w.admin || w.leader || w.teams.includes('marketing') || w.teams.includes('pc') || w.teams.includes('support') || w.teams.includes('admin');
const foundationPeople = (w: Who) => w.admin || w.leader || w.teams.includes('grants') || w.teams.includes('rdd');

export function roleName(w: Who): string {
  if (w.admin) return 'the FavorOS admin';
  if (w.leader) return 'leadership';
  const names: Record<string, string> = { rdd: 'the RDD team', pc: 'Partner Care', ce: 'Church Engagement', grants: 'Grants', marketing: 'Marketing' };
  const mine = w.teams.map((t) => names[t]).filter(Boolean);
  if (mine.length) return mine.join(' and ');
  return 'every Favor staff member';
}

/** The one stop in the core tour that differs by job. */
function job(w: Who): string {
  if (w.admin) return 'admin';
  if (w.leader) return 'leader';
  if (w.work && (w.teams.includes('rdd') || w.teams.includes('ce'))) return 'partners';
  if (w.work && w.teams.includes('pc')) return 'cadence';
  if (w.teams.includes('grants')) return 'grants';
  if (w.teams.includes('marketing') || w.teams.includes('support') || w.teams.includes('admin')) return 'receipts';
  return '';
}
const jobIs = (j: string) => (w: Who) => job(w) === j;

/** The core tour. A new person gets it on their first page. Keep it between 8 and 10 stops for every role. */
export const CORE: Step[] = [
  {
    id: 'core-today',
    page: '/',
    via: 'home',
    at: '.h-hello',
    title: 'Today is your home page',
    body: 'FavorOS opens here. It shows the date and what is waiting on you.',
    side: 'bottom',
  },
  {
    id: 'core-needs',
    page: '/',
    at: '#t-cards',
    title: 'What needs you',
    body: 'Each card is work waiting on you. {Tap} a card to go to it. The clock on a card hides it until a day you pick.',
    side: 'bottom',
  },
  {
    id: 'core-menu',
    page: '/',
    at: '.h-side .h-areas',
    title: 'The menu',
    body: 'Each area of FavorOS opens from here, with its pages as tabs across the top. A number shows how much is waiting in that area.',
    side: 'right',
    phone: { at: '#h-bar', title: 'The bar at the bottom', body: 'Each area of FavorOS opens from this bar. More holds the rest, with Help and Feedback. A number shows how much is waiting in that area.' },
  },
  {
    id: 'core-search',
    page: '/',
    at: '#cmdk .cmdk__panel',
    press: '.h-side [data-cmdk-open]',
    type: 'receipts',
    undo: '[data-cmdk-close]',
    title: 'Search finds anything',
    body: 'Press Ctrl and K on any page (Command and K on a Mac) and type a few letters. Search finds pages, partners, help topics and videos.',
    side: 'bottom',
    phone: { press: '.h-top__search', at: '#cmdk input', body: '{Tap} the magnifier at the top of any page and type a few letters. Search finds pages, partners, help topics and videos.' },
  },
  {
    id: 'core-work',
    page: '/work-home/',
    via: 'work-home',
    at: '.wh-tools',
    title: 'Work',
    body: 'Work holds the tools for your job. Each tile opens one, and a number shows what is waiting there.',
    side: 'bottom',
  },
  {
    id: 'core-request',
    page: '/requests/new',
    via: 'new',
    at: '#route-text',
    type: 'Could we add the October newsletter to the website?',
    title: 'Ask for something',
    body: 'Say what you need in your own words, then {tap} Continue. FavorOS suggests where it goes: the request board, the Marketing team or an expense request. Nothing is sent until you finish the form.',
    side: 'bottom',
  },
  {
    id: 'core-board',
    page: '/requests/',
    via: 'board',
    at: '.req-col[data-col="inbox"]',
    title: 'Follow your request',
    body: 'Every request moves through Inbox, Approved, In motion and Done. You get an email when yours is done.',
    side: 'right',
    phone: { at: '#req-tabs' },
  },
  {
    id: 'core-help',
    page: '/requests/',
    at: '#lp-btn',
    title: 'Help on every page',
    body: 'The question mark opens the article and the videos for the page you are on. Help in the menu has every article, this tour and what is new.',
    side: 'bottom',
    phone: { body: 'The question mark opens the article and the videos for the page you are on. Help, under More, has every article, this tour and what is new.' },
  },
  {
    id: 'core-partners',
    page: '/work/',
    via: 'work',
    at: '.wc-tabs',
    title: 'Your Work Center',
    body: 'Open actions lists what is due. Gifts to thank and My partners sit beside it. {Tap} a partner name anywhere in FavorOS to open the partner.',
    for: jobIs('partners'),
    side: 'bottom',
  },
  {
    id: 'core-cadence',
    page: '/work/',
    via: 'work',
    at: '.wc-tabs',
    title: 'Your Work Center',
    body: 'Cadence lists the partners due for contact. Open actions lists what is due. {Tap} a partner name anywhere in FavorOS to open the partner.',
    for: jobIs('cadence'),
    side: 'bottom',
  },
  {
    id: 'core-grants',
    page: '/foundations/',
    via: 'foundations',
    at: '#fnd-q',
    title: 'Check a foundation before you call',
    body: 'One search covers this list and every organization in Blackbaud. It shows who already talked to them and when.',
    for: jobIs('grants'),
    side: 'bottom',
  },
  {
    id: 'core-receipts',
    page: '/receipts/',
    via: 'receipts',
    at: '#rcp-stats',
    title: 'Receipts',
    body: 'Every gift Blackbaud has not receipted yet. Make the print file, print it, then mark the gifts thanked.',
    for: jobIs('receipts'),
    side: 'bottom',
  },
  {
    id: 'core-kpi',
    page: '/dashboard/',
    via: 'kpi',
    at: '#kpi-frame',
    title: 'The numbers',
    body: 'Reporting opens on the year at a glance. Each team has its own tab, and Definitions says how each number is counted.',
    for: jobIs('leader'),
    side: 'left',
  },
  {
    id: 'core-admin',
    page: '/admin/',
    via: 'admin-home',
    at: '#ad-strip',
    title: 'The jobs behind FavorOS',
    body: 'Each tile shows when a job last ran and whether it is OK, Late or Failed. Every setting is one {tap} away.',
    for: jobIs('admin'),
    side: 'bottom',
  },
  {
    id: 'core-brain',
    page: '/brain/',
    via: 'brain',
    at: '#bc-compose',
    title: 'Ask in plain words',
    body: 'Type a question about partners, giving, team numbers or the manuals. Answers come back as cards and tables from the records your account can see.',
    side: 'top',
  },
];

const chatPeople = (w: Who) => w.chat;

/** New features by the day they shipped, newest first. At most 8 features in a release. */
export const RELEASES: Release[] = [
  {
    id: '2026-10-12',
    title: 'October 12',
    features: [
      {
        id: 'first-week',
        title: 'First week by role, practice and year evidence',
        short: 'First week',
        blurb: 'A first week built for each new hire, a practice record that never touches Blackbaud, and evaluations that show the year\'s records.',
        icon: 'book',
        for: (w) => w.admin,
        article: 'learn',
        steps: [
          {
            id: 'n-practice',
            skipIfMissing: true,
            page: '/learn/practice/',
            via: 'practice',
            at: '.pr-partner',
            alt: '#pr',
            title: 'A pretend partner to practice on',
            body: 'Add a gift from a check in a form laid out like the one in Blackbaud, then log a contact and add a task, all on a made-up partner. Each field is checked and the page says what to fix. Nothing here reaches Blackbaud or a real partner, and Start over clears it.',
            added: '2026-10-12',
            side: 'right',
            phone: { at: '#pr', side: 'top' },
          },
          {
            id: 'n-first-week',
            skipIfMissing: true,
            page: '/welcome/',
            via: 'welcome',
            at: '.wl-fwk',
            alt: '#wl-root',
            title: 'Five days built for the role',
            body: 'A new hire sees five days of courses, the practice record and two check-ins with the supervisor, chosen for their team and title. A course finished in Learn ticks here. Add to FavorOS assigns the role path with a due date.',
            added: '2026-10-12',
            side: 'top',
          },
        ],
      },
      {
        id: 'one-app',
        title: 'Names open cards, and Send to works everywhere',
        short: 'Cards, Send to',
        blurb: 'Hover a colleague, partner, task or request to see its facts and act on it. One bell holds everything waiting on you.',
        icon: 'chat',
        article: 'search',
        steps: [
          {
            id: 'n-card-hover',
            skipIfMissing: true,
            page: '/',
            via: 'home',
            at: '#wm-bell',
            title: 'One bell for everything waiting on you',
            body: 'Mentions, direct messages, task and request notices, meetings starting soon, courses, evaluations, feedback answers and unread mail all list here. Each row clears on the page it opens, so the bell and the page always show the same number.',
            added: '2026-10-12',
            side: 'bottom',
            phone: { at: '#wm-bell', side: 'bottom' },
          },
          {
            id: 'n-card-search',
            skipIfMissing: true,
            page: '/',
            via: 'home',
            at: '[data-cmdk-open]',
            title: 'Hover a name for its card',
            body: 'Point at a colleague, a partner, a task code or a request anywhere in FavorOS to see its facts. Press Send to on the card to put it in Chat, make it a task, link it in a request or ask Favor Brain about it. On a phone, {tap} the name.',
            added: '2026-10-12',
            side: 'right',
            phone: false,
          },
        ],
      },
      {
        id: 'meetings-auto',
        title: 'Meetings prepare you and finish the work',
        short: 'Meeting prep',
        blurb: 'A prep sheet before each meeting, live action items during it, tasks and a channel summary after it, and questions across every past meeting.',
        icon: 'video',
        for: (w: Who) => w.meetings,
        article: 'meetings',
        steps: [
          {
            id: 'n-meet-prep',
            skipIfMissing: true,
            alt: '#mt-day',
            page: '/meet/',
            via: 'meet',
            at: '.dv-tl',
            title: 'Prep before the meeting',
            body: '{Tap} a meeting that has not started and press Prep. The sheet lists who is coming, the partners among them with their giving, open tasks between you and each person, what is still open from past meetings with them and what the last meeting decided.',
            added: '2026-10-12',
            side: 'bottom',
          },
          {
            id: 'n-meet-live',
            skipIfMissing: true,
            page: '/meet/',
            via: 'meet',
            at: '#mt-day',
            title: 'Action items while people talk',
            body: 'In a room, the Notes tab lists action items and decisions as they are said, with the owner when someone was named. Anyone can add one by hand. The host can dismiss one or change its owner. The final notes keep what stays on the list.',
            added: '2026-10-12',
            side: 'bottom',
          },
          {
            id: 'n-meet-ask',
            skipIfMissing: true,
            page: '/meet/library/',
            via: 'meet',
            at: '#libask',
            title: 'Ask your meetings',
            body: 'Type a question and FavorOS reads the notes and transcripts of every meeting you can open, then answers with the moments it found. {Tap} a moment to jump to it.',
            added: '2026-10-12',
            side: 'bottom',
          },
        ],
      },
      {
        id: 'reporting-pace',
        title: 'Pace to year end, weekly highlights and My dashboard',
        short: 'Highlights',
        blurb: 'See where each goal ends the year, read the week for each team in plain words, and pin Favor Brain answers to your own dashboard.',
        icon: 'chart',
        for: (w) => w.kpi,
        article: 'reporting',
        steps: [
          {
            id: 'n-rep-pace',
            skipIfMissing: true,
            page: '/reporting/',
            via: 'reporting',
            at: '.rg-pace-grid',
            alt: '#rg-week',
            title: 'Where each goal ends the year',
            body: 'Each card projects the year end at the current pace and says if the goal is ahead, close or behind. {Tap} a card to see what is in the number and why it changed since last month. The same numbers open from Today.',
            added: '2026-10-12',
            side: 'bottom',
          },
          {
            id: 'n-rep-week',
            skipIfMissing: true,
            page: '/reporting/',
            at: '.rg-hl-grid',
            alt: '#rg-week',
            title: 'The week in plain words',
            body: 'One short summary for all of Favor and one for each team you can open, from the same gifts the KPI dashboard counts. Copy as text puts it in an email or a Chat message.',
            added: '2026-10-12',
            side: 'top',
          },
          {
            id: 'n-rep-mine',
            skipIfMissing: true,
            page: '/reporting/',
            press: '#rg-tab-mine',
            at: '#rg-mine',
            undo: '#rg-tab-week',
            title: 'Your own dashboard',
            body: 'Press the pin under any Favor Brain answer and it lands here. Refresh asks the question again with the latest numbers.',
            added: '2026-10-12',
            side: 'top',
          },
        ],
      },
      {
        id: 'dock',
        title: 'Chat and Favor Brain on every page',
        short: 'Chat dock',
        blurb: 'A round button at the bottom right opens Chat and Favor Brain without leaving the page.',
        icon: 'chat',
        for: chatPeople,
        article: 'chat',
        steps: [
          {
            id: 'n-dock-open',
            skipIfMissing: true,
            page: '/',
            via: 'home',
            at: '#fd .fd__btn',
            title: 'Chat on every page',
            body: 'This button opens your conversations and Favor Brain over the page you are on. A number on it counts direct messages and mentions waiting for you.',
            added: '2026-10-12',
            side: 'left',
            phone: { at: '#h-bar', body: 'Chat is in this bar. On a computer, a round Chat button on every page also opens Chat and Favor Brain over the page you are on.', side: 'top' },
          },
          {
            id: 'n-dock-panel',
            skipIfMissing: true,
            page: '/',
            press: '#fd .fd__btn',
            at: '#fd-p',
            undo: '#fd-p [data-x]',
            title: 'Read and reply here',
            body: 'Pick a conversation, read it and reply. The Favor Brain tab asks questions and keeps the same chats as the Brain page. Drag the top left corner to resize, or use the arrows for a larger panel.',
            added: '2026-10-12',
            side: 'left',
            phone: false,
          },
        ],
      },
      {
        id: 'request-fill',
        title: 'Requests fill themselves out',
        short: 'Requests',
        blurb: 'Type what you need and the form answers itself, then watch the request move.',
        icon: 'inbox',
        article: 'make-a-request',
        steps: [
          {
            id: 'n-reqfill-text',
            page: '/requests/new',
            via: 'new',
            at: '#route-text',
            type: 'Add the October banquet page to the website by Friday',
            title: 'Say it in your words',
            body: 'Write what you need and {tap} Continue. For the request board, the kind, where it lives, who sees it and when it is needed are filled in from your words, with the reason beside each. Change any answer that is wrong.',
            added: '2026-10-12',
            side: 'bottom',
          },
          {
            id: 'n-reqfill-mine',
            page: '/requests/new',
            at: '#mine-card',
            alt: '#route-text',
            title: 'Where your requests are',
            body: 'Each of your requests shows four stops, who has it and when it is due. It updates while this page is open.',
            added: '2026-10-12',
            side: 'left',
          },
        ],
      },
      {
        id: 'receipts-check',
        title: 'Receipts are checked first',
        short: 'Receipt check',
        blurb: 'Bad addresses, blank names and duplicate partners are flagged before you print.',
        icon: 'receipt',
        for: receiptsPeople,
        article: 'thank-you-receipts',
        steps: [
          {
            id: 'n-rcpcheck',
            page: '/receipts/',
            via: 'receipts',
            at: '#rcp-check',
            alt: '#rcp-make',
            title: 'Look before you print',
            body: 'The check reads every receipt about to print. {tap} Show them to list only the ones with a flag. Each says what to change and links to the record. Nothing is changed or marked.',
            added: '2026-10-12',
            side: 'top',
          },
        ],
      },
      {
        id: 'clips-ops',
        title: 'Clip highlights and lessons',
        short: 'Clip lessons',
        blurb: 'Chapters and highlights on every clip, and a help article or Learn lesson made from any clip.',
        icon: 'camera',
        for: (w) => w.clips,
        article: 'clips',
        steps: [
          {
            id: 'n-clipops-lib',
            page: '/clips/',
            via: 'clips',
            at: '#cl-rows .cl-card [data-act="lesson"]',
            alt: '#cl-rows .cl-card',
            title: 'Make a lesson from a clip',
            body: 'Help article drafts a help article from the clip. Learn lesson makes a draft course in Learn with the clip and its steps in writing. Opening a clip also shows its highlights.',
            added: '2026-10-12',
            side: 'top',
            phone: { at: '#cl-rows .cl-card', side: 'bottom' },
          },
        ],
      },
    ],
  },
  {
    id: '2026-10-11',
    title: 'October 11',
    features: [
      {
        id: 'chat',
        title: 'Chat',
        short: 'Chat',
        blurb: 'Channels, direct messages and threads with the team.',
        icon: 'chat',
        for: chatPeople,
        article: 'chat',
        steps: [
          {
            id: 'n-chat-list',
            page: '/chat/',
            via: 'chat',
            at: '.ch-side',
            title: 'Channels and messages',
            body: 'Channels and direct messages are listed here. Bold means unread. A number means someone mentioned you.',
            side: 'right',
            phone: { at: '.ch-sec[data-sec="channels"]' },
          },
          {
            id: 'n-chat-write',
            page: '/chat/',
            at: '.ch-main .ch-comp__box',
            title: 'Write a message',
            body: 'Type here and send. The plus shares a Drive file, a clip or a meeting. @ brings a person in.',
            side: 'top',
            phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
          },
          {
            id: 'n-chat-huddle',
            page: '/chat/',
            at: '.ch-head .ch-btn--meet',
            title: 'Huddle',
            body: '{Tap} Huddle to check your camera and microphone, then start a call with the channel or join one.',
            side: 'bottom',
            phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
          },
        ],
      },
      {
        id: 'chat-brain',
        title: 'Favor Brain in Chat',
        short: 'Favor Brain',
        blurb: 'Ask about partners and giving without leaving the conversation.',
        icon: 'brain',
        for: chatPeople,
        article: 'chat',
        steps: [
          {
            id: 'n-brain-ask',
            page: '/chat/',
            via: 'chat',
            at: '.ch-main [data-act="ask-brain"]',
            title: 'Ask Favor Brain',
            body: '{Tap} the spark, or type @Favor Brain and a question, in any channel or thread. The answer comes back as cards and tables.',
            side: 'top',
            phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
          },
          {
            id: 'n-brain-private',
            page: '/chat/',
            at: '.ch-main .ch-comp__box',
            title: 'The answer is yours first',
            body: 'Only you see the answer. Share to channel under it shows it to everyone there, and Dismiss removes it.',
            side: 'top',
            phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
          },
        ],
      },
      {
        id: 'projects',
        title: 'Projects',
        short: 'Projects',
        blurb: 'Task lists, a board, a calendar and a timeline for shared work.',
        icon: 'log',
        for: (w) => w.projects,
        article: 'projects',
        steps: [
          {
            id: 'n-proj-mine',
            page: '/projects/',
            via: 'projects',
            at: '.pj-tiles',
            title: 'Your tasks',
            body: 'My tasks counts what is assigned to you: overdue, due today and open.',
            side: 'bottom',
          },
          {
            id: 'n-proj-add',
            page: '/projects/',
            at: '.pj-sec[data-zone="today"]',
            title: 'Add a task',
            body: 'Type a task under Today, Next 7 days or Later. In Chat, /task makes one from a message.',
            side: 'top',
          },
          {
            id: 'n-proj-all',
            page: '/projects/',
            press: '#pj-tab-projects',
            undo: '#pj-tab-mine',
            at: '.pj-pgrid',
            alt: '.pj-pane',
            title: 'All projects',
            body: 'Each project has a list, a board, a calendar and a timeline. A project can have its own Chat channel and a folder in US Team Files.',
            side: 'top',
          },
        ],
      },
      {
        id: 'requests',
        title: 'Send a request to someone',
        short: 'Requests',
        blurb: 'Hand a request to a person, and bring others in with a mention.',
        icon: 'inbox',
        article: 'request-board',
        steps: [
          {
            id: 'n-req-filters',
            page: '/requests/',
            via: 'board',
            at: '#req-filters',
            title: 'Yours, sent and waiting',
            body: 'Mine shows the requests you own. Sent by me and Waiting on others follow the ones you handed off.',
            side: 'bottom',
          },
          {
            id: 'n-req-send',
            page: '/requests/',
            press: '.req-col.is-on .req-card, .req-card',
            at: '.rq [data-send-to]',
            alt: '.rq .rq-fields',
            title: 'Send to',
            body: (w) =>
              w.admin
                ? 'Open a request and {tap} Send to. Pick a person and add a note. They get it on Today, the bell, in Chat and by email.'
                : 'A request sent to you opens here with the note. Owner shows who has it now, and Waiting on shows who it is held up by.',
            side: 'left',
          },
          {
            id: 'n-req-mention',
            page: '/requests/',
            at: '.rq .rq-comp',
            alt: '.rq .rq-foot__note, .rq',
            undo: '#rq-drawer .rt-x[data-rq-close]',
            title: 'Mention a person',
            body: 'Type @ in a comment and pick a name. That person gets a notice and can answer here or in Chat.',
            side: 'top',
          },
        ],
      },
      {
        id: 'today-meetings',
        title: "Today's meetings",
        short: 'Today',
        blurb: 'Your whole calendar on Today, with Join and Move to FavorOS.',
        icon: 'video',
        article: 'today',
        steps: [
          {
            id: 'n-meet-card',
            page: '/',
            via: 'home',
            at: '[data-td="meetings"]',
            alt: '.r2t-connect',
            title: "Today's meetings",
            body: "Today lists every event on your Google Calendar for the day, with where it is held and a Join button. Connect my Google turns it on if you have not yet.",
            side: 'top',
          },
          {
            id: 'n-meet-move',
            page: '/',
            at: '[data-td="meetings"]',
            title: 'Move to FavorOS',
            body: '{Tap} a meeting held in Zoom, Meet or Teams, then Move to FavorOS. It makes a FavorOS meeting at the same time with the same people.',
            side: 'top',
            skipIfMissing: true,
          },
        ],
      },
      {
        id: 'wc-groups',
        title: 'Work Center tabs in groups',
        short: 'Work Center',
        blurb: 'Sixteen tabs now sit in five groups.',
        icon: 'work',
        for: (w) => w.work,
        article: 'work-center',
        steps: [
          {
            id: 'n-wc-groups',
            page: '/work/',
            via: 'work',
            at: '.wc-groups',
            title: 'Five groups',
            body: 'The Work Center tabs sit in groups: My work, Gifts, Grants, Reports and Review. A dot marks a group with something new in it.',
            side: 'bottom',
          },
          {
            id: 'n-wc-tabs',
            page: '/work/',
            at: '.wc-tabs',
            title: 'The tabs of a group',
            body: 'The second row holds the tabs of the group you are in, with a count on each. The Work Center opens on the tab you used last.',
            side: 'bottom',
          },
        ],
      },
      {
        id: 'clips',
        title: 'Clip recorder',
        short: 'Clips',
        blurb: 'Record your screen to show someone how, with controls that follow you.',
        icon: 'camera',
        for: (w) => w.clips,
        article: 'clips',
        steps: [
          {
            id: 'n-clip-cam',
            at: '#clip-cam',
            title: 'Record a clip',
            body: 'The camera opens a small recorder. Pick the screen, a window or a tab, then {tap} Start recording. Stop, Pause and Mute stay on top of whatever you open.',
            side: 'bottom',
            phone: false,
          },
          {
            id: 'n-clip-lib',
            page: '/clips/',
            via: 'clips',
            at: '#cl-rows .cl-card',
            alt: '#cl-new',
            title: 'Your clips',
            body: 'Each clip gets a title, a summary and chapters. Only you see a clip until you share its link.',
            side: 'right',
            phone: { body: 'Clips play here. Recording is done on a computer, from the camera at the top right. Only you see a clip until you share its link.', side: 'bottom' },
          },
        ],
      },
      {
        id: 'receipts-statements',
        title: 'Receipts and giving statements',
        short: 'Receipts',
        blurb: 'Print receipts and make statements without opening Blackbaud.',
        icon: 'receipt',
        for: receiptsPeople,
        article: 'giving-statements',
        steps: [
          {
            id: 'n-rcp-stats',
            page: '/receipts/',
            via: 'receipts',
            at: '#rcp-stats',
            title: 'Receipts waiting',
            body: 'Every gift Blackbaud has not receipted yet, counted here.',
            side: 'bottom',
          },
          {
            id: 'n-rcp-make',
            page: '/receipts/',
            at: '#rcp-make',
            title: 'One print file at a time',
            body: 'Make the print file, print it on the receipt paper, then mark the gifts thanked so they never print twice.',
            side: 'top',
          },
          {
            id: 'n-stm-tabs',
            page: '/statements/',
            via: 'statements',
            at: '#stm-tabs',
            title: 'Giving statements',
            body: 'One partner finds a partner and a year and shows every gift before you make the PDF. Year-end run makes the January statements.',
            side: 'bottom',
          },
        ],
      },
    ],
  },
];

/** Steps for every page, run from Help as "Show me this page". */
export const STEPS: Step[] = [
  {
    id: 'today',
    page: '/',
    via: 'home',
    at: '.h-hello',
    title: 'Today is your home page',
    body: 'FavorOS opens here. It shows the date and what is waiting on you.',
    side: 'bottom',
  },
  {
    id: 'today-cards',
    page: '/',
    at: '#t-cards',
    title: 'What needs you',
    body: 'Each card is work waiting on you. {Tap} a card to go to it. The clock on a card hides it until tomorrow, next week or a day you pick.',
    side: 'bottom',
  },
  {
    id: 'today-outside',
    skipIfMissing: true,
    page: '/',
    at: '[data-td="meetings"]',
    title: 'Meetings held anywhere',
    body: "Today's meetings lists everything on your Google Calendar. {Tap} a meeting held in Zoom, Meet or Teams to join it or to Move to FavorOS, which makes a FavorOS meeting at the same time with the same people. Blackbaud actions and shared files open inside FavorOS too.",
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'today-year',
    page: '/',
    at: '#t-year-wrap',
    title: 'Where the year stands',
    body: "Money raised against the year's goal and each team's progress, from the KPI dashboard's own numbers. {Tap} the amount raised or a team's amount to see its Favor definition and the gifts behind it.",
    for: (w) => w.kpi,
    side: 'top',
  },
  {
    id: 'menu',
    at: '.h-side .h-areas',
    title: 'Five areas in the menu',
    body: 'Today, Work, Meetings, Favor Brain and KPI each open on their own page, with that area\'s sections as tabs across the top. A number on an area shows how much is waiting there. {Tap} the arrow at the top of the menu, or the backslash key, to widen it into a list of every page.',
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'search',
    at: '#cmdk .cmdk__panel',
    press: '[data-cmdk-open]',
    type: 'receipts',
    undo: '[data-cmdk-close]',
    title: 'Search finds any tool',
    body: 'Press Ctrl and K together on any page (Command and K on a Mac), type a few letters, and press Enter. It finds any page, partner, help topic and video you can open.',
    side: 'bottom',
  },
  {
    id: 'request',
    page: '/requests/new',
    via: 'new',
    at: '#route-text',
    type: 'Could we add the October newsletter to the website?',
    title: 'Make a request, in your own words',
    body: 'Say what you need the way you would tell a coworker, then {tap} Continue. FavorOS suggests where it goes: the request board, the Marketing team or an expense request. Nothing is sent until you finish the form.',
    side: 'bottom',
  },
  {
    id: 'board',
    phone: { at: '#req-tabs' },
    page: '/requests/',
    via: 'board',
    at: '.req-col.is-on',
    title: 'The request board',
    body: (w) =>
      w.admin
        ? 'New requests land in Inbox, then move to Approved, In motion and Done. Drag a card to move it. Finishing a card emails the person who asked.'
        : 'New requests land in Inbox, then move to Approved, In motion and Done. {Tap} a card to read it. You get an email when yours is done.',
    side: 'right',
  },
  {
    id: 'board-tasks',
    page: '/requests/',
    via: 'board',
    at: '#req-filters',
    title: 'Send a request, talk it through',
    body: (w) =>
      w.admin
        ? 'Mine, Sent by me and Waiting on others narrow the board. Open a card and {tap} Send to to hand it to anyone on staff with a note. Type @ in a comment to bring someone in.'
        : 'Mine shows the requests you own, and Waiting on others the ones held up by someone. Type @ in a comment to bring someone in.',
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'expense',
    phone: { side: 'bottom' },
    alt: '#exp-form',
    page: '/expenses/new',
    via: 'expense',
    at: '#exp-form .exp-step.is-on',
    title: 'Expense requests are signed online',
    body: 'Use this before a purchase or a trip: add each expense, say why it is needed, sign, and send. The approver signs online and you get the signed copy by email.',
    side: 'right',
  },
  {
    id: 'expense-log',
    page: '/expenses/',
    via: 'expenses',
    at: '#exp-log',
    title: 'The expense log',
    body: 'Every expense request, its status and the signed PDF. {Tap} a request to read it and sign. A number in the menu shows how many wait for you.',
    for: (w) => w.expenseLog,
    side: 'top',
  },
  {
    id: 'receipts',
    page: '/receipts/',
    via: 'receipts',
    at: '#rcp-stats',
    title: 'Receipts',
    body: 'Every gift Blackbaud has not receipted yet. Make the print file, print it on the receipt paper, then come back and mark the gifts thanked so they never print twice.',
    for: receiptsPeople,
    side: 'bottom',
  },
  {
    id: 'statements',
    page: '/statements/',
    via: 'statements',
    at: '#stm-tabs',
    title: 'Giving statements',
    body: 'Find a partner, pick a year, and see every gift that belongs on their statement before you make the PDF. The Year-end run tab makes the January statements for the mail, email and other tax lists in print files, one at a time, and shows how the totals compare with the KPI dashboard.',
    for: (w) => w.admin || w.leader,
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'mail-knows',
    page: '/mail/',
    via: 'mail',
    at: '[data-boxes]',
    title: 'Add your other mailboxes',
    body: 'Add a mailbox brings in another Favor account, like accounting or admin. All mailboxes shows them together with a colored dot, and a reply goes out from the mailbox it came to. This morning at the top of the inbox says where to start.',
    for: (w) => w.admin,
    added: '2026-10-12',
    side: 'right',
  },
  {
    id: 'mail-smart',
    page: '/mail/',
    via: 'mail',
    at: '.ml-tabs',
    title: 'Mail sorts itself',
    body: 'Needs you lists what asks you something, oldest first. Partners, Staff, Receipts and gifts and the other tabs sort the inbox and count each one. {Tap} the circle beside a sender to select several, then archive, label, snooze or move them. Open an email from a partner to see their giving and who holds them, with three short replies to start from.',
    for: (w) => w.admin,
    added: '2026-10-12',
    side: 'bottom',
  },
  {
    id: 'evaluations',
    alt: '#ev-root',
    page: '/evaluations/',
    via: 'evals',
    at: '.ev-head',
    title: 'Evaluations',
    body: 'Your evaluation, the feedback you owe a colleague and, for a supervisor, your team reviews. In week 1 you complete the self-assessment and name 3 to 5 people who work with you. Answers save as you go. The page says who can read what before you write.',
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'reports',
    page: '/reports/',
    via: 'reports',
    at: '.rp-groups',
    title: 'Reports',
    body: 'The reports your team ran in Blackbaud, rebuilt here and grouped. Open one, set the filters, and download it as a CSV or open it in Google Sheets.',
    for: (w) => w.admin || w.leader || w.teams.length > 0,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'reports-queries',
    skipIfMissing: true,
    alt: '.rp-groups',
    page: '/reports/',
    via: 'reports',
    at: '.rp-groups [data-g="daily"]',
    title: "Yesterday's gifts and the other saved queries",
    body: "Yesterday's gifts lists every gift since the last list with who holds the partner and the partner's last action. Top partners by total giving, RDD and church engagement actions, and Gifts with no fundraiser credit sit beside it. The Blackbaud query map shows what replaced each saved query.",
    for: (w) => w.admin || w.leader || w.teams.includes('pc') || w.teams.includes('rdd') || w.teams.includes('support') || w.teams.includes('ce'),
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'reports-mail-file',
    skipIfMissing: true,
    alt: '.rp-groups',
    page: '/reports/',
    via: 'reports',
    at: '.rp-groups [data-g="lists"]',
    title: 'Mail files',
    body: 'Appeal mailing list and Annual tax receipt lists have a Mail file button. It downloads a CSV or builds a Google Sheet in US Team Files with the same columns the Blackbaud export had, so the mail house file does not change. A line under the totals shows whether the list has the same partners as the saved Blackbaud query.',
    for: (w) => w.admin || w.leader || w.teams.length > 0,
    added: '2026-10-11',
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
    id: 'reporting',
    page: '/reporting/',
    via: 'reporting',
    at: '.rg-pace-grid',
    alt: '#rg-week',
    title: 'Highlights',
    body: 'Where each goal ends the year, the week in plain words for each team, and My dashboard for answers you pin from Favor Brain. {Tap} any number on the page to see what is in it.',
    for: (w) => w.kpi,
    added: '2026-10-12',
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
    at: '.h-tab[data-kpi-team]:not([hidden])',
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
    body: 'Type a question and {tap} Enter. Answers come back as cards and tables you can {tap}, not only text: a partner card, team numbers by quarter and month, a chart, steps from the manuals. When a question could mean two things, you get buttons to pick from. It is new, so {tap} Not right when an answer is off.',
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'brain-files',
    page: '/brain/',
    at: '#bc-compose',
    title: 'Find a file, or a number in it',
    body: 'Ask for a document, sheet, slide deck, PDF, photo or recording, or for a number inside one. Each match is a card with its owner, its date and Open in Drive, and you see only files your own Google account can open.',
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'brain-read',
    skipIfMissing: true,
    page: '/brain/',
    at: '.bc-starters',
    title: 'Change how it read you',
    body: 'Under each answer, "How I read it" shows the year, state or team it used. {Tap} one and pick another, and the answer redraws in place. Follow-up buttons under the newest answer ask the next question for you.',
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'brain-chats',
    phone: false,
    page: '/brain/',
    at: '#bc-rail',
    title: 'Your chats',
    body: 'Every conversation is kept for 30 days. Search them, rename one, pin the ones you come back to, or delete one. Ctrl Shift O starts a new chat. The icon at the top right of the chat hides the FavorOS menu so the chat gets the whole window.',
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'brain-sheets',
    skipIfMissing: true,
    page: '/brain/',
    at: '[data-sheets]',
    title: 'Open a list in Google Sheets',
    body: 'Beside Copy and CSV on every list, Open in Google Sheets makes a private sheet in your own Drive. The first time, Google asks once for permission. Only you can open the sheet until you share it, and it holds partner information, so keep it inside Favor.',
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'brain-connect',
    skipIfMissing: true,
    page: '/brain/',
    at: '[data-act="connect"]',
    title: 'Use it from another app',
    body: 'Connect opens the steps to ask Favor Brain from another app you already use. Follow them once.',
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'brain-access',
    skipIfMissing: true,
    page: '/brain/',
    at: '#bc-menu',
    title: 'What you can ask about',
    body: 'The three dots hold What you can ask about. Your role decides it. If your work needs more, {tap} Ask Will, say why, and Will decides.',
    added: '2026-10-10',
    side: 'left',
  },
  {
    id: 'admin-health',
    page: '/admin/',
    via: 'admin-home',
    at: '#ad-strip',
    title: 'Check the jobs behind FavorOS',
    body: 'Each tile shows when a job last ran and whether it is OK, Late or Failed: the Blackbaud copy, the morning jobs, the overnight sender, the Drive library job, SKY calls, iWave credits and the unsubscribe write-back. The Audit log lists every settings change.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'admin-bbusers',
    page: '/admin/blackbaud-users/',
    via: 'admin-home',
    at: '#bu-tiles',
    title: 'See who has a Blackbaud login',
    body: 'Blackbaud users lists everyone with a login: their status, their Raiser\'s Edge NXT access and any other product they can open. Active, Inactive and All narrow the list, and the search box finds a name or an email. The list is read from the Blackbaud users page each weekday morning, and As of shows when. Add user, Change access and Deactivate save a request that the desktop runs in Blackbaud, and the Requests list shows its status.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'admin-appeals',
    page: '/admin/appeal-codes/',
    via: 'admin-home',
    at: '#ap-new',
    title: 'Create an appeal code',
    body: 'Pick the kind, the date and the suffix, and the page builds the code and description from the scheme and says whether Blackbaud already has it. A newsletter gets its EMW week from the send date. Tick the online code for a letter and both appeals are created in Blackbaud. Funds and campaigns wait in the list below until someone creates them.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'onboarding',
    page: '/onboarding/',
    via: 'onboarding',
    at: '#ob-start',
    title: 'Start a new hire or an exit',
    body: 'Start onboarding takes a name, a Favor email, a supervisor and a start date, then builds the checklist: every step has an owner and a due date and becomes a task in Projects. Add to FavorOS creates the account, joins Chat, assigns the New hire paths in Learn and emails the first-day page. Start offboarding hands over open work and closes access on the last day.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'welcome',
    page: '/welcome/',
    via: 'welcome',
    at: '.wl-hero',
    title: 'Your first-day page',
    body: 'New hires land here: your steps with due dates, the first week by day, and the people to meet with their faces. Anyone can open it from Help to see what a new hire sees.',
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'admin-tours',
    page: '/admin/tours/',
    via: 'admin-tours',
    at: '#tu-table',
    title: 'Who has finished the tours',
    body: 'Each person shows where they stand on the tour of FavorOS and on each release. Send again opens it once more for a person, or for a whole team picked above the list.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'top',
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
    id: 'work-overview',
    alt: '.wh-tools',
    page: '/work-home/',
    via: 'work-home',
    at: '#wh-due',
    title: 'Your day in Work',
    body: 'Work opens on what is due today and overdue. {Tap} the circle to complete an action, Snooze to move it, or the partner name to open the partner. Gifts to thank lists the oldest five with a Thank button, and Your week shows your goals.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'right',
  },
  {
    id: 'work-center',
    press: '.wc-tab[data-view="open"]',
    alt: '#wc-board',
    page: '/work/',
    via: 'work',
    at: '#o-rows .wc-row',
    title: 'Finish many actions at once',
    body: 'Tick the actions you want, then {tap} Mark complete. One date and one shared line go on all of them, and Recent undoes a batch for 24 hours.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'work-center-edit',
    press: '.wc-tab[data-view="open"]',
    phone: { body: '{Tap} a partner name to open the action: every field, its notes, tags and attachments. New action adds a contact or a task with a follow-up.' },
    page: '/work/',
    via: 'work',
    at: '#wc-tools2',
    title: 'Change anything on an action',
    body: '{Tap} a partner name to open the action: every field, its notes, tags and attachments, with the partner beside it. {Tap} a date, a status or a name in the list to change it in place. New action adds a contact or a task with a follow-up. {Tap} ? for the keyboard shortcuts.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-my-partners',
    page: '/work/',
    via: 'work',
    at: '.wc-tab[data-view="mine"]',
    title: 'See who has gone quiet',
    body: 'My partners lists every partner you hold, biggest givers first, with the last contact, the last gift and the next step. Pick Quiet 90 days to see who needs a call. Tick the partners you want to call and {tap} Plan calls: it adds one call task each across the days you pick, weekdays only, and can remind you at 9 AM.',
    for: (w) => w.admin || w.teams.includes('rdd') || w.teams.includes('ce'),
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-reminders',
    at: '#wm-bell',
    title: 'Reminders and the morning email',
    body: 'The bell holds what you asked to be reminded about. {Tap} the small bell on any open task in a partner page to set one. Done clears it, and Later moves it to this afternoon, tomorrow or next week. The Morning email chip on the Work Center sets which sections the weekday email shows, when it comes, and sends you a test.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-add-partner',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    at: '.wc-tab[data-view="intake"]',
    title: 'Add a partner Entry could not match',
    body: 'When a sheet row matches no record, {tap} Add partner on the row. The form fills in from the row, and records already in Blackbaud show beside it with the reason, such as the same phone, the same email or the same name and city. Use this record matches the row to a partner that is already there. Add as new partner stays locked until you tick None of these is the same person.',
    for: (w) => w.admin || team('support')(w),
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-my-week',
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="week"]',
    at: '.wwk-report',
    title: 'My week and the weekly report',
    body: "Directors see this week's connections, meetings, event and one-on-ones against the weekly goals, and the year's giving against the annual goal, in a strip above the tabs. {Tap} it to open My week: what counted, and a report draft for Goals for the week or Update for the week. Tick Giving, Asks, Number of Referrals or Next, edit the text, then {tap} Copy for WhatsApp, Copy for email or Open in my email. The Support Team opens the same tab as Weekly reports and picks a director.",
    for: (w) => w.admin || team('rdd')(w) || team('support')(w),
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'work-start-view',
    press: '.wc-tab[data-view="open"]',
    phone: false,
    page: '/work/',
    via: 'work',
    at: '[data-startpill]',
    title: 'Pick where the Work Center opens',
    body: 'The Opens on button sets the tab you land on and what Open actions shows: Mine, On my partners or Everyone. Until you pick one, directors open on Gifts to thank, the Support Team on HQTY letters and Partner Care on Cadence. Start here on a chip on Open actions saves that scope.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-record-tabs',
    page: '/work/partner/',
    via: 'work',
    at: '#pv-search',
    title: 'Keep the record right from the partner',
    body: 'Open any partner and the tabs under the name are Overview, Contact, Codes and Record. Contact lists every address with its dates and seasonal window, every phone and every email, and Edit changes one. Codes holds the constituent codes and the solicit codes. Record marks a partner deceased or inactive and lists what goes with it, including Do Not Disturb and the deceased tag in GoHighLevel and a block on the giving portal. Each change shows what Blackbaud kept, and Undo stays for 24 hours.',
    for: (w) => w.admin || team('support')(w),
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'work-add-partner-full',
    press: '.wc-tab[data-view="open"]',
    alt: '#wc-tools2',
    page: '/work/',
    via: 'work',
    at: '#wc-tools2 [data-add-partner]',
    title: 'Add a partner that is not in Blackbaud',
    body: 'Add partner opens the form for an individual, a household or an organization. A household is two people joined as spouses, and an organization takes a type and a main contact who gets their own record. Records already in Blackbaud show beside the form with the reason they match. Add stays locked until you tick None of these is the same person. The holder comes from the state on the address.',
    for: (w) => w.admin || team('support')(w),
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'work-partner-notes',
    page: '/work/partner/',
    via: 'work',
    at: '#pv-search',
    title: 'Read and write notes on a partner',
    body: 'Open any partner and the Notes section lists every note on the record with its topic, who wrote it and the date. Add a note picks General, Prayer, Giving or Family and saves to Blackbaud. Tick Show at the top as an instruction and it stays in red under the partner name, and in Call prep. A note you just saved shows In Blackbaud with Undo for 24 hours.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'work-action-tags',
    press: '.wc-tab[data-view="open"]',
    alt: '#wc-board',
    page: '/work/',
    via: 'work',
    at: '#o-rows .wc-row',
    title: 'Tag an action in one {tap}',
    body: 'Open an action and the Tags tab shows nine tags: Thanked, Texted, Stewardship, Scheduling, Favor Presentation, Attended Event, Hosted Event, Amount of Ask and Number of Referrals. {Tap} a tag to put it on or take it off. Ask and Referrals take a number. Each tag also shows on its row in Open actions, and Undo puts back what you changed.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'gifts-to-thank',
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="gifts"]',
    at: '#wg-sheet',
    title: 'Gifts to thank',
    body: 'Every gift on the partners you hold that nobody has thanked yet, soft credits included, oldest first. {Tap} Thank, pick how it went out and say what was said, and the gift leaves the list and counts as your contact in Blackbaud. Left a message keeps the gift here and reminds you tomorrow. Tick several and thank them by letter or email in one step. Every thank-you can be undone from the message that appears.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'hqty-letters',
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="hqty"]',
    at: '#hq-sheet',
    title: 'HQTY letters',
    body: 'Every gift of $5,000 and up, newest first, with the partner it is credited to and where its letter stands. Print makes one PDF with a page per letter. {Tap} Signed when they are signed and Mark mailed when they go out, and Blackbaud gets one HQTY Letter action for each. The month button edits the letter text once for the whole month. Cannot send takes a gift off the list with a reason. Signed by picks who signs each letter: Terry Goodman, Carole Ward, Rachel Cox, Michael Hinton, or the partner’s Regional Development Director. A letter with no pick takes its partner’s RDD, and otherwise the last signer you picked. Use the bar to set one signer for every selected letter still To write.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'gifts-letter',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="gifts"]',
    at: '[data-wg-letter]',
    title: 'Letters from a director',
    body: 'Letter opens a page for the gift. Pick the director it comes from, paste what the director said, and turn the Designation, Director\'s words and Invitation paragraphs on or off. Print PDF and log prints it and records the thank-you in Blackbaud. Tick several gifts and {tap} Letters, one PDF to print a batch.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'left',
  },
  {
    id: 'work-asks',
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="asks"]',
    at: '#wa-sheet',
    title: 'Asks',
    body: 'Every action with an Amount of Ask in the last year sits in a column: Asked with no close date, Closing, Past the close date or Gave. The chip on a card sets the expected close date and saves at once, and Undo is in the message. A gift of the asked amount or more after the ask moves the card to Gave. Prep opens the call brief, and Google Sheets exports the board.',
    for: (w) => w.admin || team('rdd')(w) || team('support')(w),
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'cadence',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="cadence"]',
    at: '.wcd-row',
    title: 'Cadence',
    body: 'Partners due for contact under the Partner Care manual: first-time partners, monthly, quarterly, twice a year and annual. The next step is green. {Tap} a step, say what was said and save, and the contact is logged on the partner. A step with no phone, email or address is switched off and says why. Print the three lists splits the work into Friday, Saturday and Sunday.',
    for: (w) => w.admin || team('pc')(w),
    added: '2026-10-10',
    side: 'top',
  },
  {
    id: 'work-declines',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="declines"]',
    at: '.wfn-row',
    title: 'Declined payments',
    body: 'Every declined monthly payment and every gift set to zero from the last 90 days, with the reason the card processor gave. Hard rejects need a new card. {Tap} Log, pick how you followed up and where it stands, and Blackbaud gets an Information Update on the partner. A decline clears itself when a later payment on the same schedule goes through.',
    for: (w) => w.admin || team('pc')(w) || team('support')(w),
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'work-grants',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="grants"]',
    at: '[data-wgr-log]',
    title: 'Grant requests, LOIs and reports',
    body: 'Log adds a request, LOI, report, task or cultivation step on a foundation and attaches the PDF to it in one pass. Pick Sent for something already out, or To do with a due date. The list shows every grant action from the last 24 months, and File on a row adds a document to an action that is already there.',
    for: (w) => w.admin || team('grants')(w) || team('support')(w),
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'work-giftimages',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="giftimages"]',
    at: '.wgi-row',
    title: 'Check and letter images',
    body: 'Gifts of $5,000 or more and gifts from giving funds and foundations need their check or letter image in Blackbaud. Check asks Blackbaud whether a gift already has one, and Attach puts a photo or PDF on the gift. The Blackbaud copy holds no attachments, so a gift stays on the list until one of those two buttons settles it.',
    for: (w) => w.admin || team('support')(w),
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'call-prep',
    skipIfMissing: true,
    page: '/work/',
    via: 'work',
    press: '.wc-tab[data-view="gifts"]',
    at: '[data-wg-prep]',
    title: 'Call prep',
    body: '{Tap} Prep on a gift, or Call prep on any partner, and the brief opens: the call in order (thank, pray, report, ask, thank, pray) with each line filled from the records, plus giving, who they give to, the last three contacts and open tasks. {Tap} Log this call when you finish, or Print for a page to hold.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'left',
  },
  {
    id: 'partner-page',
    page: '/work/partner/',
    via: 'work',
    at: '#pv-search',
    title: 'Find any partner',
    body: 'Type a name, an email, a phone number, a street address or a lookup id. Any partner name in FavorOS opens the partner beside your work: giving, what is due, one timeline of gifts, contacts and notes, and buttons to call, log a contact, add a task or a note.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'partner-copy-share',
    page: '/work/partner/',
    via: 'work',
    at: '#pv-search',
    title: 'Copy and share',
    body: '{Tap} a partner\'s phone, email or address to copy it. Copy link gives a link to that partner, and Find a partner lists the last eight you opened. Reports and Favor Brain answers have Copy link too.',
    for: (w) => w.admin || w.work,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'clips',
    at: '#clip-cam',
    title: 'Record a clip from any page',
    body: '{Tap} the camera at the top right. A small recorder window opens, so you can go anywhere in FavorOS while it records. Pick the full screen, a window or a tab, turn the camera and microphone on or off, and {tap} Start recording. When you stop, the clip gets a title, a summary and chapters on its own, and you get a link. Your clips live under Clips in the menu, and only you see them. Only signed-in Favor staff can open a link unless you turn on Anyone with the link.',
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'clips-controls',
    at: '#clip-cam',
    title: 'Clip controls follow you',
    body: 'While a clip records, a small window with Stop, the time, Pause, Mute, Start over and Discard floats above every app in Chrome and Edge. Drag it anywhere. In Safari and Firefox the same controls show as a pill on every FavorOS page. Closing the floating window never ends the recording.',
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'clips-share',
    at: '#clip-cam',
    title: 'Change the screen mid-recording',
    body: 'The floating recording window now has a share button, Change what I am sharing, which swaps to another screen, window or tab and keeps the same clip. Pause, Resume, the camera on or off and Mute sit beside it. Press Alt+Shift+P to pause or resume and Alt+Shift+S to stop and save, in the recorder, the floating window or the pill.',
    added: '2026-10-12',
    side: 'bottom',
  },
  {
    id: 'meetings',
    alt: '#mt-day, #mt-home',
    page: '/meet/',
    via: 'meet',
    at: '.dv-tl',
    title: 'Meetings, in FavorOS',
    body: 'Start a room with one {tap}, or book one. Everyone joins from the browser, with video, sound, chat and screen sharing. The host can mute people, spotlight one person for everyone, lock the room and hand out host rights. A meeting that records saves its video to the Meetings drive in Google Drive and writes notes with decisions and action items under Meeting notes.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'meeting-nudge',
    skipIfMissing: true,
    alt: '.dv-bar',
    page: '/meet/',
    via: 'meet',
    at: '#nudge-ask',
    title: 'Two minutes before a meeting',
    body: 'Two minutes before a meeting on your calendar, a box in the corner of any page shows its name and a Join button. Allow system notifications from the quiet line at the bottom of this page and the alert reaches your computer too. On a meeting\'s notes, Book the follow-up opens the booking with the same people already added.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'meeting-invite',
    alt: '#mt-day, #mt-home',
    page: '/meet/',
    via: 'meet',
    at: '.dv-bar',
    title: 'Invite someone from inside a call',
    body: 'Open People in a room and type a Favor name, an email or a phone number in the Invite box. Favor people get an email with a Join now link, outside emails get the guest link, and a phone number gets the guest link by text. Each invitation shows Sent or Failed.',
    for: (w) => w.admin,
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'mail',
    alt: '.ml-list',
    page: '/mail/',
    via: 'mail',
    at: '.ml-rows',
    title: 'Your Gmail, inside FavorOS',
    body: 'Mail shows your own Gmail: inbox, labels, conversations and files. Reply, archive, delete, star, label and snooze here, and search with Gmail words like from: and has:attachment. Google asks once before FavorOS reads your mail and once more before it changes or sends anything. More on a conversation makes a task, sends it to Chat, opens the partner or logs an action in Blackbaud.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'right',
  },
  {
    id: 'chat',
    phone: { at: '.ch-sec[data-sec="channels"]' },
    page: '/chat/',
    via: 'chat',
    at: '.ch-side',
    title: 'Chat with the team',
    body: 'Channels, direct messages and groups sit on the left. Bold means unread, and a number means someone mentioned you. {Tap} a channel to read it, answer in its thread, react, and edit or delete your own messages.',
    added: '2026-10-11',
    side: 'right',
  },
  {
    id: 'chat-share',
    phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
    page: '/chat/',
    at: '.ch-main [data-act="plus"]',
    title: 'Share a clip, a Drive file or a meeting',
    body: '{Tap} the plus in the message box. Share from Drive searches the Drive library and posts the file as a card. Share a clip posts one of yours, and Record a clip posts the clip here when you finish. Start a meeting opens the huddle sheet.',
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'chat-files',
    phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
    alt: '.ch-main .ch-comp__box',
    page: '/chat/',
    at: '.ch-main .ch-msg',
    title: 'Files open right here',
    body: 'Clips and videos play in the message. {Tap} a picture, a PDF, a Word or Excel file or a Drive file to read it on top of the chat, then close it to land back where you were. Download and Open in Google Drive sit at the top right.',
    added: '2026-10-11',
    side: 'left',
  },
  {
    id: 'chat-huddle',
    phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
    page: '/chat/',
    at: '.ch-head .ch-btn--meet',
    title: 'Huddle',
    body: '{Tap} Huddle to see who is in the huddle, check your camera and microphone, and choose your devices before you go in. Join huddle or Start a huddle opens the room with those choices. A live huddle shows as a green bar under the channel name with faces, the time and Join. Leave brings you back here.',
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'chat-brain',
    phone: { press: '.ch-sec[data-sec="channels"] .ch-row[data-act="open"]' },
    page: '/chat/',
    at: '.ch-main [data-act="ask-brain"]',
    title: 'Ask Favor Brain in a thread',
    body: 'Type @Favor Brain and your question in any channel or thread. The answer comes back as cards, tiles and tables, from the records your own account can see. Only you see it until you {tap} Share to channel.',
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'learn',
    alt: '#ln',
    page: '/learn/',
    via: 'learn',
    at: '.ln-head',
    title: 'Learn',
    body: 'My learning lists the courses and learning paths assigned to you with their due dates, and the lesson where you left off. A course holds videos, help articles, documents, written pages and quizzes. Finish every lesson and the course gives you a certificate you can print.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'learn-manage',
    alt: '#ln',
    page: '/learn/admin/',
    at: '.la-tabs',
    title: 'Build and assign courses',
    body: 'Manage is for admins and HR. Build a course by searching the help library, your clips and Drive in one box, add a written page or a quiz, and drag lessons into order. Assign a course or a path to people, a team or everyone with a due date. Reports show who is done, who is late and the quiz scores.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'top',
  },
  {
    id: 'chat-threads',
    phone: { press: '.ch-head [data-act="back"]', body: 'Threads lists every thread you are in, with a count of replies you have not read. Mentions and reactions shows where you were named. Drafts keeps what you typed and did not send.' },
    page: '/chat/',
    at: '.ch-navs',
    title: 'Threads, mentions and drafts',
    body: 'Threads lists every thread you are in, with a count of replies you have not read. Mentions and reactions shows where you were named and who reacted to your messages. Drafts keeps what you typed and did not send, one per conversation. Ctrl K jumps to any channel or person.',
    added: '2026-10-11',
    side: 'right',
  },
  {
    id: 'feedback',
    at: '#h-fb',
    title: 'Tell us what you think',
    body: 'Something wrong, confusing, or a good idea? {Tap} Feedback on any page. Your note goes to Will with the page you were on, and his answer shows under Feedback in the menu.',
    added: '2026-10-09',
    side: 'bottom',
  },
  {
    id: 'feedback-shot',
    at: '#h-fb',
    title: 'A picture of the page comes with it',
    body: 'Feedback attaches a picture of the screen you are looking at. Before it sends, {tap} Blur an area and drag a box over anything private, such as a partner name or a gift. {Tap} Remove to send the note without the picture.',
    added: '2026-10-10',
    side: 'bottom',
  },
  {
    id: 'feedback-admin',
    page: '/feedback/',
    via: 'feedback',
    at: '#fb-tabs',
    title: 'Every note in one place',
    body: 'Notes from FavorOS, Favor Brain, the help docs and this tour land here. Mark each one seen, fixed or not now, and write a reply the sender reads. New notes show on Today and beside Feedback in the menu.',
    for: (w) => w.admin,
    added: '2026-10-09',
    side: 'top',
  },
  {
    id: 'docs',
    at: '.h-area[data-area="help"] .h-area__link',
    title: 'Help docs and training videos',
    body: 'Look up how anything works, from making a request to reading the KPI dashboard. The training videos are here too, with captions.',
    added: '2026-10-09',
    side: 'right',
  },
  {
    id: 'sound',
    at: '[data-sound-switch]',
    title: 'Sounds',
    body: 'FavorOS makes a soft sound when you {tap} a main button or something finishes. {Tap} the speaker to turn sounds off or on.',
    added: '2026-10-09',
    side: 'top',
  },
  {
    id: 'projects',
    at: '.pj-seg',
    page: '/projects/',
    via: 'projects',
    title: 'Projects and tasks',
    body: 'Projects hold task lists, a board, a calendar and a timeline. Every project can have a Chat channel and a folder in US Team Files. A task opens in place from Chat, Today, the bell and search. Type /task in Chat to make one, or {tap} Make a task from this message. Due dates can go on your Google Calendar, and Project notices in the bell sets how email comes.',
    for: (w) => w.admin,
    added: '2026-10-11',
    side: 'bottom',
  },
  {
    id: 'help',
    at: '.h-area[data-area="help"] .h-area__link',
    title: 'Come back any time',
    body: '{Tap} Help and what\'s new to take this tour again. A green dot on it means something new is waiting to be shown.',
    side: 'top',
  },
];

/** The step as this device shows it, or null when the device leaves it out. */
export function resolveStep(s: Step, device: Device): Step | null {
  const part = device === 'phone' ? s.phone : s.desk;
  if (part === false) return null;
  return part ? { ...s, ...part } : s;
}

/** {tap} and {Tap} become the word for the device. */
export function say(text: string, device: Device): string {
  const word = device === 'phone' ? 'tap' : 'click';
  return text.replace(/\{tap\}/g, word).replace(/\{Tap\}/g, word[0].toUpperCase() + word.slice(1));
}

const mine = (w: Who, list: Step[], device: Device): Step[] =>
  list.filter((s) => !s.for || s.for(w)).map((s) => resolveStep(s, device)).filter(Boolean) as Step[];

export function coreFor(w: Who, device: Device): Step[] {
  // Someone with no Work Center has no Work stop: the request stops cover their part of Work.
  return mine(w, CORE, device).filter((s) => s.id !== 'core-work' || w.work || w.admin);
}

export type Offer = { release: Release; feature: Feature; item: string };

export const coreItem = 'core';
export const releaseItem = (releaseId: string) => `r:${releaseId}`;
export const featureItem = (releaseId: string, featureId: string) => `f:${releaseId}.${featureId}`;

/** Every walkthrough this person can see, newest release first. */
export function offersFor(w: Who): Offer[] {
  const out: Offer[] = [];
  for (const release of RELEASES) {
    for (const feature of release.features) {
      if (!feature.for || feature.for(w)) out.push({ release, feature, item: featureItem(release.id, feature.id) });
    }
  }
  return out;
}

export function featureSteps(f: Feature, w: Who, device: Device): Step[] {
  return mine(w, f.steps, device);
}

const norm = (p: string) => p.replace(/\/+$/, '') || '/';

/** The steps for one page, for "Show me this page". */
export function pageSteps(w: Who, path: string, device: Device): Step[] {
  // At most six: the page's main parts, in the order they sit in this file.
  return mine(w, STEPS, device).filter((s) => s.page && norm(s.page) === norm(path)).slice(0, 6);
}

/** Any step by id, from the core tour, a release or the page steps. */
export function findStep(id: string): Step | null {
  for (const s of CORE) if (s.id === id) return s;
  for (const r of RELEASES) for (const f of r.features) for (const s of f.steps) if (s.id === id) return s;
  return STEPS.find((s) => s.id === id) || null;
}

/** Every item progress is kept for: the core tour, each release (its snooze) and each feature. */
export function allItems(): string[] {
  const out = [coreItem];
  for (const r of RELEASES) {
    out.push(releaseItem(r.id));
    for (const f of r.features) out.push(featureItem(r.id, f.id));
  }
  return out;
}

/** The roles the admin can preview, and the tests walk. */
export const PRESETS: Record<string, Partial<Who>> = {
  staff: { admin: false, leader: false, work: false, teams: [], kpi: true, approver: false, expenseLog: false, hr: false },
  rdd: { work: true, admin: false, leader: false, teams: ['rdd'], kpi: true, approver: false, expenseLog: false, hr: false },
  pc: { work: true, admin: false, leader: false, teams: ['pc'], kpi: true, approver: false, expenseLog: false, hr: false },
  ce: { work: true, admin: false, leader: false, teams: ['ce'], kpi: true, approver: false, expenseLog: false, hr: false },
  grants: { work: true, admin: false, leader: false, teams: ['grants'], kpi: true, approver: false, expenseLog: false, hr: false },
  marketing: { work: false, admin: false, leader: false, teams: ['marketing'], kpi: true, approver: false, expenseLog: false, hr: false },
  leader: { work: true, admin: false, leader: true, teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'], kpi: true, approver: true, expenseLog: true, hr: false },
};
