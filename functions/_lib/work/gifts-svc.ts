// Gifts to thank: what the routes do. The list reads the mirror (gifts.ts), lays the hub's own thank-yous over it, and cuts it to the
// person's portfolio. A thank-you is saved as an ordinary batch (an open thank-you task is completed in place, a gift with no task
// gets a new completed contact with the Thanked tag), so Recent, Undo and the write guard all apply. No extra Blackbaud calls are made
// to read the list: 0 SKY calls. A thank-you costs 2 calls (one create, one tag), plus 1 for a follow-up task.
import { HttpError, newId, nowIso } from '../http';
import { mirrorQ } from './partner';
import { getSetting } from './db';
import { currentBoard, createBatch, authorizeBatch, saveBatch, todayEt, type Ctx, type PlannedItem } from './service';
import { planEdit, typesByFundraiser } from './edit';
import { loadGifts, DEFAULT_DAYS, weekStart, type GiftRow, type Shaped } from './gifts';
import { THANK_HOWS, addDays, clean } from '../actions/completion';
import type { Scope } from './role';

const ID = /^\d{1,12}$/;
const money = (n: number): string => '$' + (Math.round(n) === n ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (iso: string): string => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** The fundraisers whose gifts this person may see. Admins see every director. */
export function visibleOwners(s: Scope | undefined): Set<string> | null {
  if (!s || s.all) return null;
  return s.fids;
}

export const mayGifts = (s: Scope | undefined): boolean => !s || s.role === 'admin' || s.role === 'support' || s.role === 'director' || s.role === 'partner_care';

export interface GiftsOut {
  ok: true;
  today: string;
  synced: string;
  days: number;
  owner: string;
  /** Every gift in the person's portfolio, before the director picker narrows it. */
  everyone: number;
  owners: { id: string; name: string; n: number }[];
  rows: (GiftRow & { ownerNames: string[] })[];
  stats: { owed: number; over24: number; first: number; big: number; week: number };
  shelf: Shaped['today'];
  weekStart: string;
  lastWorkday: string;
}

async function daysSetting(ctx: Ctx): Promise<number> {
  const v = Number(await getSetting(ctx.env, 'thank_days', String(DEFAULT_DAYS)).catch(() => ''));
  return Number.isFinite(v) && v >= 3 && v <= 120 ? Math.floor(v) : DEFAULT_DAYS;
}

/** Eastern date of the workday before today (Friday on a Monday). */
export function lastWorkday(today: string): string {
  let d = addDays(today, -1);
  for (let i = 0; i < 3; i++) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d = addDays(d, -1);
  }
  return d;
}

