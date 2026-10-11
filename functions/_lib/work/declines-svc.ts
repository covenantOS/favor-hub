// Declines: what the routes do. The list reads the mirror (declines.ts) and lays the hub's own follow-up rows over it. A follow-up is
// saved as an ordinary batch (one completed action of type Information Update on the partner), so Recent, Undo and the write guard
// apply. The type is chosen on purpose: Information Update counts as no portfolio contact, so a billing call never changes who is
// credited for a partner. Reading costs no Blackbaud calls. A call, card, email or note costs 1 call, a text costs 2.
import { HttpError, newId, nowIso } from '../http';
import { mirrorQ } from './partner';
import { addReminders, dueFor } from './remind';
import { saveBatch, todayEt, authorizeBatch, type Ctx } from './service';
import { planEdit } from './edit';
import { THANK_HOWS, addDays, clean } from '../actions/completion';
import { weekStart } from './gifts';
import { DECLINE_DAYS, HOWS, KIND_LABEL, KIND_ORDER, STATUSES, STATUS_LABEL, loadDeclines, methodWord, type DeclineRow, type FollowUp, type How, type Status } from './declines';

const ID = /^\d{1,12}$/;
export const FOLLOW_TYPE = 'RESERVED (Information Update)';
export const mayDeclines = (s: Ctx['scope']): boolean => !s || s.role === 'admin' || s.role === 'support' || s.role === 'partner_care';

/** The hub's follow-up rows since a date, undone batches left out. Newest first. */
export async function followSince(ctx: Ctx, since: string): Promise<FollowUp[]> {
  const r = await ctx.env.DB.prepare(
    `SELECT d.gift_id, d.how, d.outcome, d.status, d.line, d.actor, d.at FROM act_declines d LEFT JOIN act_batches b ON b.id = d.batch_id
      WHERE d.at >= ? AND (b.state IS NULL OR b.state IN ('queued', 'running', 'done')) ORDER BY d.at DESC`
  ).bind(since).all<FollowUp>().catch(() => ({ results: [] as FollowUp[] }));
  return r.results;
}

export interface DeclinesOut {
  ok: true;
  today: string;
  synced: string;
  rows: DeclineRow[];
  stats: { open: number; hard: number; soft: number; other: number; closedWeek: number; paid: number };
  window: number;
  weekStart: string;
}

export async function declinesResponse(ctx: Ctx): Promise<DeclinesOut> {
  if (!mayDeclines(ctx.scope)) throw new HttpError(403, 'not_yours', 'Declines is for the admin desk and Partner Care.');
  const today = todayEt();
  const synced = await ctx.repo.synced().catch(() => '');
  const since = addDays(today, -DECLINE_DAYS);
  const follow = await followSince(ctx, since);
  const rows = await loadDeclines(mirrorQ(ctx.env), { today, follow });
  const wk = weekStart(today);
  const open = rows.filter((r) => r.state === 'open');
  const closedWeek = new Set(follow.filter((f) => f.status !== 'open' && f.at.slice(0, 10) >= wk).map((f) => f.gift_id)).size;
  return {
    ok: true, today, synced, rows, window: DECLINE_DAYS, weekStart: wk,
    stats: {
      open: open.length, hard: open.filter((r) => r.kind === 'hard').length, soft: open.filter((r) => r.kind === 'soft').length,
      other: open.filter((r) => r.kind === 'full' || r.kind === 'zeroed').length, closedWeek, paid: rows.filter((r) => r.state === 'paid').length,
    },
  };
}

export interface FollowInput { giftId?: string; cid?: string; how?: string; outcome?: string; status?: string; line?: string; req?: string }

/**
 * Save one follow-up. The decline must be on the list (a role test may use its one test record without one). A call, card or email
 * becomes one completed Information Update on the partner, a text one completed call with the Texted tag, a note a completed task.
 * Left a message logs the call as unsuccessful, keeps the row open and sets a reminder for the next workday. The status is how the
 * follow-up stands: still open, fixed, ended, cannot reach or nothing to do.
 */
