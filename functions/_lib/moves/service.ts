// The moves board's reads and writes. Reads: the Asks board's own loader (the same asks, the same scope), the lists snapshot (lr_hh,
// lr_holder) for who is a major partner and who holds them, and FavorOS's own tables (db/moves.sql). Writes go to those tables only; the
// next step also becomes a reminder in the Work Center (act_reminders), which is where tasks of this kind live.
import { HttpError, newId, nowIso, type Env } from '../http';
import { listMirrorQ, type Q } from '../work/partner';
import { readOnly } from '../work/repo';
import { loadAsks, mayAsks, type AskRow } from '../work/asks';
import { todayEt, type Ctx } from '../work/service';
import { listStaff } from '../work/db';
import { addReminders, dueFor, finishReminder } from '../work/remind';
import { isTester, TEST_PARTNER_IDS, TEST_PARTNER_REFUSAL } from '../testuser';
import { partnerGiving, type MirrorQ } from '../gifts/partner-giving';
import { compose, inScope, keyIndex, matches, sorter, tally, POOL, SORTS, type BoardRow, type CardRow, type Household, type Sort, type Stage } from './board';

const ID = /^\d{1,12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const PER = 12;
export const MAX_LIMIT = 100;

const NAMES_SQL = readOnly('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers');
const CONTACT_SQL = readOnly(`SELECT constituent_record_id AS cid, MAX(substr(COALESCE(action_completed_date, action_date_due), 1, 10)) AS d FROM actions
  WHERE constituent_record_id IN (SELECT value FROM json_each(?1)) AND action_completed_date IS NOT NULL AND action_type IN ('Phone call', 'Email', 'Meeting', 'Mailing') GROUP BY 1`);

const visible = (c: Ctx): Set<string> | null => (!c.scope || c.scope.all ? null : c.scope.fids);
export const mayMoves = mayAsks;
const isAdmin = (c: Ctx): boolean => !c.scope || c.scope.role === 'admin';

export async function loadStages(env: Env): Promise<Stage[]> {
  const r = await env.DB.prepare('SELECT id, label, sort, role, active FROM mv_stage ORDER BY sort, id').all<Stage>();
  return r.results;
}

interface HhRow { household_id: string; record_id: string; spouse_record_id: string | null; name: string; city: string; state: string; largest: number; lifetime: number; last_gift: string | null; last_contact: string | null; major: number; alive: number }
const toHh = (h: HhRow): Household => ({
  key: String(h.household_id),
  record: String(h.record_id),
  spouse: h.spouse_record_id ? String(h.spouse_record_id) : null,
  name: String(h.name || `Record ${h.record_id}`),
  city: String(h.city || ''),
  state: String(h.state || ''),
  largest: Number(h.largest) || 0,
  lifetime: Number(h.lifetime) || 0,
  lastGift: h.last_gift ? String(h.last_gift).slice(0, 10) : null,
  lastContact: h.last_contact ? String(h.last_contact).slice(0, 10) : null,
  major: Number(h.major) === 1,
});

/** The asks that count on the board: the ones the Asks board counts as open, closing or past (not held for review, not from former staff), in the person's portfolio. */
export async function liveAsks(ctx: Ctx, today: string): Promise<AskRow[]> {
  const q = listMirrorQ(ctx.env);
  const all = await loadAsks(ctx.env, q, today, false, ctx.bg);
  const vis = visible(ctx);
  return all
    .map((r) => ({ ...r, owners: vis ? r.owners.filter((o) => vis.has(o)) : r.owners }))
    .filter((r) => r.owners.length && !r.former && !r.review && r.state !== 'gave');
}

export interface Loaded { rows: BoardRow[]; stages: Stage[]; names: Record<string, string>; asks: AskRow[]; today: string }

/** Every board row the person may see, before the owner, search and page. */
export async function loadRows(ctx: Ctx): Promise<Loaded> {
  const env = ctx.env;
  const today = todayEt();
  const q: Q = listMirrorQ(env);
  const [stages, cards, asks, nameRows] = await Promise.all([
    loadStages(env),
    env.DB.prepare('SELECT key, cid, stage_id, next_step, next_due, entered_at, updated_at, updated_by FROM mv_card').all<CardRow>().then((r) => r.results),
    liveAsks(ctx, today),
    q<{ id: string; first: string; last: string }>(NAMES_SQL).catch(() => []),
  ]);
  const ids = [...new Set([...asks.map((a) => String(a.cid)), ...cards.map((c) => c.cid), ...cards.map((c) => c.key)])];
  const hhRows = (
    await env.DB.prepare(
      `SELECT household_id, record_id, spouse_record_id, name, city, state, largest, lifetime, last_gift, last_contact, major, alive FROM lr_hh
        WHERE (major = 1 AND alive = 1) OR record_id IN (SELECT value FROM json_each(?1)) OR spouse_record_id IN (SELECT value FROM json_each(?1)) OR household_id IN (SELECT value FROM json_each(?1))`
    ).bind(JSON.stringify(ids)).all<HhRow>().catch(() => ({ results: [] as HhRow[] }))
  ).results;
  const households = hhRows.map(toHh);
  const idx = keyIndex(households);
  const keyed = asks.map((a) => ({ ...a, key: idx.get(String(a.cid)) || String(a.cid) }));
  const keys = [...new Set([...keyed.map((a) => a.key), ...cards.map((c) => c.key), ...households.filter((h) => h.major).map((h) => h.key)])];
  const holderRows = (
    await env.DB.prepare('SELECT household_id AS k, fundraiser_id AS f FROM lr_holder WHERE household_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).all<{ k: string; f: string }>().catch(() => ({ results: [] as { k: string; f: string }[] }))
  ).results;
  const holders: Record<string, string[]> = {};
  for (const h of holderRows) (holders[String(h.k)] ||= []).push(String(h.f));
  const known = new Set(households.map((h) => h.key));
  const loose = keys.filter((k) => !known.has(k));
  const contacts: Record<string, string> = {};
  if (loose.length) for (const c of await q<{ cid: string; d: string }>(CONTACT_SQL, [JSON.stringify(loose)]).catch(() => [])) if (c.d) contacts[String(c.cid)] = c.d;
  const names: Record<string, string> = {};
  for (const f of nameRows) names[String(f.id)] = `${f.first || ''} ${f.last || ''}`.trim();
  const rows = compose({ stages, cards, households, holders, asks: keyed, contacts, today });
  return { rows: rows.filter((r) => inScope(r, visible(ctx))), stages, names, asks, today };
}

export interface BoardOut {
  ok: true;
  today: string;
  synced: string;
  admin: boolean;
  owner: string;
  q: string;
  sort: Sort;
  owners: { id: string; name: string; n: number }[];
  stages: { id: string; label: string; role: string; sort: number; n: number; asked: number; rows: (BoardRow & { ownerNames: string[] })[] }[];
  /** Every open ask on the board, summed. The Asks board's open total for the same person. */
  askedTotal: number;
  /** Partners on the board. */
  total: number;
  /** The stage list as an admin edits it, archived stages included. */
  stageDefs: Stage[];
}

const named = (names: Record<string, string>) => (r: BoardRow) => ({ ...r, ownerNames: r.owners.map((o) => names[o] || `Fundraiser ${o}`) });

function view(l: Loaded, p: { owner?: string; q?: string; sort?: string }) {
  const count = new Map<string, number>();
  for (const r of l.rows) for (const o of r.owners) count.set(o, (count.get(o) || 0) + 1);
  const owner = p.owner && count.has(p.owner) ? p.owner : '';
  const needle = String(p.q || '').trim().slice(0, 100).toLowerCase();
  const sort: Sort = (SORTS as readonly string[]).includes(p.sort || '') ? (p.sort as Sort) : 'asked';
  const rows = l.rows.filter((r) => (!owner || r.owners.includes(owner)) && matches(r, needle));
  return { rows, owner, needle, sort, count };
}

export async function boardResponse(ctx: Ctx, p: { owner?: string; q?: string; sort?: string; per?: number }): Promise<BoardOut> {
  if (!mayMoves(ctx.scope)) throw new HttpError(403, 'not_yours', 'Moves is for directors and the Support Team.');
  const l = await loadRows(ctx);
  const v = view(l, p);
  const per = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(p.per) || PER)));
  const cut = sorter(v.sort);
  const nm = named(l.names);
  const defs: { id: string; label: string; role: string; sort: number }[] = [{ id: POOL, label: 'Not staged', role: '', sort: -1 }, ...l.stages.filter((s) => s.active === 1)];
  const stages = defs.map((s) => {
    const mine = v.rows.filter((r) => r.stage === s.id).sort(cut);
    const t = tally(mine);
    return { id: s.id, label: s.label, role: s.role, sort: s.sort, n: t.n, asked: t.asked, rows: mine.slice(0, per).map(nm) };
  });
  const all = tally(v.rows);
  return {
    ok: true,
    today: l.today,
    synced: await ctx.repo.synced().catch(() => ''),
    admin: isAdmin(ctx),
    owner: v.owner,
    q: v.needle,
    sort: v.sort,
    owners: [...v.count.entries()].map(([id, n]) => ({ id, name: l.names[id] || `Fundraiser ${id}`, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    stages,
    askedTotal: all.asked,
    total: all.n,
    stageDefs: l.stages,
  };
}

export async function cardsResponse(ctx: Ctx, p: { stage?: string; owner?: string; q?: string; sort?: string; offset?: number; limit?: number }) {
  if (!mayMoves(ctx.scope)) throw new HttpError(403, 'not_yours', 'Moves is for directors and the Support Team.');
  const l = await loadRows(ctx);
  const v = view(l, p);
  const stage = String(p.stage || '');
  const all = stage && stage !== 'all' ? v.rows.filter((r) => r.stage === stage) : v.rows;
  const offset = Math.max(0, Math.floor(Number(p.offset) || 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(p.limit) || 25)));
  const t = tally(all);
  return { ok: true, stage: stage || 'all', n: t.n, asked: t.asked, offset, limit, rows: all.sort(sorter(v.sort)).slice(offset, offset + limit).map(named(l.names)) };
}

/* ------------------------------------------------------------------ one card */

export async function keyOf(env: Env, cid: string): Promise<string> {
  const r = await env.DB.prepare('SELECT household_id AS k FROM lr_hh WHERE record_id = ?1 OR spouse_record_id = ?1 OR household_id = ?1 LIMIT 1').bind(cid).first<{ k: string }>().catch(() => null);
  return r ? String(r.k) : cid;
}

/** The row for one partner when the person may see it. */
async function rowFor(ctx: Ctx, cid: string): Promise<{ row: BoardRow; l: Loaded } | null> {
  const key = await keyOf(ctx.env, cid);
  const l = await loadRows(ctx);
  const row = l.rows.find((r) => r.key === key);
  return row ? { row, l } : null;
}

export async function cardDetail(ctx: Ctx, cid: string) {
  if (!mayMoves(ctx.scope)) throw new HttpError(403, 'not_yours', 'Moves is for directors and the Support Team.');
  if (!ID.test(cid)) throw new HttpError(400, 'bad_id', 'That is not a partner number.');
  const hit = await rowFor(ctx, cid);
  if (!hit) throw new HttpError(403, 'not_yours', 'That partner is not on your board.');
  const { row, l } = hit;
  const q = listMirrorQ(ctx.env);
  const giving = await partnerGiving(q as unknown as MirrorQ, row.cid).catch(() => null);
  const members = new Set(giving ? giving.members.map((m) => m.id) : [row.cid]);
  const asks = l.asks.filter((a) => members.has(String(a.cid)));
  const audit = await ctx.env.DB.prepare('SELECT at, actor, kind, from_stage, to_stage, detail FROM mv_audit WHERE key = ? ORDER BY at DESC LIMIT 12').bind(row.key).all();
  return {
    ok: true,
    row: named(l.names)(row),
    stages: l.stages.filter((s) => s.active === 1).map((s) => ({ id: s.id, label: s.label })),
    asks: asks.map((a) => ({ id: a.id, amount: a.amount, date: a.date, line: a.line, state: a.state, closeDate: a.close ? a.close.date : null })),
    giving: giving ? { lifetime: giving.total, largest: giving.largest, last: giving.last, major: giving.major, members: giving.members } : null,
    audit: audit.results,
  };
}

/* ------------------------------------------------------------------ writes */

export function guardTester(ctx: Ctx, ...cids: string[]): void {
  if (isTester(ctx.email) && cids.some((c) => !TEST_PARTNER_IDS.includes(c))) throw new HttpError(403, 'test_only', TEST_PARTNER_REFUSAL);
}

const clip = (v: unknown, n: number) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

async function ownerEmail(ctx: Ctx, row: BoardRow): Promise<string> {
  if (isTester(ctx.email) || ctx.testCid) return ctx.email;
  const mine = ctx.scope && ctx.scope.fid && row.owners.includes(ctx.scope.fid);
  if (mine || !row.owners.length) return ctx.email;
  const staff = await listStaff(ctx.env).catch(() => []);
  const hit = staff.find((s) => s.active === 1 && s.bb_fundraiser_id && row.owners.includes(String(s.bb_fundraiser_id)));
  return hit ? hit.email : ctx.email;
}

export interface MoveIn { cid?: unknown; stage?: unknown; nextStep?: unknown; nextDue?: unknown }

export async function saveCard(ctx: Ctx, b: MoveIn) {
  if (!mayMoves(ctx.scope)) throw new HttpError(403, 'not_yours', 'Moves is for directors and the Support Team.');
  const cid = String(b.cid || '');
  if (!ID.test(cid)) throw new HttpError(400, 'bad_id', 'That is not a partner number.');
  if (ctx.testCid && cid !== ctx.testCid) throw new HttpError(403, 'test_only', 'A role test may change only the test record.');
  guardTester(ctx, cid);
  const env = ctx.env;
  const hit = await rowFor(ctx, cid);
  if (!hit) throw new HttpError(403, 'not_yours', 'That partner is not on your board.');
  const { row, l } = hit;
  const today = l.today;
  const now = nowIso();
  const old = await env.DB.prepare('SELECT key, cid, stage_id, next_step, next_due, reminder_id, entered_at FROM mv_card WHERE key = ?').bind(row.key).first<CardRow & { reminder_id: string | null }>();
  let stage = old ? old.stage_id : row.stage === POOL ? '' : row.stage;
  if (b.stage !== undefined) {
    const s = String(b.stage);
    const def = l.stages.find((x) => x.id === s && x.active === 1);
    if (!def) throw new HttpError(400, 'bad_stage', 'Pick a stage from the list.');
    stage = s;
  }
  if (!stage) throw new HttpError(400, 'bad_stage', 'Pick a stage first.');
  let step = old ? old.next_step || '' : '';
  let due = old ? old.next_due || null : null;
  if (b.nextStep !== undefined) step = clip(b.nextStep, 200);
  if (b.nextDue !== undefined) due = b.nextDue === null || b.nextDue === '' ? null : String(b.nextDue);
  if (due !== null) {
    if (!DAY.test(due) || Number.isNaN(Date.parse(due + 'T12:00:00Z'))) throw new HttpError(400, 'bad_date', 'Pick a date.');
    if (due < today && due !== (old && old.next_due)) throw new HttpError(400, 'past_date', 'Pick today or a later day.');
    if (due > new Date(Date.parse(today + 'T12:00:00Z') + 5 * 365 * 86400000).toISOString().slice(0, 10)) throw new HttpError(400, 'far_date', 'Pick a date within five years.');
    if (!step) throw new HttpError(400, 'missing_step', 'Write the next step for that date.');
  }
  if (!step) due = null;
  const stepChanged = step !== (old ? old.next_step || '' : '') || due !== (old ? old.next_due || null : null);
  let reminder = old ? old.reminder_id : null;
  if (stepChanged) {
    if (reminder) {
      const prev = await env.DB.prepare('SELECT owner FROM act_reminders WHERE id = ?').bind(reminder).first<{ owner: string }>().catch(() => null);
      if (prev) await finishReminder(env, prev.owner, reminder).catch(() => false);
      reminder = null;
    }
    if (step && due) {
      const ids = await addReminders(env, await ownerEmail(ctx, row), [{ kind: 'partner', ref_id: null, cid, title: step, note: `Moves: ${row.name}`, due_at: dueFor({ date: due }).toString(), source: 'manual' }]);
      reminder = ids[0];
    }
  }
  const moved = !old || old.stage_id !== stage;
  const audit = (kind: string, from: string | null, to: string | null, detail: string) =>
    env.DB.prepare('INSERT INTO mv_audit (id, at, actor, actor_email, key, kind, from_stage, to_stage, detail) VALUES (?,?,?,?,?,?,?,?,?)').bind(newId('mva'), now, ctx.actor, ctx.email, row.key, kind, from, to, detail);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mv_card (key, cid, stage_id, next_step, next_due, reminder_id, entered_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET stage_id = excluded.stage_id, next_step = excluded.next_step, next_due = excluded.next_due, reminder_id = excluded.reminder_id,
         entered_at = CASE WHEN mv_card.stage_id = excluded.stage_id THEN mv_card.entered_at ELSE excluded.entered_at END, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(row.key, cid, stage, step || null, due, reminder, now, now, ctx.actor),
    ...(moved ? [audit('move', old ? old.stage_id : row.stage, stage, row.name)] : []),
    ...(stepChanged ? [audit('next_step', stage, stage, step ? `${step}${due ? ' by ' + due : ''}` : 'cleared')] : []),
  ]);
  return { key: row.key, cid, stage, nextStep: step, nextDue: due, moved, reminder: !!reminder, previousStage: old ? old.stage_id : null };
}

