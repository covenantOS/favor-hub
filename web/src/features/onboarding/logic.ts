// Onboarding and offboarding: the pure rules behind the two screens (types, formatters, the staff search, the request bodies, which
// buttons a person gets on a step). No window, no document, no fetch, so the same text draws on the server and in the browser and
// tests/onboarding-web.test.mjs can run every rule on its own.

export type Kind = 'onboard' | 'offboard';

export interface Person {
  email: string;
  name: string;
  picture?: string;
  team?: string;
  title?: string;
}

export interface Duty {
  key: string;
  label: string;
  hint: string;
}

export interface Group {
  key: string;
  label: string;
}

export interface RunSummary {
  id: string;
  kind: Kind;
  email: string;
  name: string;
  title: string;
  team: string;
  supervisor_email: string;
  date: string;
  status: string;
  steps: number;
  done: number;
  late: number;
  next: { title: string; due: string | null; owner: string } | null;
}

export interface Run {
  id: string;
  kind: Kind;
  email: string;
  name: string;
  title: string;
  team: string;
  supervisor_email: string;
  date: string;
  status: string;
  stays: number;
  welcome: string;
  created_by: string;
}

export interface Step {
  id: string;
  key: string;
  grp: string;
  title: string;
  detail: string;
  kind: string;
  duty: string;
  owner_email: string;
  owner_name: string;
  due_date: string | null;
  status: string;
  done_by: string | null;
  done_at: string | null;
  link_url: string;
  link_label: string;
  mine: boolean;
  overdue: boolean;
  fallback: boolean;
}

export interface Detail {
  run: Run;
  steps: Step[];
  groups: Group[];
  docs: Array<{ key: string; label: string; got: boolean; got_at: string | null }>;
  people: Record<string, { name: string; picture: string; title: string }>;
  can: { manage: boolean; hub?: boolean };
  progress: { done: number; total: number };
  events: Array<{ actor: string; event: string; detail: string; at: string }>;
  tasks: boolean;
  learn: boolean;
}

export interface Owned {
  tasks: Array<{ id: string; code: string | null; title: string; due: string | null }>;
  requests: Array<{ id: string; title: string; due: string | null }>;
  reports: Array<{ email: string; name: string }>;
  learn: number;
  counts: { tasks: number; requests: number; reports: number };
}

export interface TemplateStep {
  key: string;
  grp: string;
  sort: number;
  title: string;
  detail: string;
  duty: string;
  offset_days: number;
  active: boolean;
  edited: boolean;
}

export interface Template {
  kind: Kind;
  steps: TemplateStep[];
  groups: Group[];
  duties: Duty[];
}

export interface DoneItem {
  what: string;
  state: string;
  note?: string;
}

/* ---------------------------------------------------------------- words and dates */

export const TZ = 'America/New_York';

/** "Mon, Oct 12" or, with the year, "Mon, Oct 12, 2026". The date is a calendar day, read at noon UTC so no zone moves it. */
export const dayWord = (d: string | null | undefined, withYear = false): string =>
  d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined }) : '';

export const first = (n: string | null | undefined): string => String(n || '').trim().split(/\s+/)[0] || '';

export const pct = (done: number, total: number): number => (total ? Math.round((done / total) * 100) : 0);

export const kindWord = (k: string): string => (k === 'offboard' ? 'Offboarding' : 'Onboarding');

export const dateWord = (r: { kind: string; date: string }): string => (r.kind === 'offboard' ? `Last day ${dayWord(r.date)}` : `Starts ${dayWord(r.date)}`);

export const initials = (n: string | null | undefined): string =>
  String(n || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

export const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
/** The avatar color for a person, from the address: the same pick on every screen and on both sides of the hydration. */
export const hue = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % 7];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 12, 3:45 PM" in Eastern time, from an ISO moment. Built from parts so the space before PM is a plain space on both sides. */
export function etTime(iso: string | null | undefined): string {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${MONTHS[Number(get('month')) - 1] || ''} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** Today as YYYY-MM-DD in Eastern time. */
export const todayET = (now: Date = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: TZ });

