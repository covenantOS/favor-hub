// The starter courses and paths, written from material that exists today: the hub's help videos and help articles, and the Favor
// words and ways of working staff already use. Written once (each row carries a seed_key), the first time Learn opens. After that
// the course belongs to the authors: edit it, reorder it, archive it. A removed starter course stays removed.
// Videos and articles are named by role, never by person (a standing rule), and no copy here mentions the tools that built it.
import { nowIso, type Env } from '../http';
import { hubGet, hubPut } from '../admin/settings';
import { id, minutesFor, videoBySlug, type LessonKind } from './db';

const SEED_VERSION = 'v1';
const SEED_KEY = 'learn.seed';

type Q = { kind?: 'choice' | 'tf'; text: string; options?: string[]; answer: number; explain: string };

interface SeedLesson {
  kind: LessonKind;
  title: string;
  ref?: string;
  body?: string;
  quiz?: { pass: number; questions: Q[] };
  minutes?: number;
}

interface SeedCourse {
  key: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  lessons: SeedLesson[];
}

const video = (ref: string, title = ''): SeedLesson => ({ kind: 'video', ref, title });
const article = (ref: string, title: string): SeedLesson => ({ kind: 'article', ref, title });
const page = (title: string, body: string): SeedLesson => ({ kind: 'page', title, body });
const doc = (title: string, ref: string, minutes = 6): SeedLesson => ({ kind: 'doc', title, ref, minutes });
const quiz = (title: string, questions: Q[], pass = 80): SeedLesson => ({ kind: 'quiz', title, quiz: { pass, questions } });
const tf = (text: string, answer: boolean, explain: string): Q => ({ kind: 'tf', text, answer: answer ? 0 : 1, explain });

