// Partner Care cadence: what the routes do. The list reads the mirror (cadence.ts) and keeps the result in act_cache until the
// Blackbaud copy refreshes or the day turns. The hub's own steps lay over it at read time, so a step clears its row at once. A step is
// saved as an ordinary batch (a completed contact on the partner, a text with the Texted tag), so Recent, Undo and the write guard
// apply. Reading costs no Blackbaud calls. A call, card or email step costs 1 call, a text costs 2.
import { HttpError, newId, nowIso } from '../http';
import { mirrorQ } from './partner';
import { addReminders, dueFor } from './remind';
import { authorizeBatch, saveBatch, todayEt, type Ctx, type PlannedItem } from './service';
import { planEdit, typesByFundraiser } from './edit';
import { THANK_HOWS, addDays, clean } from '../actions/completion';
import { weekStart } from './gifts';
import { loadCadence, splitLists, STEP_LABEL, RULE_LABEL, STEP_ORDER, type CadenceRow, type StepKey } from './cadence';

const ID = /^\d{1,12}$/;
const CACHE_KEY = 'cadence:rows';
const MAX_CACHE = 900_000;

export const mayCadence = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'partner_care';

async function holderNames(ctx: Ctx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const rows = await mirrorQ(ctx.env)<{ id: string; first: string; last: string }>('SELECT id AS id, fundraiser_first_name AS first, fundraiser_last_name AS last FROM fundraisers').catch(() => []);
  for (const f of rows) out[String(f.id)] = `${f.first || ''} ${f.last || ''}`.trim();
  return out;
}

interface Cached { synced: string; today: string; at: string; rows: CadenceRow[] }