/** The first Monday after the given day (the default start date for a new hire). */
export function mondayAfter(day: string): string {
  const d = new Date(day + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- the staff list */

/** A person for an address, with a name made from the address when the staff list has no row. */
export function personIn(list: Person[], email: string | null | undefined): Person {
  const e = String(email || '').toLowerCase();
  const p = list.find((x) => x.email.toLowerCase() === e);
  if (p) return p;
  return { email: String(email || ''), name: e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), team: '', title: '', picture: '' };
}

/**
 * Every word typed must appear in the name, address, team or title. A name whose first word starts with the first typed word comes
 * first, then any name with a word that does, then the rest, each group in list order.
 */
export function matchPeople(list: Person[], q: string): Person[] {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list.slice();
  const rank = (p: Person) => {
    const n = p.name.toLowerCase();
    if (n.startsWith(words[0])) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1;
    return 2;
  };
  return list
    .filter((p) => words.every((w) => `${p.name} ${p.email} ${p.team || ''} ${p.title || ''}`.toLowerCase().includes(w)))
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

export const personSub = (p: Person): string => [p.team, p.title].filter(Boolean).join(' · ');

/* ---------------------------------------------------------------- the list page */

export type ListTab = 'active' | 'done' | 'checklist' | 'owners';

/** The tab a link such as /onboarding/#done opens. Checklist and Owners belong to people who manage. */
export function tabFromHash(hash: string, manage: boolean): ListTab {
  const want = String(hash || '').replace('#', '');
  if (want === 'done') return 'done';
  if ((want === 'checklist' || want === 'owners') && manage) return want;
  return 'active';
}

export const tabHash = (tab: ListTab): string => (tab === 'active' ? '' : '#' + tab);

export function listTabs(manage: boolean, activeCount: number): Array<{ key: ListTab; label: string; count?: number }> {
  const base: Array<{ key: ListTab; label: string; count?: number }> = [
    { key: 'active', label: 'In progress', count: activeCount },
    { key: 'done', label: 'Finished' },
  ];
  return manage ? base.concat([{ key: 'checklist', label: 'Checklist' }, { key: 'owners', label: 'Owners' }]) : base;
}

export function lede(runs: Array<{ kind: string }>): string {
  const on = runs.filter((r) => r.kind === 'onboard').length;
  const off = runs.filter((r) => r.kind === 'offboard').length;
  return `${on} onboarding and ${off} offboarding in progress.`;
}

export const DUTY_WORD: Record<string, string> = { supervisor: 'The supervisor', hire: 'The new hire', starter: 'Whoever starts the run' };
export const dutyWord = (d: { key: string; label: string }): string => DUTY_WORD[d.key] || d.label;
export const dayLabel = (kind: Kind): string => (kind === 'onboard' ? 'start date' : 'last day');

/** The steps of one phase, in the template's own order. */
export const stepsOfGroup = (t: Template, group: string): TemplateStep[] => t.steps.filter((s) => s.grp === group).sort((a, b) => a.sort - b.sort);

/** The template after one field of one step changed (the server has saved it): the step is marked as edited. */
export function withEdit(t: Template, key: string, field: string, value: string | number | boolean): Template {
  return { ...t, steps: t.steps.map((s) => (s.key === key ? ({ ...s, [field]: value, edited: true } as TemplateStep) : s)) };
}

export const anyEdited = (t: Template): boolean => t.steps.some((s) => s.edited);

/** What a changed checklist field sends: a number box sends a number (0 when empty), a box a true or false, the rest text. */
export function templateValue(type: string, value: string, checked: boolean): string | number | boolean {
  if (type === 'checkbox') return checked;
  if (type === 'number') return Number(value) || 0;
  return value;
}

/* ---------------------------------------------------------------- starting a run */

export interface OnboardForm {
  name: string;
  email: string;
  title: string;
  team: string;
  date: string;
  hq: boolean;
  welcome: string;
  supervisor: string;
}
export interface OffboardForm {
  who: string;
  date: string;
  stays: boolean;
  supervisor: string;
}

export function onboardBody(f: OnboardForm): Record<string, unknown> {
  return { kind: 'onboard', date: f.date, supervisor_email: f.supervisor, name: f.name.trim(), email: f.email.trim().toLowerCase(), title: f.title.trim(), team: f.team.trim(), hq: f.hq, welcome: f.welcome.trim() };
}

export function offboardBody(f: OffboardForm, who: Person | null): Record<string, unknown> {
  return { kind: 'offboard', date: f.date, supervisor_email: f.supervisor, email: f.who || '', name: who ? who.name : '', title: who ? who.title || '' : '', team: who ? who.team || '' : '', stays: f.stays };
}

export const teamsOf = (list: Person[]): string[] => [...new Set(list.map((p) => p.team).filter((t): t is string => !!t))].sort();

/** What the run page remembers for the banner after a start. */
export interface Fresh {
  id: string;
  unset: string[];
  steps: number;
}

export const DUTY: Record<string, string> = { hr: 'HR file and shared drive', directory: 'Staff directory and groups', whatsapp: 'WhatsApp', training: 'Training', tech: 'Technical access', overseer: 'Oversight' };

export function bannerFor(n: Fresh, d: Pick<Detail, 'run' | 'tasks'>): { title: string; lines: string[] } {
  const lines = [`${n.steps} steps, each with an owner and a due date${d.tasks ? ', and each one a task in Projects' : ''}.`];
  if (n.unset && n.unset.length) lines.push(`No owner is set for ${n.unset.map((k) => DUTY[k] || k).join(', ')}. Those steps went to you. Set owners on the Onboarding page, under Owners.`);
  return { title: `${kindWord(d.run.kind)} started for ${d.run.name}`, lines };
}

/* ---------------------------------------------------------------- the run page */

export interface Gate {
  manage: boolean;
  status: string;
}

export const isClosed = (status: string): boolean => status !== 'active';

/** Who may tick a step: an admin or HR on any step, the step's owner on theirs, nobody once the run is closed, and an owner never on a step FavorOS does itself. */
export function canTick(g: Gate, s: Pick<Step, 'mine' | 'kind'>): boolean {
  return !isClosed(g.status) && (g.manage || s.mine) && !(s.kind === 'auto' && !g.manage);
}

export const canChange = (g: Gate): boolean => g.manage && !isClosed(g.status);

/** The FavorOS button on an open step it does itself, or nothing. */
export function autoAction(g: Gate, s: Pick<Step, 'kind' | 'status' | 'key'>): 'hubadd' | 'hubclose' | 'handover' | '' {
  if (s.kind !== 'auto' || s.status !== 'open' || !canChange(g)) return '';
  if (s.key === 'hubadd' || s.key === 'hubclose' || s.key === 'handover') return s.key;
  return '';
}

export function groupSections(d: Pick<Detail, 'groups' | 'steps'>): Array<{ group: Group; steps: Step[]; done: number; total: number }> {
  return d.groups
    .map((group) => {
      const steps = d.steps.filter((s) => s.grp === group.key);
      return { group, steps, done: steps.filter((s) => s.status === 'done').length, total: steps.filter((s) => s.status !== 'skipped').length };
    })
    .filter((x) => x.steps.length);
}

export const docsGot = (docs: Array<{ got: boolean }>): number => docs.filter((x) => x.got).length;

/** The History lines: the actor and the event, then the detail unless it is raw JSON, cut at 80 characters. */
export const eventLine = (e: { actor: string; event: string; detail: string }): string => `${e.actor} ${e.event}${e.detail && e.detail[0] !== '{' ? ': ' + e.detail.slice(0, 80) : ''}`;

/** A due-date chip's words. */
export const dueWord = (s: Pick<Step, 'due_date' | 'overdue'>): string => (s.overdue ? 'Late, ' : 'Due ') + dayWord(s.due_date);

/** The lines in the Add to FavorOS confirmation. */
export function hubAddLines(d: Pick<Detail, 'run' | 'steps' | 'people'>): string[] {
  const r = d.run;
  const sup = r.supervisor_email && d.people[r.supervisor_email] ? d.people[r.supervisor_email].name : '';
  const due = (label: string, key: string) => {
    const x = d.steps.find((s) => s.key === key);
    return `${label}${x && x.due_date ? ', due ' + dayWord(x.due_date) : ''}`;
  };
  return [
    'A FavorOS account, so they can sign in with their Favor Google account',
    'A place on the staff list in pickers and Chat',
    `${sup ? 'Supervisor ' + sup + ' and ' : ''}start date ${dayWord(r.date, true)}`,
    'The default Chat channels',
    due('New hire: FavorOS', 'ospath'),
    due('New hire: Favor', 'favpath'),
  ];
}

export const CLOSE_LINES = ['Blocks the FavorOS account and ends every open sign-in', 'Removes the Google link', 'Takes them off the staff list in pickers and Chat', 'Closes their assignments in Learn'];

/** The words for an answer the page cannot draw. */
export function failureWord(status: number, message: string, scope: 'list' | 'run'): string {
  if (status === 503) return 'Onboarding is not switched on yet.';
  if (scope === 'run' && status === 403) return 'This onboarding is for HR, the supervisor and the people who own its steps.';
  if (scope === 'run' && status === 404) return 'No such onboarding.';
  return message;
}

export const moveWord = (m: { tasks: number; requests: number; reports: number }, to: string): string => `Moved ${m.tasks} tasks, ${m.requests} request cards, ${m.reports} reports to ${to}`;

/** The run id a link names: ?id=. */
export const runIdOf = (search: Record<string, unknown>): string => (typeof search.id === 'string' ? search.id : '');

/** The ?start= link from Admin > People: the kind to open the sheet for and the person to fill in. */
export function startRequest(search: Record<string, unknown>): { kind: Kind; email: string; name: string } | null {
  const k = search.start;
  if (k !== 'onboard' && k !== 'offboard') return null;
  return { kind: k, email: typeof search.email === 'string' ? search.email : '', name: typeof search.name === 'string' ? search.name : '' };
}
