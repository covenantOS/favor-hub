// Reading a request from the words. Pure and free of server and browser APIs, so the server (functions/_lib/requests/suggest.ts and
// functions/_lib/intake) and the React composer (web/src/features/projects/intake) run the same code and always agree.
//   suggestFill   the old Make a request form's answers (kind, where, summary, who sees it, timing), kept as it was
//   parseRequest  the composer's chips: team, kind, place, audience, due date and assignee, each with the reason shown on hover
//   routeByWords  which team a request goes to (the keyword half of the old route finder)
// Tests: tests/request-fill.test.mjs (suggestFill) and tests/intake-parse.test.mjs (parseRequest).

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
export const addDays = (s: string, n: number) => {
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


/** Today in Eastern time, YYYY-MM-DD. */
export function easternDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/* ------------------------------------------------------------------------------------------------ team */

export type Route = 'board' | 'marketing' | 'expense';
export type Team = 'tech' | 'marketing' | 'expense';

const ROUTE_WORDS: Record<Route, RegExp[]> = {
  board: [
    /\bweb ?site\b/i, /\bweb ?page\b/i, /favorintl\.org/i, /\bportal\b/i, /\bhub\b/i, /\bdashboard\b/i, /\bkpi\b/i,
    /\bblackbaud\b/i, /raiser'?s edge/i, /\bquer(y|ies)\b/i, /\blist of (partners|donors|churches|people)\b/i, /\bpull (a|the) (list|report)\b/i,
    /\blog ?in\b/i, /\bpassword\b/i, /\bbug\b/i, /\bbroken\b/i, /\berror\b/i, /\blink\b/i, /\bform\b/i, /\bgiving page\b/i, /\bdonat(e|ion) page\b/i,
    /\bjob post/i, /\bcareers?\b/i, /\bintegrat/i, /\bgohighlevel\b|\bghl\b/i, /\bautomation\b/i, /\bduplicate record/i, /\bmerge\b/i, /\bapp\b/i,
  ],
  marketing: [
    /\bflyers?\b/i, /\bbrochures?\b/i, /\bdesign\b/i, /\bgraphic/i, /\blogo\b/i, /\bbanners?\b/i, /\bposters?\b/i, /\bprint(ed|ing)?\b/i,
    /\bmailers?\b/i, /\bpostcards?\b/i, /\bnewsletter\b/i, /\bsocial\b/i, /\binstagram\b/i, /\bfacebook\b/i, /\bvideos?\b/i, /\bphotos?\b/i,
    /\bslides?\b|\bdeck\b|\bpowerpoint\b/i, /\bcanva\b/i, /\bmerch/i, /\bt-?shirts?\b/i, /\bbooth\b/i, /\bcampaign\b/i, /\bappeal letter/i,
    /\bthank-?you packets?\b/i, /\breels?\b/i, /\bemail blast\b|\be-?blast\b/i, /\binvitations?\b/i,
  ],
  expense: [
    /\breimburs/i, /\bexpense\b/i, /\bpurchase\b/i, /\bbuy\b|\bbought\b/i, /\bplane tickets?\b|\bflights?\b/i, /\bhotel\b/i, /\bmileage\b/i,
    /\bper diem\b/i, /\binvoice\b/i, /\bpay for\b/i, /\bcredit card\b/i, /\btravel (cost|expense)/i,
  ],
};
const ROUTES: Route[] = ['board', 'marketing', 'expense'];

/** The team the keywords point at, or null when they say nothing. A tie goes to the board, as the old route finder did. */
export function routeByWords(text: string): Route | null {
  const score = (r: Route) => ROUTE_WORDS[r].filter((re) => re.test(text)).length;
  const scores = ROUTES.map((r) => [r, score(r)] as const).sort((a, b) => b[1] - a[1]);
  if (!scores[0][1]) return null;
  if (scores[1][1] === scores[0][1]) return scores.some(([r, s]) => r === 'board' && s === scores[0][1]) ? 'board' : scores[0][0];
  return scores[0][0];
}

/* ------------------------------------------------------------------------------------------------ the composer's chips */

export type MarketingPlace = 'design' | 'print' | 'social' | 'video' | 'email' | 'event';
export type Place = Surface | MarketingPlace;

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export const TEAM_OPTIONS: Option<Team>[] = [
  { value: 'tech', label: 'Tech' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'expense', label: 'Expense request' },
];
export const KIND_OPTIONS: Option<Kind>[] = [
  { value: 'change', label: 'Change or fix' },
  { value: 'add', label: 'Something new' },
  { value: 'other', label: 'Something else' },
];
export const PLACE_OPTIONS: Record<'tech' | 'marketing', Option<Place>[]> = {
  tech: [
    { value: 'website', label: 'Website' },
    { value: 'portal', label: 'Partner portal' },
    { value: 'dashboard', label: 'FavorOS' },
    { value: 'app', label: 'Another tool' },
  ],
  marketing: [
    { value: 'design', label: 'Design' },
    { value: 'print', label: 'Print' },
    { value: 'social', label: 'Social' },
    { value: 'video', label: 'Video or photo' },
    { value: 'email', label: 'Email or newsletter' },
    { value: 'event', label: 'Event' },
  ],
};
export const AUDIENCE_OPTIONS: Record<'tech' | 'marketing', string[]> = {
  tech: ['Public on favorintl.org', 'Partners on the portal', 'Staff on FavorOS', 'Not sure who sees it'],
  marketing: ['Partners', 'Churches', 'Staff', 'Public', 'Not sure who sees it'],
};

export const placeLabel = (team: Team, value: string): string => (PLACE_OPTIONS[team === 'marketing' ? 'marketing' : 'tech'].find((o) => o.value === value)?.label ?? value);
export const kindLabel = (value: string): string => KIND_OPTIONS.find((o) => o.value === value)?.label ?? value;
export const teamLabel = (value: string): string => TEAM_OPTIONS.find((o) => o.value === value)?.label ?? value;

/** One answer the composer shows as a chip: the value, the words on the chip, and the reason shown on hover. */
export interface Chip<T = string> {
  value: T;
  label: string;
  why: string;
  /** True when the words said nothing and this is the default. */
  guess: boolean;
}

export interface PersonLite {
  email: string;
  name: string;
  team?: string;
  title?: string;
}

export interface Parsed {
  /** What the person typed, trimmed. */
  text: string;
  title: string;
  team: Chip<Team>;
  kind: Chip<Kind>;
  place: Chip<Place>;
  audience: Chip<string>;
  /** The date it is needed by, YYYY-MM-DD. */
  due: Chip<string>;
  needed: Needed;
  /** Who the person named, or the suggested owner. Null when neither exists. */
  assignee: Chip<string> | null;
  page_url: string;
  now: string;
  should: string;
}

const MARKETING_PLACE_WORDS: Array<[MarketingPlace, RegExp, string]> = [
  ['print', /\b(flyers?|brochures?|posters?|banners?|print(ed|ing)?|mailers?|postcards?|invitations?|appeal letters?|thank-?you packets?|merch\w*|t-?shirts?)\b/i, 'it names something printed'],
  ['social', /\b(social|instagram|facebook|reels?|tiktok|linkedin|youtube)\b/i, 'it names social media'],
  ['video', /\b(videos?|photos?|photograph\w*|footage|filming|film)\b/i, 'it names video or photos'],
  ['email', /\b(newsletter|e-?blast|email blast|email)\b/i, 'it names an email or newsletter'],
  ['event', /\b(booth|banquet|dinner|gala|conference|event)\b/i, 'it names an event'],
  ['design', /\b(design|graphic\w*|logo|slides?|deck|powerpoint|canva)\b/i, 'it names design work'],
];

const lowerS = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The staff member the words name: <@email>, @Name, "assign to Name", "ask Name", "hand to Name", "have Name". One match only. */
export function personFromText(text: string, people: PersonLite[]): { person: PersonLite; word: string } | null {
  if (!people.length) return null;
  const direct = /<@([^>\s]+)>/.exec(text);
  if (direct) {
    const p = people.find((x) => lowerS(x.email) === lowerS(direct[1]));
    if (p) return { person: p, word: direct[0] };
  }
  const found = new Map<string, { person: PersonLite; word: string }>();
  const first = (p: PersonLite) => lowerS(p.name).split(/\s+/)[0];
  const patterns = [
    /@([A-Za-z][A-Za-z'-]{1,30})(?:\s+([A-Za-z][A-Za-z'-]{1,30}))?/g,
    /\b(?:assign(?:ed)?(?: it)? to|ask|hand(?: it)? (?:to|off to)|give(?: it)? to|route(?: it)? to|send(?: it)? to|have|let)\s+([a-z][a-z'-]{1,30})(?:\s+([a-z][a-z'-]{1,30}))?\b/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const a = lowerS(m[1]);
      const full = m[2] ? `${a} ${lowerS(m[2])}` : '';
      const byFull = full ? people.filter((p) => lowerS(p.name) === full) : [];
      const pick = byFull.length ? byFull : people.filter((p) => first(p) === a);
      if (pick.length === 1) found.set(pick[0].email, { person: pick[0], word: m[0].trim() });
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

export interface ParseOptions {
  people?: PersonLite[];
  /** The person who usually takes this kind of request (server side: suggestOwner). */
  ownerGuess?: { email: string; name: string; why: string } | null;
}

/**
 * Reads the words into the composer's chips. Every chip has a plain reason for hover. Nothing here decides anything: the person
 * edits any chip before sending, and the server checks what comes back.
 */
export function parseRequest(textRaw: string, today: string, o: ParseOptions = {}): Parsed {
  const text = textRaw.trim();
  const fill = suggestFill(text, today);
  const route = routeByWords(text);
  const team: Team = route === 'marketing' ? 'marketing' : route === 'expense' ? 'expense' : 'tech';
  const teamChip: Chip<Team> = {
    value: team,
    label: teamLabel(team),
    why:
      route === 'marketing'
        ? 'it names design, print, social or video work, which Marketing does'
        : route === 'expense'
          ? 'it names buying something or spending money, which goes on an expense request'
          : route === 'board'
            ? 'it names the website, a tool or something technical, which Tech does'
            : 'no team is named, so Tech sorts it',
    guess: !route,
  };

  const pl = team === 'marketing' ? MARKETING_PLACE_WORDS.find(([, re]) => re.test(text)) : null;
  const surfaceHit = SURFACE_WORDS.find(([, re]) => re.test(text));
  const place: Chip<Place> =
    team === 'marketing'
      ? { value: pl ? pl[0] : 'design', label: placeLabel('marketing', pl ? pl[0] : 'design'), why: pl ? pl[2] : 'no kind of piece is named, so design', guess: !pl }
      : { value: fill.surface, label: placeLabel('tech', fill.surface), why: fill.why.surface, guess: !surfaceHit };

  const kind: Chip<Kind> = { value: fill.kind, label: kindLabel(fill.kind), why: fill.why.kind, guess: false };

  let audience: Chip<string>;
  if (team === 'marketing') {
    const staff = /\b(staff only|internal|only (the )?staff|for staff|our staff)\b/i.test(text);
    const church = /\bchurch(es)?\b/i.test(text);
    const partner = /\b(partners?|donors?|givers?|supporters?)\b/i.test(text);
    const pub = /\b(public|everyone|website visitors|community)\b/i.test(text);
    const v = staff ? 'Staff' : church ? 'Churches' : partner ? 'Partners' : pub ? 'Public' : 'Not sure who sees it';
    audience = {
      value: v,
      label: v,
      why: v === 'Not sure who sees it' ? 'the words do not say who it is for' : `it says ${v === 'Staff' ? 'staff' : v === 'Churches' ? 'churches' : v === 'Partners' ? 'partners' : 'the public'}`,
      guess: v === 'Not sure who sees it',
    };
  } else {
    const named = /\b(staff only|internal|only (the )?staff|for staff)\b/i.test(text) || (/\b(partners?|donors?|givers?)\b/i.test(text) && fill.surface === 'portal');
    audience = { value: fill.audience, label: fill.audience, why: named ? 'the words name who sees it' : `it follows ${placeLabel('tech', fill.surface).toLowerCase()}`, guess: !named };
  }

  const named = dateFromText(text, today);
  const due: Chip<string> = {
    value: fill.due_date,
    label: fill.due_date,
    why: fill.why.needed.charAt(0).toUpperCase() + fill.why.needed.slice(1),
    guess: !named && !URGENT.test(text) && !LAZY.test(text),
  };

  let assignee: Chip<string> | null = null;
  const said = personFromText(text, o.people || []);
  if (said) assignee = { value: said.person.email, label: said.person.name, why: `you wrote "${said.word}"`, guess: false };
  else if (o.ownerGuess && team !== 'expense') assignee = { value: o.ownerGuess.email, label: o.ownerGuess.name, why: o.ownerGuess.why, guess: true };

  return { text, title: fill.title, team: teamChip, kind, place, audience, due, needed: fill.needed, assignee, page_url: fill.page_url, now: fill.now, should: fill.should };
}
