// The help docs' topics, in the order they show, and the video topics for the video library.
export const TOPICS: Array<{ id: string; label: string; blurb: string }> = [
  { id: 'start', label: 'Getting started', blurb: 'Signing in, Today, the menu and search' },
  { id: 'work', label: 'Requests and expenses', blurb: 'Asking for work, the request board, expense requests' },
  { id: 'partners', label: 'Receipts and foundations', blurb: 'Thank-you receipts and foundation prospects' },
  { id: 'numbers', label: 'The KPI dashboard', blurb: 'Reading the dashboard and how each number is counted' },
  { id: 'ask', label: 'Ask Favor (beta)', blurb: 'Connecting Claude or ChatGPT and asking well' },
  { id: 'blackbaud', label: 'Blackbaud', blurb: 'Raiser\'s Edge NXT training on video' },
  { id: 'help', label: 'Help and feedback', blurb: 'The tour, feedback, and what to do when something looks wrong' },
];

export const VIDEO_TOPICS: Record<string, string> = {
  hub: 'The hub',
  brain: 'Ask Favor',
  blackbaud: 'Blackbaud',
  grants: 'Grants',
  rdd: 'RDDs',
  'partner-care': 'Partner Care',
};

export const ROLE_LABELS: Record<string, string> = {
  all: 'Everyone',
  rdd: 'RDDs',
  pc: 'Partner Care',
  ce: 'Church Engagement',
  grants: 'Grants',
  marketing: 'Marketing',
  'admin-desk': 'Front desk',
  admin: 'Hub admin',
  approver: 'Expense approvers',
  kpi: 'Dashboard users',
  leader: 'Leadership',
};

export const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
