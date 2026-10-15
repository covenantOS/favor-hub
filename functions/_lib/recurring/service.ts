// Recurring gifts: what the routes do. The list reads the D1 copy of Blackbaud (read.ts) and lays the hub's own finished changes over
// it, so a change shows at once, before the next sync reads it back. A change goes to Blackbaud through SKY API (the favorintl.org
// route /api/blackbaud/recurring-edit holds the connection and its own daily limit), is read back by that route, and is kept here as
// a change log row with the values before and after. Undo works for 24 hours and puts the old value back through the same route.
// A change that lands also files one completed Information Update on the partner's record, as an ordinary batch (Recent, Undo and
// the write guard apply). Information Update counts as no portfolio contact, so a billing change never moves credit.
import { HttpError, newId, nowIso } from '../http';
import { isTester, TESTER_REFUSAL } from '../testuser';
import { mirrorQ, listMirrorQ } from '../work/partner';
import { opsUrl } from '../foundations/blackbaud';
import { saveBatch, todayEt, authorizeBatch, type Ctx } from '../work/service';
import { planEdit } from '../work/edit';
import { clean } from '../actions/completion';
import { EDITABLE_FREQUENCIES, FREQUENCY_LABEL, loadRecurring, type RawSchedule, type ScheduleRow, type RecurringStats } from './read';

const ID = /^\d{1,12}$/;
export const UNDO_HOURS = 24;
export const FOLLOW_TYPE = 'RESERVED (Information Update)';
export const ASKED_BY = ['Phone call', 'Email', 'Letter', 'Online', 'In person'] as const;
export const OPS = ['amount', 'frequency', 'status'] as const;
export type Op = (typeof OPS)[number];
export const STATUS_WANTED = ['Active', 'Held', 'Terminated'] as const;

/** The desk that works recurring gifts: admins, the Support Team and Partner Care. */
export const mayRecurring = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'support' || s.role === 'partner_care';

export interface Snapshot { id: string; constituent_id: string; amount: number | null; frequency: string | null; status: string | null; start_date: string | null; end_date: string | null; next_date: string | null }
export type SenderResult = { ok: true; before: Snapshot; after: Snapshot } | { ok: false; message: string; code?: string; lost?: boolean };
export interface SendInput { id: string; op: Op; amount?: number; frequency?: string; status?: string }
export type EditSender = (env: Ctx['env'], input: SendInput) => Promise<SenderResult>;

export async function recurringEditUrl(env: Ctx['env']): Promise<string> {
  const ops = await opsUrl(env);
  return ops.replace(/\/ops\/?$/, '/recurring-edit');
}

