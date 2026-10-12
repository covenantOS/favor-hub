// Make a request fills itself out. The person types what they need; this reads it and suggests the form's answers, the owner
// and a due date. Pure, so tests/request-fill.test.mjs covers it. Nothing here writes to the board: the form shows the
// answers for the person to change, and a hub admin presses a button to put the owner and date on the request.
import type { Env } from '../http';
import { staffDirectory } from '../people';

export type Kind = 'change' | 'add' | 'other';
export type Surface = 'website' | 'portal' | 'dashboard' | 'app';
export type Needed = 'As soon as possible' | 'This week' | 'Whenever we get to it' | 'By a date';
export type Audience = 'Public on favorintl.org' | 'Partners on the portal' | 'Staff on FavorOS' | 'Not sure who sees it';

export interface Fill {
  kind: Kind;
  surface: Surface;
  title: string;
  page_url: string;
  now: string;
  should: string;
  details: string;
  audience: Audience;
  needed: Needed;
  /** YYYY-MM-DD, set when needed is "By a date". */
  needed_date: string;
  /** The date the work should be done by, suggested for the owner. */
  due_date: string;
  /** Plain reasons for each answer, shown beside the form so nobody wonders where it came from. */
  why: { kind: string; surface: string; needed: string };
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T12:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const dow = (s: string) => parse(s).getUTCDay();

/** The next weekday after `today` (never today itself) with this day number. */
function nextWeekday(today: string, target: number): string {
  let d = addDays(today, 1);
  while (dow(d) !== target) d = addDays(d, 1);
  return d;
}

/** Skips Saturday and Sunday. */
export function addBusinessDays(today: string, n: number): string {
  let d = today;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (dow(d) !== 0 && dow(d) !== 6) left--;
  }
  return d;
}

/** This week's Friday; on a Friday it is today, and over a weekend it is the coming Friday. */
export function fridayOf(today: string): string {
  const w = dow(today);
  if (w === 5) return today;
  if (w === 6 || w === 0) return nextWeekday(today, 5);
  return addDays(today, 5 - w);
}

function monthNumber(word: string): number {
  const w = word.toLowerCase();
  return MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3))) + 1;
}

function ymd(today: string, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  const make = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
  let out = make(year);
  if (Number.isNaN(Date.parse(out + 'T12:00:00Z')) || parse(out).getUTCDate() !== day) return null;
  if (out < today) out = make(year + 1);
  return out;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** A date named in the words ("by Friday", "October 20", "10/20", "in two weeks", "end of the month"), or null. */
export function dateFromText(text: string, today: string): { date: string; word: string } | null {
  const t = text.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t))) {
    const d = ymd(today, monthNumber(m[1]), Number(m[2]));
    if (d) return { date: d, word: m[0] };
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) {
    const mo = Number(m[1]);
    const da = Number(m[2]);
    if (m[3]) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const out = `${y}-${pad(mo)}-${pad(da)}`;
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && !Number.isNaN(Date.parse(out + 'T12:00:00Z'))) return { date: out, word: m[0] };
    } else {
      const d = ymd(today, mo, da);
      if (d) return { date: d, word: m[0] };
    }
  }
  if (/\b(tonight|today|end of (the )?day|eod)\b/.test(t) && !/\btoday'?s\b/.test(t)) return { date: today, word: 'today' };
  if (/\btomorrow\b/.test(t)) return { date: addDays(today, 1), word: 'tomorrow' };
  if ((m = /\b(?:in|within)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(day|week|month)s?\b/.exec(t))) {
    const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
    const unit = m[2] === 'day' ? 1 : m[2] === 'week' ? 7 : 30;
    return { date: addDays(today, n * unit), word: m[0] };
  }
  if ((m = new RegExp(`\\b(?:by|before|on|for|due|until|this|next|coming)?\\s*(?:(next|this|coming)\\s+)?(${DAYS.join('|')})\\b`).exec(t))) {
    const target = DAYS.indexOf(m[2]);
    let d = nextWeekday(today, target);
    // "next Friday" on a Monday means the Friday after this one.
    if (m[1] === 'next' && d <= addDays(today, 7 - dow(today))) d = addDays(d, 7);
    return { date: d, word: m[0].trim() };
  }
  if (/\b(end of (the )?week|eow)\b/.test(t)) return { date: fridayOf(today), word: 'end of the week' };
  if (/\bnext week\b/.test(t)) return { date: fridayOf(addDays(fridayOf(today), 1)), word: 'next week' };
  if (/\bthis week\b/.test(t)) return { date: fridayOf(today), word: 'this week' };
  if (/\bend of (the )?month\b/.test(t)) {
    const d = parse(today);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
    return { date: iso(last), word: 'end of the month' };
  }
  return null;
}

