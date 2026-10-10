// What the routes do: read the board with the hub's own pending changes laid over it, plan a batch into outbox rows, send it to
// Blackbaud 15 calls at a time, verify, undo and retry. Every Blackbaud change is saved here first, then sent, then checked, so the
// person's work is never lost when Blackbaud is down (the same shape as Foundation prospects and Thank-you receipts).
import { HttpError, newId, nowIso, type Env } from '../http';
import type { ActionsRepo, BoardData, StaffPeople } from './repo';
import { boardData, forgetBoard } from './repo';
import { addMeter, dropLock, getMeter, getSetting, listStaff, logEvent, setSetting, takeLock } from './db';
import {
  applyOverlay, bigGift, countsOf, facetsOf, holdersOf, isLive, LANES, matches, sortRows, thankGroups, thankLanes, thankOwners,
  type BoardRow, type PendingChange, type People,
} from '../actions/board';
import {
  addDays, addFundraiser, clean, closeThankedStep, completeStep, holderFundraisers, IN_PLACE_TYPES, reassignStep, replaceFundraiser, rescheduleStep,
  thankSteps, THANK_HOWS, undoStep, type CompleteOpts, type Step, type Target, type ThankMode,
} from '../actions/completion';
import { CHUNK, DAILY_CAP, LANE_CAP, MAX_IDS, SINGLES_UNTIL, laneFor, plannedCalls, refreshCalls, REFRESH_MAX, resetLabel, undoUntil, utcDay } from '../actions/batch';
import { advance, idemKey, matchLostCreate, requestFor, sayWhy, verdictOf, type CallResult } from '../actions/outbox';
import { etParts } from '../actions/intake';
import type { OpsCall } from '../foundations/blackbaud';

export interface Ctx {
  env: Env;
  repo: ActionsRepo;
  actor: string;
  email: string;
}

export const todayEt = (): string => etParts(new Date()).date;

/** An instant as Eastern clock time, the way Blackbaud reads last_modified ("2026-10-09T21:29:00"). */
export function etClock(d: Date): string {
  const e = etParts(d);
  return `${e.date}T${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}:00`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(s: unknown, field = 'date'): string {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!DATE.test(v) || v < '2020-01-01' || v > addDays(todayEt(), 1)) throw new HttpError(400, 'bad_date', `Pick a real day for ${field}.`);
  return v;
}

/** A new due date: a real day from today on, up to two years out. Completion dates use validDate, which stops at tomorrow. */
export function validDue(s: unknown): string {
  const v = typeof s === 'string' ? s.trim() : '';
  const today = todayEt();
  if (!DATE.test(v) || v < today || v > addDays(today, 730)) throw new HttpError(400, 'bad_date', 'Pick a due date from today on.');
  return v;
}

const TEAM_WORDS: Record<string, string> = { support: 'Support', rdd: 'RDD', partner_care: 'Partner Care', church: 'Church Engagement', grants: 'Grants', admin: 'Operations', exec: 'Executive' };

export async function staffPeople(env: Env): Promise<StaffPeople[]> {
  const rows = await listStaff(env).catch(() => []);
  return rows.filter((s) => s.bb_fundraiser_id).map((s) => ({ fid: String(s.bb_fundraiser_id), name: s.name, team: TEAM_WORDS[s.team] || s.team, active: s.active === 1 }));
}

/* ------------------------------------------------------------------ the board, with the hub's pending changes laid over it */

interface PendingDb {
  action_id: string;
  op: string;
  state: string;
  payload: string;
  queued_at: string;
  sent_at: string | null;
  bop: string;
  run_when: string;
}

export async function loadPending(env: Env): Promise<PendingChange[]> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const r = await env.DB.prepare(
    `SELECT o.action_id, o.op, o.state, o.payload, o.queued_at, o.sent_at, b.op AS bop, b.run_when
       FROM act_outbox o JOIN act_batches b ON b.id = o.batch_id
      WHERE o.state IN ('queued', 'sent', 'verified') AND o.action_id IS NOT NULL AND o.op = 'patch' AND b.state <> 'undone' AND o.queued_at >= ?`
  )
    .bind(since)
    .all<PendingDb>()
    .catch(() => ({ results: [] as PendingDb[] }));
  const out: PendingChange[] = [];
  for (const p of r.results) {
    if (!['complete', 'thank', 'close_thanked', 'reassign', 'reschedule'].includes(p.bop)) continue;
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(p.payload);
    } catch {
      body = {};
    }
    out.push({ actionId: String(p.action_id), op: p.bop, state: p.state as PendingChange['state'], at: p.sent_at || p.queued_at, tonight: p.run_when === 'tonight', body });
  }
  return out;
}

export interface Board {
  rows: BoardRow[];
  people: People;
  synced: string;
  orphans: number;
  today: string;
}

export async function currentBoard(ctx: Ctx): Promise<Board> {
  const today = todayEt();
  const staff = await staffPeople(ctx.env);
  const [data, changes] = await Promise.all([boardData(ctx.repo, today, staff), loadPending(ctx.env)]);
  return { rows: applyOverlay(data.rows, changes, data.synced), people: data.people, synced: data.synced, orphans: data.orphans, today };
}

export function publicRow(r: BoardRow): Omit<BoardRow, 'fullDescription'> {
  const { fullDescription: _f, ...rest } = r;
  return rest;
}

export async function meterView(env: Env) {
  const m = await getMeter(env).catch(() => ({ day: utcDay(), calls: 0, route: 0, used: 0 }));
  return { used: m.used, cap: DAILY_CAP, lane: LANE_CAP, resets: resetLabel() };
}

export interface BoardQuery {
  view: 'open' | 'stale';
  lane?: string;
  f: { fr?: string; theirs?: boolean; type?: string; cat?: string; due?: string; q?: string; cid?: string; quick?: string };
  sort: string;
  dir: 1 | -1;
  offset: number;
  limit: number;
  idsOnly: boolean;
}

