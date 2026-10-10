// Support's entry work: reading rows copied from an RDD's tracking sheet, matching each to a partner, guarding against duplicates and
// working out which week a contact belongs to. Pure; the lookups it needs arrive as plain maps built by the caller.

export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function digits(s: unknown): string {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** How a contact went out, and what Blackbaud calls it. */
export const HOWS: Record<string, { label: string; category: string; outbound: boolean; tag?: string }> = {
  call: { label: 'Call', category: 'Phone call', outbound: true },
  vm: { label: 'Voicemail', category: 'Phone call', outbound: true },
  text: { label: 'Text', category: 'Phone call', outbound: true, tag: 'Texted' },
  email: { label: 'Email', category: 'Email', outbound: true },
  meet: { label: 'Meeting', category: 'Meeting', outbound: false },
  mail: { label: 'Mail', category: 'Mailing', outbound: true },
};

/** Tag keys on the entry grid and the Blackbaud action field each one writes. */
export const TAGS: Record<string, string> = {
  thanked: 'Thanked',
  texted: 'Texted',
  stewardship: 'Stewardship',
  scheduling: 'Scheduling',
};

export interface SheetRow {
  ticked: boolean;
  name: string;
  isNew: string;
  date: string; // the cell as typed
  phone: string;
  email: string;
  address: string;
  ask: string;
  act: string;
  notes: string;
}

/** Rows pasted from the sheet: tab separated, with or without the leading tick box column. Blank and header rows drop out. */
export function parseSheetText(text: string): { rows: SheetRow[]; unread: number } {
  const rows: SheetRow[] = [];
  let unread = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t').map((x) => x.trim());
    const off = /^(true|false)$/i.test(c[0] || '') ? 1 : 0;
    const name = c[off] || '';
    if (c.length < 2 || !name || /^name$/i.test(name)) {
      if (name && !/^name$/i.test(name)) unread++;
      continue;
    }
    rows.push({
      ticked: off === 1 && /^true$/i.test(c[0]),
      name,
      isNew: c[off + 1] || '',
      date: c[off + 2] || '',
      phone: c[off + 3] || '',
      email: (c[off + 4] || '').toLowerCase(),
      address: c[off + 5] || '',
      ask: c[off + 6] || '',
      act: c[off + 7] || '',
      notes: c[off + 8] || '',
    });
  }
  return { rows, unread };
}

