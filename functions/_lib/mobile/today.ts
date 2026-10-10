// "Today" on the phone: the thank-yous owed and the follow-ups due now or overdue for the signed-in person. It reads the Work Center's
// board (the hub's own pending changes laid over the mirror), so a thing marked done on the phone leaves the list at once, and the
// answer matches what the Work Center shows that person.
import { HttpError } from '../http';
import { thankGroups } from '../actions/board';
import { mirrorQ } from '../work/partner';
import { createBatch, currentBoard, runBatch, type Ctx } from '../work/service';
import { contactsFor, dayTime } from './cards';

export interface TodayItem {
  id: string;
  kind: 'thank_you' | 'follow_up';
  partner_id: string;
  partner_name: string;
  phone: string | null;
  email: string | null;
  summary: string;
  due_date: string;
  done: boolean;
}

const MAX_EACH = 60;

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export async function todayFor(ctx: Ctx, fid: string): Promise<TodayItem[]> {
  if (!fid) return [];
  const board = await currentBoard(ctx);
  const mine = (r: { fundraisers: string[]; pending: unknown; deceased: boolean }) => r.fundraisers.includes(fid) && !r.pending && !r.deceased;
  const owed = thankGroups(board.rows.filter((r) => mine(r)), fid)
    .filter((g) => !g.later)
    .sort((a, b) => (a.row.due < b.row.due ? -1 : 1))
    .slice(0, MAX_EACH);
  const follow = board.rows
    .filter((r) => mine(r) && !r.ty && r.due && r.due <= board.today)
    .sort((a, b) => (a.due < b.due ? -1 : 1))
    .slice(0, MAX_EACH);
  const ids = [...new Set([...owed.map((g) => g.row.cid), ...follow.map((r) => r.cid)])];
  const contacts = await contactsFor(mirrorQ(ctx.env), ids).catch(() => new Map());
  const out: TodayItem[] = [];
  for (const g of owed) {
    const r = g.row;
    const c = contacts.get(r.cid);
    out.push({
      id: g.key,
      kind: 'thank_you',
      partner_id: r.cid,
      partner_name: r.partner,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      summary: r.gift ? `Thank-you for the ${money(r.gift.amount)} gift on ${r.gift.date}` : r.summary || 'Thank-you',
      due_date: dayTime(r.due) || dayTime(board.today)!,
      done: false,
    });
  }
  for (const r of follow) {
    const c = contacts.get(r.cid);
    out.push({
      id: r.id,
      kind: 'follow_up',
      partner_id: r.cid,
      partner_name: r.partner,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      summary: r.summary || r.type || 'Follow up',
      due_date: dayTime(r.due) || dayTime(board.today)!,
      done: false,
    });
  }
  return out;
}

/**
 * Mark one thing on the list done. It goes through the Work Center's batch path (saved first, then sent, under the daily cap and the
 * check that Blackbaud has not changed the action since the mirror read it). A thank-you closes every task about the same gift.
 */
export async function markDone(ctx: Ctx, fid: string, id: string, req: string, waitUntil: (p: Promise<unknown>) => void) {
  if (!fid) throw new HttpError(403, 'no_fundraiser', 'Your account is not set up to close actions yet.');
  if (!/^\d{1,12}$/.test(id)) throw new HttpError(404, 'not_found', 'That item is not on your list.');
  const board = await currentBoard(ctx);
  const row = board.rows.find((r) => r.id === id);
  // An action that is no longer open, or already has a change waiting, is done as far as the phone cares (409: treat as sent).
  if (!row || row.pending) throw new HttpError(409, 'already_done', 'That one is already done.');
  if (!row.fundraisers.includes(fid)) throw new HttpError(404, 'not_found', 'That item is not on your list.');
  const ids = row.ty && row.group && row.group.length ? row.group : [id];
  const out = await createBatch(ctx, { op: 'complete', ids, how: 'logged', req });
  if (out.batch.id && out.batch.run_when === 'now') waitUntil(runBatch(ctx, out.batch.id).catch(() => undefined));
  return { batch_id: out.batch.id, n: out.batch.n, run_when: out.batch.run_when };
}
