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
  { id: 'people', href: '/admin/people/', label: 'People and roles', desc: 'Who signs in, their role, team, fundraiser link and Work Center access, with an act as preview.', live: true, card: true },
  { id: 'work', href: '/admin/work-center/', label: 'Work Center', desc: 'Daily Blackbaud calls, morning email start dates, where each role starts, tags and cadence rules.', live: true, card: true, tab: true },
  { id: 'meetings', href: '/admin/meetings/', label: 'Meetings', desc: 'Who can use them, guests, meeting size, the recording folder and the reminder lead time.', live: true, card: true, tab: true },
  { id: 'brain', href: '/admin/brain/', label: 'Favor Brain', desc: 'Access requests, the connect prompt, iWave caps, automatic titles and the question log.', count: 'brainRequests', live: true, card: true, tab: true },
  { id: 'clips', href: '/admin/clips/', label: 'Clips', desc: 'Storage, longest recording, sharing default and who can record.', live: true, card: true, tab: true },
  { id: 'reports', href: '/admin/reports/', label: 'Reports', desc: 'Which roles see each report.', live: true, card: true, tab: true },
  { id: 'expenses', href: '/admin/expenses/', label: 'Expenses', desc: 'Approvers, substitutes, who can open the log and the mileage rate.', count: 'expensesWaiting', live: true, card: true, tab: true },
  { id: 'receipts', href: '/admin/receipts/', label: 'Thank-you receipts', desc: 'The letter window and the morning email line.', live: true, card: true, tab: true },
  { id: 'feedback', href: '/feedback/', label: 'Feedback triage', desc: 'Notes from staff and the answers.', count: 'feedback', live: true, card: true, tab: true },
  { id: 'audit', href: '/admin/audit/', label: 'Audit log', desc: 'Every settings change with who, when, before and after.', live: true, card: true },
];
