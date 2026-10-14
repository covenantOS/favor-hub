// Labels and pictures for the changelog page (/changelog). Day files live in src/content/changelog.
import shots from './changelog-shots.json';

export const AREA_LABEL: Record<string, string> = {
  today: 'Today', partners: 'Partners', 'work-center': 'Work Center', requests: 'Requests', projects: 'Projects', expenses: 'Expenses',
  receipts: 'Receipts', gifts: 'Gifts', statements: 'Statements', evaluations: 'Evaluations', learn: 'Learn', onboarding: 'Onboarding',
  foundations: 'Foundations', meetings: 'Meetings', clips: 'Clips', chat: 'Chat', mail: 'Mail', brain: 'Favor Brain', reporting: 'Reporting',
  lists: 'Lists', admin: 'Admin', help: 'Help', phone: 'Phone and Lite', everywhere: 'All of FavorOS',
};

export const TYPE_LABEL: Record<string, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

/** Today's view of each area: a current screenshot in public/changelog/now/ (desktop and phone), shown on an entry with no picture of its own. */
export const AREA_SHOT = shots as Record<string, { desk: string; phone?: string }>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