export function parseBoardQuery(url: URL): BoardQuery {
  const g = (k: string) => (url.searchParams.get(k) || '').slice(0, 120);
  const num = (k: string, d: number, max: number) => Math.min(max, Math.max(0, Number(url.searchParams.get(k)) || d));
  const sort = ['due', 'partner', 'fr', 'added'].includes(g('sort')) ? g('sort') : 'due';
  const dir = (g('dir') || (sort === 'partner' || sort === 'fr' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  return {
    view: g('view') === 'stale' ? 'stale' : 'open',
    lane: g('lane') || undefined,
    f: { fr: g('fr'), theirs: g('theirs') === '1', type: g('type'), cat: g('cat'), due: g('due'), q: g('q'), cid: g('cid'), quick: g('quick') },
    sort,
    dir,
    offset: num('offset', 0, 100000),
    limit: num('limit', 100, 3000) || 100,
    idsOnly: g('ids') === '1',
  };
}

export async function boardResponse(ctx: Ctx, q: BoardQuery) {
  const b = await currentBoard(ctx);
  let base = b.rows;
  if (q.view === 'stale' && q.lane) {
    const lane = LANES.find((l) => l.k === q.lane);
    if (lane) base = base.filter((a) => lane.test(a, b.today, b.people));
  }
  const list = sortRows(base.filter((a) => matches(a, q.f, b.today, b.people)), q.sort, q.dir, b.people);
  if (q.idsOnly) {
    // Select all in a stale lane leaves out tasks about gifts of $1,000 or more; they are picked by hand.
    const ids = (q.view === 'stale' ? list.filter((a) => !bigGift(a)) : list).map((a) => a.id);
    return { ok: true, ids, total: list.length };
  }
  const f = facetsOf(b.rows, q.f, b.today, b.people);
  return {
    ok: true,
    synced: b.synced,
    today: b.today,
    meter: await meterView(ctx.env),
    counts: countsOf(b.rows, b.today),
    facets: f,
    lanes: LANES.map((l) => ({ k: l.k, n: l.n, hint: l.hint, count: b.rows.filter((a) => l.test(a, b.today, b.people)).length })),
    people: b.people,
    orphans: b.orphans,
    total: list.length,
    rows: list.slice(q.offset, q.offset + q.limit).map(publicRow),
  };
}

export async function thanksResponse(ctx: Ctx, owner: string) {
  const b = await currentBoard(ctx);
  const groups = thankGroups(b.rows, owner);
  const lanes = thankLanes(groups);
  const g = (list: typeof groups) => list.map((x) => ({ key: x.key, ids: x.ids, row: publicRow(x.row), later: x.later }));
  return {
    ok: true,
    synced: b.synced,
    people: b.people,
    everyone: thankGroups(b.rows, '').length,
    owners: thankOwners(b.rows, b.people),
    lanes: { thanked: g(lanes.thanked), probably: g(lanes.probably), owed: g(lanes.owed) },
  };
}

/* ------------------------------------------------------------------ planning a batch */

export type BatchOp = 'complete' | 'thank' | 'close_thanked' | 'reassign' | 'reschedule' | 'create';

export interface BatchInput {
  op: BatchOp;
  ids?: string[];
  submission_ids?: string[];
  date?: string;
  own?: boolean;
  line?: string;
  outcome?: string;
  how?: string;
  mode?: string;
  from?: string;
  to?: string;
  add?: string;
  due?: string;
  by?: number;
}

interface OutboxRow {
  id: string;
  batch_id: string;
  action_id: string | null;
  cid: string | null;
  label: string | null;
  submission_id: string | null;
  op: string;
  before: string | null;
  payload: string;
  idem_key: string | null;
  state: string;
  attempts: number;
  bb_id: string | null;
  last_error: string | null;
  queued_at: string;
  sent_at: string | null;
  verified_at: string | null;
}

interface BatchRow {
  id: string;
  op: string;
  undo_of: string | null;
  actor: string;
  actor_email: string;
  params: string;
  n: number;
  calls_planned: number;
  calls_used: number;
  run_when: string;
  state: string;
  undo_until: string;
  created_at: string;
  finished_at: string | null;
}

const parseObj = (s: string | null): Record<string, any> => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

const labelOf = (r: BoardRow) => `${r.partner} | ${r.summary || r.type}`;

function targetOf(r: BoardRow, description: string, thankedOn?: string | null): Target {
  return { id: r.id, cid: r.cid, due: r.due, type: r.typeRaw || null, category: r.category, description, summary: r.summary, fundraisers: r.fundraisers, thankedOn };
}

/** One page of the freshness check: the actions Blackbaud changed since the mirror's last sync, so a description edited since is never overwritten. */
async function changedSince(ctx: Ctx, syncedIso: string): Promise<{ ids: Set<string>; complete: boolean }> {
  // Blackbaud reads last_modified as Eastern clock time (proved on the test record 2026-10-09), not UTC, so convert and step back five minutes.
  const from = new Date(Date.parse(syncedIso || '') - 5 * 60000);
  const base = Number.isNaN(from.getTime()) ? new Date(Date.now() - 13 * 3600000) : from;
  const t = etClock(base);
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/actions?last_modified=${t}&limit=2000` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const res = r.results[0];
  if (!res || !res.ok || !res.body || !Array.isArray(res.body.value)) return { ids: new Set(), complete: false };
  const ids = new Set<string>(res.body.value.map((v: any) => String(v.id)));
  return { ids, complete: Number(res.body.count) <= res.body.value.length };
}

/** Most descriptions in the mirror are whole. A description of 2,000 characters or more may be cut short, so its action is read from Blackbaud before a line is added. */
export const REREAD_MAX = 45;

async function freshDescriptions(ctx: Ctx, rows: BoardRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = rows.filter((r) => (r.fullDescription || '').length >= 2000);
  for (const r of rows) out.set(r.id, r.fullDescription || '');
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    const res = await ctx.repo.send(part.map((r) => ({ method: 'GET', path: `/constituent/v1/actions/${r.id}` })));
    await addMeter(ctx.env, res.results.length, res.callsToday);
    if (res.results.length < part.length) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer, so nothing was changed. Try again in a minute.');
    part.forEach((r, k) => {
      const x = res.results[k];
      if (!x.ok) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer, so nothing was changed. Try again in a minute.');
      out.set(r.id, String((x.body && x.body.description) || ''));
    });
  }
  return out;
}

export interface PlannedItem {
  actionId?: string;
  submissionId?: string;
  cid?: string;
  label: string;
  steps: Step[];
}

function checkHow(how: unknown): string {
  const h = typeof how === 'string' ? how : '';
  if (h && h !== 'none' && h !== 'logged' && !THANK_HOWS[h]) throw new HttpError(400, 'bad_how', 'Pick how the thank-you went out from the list.');
  return h;
}

/** Build the steps for every selected action. Pure apart from the freshness read a shared line needs. */
export async function planBatch(ctx: Ctx, input: BatchInput, board: Board): Promise<{ items: PlannedItem[]; skipped: number; changed: number; reads: number; params: Record<string, unknown> }> {
  const today = board.today;
  const byId = new Map(board.rows.map((r) => [r.id, r]));
  const ids = [...new Set((input.ids || []).map(String))];
  if (ids.length > MAX_IDS) throw new HttpError(400, 'too_many', `Pick ${MAX_IDS.toLocaleString('en-US')} actions or fewer at a time.`);
  const rows: BoardRow[] = [];
  let skipped = 0;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || r.pending) skipped++;
    else rows.push(r);
  }
  if (!rows.length) throw new HttpError(400, 'not_open', 'Those actions are not open any more. Reload the list.');
  // One read asks Blackbaud which actions changed since the mirror's last sync. Those are left alone: the person reloads and sees what changed.
  // If that one read fails, nothing is changed; reading every action one by one would spend the day's allowance.
  const seen = await changedSince(ctx, board.synced);
  if (!seen.complete) throw new HttpError(503, 'blackbaud_wait', 'Blackbaud did not answer the check that your list is current, so nothing was changed. Try again in a minute.');
  let reads = 1;
  const changedRows = rows.filter((r) => seen.ids.has(r.id));
  if (changedRows.length) {
    for (let i = rows.length - 1; i >= 0; i--) if (seen.ids.has(rows[i].id)) rows.splice(i, 1);
    skipped += changedRows.length;
  }
  let changed = changedRows.length;
  if (!rows.length) throw new HttpError(409, 'changed_in_blackbaud', 'Those actions were changed in Blackbaud since your list was loaded. Reload the list to see them.');
  const params: Record<string, unknown> = {};
  const thankMode = ((await getSetting(ctx.env, 'thank_mode', 'one')) === 'two' ? 'two' : 'one') as ThankMode;
  const items: PlannedItem[] = [];

  if (input.op === 'complete' || input.op === 'thank' || input.op === 'close_thanked') {
    const how = input.op === 'close_thanked' ? 'logged' : checkHow(input.how);
    const own = input.own === true;
    const date = own || input.op === 'close_thanked' ? null : input.date ? validDate(input.date, 'the completion date') : today;
    const outcome = input.outcome === 'Successful' || input.outcome === 'Unsuccessful' ? input.outcome : '';
    const line = clean(input.line);
    Object.assign(params, { date, own, line, outcome, how });
    if (line) {
      // A very long note is read whole before a line is added. More than REREAD_MAX of them in one batch wait for the next one.
      const long = rows.filter((r) => (r.fullDescription || '').length >= 2000);
      for (const r of long.slice(REREAD_MAX)) {
        rows.splice(rows.indexOf(r), 1);
        skipped++;
        changed++;
      }
      reads += Math.min(long.length, REREAD_MAX);
      if (!rows.length) throw new HttpError(409, 'changed_in_blackbaud', 'Those actions have very long notes. Pick fewer at a time.');
    }
    const desc = line ? await freshDescriptions(ctx, rows) : new Map<string, string>();
    const doneGroups = new Set<string>();
    const staff = await listStaff(ctx.env).catch(() => []);
    for (const r of rows) {
      const description = line ? desc.get(r.id) || '' : r.fullDescription || '';
      const opts: CompleteOpts = { date, own, line, outcome, how, actor: ctx.actor, today, thankMode };
      let steps: Step[];
      if (input.op === 'close_thanked') {
        if (!r.later) continue;
        steps = [closeThankedStep(targetOf(r, description, r.later.date), opts)];
      } else if (THANK_HOWS[how] && r.ty && r.group && r.group.length > 1 && doneGroups.has([...r.group].sort().join(','))) {
        // The other tasks about the same gift only close. One gift is one thank-you: one category, one Thanked tag, one new record.
        steps = [completeStep(targetOf(r, description), opts)];
      } else if (THANK_HOWS[how] && r.ty) {
        if (r.group && r.group.length > 1) doneGroups.add([...r.group].sort().join(','));
        const owner = r.fundraisers[0];
        const st = staff.find((s) => s.bb_fundraiser_id === owner);
        opts.ownerType = st?.entry_type || (IN_PLACE_TYPES.has(r.typeRaw) ? r.typeRaw : 'RDD Action');
        steps = thankSteps(targetOf(r, description), opts);
      } else steps = [completeStep(targetOf(r, description), opts)];
      items.push({ actionId: r.id, cid: r.cid, label: labelOf(r), steps });
    }
  } else if (input.op === 'reschedule') {
    const due = input.by ? addDays(today, Math.min(365, Math.max(1, Math.floor(Number(input.by))))) : validDue(input.due);
    Object.assign(params, { due });
    for (const r of rows) items.push({ actionId: r.id, cid: r.cid, label: labelOf(r), steps: [rescheduleStep(targetOf(r, ''), due)] });
  } else if (input.op === 'reassign') {
    const mode = input.mode === 'holder' || input.mode === 'replace' || input.mode === 'add' ? input.mode : '';
    if (!mode) throw new HttpError(400, 'bad_mode', 'Pick how to reassign.');
    const known = (id: string | undefined) => (id && board.people[id] ? id : '');
    const live = (id: string) => isLive(board.people, id);
    Object.assign(params, { mode, from: input.from || '', to: input.to || '', add: input.add || '' });
    for (const r of rows) {
      let next: string[] | null = null;
      if (mode === 'holder') {
        const holder = r.holders.find((h) => live(h) && !r.fundraisers.includes(h)) || null;
        next = holderFundraisers(r.fundraisers, holder, live);
      } else if (mode === 'replace') {
        const to = known(input.to);
        if (!to || !live(to)) throw new HttpError(400, 'bad_person', 'Pick a person who works at Favor to give these to.');
        next = replaceFundraiser(r.fundraisers, String(input.from || ''), to);
      } else {
        const add = known(input.add);
        if (!add || !live(add)) throw new HttpError(400, 'bad_person', 'Pick a person who works at Favor to add.');
        next = addFundraiser(r.fundraisers, add);
      }
      if (next) items.push({ actionId: r.id, cid: r.cid, label: labelOf(r), steps: [reassignStep(targetOf(r, ''), next)] });
    }
    if (!items.length) throw new HttpError(400, 'nothing_to_do', 'Nothing changes with these choices.');
  } else throw new HttpError(400, 'bad_op', 'That is not something the Work Center does.');
  skipped += rows.length - items.length;
  return { items, skipped, changed, reads, params };
}

/** Save a batch and its outbox rows. Nothing has gone to Blackbaud yet. */
export interface SavedBatch {
  id: string;
  op: string;
  n: number;
  calls: number;
  run_when: 'now' | 'tonight';
  undo_until: string;
  left: number;
  duplicates: number;
  repeat?: boolean;
}

/** A batch already saved under this button press. A second click, or a retry after a lost answer, gets the first batch back. */
export async function batchByReq(env: Env, reqId: string | undefined): Promise<{ batch: SavedBatch; items: { id: string; state: string }[] } | null> {
  const req = String(reqId || '').slice(0, 80);
  if (!req) return null;
  const b = await env.DB.prepare('SELECT * FROM act_batches WHERE req_id = ? LIMIT 1').bind(req).first<BatchRow>();
  if (!b) return null;
  const rows = (await env.DB.prepare("SELECT action_id, submission_id, id, state FROM act_outbox WHERE batch_id = ? AND op <> 'tag'").bind(b.id).all<OutboxRow>()).results;
  const items = rows.map((r) => ({ id: String(r.action_id || r.submission_id || r.id), state: toItemState(r.state) }));
  return { batch: { id: b.id, op: b.op, n: b.n, calls: b.calls_planned, run_when: b.run_when as 'now' | 'tonight', undo_until: b.undo_until, left: 0, duplicates: 0, repeat: true }, items };
}

export async function saveBatch(ctx: Ctx, op: string, itemsIn: PlannedItem[], params: Record<string, unknown>, extra: { undoOf?: string; whenOverride?: 'now' | 'tonight'; reqId?: string; reads?: number } = {}): Promise<SavedBatch> {
  let items = itemsIn;
  const id = newId('wcb');
  // A create is never sent twice: its key sits under a unique index, so a double click or a repeated paste skips what is already queued or posted.
  const keyed: { it: PlannedItem; key: string }[] = [];
  if (!extra.undoOf) {
    for (const it of items) {
      const c = it.steps.find((s) => s.op === 'create');
      if (c) {
        const b = c.body as Record<string, any>;
        // The key leaves out the row's own id, so the same contact entered twice (a double click, a second paste) is one contact. A thank-you
        // record keeps its task id, because two tasks about two gifts on one partner on one day are two thank-yous.
        const key = await idemKey([b.constituent_id, String(b.date || '').slice(0, 10), b.type, b.category, b.summary, (b.fundraisers || []).join(','), it.actionId || 'x']);
        if (!keyed.some((k) => k.key === key)) keyed.push({ it, key });
      }
    }
    if (keyed.length) {
      const have = new Set<string>();
      for (let i = 0; i < keyed.length; i += 50) {
        const part = keyed.slice(i, i + 50);
        const r = await ctx.env.DB.prepare(`SELECT idem_key FROM act_outbox WHERE state <> 'undone' AND idem_key IN (${part.map(() => '?').join(',')})`).bind(...part.map((k) => k.key)).all<{ idem_key: string }>();
        r.results.forEach((x) => have.add(x.idem_key));
      }
      const drop = new Set(keyed.filter((k) => have.has(k.key)).map((k) => k.it));
      // A repeat inside the same request is dropped too (its key was not kept above).
      const kept = new Set(keyed.map((k) => k.it));
      items = items.filter((it) => !drop.has(it) && (!it.steps.some((s) => s.op === 'create') || kept.has(it)));
    }
  }
  if (!items.length) return { id: '', op, n: 0, calls: 0, run_when: 'now' as const, undo_until: '', left: 0, duplicates: keyed.length };
  const steps = items.reduce((n, i) => n + i.steps.length, 0);
  const reads = extra.reads || 0;
  // Planned calls: the changes, one read-back per 15, and the sync worker's refresh of each changed action (1 call, 2 with tags).
  const planned = plannedCalls(steps, items.length) + reads + refreshCalls(items);
  const meter = await getMeter(ctx.env).catch(() => ({ used: 0 }));
  // Batches saved but not yet sent will spend their calls too, so a second batch saved a moment later sees the first one's share.
  const queued = await ctx.env.DB.prepare("SELECT COALESCE(SUM(MAX(calls_planned - calls_used, 0)), 0) AS n FROM act_batches WHERE state IN ('queued', 'running')").first<{ n: number }>().catch(() => ({ n: 0 }));
  const lane = laneFor({ planned, used: meter.used + (Number(queued?.n) || 0), laneCap: Number(await getSetting(ctx.env, 'lane_cap', String(LANE_CAP))) || LANE_CAP });
  const when = extra.whenOverride || lane.when;
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    ctx.env.DB.prepare(
      `INSERT INTO act_batches (id, op, undo_of, actor, actor_email, params, n, calls_planned, calls_used, run_when, state, undo_until, req_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`
    ).bind(id, op, extra.undoOf ?? null, ctx.actor, ctx.email, JSON.stringify(params), items.length, planned, reads, when, undoUntil(), extra.reqId ? String(extra.reqId).slice(0, 80) : null, now),
  ];
  const skippedKeys: string[] = [];
  for (const it of items) {
    const ids: string[] = it.steps.map(() => newId('wco'));
    for (let k = 0; k < it.steps.length; k++) {
      const s = it.steps[k];
      const payload: Record<string, unknown> = { ...s.body };
      if (s.dep !== undefined) payload.__dep = ids[s.dep];
      if ((s as any).origRow) payload.__orig = (s as any).origRow;
      let idem: string | null = null;
      if (s.op === 'create' && !extra.undoOf) idem = keyed.find((k) => k.it === it)?.key ?? null;
      stmts.push(
        ctx.env.DB.prepare(
          `INSERT INTO act_outbox (id, batch_id, action_id, cid, label, submission_id, op, before, payload, idem_key, state, attempts, queued_at) VALUES (?,?,?,?,?,?,?,?,?,?,'queued',0,?)`
        ).bind(ids[k], id, s.actionId ?? it.actionId ?? null, it.cid ?? null, it.label, it.submissionId ?? null, s.op, s.before ? JSON.stringify(s.before, (_k, v) => (v === undefined ? null : v)) : null, JSON.stringify(payload), idem, now)
      );
    }
    void skippedKeys;
  }
  try {
    for (let i = 0; i < stmts.length; i += 40) await ctx.env.DB.batch(stmts.slice(i, i + 40));
  } catch (err) {
    // Never leave half a batch behind. A repeat of the same button press (same req_id) gets the first batch.
    await ctx.env.DB.prepare('DELETE FROM act_outbox WHERE batch_id = ?').bind(id).run().catch(() => undefined);
    await ctx.env.DB.prepare('DELETE FROM act_batches WHERE id = ?').bind(id).run().catch(() => undefined);
    const first = await batchByReq(ctx.env, extra.reqId);
    if (first) return first.batch;
    throw err;
  }
  await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, batch_id: id, kind: 'batch_created', detail: `${op} ${items.length} (${planned} calls, ${when})` });
  forgetBoard();
  return { id, op, n: items.length, calls: planned, run_when: when, undo_until: undoUntil(), left: meter.used, duplicates: keyed.length - keyed.filter((k) => items.includes(k.it)).length };
}

export async function createBatch(ctx: Ctx, input: BatchInput & { req?: string }) {
  if (!ctx.env.DB) throw new Error('no database');
  if (input.op === 'create') throw new HttpError(400, 'bad_op', 'Entry rows are sent from the Entry tab.');
  const again = await batchByReq(ctx.env, input.req);
  if (again) return { batch: again.batch, skipped: 0, changed: 0, items: again.items };
  const board = await currentBoard(ctx);
  const plan = await planBatch(ctx, input, board);
  const batch = await saveBatch(ctx, input.op, plan.items, plan.params, { reqId: input.req, reads: plan.reads });
  return { batch, skipped: plan.skipped, changed: plan.changed, items: plan.items.map((i) => ({ id: i.actionId || i.submissionId, state: 'queued' })) };
}

/* ------------------------------------------------------------------ sending */

let tagRuleMemo: { v: boolean; at: number } | null = null;

/** Whether the upkeep route has a rule for action tags yet. An empty body tells them apart: the route refuses it with no rule; Blackbaud rejects it as incomplete with one. */
export async function tagRuleLive(ctx: Ctx): Promise<boolean> {
  if (tagRuleMemo && Date.now() - tagRuleMemo.at < 30 * 60000) return tagRuleMemo.v;
  const cached = await getSetting(ctx.env, 'rule:tags');
  if (cached) {
    const [v, at] = cached.split('|');
    if (Date.now() - Date.parse(at) < 30 * 60000) {
      tagRuleMemo = { v: v === '1', at: Date.parse(at) };
      return v === '1';
    }
  }
  const r = await ctx.repo.send([{ method: 'POST', path: '/constituent/v1/actions/customfields', body: {} }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  if (r.wait && !r.results.length) return cached ? cached.startsWith('1') : false;
  const live = !(r.results[0] && r.results[0].refused);
  await setSetting(ctx.env, 'rule:tags', `${live ? 1 : 0}|${nowIso()}`);
  tagRuleMemo = { v: live, at: Date.now() };
  return live;
}

async function tagValue(ctx: Ctx, category: string): Promise<string> {
  const key = `tagvalue:${category}`;
  const cached = await getSetting(ctx.env, key);
  if (cached) return cached;
  const r = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/actions/customfields/categories/values?category_name=${encodeURIComponent(category)}` }]);
  await addMeter(ctx.env, r.results.length, r.callsToday);
  const body = r.results[0]?.body;
  const list: string[] = r.results[0]?.ok && body && Array.isArray(body.value) ? body.value.map(String) : [];
  const value = list.find((v) => v.toLowerCase() === category.toLowerCase()) || list[0] || category;
  if (list.length) await setSetting(ctx.env, key, value);
  return value;
}