export async function logFollowUp(ctx: Ctx, input: FollowInput) {
  if (!mayDeclines(ctx.scope)) throw new HttpError(403, 'not_yours', 'Declines is for the admin desk and Partner Care.');
  const giftId = String(input.giftId || '');
  if (!ID.test(giftId)) throw new HttpError(400, 'bad_gift', 'Pick a decline.');
  const how = String(input.how || '') as How;
  if (!HOWS.includes(how)) throw new HttpError(400, 'bad_how', 'Pick call, text, email, card or note.');
  const left = how === 'call' && input.outcome === 'left';
  if (input.outcome && input.outcome !== 'left' && input.outcome !== 'talked') throw new HttpError(400, 'bad_outcome', 'Pick Talked or Left a message.');
  if (input.outcome === 'left' && how !== 'call') throw new HttpError(400, 'bad_outcome', 'Left a message applies to a call.');
  let status = (STATUSES as readonly string[]).includes(String(input.status)) ? (String(input.status) as Status) : 'open';
  if (left) status = 'open';
  const line = clean(input.line, 240);
  if (how === 'note' && !line) throw new HttpError(400, 'need_line', 'Write what happened.');
  const today = todayEt();
  const req = String(input.req || '').slice(0, 60) || newId('wcr');
  const follow = await followSince(ctx, addDays(today, -DECLINE_DAYS));
  const rows = await loadDeclines(mirrorQ(ctx.env), { today, follow });
  const row = rows.find((r) => r.giftId === giftId) || null;
  const isTest = !!ctx.testCid && String(input.cid || '') === ctx.testCid;
  if (!row && !isTest) throw new HttpError(409, 'not_listed', 'That decline is not on the list any more. Reload the page.');
  const cid = row ? row.cid : String(input.cid);
  if (!ID.test(cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner.');
  if (row && how === 'call' && !row.phone && !isTest) throw new HttpError(400, 'no_phone', 'No phone number on file for this partner. Log a note, email or card instead.');
  if (row && how === 'email' && !row.email && !isTest) throw new HttpError(400, 'no_email', 'No email address on file for this partner.');
  if (row && how === 'text' && !row.phone && !isTest) throw new HttpError(400, 'no_phone', 'No phone number on file for this partner.');
  if (row && how === 'card' && !row.hasAddress && !isTest) throw new HttpError(400, 'no_address', 'No mailing address on file for this partner.');
  const owner = ctx.scope && ctx.scope.fid ? ctx.scope.fid : '';
  await authorizeBatch(ctx, { op: 'new', cids: [cid], set: owner ? { fundraisers: [owner] } : {} });
  const synced = await ctx.repo.synced().catch(() => '');
  const spec = how === 'note' ? { category: 'Task/Other' } : THANK_HOWS[how];
  const subject = row ? `${methodWord(row.method) === 'Bank' ? 'bank' : 'card'} payment` : 'payment';
  const verb = left ? 'Left a message about' : ({ call: 'Called about', text: 'Texted about', email: 'Emailed about', card: 'Sent a card about', note: 'Noted' } as Record<How, string>)[how];
  const kindWord = row ? KIND_LABEL[row.kind].toLowerCase() : 'declined payment';
  const set: Record<string, unknown> = {
    category: spec.category,
    type: FOLLOW_TYPE,
    date: today,
    summary: how === 'note' ? `Declined ${subject}: ${STATUS_LABEL[status].toLowerCase()}` : `${verb} a declined ${subject}`,
    description: [line, row ? `${row.kindLabel}, ${row.date}${row.reason ? ': ' + row.reason : ''}` : `Declined payment follow-up (${kindWord})`, `Gift ${giftId}. Follow-up status: ${STATUS_LABEL[status]}.`].filter(Boolean).join('\n'),
    completed: true,
    status: 'Completed',
  };
  if (owner) set.fundraisers = [owner];
  if (how !== 'note') set.direction = 'Outbound';
  if (how === 'call') set.outcome = left ? 'Unsuccessful' : 'Successful';
  const tags = how === 'text' ? [(THANK_HOWS.text.tag as string)] : [];
  const plan = await planEdit(ctx, { op: 'new', cids: [cid], set, tags: tags.length ? { add: tags.map((c) => ({ category: c })) } : undefined } as any, { today, synced });
  const batch = await saveBatch(ctx, 'new', plan.items, { op: 'new', n: plan.items.length, summary: 'Declined payment follow-up', decline: giftId }, { reqId: req, reads: plan.reads, keySalt: req + giftId });
  if (!batch.id) return { ok: true, batch: null, repeat: true };
  if (!batch.repeat) {
    await ctx.env.DB.prepare(
      'INSERT INTO act_declines (id, gift_id, cid, how, outcome, status, line, remind_on, batch_id, actor, actor_email, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(newId('wcl'), giftId, cid, how, left ? 'left' : how === 'call' ? 'talked' : 'sent', status, line, left ? addDays(today, 1) : null, batch.id, ctx.actor, ctx.email, nowIso()).run();
    if (left) {
      await addReminders(ctx.env, ctx.email, [
        { kind: 'message', ref_id: batch.id, cid, title: `Call ${row ? row.name : 'the partner'} again about the declined payment`, note: line || null, due_at: dueFor({ code: 'tomorrow' }), source: 'message' },
      ]).catch(() => undefined);
    }
  }
  return { ok: true, batch: { id: batch.id, n: batch.n, run_when: batch.run_when }, status, left, how };
}

export { KIND_ORDER };
