// Everything Ctrl K lists without asking the server: the hub's pages, tools, links and help. The classic palette (CommandPalette.astro)
// and the React app (served as /palette.json) both read this, so the two lists stay the same.
import { paletteItems, AREAS } from './areas';

export interface PaletteHelp { title: string; summary: string; id: string; topic: string; body: string }

export function buildPaletteItems(docs: PaletteHelp[]) {
  const helpItems = [
    ...docs.map((d) => ({ title: d.title, desc: d.summary, href: `/help/${d.id}/`, tags: `help how ${d.topic} ${(d.body || '').match(/^##+ .+$/gm)?.join(' ') || ''}`.toLowerCase(), external: false, group: 'Help', searchOnly: true })),
  ];
  const slash = (h: string) => h.replace(/\/$/, '') || '/';
  const hubHrefs = new Set(AREAS.flatMap((a) => a.pages.filter((x) => !x.ext).map((x) => slash(x.href))));
  // Things to do, not pages to read: Ctrl K lists them right after Your pages.
  const actions = [
    { title: 'Start a deposit', desc: 'Gifts › Gift entry · Count and tape the mail, then photograph each check', href: '/gift-entry/?start=1', tags: 'start deposit gift entry mail check checks tape photograph new deposit', external: false, group: 'Actions', need: 'giftEntry', team: '' },
    { title: 'Add an other gift', desc: 'Gifts › Other gifts · A DAF, foundation, wire, stock or phone gift with its soft credit', href: '/gifts/other/', tags: 'other gift daf foundation wire stock phone soft credit recommended add enter', external: false, group: 'Actions', need: 'otherGifts', team: '' },
    { title: 'Make a request', desc: 'Anything you need: goes to the request board or the Marketing team', href: '/projects/?compose=1', tags: 'make request new website portal dashboard app submit comment recommendation marketing design flyer social video newsletter asana project', external: false, group: 'Actions', need: '', team: '' },
    { title: 'New expense request', desc: 'Staff › Expenses · Expenses and purchases, signed online', href: '/expenses/new/', tags: 'new expense request travel pre-travel approval signature purchase reimbursement', external: false, group: 'Actions', need: '', team: '' },
    { title: 'Log a contact', desc: 'Today · A call, meeting or note on any partner', href: '/?quick=contact', tags: 'log a contact call meeting note partner action blackbaud', external: false, group: 'Actions', need: 'workCenter', team: '' },
    { title: 'Find a partner', desc: 'Partners · Contact details, giving, actions and notes for any partner', href: '/work/partner/', tags: 'partner partners find lookup constituent giving history contact record search', external: false, group: 'Actions', need: 'workCenter', team: '' },
  ];
  const more = [
    { title: 'Expand or collapse the menu', desc: 'Menu · Switch between the slim rail and the full sidebar (press the backslash key)', href: '#nav-toggle', tags: 'menu sidebar expand collapse rail wide narrow nav navigation', external: false, group: 'Menu', need: '', team: '' },
  ];
  const manual = [
    { title: 'Help docs', desc: 'How every tool works, with search', href: '/help/', tags: 'help guide how docs documentation article manual faq', external: false, group: 'Tools' },
    { title: "Take the tour", desc: "A guided tour of FavorOS, set up for your work, and what's new", href: '/?tour=1', tags: 'tour help new welcome show me around walkthrough guide whats new', external: false, group: 'Tools' },
    { title: 'Feedback', desc: "Your notes and Will's answers", href: '/feedback/', tags: 'feedback note bug wrong idea suggestion problem report', external: false, group: 'Tools' },
    { title: 'Favor Brain (beta)', desc: 'Ask about partners, giving and the manuals, or connect Claude or ChatGPT', href: '/brain/', tags: 'brain ask favor ai claude chatgpt mcp connector question query beta', external: false, group: 'Tools' },
    { title: 'Request board', desc: 'Intake, triage, in progress, review, done', href: '/projects/?tab=intake', tags: 'website portal dashboard app request kanban board review approve', external: false, group: 'Tools' },
    { title: 'Blackbaud', desc: 'Partner records', href: 'https://app.blackbaud.com/signin/?redirectUrl=https://app.blackbaud.com/', tags: 'crm donors blackbaud raisers edge', external: true, group: 'Tools' },
    { early: true, title: 'Clips', desc: 'Your recorded clips, searchable by what was said', href: '/clips/', tags: 'clips clip loom screen record recording video walkthrough share link transcript', external: false, group: 'Tools', searchOnly: true },
    { title: 'Foundation prospects', desc: 'Check a foundation, log a contact', href: '/foundations/', tags: 'foundation foundations prospect grant rdd blackbaud unsolicited contact call', external: false, group: 'Tools' },
    { title: 'Thank-you receipts', desc: 'Print the receipts Blackbaud has waiting', href: '/receipts/', tags: 'thank you receipt receipts ty acknowledgement acknowledge print mail indesign partner', external: false, group: 'Tools' },
    { title: 'First-gift letters', desc: 'Print the thank-you letters for first gifts from an acquisition mailing', href: '/gifts/first-gifts/', tags: 'first gift letters acquisition welcome new partner thank you letter database view donor acknowledgement k254 appeal print mark acknowledged', external: false, group: 'Tools' },
    { title: 'Online gifts', desc: "Online gifts with the partner's comment and designation, approved by Partner Care", href: '/online-gifts/', tags: 'online gifts website giving form fundraise up international comment designation fund approve batch partner care', external: false, group: 'Tools' },
    { title: 'Credit and assignments', desc: 'Gift credit, assignments with history, proposed fixes and approval', href: '/lists/credit/', tags: 'credit assignments fundraiser holder gift credit proposal approve approval audit marketing appeal rdd partner care reassign', external: false, group: 'Reports' },
    { title: 'Standard reports', desc: 'Giving, credit, partners and team reports with a drill to the rows', href: '/lists/reports/', tags: 'standard reports giving credit fundraiser portfolio retention first time new lost lybunt lapsed acquisition', external: false, group: 'Reports' },
    { title: 'Lists', desc: 'Build a list of partners or gifts from menus and open it in Google Sheets', href: '/lists/', tags: 'lists list builder partners gifts lybunt lapsed active major acquisition holder state zip fund appeal mailing export csv sheets saved', external: false, group: 'Reports' },
    { title: 'Reports', desc: 'Daily revenue, lists and yearly reports, with CSV and Google Sheets', href: '/reports/', tags: 'reports report blackbaud query queries daily revenue ytd income lybunt lapsed mailing list export csv sheets tax receipts 5000 prayer', external: false, group: 'Reports' },
    { title: 'Marketing materials', desc: 'Live materials catalog', href: 'https://docs.google.com/spreadsheets/d/1voiT9f4oixPz0cRAJrQTyik-PqCwP3hGGhC-br1PjOU/edit?usp=sharing', tags: 'marketing materials sheet catalog', external: true, group: 'Tools' },
    { title: 'Marketing request', desc: 'Starts at Make a request, which opens the Marketing form', href: '/projects/?compose=1', tags: 'marketing project asana request brief design', external: false, group: 'Tools' },
    { title: 'KPI dashboard', desc: "The year's numbers and your team's tab", href: '/dashboard/', tags: 'kpi dashboard revenue goals rdd teams grants partner care church engagement marketing executive', external: false, group: 'Reports' },
    { title: 'Time off', desc: 'Submit PTO via Paycom', href: 'https://phx.us-west.paycomonline.net/v4/ee/web.php/accruals/time-off', tags: 'pto vacation time off accruals paycom', external: true, group: 'Tools' },
    { title: 'Time sheet', desc: 'Paycom punch in and out', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', tags: 'paycom timesheet punch clock in out', external: true, group: 'Tools' },
    { title: 'Paycom expenses', desc: 'Cards and expense reports in Paycom', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', tags: 'paycom expenses cards reimbursement', external: true, group: 'Tools' },
    { title: 'Expense log', desc: 'Statuses, signed PDFs, approver schedule', href: '/expenses', tags: 'expense log approver schedule pdf admin', group: 'Tools' },


    { title: 'favorintl.org', desc: 'Public website', href: 'https://www.favorintl.org', tags: 'website public org', external: true, group: 'External' },
    { title: 'Our Story', desc: 'About Favor International', href: 'https://www.favorintl.org/about/our-story', tags: 'about story history', external: true, group: 'External' },
    { title: 'Founder · Carole Ward', desc: 'Carole Ward profile', href: 'https://www.favorintl.org/about/our-story/founder', tags: 'carole ward founder', external: true, group: 'External' },
    { title: 'Give', desc: 'favorintl.org/donate', href: 'https://www.favorintl.org/donate', tags: 'donate give hold the ropes partner', external: true, group: 'External' },
    { title: 'The Book', desc: '"Send Me Where No One Wants to Go"', href: 'https://www.favorintl.org/books', tags: 'book carole ward send me where no one', external: true, group: 'External' },
    { title: 'YouTube', desc: 'Channel · field updates', href: 'https://www.youtube.com/channel/UCIv8yRH1mO5s_JLzqG5O6Ug', tags: 'youtube videos channel', external: true, group: 'External' },
    { title: 'Facebook', desc: '@FavorIntlOrg', href: 'https://www.facebook.com/FavorIntlOrg', tags: 'facebook social fb', external: true, group: 'External' },
    { title: 'Instagram', desc: '@favorintlorg', href: 'https://www.instagram.com/favorintlorg/', tags: 'instagram ig social', external: true, group: 'External' },
    { title: 'LinkedIn', desc: 'Favor International', href: 'https://www.linkedin.com/company/favor-international/', tags: 'linkedin social', external: true, group: 'External' },
    ...helpItems,
  ];
  const items = [...paletteItems(), ...actions, ...more, ...manual.filter((i) => i.external || !hubHrefs.has(slash(i.href))).map((i) => ({ need: '', team: '', ...i }))];
  return items;
}
