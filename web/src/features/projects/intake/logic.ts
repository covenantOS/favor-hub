// The rules the request screens share, as plain functions with no React and no browser: which tabs a person gets, how My requests is
// ordered, how a team's cards fall into the five columns, what the composer sends and what its footer says. Tested in
// tests/intake-web-logic.test.mjs. The server's rules live in functions/_lib/intake; these only decide what to draw.
import { stageOf, statusForSection, STATUS_WORD, type IntakeItem, type IntakeTeam, type PipelineTeam, type RequestStatus, type Stage } from '../../../../../shared/intake-model';
import { AUDIENCE_OPTIONS, PLACE_OPTIONS, type Parsed, type PersonLite } from '../../../../../shared/request-parse';
import type { Task } from '../types';

export const isOpen = (s: RequestStatus): boolean => s === 'inbox' || s === 'approved' || s === 'in_progress';

/* ------------------------------------------------------------------------------------------------ tabs */

export interface IntakeTab {
  id: 'intake' | 'requests';
  label: string;
  count: number;
}

/** How many of my requests are still open (Sent, Approved or In progress). */
export const openCount = (mine: Pick<IntakeItem, 'status'>[]): number => mine.filter((r) => isOpen(r.status)).length;

/**
 * The tabs this person gets after Team workload. Everyone gets My requests. People who triage a team (they own its pipeline, or are
 * admins) also get Intake, placed before it, counting the requests waiting in Intake or Triage on them (the same number as the Projects rail badge and the phone bar).
 */
export function intakeTabs(teams: Pick<IntakeTeam, 'counts'>[], mine: Pick<IntakeItem, 'status'>[]): IntakeTab[] {
  const out: IntakeTab[] = [];
  if (teams.length) out.push({ id: 'intake', label: 'Intake', count: teams.reduce((n, t) => n + (t.counts?.waiting ?? t.counts?.intake ?? 0), 0) });
  out.push({ id: 'requests', label: 'My requests', count: openCount(mine) });
  return out;
}

/** The tab the address asks for. A person who triages no team and opens ?tab=intake lands on My requests. */
export function resolveTab(urlTab: string | null | undefined, triages: boolean): 'intake' | 'requests' | null {
  if (urlTab === 'requests') return 'requests';
  if (urlTab === 'intake') return triages ? 'intake' : 'requests';
  return null;
}

/* ------------------------------------------------------------------------------------------------ My requests */

const rank = (r: Pick<IntakeItem, 'status' | 'question'>): number => (r.question && isOpen(r.status) ? 0 : isOpen(r.status) ? 1 : 2);

