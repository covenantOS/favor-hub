// The Asana importer. It reads one Source (the API or an export file, see asana.ts) and writes hub projects, sections, tasks,
// subtasks, comments, files, dependencies, tags and custom fields into the tables of db/projects.sql.
//
// Rules it keeps:
//   idempotent   every Asana gid is kept in hub_asana_map; a second run updates the row, it never inserts a second copy. A hub row an
//                admin edited after the last import is left alone (counted as "kept hub edits") unless the run says overwrite.
//   resumable    a run is a row (hub_asana_runs) with a cursor. stepRun() does a slice of work inside a time and call budget, saves the
//                cursor and returns; the Admin page calls it again until the run is done. A rate limit pauses the run, it does not fail it.
//   quiet        no notice, email, Chat card or Google Calendar event is made for anything imported.
//   read only    on the Asana side only GET requests are made.
// A dry run walks the same path and writes nothing except its own report and log.
import { newId, type Env } from '../http';
import { staffDirectory } from '../people';
import {
  AsanaAuthError, hubColor, OffsetExpired, RateLimited,
  type AAttachment, type AField, type AProject, type ASection, type AStory, type ATask, type AUser, type Source,
} from './asana';

export const MAX_COPY_BYTES = 60 * 1024 * 1024;
const UNTITLED = 'untitled section';
const lower = (v: unknown) => String(v || '').trim().toLowerCase();

export interface RunOptions {
  /** Shown as the team chip on every project made. */
  team?: string;
  visibility?: 'staff' | 'members';
  /** Only tasks Asana changed since this time (re-runs). */
  since?: string;
  /** Replace hub rows an admin edited after the last import. */
  overwrite?: boolean;
  /** Asana email -> hub email, for people whose Asana address differs from their Favor address. */
  emailMap?: Record<string, string>;
  /** Export files: the upload to read. */
  upload?: string;
  /** Copy asana-hosted files into the hub (default on). Off keeps them as links. */
  copyFiles?: boolean;
}

export interface Pick {
  ref: string;
  name: string;
}

export interface Cursor {
  pi: number;
  phase: 'meta' | 'tasks' | 'link' | 'done';
  offset: string | null;
  skip: number;
  n: number;
  /** After an expired page marker: how many tasks to pass over before work starts again. */
  ff?: number;
}

export interface ProjReport {
  name: string;
  hub_id?: string;
  key?: string;
  expected: number | null;
  project: 'create' | 'update' | 'same' | 'kept';
  sections: { create: number; update: number; same: number };
  tasks: { create: number; update: number; same: number; kept: number; alsoIn: number; subtasks: number; errors: number };
  comments: { create: number; update: number; same: number };
  files: { copy: number; link: number; same: number; failed: number };
  deps: number;
  tags: number;
  fields: number;
  done: boolean;
  hubCount?: number;
}
export interface Unmatched {
  name: string;
  email: string;
  reason: string;
  assigned: number;
  asked: number;
  comments: number;
  projects: string[];
}
export interface FileProblem {
  project: string;
  task: string;
  name: string;
  size: number | null;
  host: string;
  reason: string;
  url: string;
}
export interface Report {
  projects: Record<string, ProjReport>;
  people: { matched: number; unmatched: Record<string, Unmatched> };
  files: { problems: FileProblem[] };
  deps: { linked: number; outside: number; cycles: number };
  warnings: string[];
}