export interface RunResult {
  ok: true;
  done: number;
  left: number;
  held?: 'off' | 'limit' | 'busy' | 'tonight' | 'wait';
  tagsWaiting: number;
  items: { id: string; state: string; error?: string }[];
  meter: Awaited<ReturnType<typeof meterView>>;
}

const toItemState = (s: string): string => (s === 'sent' || s === 'verified' ? 'posted' : s === 'failed' || s === 'needs_human' ? 'failed' : s);
const itemId = (r: OutboxRow) => String(r.action_id || r.submission_id || r.id);

async function markSubmission(ctx: Ctx, row: OutboxRow, state: string, extra: { bb?: string | null; err?: string } = {}) {
  if (!row.submission_id) return;
  await ctx.env.DB.prepare('UPDATE act_submissions SET state = ?, bb_action_id = COALESCE(?, bb_action_id), posted_at = CASE WHEN ? = \'posted\' THEN ? ELSE posted_at END, posted_by = CASE WHEN ? = \'posted\' THEN ? ELSE posted_by END WHERE id = ?')
    .bind(state, extra.bb ?? null, state, nowIso(), state, ctx.actor, row.submission_id)
    .run();
}

/**
 * Send up to three requests of 15 calls (about 20 seconds) from one batch, record every answer by its position, and say how many
 * are left. The page calls this until `left` is 0. A lock row stops a second window from sending the same batch.
 */
