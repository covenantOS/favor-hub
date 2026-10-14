// Meetings: repeat rules. One rule shape for the booking page, the series row, Google Calendar's RRULE and the occurrence list.
// Every occurrence keeps the wall clock time of the first one in the series' time zone (Eastern unless set), across daylight saving.
// Pure: no database, no fetch. Tested in tests/meet-recur.test.mjs.

export type Freq = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export interface Rule {
  freq: Freq;
  /** Every N days, weeks, months or years. 1 to 52. */
  interval: number;
  /** Weekly: the days, 0 Sunday to 6 Saturday. Empty means the first meeting's day. */
  byDay: number[];
  /** Monthly: on the same date (the 14th), the same weekday ("2nd Tuesday") or the last such weekday ("last Friday"). */
  monthBy: 'date' | 'weekday' | 'last';
  /** never, after a count, or on a date (YYYY-MM-DD, that day included). */
  end: { kind: 'never' | 'count' | 'until'; count?: number; until?: string };
}

export const TZ_DEFAULT = 'America/New_York';
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
/** No series runs forever in the database: occurrences are made up to this many at a time, and expand stops here. */
export const MAX_EXPAND = 800;

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; wd: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmtOf(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD_SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall clock of an instant in a time zone. */
export function wallOf(t: number | string, tz = TZ_DEFAULT): Wall {
  const parts = fmtOf(tz).formatToParts(new Date(t));
  const g = (k: string) => parts.find((x) => x.type === k)?.value || '';
  return { y: Number(g('year')), mo: Number(g('month')), d: Number(g('day')), h: Number(g('hour')) % 24, mi: Number(g('minute')), wd: WD_SHORT[g('weekday')] ?? 0 };
}

/** The instant whose wall clock in tz is this date and time. A time skipped by daylight saving lands an hour later. */
export function instantOf(y: number, mo: number, d: number, h: number, mi: number, tz = TZ_DEFAULT): number {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for (let k = 0; k < 4; k++) {
    const p = wallOf(t, tz);
    const diff = want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (!diff) break;
    t += diff;
  }
  return t;
}

const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const dayKey = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Which weekday of the month a date is (1 to 5), and whether it is the last one in its month. */
export function nthOf(y: number, mo: number, d: number): { n: number; last: boolean } {
  return { n: Math.ceil(d / 7), last: d + 7 > daysIn(y, mo) };
}

/** A rule from what a page or an old row sent. Anything unknown falls back to the safe value. */
export function cleanRule(raw: unknown, legacy = ''): Rule | null {
  if (!raw || typeof raw !== 'object') {
    if (legacy === 'weekly') return { freq: 'weekly', interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never' } };
    if (legacy === 'biweekly') return { freq: 'weekly', interval: 2, byDay: [], monthBy: 'date', end: { kind: 'never' } };
    if (legacy === 'monthly') return { freq: 'monthly', interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never' } };
    if (legacy === 'daily' || legacy === 'weekdays' || legacy === 'yearly') return { freq: legacy as Freq, interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never' } };
    return null;
  }
  const r = raw as Record<string, unknown>;
  const freq = (['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const).find((f) => f === r.freq);
  if (!freq) return null;
  const interval = Math.min(52, Math.max(1, Math.round(Number(r.interval) || 1)));
  const byDay = Array.isArray(r.byDay) ? [...new Set((r.byDay as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  const monthBy = r.monthBy === 'weekday' || r.monthBy === 'last' ? r.monthBy : 'date';
  const e = (r.end && typeof r.end === 'object' ? r.end : {}) as Record<string, unknown>;
  let end: Rule['end'] = { kind: 'never' };
  if (e.kind === 'count') end = { kind: 'count', count: Math.min(500, Math.max(1, Math.round(Number(e.count) || 1))) };
  else if (e.kind === 'until' && typeof e.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.until)) end = { kind: 'until', until: e.until };
  return { freq, interval: freq === 'weekdays' ? 1 : interval, byDay: freq === 'weekly' ? byDay : [], monthBy, end };
}

/** Start times (ISO, UTC) of the series from its first start, oldest first. Stops at `limit`, at `toMs`, and at the rule's end. */
export function expand(rule: Rule, dtstart: string, opts: { limit?: number; toMs?: number; tz?: string } = {}): string[] {
  const tz = opts.tz || TZ_DEFAULT;
  const limit = Math.min(opts.limit ?? MAX_EXPAND, MAX_EXPAND);
  const toMs = opts.toMs ?? Infinity;
  const base = wallOf(dtstart, tz);
  const out: string[] = [];
  const untilKey = rule.end.kind === 'until' ? rule.end.until! : '';
  const count = rule.end.kind === 'count' ? rule.end.count! : Infinity;
  const push = (y: number, mo: number, d: number): boolean => {
    const key = dayKey(y, mo, d);
    if (untilKey && key > untilKey) return false;
    const t = instantOf(y, mo, d, base.h, base.mi, tz);
    if (t > toMs) return false;
    out.push(new Date(t).toISOString());
    return out.length < limit && out.length < count;
  };
  const day0 = Date.UTC(base.y, base.mo - 1, base.d);
  const at = (ms: number) => { const x = new Date(ms); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() }; };
  const DAY = 86400_000;
  // A hard stop on the walk itself, so an odd rule can never spin.
  for (let step = 0, guard = 0; guard < 20000; step++, guard++) {
    if (rule.freq === 'daily') {
      const c = at(day0 + step * rule.interval * DAY);
      if (!push(c.y, c.mo, c.d)) break;
    } else if (rule.freq === 'weekdays') {
      const c = at(day0 + step * DAY);
      if (c.wd === 0 || c.wd === 6) continue;
      if (!push(c.y, c.mo, c.d)) break;
    } else if (rule.freq === 'weekly') {
      const days = rule.byDay.length ? rule.byDay : [base.wd];
      const weekStart = day0 - base.wd * DAY + step * rule.interval * 7 * DAY;
      let stop = false;
      for (const wd of days) {
        const ms = weekStart + wd * DAY;
        if (ms < day0) continue;
        const c = at(ms);
        if (!push(c.y, c.mo, c.d)) { stop = true; break; }
      }
      if (stop) break;
    } else if (rule.freq === 'monthly') {
      const mIndex = base.mo - 1 + step * rule.interval;
      const y = base.y + Math.floor(mIndex / 12), mo = (mIndex % 12) + 1;
      if (rule.monthBy === 'date') {
        // The 31st in a short month is skipped, as Google does.
        if (base.d > daysIn(y, mo)) continue;
        if (!push(y, mo, base.d)) break;
      } else {
        const { n } = nthOf(base.y, base.mo, base.d);
        const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
        let d = 1 + ((base.wd - first + 7) % 7) + (n - 1) * 7;
        if (rule.monthBy === 'last' || n === 5) { d = 1 + ((base.wd - first + 7) % 7); while (d + 7 <= daysIn(y, mo)) d += 7; }
        if (d > daysIn(y, mo)) continue;
        if (!push(y, mo, d)) break;
      }
    } else {
      const y = base.y + step * rule.interval;
      if (base.d > daysIn(y, base.mo)) continue;
      if (!push(y, base.mo, base.d)) break;
    }
  }
  return out;
}

const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The RRULE line for Google Calendar and .ics files. UNTIL is the end of the until day in the series' time zone, in UTC. */
export function toRRule(rule: Rule, dtstart: string, tz = TZ_DEFAULT): string {
  const base = wallOf(dtstart, tz);
  const p: string[] = [];
  if (rule.freq === 'weekdays') p.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
  else {
    p.push('FREQ=' + rule.freq.toUpperCase());
    if (rule.interval > 1) p.push('INTERVAL=' + rule.interval);
    if (rule.freq === 'weekly') p.push('BYDAY=' + (rule.byDay.length ? rule.byDay : [base.wd]).map((d) => DAY_CODES[d]).join(','));
    if (rule.freq === 'monthly' && rule.monthBy !== 'date') {
      const { n } = nthOf(base.y, base.mo, base.d);
      p.push('BYDAY=' + (rule.monthBy === 'last' || n === 5 ? '-1' : String(n)) + DAY_CODES[base.wd]);
    }
  }
  if (rule.end.kind === 'count') p.push('COUNT=' + rule.end.count);
  if (rule.end.kind === 'until' && rule.end.until) {
    const [y, mo, d] = rule.end.until.split('-').map(Number);
    p.push('UNTIL=' + icsUtc(instantOf(y, mo, d, 23, 59, tz)));
  }
  return 'RRULE:' + p.join(';');
}

/** The rule in a Google event's recurrence lines. Returns null for what FavorOS cannot repeat the same way (BYSETPOS, hourly). */
export function fromRRule(lines: string[] | undefined, dtstart: string, tz = TZ_DEFAULT): { rule: Rule; exdates: string[] } | null {
  const line = (lines || []).find((l) => l.startsWith('RRULE:'));
  if (!line) return null;
  const kv = Object.fromEntries(line.slice(6).split(';').map((x) => x.split('=') as [string, string]));
  const base = wallOf(dtstart, tz);
  const interval = Number(kv.INTERVAL || 1);
  const byDayRaw = (kv.BYDAY || '').split(',').filter(Boolean);
  if (kv.BYSETPOS || kv.BYHOUR || kv.BYMINUTE || kv.BYYEARDAY || kv.BYWEEKNO) return null;
  let rule: Rule;
  const end: Rule['end'] = kv.COUNT ? { kind: 'count', count: Number(kv.COUNT) } : kv.UNTIL ? { kind: 'until', until: untilDay(kv.UNTIL, tz) } : { kind: 'never' };
  switch (kv.FREQ) {
    case 'DAILY': rule = { freq: 'daily', interval, byDay: [], monthBy: 'date', end }; break;
    case 'WEEKLY': {
      const days = byDayRaw.map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((d) => d >= 0).sort();
      if (interval === 1 && days.join() === '1,2,3,4,5') rule = { freq: 'weekdays', interval: 1, byDay: [], monthBy: 'date', end };
      else rule = { freq: 'weekly', interval, byDay: days.length ? days : [base.wd], monthBy: 'date', end };
      break;
    }
    case 'MONTHLY':
      if (byDayRaw.length > 1) return null;
      if (kv.BYMONTHDAY && Number(kv.BYMONTHDAY) !== base.d) return null;
      rule = { freq: 'monthly', interval, byDay: [], monthBy: byDayRaw.length ? (byDayRaw[0].startsWith('-1') ? 'last' : 'weekday') : 'date', end };
      break;
    case 'YEARLY': rule = { freq: 'yearly', interval, byDay: [], monthBy: 'date', end }; break;
    default: return null;
  }
  const exdates: string[] = [];
  for (const l of lines || []) {
    if (!l.startsWith('EXDATE')) continue;
    const zone = /TZID=([^:;]+)/.exec(l)?.[1] || '';
    for (const v of l.split(':').pop()!.split(',')) {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v.trim());
      if (!m) continue;
      const [, y, mo, d, h = String(base.h), mi = String(base.mi), , z] = m;
      const t = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi) : instantOf(+y, +mo, +d, +h, +mi, zone || tz);
      exdates.push(new Date(t).toISOString());
    }
  }
  return { rule, exdates };
}

function untilDay(v: string, tz: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v);
  if (!m) return v;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  const w = wallOf(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), tz);
  return dayKey(w.y, w.mo, w.d);
}

/** The EXDATE line for skipped occurrences, in UTC. */
export function exdateLine(exdates: string[]): string {
  return exdates.length ? 'EXDATE:' + exdates.map((x) => icsUtc(Date.parse(x))).join(',') : '';
}

/** Google's id for one occurrence of a repeating event: the series id, then the original start in UTC. */
export const instanceId = (seriesEventId: string, origStart: string) => `${seriesEventId.replace(/^ext:/, '')}_${icsUtc(Date.parse(origStart))}`;

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

/** "Every 2 weeks on Tuesday and Thursday, 10 times". Plain words for the booking page, the series page and emails. */
export function describe(rule: Rule, dtstart: string, tz = TZ_DEFAULT): string {
  const base = wallOf(dtstart, tz);
  const n = rule.interval;
  let s: string;
  if (rule.freq === 'daily') s = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (rule.freq === 'weekdays') s = 'Every weekday';
  else if (rule.freq === 'weekly') s = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${list((rule.byDay.length ? rule.byDay : [base.wd]).map((d) => DAY_NAMES[d]))}`;
  else if (rule.freq === 'monthly') {
    const { n: k } = nthOf(base.y, base.mo, base.d);
    const on = rule.monthBy === 'date' ? `day ${base.d}` : `the ${rule.monthBy === 'last' || k === 5 ? 'last' : ORD[k]} ${DAY_NAMES[base.wd]}`;
    s = `${n === 1 ? 'Every month' : `Every ${n} months`} on ${on}`;
  } else s = `${n === 1 ? 'Every year' : `Every ${n} years`} on ${new Date(Date.UTC(base.y, base.mo - 1, base.d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' })}`;
  if (rule.end.kind === 'count') s += `, ${rule.end.count} time${rule.end.count === 1 ? '' : 's'}`;
  if (rule.end.kind === 'until' && rule.end.until) {
    const [y, mo, d] = rule.end.until.split('-').map(Number);
    s += `, until ${new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return s;
}

/** The day before an instant, as YYYY-MM-DD in tz: the until date that ends a series just before that occurrence. */
export function dayBefore(iso: string, tz = TZ_DEFAULT): string {
  const w = wallOf(iso, tz);
  const x = new Date(Date.UTC(w.y, w.mo - 1, w.d - 1));
  return dayKey(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/** The date of an instant in tz, YYYY-MM-DD. */
export function dayOf(iso: string | number, tz = TZ_DEFAULT): string {
  const w = wallOf(iso, tz);
  return dayKey(w.y, w.mo, w.d);
}

/** A rule with the count reduced by how many occurrences came before `from` (for the half that follows a split). */
export function restAfter(rule: Rule, dtstart: string, from: string, tz = TZ_DEFAULT): Rule {
  if (rule.end.kind !== 'count') return rule;
  const before = expand(rule, dtstart, { tz, toMs: Date.parse(from) - 1 }).length;
  return { ...rule, end: { kind: 'count', count: Math.max(1, (rule.end.count || 1) - before) } };
}