/** The real sender: favorintl.org's route. Without the Blackbaud connection nothing is sent. */
export const liveSender: EditSender = async (env, input) => {
  if (!env.BLACKBAUD_SETUP_KEY) return { ok: false, message: 'The Blackbaud connection is not set up on FavorOS yet.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 28000);
  try {
    const res = await fetch(await recurringEditUrl(env), {
      method: 'POST',
      headers: { 'X-Setup-Key': env.BLACKBAUD_SETUP_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 favor-hub-recurring' },
      body: JSON.stringify(input),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (data && data.ok === true && data.before && data.after) return { ok: true, before: data.before, after: data.after };
    if (data && data.error) return { ok: false, code: String(data.error), message: String(data.message || 'Blackbaud refused the change.') };
    return { ok: false, message: 'Blackbaud did not answer. Reload the page before trying again.', lost: true };
  } catch {
    return { ok: false, message: 'Blackbaud did not answer. Reload the page before trying again, the change may have gone through.', lost: true };
  } finally {
    clearTimeout(timer);
  }
};

export interface ChangeRow {
  id: string;
  gift_id: string;
  cid: string;
  op: string;
  before_json: string | null;
  after_json: string | null;
  asked_by: string | null;
  state: string;
  error: string | null;
  undo_of: string | null;
  batch_id: string | null;
  actor: string | null;
  actor_email: string | null;
  at: string;
}

export interface ChangeView {
  id: string;
  op: Op;
  summary: string;
  by: string;
  at: string;
  askedBy: string;
  state: string;
  undoable: boolean;
}

const money = (n: number | null | undefined): string => (n == null ? '' : '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const lc = (v: string | null | undefined) => (v ? FREQUENCY_LABEL[String(v).toUpperCase()] || String(v).toLowerCase() : '');

export function summaryOf(op: string, before: Partial<Snapshot>, after: Partial<Snapshot>): string {
  if (op === 'amount') return `Amount ${money(before.amount)} to ${money(after.amount)}`;
  if (op === 'frequency') return `Frequency ${lc(before.frequency)} to ${lc(after.frequency)}`;
  const word: Record<string, string> = { Active: 'Resumed', Held: 'Held', Terminated: 'Stopped' };
  return word[String(after.status)] || `Status ${before.status} to ${after.status}`;
}

const parse = <T,>(v: string | null): T | null => {
  try {
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};

/** Finished changes in the last 36 hours, oldest first. They sit over the mirror until its next sync reads the new values. */
export async function recentChanges(ctx: Ctx, sinceIso: string): Promise<ChangeRow[]> {
  const r = await ctx.env.DB.prepare('SELECT * FROM act_recurring_changes WHERE at >= ? ORDER BY at ASC').bind(sinceIso).all<ChangeRow>().catch(() => ({ results: [] as ChangeRow[] }));
  return r.results;
}

const asMs = (s: string): number => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');

/** Lay finished changes over mirror rows that were synced before the change. A stopped schedule reads as stopped today. */
export function overlay(schedules: RawSchedule[], changes: ChangeRow[], today: string): RawSchedule[] {
  const by = new Map<string, ChangeRow[]>();
  for (const c of changes) if (c.state === 'done') (by.get(c.gift_id) || by.set(c.gift_id, []).get(c.gift_id)!).push(c);
  if (!by.size) return schedules;
  return schedules.map((s) => {
    const list = (by.get(String(s.id)) || []).filter((c) => !s.synced || asMs(c.at) > asMs(s.synced));
    if (!list.length) return s;
    const out = { ...s };
    for (const c of list) {
      const after = parse<Snapshot>(c.after_json);
      if (!after) continue;
      if (c.op === 'amount' && after.amount != null) out.amount = after.amount;
      if (c.op === 'frequency' && after.frequency) out.freq = after.frequency;
      if (c.op === 'status' && after.status) {
        out.status = after.status;
        out.sdate = c.at.slice(0, 10);
      }
    }
    return out;
  });
}

export function changeViews(rows: ChangeRow[], me: { email: string; admin: boolean }, now = Date.now()): Map<string, ChangeView[]> {
  const undone = new Set(rows.filter((r) => r.undo_of && r.state === 'done').map((r) => r.undo_of as string));
  const out = new Map<string, ChangeView[]>();
  for (const r of rows.slice().sort((a, b) => (a.at < b.at ? 1 : -1))) {
    if (r.state !== 'done' && r.state !== 'failed' && r.state !== 'lost') continue;
    const before = parse<Snapshot>(r.before_json) || {};
    const after = parse<Snapshot>(r.after_json) || {};
    const fresh = now - Date.parse(r.at) < UNDO_HOURS * 3600_000;
    const stop = r.op === 'status' && (after as Snapshot).status === 'Terminated';
    const view: ChangeView = {
      id: r.id, op: r.op as Op,
      summary: r.state === 'done' ? (r.undo_of ? 'Undone: ' : '') + summaryOf(r.op, before, after) : r.state === 'lost' ? 'No answer from Blackbaud, check the schedule' : `Not saved: ${r.error || 'Blackbaud refused it'}`,
      by: r.actor || '', at: r.at, askedBy: r.asked_by || '', state: undone.has(r.id) ? 'undone' : r.state,
      undoable: r.state === 'done' && !r.undo_of && !undone.has(r.id) && fresh && !stop && (me.admin || (r.actor_email || '').toLowerCase() === me.email.toLowerCase()),
    };
    (out.get(r.gift_id) || out.set(r.gift_id, []).get(r.gift_id)!).push(view);
  }
  return out;
}

export interface RecurringOut {
  ok: true;
  today: string;
  synced: string;
  stats: RecurringStats;
  rows: (ScheduleRow & { changes: ChangeView[] })[];
  frequencies: { value: string; label: string }[];
  askedBy: readonly string[];
  /** Whether this person may change a schedule. Test accounts read but cannot write. */
  canEdit: boolean;
}

export async function recurringResponse(ctx: Ctx): Promise<RecurringOut> {
  if (!mayRecurring(ctx.scope)) throw new HttpError(403, 'not_yours', 'Recurring gifts is for the admin desk, the Support Team and Partner Care.');
  const today = todayEt();
  const synced = await ctx.repo.synced().catch(() => '');
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const month = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [changes, log] = await Promise.all([recentChanges(ctx, since), recentChanges(ctx, month)]);
  const loaded = await loadRecurring(listMirrorQ(ctx.env), { today, transform: (s) => overlay(s, changes, today) });
  const views = changeViews(log, { email: ctx.email, admin: !!ctx.scope && ctx.scope.role === 'admin' });
  return {
    ok: true, today, synced, stats: loaded.stats,
    rows: loaded.rows.map((r) => ({ ...r, changes: views.get(r.id) || [] })),
    frequencies: EDITABLE_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] })),
    askedBy: ASKED_BY,
    canEdit: !isTester(ctx.email),
  };
}

export interface EditInput { giftId?: string; op?: string; amount?: unknown; frequency?: unknown; status?: unknown; askedBy?: string; note?: string; req?: string }

/** One schedule as it stands in Blackbaud's copy, read live (never from a saved copy), with this hub's own finished changes laid over it. */
async function scheduleNow(ctx: Ctx, giftId: string): Promise<{ cid: string; name: string; amount: number; frequency: string; status: string; method: string } | null> {
  const rows = await mirrorQ(ctx.env)<any>(
    `SELECT r.constituent_record_id AS cid, r.amount AS amount, r.frequency AS freq, r.gift_status AS status, r.synced_at AS synced, g.gift_payment_method AS pm,
            COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name
       FROM recurring_schedules r LEFT JOIN gifts g ON g.id = r.gift_id LEFT JOIN constituents c ON c.id = r.constituent_record_id WHERE r.gift_id = ?1`,
    [giftId]
  );
  const r = rows[0];
  if (!r) return null;
  const changes = (await recentChanges(ctx, new Date(Date.now() - 36 * 3600_000).toISOString())).filter((c) => c.gift_id === giftId);
  const [o] = overlay([{ id: giftId, cid: String(r.cid), status: String(r.status || ''), amount: Number(r.amount), freq: String(r.freq || ''), start: '', ends: '', nxt: '', sdate: '', synced: String(r.synced || ''), pm: '', splits: null }], changes, todayEt());
  return { cid: String(r.cid), name: String(r.name || ''), amount: Number(o.amount), frequency: String(o.freq || ''), status: String(o.status || ''), method: String(r.pm || '') };
}

async function claimReq(ctx: Ctx, req: string): Promise<ChangeRow | null> {
  return ctx.env.DB.prepare('SELECT * FROM act_recurring_changes WHERE req = ?').bind(req).first<ChangeRow>().catch(() => null);
}

/**
 * Change one schedule. The checks run before anything is sent. The change row is saved first as "sending" so a lost answer leaves a
 * trace, then finished as done or failed. Repeating a press with the same req returns the first answer.
 */
export async function editSchedule(ctx: Ctx, input: EditInput, send: EditSender = liveSender) {
  if (!mayRecurring(ctx.scope)) throw new HttpError(403, 'not_yours', 'Recurring gifts is for the admin desk, the Support Team and Partner Care.');
  if (isTester(ctx.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  const giftId = String(input.giftId || '');
  if (!ID.test(giftId)) throw new HttpError(400, 'bad_gift', 'Pick a schedule.');
  const op = String(input.op || '') as Op;
  if (!OPS.includes(op)) throw new HttpError(400, 'bad_op', 'Change the amount, the frequency or the status.');
  const req = String(input.req || '').slice(0, 60) || newId('rcr');
  const repeat = await claimReq(ctx, req);
  if (repeat) return { ok: true, repeat: true, state: repeat.state };

  const send_: SendInput = { id: giftId, op };
  if (op === 'amount') {
    const n = Number(String(input.amount ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 1 || n > 250000) throw new HttpError(400, 'bad_amount', 'Enter an amount between $1 and $250,000.');
    send_.amount = Math.round(n * 100) / 100;
  } else if (op === 'frequency') {
    const f = String(input.frequency || '').toUpperCase();
    if (!(EDITABLE_FREQUENCIES as readonly string[]).includes(f)) throw new HttpError(400, 'bad_frequency', 'Pick weekly, monthly, quarterly or yearly.');
    send_.frequency = f;
  } else {
    const s = String(input.status || '');
    if (!(STATUS_WANTED as readonly string[]).includes(s)) throw new HttpError(400, 'bad_status', 'Pick Active, Held or Stopped.');
    send_.status = s;
  }
  const askedBy = (ASKED_BY as readonly string[]).includes(String(input.askedBy)) ? String(input.askedBy) : '';
  const note = clean(input.note, 200);

  const now = await scheduleNow(ctx, giftId);
  if (!now) throw new HttpError(404, 'not_listed', 'That schedule is not on the list. Reload the page.');
  if (ctx.testCid && now.cid !== ctx.testCid) throw new HttpError(403, 'test_run', 'This is a test run as another role, and it may only change the one test record.');
  if (now.status === 'Terminated' || /complet/i.test(now.status)) throw new HttpError(409, 'ended', 'This schedule has stopped. Set up a new one in Blackbaud.');
  if (op === 'amount' && now.status !== 'Active' && now.status !== 'Held') throw new HttpError(409, 'not_active', 'Only an active or held schedule can change.');
  if (op === 'amount' && Number(send_.amount) === now.amount) throw new HttpError(400, 'same', 'That is the amount it already has.');
  if (op === 'frequency' && send_.frequency === now.frequency.toUpperCase()) throw new HttpError(400, 'same', 'It already runs on that frequency.');
  if (op === 'status' && send_.status === now.status) throw new HttpError(400, 'same', `It is already ${now.status === 'Terminated' ? 'stopped' : now.status.toLowerCase()}.`);
  await authorizeBatch(ctx, { op: 'new', cids: [now.cid], set: ctx.scope && ctx.scope.fid ? { fundraisers: [ctx.scope.fid] } : {} });

  const id = newId('rcg');
  const at = nowIso();
  await ctx.env.DB.prepare(
    `INSERT INTO act_recurring_changes (id, req, gift_id, cid, op, before_json, after_json, asked_by, state, actor, actor_email, at) VALUES (?,?,?,?,?,?,?,?, 'sending', ?,?,?)`
  ).bind(id, req, giftId, now.cid, op, JSON.stringify({ amount: now.amount, frequency: now.frequency, status: now.status }), null, askedBy || null, ctx.actor, ctx.email, at).run();

  const sent = await send(ctx.env, send_);
  if (!sent.ok) {
    await ctx.env.DB.prepare('UPDATE act_recurring_changes SET state = ?, error = ? WHERE id = ?').bind(sent.lost ? 'lost' : 'failed', sent.message.slice(0, 300), id).run();
    throw new HttpError(sent.lost ? 504 : 502, sent.lost ? 'lost' : sent.code || 'refused', sent.message);
  }
  await ctx.env.DB.prepare('UPDATE act_recurring_changes SET state = ?, before_json = ?, after_json = ? WHERE id = ?').bind('done', JSON.stringify(sent.before), JSON.stringify(sent.after), id).run();

  let batch: { id: string; n: number } | null = null;
  try {
    batch = await logAction(ctx, { changeId: id, cid: now.cid, name: now.name, op, before: sent.before, after: sent.after, askedBy, note, giftId });
  } catch {
    // The change stands. The record note failed and the change log still holds the facts.
  }
  return { ok: true, id, state: 'done', before: sent.before, after: sent.after, summary: summaryOf(op, sent.before, sent.after), batch };
}

async function logAction(ctx: Ctx, o: { changeId: string; cid: string; name: string; op: Op; before: Partial<Snapshot>; after: Partial<Snapshot>; askedBy: string; note: string; giftId: string; undo?: boolean }) {
  const today = todayEt();
  const synced = await ctx.repo.synced().catch(() => '');
  const owner = ctx.scope && ctx.scope.fid ? ctx.scope.fid : '';
  const set: Record<string, unknown> = {
    category: o.askedBy === 'Email' ? 'Email' : o.askedBy === 'Letter' ? 'Mailing' : o.askedBy === 'In person' ? 'Meeting' : 'Phone call',
    type: FOLLOW_TYPE,
    date: today,
    summary: `${o.undo ? 'Undid a recurring gift change' : 'Changed a recurring gift'}: ${summaryOf(o.op, o.before, o.after)}`,
    description: [o.note, o.askedBy ? `Partner asked by ${o.askedBy.toLowerCase()}.` : '', `Recurring gift ${o.giftId}. Changed in FavorOS by ${ctx.actor}.`].filter(Boolean).join('\n'),
    completed: true,
    status: 'Completed',
  };
  if (owner) set.fundraisers = [owner];
  set.direction = 'Outbound';
  const plan = await planEdit(ctx, { op: 'new', cids: [o.cid], set } as any, { today, synced });
  const batch = await saveBatch(ctx, 'new', plan.items, { op: 'new', n: plan.items.length, summary: 'Recurring gift change', recurring: o.giftId }, { reqId: 'rcl-' + o.changeId, reads: plan.reads, keySalt: o.changeId });
  if (!batch.id) return null;
  await ctx.env.DB.prepare('UPDATE act_recurring_changes SET batch_id = ? WHERE id = ?').bind(batch.id, o.changeId).run();
  return { id: batch.id, n: batch.n };
}

/** Put a change back within 24 hours. Stopping a schedule cannot be undone: Blackbaud does not restart a stopped schedule. */
export async function undoChange(ctx: Ctx, input: { id?: string; req?: string }, send: EditSender = liveSender) {
  if (!mayRecurring(ctx.scope)) throw new HttpError(403, 'not_yours', 'Recurring gifts is for the admin desk, the Support Team and Partner Care.');
  if (isTester(ctx.email)) throw new HttpError(403, 'test_user', TESTER_REFUSAL);
  const row = await ctx.env.DB.prepare('SELECT * FROM act_recurring_changes WHERE id = ?').bind(String(input.id || '')).first<ChangeRow>();
  if (!row) throw new HttpError(404, 'no_change', 'That change is not on record.');
  const admin = !!ctx.scope && ctx.scope.role === 'admin';
  if (!admin && (row.actor_email || '').toLowerCase() !== ctx.email.toLowerCase()) throw new HttpError(403, 'not_yours', 'Only the person who made a change, or an admin, can undo it.');
  if (row.state !== 'done' || row.undo_of) throw new HttpError(409, 'not_undoable', 'That change cannot be undone.');
  if (Date.now() - Date.parse(row.at) > UNDO_HOURS * 3600_000) throw new HttpError(409, 'too_late', `Undo is open for ${UNDO_HOURS} hours. Make a new change instead.`);
  const already = await ctx.env.DB.prepare("SELECT id FROM act_recurring_changes WHERE undo_of = ? AND state IN ('done', 'sending')").bind(row.id).first();
  if (already) throw new HttpError(409, 'already', 'That change was already undone.');
  const before = parse<Snapshot>(row.before_json);
  const after = parse<Snapshot>(row.after_json);
  if (!before || !after) throw new HttpError(409, 'not_undoable', 'That change has no saved values to go back to.');
  if (row.op === 'status' && (after.status === 'Terminated' || before.status === 'Terminated')) throw new HttpError(409, 'stopped', 'Stopping a schedule is final. Set up a new schedule in Blackbaud.');
  const op = row.op as Op;
  const back: SendInput = { id: row.gift_id, op };
  if (op === 'amount') back.amount = Number(before.amount);
  else if (op === 'frequency') back.frequency = String(before.frequency);
  else back.status = String(before.status);
  const req = String(input.req || '').slice(0, 60) || newId('rcu');
  const repeat = await claimReq(ctx, req);
  if (repeat) return { ok: true, repeat: true };

  const id = newId('rcg');
  await ctx.env.DB.prepare(
    `INSERT INTO act_recurring_changes (id, req, gift_id, cid, op, before_json, after_json, asked_by, state, undo_of, actor, actor_email, at) VALUES (?,?,?,?,?,?,?,?, 'sending', ?,?,?,?)`
  ).bind(id, req, row.gift_id, row.cid, op, row.after_json, null, row.asked_by, row.id, ctx.actor, ctx.email, nowIso()).run();
  const sent = await send(ctx.env, back);
  if (!sent.ok) {
    await ctx.env.DB.prepare('UPDATE act_recurring_changes SET state = ?, error = ? WHERE id = ?').bind(sent.lost ? 'lost' : 'failed', sent.message.slice(0, 300), id).run();
    throw new HttpError(sent.lost ? 504 : 502, sent.lost ? 'lost' : sent.code || 'refused', sent.message);
  }
  await ctx.env.DB.prepare('UPDATE act_recurring_changes SET state = ?, before_json = ?, after_json = ? WHERE id = ?').bind('done', JSON.stringify(sent.before), JSON.stringify(sent.after), id).run();
  let batch: { id: string; n: number } | null = null;
  try {
    const now = await scheduleNow(ctx, row.gift_id);
    batch = await logAction(ctx, { changeId: id, cid: row.cid, name: now ? now.name : '', op, before: sent.before, after: sent.after, askedBy: row.asked_by || '', note: '', giftId: row.gift_id, undo: true });
  } catch {
    // The undo stands.
  }
  return { ok: true, id, state: 'done', summary: summaryOf(op, sent.before, sent.after), batch };
}