export const COURSES: SeedCourse[] = [
  {
    key: 'favoros-basics',
    slug: 'favoros-basics',
    title: 'FavorOS basics',
    summary: 'Sign in once, read Today, find anything with search, make a request and know where to turn when something looks wrong.',
    audience: 'Everyone',
    color: 'sky',
    lessons: [
      video('favoros-walk-through'),
      article('getting-started', 'Start here'),
      article('signing-in', 'Signing in and connecting Google'),
      article('today', 'Your Today page'),
      article('search', 'Search, shortcuts and sounds'),
      article('guided-tour', 'The guided tour'),
      article('something-wrong', 'When something looks wrong'),
      quiz('Check what you learned', [
        { text: 'How do you sign in to FavorOS?', options: ['With your Favor Google account, once, for every tool', 'With a separate password for each tool', 'With a code the technology team sends you', 'With your Blackbaud login'], answer: 0, explain: 'One Google sign-in opens every tool, so the old page passwords are gone.' },
        { text: 'What is the fastest way to jump to any tool or help topic?', options: ['Press Ctrl and K (Command and K on a Mac) and type a few letters', 'Scroll the menu until you find it', 'Email the help desk', 'Read every help article'], answer: 0, explain: 'Search opens from any page with Ctrl K. Type a few letters and press Enter.' },
        { text: 'You need approval for a purchase or a trip. Where does that go?', options: ['An expense request, sent before you buy or travel', 'The request board', 'A direct message', 'Your Today page'], answer: 0, explain: 'Use an expense request before a purchase or a trip. The approver signs online and you get the signed copy by email.' },
        { text: 'What are the columns on the request board, in order?', options: ['Inbox, Approved, In motion, Done', 'Open, Waiting, Closed, Archived', 'Draft, Review, Live, Done', 'New, Doing, Done, Dropped'], answer: 0, explain: 'Inbox is new, Approved is next in line, In motion is being worked on, and Done is finished.' },
        tf('Today shows each person only the cards that apply to them.', true, 'You only see cards that apply to you. An expense card shows only if you approve expenses, for example.'),
        tf('Taking the guided tour sends or changes real requests.', false, 'The tour moves the pointer and explains each tool. Nothing gets sent or changed.'),
      ]),
    ],
  },
  {
    key: 'requests-and-clips',
    slug: 'requests-and-clips',
    title: 'Requests, expenses and Clips',
    summary: 'Ask for work in your own words, send an expense request, follow a request on the board, and record a short clip to show instead of type.',
    audience: 'Everyone',
    color: 'teal',
    lessons: [
      article('make-a-request', 'Make a request'),
      article('request-board', 'The request board'),
      article('expense-request', 'Send an expense request'),
      article('clips', 'Clips'),
      quiz('Check what you learned', [
        { text: 'Where does a request for a flyer, a social post or a video go?', options: ['The Marketing team, through its request form', 'The request board', 'An expense request', 'Chat'], answer: 0, explain: 'Design, print, social and video work goes to the Marketing team. The form opens with your words already copied.' },
        { text: 'Where does a website, app or Blackbaud request go?', options: ['The request board', 'The Marketing team', 'An expense request', 'Today'], answer: 0, explain: 'Website, portal, dashboard, app and Blackbaud work goes on the request board.' },
        { text: 'When do you send an expense request?', options: ['Before the purchase or the trip', 'After you buy', 'Only for travel', 'Once a month'], answer: 0, explain: 'Use an expense request before a purchase or a trip. Card expenses you already made still go through Paycom.' },
        { text: 'What does a good request include?', options: ['What it does now, what it should do, the page or record, and when you need it', 'As few words as possible', 'Only the word urgent', 'A request for a meeting first'], answer: 0, explain: 'Say what it does now and what it should do instead. Name the page, list or record, and say when you need it and why.' },
        tf('By default, only people signed in with a Favor account can open a clip.', true, 'Anyone with the link is a separate switch you turn on for each clip.'),
        tf('A clip can show partner details on screen, so check what is showing before you share it outside Favor.', true, 'Check what is on screen before you turn on Anyone with the link.'),
      ]),
    ],
  },
  {
    key: 'favor-brain',
    slug: 'favor-brain',
    title: 'Favor Brain: ask the numbers',
    summary: 'Ask about partners, giving, team numbers, grants and the manuals in plain words, and connect Claude or ChatGPT to keep the conversation going.',
    audience: 'Everyone',
    color: 'dusk',
    lessons: [
      article('ask-favor', 'What Favor Brain is'),
      article('asking-well', 'Asking good questions'),
      article('lists-and-downloads', 'Lists, downloads and Google Sheets'),
      article('access', 'Who sees what, and asking for more'),
      quiz('Check what you learned', [
        { text: 'In Claude, where do you add Favor?', options: ['Customize, then Connectors', 'Settings, then Billing', 'Projects, then Files', 'The Help menu'], answer: 0, explain: 'Open claude.ai, press Customize, then Connectors. If you use Claude through Favor, Favor is already in your list.' },
        { text: 'Which account do you sign in with when Favor asks?', options: ['Your Favor Google account', 'A personal Gmail account', 'Your Blackbaud login', 'A shared team login'], answer: 0, explain: 'Press Continue with Google and sign in with your Favor account.' },
        { text: 'What do you change for the read only tools after connecting?', options: ['From Needs approval to Always allow', 'From Always allow to Off', 'Nothing', 'From Read to Write'], answer: 0, explain: 'Favor Brain has its own protections, so setting read only tools to Always allow is recommended.' },
        { text: 'A long list comes back from Favor Brain. What can you do with it?', options: ['Sort it, download it as a CSV, or open it as a private Google Sheet', 'Only read it on screen', 'Only print it', 'Email it from the page'], answer: 0, explain: 'Long answers come back as a table you can sort and filter, copy, download as a CSV or open as a Google Sheet in your own Drive.' },
        tf('Favor Brain is in beta, so staff are asked to tell the team how it does.', true, 'It is in beta. Use Feedback to say what worked and what did not.'),
      ]),
    ],
  },
  {
    key: 'favor-who-we-are',
    slug: 'favor-who-we-are',
    title: 'Favor: who we are',
    summary: 'What Favor does, the words staff use every day, the U.S. team and how it works together.',
    audience: 'New staff',
    color: 'leaf',
    lessons: [
      page(
        'What Favor does',
        [
          'Favor International is a ministry first. The U.S. team exists to serve the work in Africa and the partners who make it possible.',
          '## Where the work happens',
          'Favor has three main bases: Gulu in Uganda, Juba in South Sudan and N’Djamena in Chad. It works in the Central African Republic, Chad, the Democratic Republic of the Congo, Ethiopia, Kenya, South Sudan, Sudan, Uganda and Djibouti.',
          'Some of the countries Favor reaches are not promoted on public platforms. Ask your supervisor before you name a country in anything that leaves the office.',
          '## The programs you will hear about',
          '- **HOP**: Houses of Prayer. The foundation of the ministry, with daily devotions, fasting and prayer weeks and citywide prayer.',
          '- **REEP**: Rural Evangelism and Empowerment Program. Bible distribution and translation, church planting, mission stations, Portable Bible Schools and trauma counseling.',
          '- **PBS**: Portable Bible Schools, three months of biblical training for new disciples in hard regions.',
          '- **GIFT**: God’s Institute for Transformation, a home and family for children and youth in Uganda and South Sudan.',
          '- **VLC**: Village Learning Centers, schools for grades K to 6 that start in church buildings.',
          '- **Favor FM**: the radio ministry that reaches northern Uganda and South Sudan.',
        ].join('\n\n')
      ),
      page(
        'The Six R’s and the four pillars',
        [
          'Favor describes its work with two short lists. Learn both. Staff use them in meetings and in plans.',
          '## The Six R’s',
          '1. **Relationships**',
          '2. **Research**',
          '3. **Records**',
          '4. **Receipts**',
          '5. **Reports**',
          '6. **Results**',
          '## The four pillars for building a ministry',
          '- **Admin**',
          '- **Spiritual**',
          '- **Legal**',
          '- **Financial**',
        ].join('\n\n')
      ),
      page(
        'The U.S. team and its words',
        [
          'Partners are the people and organizations who give to Favor.',
          '## Who does what',
          '- **Partner Care (PC)** builds relationships with partners who give under $1,000.',
          '- **Regional Development Directors (RDDs)** build relationships with partners who give over $1,000 and live in the RDD’s assigned region.',
          '- **The Support Team** supports the RDDs, the Founder, the Executive Director and the office.',
          '- **Operations (OP)** runs the headquarters office, finance, compliance, licensing and administration.',
          '- **Marketing (MK)** handles direct and digital mail, branding and design.',
          '- **Technology and Systems** keeps Blackbaud healthy and usable, solves IT problems and improves processes.',
          '## Words you will hear',
          '- **RR&E**: Roles, Responsibilities and Expectations, written for each position.',
          '- **SOP**: a Standard Operating Procedure, written by each department.',
          '- **ED**: Executive Director of U.S. Operations.',
          '- **DAF**: a fund held at another organization that sends gifts to Favor at a partner’s direction. **FND**: foundation.',
          '- **LOI**: Letter of Interest, two pages, before a proposal.',
          'The full list is in the Acronyms document in the next lesson.',
        ].join('\n\n')
      ),
      doc('Favor acronyms and terms (Google Doc)', 'https://docs.google.com/document/d/1NpzWmCE24xGc2ryzEqhVIst--NPtPezqdijj_tqDlRo/edit', 8),
      page(
        'How we work together',
        [
          'The Policies Manual is the final word. If anything on this page differs from it, follow the manual and tell your supervisor.',
          '## Ministry first',
          'Department meetings open and close in prayer. The U.S. Team Prayer Call is on Wednesday, with cameras on and everyone taking part.',
          '## Partner information',
          'Partner information stays in Blackbaud. It does not go on other platforms or personal phones. Write Blackbaud entries as records an auditor could read.',
          '## Asking for things',
          '- Ask for Marketing work with **Make a request** in FavorOS.',
          '- Get an expense approved with an **Expense request** before you spend or travel. The Travel and Expense Policy in the next lesson has the rules.',
          '- Keep your Google Calendar current. Enter travel as an all-day event with the city and the purpose.',
          '## Stewardship',
          'Ask whether you would be comfortable with a partner sitting beside you while you spend.',
        ].join('\n\n')
      ),
      doc('Travel and Expense Policy (Google Doc)', 'https://docs.google.com/document/d/1Qidbw1Ii6nFMP2UT_NYJq_sup1InJUSRx-GqdellBUw/edit', 10),
      quiz('Check what you learned', [
        { text: 'What are the Six R’s?', options: ['Relationships, Research, Records, Receipts, Reports, Results', 'Raise, Receive, Record, Report, Review, Renew', 'Relationships, Revenue, Records, Retention, Reports, Results', 'Research, Reach, Record, Respond, Report, Rest'], answer: 0, explain: 'The Six R’s are Relationships, Research, Records, Receipts, Reports and Results.' },
        { text: 'What are the four pillars for building a ministry?', options: ['Admin, Spiritual, Legal, Financial', 'Prayer, Giving, Going, Serving', 'Faith, Hope, Love, Work', 'Admin, Marketing, Legal, Programs'], answer: 0, explain: 'The four pillars are Admin, Spiritual, Legal and Financial.' },
        { text: 'Which team builds relationships with partners who give under $1,000?', options: ['Partner Care', 'The RDDs', 'The Support Team', 'Marketing'], answer: 0, explain: 'Partner Care (PC) cultivates relationships with partners who give under $1,000.' },
        { text: 'An RDD builds relationships with partners who:', options: ['Give over $1,000 and live in the RDD’s assigned region', 'Give under $1,000', 'Live outside the United States', 'Have never given'], answer: 0, explain: 'RDD stands for Regional Development Director, and the region is part of the job.' },
        { text: 'What does HOP stand for?', options: ['Houses of Prayer', 'Hope Outreach Program', 'Help Our People', 'Holy Outreach Partners'], answer: 0, explain: 'HOP is Houses of Prayer, the foundation of the ministry.' },
        tf('Partner information stays in Blackbaud and off other platforms and personal phones.', true, 'Keep partner details in Blackbaud.'),
        tf('You may spend first and ask for approval afterward.', false, 'Every expense is approved before it is incurred, with an expense request.'),
      ]),
    ],
  },
  {
    key: 'blackbaud-first-week',
    slug: 'blackbaud-first-week',
    title: 'Blackbaud: your first week',
    summary: 'Get around Raiser’s Edge NXT, search before you add anyone, and read a partner’s record from the codes to the giving history.',
    audience: 'Everyone who uses Blackbaud',
    color: 'sun',
    lessons: [
      video('first-week-in-blackbaud'),
      article('blackbaud-videos', 'Blackbaud training on video'),
      page(
        'Three rules for your first week',
        [
          '1. **Search first.** Look for the person or organization before you add anyone, so you never create a duplicate. A duplicate record is hard to clean up.',
          '2. **Look all you want, but change nothing your job does not cover.** Codes, assignments and gifts change only when your job says so.',
          '3. **Checks from the mail go in as a batch, and a second person approves it.**',
          'If a record looks wrong, tell the Blackbaud administrator. Do not fix it yourself.',
          '## Try it today',
          'Open a partner you know and find the code, the fundraiser, the last action and the last gift. Do it with five partners and the page starts to feel familiar.',
        ].join('\n\n')
      ),
      quiz('Check what you learned', [
        { text: 'What does the constituent code Partner mean?', options: ['They have given', 'They have not given yet', 'They are a staff member', 'They asked to be removed'], answer: 0, explain: 'Partner means they have given. Prospect means they have not yet.' },
        { text: 'Before you add a new person to Blackbaud, you should:', options: ['Search for them first', 'Ask the partner for their ID number', 'Add them and merge later', 'Check the KPI dashboard'], answer: 0, explain: 'Search first, so you never create a duplicate record.' },
        { text: 'Who sets a new partner’s assigned fundraiser?', options: ['The system, every morning. You do not set it yourself.', 'Whoever enters the gift', 'The partner', 'The Marketing team'], answer: 0, explain: 'The system assigns new partners every morning.' },
        { text: 'How do checks from the mail go in?', options: ['As a batch, and a second person approves it', 'One at a time, by the person who opened the mail', 'Straight onto the partner record', 'Through the request board'], answer: 0, explain: 'Mail gifts go in as a batch and a different person approves it.' },
        { text: 'In Giving History, what does the fund tell you?', options: ['Where the partner wanted the gift to go', 'What moved them to give', 'Who thanked them', 'Which fundraiser holds them'], answer: 0, explain: 'The fund is where the partner wanted the gift to go. The appeal is what moved them to give.' },
        tf('You may change codes, assignments or gifts whenever a record looks wrong to you.', false, 'Look all you want, but change them only when your job says to. Tell the Blackbaud administrator instead.'),
      ]),
    ],
  },
  {
    key: 'blackbaud-queries',
    slug: 'blackbaud-queries',
    title: 'Queries in Raiser’s Edge NXT',
    summary: 'Build a query from one filter to a merge query, and learn when to use AND, OR, parentheses and which query type to pick.',
    audience: 'RDDs, Partner Care, Church Engagement, Grants, Marketing',
    color: 'sun',
    lessons: [
      video('queries-in-raisers-edge'),
      quiz('Check what you learned', [
        { text: 'Which list names the four parts of every query?', options: ['Query type, criteria, output, sort', 'Name, category, owner, date', 'Filter, group, total, chart', 'Source, target, schedule, format'], answer: 0, explain: 'The type is what you list, the criteria decide which records make it, the output is the columns, and the sort is the order.' },
        { text: 'You add another line joined with AND. What happens to the list?', options: ['It stays the same or gets smaller', 'It gets bigger', 'It resets', 'It becomes static'], answer: 0, explain: 'Every line joined with and has to be true, so each one you add keeps the list the same or shrinks it.' },
        { text: 'You add a line joined with OR. What happens to the list?', options: ['It stays the same or gets bigger', 'It gets smaller', 'It resets', 'It sorts by name'], answer: 0, explain: 'A record makes the list if any one of the lines is true.' },
        { text: 'You mix AND with OR. What do you do?', options: ['Put parentheses around the lines that go together, then read the criteria back as a sentence', 'Run it and trust the count', 'Split it into two exports', 'Change the query type'], answer: 0, explain: 'Without parentheses the query can mean something else, and the count jumps.' },
        { text: 'In a gift query, each row is:', options: ['One gift', 'One partner', 'One fund', 'One day'], answer: 0, explain: 'In a gift query a partner with three gifts comes back as three rows. In a constituent query each row is one person or organization.' },
        { text: 'Why is "gift date not between January 1 and September 30" a poor way to find partners who have not given this year?', options: ['Each gift is checked separately, so a partner with an older gift outside the range still lands on the list', 'It is too slow', 'It only works for churches', 'It counts pledges'], answer: 0, explain: 'A merge query with the sub operator fixes it: keep everyone in query 1 who is not in query 2.' },
        { text: 'Merge queries are always:', options: ['Static', 'Dynamic', 'Hidden', 'Read only for everyone'], answer: 0, explain: 'Save a merge query again whenever you want fresh results.' },
      ]),
    ],
  },
  {
    key: 'work-center',
    slug: 'work-center',
    title: 'The Work Center',
    summary: 'Find your list, enter the week from the tracking sheet, thank gifts, open a partner, plan calls and prepare for each call.',
    audience: 'RDDs, Partner Care, Support Team, Church Engagement',
    color: 'leaf',
    lessons: [
      article('work-center', 'Work Center'),
      article('my-partners-and-reminders', 'My partners, reminders and the morning email'),
      article('partner-page', 'Partner'),
      quiz('Check what you learned', [
        { text: 'Who lands on their own list when they open the Work Center?', options: ['Regional directors and Partner Care', 'Only FavorOS admins', 'Everyone sees every list at once', 'The Support Team'], answer: 0, explain: 'Support picks a director from the list at the top.' },
        { text: 'A row from the tracking sheet is already in Blackbaud. What does Entry do with it?', options: ['It locks the row, so nothing goes in twice', 'It adds it again', 'It deletes it from the sheet', 'It moves it to another director'], answer: 0, explain: 'A row that is already in Blackbaud is locked.' },
        { text: 'What does Save thank-you record?', options: ['One completed contact in your name, and it closes the thank-you task if there is one', 'A draft you finish later', 'A letter sent to the partner', 'A gift'], answer: 0, explain: 'Nothing goes in twice.' },
        { text: 'How long does Undo work after a change?', options: ['24 hours', '10 minutes', 'Until you sign out', 'One week'], answer: 0, explain: 'The message at the bottom has Undo, and it works for 24 hours.' },
        { text: 'In what order does Call prep walk you through a call?', options: ['Thank, Pray, Report, Ask, Thank, Pray', 'Ask, Thank, Pray, Report', 'Pray, Ask, Report, Thank', 'Greet, Ask, Close'], answer: 0, explain: 'The left side walks you through the call step by step. The right side has the do-not-call flags, their giving and the last three contacts.' },
        { text: 'Plan calls adds tasks for the partners you ticked. How many tasks does each partner get?', options: ['One phone call task in Blackbaud', 'One for every week', 'One email and one call', 'None until you approve each'], answer: 0, explain: 'The calls are spread across the weekdays, biggest givers first, and Undo is there if you change your mind.' },
      ]),
    ],
  },
  {
    key: 'rdd-actions',
    slug: 'rdd-actions',
    title: 'RDDs: actions and foundations',
    summary: 'Enter every call, text, email and meeting as an RDD Action with the custom fields the weekly report uses, and check a foundation before you call.',
    audience: 'RDDs',
    color: 'terra',
    lessons: [
      video('entering-an-rdd-action'),
      article('foundation-prospects', 'Foundation prospects'),
      quiz('Check what you learned', [
        { text: 'Which action type counts in the weekly report?', options: ['RDD Action', 'Phone call', 'Task', 'Grants Action'], answer: 0, explain: 'Only RDD actions show up in the weekly report.' },
        { text: 'Under which category does a text message go?', options: ['Email', 'Phone call', 'Meeting', 'Mail'], answer: 0, explain: 'A text message goes under email. A phone call goes under phone call.' },
        { text: 'The call already happened. What status do you set?', options: ['Completed', 'Pending', 'Open', 'Cancelled'], answer: 0, explain: 'Set the status to completed, then assign it to the RDD who made the call.' },
        { text: 'When must your actions be entered?', options: ['By Wednesday morning, because the report is pulled at midday', 'By Friday at noon', 'At the end of each month', 'Before each call'], answer: 0, explain: 'Get your actions in by every Wednesday morning.' },
        { text: 'Why do the custom fields matter?', options: ['The reports are built from them', 'They are optional notes', 'They change the partner’s code', 'They notify the partner'], answer: 0, explain: 'If the RDD asked for money, add amount of ask. If the RDD thanked the partner, add thanked.' },
        { text: 'Before you call a foundation, you should:', options: ['Search Foundation prospects, which checks our list and every organization in Blackbaud', 'Call and ask who talked to them', 'Check the KPI dashboard', 'Ask in the WhatsApp group'], answer: 0, explain: 'If someone already has the relationship, you see it right there.' },
        tf('Logging a contact in Foundation prospects means you also type it again in Blackbaud.', false, 'It posts to Blackbaud as an RDD action. You do not type it twice.'),
      ]),
    ],
  },
  {
    key: 'partner-care-gifts',
    slug: 'partner-care-gifts',
    title: 'Partner Care: gifts and thank-yous',
    summary: 'Take a card gift by phone and print the thank-you receipts, then mark the batch thanked.',
    audience: 'Partner Care, Admin desk',
    color: 'teal',
    lessons: [
      video('taking-a-gift-by-phone'),
      article('thank-you-receipts', 'Receipts'),
      quiz('Check what you learned', [
        { text: 'Where do you enter a card gift a partner gives by phone?', options: ['On the partner’s record, under Giving History, with Add Gift', 'On the request board', 'In a batch with the checks', 'In Paycom'], answer: 0, explain: 'You do not need an email.' },
        { text: 'Which button finishes the card payment?', options: ['Finish and Pay', 'Save and Close', 'Mark as thanked', 'Submit for approval'], answer: 0, explain: 'Then pick the fund, add the appeal if you know it, and click Save.' },
        { text: 'What paper and size do you print receipts on?', options: ['Legal paper, at Actual size, on one side', 'Letter paper, scaled to fit, both sides', 'Legal paper, scaled to fit', 'Letter paper, actual size, one side'], answer: 0, explain: 'Check the proof first. It shows every letter on a picture of the receipt paper.' },
        { text: 'When are receipts printed?', options: ['Every Tuesday and Friday', 'Every day', 'The first of the month', 'Whenever a gift arrives'], answer: 0, explain: 'We print every Tuesday and Friday.' },
        { text: 'What does the Held back tab show?', options: ['Gifts that will not get a letter, with the reason, such as a missing address or Do Not Mail', 'Gifts waiting for approval', 'Letters already printed', 'Gifts from foundations'], answer: 0, explain: 'A letter you uncheck stays on the list for next time.' },
        { text: 'After the letters print, you click Mark as thanked. What happens?', options: ['Blackbaud updates and those gifts come off the list', 'The letters print again', 'The partners are emailed', 'Nothing until the next day'], answer: 0, explain: 'That is why gifts never print twice.' },
      ]),
    ],
  },
  {
    key: 'grants-records',
    slug: 'grants-records',
    title: 'Grants: actions and awards',
    summary: 'Log every conversation with a funder as a Grants Action and record an award so the dashboard counts it.',
    audience: 'Grants',
    color: 'dusk',
    lessons: [
      video('logging-a-grants-action'),
      video('recording-a-grant-award'),
      quiz('Check what you learned', [
        { text: 'Which three things must an award have for the dashboard to count it?', options: ['Purpose Grant Request, a status that starts with Awarded, and an Expected amount', 'A gift, a pledge and a receipt', 'A PDF, a date and a fund', 'A letter, a contact and a campaign'], answer: 0, explain: 'If one of those is missing, the award does not show up.' },
        { text: 'A foundation says yes and the money is still coming. Which status?', options: ['Awarded - Active', 'Awarded - Closed', 'Pending', 'Solicited'], answer: 0, explain: 'Switch to Awarded - Closed when the last payment comes in.' },
        { text: 'What goes in the Funded amount field when you record an award?', options: ['Nothing, it is for money already received', 'The award amount', 'The first payment', 'The foundation’s total giving'], answer: 0, explain: 'Put the award in Expected amount.' },
        tf('A second award from the same foundation goes in the same opportunity.', false, 'One opportunity per award.'),
        { text: 'Which category do you pick for a call with a funder when you log a Grants Action?', options: ['Phone call', 'Email', 'Mail', 'Meeting'], answer: 0, explain: 'An email goes under Email and a letter under Mail. The type is Grants Action every time.' },
        { text: 'How soon should you log a conversation with a funder?', options: ['Within a day or two, while it is fresh', 'At the end of the quarter', 'Only if there is a next step', 'Before the call'], answer: 0, explain: 'Write it so whoever talks to them next knows where things stand.' },
        { text: 'How often does the dashboard pick up changes from Raiser’s Edge?', options: ['Twice a day, at 5 in the morning and 5 in the evening', 'Every minute', 'Once a week', 'Only when you ask'], answer: 0, explain: 'After the next update, the Grants tab shows the new award.' },
      ]),
    ],
  },
  {
    key: 'marketing-receipts',
    slug: 'marketing-receipts',
    title: 'Marketing: requests, receipts and reports',
    summary: 'How work reaches Marketing, how thank-you receipts print, and how to get a list from FavorOS as a CSV or a Google Sheet.',
    audience: 'Marketing',
    color: 'slate',
    lessons: [
      article('make-a-request', 'Make a request'),
      article('thank-you-receipts', 'Receipts'),
      article('reports', 'Reports'),
      article('lists-and-downloads', 'Lists, downloads and Google Sheets'),
      quiz('Check what you learned', [
        { text: 'Which kinds of request go to the Marketing team?', options: ['Design, print, social and video work', 'Website and app changes', 'Blackbaud lists', 'Purchases'], answer: 0, explain: 'Website, app and Blackbaud work goes on the request board. Purchases go on an expense request.' },
        { text: 'Receipts print on which days?', options: ['Tuesday and Friday', 'Monday and Thursday', 'Every day', 'The first Monday of the month'], answer: 0, explain: 'Make the print file, print it, then mark the gifts thanked.' },
        { text: 'You need a long list from FavorOS in a spreadsheet. What can you do?', options: ['Download it as a CSV or open it as a private Google Sheet in your own Drive', 'Ask the technology team for a file', 'Copy it by hand', 'Print it'], answer: 0, explain: 'Long answers come back as a table you can sort, filter and copy.' },
        tf('A letter you uncheck on the receipts page is gone for good.', false, 'It stays on the list next time.'),
      ]),
    ],
  },
  {
    key: 'admin-desk',
    slug: 'admin-desk',
    title: 'Admin desk: gifts, receipts and statements',
    summary: 'The front desk work in Blackbaud and FavorOS: a gift by phone, mail gifts in a batch, thank-you receipts and giving statements.',
    audience: 'Admin desk',
    color: 'slate',
    lessons: [
      video('taking-a-gift-by-phone'),
      page(
        'Gifts at the front desk',
        [
          '- **A card gift by phone** goes in with **Add Gift** on the partner’s record, under Giving History. You do not need an email.',
          '- **Checks from the mail** go in as a batch. A second person approves the batch, never the person who entered it.',
          '- **Search before you add** anyone, so you never create a duplicate record.',
          'If a record looks wrong, tell the Blackbaud administrator. Do not fix it yourself.',
        ].join('\n\n')
      ),
      article('thank-you-receipts', 'Receipts'),
      article('giving-statements', 'Giving statements'),
      article('expense-request', 'Send an expense request'),
      quiz('Check what you learned', [
        { text: 'A partner phones to give by card. Where do you enter the gift?', options: ['On the partner’s record with Add Gift', 'In a mail batch', 'On the request board', 'In Paycom'], answer: 0, explain: 'You never needed an email.' },
        { text: 'Who approves a gift batch?', options: ['A different person than the one who entered it', 'The person who entered it', 'The partner', 'Nobody'], answer: 0, explain: 'Checks from the mail go in as a batch, and a second person approves it.' },
        { text: 'When do you send an expense request?', options: ['Before the purchase or trip', 'After the purchase', 'At month end', 'Only for travel over 40 miles'], answer: 0, explain: 'The request gets a document number that starts with EXP, and the approver signs online.' },
        { text: 'You print receipts on legal paper. At what size?', options: ['Actual size, one side', 'Fit to page, both sides', 'Half size', 'Any size'], answer: 0, explain: 'Open the proof first to see that every letter lines up.' },
      ]),
    ],
  },
];