export async function runBatch(ctx: Ctx, batchId: string, opts: { drain?: boolean; tags?: boolean } = {}): Promise<RunResult> {
  const env = ctx.env;
  const batch = await env.DB.prepare('SELECT * FROM act_batches WHERE id = ? LIMIT 1').bind(batchId).first<BatchRow>();
  if (!batch) throw new HttpError(404, 'not_found', 'That batch is not here.');
  const items: RunResult['items'] = [];
  const finish = async (held?: RunResult['held']): Promise<RunResult> => {
    const left = await runnableLeft(ctx, batchId);
    const tagsWaiting = (await env.DB.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND op = 'tag' AND state = 'queued'").bind(batchId).first<{ n: number }>())?.n || 0;
    return { ok: true, done: items.filter((i) => i.state === 'posted').length, left, held, tagsWaiting: Number(tagsWaiting), items, meter: await meterView(env) };
  };
  if (!opts.tags && (batch.state === 'done' || batch.state === 'undone' || batch.state === 'partial')) {
    // partial means every try is used; Try again resets it
    const r = await finish();
    return r;
  }
  if ((await getSetting(env, 'posting', 'on')) !== 'on') return finish('off');
  if (!(await takeLock(env, batchId, ctx.actor))) return finish('busy');
  const started = Date.now();
  // Blackbaud reads last_modified as Eastern clock time, so the read-back window starts ten minutes ago on that clock.
  const t0 = etClock(new Date(started - 10 * 60000));
  let held: RunResult['held'];
  const touched = new Map<string, boolean>(); // action id -> whether to read its tags too
  try {
    await env.DB.prepare("UPDATE act_batches SET state = 'running' WHERE id = ? AND state = 'queued'").bind(batchId).run();
    for (let round = 0; round < 3 && Date.now() - started < 18000; round++) {
      const meter = await getMeter(env);
      // A batch held for tonight waits for the new UTC day (the allowance starts again then) unless today's lane can take all of it.
      const newDay = utcDay() !== utcDay(new Date(batch.created_at));
      if (batch.run_when === 'tonight' && !newDay && meter.used + batch.calls_planned > LANE_CAP) return finish('tonight');
      // Everything the Work Center sends keeps to its lane. Undo and a change of 15 calls or fewer may use the room the lane leaves.
      const cap = batch.op === 'undo' ? DAILY_CAP - 100 : batch.calls_planned <= CHUNK ? SINGLES_UNTIL : LANE_CAP;
      if (meter.used + CHUNK + 1 > cap) return finish('limit');
      const cand = await env.DB.prepare("SELECT * FROM act_outbox WHERE batch_id = ? AND state = 'queued' ORDER BY queued_at, rowid LIMIT 80").bind(batchId).all<OutboxRow>();
      if (!cand.results.length) break;
      const tagsOk = cand.results.some((r) => r.op === 'tag') ? await tagRuleLive(ctx) : true;
      const send: { row: OutboxRow; call: OpsCall }[] = [];
      let stalled = false;
      for (const row of cand.results) {
        if (send.length >= CHUNK) break;
        if (row.op === 'tag') {
          if (!tagsOk) continue;
          const payload = parseObj(row.payload);
          let parent = row.action_id;
          if (!parent && payload.__dep) {
            const dep = await env.DB.prepare('SELECT state, bb_id FROM act_outbox WHERE id = ?').bind(payload.__dep).first<{ state: string; bb_id: string | null }>();
            if (!dep || dep.state === 'failed' || dep.state === 'needs_human' || dep.state === 'undone') {
              await env.DB.prepare("UPDATE act_outbox SET state = 'needs_human', last_error = ? WHERE id = ?").bind('The action this tag belongs to did not post.', row.id).run();
              items.push({ id: itemId(row), state: 'failed', error: 'The action this tag belongs to did not post.' });
              continue;
            }
            if (!dep.bb_id) continue; // its action posts in an earlier request of this batch
            parent = dep.bb_id;
          }
          const body = { parent_id: parent, category: payload.category, value: payload.value !== undefined ? String(payload.value) : await tagValue(ctx, String(payload.category)), date: payload.date };
          send.push({ row, call: { method: 'POST', path: '/constituent/v1/actions/customfields', body } });
          continue;
        }
        if (row.op === 'create' && (row.last_error || '').startsWith('check:') && row.cid) {
          // A lost answer on a create: look at the partner's actions before sending it again.
          const p = parseObj(row.payload);
          const read = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/constituents/${row.cid}/actions` }]);
          await addMeter(env, read.results.length, read.callsToday);
          const res = read.results[0];
          if (!res || !res.ok) {
            items.push({ id: itemId(row), state: 'queued' });
            continue;
          }
          const existing = (res.body && Array.isArray(res.body.value) ? res.body.value : []).map((a: any) => ({ id: a.id, type: a.type, date: a.date, summary: a.summary, added: a.date_added || a.added || null }));
          // Only an action added after this row was queued, and not already some other row's, can be this create.
          const taken = (await env.DB.prepare("SELECT bb_id FROM act_outbox WHERE cid = ? AND bb_id IS NOT NULL AND state <> 'undone'").bind(row.cid).all<{ bb_id: string }>()).results.map((x) => String(x.bb_id));
          const found = matchLostCreate(existing, { type: String(p.type), date: String(p.date), summary: String(p.summary) }, { skipIds: taken, after: etClock(new Date(Date.parse(row.queued_at) - 2 * 60000)) });
          if (found.ids.length === 1 && !found.unsure) {
            await env.DB.prepare("UPDATE act_outbox SET state = 'sent', bb_id = ?, sent_at = ?, last_error = NULL WHERE id = ?").bind(found.ids[0], nowIso(), row.id).run();
            await markSubmission(ctx, row, 'posted', { bb: found.ids[0] });
            items.push({ id: itemId(row), state: 'posted' });
            continue;
          }
          if (found.ids.length || found.unsure) {
            // Blackbaud may already hold this contact, and nothing proves which action is it. A person looks; nothing is sent twice.
            const why = 'Blackbaud may already hold this contact. Open the partner there; if it is in, skip this row. If it is not, press Try again.';
            await env.DB.prepare("UPDATE act_outbox SET state = 'needs_human', last_error = ? WHERE id = ?").bind(why, row.id).run();
            await markSubmission(ctx, row, 'failed', { err: why });
            items.push({ id: itemId(row), state: 'failed', error: why });
            continue;
          }
          await env.DB.prepare('UPDATE act_outbox SET last_error = NULL WHERE id = ?').bind(row.id).run();
          row.last_error = null;
        }
        const { method, path } = requestFor(row);
        const body = parseObj(row.payload);
        delete body.__dep;
        delete body.__orig;
        send.push({ row, call: { method, path, body: row.op === 'delete' ? undefined : body } });
      }
      if (!send.length) break;
      for (const s of send) if (s.row.submission_id) await markSubmission(ctx, s.row, 'posting');
      const res = await ctx.repo.send(send.map((s) => s.call));
      const ran = res.results.length;
      await addMeter(env, ran, res.callsToday);
      const sentRows: OutboxRow[] = [];
      for (let i = 0; i < send.length; i++) {
        const { row } = send[i];
        const r: CallResult | undefined = res.results[i];
        const v = verdictOf(r);
        const now = nowIso();
        if (v === 'wait' && !r) {
          // The route stopped before this call, or the answer was lost. A create may have landed: check before sending it again.
          if (res.lost && row.op === 'create') {
            await env.DB.prepare("UPDATE act_outbox SET attempts = attempts + 1, last_error = 'check: the answer was lost' WHERE id = ?").bind(row.id).run();
          }
          items.push({ id: itemId(row), state: 'queued' });
          continue;
        }
        if (v === 'wait') {
          // Blackbaud or the upkeep route answered "not now" (429, 5xx, a stop message). Count the try; the fifth one needs a person.
          const n = row.attempts + 1;
          const why = sayWhy(r);
          if (n >= 5) {
            await env.DB.prepare("UPDATE act_outbox SET state = 'needs_human', attempts = ?, last_error = ? WHERE id = ?").bind(n, why, row.id).run();
            if (row.op === 'create') await markSubmission(ctx, row, 'failed', { err: why });
            items.push({ id: itemId(row), state: 'failed', error: why });
          } else {
            await env.DB.prepare("UPDATE act_outbox SET attempts = ?, last_error = ? WHERE id = ?").bind(n, why, row.id).run();
            items.push({ id: itemId(row), state: 'queued' });
          }
          stalled = true;
          continue;
        }
        if (v === 'refused' && row.op === 'tag') {
          await env.DB.prepare("UPDATE act_outbox SET last_error = 'waiting for the tag rule' WHERE id = ?").bind(row.id).run();
          await setSetting(env, 'rule:tags', `0|${now}`);
          tagRuleMemo = { v: false, at: Date.now() };
          items.push({ id: itemId(row), state: 'queued' });
          continue;
        }
        // A refusal means the upkeep route has no rule for this change. Retrying cannot help; a person presses Try again once the rule exists.
        const next = v === 'refused' ? { state: 'needs_human' as const, attempts: row.attempts + 1 } : advance(row.attempts, v);
        const err = v === 'sent' ? null : sayWhy(r);
        const bbId = v === 'sent' && row.op === 'create' && r?.body?.id ? String(r.body.id) : row.bb_id;
        await env.DB.prepare('UPDATE act_outbox SET state = ?, attempts = ?, bb_id = ?, last_error = ?, sent_at = CASE WHEN ? = \'sent\' THEN ? ELSE sent_at END WHERE id = ?')
          .bind(next.state, next.attempts, bbId, err, next.state, now, row.id)
          .run();
        if (v === 'sent') {
          sentRows.push({ ...row, bb_id: bbId });
          const orig = parseObj(row.payload).__orig;
          if (orig) await env.DB.prepare("UPDATE act_outbox SET state = 'undone', idem_key = NULL WHERE id = ?").bind(orig).run();
          if (row.op === 'create') await markSubmission(ctx, row, 'posted', { bb: bbId });
          if (row.op === 'delete' && row.submission_id) {
            await env.DB.prepare("UPDATE act_submissions SET state = 'waiting', bb_action_id = NULL, posted_at = NULL, posted_by = NULL WHERE id = ?").bind(row.submission_id).run();
          }
          items.push({ id: itemId(row), state: 'posted' });
        } else {
          if (row.op === 'create') await markSubmission(ctx, row, next.state === 'queued' ? 'waiting' : 'failed', { err: err || '' });
          items.push({ id: itemId(row), state: next.state === 'queued' ? 'queued' : 'failed', error: err || undefined });
          if (next.state !== 'queued') await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, batch_id: batchId, action_id: row.action_id, kind: 'failed', status: r?.status, detail: err || '' });
        }
      }
      await env.DB.prepare('UPDATE act_batches SET calls_used = calls_used + ? WHERE id = ?').bind(ran, batchId).run();
      await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, batch_id: batchId, kind: 'call', ok: sentRows.length === send.length, detail: `${ran} of ${send.length} calls ran, ${sentRows.length} sent` });
      if (sentRows.length) {
        await verify(ctx, batchId, sentRows, t0);
        for (const r of sentRows) {
          const id = r.op === 'create' ? r.bb_id : r.action_id;
          if (!id) continue;
          touched.set(id, (touched.get(id) || false) || r.op === 'create' || r.op === 'tag');
        }
      }
      // Nothing ran, or Blackbaud said not now: stop here so the page does not hammer a shared key. The next press, or the overnight run, picks it up.
      if (ran === 0) {
        held = res.wait && /limit/i.test(res.wait) ? 'limit' : 'wait';
        break;
      }
      if (stalled) {
        held = 'wait';
        break;
      }
      if (ran < send.length) break; // the route stopped: let the next call (or the drain) pick it up
    }
  } finally {
    await refreshTouched(ctx, batchId, touched);
    await dropLock(env, batchId);
    forgetBoard();
  }
  const left = await runnableLeft(ctx, batchId);
  if (!left) {
    const bad = await env.DB.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND state IN ('failed', 'needs_human')").bind(batchId).first<{ n: number }>();
    await env.DB.prepare('UPDATE act_batches SET state = ?, finished_at = ? WHERE id = ?').bind(Number(bad?.n) ? 'partial' : 'done', nowIso(), batchId).run();
    if (batch.op === 'undo' && batch.undo_of) await settleUndone(env, batch.undo_of);
  }
  return finish(held);
}

/**
 * After a batch, ask the sync worker to re-read the actions it changed so the pending overlay clears once the mirror matches.
 * Ids with tags and ids without go as two requests (the worker takes one tags setting per request), 200 ids at most in all.
 * The SKY calls it can spend (1 per id, 2 with tags) go into the meter. It skips when the day's room is short; the next mirror sync then clears the overlay.
 */
async function refreshTouched(ctx: Ctx, batchId: string, touched: Map<string, boolean>): Promise<void> {
  if (!touched.size) return;
  try {
    const all = [...touched.entries()].slice(0, REFRESH_MAX);
    const withTags = all.filter(([, t]) => t).map(([id]) => id);
    const plain = all.filter(([, t]) => !t).map(([id]) => id);
    const cost = withTags.length * 2 + plain.length;
    const meter = await getMeter(ctx.env);
    if (meter.used + cost > DAILY_CAP - 100) {
      await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, batch_id: batchId, kind: 'refresh', ok: false, detail: `skipped, ${cost} calls would pass the day's room` });
      return;
    }
    let spent = 0;
    const notes: string[] = [];
    for (const [ids, tags] of [[withTags, true], [plain, false]] as [string[], boolean][]) {
      if (!ids.length) continue;
      const r = await ctx.repo.refreshMirror(ids, tags);
      if (r.ok) {
        spent += r.maxCalls;
        notes.push(`${ids.length} ${tags ? 'with tags' : 'plain'} run ${r.runId}`);
      } else notes.push(`${ids.length} not queued: ${r.wait || 'refused'}`);
    }
    if (spent) await addMeter(ctx.env, spent);
    await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, batch_id: batchId, kind: 'refresh', ok: spent > 0, detail: `${notes.join('; ')} (up to ${spent} SKY calls)` });
  } catch {
    // A refresh that cannot be asked for leaves the overlay to the next mirror sync.
  }
}

async function runnableLeft(ctx: Ctx, batchId: string): Promise<number> {
  const r = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND state = 'queued' AND NOT (op = 'tag' AND last_error = 'waiting for the tag rule')").bind(batchId).first<{ n: number }>();
  return Number(r?.n) || 0;
}

/** After an undo finishes, the batch it undid reads as undone when every one of its rows is. */
async function settleUndone(env: Env, origBatch: string): Promise<void> {
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM act_outbox WHERE batch_id = ? AND state NOT IN ('undone', 'failed', 'needs_human')").bind(origBatch).first<{ n: number }>();
  if (!Number(left?.n)) await env.DB.prepare("UPDATE act_batches SET state = 'undone', finished_at = COALESCE(finished_at, ?) WHERE id = ?").bind(nowIso(), origBatch).run();
}

/** One read after a request: which of the changes just sent does Blackbaud now show? Best effort; a row it cannot find stays "sent". */
export async function verify(ctx: Ctx, batchId: string, rows: OutboxRow[], since: string): Promise<void> {
  const patches = rows.filter((r) => r.op === 'patch' && r.action_id);
  if (!patches.length) return;
  const res = await ctx.repo.send([{ method: 'GET', path: `/constituent/v1/actions?last_modified=${since}&limit=2000` }]);
  await addMeter(ctx.env, res.results.length, res.callsToday);
  const body = res.results[0]?.body;
  if (!res.results[0]?.ok || !body || !Array.isArray(body.value)) return;
  const seen = new Map<string, any>(body.value.map((v: any) => [String(v.id), v]));
  const now = nowIso();
  for (const r of patches) {
    const a = seen.get(String(r.action_id));
    if (!a) continue;
    const want = parseObj(r.payload);
    const ok =
      (want.completed === undefined || Boolean(a.completed) === Boolean(want.completed)) &&
      (want.date === undefined || String(a.date || '').slice(0, 10) === String(want.date).slice(0, 10)) &&
      (want.fundraisers === undefined || JSON.stringify([...(a.fundraisers || [])].map(String).sort()) === JSON.stringify([...want.fundraisers].map(String).sort()));
    if (ok) await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'verified', verified_at = ? WHERE id = ? AND state = 'sent'").bind(now, r.id).run();
  }
  void batchId;
}

/* ------------------------------------------------------------------ undo, retry, recent, drain */

export async function undoBatch(ctx: Ctx, batchId: string) {
  const batch = await ctx.env.DB.prepare('SELECT * FROM act_batches WHERE id = ? LIMIT 1').bind(batchId).first<BatchRow>();
  if (!batch) throw new HttpError(404, 'not_found', 'That batch is not here.');
  if (batch.state === 'undone' || batch.op === 'undo') throw new HttpError(409, 'already_undone', 'That batch is already undone.');
  if (nowIso() > batch.undo_until) throw new HttpError(409, 'too_late', 'Undo is open for 24 hours. This batch is past that.');
  const rows = (await ctx.env.DB.prepare('SELECT * FROM act_outbox WHERE batch_id = ? ORDER BY rowid').bind(batchId).all<OutboxRow>()).results;
  const items: PlannedItem[] = [];
  let cancelled = 0;
  let unresolved = 0;
  let tagsStay = 0;
  for (const r of rows) {
    if (r.state === 'undone') continue;
    if (r.state === 'queued' || r.state === 'failed' || r.state === 'needs_human') {
      // Never reached Blackbaud: nothing to put back. The key is cleared so the same contact can be entered again.
      await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'undone', idem_key = NULL WHERE id = ?").bind(r.id).run();
      if (r.submission_id) await markSubmission(ctx, r, 'waiting');
      cancelled++;
      continue;
    }
    if (r.op === 'create' && !r.bb_id) {
      // The create went out but its id never came back, so there is nothing to delete by. A person finds it in Blackbaud.
      await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'needs_human', last_error = ? WHERE id = ?").bind('This contact is in Blackbaud but its number was not saved. Find it on the partner and remove it there.', r.id).run();
      unresolved++;
      continue;
    }
    const step = undoStep({ op: r.op, action_id: r.action_id, bb_id: r.bb_id, before: r.before ? parseObj(r.before) : null });
    if (!step) {
      // Tags have no undo route: they stay on the action in Blackbaud.
      if (r.op === 'tag') tagsStay++;
      await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'undone', idem_key = NULL WHERE id = ?").bind(r.id).run();
      continue;
    }
    (step as any).origRow = r.id;
    items.push({ actionId: step.actionId, cid: r.cid ?? undefined, label: r.label || '', steps: [step], submissionId: r.submission_id ?? undefined });
  }
  if (!items.length) {
    if (!unresolved) await ctx.env.DB.prepare("UPDATE act_batches SET state = 'undone', finished_at = ? WHERE id = ?").bind(nowIso(), batchId).run();
    forgetBoard();
    return { batch: null, cancelled, unresolved, tagsStay };
  }
  const saved = await saveBatch(ctx, 'undo', items, { undo_of: batchId }, { undoOf: batchId, whenOverride: 'now' });
  await logEvent(ctx.env, { actor: ctx.actor, actor_email: ctx.email, batch_id: batchId, kind: 'undone', detail: `undo batch ${saved.id}` });
  return { batch: saved, cancelled, unresolved, tagsStay };
}

export async function retryBatch(ctx: Ctx, batchId: string) {
  const batch = await ctx.env.DB.prepare('SELECT * FROM act_batches WHERE id = ? LIMIT 1').bind(batchId).first<BatchRow>();
  if (!batch) throw new HttpError(404, 'not_found', 'That batch is not here.');
  const r = await ctx.env.DB.prepare("UPDATE act_outbox SET state = 'queued', attempts = 0, last_error = CASE WHEN op = 'create' THEN 'check: trying again' ELSE NULL END WHERE batch_id = ? AND state IN ('failed', 'needs_human')").bind(batchId).run();
  await ctx.env.DB.prepare("UPDATE act_batches SET state = 'running', finished_at = NULL WHERE id = ? AND state IN ('partial', 'done')").bind(batchId).run();
  return { ok: true, requeued: r.meta?.changes ?? 0 };
}

export async function recentBatches(env: Env, hours = 36) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const bs = (await env.DB.prepare('SELECT * FROM act_batches WHERE created_at >= ? AND op <> \'undo\' ORDER BY created_at DESC LIMIT 60').bind(since).all<BatchRow>()).results;
  const out = [];
  for (const b of bs) {
    const rows = (await env.DB.prepare('SELECT * FROM act_outbox WHERE batch_id = ? ORDER BY rowid LIMIT 400').bind(b.id).all<OutboxRow>()).results;
    const byItem = new Map<string, { id: string; name: string; what: string; state: string; error?: string }>();
    for (const r of rows) {
      if (r.op === 'tag' && byItem.has(itemId(r))) continue;
      const [name, what] = String(r.label || '').split(' | ');
      const prev = byItem.get(itemId(r));
      let state = r.state === 'sent' || r.state === 'verified' ? 'posted' : r.state === 'failed' || r.state === 'needs_human' ? 'failed' : r.state === 'queued' ? (b.run_when === 'tonight' ? 'tonight' : 'saving') : r.state;
      if (prev && prev.state === 'failed') state = 'failed';
      byItem.set(itemId(r), { id: itemId(r), name: name || 'Partner', what: what || '', state, error: r.last_error || undefined });
    }
    const items = [...byItem.values()];
    const count = (s: string) => items.filter((i) => i.state === s).length;
    out.push({
      id: b.id, op: b.op, label: batchLabel(b, items.length), actor: b.actor, at: b.created_at, n: b.n,
      posted: count('posted'), failed: count('failed'), queued: count('tonight') + count('saving'), tonight: count('tonight'), calls: b.calls_used || b.calls_planned,
      planned: b.calls_planned, undo_until: b.undo_until, undone: b.state === 'undone', state: b.state, run_when: b.run_when, items,
    });
  }
  return out;
}

