// The pages of the Admin area, in the order of the tab row. `live` turns a page on in the tab row and on the overview;
// a page ships with its tests, then its flag goes to true.
export interface AdminPage {
  id: string;
  href: string;
  label: string;
  desc: string;
  /** A key of the counts /api/hub/nav answers, shown as "N waiting". */
  count?: string;
  live: boolean;
  /** The overview lists it under Settings. */
  card: boolean;
  /** One of the settings pages that share the in-page tab row. */
  tab?: boolean;
}

export const ADMIN_PAGES: AdminPage[] = [
  { id: 'overview', href: '/admin/', label: 'Overview', desc: 'Health and recent changes.', live: true, card: false },
  { id: 'people', href: '/admin/people/', label: 'People and roles', desc: 'Sign-in, roles, teams, fundraiser links, Work Center access.', live: true, card: true },
  { id: 'work', href: '/admin/work-center/', label: 'Work Center', desc: 'Blackbaud call cap, morning email dates, start pages, tags, cadence.', live: true, card: true, tab: true },
  { id: 'meetings', href: '/admin/meetings/', label: 'Meetings', desc: 'Access, guests, meeting size, recording folder, reminder time.', live: true, card: true, tab: true },
  { id: 'brain', href: '/admin/brain/', label: 'Favor Brain', desc: 'Access requests, connect prompt, iWave caps, titles, question log.', count: 'brainRequests', live: true, card: true, tab: true },
  { id: 'clips', href: '/admin/clips/', label: 'Clips', desc: 'Storage, longest recording, sharing default, who can record.', live: true, card: true, tab: true },
  { id: 'reports', href: '/admin/reports/', label: 'Reports', desc: 'Which roles see each report.', live: true, card: true, tab: true },
  { id: 'expenses', href: '/admin/expenses/', label: 'Expenses', desc: 'Approvers, substitutes, log access, mileage rate.', count: 'expensesWaiting', live: true, card: true, tab: true },
  { id: 'chat', href: '/admin/chat/', label: 'Chat', desc: 'Who can use Chat.', live: true, card: true, tab: true },
  { id: 'projects', href: '/admin/projects/', label: 'Projects', desc: 'Who can use Projects, the Asana import, Marketing requests.', live: true, card: true, tab: true },
  { id: 'receipts', href: '/admin/receipts/', label: 'Receipts', desc: 'Receipt window, morning email line.', live: true, card: true, tab: true },
  { id: 'statements', href: '/admin/statements/', label: 'Giving statements', desc: 'Statement wording, print file size, copy folder, email switch.', live: true, card: true, tab: true },
  { id: 'feedback', href: '/feedback/', label: 'Feedback triage', desc: 'Staff notes and answers.', count: 'feedback', live: true, card: true, tab: true },
  { id: 'appeals', href: '/admin/appeal-codes/', label: 'Appeal codes', desc: 'Build appeal codes and create them in Blackbaud.', live: true, card: true },
  { id: 'bbusers', href: '/admin/blackbaud-users/', label: 'Blackbaud users', desc: 'Blackbaud logins, status, product access.', live: true, card: true },
  { id: 'tours', href: '/admin/tours/', label: 'Tours', desc: 'Who finished the tour and each release. Send again.', live: true, card: true },
  { id: 'audit', href: '/admin/audit/', label: 'Audit log', desc: 'Settings changes: who, when, before, after.', live: true, card: true },
];