/** "10/7", "10/7/26" or "10/7/2026" as YYYY-MM-DD, with the year taken from `today` when the cell has none. Empty when unreadable. */
export function toIso(cell: string, today: string): string {
  const m = String(cell || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return '';
  let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
  if (y < 100) y += 2000;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

export function channelOf(act: string, notes: string): string {
  const a = String(act || '').toLowerCase();
  const n = String(notes || '').toLowerCase();
  if (/\bvm\b|voicemail|voice mail/.test(a)) return 'vm';
  if (a.includes('text')) return 'text';
  if (a.includes('email') || a.includes('e-mail')) return 'email';
  if (/mail|letter|card/.test(a)) return 'mail';
  if (/meet|face|f-f|f2f|event|visit|lunch|golf|breakfast|dinner/.test(a)) return 'meet';
  if (a.includes('call') || a.includes('phone')) return 'call';
  if (/\bty card|letter|card\b/.test(n)) return 'mail';
  return '';
}

export function shortSummary(notes: string, ch: string): string {
  const n = String(notes || '').replace(/\s+/g, ' ').trim();
  if (!n) return ({ vm: 'Left a voicemail', call: 'Phone call', text: 'Texted', email: 'Email', meet: 'Meeting', mail: 'Mailed' } as Record<string, string>)[ch] || '';
  let first = n.split(/(?<=[.!?])\s/)[0];
  if (first.length > 110) first = first.slice(0, 107).replace(/\s+\S*$/, '') + '...';
  return first;
}

export function tagsOf(notes: string, act: string, ch: string): string[] {
  const tags: string[] = [];
  if (/\bty\b|thank/i.test(notes) || /\bty\b/i.test(act)) tags.push('thanked');
  if (ch === 'text') tags.push('texted');
  if (/schedul|request(ed)? (a )?vi?si?t|visit (for|on|during)|vist/i.test(notes)) tags.push('scheduling');
  return tags;
}

/** The ask amount from the Ask cell, or from "asked for $10k" in the notes. */
export function askOf(cell: string, notes: string): number | null {
  if (cell) {
    const v = Number(String(cell).replace(/[^\d.]/g, ''));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const m = String(notes || '').match(/ask(?:ed)? for \$?\s?(\d[\d,]*)(\s?[kK])?/);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Match keys for a sheet name: "Last, First", "First Last" and "Name - Organization". */
export function nameKeys(name: string): { keys: string[]; org: string } {
  let n = String(name || '');
  let org = '';
  if (n.includes(' - ')) {
    const [a, ...rest] = n.split(' - ');
    n = a.trim();
    org = rest.join(' - ').trim();
  }
  const keys: string[] = [];
  if (n.includes(',')) {
    const [l, ...f] = n.split(',');
    keys.push(norm(f.join(' ') + ' ' + l));
  }
  keys.push(norm(n));
  return { keys: keys.filter(Boolean), org };
}

export interface Lookups {
  byEmail: Map<string, string[]>;
  byPhone: Map<string, string[]>;
  byName: Map<string, string[]>;
  /** Partners each fundraiser holds now, for choosing between two records with one name. */
  holders: Map<string, string[]>;
  /** Records that exist and are active in the mirror. */
  present: Set<string>;
}

export type MatchHow = 'email' | 'phone' | 'name' | 'name_portfolio' | 'many' | 'none';

/** Partner by email, then phone, then exact name, then name inside the owner's portfolio. More than one hit asks a person to pick. */
export function resolvePartner(row: { email: string; phone: string; name: string }, owner: string, lk: Lookups): { how: MatchHow; hits: string[] } {
  const em = (row.email || '').toLowerCase();
  const ph = digits(row.phone);
  for (const [how, key, table] of [['email', em, lk.byEmail], ['phone', ph, lk.byPhone]] as const) {
    if (!key) continue;
    const hits = (table.get(key) || []).filter((c) => lk.present.has(c));
    if (hits.length === 1) return { how, hits };
    if (hits.length > 1) return { how: 'many', hits: hits.slice(0, 4) };
  }
  for (const key of nameKeys(row.name).keys) {
    const hits = lk.byName.get(key) || [];
    if (!hits.length) continue;
    if (hits.length === 1) return { how: 'name', hits };
    const mine = hits.filter((h) => (lk.holders.get(h) || []).includes(owner));
    if (mine.length === 1) return { how: 'name_portfolio', hits: mine };
    return { how: 'many', hits: hits.slice(0, 4) };
  }
  return { how: 'none', hits: [] };
}

export interface DoneAction {
  id: string;
  cid: string;
  due: string;
  added?: string;
  category?: string | null;
  fundraisers: string[];
}

/** A completed contact the same owner already logged on this partner within a day of the date. */
export function findDuplicate(cid: string, owner: string, date: string, done: DoneAction[]): DoneAction | null {
  const t = Date.parse(`${date}T12:00:00Z`);
  return (
    done.find((x) => x.cid === cid && x.fundraisers.includes(owner) && x.due && Math.abs(Date.parse(`${x.due.slice(0, 10)}T12:00:00Z`) - t) <= 86400000) || null
  );
}

const ET = 'America/New_York';

/** The Eastern calendar date and clock of an instant. */
export function etParts(d: Date): { date: string; hour: number; minute: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), dow };
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The instant that is hh:mm Eastern on a calendar date, whatever the daylight saving offset is that day. */
export function etInstant(ymd: string, hh: number, mm = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh + off, mm));
    const p = etParts(t);
    if (p.date === ymd && p.hour === hh && p.minute === mm) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, hh + 5, mm));
}

