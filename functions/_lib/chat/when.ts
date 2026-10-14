// Times typed in Chat, read on the Eastern clock: "tomorrow 9am", "in 2 hours", "friday at 3", "10/20 9:30", "9am monday",
// "tonight", "next tuesday noon". readWhen reads the time at the start of the text and returns the rest.
import { etInstant, etParts } from '../actions/intake';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowOf = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay();

export interface When {
  at: Date;
  rest: string;
}

type Day = { ymd: string; len: number; part?: number };
type Time = { h: number; m: number; len: number };

function readDay(s: string, today: string): Day | null {
  let m: RegExpExecArray | null;
  if ((m = /^(?:on\s+)?today\b/.exec(s))) return { ymd: today, len: m[0].length };
  if ((m = /^tonight\b/.exec(s))) return { ymd: today, len: m[0].length, part: 19 };
  if ((m = /^(?:tomorrow|tmrw|tmr)\b/.exec(s))) return { ymd: addDays(today, 1), len: m[0].length };
  if ((m = /^(?:on\s+)?(next\s+|this\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rs|rsday|urday)?\b/.exec(s))) {
    const want = WEEKDAYS.indexOf(m[2]);
    const dow = dowOf(today);
    if (m[1] && m[1].startsWith('next')) {
      const nextMonday = addDays(today, (8 - dow) % 7 || 7);
      return { ymd: addDays(nextMonday, (want + 6) % 7), len: m[0].length };
    }
    return { ymd: addDays(today, (want - dow + 7) % 7 || 7), len: m[0].length };
  }
  if ((m = /^(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/.exec(s))) return { ymd: `${m[1]}-${m[2]}-${m[3]}`, len: m[0].length };
  let mo = 0, d = 0, y = Number(today.slice(0, 4)), hasYear = false, len = 0;
  if ((m = /^(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d:])/.exec(s))) {
    mo = Number(m[1]);
    d = Number(m[2]);
    if (m[3]) {
      y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      hasYear = true;
    }
    len = m[0].length;
  } else if ((m = /^(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s))) {
    mo = MONTHS.indexOf(m[1]) + 1;
    d = Number(m[2]);
    len = m[0].length;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (new Date(ymd + 'T12:00:00Z').toISOString().slice(0, 10) !== ymd) return null;
  if (!hasYear && ymd < today) ymd = `${y + 1}${ymd.slice(4)}`;
  return { ymd, len };
}

function readTime(s: string): Time | null {
  let m: RegExpExecArray | null;
  if ((m = /^(?:at\s+)?noon\b/.exec(s))) return { h: 12, m: 0, len: m[0].length };
  if ((m = /^(?:in the\s+)?morning\b/.exec(s))) return { h: 9, m: 0, len: m[0].length };
  if ((m = /^(?:in the\s+)?afternoon\b/.exec(s))) return { h: 14, m: 0, len: m[0].length };
  if ((m = /^(?:in the\s+)?evening\b/.exec(s))) return { h: 18, m: 0, len: m[0].length };
  if ((m = /^(?:by\s+)?(?:eod|end of (?:the )?day)\b/.exec(s))) return { h: 17, m: 0, len: m[0].length };
  // "9am", "9:30 pm", "at 3", "at 15:00". A bare number needs "at" so "3 programs" stays words.
  if ((m = /^(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\w/])/.exec(s))) {
    const at = !!m[1];
    const ap = m[4] ? m[4][0] : '';
    if (!at && !ap && !m[3]) return null;
    let h = Number(m[2]);
    const mi = m[3] ? Number(m[3]) : 0;
    if (h > 23 || mi > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === 'p' && h < 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
    } else if (h >= 1 && h <= 6) h += 12; // "at 3" in a workday means the afternoon
    return { h, m: mi, len: m[0].length };
  }
  return null;
}

const skip = (s: string, n: number) => s.slice(n).replace(/^[\s,]+/, '');

/** Reads a time at the start of text. Null when the text does not start with one, or the time has passed. */
export function readWhen(text: string, now = new Date()): When | null {
  const src = String(text || '').trim();
  let s = src.toLowerCase();
  const today = etParts(now).date;
  const used = () => src.length - s.length;
  const rel = /^in\s+(\d{1,3}|an?|one|two|three|half an)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/.exec(s);
  if (rel) {
    const n = rel[1] === 'half an' ? 0.5 : /^(an?|one)$/.test(rel[1]) ? 1 : rel[1] === 'two' ? 2 : rel[1] === 'three' ? 3 : Number(rel[1]);
    const u = rel[2][0];
    const ms = u === 'm' ? 60000 : u === 'h' ? 3600000 : u === 'd' ? 86400000 : 7 * 86400000;
    if (!n) return null;
    s = skip(s, rel[0].length);
    return { at: new Date(now.getTime() + n * ms), rest: tidy(src.slice(used())) };
  }
  let day = readDay(s, today);
  let time: Time | null = null;
  if (day) {
    s = skip(s, day.len);
    time = readTime(s);
    if (time) s = skip(s, time.len);
  } else {
    time = readTime(s);
    if (time) {
      s = skip(s, time.len);
      day = readDay(s, today);
      if (day) s = skip(s, day.len);
    }
  }
  if (!day && !time) return null;
  const h = time ? time.h : day?.part ?? 9;
  const mi = time ? time.m : 0;
  let ymd = day ? day.ymd : today;
  let at = etInstant(ymd, h, mi);
  // A time alone that already passed today means tomorrow.
  if (!day && at.getTime() <= now.getTime()) {
    ymd = addDays(ymd, 1);
    at = etInstant(ymd, h, mi);
  }
  if (at.getTime() <= now.getTime() - 60000) return null;
  return { at, rest: tidy(src.slice(used())) };
}

function tidy(rest: string): string {
  return rest.replace(/^[\s,:-]+/, '').replace(/^(?:to|that|about)\s+/i, '').trim();
}

/** "Tue, Oct 15 at 9:00 AM" on the Eastern clock; "Today at" and "Tomorrow at" when close. */
export function whenLabel(at: Date | string, now = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const ymd = etParts(d).date;
  const today = etParts(now).date;
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  if (ymd === today) return `Today at ${time}`;
  if (ymd === addDays(today, 1)) return `Tomorrow at ${time}`;
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}
