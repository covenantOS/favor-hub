// A gift on screen: when a gift lands for one of this person's partners, Today shows it with the thank-you it needs and the partner's
// history. The list is the Work Center's own "Gifts to thank" for this person (gifts-svc giftsResponse, mine only), cut to gifts
// Blackbaud had in the last three days. Each card says where the personal thank-you stands (owed on the 24-hour clock, an open
// thank-you task, done) and, for a gift of $5,000 or more, where the handwritten HQTY letter stands. Receipts are the printed
// receipts Support sends everyone; they are a different thing and never appear here.
import type { Env } from '../http';
import { requireWork } from '../work/gate';
import { blackbaudRepo } from '../work/repo';
import type { Ctx } from '../work/service';
import { giftsResponse, mayGifts } from '../work/gifts-svc';

export const NEW_HOURS = 72;
export const HQTY_MIN = 5000;

export interface GiftCard {
  giftId: string;
  cid: string;
  name: string;
  amount: number;
  date: string;
  fund: string;
  type: string;
  hours: number;
  badges: string[];
  /** The personal thank-you: owed (with the clock), open task, left a message, or done. */
  thank: { state: 'owed' | 'task' | 'left' | 'done'; due: string; late: boolean; by: string; on: string; how: string };
  /** The handwritten HQTY letter, for gifts of $5,000 or more: not started, printed, signed, mailed or cannot. */
  letter: { state: string; on: string } | null;
  history: { lifetime: number; count: number; lastContact: string; since: string };
  phone: string | null;
  team: 'dir' | 'pc';
  owners: string[];
  taskIds: string[];
}

/** Today's new gifts for this person, newest first. Empty for a person whose job has no gifts to thank. */
export async function newGifts(env: Env, request: Request): Promise<{ gifts: GiftCard[]; owed: number }> {
  const wu = await requireWork(env, request);
  const ctx: Ctx = { env, repo: blackbaudRepo(env), actor: wu.actor, email: wu.email, scope: wu.scope, testCid: wu.testCid };
  if (!mayGifts(ctx.scope)) return { gifts: [], owed: 0 };
  const res = await giftsResponse(ctx, '', { mine: true });
  const fresh = (res.rows || []).filter((r) => Number(r.hours) <= NEW_HOURS).sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0)).slice(0, 8);
  const big = fresh.filter((r) => r.amount >= HQTY_MIN).map((r) => r.giftId);
  const letters = new Map<string, { state: string; on: string }>();
  if (big.length) {
    const rows = (await env.DB.prepare('SELECT gift_id, state, COALESCE(mailed_at, signed_at, printed_at, updated_at) AS on_at FROM act_hqty WHERE gift_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(big)).all<{ gift_id: string; state: string; on_at: string }>().catch(() => ({ results: [] as Array<{ gift_id: string; state: string; on_at: string }> }))).results || [];
    for (const r of rows) letters.set(String(r.gift_id), { state: r.state, on: String(r.on_at || '').slice(0, 10) });
  }
  const gifts: GiftCard[] = fresh.map((r) => {
    const clock = (r.clock || {}) as { due?: string; state?: string; mins?: number };
    const state: GiftCard['thank']['state'] = r.thanked ? 'done' : r.taskIds && r.taskIds.length ? 'task' : r.left ? 'left' : 'owed';
    return {
      giftId: r.giftId,
      cid: r.cid,
      name: r.partner.name,
      amount: r.amount,
      date: r.date,
      fund: r.fund,
      type: r.type,
      hours: r.hours,
      badges: r.badges || [],
      thank: { state, due: String(clock.due || ''), late: Number(clock.mins) < 0, by: r.thanked ? r.thanked.by : r.left ? r.left.by : '', on: r.thanked ? r.thanked.date : r.left ? r.left.date : '', how: r.thanked ? r.thanked.how : r.left ? r.left.how : '' },
      letter: r.amount >= HQTY_MIN ? letters.get(r.giftId) || { state: 'none', on: '' } : null,
      history: { lifetime: r.partner.lifetime, count: r.partner.count, lastContact: r.partner.lastContact, since: '' },
      phone: r.partner.doNotCall ? null : r.partner.phone,
      team: r.team,
      owners: r.owners,
      taskIds: r.taskIds || [],
    };
  });
  return { gifts, owed: Number(res.stats?.owed) || 0 };
}