export interface RunRow {
  id: string;
  mode: 'dry' | 'import';
  source: 'api' | 'export';
  status: 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
  selection: Pick[];
  options: RunOptions;
  cursor: Cursor;
  report: Report;
  resume_at: string | null;
  from_dry_run: string | null;
  calls: number;
  error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export const emptyReport = (): Report => ({ projects: {}, people: { matched: 0, unmatched: {} }, files: { problems: [] }, deps: { linked: 0, outside: 0, cycles: 0 }, warnings: [] });
const emptyProj = (name: string): ProjReport => ({
  name, expected: null, project: 'same', sections: { create: 0, update: 0, same: 0 },
  tasks: { create: 0, update: 0, same: 0, kept: 0, alsoIn: 0, subtasks: 0, errors: 0 }, comments: { create: 0, update: 0, same: 0 },
  files: { copy: 0, link: 0, same: 0, failed: 0 }, deps: 0, tags: 0, fields: 0, done: false,
});

/* ---------------------------------------------------------------------------------------------------- run rows */

const J = (v: unknown, d: any) => {
  try {
    return typeof v === 'string' && v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};

export function rowToRun(r: any): RunRow {
  return {
    id: r.id, mode: r.mode, source: r.source, status: r.status, selection: J(r.selection, []), options: J(r.options, {}),
    cursor: J(r.cursor, { pi: 0, phase: 'meta', offset: null, skip: 0, n: 0 }), report: { ...emptyReport(), ...J(r.report, {}) },
    resume_at: r.resume_at || null, from_dry_run: r.from_dry_run || null, calls: Number(r.calls) || 0, error: r.error || '', created_by: r.created_by,
    created_at: r.created_at, updated_at: r.updated_at, finished_at: r.finished_at || null,
  };
}

export async function getRun(env: Env, id: string): Promise<RunRow | null> {
  const r = await env.DB.prepare('SELECT * FROM hub_asana_runs WHERE id = ?').bind(id).first();
  return r ? rowToRun(r) : null;
}

export async function createRun(
  env: Env,
  a: { mode: 'dry' | 'import'; source: 'api' | 'export'; selection: Pick[]; options: RunOptions; by: string; fromDry?: string | null; now?: string }
): Promise<RunRow> {
  const id = newId('asr');
  const at = a.now || new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO hub_asana_runs (id, mode, source, status, selection, options, cursor, report, from_dry_run, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, a.mode, a.source, JSON.stringify(a.selection), JSON.stringify(a.options), JSON.stringify({ pi: 0, phase: 'meta', offset: null, skip: 0, n: 0 }), JSON.stringify(emptyReport()), a.fromDry || null, a.by, at, at)
    .run();
  return (await getRun(env, id))!;
}

/* ------------------------------------------------------------------------------------------------------ people */

export interface PeopleIndex {
  known: Set<string>;
  blocked: Set<string>;
  byName: Map<string, string>;
  emailMap: Record<string, string>;
}

export async function loadPeople(env: Env, emailMap: Record<string, string> = {}): Promise<PeopleIndex> {
  const dir = await staffDirectory(env).catch(() => []);
  const users = await env.DB.prepare('SELECT email, name, blocked FROM hub_users').all<{ email: string; name: string; blocked: number }>().catch(() => ({ results: [] as any[] }));
  const known = new Set<string>();
  const blocked = new Set<string>();
  const names = new Map<string, string[]>();
  for (const p of dir) {
    known.add(lower(p.email));
    names.set(lower(p.name), [...(names.get(lower(p.name)) || []), lower(p.email)]);
  }
  for (const u of users.results || []) {
    const e = lower(u.email);
    if (u.blocked) blocked.add(e);
    else if (!known.has(e)) {
      known.add(e);
      names.set(lower(u.name), [...(names.get(lower(u.name)) || []), e]);
    }
  }
  const byName = new Map<string, string>();
  for (const [n, list] of names) if (n && new Set(list).size === 1) byName.set(n, list[0]);
  const em: Record<string, string> = {};
  for (const [k, v] of Object.entries(emailMap || {})) em[lower(k)] = lower(v);
  return { known, blocked, byName, emailMap: em };
}

export function matchPerson(ix: PeopleIndex, u: AUser | null): { email: string | null; reason: string } {
  if (!u) return { email: null, reason: 'none' };
  let e = lower(u.email);
  if (e && ix.emailMap[e]) e = ix.emailMap[e];
  if (e && ix.known.has(e)) return { email: e, reason: '' };
  if (!e && u.name) {
    const n = ix.byName.get(lower(u.name));
    if (n) return { email: n, reason: '' };
    return { email: null, reason: 'Asana gave no email and the name matches no one on the hub list' };
  }
  if (!e) return { email: null, reason: 'Asana gave no email or name' };
  return { email: null, reason: ix.blocked.has(e) ? 'the hub account is closed' : 'not on the hub staff list' };
}

/* ----------------------------------------------------------------------------------------------------- helpers */

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/** An ISO time in Eastern, as {date, time}. */
export function easternParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function projectKeyCandidates(name: string): string[] {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.join('').replace(/[^A-Z]/g, '');
  const out: string[] = [];
  const initials = words.map((w) => w.replace(/[^A-Z]/g, '')[0] || '').join('');
  if (initials.length >= 2) out.push(initials.slice(0, 5));
  for (const n of [3, 4, 5, 2]) if (letters.length >= n) out.push(letters.slice(0, n));
  const base = (letters + 'XX').slice(0, 2);
  for (let i = 0; i < 26 * 26; i++) out.push(base + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String.fromCharCode(65 + Math.floor(i / 26) - 1) : ''));
  return [...new Set(out.filter((k) => /^[A-Z]{2,5}$/.test(k)))];
}

const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';

const PRIORITY_HIGH = /high|urgent|critical|top|\bp1\b|asap/;
const PRIORITY_LOW = /\blow\b|\bp3\b|someday/;
function priorityOf(fields: AField[]): string {
  const f = fields.find((x) => /^priority$/i.test(x.name));
  const v = lower(f?.value);
  if (!v) return 'normal';
  return PRIORITY_HIGH.test(v) ? 'high' : PRIORITY_LOW.test(v) ? 'low' : 'normal';
}
function statusOf(t: ATask): string {
  if (t.completed) return 'done';
  const v = lower(t.fields.find((x) => /^status$/i.test(x.name))?.value);
  if (!v) return 'open';
  if (/cancel|drop|declin|won'?t/.test(v)) return 'dropped';
  if (/wait|hold|block|pending/.test(v)) return 'waiting';
  if (/progress|doing|working|started|review|draft/.test(v)) return 'doing';
  if (/done|complete|finish/.test(v)) return 'done';
  return 'open';
}
function codeField(fields: AField[], re: RegExp): string | null {
  const f = fields.find((x) => re.test(x.name.trim()));
  return f && f.value ? clip(f.value, 60) : null;
}
const REQUESTERISH = /requester|requested by|on behalf of|submitted by/i;

/* ---------------------------------------------------------------------------------------------------- the engine */

export interface StepDeps {
  makeSource(run: RunRow, budget: { deadline: number }): Promise<Source>;
  now?: () => number;
  budgetMs?: number;
  maxOps?: number;
  maxCalls?: number;
  uploads?: R2Bucket;
  /** The address a copied file is read from, given its task and file ids (CORE's download route when unset). */
  fileUrl?: (taskId: string, fileId: string, key: string) => string;
}

class Acc {
  matched = 0;
  unmatched: Record<string, Unmatched> = {};
}

interface TaskCtx {
  ref: string;
  rep: ProjReport;
  hubProject: string;
  key: string;
  parentId: string | null;
  parentSection: string | null;
  order: number;
  depth: number;
  acc: Acc;
}

export class Engine {
  env: Env;
  run: RunRow;
  src: Source;
  deps: StepDeps;
  dry: boolean;
  people!: PeopleIndex;
  ops = 0;
  log: Array<{ level: string; text: string }> = [];
  private now: () => number;
  private deadline: number;
  private sectionIds = new Map<string, string | null>();
  private lead = '';
  private memberSeen = new Set<string>();
  private ts: string;

  constructor(env: Env, run: RunRow, src: Source, deps: StepDeps, deadline: number) {
    this.env = env;
    this.run = run;
    this.src = src;
    this.deps = deps;
    this.dry = run.mode === 'dry';
    this.now = deps.now || Date.now;
    this.deadline = deadline;
    this.ts = new Date(this.now()).toISOString();
  }

  private say(level: string, text: string) {
    this.log.push({ level, text });
  }
  private async q<T = any>(sql: string, ...a: unknown[]): Promise<T | null> {
    this.ops++;
    return (await this.env.DB.prepare(sql).bind(...a).first<T>()) ?? null;
  }
  private async qa<T = any>(sql: string, ...a: unknown[]): Promise<T[]> {
    this.ops++;
    return ((await this.env.DB.prepare(sql).bind(...a).all<T>()).results || []) as T[];
  }
  private async batch(list: Array<{ sql: string; a: unknown[] }>) {
    if (this.dry || !list.length) return;
    this.ops++;
    await this.env.DB.batch(list.map((x) => this.env.DB.prepare(x.sql).bind(...x.a)));
  }
  private overBudget() {
    return this.now() > this.deadline || this.src.calls >= (this.deps.maxCalls ?? 150) || this.ops >= (this.deps.maxOps ?? 500);
  }
  private mapGet(kind: string, gid: string) {
    return this.q<{ hub_id: string; project_gid: string; hash: string; asana_modified: string; synced_at: string }>(
      'SELECT hub_id, project_gid, hash, asana_modified, synced_at FROM hub_asana_map WHERE kind = ? AND gid = ?', kind, gid
    );
  }
  private mapPut(kind: string, gid: string, hubId: string, projectGid: string, hash: string, modified = '') {
    return {
      sql: `INSERT INTO hub_asana_map (kind, gid, hub_id, project_gid, hash, asana_modified, synced_at, first_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(kind, gid) DO UPDATE SET hub_id = excluded.hub_id, project_gid = excluded.project_gid, hash = excluded.hash, asana_modified = excluded.asana_modified, synced_at = excluded.synced_at`,
      a: [kind, gid, hubId, projectGid, hash, modified, this.ts, this.run.id],
    };
  }

  /** Runs until the budget is spent, the run is finished or a rate limit pauses it. Returns the run's new state. */
  async work(): Promise<void> {
    const run = this.run;
    this.people = await loadPeople(this.env, run.options.emailMap);
    this.lead = lower(run.created_by);
    const c = run.cursor;
    while (c.phase !== 'done') {
      if (this.overBudget()) return;
      const pick = run.selection[c.pi];
      if (c.phase === 'meta') {
        if (!pick) {
          c.phase = 'link';
          continue;
        }
        await this.meta(pick);
        c.phase = 'tasks';
        c.offset = null;
        c.skip = 0;
        c.n = 0;
        continue;
      }
      if (c.phase === 'tasks') {
        const rep = run.report.projects[pick.ref];
        let page;
        try {
          page = await this.src.taskPage(pick.ref, c.offset, { since: run.options.since });
          if (c.ff) {
            while (c.ff >= page.tasks.length && page.next) {
              c.ff -= page.tasks.length;
              c.n += page.tasks.length;
              c.offset = page.next;
              page = await this.src.taskPage(pick.ref, c.offset, { since: run.options.since });
            }
            c.skip = Math.min(c.ff, page.tasks.length);
            c.ff = 0;
          }
        } catch (err) {
          if (!(err instanceof OffsetExpired)) throw err;
          c.ff = c.n + c.skip;
          c.n = 0;
          c.skip = 0;
          c.offset = null;
          this.say('info', 'The Asana page marker expired; the list starts again and skips what is done.');
          continue;
        }
        const hubProject = (await this.mapGet('project', pick.ref))?.hub_id || '';
        const key = this.dry ? '' : (await this.q<{ key: string }>('SELECT key FROM hub_projects WHERE id = ?', hubProject))?.key || '';
        for (let i = c.skip; i < page.tasks.length; i++) {
          if (this.overBudget()) {
            c.skip = i;
            return;
          }
          const acc = new Acc();
          try {
            await this.task(page.tasks[i], { ref: pick.ref, rep, hubProject, key, parentId: null, parentSection: null, order: c.n + i, depth: 0, acc });
            this.merge(acc);
          } catch (err) {
            if (err instanceof RateLimited || err instanceof AsanaAuthError) throw err;
            rep.tasks.errors++;
            this.say('error', `Task ${page.tasks[i].gid} in ${rep.name}: ${(err as Error).message}`);
          }
          c.skip = i + 1;
        }
        c.n += page.tasks.length;
        c.skip = 0;
        c.offset = page.next;
        if (!page.next) {
          rep.done = true;
          if (!this.dry && hubProject) rep.hubCount = (await this.q<{ n: number }>('SELECT COUNT(*) AS n FROM hub_tasks WHERE project_id = ?', hubProject))?.n ?? 0;
          this.say('info', `${rep.name}: finished.`);
          c.pi++;
          c.phase = 'meta';
          c.offset = null;
        }
        continue;
      }
      if (c.phase === 'link') {
        await this.link();
        c.phase = 'done';
      }
    }
  }

  private merge(acc: Acc) {
    const p = this.run.report.people;
    p.matched += acc.matched;
    for (const [k, u] of Object.entries(acc.unmatched)) {
      const have = p.unmatched[k];
      if (!have) p.unmatched[k] = u;
      else {
        have.assigned += u.assigned;
        have.asked += u.asked;
        have.comments += u.comments;
        have.projects = [...new Set([...have.projects, ...u.projects])];
      }
    }
  }

  /** Match one person and keep a tally of those not matched. */
  private person(acc: Acc, u: AUser | null, role: 'assigned' | 'asked' | 'comments', project: string): string | null {
    if (!u) return null;
    const m = matchPerson(this.people, u);
    if (m.email) {
      acc.matched++;
      return m.email;
    }
    const k = lower(u.email) || `name:${lower(u.name)}`;
    const e = (acc.unmatched[k] ||= { name: u.name, email: u.email, reason: m.reason, assigned: 0, asked: 0, comments: 0, projects: [] });
    e[role]++;
    if (!e.projects.includes(project)) e.projects.push(project);
    return null;
  }

  /* ------------------------------------------------------------------------------------------ project + sections */

  private async meta(pick: Pick) {
    const p = await this.src.project(pick.ref);
    const rep = (this.run.report.projects[pick.ref] ||= emptyProj(p.name));
    rep.name = p.name;
    rep.expected = p.num_tasks;
    const acc = new Acc();
    const hash = await sha(JSON.stringify([p.name, p.notes, p.start_on, p.due_on, p.archived, p.owner?.email, p.members.map((m) => m.email).sort(), p.sections.map((s) => s.name)]));
    const have = await this.mapGet('project', p.gid);
    const opts = this.run.options;
    const owner = this.person(acc, p.owner, 'assigned', p.name);
    const members = p.members.map((m) => this.person(acc, m, 'asked', p.name)).filter(Boolean) as string[];
    this.merge(acc);
    let hubId = have?.hub_id || '';
    if (!have) {
      rep.project = 'create';
      if (!this.dry) {
        hubId = newId('prj');
        let key = '';
        for (const k of projectKeyCandidates(p.name)) if (!(await this.q('SELECT 1 AS x FROM hub_projects WHERE key = ?', k))) { key = k; break; }
        if (!key) throw new Error(`No free project key for ${p.name}.`);
        rep.key = key;
        const lead = owner || this.lead;
        await this.batch([
          {
            sql: `INSERT INTO hub_projects (id, key, name, description, team, lead_email, visibility, status, color, start_date, due_date, next_num, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            a: [hubId, key, clip(p.name, 120), clip(p.notes, 4000), opts.team || '', lead, opts.visibility || 'staff', p.archived ? 'archived' : 'active', hubColor(p.color), p.start_on, p.due_on, this.lead, p.created_at || this.ts, this.ts],
          },
          this.mapPut('project', p.gid, hubId, p.gid, hash),
        ]);
        this.say('info', `Project ${p.name}: created as ${key}.`);
      }
    } else {
      const cur = await this.q<{ key: string; updated_at: string }>('SELECT key, updated_at FROM hub_projects WHERE id = ?', hubId);
      rep.key = cur?.key;
      if (have.hash === hash) rep.project = 'same';
      else if (cur && cur.updated_at > have.synced_at && !opts.overwrite) rep.project = 'kept';
      else {
        rep.project = 'update';
        await this.batch([
          { sql: 'UPDATE hub_projects SET name = ?, description = ?, start_date = ?, due_date = ?, updated_at = ? WHERE id = ?', a: [clip(p.name, 120), clip(p.notes, 4000), p.start_on, p.due_on, this.ts, hubId] },
          this.mapPut('project', p.gid, hubId, p.gid, hash),
        ]);
      }
    }
    rep.hub_id = hubId || undefined;
    // members: only ever added
    if (!this.dry && hubId) {
      const adds = [...new Set([...members, ...(owner ? [owner] : [])])];
      await this.batch(adds.map((e) => ({ sql: 'INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)', a: [hubId, e, 'member', this.ts] })));
    }
    // sections
    this.sectionIds.clear();
    let idx = 0;
    for (const s of p.sections) {
      idx++;
      if (lower(s.name) === UNTITLED) {
        this.sectionIds.set(s.gid, null);
        continue;
      }
      await this.section(p, s, hubId, idx, rep);
    }
    this.say('info', `${p.name}: ${p.sections.length} sections, about ${p.num_tasks ?? 'an unknown number of'} tasks to read.`);
  }

  private async section(p: AProject, s: ASection, hubProject: string, idx: number, rep: ProjReport): Promise<string | null> {
    const have = await this.mapGet('section', s.gid);
    const hash = await sha(s.name + '|' + idx);
    if (have) {
      this.sectionIds.set(s.gid, have.hub_id);
      if (have.hash === hash) rep.sections.same++;
      else {
        rep.sections.update++;
        await this.batch([
          { sql: 'UPDATE hub_project_sections SET name = ?, sort = ? WHERE id = ?', a: [clip(s.name, 120), idx * 1024, have.hub_id] },
          this.mapPut('section', s.gid, have.hub_id, p.gid, hash),
        ]);
      }
      return have.hub_id;
    }
    rep.sections.create++;
    const id = this.dry ? `dry_${s.gid}` : newId('sec');
    this.sectionIds.set(s.gid, id);
    await this.batch([
      { sql: 'INSERT INTO hub_project_sections (id, project_id, name, sort) VALUES (?, ?, ?, ?)', a: [id, hubProject, clip(s.name, 120), idx * 1024] },
      this.mapPut('section', s.gid, id, p.gid, hash),
    ]);
    return id;
  }

  /* ------------------------------------------------------------------------------------------------------ tasks */

  private async resolveSection(c: TaskCtx, t: ATask): Promise<string | null> {
    if (c.depth > 0) return c.parentSection;
    if (!t.section) return null;
    if (this.sectionIds.has(t.section.gid)) return this.sectionIds.get(t.section.gid) ?? null;
    if (lower(t.section.name) === UNTITLED) return null;
    // Every step starts with an empty section table, so look the section up in the map first. Only a section the project listing
    // never showed (added while the run was going) is made here; a dry run just notes it.
    const have = await this.mapGet('section', t.section.gid);
    if (have) {
      this.sectionIds.set(t.section.gid, have.hub_id);
      return have.hub_id;
    }
    if (this.dry) return `dry_${t.section.gid}`;
    const id = await this.section({ gid: c.ref } as AProject, t.section, c.hubProject, 9999, c.rep);
    return id;
  }

  private async task(t: ATask, c: TaskCtx): Promise<void> {
    const have = await this.mapGet('task', t.gid);
    if (have && have.project_gid && have.project_gid !== c.ref) {
      c.rep.tasks.alsoIn++;
      return;
    }
    const opts = this.run.options;
    const section = await this.resolveSection(c, t);
    const assignee = this.person(c.acc, t.assignee, 'assigned', c.rep.name);
    // Everyone a task is assigned to belongs to the project, so a members-only project shows them their own work.
    if (assignee && !this.memberSeen.has(assignee) && c.hubProject && !this.dry) {
      this.memberSeen.add(assignee);
      await this.batch([{ sql: 'INSERT OR IGNORE INTO hub_project_members (project_id, email, role, added_at) VALUES (?, ?, ?, ?)', a: [c.hubProject, assignee, 'member', this.ts] }]);
    }
    const doneBy = t.completed ? matchPerson(this.people, t.completed_by).email : null;
    const followers = new Set<string>();
    for (const f of t.followers) {
      const e = matchPerson(this.people, f).email;
      if (e) followers.add(e);
    }
    const unmatchedNotes: string[] = [];
    if (t.assignee && !assignee) unmatchedNotes.push(`Assigned in Asana to ${t.assignee.name || t.assignee.email}.`);
    for (const f of t.fields) {
      if (!REQUESTERISH.test(f.name)) continue;
      // A people field names real accounts, so one that matches no hub person is reported. An enum or text field holds words
      // ("Favor", a first name), so it only adds a follower when the words match one hub person.
      if (f.people.length) {
        for (const u of f.people) {
          const e = this.person(c.acc, u, 'asked', c.rep.name);
          if (e) followers.add(e);
        }
      } else if (f.value) {
        const e = matchPerson(this.people, { name: /@/.test(f.value) ? '' : f.value, email: /@/.test(f.value) ? f.value : '' }).email;
        if (e) followers.add(e);
      }
    }
    const start = t.start_at ? easternParts(t.start_at) : null;
    const due = t.due_at ? easternParts(t.due_at) : null;
    const trailer: string[] = [];
    if (t.tags.length) trailer.push(`Tags: ${t.tags.join(', ')}`);
    for (const f of t.fields) trailer.push(`${f.name}: ${f.value || f.people.map((p) => p.name || p.email).join(', ')}`);
    trailer.push(...unmatchedNotes);
    if (t.other_projects.length) trailer.push(`Also in Asana project: ${t.other_projects.join(', ')}`);
    if (t.permalink) trailer.push(`Asana: ${t.permalink}`);
    const description = clip(t.notes.trimEnd() + (trailer.length ? `${t.notes.trim() ? '\n\n' : ''}From Asana:\n${trailer.join('\n')}` : ''), 20000);
    const d = {
      title: clip(t.name.trim() || '(untitled)', 300), description, status: statusOf(t), priority: priorityOf(t.fields), owner: assignee,
      start: start?.date || t.start_on, due: due?.date || t.due_on, dueTime: due?.time || null, doneAt: t.completed ? t.completed_at || t.modified_at || this.ts : null,
      doneBy, section, parent: c.parentId, sort: c.order * 1024,
      appeal: codeField(t.fields, /^appeal( code)?$/i), source: codeField(t.fields, /^source( code)?$/i), fund: codeField(t.fields, /^fund( code)?$/i), campaign: codeField(t.fields, /^campaign( code)?$/i),
    };
    const hash = await sha(JSON.stringify(d) + JSON.stringify(t.tags) + JSON.stringify(t.fields) + [...followers].sort().join(','));
    let hubId = have?.hub_id || '';
    let wrote = false;
    const fieldRows = [
      ...t.tags.map((x) => ({ kind: 'tag', name: x, value: '' })),
      ...t.fields.map((f) => ({ kind: 'field', name: f.name, value: f.value || f.people.map((p) => p.name || p.email).join(', ') })),
    ];
    const peopleRows = (id: string) => [...followers].map((e) => ({ sql: "INSERT OR IGNORE INTO hub_task_people (task_id, email, role) VALUES (?, ?, 'follower')", a: [id, e] }));
    const fieldStmts = (id: string) => [
      { sql: 'DELETE FROM hub_task_fields WHERE task_id = ?', a: [id] },
      ...fieldRows.map((f) => ({ sql: 'INSERT OR IGNORE INTO hub_task_fields (task_id, kind, name, value) VALUES (?, ?, ?, ?)', a: [id, f.kind, clip(f.name, 120), clip(f.value, 1000)] })),
    ];
    if (!have) {
      c.rep.tasks.create++;
      if (c.depth > 0) c.rep.tasks.subtasks++;
      if (!this.dry) {
        hubId = newId('tsk');
        const n = await this.q<{ n: number }>('UPDATE hub_projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num - 1 AS n', c.hubProject);
        const code = `${c.key}-${String(n?.n ?? 0).padStart(4, '0')}`;
        await this.batch([
          {
            sql: `INSERT INTO hub_tasks (id, project_id, section_id, code, title, description, status, priority, owner_email, start_date, due_date, due_time, done_at, done_by, parent_id, sort,
                    appeal_code, source_code, fund_code, campaign_code, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            a: [hubId, c.hubProject, d.section, code, d.title, d.description, d.status, d.priority, d.owner, d.start, d.due, d.dueTime, d.doneAt, d.doneBy, d.parent, d.sort, d.appeal, d.source, d.fund, d.campaign,
              matchPerson(this.people, t.created_by).email || this.lead, t.created_at || this.ts, t.modified_at || this.ts],
          },
          this.mapPut('task', t.gid, hubId, c.ref, hash),
          ...peopleRows(hubId),
          ...fieldStmts(hubId),
          { sql: "INSERT INTO hub_task_events (id, task_id, project_id, actor_email, kind, detail, created_at) VALUES (?, ?, ?, ?, 'imported', ?, ?)", a: [newId('evt'), hubId, c.hubProject, this.lead, JSON.stringify({ asana: t.gid, run: this.run.id }), this.ts] },
        ]);
      } else hubId = `dry_${t.gid}`;
      wrote = true;
    } else if (have.hash !== hash) {
      const cur = await this.q<{ updated_at: string }>('SELECT updated_at FROM hub_tasks WHERE id = ?', hubId);
      if (cur && cur.updated_at > have.synced_at && !opts.overwrite) {
        c.rep.tasks.kept++;
      } else {
        c.rep.tasks.update++;
        await this.batch([
          {
            sql: `UPDATE hub_tasks SET section_id = ?, title = ?, description = ?, status = ?, priority = ?, owner_email = ?, start_date = ?, due_date = ?, due_time = ?, done_at = ?, done_by = ?,
                    parent_id = ?, sort = ?, appeal_code = ?, source_code = ?, fund_code = ?, campaign_code = ?, updated_at = ? WHERE id = ?`,
            a: [d.section, d.title, d.description, d.status, d.priority, d.owner, d.start, d.due, d.dueTime, d.doneAt, d.doneBy, d.parent, d.sort, d.appeal, d.source, d.fund, d.campaign, t.modified_at || this.ts, hubId],
          },
          this.mapPut('task', t.gid, hubId, c.ref, hash, have.asana_modified),
          ...peopleRows(hubId),
          ...fieldStmts(hubId),
        ]);
        wrote = true;
      }
    } else if (have.asana_modified && have.asana_modified === t.modified_at) {
      c.rep.tasks.same++;
      return; // nothing changed in Asana since the last complete import of this task: no need to read its comments and files again
    } else c.rep.tasks.same++;
    if (wrote) {
      c.rep.tags += t.tags.length;
      c.rep.fields += t.fields.length;
    }
    // children: comments, files, dependencies, subtasks
    if (this.deps.maxCalls && this.src.calls >= this.deps.maxCalls) throw new RateLimited(1);
    await this.comments(t, hubId, c);
    await this.files(t, hubId, c);
    const deps = await this.src.dependencies(t);
    if (deps.length) {
      c.rep.deps += deps.length;
      await this.batch(deps.map((g) => ({ sql: 'INSERT OR IGNORE INTO hub_asana_deps (task_gid, depends_on_gid) VALUES (?, ?)', a: [t.gid, g] })));
    }
    if (t.num_subtasks > 0 || t.inline?.subtasks?.length) {
      const subs = await this.src.subtasks(t);
      let i = 0;
      for (const sub of subs) await this.task(sub, { ...c, parentId: hubId, parentSection: section, order: i++, depth: c.depth + 1 });
    }
    if (!this.dry) await this.batch([{ sql: 'UPDATE hub_asana_map SET asana_modified = ? WHERE kind = ? AND gid = ?', a: [t.modified_at, 'task', t.gid] }]);
  }

  private async comments(t: ATask, hubTask: string, c: TaskCtx) {
    const stories: AStory[] = await this.src.stories(t);
    for (const s of stories) {
      const body = await this.commentBody(s, c);
      const hash = await sha(body);
      const have = await this.mapGet('story', s.gid);
      if (have && have.hash === hash) {
        c.rep.comments.same++;
        continue;
      }
      if (have) {
        c.rep.comments.update++;
        await this.batch([
          { sql: 'UPDATE hub_task_comments SET body = ?, edited_at = ? WHERE id = ?', a: [body, this.ts, have.hub_id] },
          this.mapPut('story', s.gid, have.hub_id, c.ref, hash),
        ]);
        continue;
      }
      c.rep.comments.create++;
      const id = newId('cmt');
      const author = matchPerson(this.people, s.author).email || this.lead;
      await this.batch([
        { sql: "INSERT INTO hub_task_comments (id, task_id, author_email, body, mentions, source, created_at) VALUES (?, ?, ?, ?, '[]', 'asana', ?)", a: [id, hubTask, author, body, s.created_at || this.ts] },
        this.mapPut('story', s.gid, id, c.ref, hash),
      ]);
    }
  }

  private async commentBody(s: AStory, c: TaskCtx): Promise<string> {
    const e = this.person(c.acc, s.author, 'comments', c.rep.name);
    const who = s.author ? s.author.name || s.author.email : '';
    const text = clip(s.text.trim(), 8000);
    return e || !who ? text : `${who} wrote in Asana:\n${text}`;
  }

  private async files(t: ATask, hubTask: string, c: TaskCtx) {
    const list: AAttachment[] = await this.src.attachments(t);
    const bucket = this.deps.uploads;
    const copyOn = this.run.options.copyFiles !== false;
    for (const a of list) {
      const have = await this.mapGet('attachment', a.gid);
      const external = a.host !== 'asana' && a.host !== '';
      if (have && (have.hash === 'copied' || external || have.hash === 'link-final')) {
        c.rep.files.same++;
        continue;
      }
      const fail = (reason: string) => {
        c.rep.files.failed++;
        this.run.report.files.problems.push({ project: c.rep.name, task: t.name || t.gid, name: a.name, size: a.size, host: a.host || 'asana', reason, url: a.permanent_url });
      };
      let outcome: 'copied' | 'link' = 'link';
      let key = '';
      let mime = '';
      let size = a.size;
      const id = have?.hub_id || newId('fil');
      if (!external && copyOn) {
        if (!a.download_url) fail('Asana gave no download address for this file.');
        else if (this.dry) {
          if (a.size != null && a.size > MAX_COPY_BYTES) fail(`Larger than ${MAX_COPY_BYTES / 1048576} MB.`);
          else outcome = 'copied';
        } else if (!bucket) fail('This copy of the hub has no file storage bound.');
        else {
          const got = await this.src.download(a, MAX_COPY_BYTES);
          if (!got) fail('Asana would not hand the file over.');
          else if ('tooBig' in got) fail(`Larger than ${MAX_COPY_BYTES / 1048576} MB.`);
          else {
            key = `projects/${hubTask}/${id}-${safeName(a.name)}`;
            await bucket.put(key, got.bytes, { httpMetadata: { contentType: got.type || 'application/octet-stream' } });
            mime = got.type;
            size = got.bytes.byteLength;
            outcome = 'copied';
          }
        }
      } else if (!external) fail('Copying files was switched off for this run.');
      if (outcome === 'link' && !a.permanent_url) {
        this.run.report.warnings.push(`File ${a.name} has no address in Asana and could not be copied; it is not in the hub.`);
        continue;
      }
      if (outcome === 'copied') c.rep.files.copy++;
      else c.rep.files.link++;
      const url = outcome === 'copied' ? (this.deps.fileUrl ? this.deps.fileUrl(hubTask, id, key) : `/api/tasks/${hubTask}/files/${id}/download`) : a.permanent_url;
      const hash = outcome === 'copied' ? 'copied' : external ? 'link-final' : 'link';
      if (have) {
        await this.batch([
          { sql: 'UPDATE hub_task_files SET kind = ?, url = ?, ref_id = ?, mime = ?, size = ? WHERE id = ?', a: [outcome === 'copied' ? 'upload' : 'link', url, key || null, mime || null, size, id] },
          this.mapPut('attachment', a.gid, id, c.ref, hash),
        ]);
      } else {
        await this.batch([
          { sql: 'INSERT INTO hub_task_files (id, task_id, kind, name, url, ref_id, mime, size, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', a: [id, hubTask, outcome === 'copied' ? 'upload' : 'link', clip(a.name, 200), url, key || null, mime || null, size, this.lead, a.created_at || this.ts] },
          this.mapPut('attachment', a.gid, id, c.ref, hash),
        ]);
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ dependencies */

  private async link() {
    const rep = this.run.report.deps;
    if (this.dry) {
      const seen = Object.values(this.run.report.projects).reduce((n, p) => n + p.deps, 0);
      rep.linked = seen;
      return;
    }
    const edges = await this.qa<{ a: string; b: string | null; tg: string; dg: string }>(
      `SELECT m1.hub_id AS a, m2.hub_id AS b, d.task_gid AS tg, d.depends_on_gid AS dg
         FROM hub_asana_deps d JOIN hub_asana_map m1 ON m1.kind = 'task' AND m1.gid = d.task_gid
         LEFT JOIN hub_asana_map m2 ON m2.kind = 'task' AND m2.gid = d.depends_on_gid`
    );
    const existing = await this.qa<{ task_id: string; depends_on: string }>('SELECT task_id, depends_on FROM hub_task_deps');
    const adj = new Map<string, Set<string>>();
    for (const e of existing) (adj.get(e.task_id) || adj.set(e.task_id, new Set()).get(e.task_id)!).add(e.depends_on);
    const reaches = (from: string, to: string) => {
      const seen = new Set<string>();
      const stack = [from];
      while (stack.length) {
        const n = stack.pop()!;
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const m of adj.get(n) || []) stack.push(m);
      }
      return false;
    };
    const add: Array<{ sql: string; a: unknown[] }> = [];
    for (const e of edges) {
      if (!e.b) {
        rep.outside++;
        continue;
      }
      if (adj.get(e.a)?.has(e.b)) continue;
      if (e.a === e.b || reaches(e.b, e.a)) {
        rep.cycles++;
        this.say('warn', `A dependency between tasks ${e.tg} and ${e.dg} would form a loop and was skipped.`);
        continue;
      }
      (adj.get(e.a) || adj.set(e.a, new Set()).get(e.a)!).add(e.b);
      add.push({ sql: 'INSERT OR IGNORE INTO hub_task_deps (task_id, depends_on) VALUES (?, ?)', a: [e.a, e.b] });
      rep.linked++;
    }
    for (let i = 0; i < add.length; i += 50) await this.batch(add.slice(i, i + 50));
  }
}

/* ------------------------------------------------------------------------------------------------- one step */

const LOCK_MS = 60_000;

export async function stepRun(env: Env, runId: string, deps: StepDeps): Promise<RunRow> {
  const now = deps.now || Date.now;
  let run = await getRun(env, runId);
  if (!run) throw new Error('No such run.');
  if (run.status !== 'running' && run.status !== 'waiting') return run;
  if (run.status === 'waiting' && run.resume_at && Date.parse(run.resume_at) > now()) return run;
  const nowIso = new Date(now()).toISOString();
  const got = await env.DB.prepare(
    "UPDATE hub_asana_runs SET lock_until = ?, status = 'running', resume_at = NULL WHERE id = ? AND status IN ('running','waiting') AND (lock_until IS NULL OR lock_until < ?)"
  )
    .bind(new Date(now() + LOCK_MS).toISOString(), runId, nowIso)
    .run();
  if (!((got as any).meta?.changes > 0)) return (await getRun(env, runId))!;
  run = (await getRun(env, runId))!;
  const deadline = now() + (deps.budgetMs ?? 20_000);
  let engine: Engine | null = null;
  let status: RunRow['status'] = 'running';
  let error = '';
  let resume: string | null = null;
  const log: Array<{ level: string; text: string }> = [];
  try {
    const src = await deps.makeSource(run, { deadline });
    engine = new Engine(env, run, src, deps, deadline);
    await engine.work();
    run.calls += src.calls;
    if (run.cursor.phase === 'done') {
      status = 'done';
      engine.log.push({ level: 'info', text: `${run.mode === 'dry' ? 'Dry run' : 'Import'} finished.` });
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      status = 'waiting';
      resume = new Date(now() + err.waitSec * 1000).toISOString();
      log.push({ level: 'warn', text: `Asana asked for a pause of ${err.waitSec} seconds. The run continues by itself.` });
    } else if (err instanceof AsanaAuthError) {
      status = 'failed';
      error = err.message;
    } else {
      status = 'failed';
      error = (err as Error).message || 'The run stopped.';
    }
    if (engine) run.calls += engine.src.calls;
  }
  const lines = [...(engine?.log || []), ...log];
  if (status === 'failed') lines.push({ level: 'error', text: error });
  const fresh = await env.DB.prepare('SELECT status FROM hub_asana_runs WHERE id = ?').bind(runId).first<{ status: string }>();
  if (fresh?.status === 'cancelled') status = 'cancelled';
  const stamp = new Date(now()).toISOString();
  await env.DB.prepare(
    `UPDATE hub_asana_runs SET status = ?, cursor = ?, report = ?, resume_at = ?, calls = ?, error = ?, lock_until = NULL, updated_at = ?, finished_at = ? WHERE id = ?`
  )
    .bind(status, JSON.stringify(run.cursor), JSON.stringify(run.report), resume, run.calls, error, stamp, status === 'running' || status === 'waiting' ? null : stamp, runId)
    .run();
  for (const l of lines) await env.DB.prepare('INSERT INTO hub_asana_log (run_id, at, level, text) VALUES (?, ?, ?, ?)').bind(runId, stamp, l.level, l.text.slice(0, 500)).run();
  return (await getRun(env, runId))!;
}