const URGENT = /\b(asap|a\.s\.a\.p|urgent(ly)?|immediately|right away|right now|emergency|as soon as (possible|you can)|is down|not working for everyone|broken for everyone)\b/i;
const LAZY = /\b(whenever|no rush|not urgent|low priority|when you (get|have) (a chance|time)|eventually|someday|nice to have)\b/i;

const SURFACE_WORDS: Array<[Surface, RegExp, string]> = [
  ['portal', /\b(partner portal|portal|my\.favorintl\.org|giving history|partner login)\b/i, 'it names the partner portal'],
  ['dashboard', /\b(favoros|favor ?os|FavorOS|hub page|dash\.favorintl\.org|kpi|dashboard|work center|chat|clips?|meetings?|projects?)\b/i, 'it names FavorOS'],
  ['app', /\b(blackbaud|raiser'?s edge|gohighlevel|ghl|mobile app|\bapp\b|zapier|zoom|google (drive|sheet|doc)|spreadsheet|query|list of)\b/i, 'it names another Favor tool'],
  ['website', /\b(web ?site|web ?page|favorintl\.org|the page|home ?page|careers?|team page|blog|donate|giving page|form|newsletter sign ?up|job post)/i, 'it names the website'],
];

const ADD_WORDS = /\b(add|adding|new|create|make (a|an|us|me)|build|set up|post|publish|upload|include|need (a|an)|put (a|an|the)|write (a|an))\b/i;
const CHANGE_WORDS = /\b(fix|change|update|correct|replace|remove|delete|rename|edit|wrong|typo|broken|not working|swap|move|hide|stop|should (say|be|read)|instead|misspell)\w*\b/i;

/** The first line of the words as a short title: "Could we add Sarah's bio to the team page?" becomes "Add Sarah's bio to the team page". */
export function titleFrom(text: string): string {
  const first = (text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '').replace(/^(hi|hello|hey)[,!. ]+/i, '');
  let s = first.split(/(?<=[.!?])\s+/)[0] || first;
  s = s
    .replace(/^(can|could|would|will) (you|we|someone|anyone|somebody)( please)?( be able to)?\s+/i, '')
    .replace(/^(please|pls)[,]?\s+/i, '')
    .replace(/^(i|we) (would like|want|need|am looking|are looking)( you)?( to)?\s+/i, '')
    .replace(/^(i|we)'d like( you)?( to)?\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  if (!s) s = first;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 100) {
    const cut = s.slice(0, 100);
    s = cut.slice(0, Math.max(40, cut.lastIndexOf(' '))).replace(/[,;:\- ]+$/, '');
  }
  return s;
}

function pageFrom(text: string): string {
  const url = /\bhttps?:\/\/[^\s)]+/i.exec(text);
  if (url) return url[0].replace(/[.,;]+$/, '').slice(0, 400);
  const dom = /\b(?:www\.)?(?:my\.|dash\.)?favorintl\.org(\/[^\s)]*)?/i.exec(text);
  if (dom) return dom[0].replace(/[.,;]+$/, '').slice(0, 400);
  const named = /\b(?:on|in|to|from) the ([A-Za-z][A-Za-z '&-]{1,40}?) (page|section|tab|screen|form)\b/i.exec(text);
  if (named) return `${named[1].trim()} ${named[2].toLowerCase()}`.replace(/^./, (c) => c.toUpperCase()).slice(0, 80);
  return '';
}

function splitChange(text: string): { now: string; should: string } {
  const swap = /\b(?:change|replace|update|swap)\s+(.{3,160}?)\s+(?:to|with|so (?:it )?(?:says|reads))\s+(.{2,300})/i.exec(text);
  const clean = (v: string) => v.replace(/\s+(?:on|in)\s+(?:the\s|https?:|www\.).*$/i, '').replace(/^["'“‘]+|["'”’.]+$/g, '').trim();
  if (swap) return { now: clean(swap[1]), should: clean(swap[2]) };
  const should = /\b(?:should (?:say|be|read)|instead)[: ]+(.{2,300})/i.exec(text);
  if (should) {
    const before = text.slice(0, should.index).trim();
    return { now: before.length > 4 ? before : '', should: clean(should[1]) };
  }
  return { now: '', should: '' };
}

export function suggestFill(textRaw: string, today: string): Fill {
  const text = textRaw.trim();
  const surfaceHit = SURFACE_WORDS.find(([, re]) => re.test(text));
  const surface: Surface = surfaceHit ? surfaceHit[0] : 'website';
  const adds = ADD_WORDS.test(text);
  const changes = CHANGE_WORDS.test(text);
  const kind: Kind = changes && !(adds && !/\b(fix|wrong|typo|broken|not working)\b/i.test(text)) ? 'change' : adds ? 'add' : changes ? 'change' : text.length > 0 && !surfaceHit ? 'other' : 'change';

  const named = dateFromText(text, today);
  const urgent = URGENT.test(text);
  const lazy = LAZY.test(text);
  let needed: Needed;
  let needed_date = '';
  let due_date: string;
  let neededWhy: string;
  if (named && !/^(this week|next week|today|tomorrow)$/.test(named.word) && named.date !== today) {
    needed = 'By a date';
    needed_date = named.date;
    due_date = named.date;
    neededWhy = `it says "${named.word}"`;
  } else if (urgent || (named && named.word === 'today')) {
    needed = 'As soon as possible';
    due_date = addBusinessDays(today, 1);
    neededWhy = urgent ? 'it sounds urgent' : 'it says today';
  } else if (named && named.word === 'tomorrow') {
    needed = 'As soon as possible';
    due_date = named.date;
    neededWhy = 'it says tomorrow';
  } else if (lazy) {
    needed = 'Whenever we get to it';
    due_date = addBusinessDays(today, 10);
    neededWhy = 'it says there is no rush, so two weeks out';
  } else if (named) {
    needed = 'This week';
    due_date = named.date;
    neededWhy = `it says "${named.word}"`;
  } else {
    needed = 'This week';
    due_date = fridayOf(today);
    neededWhy = 'no date in the words, so the end of this week';
  }

  const audienceWords = /\b(staff only|internal|only (the )?staff|for staff)\b/i.test(text) ? 'Staff on FavorOS' : /\b(partners?|donors?|givers?)\b/i.test(text) && surface === 'portal' ? 'Partners on the portal' : null;
  const audience: Audience = (audienceWords as Audience) || (surface === 'website' ? 'Public on favorintl.org' : surface === 'portal' ? 'Partners on the portal' : surface === 'dashboard' ? 'Staff on FavorOS' : 'Not sure who sees it');

  const { now, should } = kind === 'change' ? splitChange(text) : { now: '', should: '' };
  const title = titleFrom(text);
  const multi = text.length > title.length + 8;
  return {
    kind,
    surface,
    title,
    page_url: pageFrom(text),
    now,
    should: kind === 'change' ? should || (multi ? text : '') : '',
    details: kind !== 'change' && multi ? text : '',
    audience,
    needed,
    needed_date,
    due_date,
    why: {
      kind: kind === 'add' ? 'it asks for something new' : kind === 'change' ? 'it asks for a change or a fix' : 'it does not read as a change or something new',
      surface: surfaceHit ? surfaceHit[2] : 'no tool is named, so the website',
      needed: neededWhy,
    },
  };
}

export interface OwnerGuess {
  email: string;
  name: string;
  why: string;
}

/**
 * Who usually takes this kind of request: the person who owned the most requests on the same surface in the last 90 days, else the
 * Lead Developer on the staff list. Null when the board has no history and nobody has that title.
 */
export async function suggestOwner(env: Pick<Env, 'DB'>, surface: Surface, today: string, route: 'board' | 'marketing' | 'expense' = 'board'): Promise<OwnerGuess | null> {
  const since = `${addDays(today, -90)}T00:00:00.000Z`;
  let pick = '';
  let count = 0;
  try {
    const r = await env.DB.prepare(
      `SELECT t.owner_email AS email, COUNT(*) AS n FROM request_tasks t JOIN requests q ON q.id = t.request_id
        WHERE q.surface = ? AND t.owner_email IS NOT NULL AND t.owner_email <> '' AND q.created_at > ?
        GROUP BY t.owner_email ORDER BY n DESC, MAX(t.updated_at) DESC LIMIT 1`
    )
      .bind(surface, since)
      .first<{ email: string; n: number }>();
    if (r) {
      pick = r.email;
      count = Number(r.n) || 0;
    }
  } catch {
    // the task tables are not switched on yet; the staff list answers below
  }
  const people = await staffDirectory(env).catch(() => []);
  if (route === 'marketing') {
    const m = people.filter((p) => /marketing/i.test(p.team));
    const lead = m.find((p) => /director|manager|lead/i.test(p.title)) || m[0];
    if (lead) return { email: lead.email, name: lead.name, why: 'Leads the Marketing team, which takes design, print and video requests' };
  }
  if (route === 'expense') {
    const a = people.find((p) => /operations|administrat|finance|accounting/i.test(p.title));
    if (a) return { email: a.email, name: a.name, why: 'Handles expense approvals' };
  }
  if (pick && route === 'board') {
    const p = people.find((x) => x.email === pick);
    if (p) return { email: p.email, name: p.name, why: `${count === 1 ? 'Took the last' : `Took ${count} of the last`} ${surface} request${count === 1 ? '' : 's'}` };
  }
  const dev = people.find((p) => /lead developer|developer/i.test(p.title));
  if (dev) return { email: dev.email, name: dev.name, why: 'Takes the technical requests' };
  const any = people[0];
  return any ? { email: any.email, name: any.name, why: 'First person on the staff list, since nobody has this kind of request yet' } : null;
}

/** Today in Eastern time, YYYY-MM-DD. */
export function easternDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface Suggestion {
  owner: OwnerGuess | null;
  due_date: string;
  needed: string;
  why: string;
}

/** The owner and due date the form suggested when this request was written, for the board's panel. Null when none was kept. */
export async function suggestionFor(env: Pick<Env, 'DB'>, requestId: string): Promise<Suggestion | null> {
  const row = await env.DB.prepare("SELECT fill FROM request_routes WHERE request_id = ? AND fill <> '' ORDER BY at DESC LIMIT 1")
    .bind(requestId)
    .first<{ fill: string }>()
    .catch(() => null);
  if (!row) return null;
  try {
    const f = JSON.parse(row.fill) as Fill & { owner: OwnerGuess | null };
    if (!f.owner && !f.due_date) return null;
    return { owner: f.owner || null, due_date: f.due_date || '', needed: f.needed, why: f.why?.needed || '' };
  } catch {
    return null;
  }
}