/** A question waiting on the person comes first, then open requests, then finished and declined ones; each group newest first. */
export function orderMine<T extends Pick<IntakeItem, 'status' | 'question' | 'created_at' | 'id'>>(list: T[]): T[] {
  return list.slice().sort((a, b) => rank(a) - rank(b) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
}

const first = (name: string | undefined | null): string => String(name || '').trim().split(/\s+/)[0] || '';

/** The line under a request on My requests that says who has it, or what it waits on. */
export function standingLine(r: Pick<IntakeItem, 'status' | 'question' | 'owner' | 'team_name'>): string {
  if (r.status === 'declined') return 'Closed';
  if (r.question && isOpen(r.status)) return 'Waiting for your answer';
  if (r.owner) return `${r.owner.name} has it`;
  if (r.status === 'done') return 'Finished';
  return `Waiting for ${r.team_name} to look at it`;
}

/** The last line of a request's history, for the foot of its card. */
export const lastMove = (r: Pick<IntakeItem, 'moves'>): string => (r.moves.length ? r.moves[r.moves.length - 1].text : '');

/* ------------------------------------------------------------------------------------------------ the Intake board */

export interface PipeCard {
  task: Task;
  item: IntakeItem | null;
}

export interface PipeColumn {
  id: string;
  name: string;
  stage: Stage | null;
  /** The word the person who asked reads for this column. */
  word: string;
  cards: PipeCard[];
  /** How many cards the column holds in all (Done shows only the latest ones). */
  total: number;
}

/**
 * The team's pipeline as columns in the order of its sections. A card sits where its task sits; the request behind it (when it is
 * one of the open ones the queue returned) decorates it. Done shows the latest finished cards, newest first.
 */
export function columnsFor(
  sections: { id: string; name: string }[],
  tasks: Task[],
  items: IntakeItem[],
  opts: { doneLimit?: number; counts?: Record<string, { open?: number; done?: number }> | null } = {}
): PipeColumn[] {
  const byTask = new Map<string, IntakeItem>();
  for (const i of items) if (i.task) byTask.set(i.task.id, i);
  const limit = opts.doneLimit ?? 20;
  return sections.map((s) => {
    const mine = tasks.filter((t) => t.section_id === s.id && t.status !== 'dropped');
    const doneCol = /^done$/i.test(s.name.trim());
    const sorted = doneCol ? mine.slice().sort((a, b) => String(b.done_at || b.updated_at || '').localeCompare(String(a.done_at || a.updated_at || ''))) : mine.slice().sort((a, b) => a.sort - b.sort);
    const c = opts.counts?.[s.id];
    const total = doneCol && c && typeof c.done === 'number' ? Math.max(c.done, mine.length) : mine.length;
    return {
      id: s.id,
      name: s.name,
      stage: stageOf(s.name),
      word: STATUS_WORD[statusForSection(s.name, true)],
      cards: (doneCol ? sorted.slice(0, limit) : sorted).map((t) => ({ task: t, item: byTask.get(t.id) || null })),
      total,
    };
  });
}

/** The tag text on a card whose question is open ("Waiting on Vic"). */
export const waitingOn = (item: Pick<IntakeItem, 'question' | 'submitter'>): string => (item.question ? `Waiting on ${first(item.submitter?.name) || 'the person who asked'}` : '');

/* ------------------------------------------------------------------------------------------------ the composer */

export type TeamValue = 'tech' | 'marketing' | 'expense';

/** What the person changed on the chips. Absent keys follow the words. */
export interface Edits {
  team?: TeamValue;
  kind?: string;
  place?: string;
  audience?: string;
  /** YYYY-MM-DD, or '' for no date. */
  due?: string;
  /** An email, or '' for nobody. */
  ask?: string;
}

export interface Effective {
  team: TeamValue;
  kind: string;
  place: string;
  audience: string;
  due: string;
  ask: string;
}

const pack = (team: TeamValue): 'tech' | 'marketing' => (team === 'marketing' ? 'marketing' : 'tech');

/** The value every chip shows: the edit when there is one, else what the words say. A new team resets Where and Who sees it. */
export function effective(p: Parsed, e: Edits): Effective {
  const team = e.team ?? p.team.value;
  const same = team === p.team.value;
  const place = e.place ?? (same ? p.place.value : PLACE_OPTIONS[pack(team)][0].value);
  const audience = e.audience ?? (same ? p.audience.value : AUDIENCE_OPTIONS[pack(team)].slice(-1)[0]);
  return { team, kind: e.kind ?? p.kind.value, place, audience, due: e.due !== undefined ? e.due : p.due.value, ask: e.ask !== undefined ? e.ask : p.assignee ? p.assignee.value : '' };
}

/** Changing the team throws away an edited Where and Who sees it, because the choices differ by team. */
export function applyEdit(edits: Edits, key: keyof Edits, value: string): Edits {
  const next: Edits = { ...edits, [key]: value };
  if (key === 'team') {
    delete next.place;
    delete next.audience;
  }
  return next;
}

/** The body for POST /api/tasks/intake/submit: the chips as shown, but a suggested owner nobody confirmed is left out. */
export function submitBody(text: string, p: Parsed, e: Edits): { text: string; team: string; kind: string; place: string; audience: string; due_date: string | null; assignee?: string | null } {
  const v = effective(p, e);
  const body: { text: string; team: string; kind: string; place: string; audience: string; due_date: string | null; assignee?: string | null } = {
    text: text.trim(),
    team: v.team,
    kind: v.kind,
    place: v.place,
    audience: v.audience,
    due_date: v.due || null,
  };
  if (e.ask !== undefined) body.assignee = e.ask || null;
  else if (p.assignee && !p.assignee.guess) body.assignee = p.assignee.value;
  return body;
}

/** The person who triages a team, read from the staff list the way the server picks a pipeline's lead. Null when the list names nobody. */
export function triagerOf(team: PipelineTeam, people: (PersonLite & { team?: string; title?: string })[]): PersonLite | null {
  if (team === 'tech') return people.find((p) => /lead developer/i.test(p.title || '')) || people.find((p) => /developer/i.test(p.title || '')) || null;
  const m = people.filter((p) => /marketing/i.test(p.team || ''));
  return m.find((p) => /director|manager|lead/i.test(p.title || '')) || m[0] || null;
}

/** The composer's footer in two parts, so the board's name can be set in bold: where the request lands and who reads it first. */
export function whereParts(team: TeamValue | null, triager: string | null): { strong: string; rest: string } {
  if (!team) return { strong: '', rest: "Lands in Intake on the owning team's board." };
  if (team === 'expense') return { strong: '', rest: 'Goes to the expense form, not to a board.' };
  const label = team === 'marketing' ? 'Marketing' : 'Tech';
  return { strong: `${label} requests`, rest: `, Intake. ${triager || label} triages it.` };
}

export const whereLands = (team: TeamValue | null, triager: string | null): string => {
  const w = whereParts(team, triager);
  return w.strong + w.rest;
};

/** Pictures, PDFs, Word and text files, up to 6, the same as the old form. */
export const FILE_OK = /\.(jpe?g|png|webp|gif|pdf|docx?|txt)$/i;
export const FILE_MIME = /^(image\/(jpeg|png|webp|gif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain)$/;
export const MAX_FILES = 6;
export const MAX_FILE_MB = 4;

export const fileAllowed = (f: { name?: string; type?: string; size?: number }): boolean => (FILE_MIME.test(f.type || '') || FILE_OK.test(f.name || '')) && (f.size ?? 0) <= MAX_FILE_MB * 1024 * 1024;

/** Adds files to the ones already chosen, dropping what is not allowed and anything past six. Returns the list and what it refused. */
export function addFiles<T extends { name?: string; type?: string; size?: number }>(have: T[], add: T[]): { files: T[]; refused: number } {
  const files = have.slice();
  let refused = 0;
  for (const f of add) {
    if (!fileAllowed(f) || files.length >= MAX_FILES) {
      refused++;
      continue;
    }
    files.push(f);
  }
  return { files, refused };
}

/** A date as the chips and cards show it: "Fri, Oct 30". UTC on purpose, so the server and the browser agree. */
export function fullDate(d: string | null | undefined): string {
  if (!d) return '';
  const x = new Date(d + 'T12:00:00Z');
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How long ago, in words: "just now", "5 min ago", "2 hours ago", "yesterday", "5 days ago", then "on Oct 12". */
export function when(iso: string | null | undefined, now = Date.now()): string {
  const t = Date.parse(String(iso || ''));
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  if (s < 172800) return 'yesterday';
  if (s < 14 * 86400) return Math.floor(s / 86400) + ' days ago';
  const d = new Date(t);
  return 'on ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
