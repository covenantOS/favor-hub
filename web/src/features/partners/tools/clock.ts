// The 24-hour thank-you clock, drawn from the due time the server sends (functions/_lib/work/thank-clock.ts has the same words):
// 'Due in 6 h', 'Due today', 'Overdue 5 h' and so on.
import { fd } from '../record/lib';

const etDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function clock(due: string | undefined): { label: string; late: boolean; soon?: boolean } {
  const t = Date.parse(due || '');
  if (!t) return { label: '', late: false };
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) {
    const h = Math.floor(-mins / 60);
    return { label: h < 1 ? 'Overdue' : h < 24 ? 'Overdue ' + h + ' h' : 'Overdue ' + Math.floor(h / 24) + 'd', late: true };
  }
  const dd = etDay(t);
  const td = etDay(Date.now());
  const days = Math.round((Date.parse(dd + 'T12:00:00Z') - Date.parse(td + 'T12:00:00Z')) / 86400000);
  let label: string;
  if (mins < 60) label = 'Due in ' + mins + ' min';
  else if (days === 0) label = mins <= 720 ? 'Due in ' + Math.round(mins / 60) + ' h' : 'Due today';
  else if (mins <= 480) label = 'Due in ' + Math.round(mins / 60) + ' h';
  else if (days === 1) label = 'Due tomorrow';
  else label = days < 7 ? 'Due ' + WD[new Date(dd + 'T12:00:00Z').getUTCDay()] : 'Due ' + fd(dd);
  return { label, late: false, soon: mins <= 360 };
}
export const clockLabel = (due: string | undefined): string => clock(due).label;