export interface WeekWindow {
  thisStart: string;
  thisEnd: string;
  lastStart: string;
  lastEnd: string;
  deadline: string; // ISO instant of Monday 3:00 PM Eastern after thisEnd
  deadlineLabel: string;
}

/**
 * The week whose contacts are due next: Monday to Sunday, due the following Monday at 3:00 PM Eastern.
 * On a Monday before 3:00 PM the week that just ended is still the one being collected.
 */
export function weekWindow(now: Date = new Date()): WeekWindow {
  const p = etParts(now);
  const mondayOf = (ymd: string, dow: number) => addDays(ymd, -((dow + 6) % 7));
  let thisStart = mondayOf(p.date, p.dow);
  if (p.dow === 1 && p.hour < 15) thisStart = addDays(thisStart, -7);
  const thisEnd = addDays(thisStart, 6);
  const due = addDays(thisEnd, 1);
  return {
    thisStart,
    thisEnd,
    lastStart: addDays(thisStart, -7),
    lastEnd: addDays(thisStart, -1),
    deadline: etInstant(due, 15, 0).toISOString(),
    deadlineLabel: 'Monday at 3:00 PM',
  };
}

export function weekOf(date: string, w: WeekWindow): 'this' | 'last' | 'late' {
  if (date >= w.thisStart && date <= w.thisEnd) return 'this';
  if (date >= w.lastStart && date <= w.lastEnd) return 'last';
  return 'late';
}

/** Short stable reference for a pasted row, so pasting the same rows twice adds them once. */
export function pasteRef(owner: string, row: Pick<SheetRow, 'name' | 'notes'>, date: string): string {
  const s = `${norm(row.name)}|${norm(row.notes)}`;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    h1 = ((h1 << 5) + h1 + s.charCodeAt(i)) >>> 0;
    h2 = ((h2 << 5) ^ h2 ^ s.charCodeAt(i)) >>> 0;
  }
  return `paste|${owner}|${date}|${h1.toString(36)}${h2.toString(36)}`;
}

/** Two picked records that share a last name and a city are probably one household. */
export function householdHints(picked: { cid: string; name: string; place: string }[], pool: { cid: string; name: string; place: string }[]): { a: string; b: string; as: string; bs: string }[] {
  const out: { a: string; b: string; as: string; bs: string }[] = [];
  const last = (n: string) => norm(n).split(' ').pop() || '';
  const seen = new Set(picked.map((x) => x.cid));
  for (const p of picked) {
    const twin = pool.find((x) => !seen.has(x.cid) && x.cid !== p.cid && x.place && x.place === p.place && last(x.name) === last(p.name));
    if (twin) out.push({ a: p.cid, b: twin.cid, as: p.name, bs: twin.name });
  }
  return out;
}

/** The action body for one entry row: one contact of the owner's type, completed, with the owner as fundraiser. */
export function entryBody(r: { cid: string; date: string; channel: string; summary: string; description?: string | null; owner: string; ownerType: string; extraFundraisers?: string[] }): Record<string, unknown> {
  const how = HOWS[r.channel];
  const body: Record<string, unknown> = {
    constituent_id: r.cid,
    category: how ? how.category : 'Phone call',
    type: r.ownerType,
    date: `${r.date}T00:00:00`,
    summary: String(r.summary || '').slice(0, 255),
    description: r.description || '',
    completed: true,
    completed_date: `${r.date}T00:00:00`,
    priority: 'Normal',
    fundraisers: [r.owner].concat((r.extraFundraisers || []).filter((x) => x !== r.owner)),
  };
  if (how && how.outbound) body.direction = 'Outbound';
  return body;
}

/** The tags an entry row writes: the ones picked, plus the one the channel implies. */
export function entryTags(channel: string, picked: string[]): string[] {
  const set = new Set(picked.filter((t) => TAGS[t]));
  const implied = HOWS[channel]?.tag;
  if (implied) set.add(implied.toLowerCase());
  return [...set];
}
