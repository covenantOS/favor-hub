// Booking wizard logic with no page access: Eastern time helpers, repeat rules, slot scoring. Port of the top of public/js/meet/book.js.
export const TZ = 'America/New_York';
export const HOURS: [number, number][] = [];
for (let h = 9; h < 17; h++) {
  HOURS.push([h, 0]);
  HOURS.push([h, 30]);
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}
export const parts = (t: number | string): Parts => {
  const f = fmt.formatToParts(new Date(t));
  const g = (k: string) => Number((f.find((x) => x.type === k) as Intl.DateTimeFormatPart).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
};
export function etInstant(y: number, mo: number, d: number, h: number, mi: number): number {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let k = 0; k < 3; k++) {
    const p = parts(t);
    t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return t;
}
export interface Day {
  y: number;
  mo: number;
  d: number;
  wd: number;
}
/** Seven days starting today (offset 0), then seven more per page. Weekends show; past times cannot be picked. */
export function weekDays(offset: number): Day[] {
  const out: Day[] = [];
  const p = parts(Date.now());
  const c = new Date(Date.UTC(p.y, p.mo - 1, p.d, 12));
  if (p.h * 60 + p.mi >= 19 * 60) c.setUTCDate(c.getUTCDate() + 1);
  c.setUTCDate(c.getUTCDate() + offset * 7);
  while (out.length < 7) {
    out.push({ y: c.getUTCFullYear(), mo: c.getUTCMonth() + 1, d: c.getUTCDate(), wd: c.getUTCDay() });
    c.setUTCDate(c.getUTCDate() + 1);
  }
  return out;
}
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
export const etDay = (iso: string | number) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
export const etTime = (iso: string | number) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ;
  } catch {
    return TZ;
  }
};
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];

/* ---------------------------------------------------------------- repeat rules (the same shape the server stores) */
export interface Rule {
  freq: string;
  interval: number | string;
  byDay: number[];
  monthBy: string;
  end: { kind: string; count: number | string; until: string };
}
export const newRule = (): Rule => ({ freq: 'none', interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never', count: 10, until: '' } });
export const ruleOn = (r: Rule | null | undefined): boolean => !!(r && r.freq && r.freq !== 'none');
/** The picked start, as an Eastern calendar day, with the weekday and which weekday of the month it is. */
export function baseOf(iso: string | number | undefined) {
  const p = parts(iso ? Date.parse(String(iso)) : Date.now());
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const dim = new Date(Date.UTC(p.y, p.mo, 0)).getUTCDate();
  return { ...p, wd, nth: Math.ceil(p.d / 7), last: p.d + 7 > dim };
}
const joinList = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
export function ruleText(r: Rule, startIso: string): string {
  if (!ruleOn(r)) return '';
  const b = baseOf(startIso);
  const n = Number(r.interval) || 1;
  let t: string;
  if (r.freq === 'daily') t = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (r.freq === 'weekdays') t = 'Every weekday';
  else if (r.freq === 'weekly') t = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${joinList((r.byDay.length ? [...r.byDay].sort() : [b.wd]).map((d) => DAY_NAMES[d]))}`;
  else if (r.freq === 'monthly') t = `${n === 1 ? 'Every month' : `Every ${n} months`} on ${r.monthBy === 'date' ? 'day ' + b.d : `the ${r.monthBy === 'last' || b.nth === 5 ? 'last' : ORD[b.nth]} ${DAY_NAMES[b.wd]}`}`;
  else t = `${n === 1 ? 'Every year' : `Every ${n} years`} on ${MONTHS[b.mo - 1]} ${b.d}`;
  if (r.end.kind === 'count') t += `, ${r.end.count} time${Number(r.end.count) === 1 ? '' : 's'}`;
  if (r.end.kind === 'until' && r.end.until) {
    const [y, mo, d] = r.end.until.split('-').map(Number);
    t += `, until ${new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return t;
}
/** The rule as it goes to the server, or null for a meeting that does not repeat. */
export function ruleOut(r: Rule, startIso: string) {
  if (!ruleOn(r)) return null;
  const b = baseOf(startIso);
  const end = r.end.kind === 'count' ? { kind: 'count', count: Math.max(1, Math.min(400, Number(r.end.count) || 1)) } : r.end.kind === 'until' && r.end.until ? { kind: 'until', until: r.end.until } : { kind: 'never' };
  return { freq: r.freq, interval: r.freq === 'weekdays' ? 1 : Math.max(1, Math.min(52, Number(r.interval) || 1)), byDay: r.freq === 'weekly' ? (r.byDay.length ? [...r.byDay].sort() : [b.wd]) : [], monthBy: r.monthBy, end };
}
/** A rule from the server fills the editor. */
export function ruleIn(raw: any): Rule {
  const r = newRule();
  if (!raw || !raw.freq) return r;
  r.freq = raw.freq;
  r.interval = raw.interval || 1;
  r.byDay = raw.byDay || [];
  r.monthBy = raw.monthBy || 'date';
  if (raw.end) {
    r.end.kind = raw.end.kind || 'never';
    if (raw.end.count) r.end.count = raw.end.count;
    if (raw.end.until) r.end.until = raw.end.until;
  }
  return r;
}
export const bookerLocal = (iso: string, btz: string): string =>
  btz === TZ ? '' : new Date(iso).toLocaleString('en-US', { timeZone: btz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const clock = (m: number) => `${Math.floor(m / 60) % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${m < 720 || m >= 1440 ? 'AM' : 'PM'}`;
export const zoneName = (tz: string): string => {
  try {
    return (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName') as Intl.DateTimeFormatPart).value;
  } catch {
    return tz;
  }
};