export function batchLabel(b: { op: string; params: string }, n: number): string {
  const p = parseObj(b.params);
  const word = (k: number, one: string, many = one + 's') => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
  if (b.op === 'complete') return p.how && p.how !== 'none' && THANK_HOWS[p.how] ? `Marked ${word(n, 'action')} complete as thank-you ${THANK_HOWS[p.how].label.toLowerCase()}s` : `Marked ${word(n, 'action')} complete`;
  if (b.op === 'thank') return `Marked ${word(n, 'thank-you')} done`;
  if (b.op === 'close_thanked') return `Closed ${word(n, 'thank-you task')} as thanked`;
  if (b.op === 'reassign') return `Reassigned ${word(n, 'action')}`;
  if (b.op === 'reschedule') return `Moved ${word(n, 'action')} to ${String(p.due || '').slice(5).replace('-', '/')}`;
  if (b.op === 'create') return `Entered ${word(n, 'contact')}`;
  return `${b.op} ${n}`;
}

/** The overnight run: batches held for tonight, and any batch that stopped partway, oldest first, inside the day's lane. */
export async function drain(ctx: Ctx): Promise<{ ran: number; left: number }> {
  const started = Date.now();
  const batches = (await ctx.env.DB.prepare("SELECT id FROM act_batches WHERE state IN ('queued', 'running') ORDER BY created_at LIMIT 20").all<{ id: string }>()).results;
  let ran = 0;
  let left = 0;
  for (const b of batches) {
    if (Date.now() - started > 22000) {
      left += await runnableLeft(ctx, b.id);
      continue;
    }
    const r = await runBatch(ctx, b.id, { drain: true });
    ran += r.done;
    left += r.left;
    if (r.held === 'limit') break;
  }
  // Tags that waited for the upkeep route's tag rule go out once the rule is live.
  const tagBatches = (await ctx.env.DB.prepare("SELECT DISTINCT batch_id AS id FROM act_outbox WHERE op = 'tag' AND state = 'queued' AND last_error = 'waiting for the tag rule' LIMIT 10").all<{ id: string }>()).results;
  if (tagBatches.length && (await tagRuleLive(ctx))) {
    for (const b of tagBatches) {
      if (Date.now() - started > 22000) break;
      const r = await runBatch(ctx, b.id, { drain: true, tags: true });
      ran += r.done;
    }
  }
  return { ran, left };
}

/** Pages open: pick up any batch that was sent from a window that closed. */
export async function resumeStuck(ctx: Ctx): Promise<void> {
  const old = new Date(Date.now() - 2 * 60000).toISOString();
  const b = await ctx.env.DB.prepare("SELECT id FROM act_batches WHERE state IN ('queued', 'running') AND run_when = 'now' AND created_at < ? ORDER BY created_at LIMIT 1").bind(old).first<{ id: string }>();
  if (b) await runBatch(ctx, b.id);
}

export async function healthView(ctx: Ctx, mirrorOk: boolean, blackbaudOk: boolean) {
  const release = await getSetting(ctx.env, 'release', 'admins');
  const posting = await getSetting(ctx.env, 'posting', 'on');
  const rule = await getSetting(ctx.env, 'rule:tags');
  return { ok: true, mirror: { reachable: mirrorOk }, blackbaud: { reachable: blackbaudOk, rules: { tags: rule ? rule.startsWith('1') : null } }, meter: await meterView(ctx.env), release, posting };
}

export type { BoardData };