export async function giftsResponse(ctx: Ctx, ownerIn: string): Promise<GiftsOut> {
  if (!mayGifts(ctx.scope)) throw new HttpError(403, 'not_yours', 'Gifts to thank is for directors, Partner Care and the Support Team.');
  const today = todayEt();
  const days = await daysSetting(ctx);
  const [shaped, board, names] = await Promise.all([loadGifts(ctx.env, mirrorQ(ctx.env), { today, days }), currentBoard({ ...ctx, scope: undefined }).catch(() => null), ownerNames(ctx)]);
  const vis = visibleOwners(ctx.scope);
  const taskBy = new Map<string, string[]>();
  if (board) for (const r of board.rows) if (r.ty && r.gift) (taskBy.get(r.gift.id) || taskBy.set(r.gift.id, []).get(r.gift.id)!).push(r.id);
  const rowsAll = shaped.rows
    .map((r) => ({ ...r, owners: vis ? r.owners.filter((o) => vis.has(o)) : r.owners }))
    .filter((r) => r.owners.length);
  const count = new Map<string, number>();
  for (const r of rowsAll) for (const o of r.owners) count.set(o, (count.get(o) || 0) + 1);
  const owner = ownerIn && count.has(ownerIn) ? ownerIn : ctx.scope && ctx.scope.role === 'director' && ctx.scope.fid ? ctx.scope.fid : '';
  const rows = rowsAll.filter((r) => !owner || r.owners.includes(owner));
  for (const r of rows) {
    const tasks = taskBy.get(r.giftId) || [];
    r.taskIds = board ? tasks.filter((id) => board.rows.some((b) => b.id === id && (b.cid === r.cid || (r.soft && b.cid === r.soft.giverId)))) : [];
  }
  const week = owner ? shaped.thankedWeek[owner] || 0 : [...(vis ? vis : Object.keys(shaped.thankedWeek))].reduce((n, o) => n + (shaped.thankedWeek[o] || 0), 0);
  return {
    ok: true,
    today,
    synced: await ctx.repo.synced().catch(() => ''),
    days,
    owner,
    everyone: rowsAll.length,
    owners: [...count.entries()].map(([id, n]) => ({ id, name: names[id] || `Fundraiser ${id}`, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    rows: rows.map((r) => ({ ...r, ownerNames: r.owners.map((o) => names[o] || `Fundraiser ${o}`) })),
    stats: {
      owed: rows.length,
      over24: rows.filter((r) => r.hours >= 24).length,
      first: rows.filter((r) => r.badges.includes('First gift') || r.badges.includes('First monthly gift')).length,
      big: rows.filter((r) => r.amount >= 1000).length,
      week,
    },
    shelf: shaped.today.filter((s) => (!vis || s.owners.some((o) => vis.has(o))) && (!owner || s.owners.includes(owner))),
    weekStart: weekStart(today),
    lastWorkday: lastWorkday(today),
  };
}

async function testRow(ctx: Ctx, giftId: string, cid: string, fid: string): Promise<GiftRow | null> {
  const g = (await mirrorQ(ctx.env)<any>(`SELECT id, gift_amount AS amount, substr(gift_date, 1, 10) AS d, gift_splits AS splits FROM gifts WHERE id = ?1 AND constituent_record_id = ?2`, [giftId, cid]).catch(() => []))[0];
  if (!g) return null;
  const owner = fid || ctx.scope?.fid || '27611';
  return {
    key: `${giftId}:${cid}`, giftId, cid, amount: Number(g.amount) || 0, date: String(g.d), added: '', ageDays: 0, hours: 0, type: 'Donation', pay: '', fund: 'Test gift', comment: '', soft: null,
    partner: { name: 'Test partner', kind: '', place: '', lifetime: 0, count: 0, lastContact: '', phone: null, doNotCall: false, deceased: false },
    badges: [], team: ctx.scope?.role === 'partner_care' ? 'pc' : 'dir', owners: [owner], taskIds: [], thanked: null, left: null,
  };
}

async function ownerNames(ctx: Ctx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const rows = await mirrorQ(ctx.env)<{ id: string; first: string; last: string }>('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers').catch(() => []);
  for (const f of rows) out[String(f.id)] = `${f.first || ''} ${f.last || ''}`.trim();
  return out;
}

/** The gifts owed on one partner, for the partner drawer's gold card and the call brief. Empty when the viewer's role does not take thank-yous. */
export async function giftsForPartner(ctx: Ctx, cid: string): Promise<(GiftRow & { ownerNames: string[] })[]> {
  if (!ID.test(cid) || !mayGifts(ctx.scope)) return [];
  const today = todayEt();
  const shaped = await loadGifts(ctx.env, mirrorQ(ctx.env), { today, days: await daysSetting(ctx), cid });
  const vis = visibleOwners(ctx.scope);
  const names = await ownerNames(ctx);
  return shaped.rows
    .filter((r) => r.cid === cid)
    .map((r) => ({ ...r, owners: vis ? r.owners.filter((o) => vis.has(o)) : r.owners }))
    .filter((r) => r.owners.length)
    .map((r) => ({ ...r, ownerNames: r.owners.map((o) => names[o] || `Fundraiser ${o}`) }));
}

/* ------------------------------------------------------------------ saying thank you */

export interface ThankInput {
  items?: { giftId?: string; cid?: string }[];
  how?: string;
  outcome?: string;
  line?: string;
  followUp?: boolean;
  owner?: string;
  req?: string;
}

const NEEDS_DIRECTION = new Set(['Phone call', 'Email', 'Mailing']);

/**
 * Save the thank-yous. A gift with an open thank-you task is thanked through that task (completed in place, or the task closes and one
 * contact is added), the way the Thank-yous tab does. Every other gift gets one new completed contact with the Thanked tag. Left a message
 * logs the attempt with no Thanked tag and keeps the gift on the list with a reminder for tomorrow.
 */
export async function thankGifts(ctx: Ctx, input: ThankInput) {
  const how = String(input.how || '');
  const spec = THANK_HOWS[how];
  if (!spec) throw new HttpError(400, 'bad_how', 'Pick how the thank-you went out.');
  const left = input.outcome === 'left';
  if (left && how !== 'call' && how !== 'text') throw new HttpError(400, 'bad_outcome', 'Left a message applies to a call or a text.');
  const items = (Array.isArray(input.items) ? input.items : []).filter((i) => i && ID.test(String(i.giftId)) && ID.test(String(i.cid)));
  if (!items.length) throw new HttpError(400, 'nothing_to_do', 'Pick a gift to thank.');
  if (items.length > 100) throw new HttpError(400, 'too_many', 'Thank 100 gifts or fewer at a time.');
  const today = todayEt();
  const req = String(input.req || '').slice(0, 60) || newId('wcr');
  const line = clean(input.line, 200);
  const days = await daysSetting(ctx);
  const [shaped, board, types] = await Promise.all([
    loadGifts(ctx.env, mirrorQ(ctx.env), { today, days }),
    currentBoard({ ...ctx, scope: undefined }).catch(() => null),
    typesByFundraiser(ctx.env),
  ]);
  const vis = visibleOwners(ctx.scope);
  const byKey = new Map(shaped.rows.map((r) => [r.key, r]));
  const taskBy = new Map<string, { id: string; cid: string }[]>();
  if (board) for (const r of board.rows) if (r.ty && r.gift) (taskBy.get(r.gift.id) || taskBy.set(r.gift.id, []).get(r.gift.id)!).push({ id: r.id, cid: r.cid });

  const picked: { row: GiftRow; owner: string; tasks: string[] }[] = [];
  const skipped: { giftId: string; why: string }[] = [];
  for (const it of items) {
    // A test run as another role may thank a gift on its one test record even though no director holds that record: the gift is read
    // from the mirror by its id, so the write path (create, tag, close, undo) is exercised on real Blackbaud with the real rules.
    const row = byKey.get(`${it.giftId}:${it.cid}`) || (ctx.testCid && String(it.cid) === ctx.testCid ? await testRow(ctx, String(it.giftId), String(it.cid), ctx.scope?.fid || '') : undefined);
    if (!row) {
      skipped.push({ giftId: String(it.giftId), why: 'That gift is not owed any more.' });
      continue;
    }
    const mine = vis ? row.owners.filter((o) => vis.has(o)) : row.owners;
    if (row.team === 'pc' && (how === 'text' || how === 'visit')) throw new HttpError(400, 'bad_how', 'Partner Care thanks by call, card, letter or email.');
    if (!mine.length) throw new HttpError(403, 'not_yours', 'That partner is outside your portfolio. You can thank gifts on partners you hold.');
    const owner = input.owner && mine.includes(String(input.owner)) ? String(input.owner) : ctx.scope && ctx.scope.fid && mine.includes(ctx.scope.fid) ? ctx.scope.fid : mine[0];
    const tasks = (taskBy.get(row.giftId) || []).filter((t) => t.cid === row.cid || (row.soft && t.cid === row.soft.giverId)).map((t) => t.id);
    picked.push({ row, owner, tasks });
  }
  if (!picked.length) return { ok: true, batches: [], skipped, left: false, n: 0 };

  // The write rules first: the same ones a person adding a contact or closing a task meets anywhere else in the Work Center.
  await authorizeBatch(ctx, { op: 'new', cids: [...new Set(picked.map((p) => p.row.cid))], set: { fundraisers: [...new Set(picked.map((p) => p.owner))] } });

  const batches: { id: string; kind: 'new' | 'thank'; n: number; run_when: string; gifts: string[] }[] = [];
  const thanksRows: { p: (typeof picked)[number]; batch: string; taskIds: string[] }[] = [];
  const viaTask = left ? [] : picked.filter((p) => p.tasks.length);
  const viaNew = picked.filter((p) => !viaTask.includes(p));

  if (viaTask.length) {
    const ids = [...new Set(viaTask.flatMap((p) => p.tasks))];
    const out = await createBatch(ctx, { op: 'thank', ids, how, line, outcome: how === 'call' || how === 'visit' ? 'Successful' : '', req: req + ':t' } as any);
    if (out.batch && out.batch.id) {
      batches.push({ id: out.batch.id, kind: 'thank', n: out.batch.n, run_when: out.batch.run_when, gifts: viaTask.map((p) => p.row.giftId) });
      if (!out.batch.repeat) for (const p of viaTask) thanksRows.push({ p, batch: out.batch.id, taskIds: p.tasks });
    }
  }

  if (viaNew.length) {
    const synced = await ctx.repo.synced().catch(() => '');
    const planned: PlannedItem[] = [];
    let reads = 0;
    for (const p of viaNew) {
      const r = p.row;
      const label = left ? 'Left a message to thank for' : `Thank you ${spec.label.toLowerCase()} for`;
      const ref = `Gift ${r.giftId}: ${money(r.amount)} on ${shortDay(r.date)}${r.fund && r.fund !== 'No fund on file' ? ', ' + r.fund : ''}${r.soft ? ' (soft credit, given through ' + r.soft.giver + ')' : ''}`;
      const set: Record<string, unknown> = {
        category: spec.category,
        type: types[p.owner] || (r.team === 'pc' ? 'PC Action' : 'RDD Action'),
        date: today,
        summary: `${label} the ${money(r.amount)} gift`,
        description: [line, ref].filter(Boolean).join('\n'),
        fundraisers: [p.owner],
        completed: true,
        status: 'Completed',
        outcome: left ? 'Unsuccessful' : how === 'call' || how === 'visit' ? 'Successful' : undefined,
      };
      if (set.outcome === undefined) delete set.outcome;
      if (NEEDS_DIRECTION.has(spec.category)) set.direction = 'Outbound';
      const tags = left ? [] : ['Thanked'].concat(spec.tag ? [spec.tag] : []);
      const edit: Record<string, unknown> = { op: 'new', cids: [r.cid], set, tags: tags.length ? { add: tags.map((c) => ({ category: c })) } : undefined };
      if (input.followUp) edit.next = { category: 'Task/Other', type: set.type, date: addDays(today, 14), summary: `Follow up after thanking for the ${money(r.amount)} gift`, fundraisers: [p.owner] };
      const plan = await planEdit(ctx, edit as any, { today, synced });
      planned.push(...plan.items);
      reads += plan.reads;
    }
    const batch = await saveBatch(ctx, 'new', planned, { op: 'new', n: planned.length, summary: 'Thank you', next: !!input.followUp, gifts: viaNew.length, thank: left ? 'left' : how }, { reqId: req + ':n', reads, keySalt: req });
    if (batch.id) {
      batches.push({ id: batch.id, kind: 'new', n: batch.n, run_when: batch.run_when, gifts: viaNew.map((p) => p.row.giftId) });
      if (!batch.repeat) for (const p of viaNew) thanksRows.push({ p, batch: batch.id, taskIds: [] });
    }
  }

  const now = nowIso();
  const outcome = left ? 'left' : how === 'call' || how === 'text' || how === 'visit' ? 'talked' : 'sent';
  const remind = left ? addDays(today, 1) : null;
  const fu = input.followUp ? addDays(today, 14) : null;
  for (const t of thanksRows) {
    await ctx.env.DB.prepare(
      `INSERT INTO act_thanks (id, gift_id, cid, owner_fid, how, outcome, batch_id, task_ids, line, remind_on, follow_up, actor, actor_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(newId('wct'), t.p.row.giftId, t.p.row.cid, t.p.owner, how, outcome, t.batch, JSON.stringify(t.taskIds), line, remind, fu, ctx.actor, ctx.email, now).run().catch(() => undefined);
  }
  return { ok: true, batches, skipped, left, n: thanksRows.length, how, outcome };
}