export interface StageIn { id?: string; label: string; role?: string }

/** Admins set the stages: the order, the names, and which one takes partners with an open ask. A stage left out is archived, and only when no partner sits in it. */
export async function saveStages(ctx: Ctx, input: StageIn[]) {
  if (!isAdmin(ctx)) throw new HttpError(403, 'admin_only', 'Only an admin can change the stages.');
  if (ctx.testCid) throw new HttpError(403, 'test_only', 'A role test cannot change the stages.');
  const list = (Array.isArray(input) ? input : []).map((s) => ({ id: s.id ? String(s.id) : '', label: clip(s.label, 30), role: s.role === 'ask' ? 'ask' : '' }));
  if (list.length < 2 || list.length > 10) throw new HttpError(400, 'bad_stages', 'Keep between 2 and 10 stages.');
  if (list.some((s) => !s.label)) throw new HttpError(400, 'bad_stages', 'Every stage needs a name.');
  const lower = list.map((s) => s.label.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new HttpError(400, 'bad_stages', 'Two stages have the same name.');
  const env = ctx.env;
  const have = await loadStages(env);
  const keep = new Set(list.filter((s) => s.id).map((s) => s.id));
  for (const s of list) if (s.id && !have.some((h) => h.id === s.id)) throw new HttpError(400, 'bad_stages', 'A stage in the list does not exist.');
  const drop = have.filter((h) => h.active === 1 && !keep.has(h.id));
  for (const d of drop) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM mv_card WHERE stage_id = ?').bind(d.id).first<{ n: number }>();
    if (n && n.n > 0) throw new HttpError(400, 'stage_in_use', `${n.n} partners sit in ${d.label}. Move them first.`);
  }
  const asker = Math.max(0, list.findIndex((s) => s.role === 'ask'));
  const now = nowIso();
  const taken = new Set(have.map((h) => h.id));
  const slug = (label: string) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'stage';
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return id;
  };
  const stmts = list.map((s, i) => {
    const id = s.id || slug(s.label);
    return env.DB.prepare(
      `INSERT INTO mv_stage (id, label, sort, role, active, updated_at, updated_by) VALUES (?,?,?,?,1,?,?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort = excluded.sort, role = excluded.role, active = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(id, s.label, (i + 1) * 10, i === asker ? 'ask' : '', now, ctx.actor);
  });
  for (const d of drop) stmts.push(env.DB.prepare('UPDATE mv_stage SET active = 0, role = \'\', updated_at = ?, updated_by = ? WHERE id = ?').bind(now, ctx.actor, d.id));
  stmts.push(env.DB.prepare('INSERT INTO mv_audit (id, at, actor, actor_email, key, kind, detail) VALUES (?,?,?,?,?,?,?)').bind(newId('mva'), now, ctx.actor, ctx.email, null, 'stage_edit', list.map((s) => s.label).join(', ')));
  await env.DB.batch(stmts);
  return { stages: await loadStages(env) };
}
