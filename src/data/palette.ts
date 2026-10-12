// Everything Ctrl K lists without asking the server: the hub's pages, tools, links and help. The classic palette (CommandPalette.astro)
// and the React app (served as /palette.json) both read this, so the two lists stay the same.
import { paletteItems, AREAS } from './areas';

export interface PaletteHelp { title: string; summary: string; id: string; topic: string; body: string }
export interface PaletteVideo { title: string; summary: string; slug: string; topic: string }

export function buildPaletteItems(docs: PaletteHelp[], videos: PaletteVideo[]) {
  const helpItems = [
    ...docs.map((d) => ({ title: d.title, desc: d.summary, href: `/help/${d.id}/`, tags: `help how ${d.topic} ${(d.body || '').match(/^##+ .+$/gm)?.join(' ') || ''}`.toLowerCase(), external: false, group: 'Help', searchOnly: true })),
    ...videos.map((v) => ({ title: `Video: ${v.title}`, desc: v.summary, href: `/help/videos/${v.slug}/`, tags: `video training ${v.topic} ${v.summary}`.toLowerCase(), external: false, group: 'Help', searchOnly: true })),
  ];
  const hubHrefs = new Set(AREAS.flatMap((a) => a.pages.filter((x) => !x.ext).map((x) => x.href)));
  const more = [
    { title: 'Expand or collapse the menu', desc: 'Menu · Switch between the slim rail and the full sidebar (press the backslash key)', href: '#nav-toggle', tags: 'menu sidebar expand collapse rail wide narrow nav navigation', external: false, group: 'Menu', need: '', team: '' },
  ];
  const manual = [
    { title: 'Help docs', desc: 'How every tool works, with search', href: '/help/', tags: 'help guide how docs documentation article manual faq', external: false, group: 'Tools' },
    { title: "Take the tour", desc: "A guided tour of FavorOS, set up for your work, and what's new", href: '/?tour=1', tags: 'tour help new welcome show me around walkthrough guide whats new', external: false, group: 'Tools' },
    { title: 'Training videos', desc: 'FavorOS, Favor Brain and Blackbaud on video, with captions', href: '/help/videos/', tags: 'video videos training tutorial learn blackbaud raisers edge', external: false, group: 'Tools' },
    { title: 'Feedback', desc: "Your notes and Will's answers", href: '/feedback/', tags: 'feedback note bug wrong idea suggestion problem report', external: false, group: 'Tools' },
    { title: 'Favor Brain (beta)', desc: 'Ask about partners, giving and the manuals, or connect Claude or ChatGPT', href: '/brain/', tags: 'brain ask favor ai claude chatgpt mcp connector question query beta', external: false, group: 'Tools' },
    { title: 'Make a request', desc: "Anything you need: goes to the request board or the Marketing team", href: '/requests/new', tags: 'website portal dashboard app request submit comment recommendation marketing design flyer social video newsletter asana project', external: false, group: 'Tools' },
    { title: 'Request board', desc: 'Inbox, approved, in motion, done', href: '/requests', tags: 'website portal dashboard app request kanban board review approve', external: false, group: 'Tools' },
    { title: 'Blackbaud', desc: 'Partner records', href: 'https://app.blackbaud.com/signin/?redirectUrl=https://app.blackbaud.com/', tags: 'crm donors blackbaud raisers edge', external: true, group: 'Tools' },
    { title: 'Work Center', desc: 'Select many actions and finish them together, enter the week’s contacts, thank-yous', href: '/work/', tags: 'work center bulk select mark complete actions thank you entry tracking sheet stale reassign reschedule support', external: false, group: 'Tools', searchOnly: true },
    { title: 'Find a partner', desc: 'Contact details, giving, actions and notes for any partner', href: '/work/partner/', tags: 'partner partners find lookup constituent donor giving history contact record search iwave', external: false, group: 'Tools', searchOnly: true },
    { title: 'Clips', desc: 'Your recorded clips, searchable by what was said', href: '/clips/', tags: 'clips clip loom screen record recording video walkthrough share link transcript', external: false, group: 'Tools', searchOnly: true },
    { title: 'Foundation prospects', desc: 'Check a foundation, log a contact', href: '/foundations/', tags: 'foundation foundations prospect grant rdd blackbaud unsolicited contact call', external: false, group: 'Tools' },
    { title: 'Thank-you receipts', desc: 'Print the receipts Blackbaud has waiting', href: '/receipts/', tags: 'thank you receipt receipts ty acknowledgement acknowledge print mail indesign partner', external: false, group: 'Tools' },
    { title: 'Lists', desc: 'Build a list of partners or gifts from menus and open it in Google Sheets', href: '/lists/', tags: 'lists list builder partners gifts lybunt lapsed active major acquisition holder state zip fund appeal mailing export csv sheets saved', external: false, group: 'Reports' },
    { title: 'Reports', desc: 'Daily revenue, lists and yearly reports, with CSV and Google Sheets', href: '/reports/', tags: 'reports report blackbaud query queries daily revenue ytd income lybunt lapsed mailing list export csv sheets tax receipts 5000 prayer', external: false, group: 'Reports' },
    { title: 'Marketing materials', desc: 'Live materials catalog', href: 'https://docs.google.com/spreadsheets/d/1voiT9f4oixPz0cRAJrQTyik-PqCwP3hGGhC-br1PjOU/edit?usp=sharing', tags: 'marketing materials sheet catalog', external: true, group: 'Tools' },
    { title: 'Marketing request', desc: 'Starts at Make a request, which opens the Marketing form', href: '/requests/new', tags: 'marketing project asana request brief design', external: false, group: 'Tools' },
    { title: 'KPI dashboard', desc: "The year's numbers and your team's tab", href: '/dashboard/', tags: 'kpi dashboard revenue goals rdd teams grants partner care church engagement marketing executive', external: false, group: 'Reports' },
    { title: 'Time off', desc: 'Submit PTO via Paycom', href: 'https://phx.us-west.paycomonline.net/v4/ee/web.php/accruals/time-off', tags: 'pto vacation time off accruals paycom', external: true, group: 'Tools' },
    { title: 'Time sheet', desc: 'Paycom punch in and out', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', tags: 'paycom timesheet punch clock in out', external: true, group: 'Tools' },
    { title: 'Paycom expenses', desc: 'Cards and expense reports in Paycom', href: 'https://www.paycomonline.net/v4/ee/web.php/app/login', tags: 'paycom expenses cards reimbursement', external: true, group: 'Tools' },
    { title: 'Expense request', desc: 'Expenses and purchases, signed online. Not Paycom', href: '/expenses/new', tags: 'expense request travel pre-travel approval signature', group: 'Tools' },
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
  const items = [...paletteItems(), ...more, ...manual.filter((i) => i.external || !hubHrefs.has(i.href)).map((i) => ({ need: '', team: '', ...i }))];
  return items;
}
