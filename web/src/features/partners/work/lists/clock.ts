// The 24-hour thank-you clock, drawn from the due time the server sends (functions/_lib/work/thank-clock.ts has the same words):
// { label: 'Due in 6 h' | 'Due today' | 'Overdue 5 h' ..., late: true once the time is past }.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const etDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string, nowMs: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + (String(y) !== etDay(nowMs).slice(0, 4) ? ', ' + y : '');
};

export interface ClockWords {
  label: string;
  late: boolean;
  soon?: boolean;
}

/** nowMs is the time to count from (the page passes its minute clock; 0 before the browser has set one). */
export function clockWords(due: string | null | undefined, nowMs: number): ClockWords {
  const t = Date.parse(due || '');
  if (!t || !nowMs) return { label: '', late: false };
  const mins = Math.round((t - nowMs) / 60000);
  if (mins <= 0) {
    const h = Math.floor(-mins / 60);
    return { label: h < 1 ? 'Overdue' : h < 24 ? 'Overdue ' + h + ' h' : 'Overdue ' + Math.floor(h / 24) + 'd', late: true };
  }
  const dd = etDay(t);
  const td = etDay(nowMs);
  const days = Math.round((Date.parse(dd + 'T12:00:00Z') - Date.parse(td + 'T12:00:00Z')) / 86400000);
  let label: string;
  if (mins < 60) label = 'Due in ' + mins + ' min';
  else if (days === 0) label = mins <= 720 ? 'Due in ' + Math.round(mins / 60) + ' h' : 'Due today';
  else if (mins <= 480) label = 'Due in ' + Math.round(mins / 60) + ' h';
  else if (days === 1) label = 'Due tomorrow';
  else label = days < 7 ? 'Due ' + WD[new Date(dd + 'T12:00:00Z').getUTCDay()] : 'Due ' + short(dd, nowMs);
  return { label, late: false, soon: mins <= 360 };
}