/** The computed rows: from act_cache when the Blackbaud copy and the day are the same, otherwise built from the mirror. */
export async function cadenceRows(ctx: Ctx, today: string): Promise<{ rows: CadenceRow[]; at: string; synced: string }> {
  const synced = await ctx.repo.synced().catch(() => '');
  const hit = await ctx.env.DB.prepare('SELECT value FROM act_cache WHERE key = ?').bind(CACHE_KEY).first<{ value: string }>().catch(() => null);
  if (hit) {
    try {
      const c = JSON.parse(hit.value) as Cached;
      if (c.today === today && c.synced === synced) return { rows: c.rows, at: c.at, synced };
    } catch {
      /* rebuild below */
    }
  }
  const names = await holderNames(ctx);
  const rows = await loadCadence(ctx.env, mirrorQ(ctx.env), { today, names });
  const at = nowIso();
  const value = JSON.stringify({ synced, today, at, rows } satisfies Cached);
  if (value.length < MAX_CACHE) await ctx.env.DB.prepare('INSERT INTO act_cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(CACHE_KEY, value, at).run().catch(() => undefined);
  return { rows, at, synced };
}

interface DoneRow { cid: string; step: string; outcome: string; done_at: string; owner_fid: string; actor: string }

/** The hub's own steps since a time, undone batches left out. */
async function doneSince(ctx: Ctx, since: string): Promise<DoneRow[]> {
  const r = await ctx.env.DB.prepare(
    `SELECT d.cid, d.step, d.outcome, d.done_at, d.owner_fid, d.actor FROM act_cadence_done d LEFT JOIN act_batches b ON b.id = d.batch_id
      WHERE d.done_at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done')) ORDER BY d.done_at`
  ).bind(since).all<DoneRow>().catch(() => ({ results: [] as DoneRow[] }));
  return r.results;
}

/** Take away the steps the hub has saved since the rows were built. A row with no step left, or one finished by any step, goes. */
export function overlay(rows: CadenceRow[], done: DoneRow[]): CadenceRow[] {
  const by = new Map<string, Set<string>>();
  for (const d of done) if (d.outcome === 'done') (by.get(String(d.cid)) || by.set(String(d.cid), new Set()).get(String(d.cid))!).add(d.step);
  const out: CadenceRow[] = [];
  for (const r of rows) {
    const got = by.get(r.cid);
    if (!got) { out.push(r); continue; }
    if (r.need === 'any' && r.steps.some((s) => got.has(s.k))) continue;
    const left = r.steps.filter((s) => !got.has(s.k));
    if (!left.length) continue;
    const next = left.find((s) => !s.off && s.state === 'next') || left.find((s) => !s.off) || left[0];
    out.push({ ...r, steps: left.map((s) => ({ ...s, state: s === next ? 'next' : 'todo' })) });
  }
  return out;
}

export interface CadenceOut {
  ok: true;
  today: string;
  synced: string;
  owner: string;
  me: string | null;
  owners: { id: string; name: string; n: number }[];
  everyone: number;
  /** Partners who are due but have no phone, email or mailing address for any step they need. They are left off the list. */
  unreachable: number;
  rows: CadenceRow[];
  stats: { due: number; first: number; repeat: number; quarterly: number; week: number };
  lists: { friday: CadenceRow[]; saturday: CadenceRow[]; sunday: CadenceRow[] };
  weekStart: string;
}

export async function cadenceResponse(ctx: Ctx, ownerIn: string): Promise<CadenceOut> {
  if (!mayCadence(ctx.scope)) throw new HttpError(403, 'not_yours', 'Cadence is for Partner Care.');
  const today = todayEt();
  const built = await cadenceRows(ctx, today);
  const wk = weekStart(today);
  const done = await doneSince(ctx, built.at < wk ? built.at : wk);
  const all = overlay(built.rows, done.filter((d) => d.done_at >= built.at));
  const live = all.filter((r) => !r.blocked);
  const count = new Map<string, number>();
  for (const r of live) for (const h of r.holders) count.set(h, (count.get(h) || 0) + 1);
  // Mine by default for a Partner Care person; 'all' is the whole team. An owner Partner Care does not hold shows everyone.
  const owner = ownerIn === 'all' ? '' : ownerIn && count.has(ownerIn) ? ownerIn : ctx.scope && ctx.scope.role === 'partner_care' && ctx.scope.fid && count.has(ctx.scope.fid) ? ctx.scope.fid : '';
  const rows = live.filter((r) => !owner || r.holders.includes(owner));
  const names = new Map<string, string>();
  for (const r of live) r.holders.forEach((h, i) => names.set(h, r.holderNames[i]));
  const due = rows.filter((r) => r.over >= 0);
  const week = done.filter((d) => d.outcome === 'done' && d.done_at >= wk && (!owner || d.owner_fid === owner)).length;
  return {
    ok: true, today, synced: built.synced, owner, me: ctx.scope && ctx.scope.fid ? ctx.scope.fid : null,
    owners: [...count.entries()].map(([id, n]) => ({ id, name: names.get(id) || `Fundraiser ${id}`, n })).sort((a, b) => a.name.localeCompare(b.name)),
    everyone: live.length,
    unreachable: all.length - live.length,
    rows,
    stats: {
      due: due.length,
      first: due.filter((r) => r.rule === 'first').length,
      repeat: due.filter((r) => r.rule === 'monthly' || r.rule === 'semi' || r.rule === 'annual').length,
      quarterly: due.filter((r) => r.rule === 'quarterly').length,
      week,
    },
    lists: splitLists(due),
    weekStart: wk,
  };
}

/* ------------------------------------------------------------------ pressing a step */

export interface StepInput { cid?: string; step?: string; outcome?: string; line?: string; req?: string }

/**
 * Save one step. A call, card or email becomes one completed contact on the partner, a text one completed call with the Texted tag.
 * Left a message logs the call as unsuccessful, keeps the row, and sets a reminder for the next workday. The row's rule names the
 * step it allows, so a step the rule does not call for, or one switched off for a do-not flag, is refused.
 */
export async function stepCadence(ctx: Ctx, input: StepInput) {
  if (!mayCadence(ctx.scope)) throw new HttpError(403, 'not_yours', 'Cadence is for Partner Care.');
  const cid = String(input.cid || '');
  const step = String(input.step || '') as StepKey;
  if (!ID.test(cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner.');
  if (!STEP_ORDER.includes(step)) throw new HttpError(400, 'bad_how', 'Pick a step.');
  const left = input.outcome === 'left';
  if (left && step !== 'call') throw new HttpError(400, 'bad_outcome', 'Left a message applies to a call.');
  const today = todayEt();
  const req = String(input.req || '').slice(0, 60) || newId('wcr');
  const line = clean(input.line, 200);
  const built = await cadenceRows(ctx, today);
  const done = await doneSince(ctx, built.at);
  const row = overlay(built.rows, done.filter((d) => d.done_at >= built.at)).find((r) => r.cid === cid);
  const isTest = !!ctx.testCid && cid === ctx.testCid;
  // A role test may press a step on its one test record even though no rule lists it: the write path is the same.
  const rule = row ? row.rule : isTest ? 'monthly' : null;
  if (!rule) throw new HttpError(409, 'not_due', 'That partner is not due for a step any more.');
  if (row && !isTest) {
    const s = row.steps.find((x) => x.k === step);
    if (!s) throw new HttpError(400, 'bad_how', `${STEP_LABEL[step]} is not a step for this partner.`);
    if (s.off) throw new HttpError(400, 'step_off', s.off + '.');
  }
  const holders = row ? row.holders : [ctx.scope?.fid || '27611'];
  // A role test acts as the one test record's holder, so the batch, the rules and Undo are the real ones.
  const owner = ctx.scope && ctx.scope.fid && (holders.includes(ctx.scope.fid) || isTest) ? ctx.scope.fid : holders[0];
  if (!owner) throw new HttpError(400, 'no_holder', 'No Partner Care holder is on this partner.');
  const spec = THANK_HOWS[step];
  const types = await typesByFundraiser(ctx.env);
  await authorizeBatch(ctx, { op: 'new', cids: [cid], set: { fundraisers: [owner] } });
  const synced = await ctx.repo.synced().catch(() => '');
  const word = RULE_LABEL[rule].toLowerCase();
  const verb = left ? 'Left a message' : ({ call: 'Called', text: 'Texted', email: 'Emailed', card: 'Sent a card' } as Record<StepKey, string>)[step];
  const set: Record<string, unknown> = {
    category: spec.category,
    type: types[owner] || 'PC Action',
    date: today,
    summary: `${verb} (${RULE_LABEL[rule]})`,
    description: [line, `Cadence step: ${STEP_LABEL[step].toLowerCase()}, ${word}`].filter(Boolean).join('\n'),
    fundraisers: [owner],
    completed: true,
    status: 'Completed',
  };
  if (step === 'call') set.outcome = left ? 'Unsuccessful' : 'Successful';
  set.direction = 'Outbound';
  const tags = step === 'text' ? [spec.tag as string] : [];
  const plan = await planEdit(ctx, { op: 'new', cids: [cid], set, tags: tags.length ? { add: tags.map((c) => ({ category: c })) } : undefined } as any, { today, synced });
  const planned: PlannedItem[] = [...plan.items];
  const batch = await saveBatch(ctx, 'new', planned, { op: 'new', n: planned.length, summary: 'Cadence step', cadence: step }, { reqId: req, reads: plan.reads, keySalt: req });
  if (!batch.id) return { ok: true, batch: null, left, step, repeat: true };
  if (!batch.repeat) {
    await ctx.env.DB.prepare(
      `INSERT INTO act_cadence_done (id, cid, step, outcome, owner_fid, rule, line, batch_id, remind_on, actor, actor_email, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(newId('wcd'), cid, step, left ? 'left' : 'done', owner, rule, line, batch.id, left ? addDays(today, 1) : null, ctx.actor, ctx.email, nowIso()).run();
    if (left) {
      await addReminders(ctx.env, ctx.email, [
        { kind: 'cadence', ref_id: batch.id, cid, title: `Call ${row ? row.name : 'the partner'} again`, note: line || null, due_at: dueFor({ code: 'tomorrow' }), source: 'message' },
      ]).catch(() => undefined);
    }
  }
  return { ok: true, batch: { id: batch.id, n: batch.n, run_when: batch.run_when }, left, step, rule };
}
