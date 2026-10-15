// The shapes the page reads: one batch with its gifts, what stops each gift, and whether this person may approve.
import type { Env } from '../http';
import { approveBlock, blockers, entererEmails, letterState, parseJson, type Dup, type OgBatch, type OgGift } from './rules';
import { giftsOf } from './store';

export interface GiftView {
  id: string;
  seq: number;
  status: OgGift['status'];
  kind: OgGift['kind'];
  partnerId: string;
  partnerLookup: string;
  partnerName: string;
  partnerPlace: string;
  fundNamed: string;
  softPartnerId: string;
  softPartnerName: string;
  noSoft: boolean;
  amountCents: number;
  giftDate: string;
  fundId: string;
  fundName: string;
  appealId: string;
  appealName: string;
  refText: string;
  memo: string;
  dup: Dup | null;
  letter: ReturnType<typeof letterState>;
  letterName: string;
  letterError: string;
  blockers: string[];
  error: string;
  retryAt: string;
  bbGiftId: string;
  enteredBy: string;
  mine: boolean;
}

export const giftView = (g: OgGift, me: string): GiftView => ({
  id: g.id,
  seq: g.seq,
  status: g.status,
  kind: g.kind,
  partnerId: g.partner_id || '',
  partnerLookup: g.partner_lookup || '',
  partnerName: g.partner_name || '',
  partnerPlace: g.partner_place || '',
  fundNamed: g.fund_named || '',
  softPartnerId: g.soft_partner_id || '',
  softPartnerName: g.soft_partner_name || '',
  noSoft: !!g.no_soft,
  amountCents: g.amount_cents || 0,
  giftDate: g.gift_date || '',
  fundId: g.fund_id || '',
  fundName: g.fund_name || '',
  appealId: g.appeal_id || '',
  appealName: g.appeal_name || '',
  refText: g.ref_text || '',
  memo: g.memo || '',
  dup: parseJson<Dup | null>(g.dup_json, null),
  letter: letterState(g),
  letterName: g.letter_name || '',
  letterError: g.letter_error || '',
  blockers: blockers(g),
  error: g.status === 'failed' || g.status === 'check' ? g.error || '' : '',
  retryAt: g.next_try_at || '',
  bbGiftId: g.bb_gift_id || '',
  enteredBy: g.created_by,
  mine: g.created_by_email.toLowerCase() === me.toLowerCase(),
});

export async function batchView(env: Env, b: OgBatch, me: { email: string; admin: boolean; canApprove: boolean }) {
  const gifts = await giftsOf(env, b.id);
  const live = gifts.filter((g) => g.status !== 'removed');
  const enterers = entererEmails(b, live);
  const iEntered = enterers.has(me.email.toLowerCase());
  const block = approveBlock(b, gifts, { email: me.email, admin: me.admin, canPost: me.canApprove });
  const events = (
    await env.DB.prepare('SELECT at, kind, actor, gift_id AS giftId FROM og_event WHERE batch_id = ? ORDER BY id DESC LIMIT 25').bind(b.id).all<{ at: string; kind: string; actor: string; giftId: string | null }>()
  ).results;
  return {
    batch: {
      id: b.id,
      name: b.name,
      status: b.status,
      createdBy: b.created_by,
      createdAt: b.created_at,
      submittedAt: b.submitted_at || '',
      submittedBy: b.submitted_by || '',
      approvedBy: b.approved_by || '',
      approvedAt: b.approved_at || '',
      postedAt: b.posted_at || '',
      gifts: live.length,
      cents: live.reduce((s, g) => s + (g.amount_cents || 0), 0),
      posted: live.filter((g) => g.status === 'posted').length,
      mine: b.created_by_email.toLowerCase() === me.email.toLowerCase(),
      iEntered,
    },
    gifts: live.map((g) => giftView(g, me.email)),
    approve: { allowed: b.status === 'waiting' && !block, why: block },
    events,
  };
}