interface SeedPath {
  key: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  courses: string[];
}

export const PATHS: SeedPath[] = [
  { key: 'new-hire-favor', slug: 'new-hire-favor', title: 'New hire: Favor', summary: 'Who Favor is, the words staff use, how the team works together, and your first week in Blackbaud.', audience: 'New staff', color: 'leaf', courses: ['favor-who-we-are', 'blackbaud-first-week'] },
  { key: 'new-hire-favoros', slug: 'new-hire-favoros', title: 'New hire: FavorOS', summary: 'Sign in, read Today, make requests and expense requests, record clips and ask Favor Brain.', audience: 'New staff', color: 'sky', courses: ['favoros-basics', 'requests-and-clips', 'favor-brain'] },
  { key: 'rdd', slug: 'rdd', title: 'RDD', summary: 'Blackbaud, the Work Center, RDD actions and queries for Regional Development Directors.', audience: 'RDDs', color: 'terra', courses: ['blackbaud-first-week', 'work-center', 'rdd-actions', 'blackbaud-queries'] },
  { key: 'partner-care', slug: 'partner-care', title: 'Partner Care', summary: 'Blackbaud, the Work Center, gifts by phone and thank-you receipts.', audience: 'Partner Care', color: 'teal', courses: ['blackbaud-first-week', 'work-center', 'partner-care-gifts'] },
  { key: 'support-team', slug: 'support-team', title: 'Support Team', summary: 'Blackbaud, the Work Center and queries for the Support Team.', audience: 'Support Team', color: 'leaf', courses: ['blackbaud-first-week', 'work-center', 'blackbaud-queries'] },
  { key: 'church-engagement', slug: 'church-engagement', title: 'Church Engagement', summary: 'Blackbaud, the Work Center and queries for Church Engagement.', audience: 'Church Engagement', color: 'leaf', courses: ['blackbaud-first-week', 'work-center', 'blackbaud-queries'] },
  { key: 'grants', slug: 'grants', title: 'Grants', summary: 'Blackbaud, grants actions and awards, and queries.', audience: 'Grants', color: 'dusk', courses: ['blackbaud-first-week', 'grants-records', 'blackbaud-queries'] },
  { key: 'marketing', slug: 'marketing', title: 'Marketing', summary: 'Blackbaud, queries, requests, receipts and reports.', audience: 'Marketing', color: 'slate', courses: ['blackbaud-first-week', 'blackbaud-queries', 'marketing-receipts'] },
  { key: 'admin-desk', slug: 'admin-desk', title: 'Admin desk', summary: 'Blackbaud and the front desk work: gifts, receipts and statements.', audience: 'Admin desk', color: 'slate', courses: ['blackbaud-first-week', 'admin-desk'] },
];

