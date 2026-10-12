// The thank-you clock. Every gift is thanked within 24 hours (RDD manual; HQ enters the mail on Monday, Wednesday and Friday). The clock
// starts when Blackbaud has the gift (date_added) and counts weekday hours in Eastern time, so a gift entered at 2 PM on a Friday is due
// at 2 PM on Monday. A gift whose clock ran out more than a day ago is Older: still owed, folded under the newer ones.

const DAY = 86400000;
const HOUR = 3600000;

/** The nth Sunday of a month (UTC date at 0:00), for the US daylight saving rules. */
const nthSunday = (y: number, m: number, n: number): number => {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return Date.UTC(y, m, 1 + ((7 - first) % 7) + 7 * (n - 1));
};
/** Eastern offset from UTC at this moment, in ms: -4 h from the second Sunday of March at 2 AM to the first Sunday of November at 2 AM, else -5 h. */
export function etOffset(ms: number): number {
  if (!Number.isFinite(ms)) return -5 * HOUR;
  const y = new Date(ms).getUTCFullYear();
  const start = nthSunday(y, 2, 2) + 7 * HOUR; // 2 AM EST is 7 AM UTC
  const end = nthSunday(y, 10, 1) + 6 * HOUR; // 2 AM EDT is 6 AM UTC
  return ms >= start && ms < end ? -4 * HOUR : -5 * HOUR;
}

const weekend = (wall: number): boolean => {
  const d = new Date(wall).getUTCDay();
  return d === 0 || d === 6;
};

/** When the thank-you is due: 24 weekday hours after Blackbaud had the gift, Eastern. */
export function thankDue(addedMs: number): number {
  let w = addedMs + etOffset(addedMs);
  while (weekend(w)) w = Math.floor(w / DAY) * DAY + DAY;
  let left = 24 * HOUR;
  for (let i = 0; i < 14; i++) {
    const end = Math.floor(w / DAY) * DAY + DAY;
    if (w + left <= end) {
      w += left;
      break;
    }
    left -= end - w;
    w = end;
    while (weekend(w)) w += DAY;
  }
  return w - etOffset(w - etOffset(addedMs));
}

export type ClockState = 'due' | 'late' | 'older';

export interface Clock {
  /** ISO time the thank-you is due. */
  due: string;
  /** Minutes left; negative once it is overdue. */
  mins: number;
  state: ClockState;
}

export function clockOf(addedMs: number, nowMs: number): Clock {
  if (!Number.isFinite(addedMs)) addedMs = nowMs;
  const due = thankDue(addedMs);
  const mins = Math.round((due - nowMs) / 60000);
  return { due: new Date(due).toISOString(), mins, state: mins > 0 ? 'due' : mins > -24 * 60 ? 'late' : 'older' };
}

const RANK: Record<ClockState, number> = { due: 0, late: 1, older: 2 };
/** The Eastern day a time falls on, as a day number. */
const etDayOf = (ms: number): number => Math.floor((ms + etOffset(ms)) / DAY);

/**
 * The order the lists use: gifts still on the clock first, the soonest due day first; then the ones that ran out in the last day; then
 * Older, newest first. Among gifts due on the same day the largest goes first, so a large new gift is not under a row of small ones.
 */
export function byClock<T extends { clock: Clock; amount: number; key: string }>(a: T, b: T): number {
  const r = RANK[a.clock.state] - RANK[b.clock.state];
  if (r) return r;
  const da = etDayOf(Date.parse(a.clock.due));
  const db = etDayOf(Date.parse(b.clock.due));
  if (da !== db) return a.clock.state === 'due' ? da - db : db - da;
  return b.amount - a.amount || a.clock.mins - b.clock.mins || (a.key < b.key ? -1 : 1);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Due in 6 h", "Due today", "Due tomorrow", "Due Mon", "Overdue 5 h", "Overdue 3d". The page redraws this from `due` as time passes. */
export function clockLabel(dueIso: string, nowMs: number): string {
  const due = Date.parse(dueIso);
  const mins = Math.round((due - nowMs) / 60000);
  if (mins <= 0) {
    const h = Math.floor(-mins / 60);
    return h < 1 ? 'Overdue' : h < 24 ? `Overdue ${h} h` : `Overdue ${Math.floor(h / 24)}d`;
  }
  const dueDay = Math.floor((due + etOffset(due)) / DAY);
  const today = Math.floor((nowMs + etOffset(nowMs)) / DAY);
  if (dueDay === today) return mins < 60 ? `Due in ${mins} min` : mins <= 12 * 60 ? `Due in ${Math.round(mins / 60)} h` : 'Due today';
  if (mins < 60) return `Due in ${mins} min`;
  if (mins <= 8 * 60) return `Due in ${Math.round(mins / 60)} h`;
  if (dueDay === today + 1) return 'Due tomorrow';
  const w = new Date(dueDay * DAY);
  return dueDay - today < 7 ? `Due ${WD[w.getUTCDay()]}` : `Due ${MON[w.getUTCMonth()]} ${w.getUTCDate()}`;
}