/** Writes every starter course and path that is not there yet. Safe to run twice and from two requests at once. */
export async function writeSeed(env: Env, by = 'learn'): Promise<{ courses: number; paths: number }> {
  const now = nowIso();
  const ids = new Map<string, string>();
  let courses = 0;
  let paths = 0;
  for (const c of COURSES) {
    const cid = id('crs');
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO learn_courses (id, slug, title, summary, audience, color, status, seed_key, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`
    )
      .bind(cid, c.slug, c.title, c.summary, c.audience, c.color, `course:${c.key}`, by, now, by, now)
      .run();
    const row = await env.DB.prepare('SELECT id FROM learn_courses WHERE seed_key = ?').bind(`course:${c.key}`).first<{ id: string }>();
    if (!row) continue;
    ids.set(c.key, row.id);
    if (!Number((r.meta as { changes?: number }).changes)) continue;
    courses++;
    let sort = 10;
    for (const l of c.lessons) {
      const body = l.kind === 'quiz' ? JSON.stringify({ pass: l.quiz!.pass, questions: l.quiz!.questions.map((q, i) => ({ id: `q${i + 1}`, kind: q.kind || 'choice', text: q.text, options: q.kind === 'tf' ? ['True', 'False'] : q.options || [], answer: q.answer, explain: q.explain })) }) : l.body || '';
      const ref = l.ref || '';
      const title = l.title || (l.kind === 'video' ? videoTitle(ref) : l.kind === 'quiz' ? 'Quiz' : '');
      await env.DB.prepare('INSERT INTO learn_lessons (id, course_id, sort, kind, title, ref, body, minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id('les'), row.id, sort, l.kind, title, ref, body, l.minutes || minutesFor(l.kind, ref, body), now, now)
        .run();
      sort += 10;
    }
  }
  for (const p of PATHS) {
    const pid = id('pth');
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO learn_paths (id, slug, title, summary, audience, color, status, seed_key, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`
    )
      .bind(pid, p.slug, p.title, p.summary, p.audience, p.color, `path:${p.key}`, by, now, by, now)
      .run();
    const row = await env.DB.prepare('SELECT id FROM learn_paths WHERE seed_key = ?').bind(`path:${p.key}`).first<{ id: string }>();
    if (!row || !Number((r.meta as { changes?: number }).changes)) continue;
    paths++;
    let sort = 10;
    for (const key of p.courses) {
      const cid = ids.get(key);
      if (!cid) continue;
      await env.DB.prepare('INSERT OR IGNORE INTO learn_path_courses (path_id, course_id, sort) VALUES (?, ?, ?)').bind(row.id, cid, sort).run();
      sort += 10;
    }
  }
  return { courses, paths };
}

const videoTitle = (ref: string) => videoBySlug(ref)?.title || ref;

/** Called when Learn opens. Writes the starter content once; a version bump writes only what is new. */
export async function ensureSeed(env: Env): Promise<void> {
  const seen = await hubGet(env, SEED_KEY).catch(() => null);
  if (seen?.value === SEED_VERSION) return;
  await writeSeed(env);
  await hubPut(env, SEED_KEY, SEED_VERSION, 'learn').catch(() => undefined);
}
