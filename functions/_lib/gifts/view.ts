// What the page gets for one deposit: the deposit, every row with its readers' answers, candidates and blockers, the tape, the
// steps of the send, and the lane. One shape for the review grid, the status view and the tests.
import type { Env } from '../http';
import { canSend, progress } from './flow';
import { commentsForDeposit, reviewState } from './comments';
import { secondCents } from './perm';
import { blockers, getDeposit, giftsOf, imagesOf, needsSecond, parseJson, tapeOf, RULE_LABEL, type Dup } from './store';

export async function depositView(env: Env, id: string) {
  const d = await getDeposit(env, id);
  if (!d || d.status === 'removed') return null;
  const gifts = await giftsOf(env, id);
  const images = await imagesOf(env, id);
  const threads = await commentsForDeposit(env, id);
  const second = await secondCents(env);
  const events = (await env.DB.prepare('SELECT at, kind, actor, detail, gift_id FROM ge_event WHERE deposit_id = ? ORDER BY id DESC LIMIT 40').bind(id).all<any>()).results;
  const rows = gifts.map((g) => {
    const f = parseJson<any>(g.fields_json, {});
    return {
      id: g.id,
      seq: g.seq,
      status: g.status,
      kind: g.kind,
      partner: g.partner_id ? { id: g.partner_id, lookup: g.partner_lookup, name: g.partner_name, place: g.partner_place } : null,
      candidates: parseJson<any[]>(g.candidates_json, []),
      amountCents: g.amount_cents,
      giftDate: g.gift_date,
      checkNumber: g.check_number,
      checkDate: g.check_date,
      payer: g.payer,
      memo: g.memo,
      fund: g.fund_id ? { id: g.fund_id, name: g.fund_name } : null,
      appeal: g.appeal_id ? { id: g.appeal_id, name: g.appeal_name } : null,
      soft: g.soft_partner_id || g.soft_partner_name ? { id: g.soft_partner_id, name: g.soft_partner_name } : null,
      rule: g.rule || '',
      ruleLabel: g.rule ? RULE_LABEL[g.rule] || g.rule : '',
      prayer: !!g.prayer,
      flags: f.flags || [],
      why: f.why || {},
      conf: f.conf || {},
      address: f.address || null,
      coding: { needs: !!g.needs_coding, ...parseJson<any>(g.coding_json, { source: '', reason: '', suggestions: [] }) },
      readers: f.readers || [],
      defaults: f.defaults || {},
      card: !!f.card,
      unreadable: !!f.unreadable,
      dup: parseJson<Dup | null>(g.dup_json, null),
      blockers: blockers(g, second),
      confirmed: !!g.confirmed_by,
      confirmedBy: g.confirmed_by,
      confirmedAt: g.confirmed_at,
      needsSecond: second > 0 && (g.amount_cents || 0) >= second,
      secondDone: !!g.approved2_by,
      secondBy: g.approved2_by,
      secondAt: g.approved2_at,
      held: g.status === 'held' ? { reason: g.hold_reason, by: g.hold_by, at: g.hold_at } : null,
      bbGiftIdKnown: !!g.bb_gift_id,
      bbBatchGiftId: g.bb_batch_gift_id,
      bbGiftId: g.bb_gift_id,
      review: reviewState(threads.get(g.id) || []),
      thread: (threads.get(g.id) || []).map((c) => ({ id: c.id, author: c.author_name, email: c.author_email, kind: c.kind, body: c.body, at: c.created_at })),
      error: g.error,
      images: images.filter((i) => i.gift_id === g.id).map((i) => ({ id: i.id, kind: i.kind, copyToBb: !!i.copy_to_bb, attached: !!i.attached_at, attachError: i.attach_error })),
    };
  });
  const tape = tapeOf(d, gifts, second);
  const check = canSend(d, gifts, second);
  const rejected = (await env.DB.prepare("SELECT id, seq, payer, amount_cents, reject_reason, rejected_by, rejected_at FROM ge_gift WHERE deposit_id = ? AND reject_reason IS NOT NULL ORDER BY rejected_at").bind(id).all<any>()).results;
  const steps = d.status === 'open' ? null : await progress(env, id);
  const attach = images.filter((i) => i.copy_to_bb);
  return {
    deposit: {
      id: d.id, kind: d.kind, name: d.name, date: d.deposit_date, tapeCents: d.tape_cents, tapeCount: d.tape_count, status: d.status,
      createdBy: d.created_by, createdAt: d.created_at, sentBy: d.sent_by, sentAt: d.sent_at, batchId: d.bb_batch_id, batchNumber: d.bb_batch_number,
      committedAt: d.committed_at, lastPolledAt: d.last_polled_at, note: d.note,
      undoneAt: d.undone_at, undoneBy: d.undone_by, undoneReason: d.undone_reason,
    },
    second,
    rejected: rejected.map((r: any) => ({ id: r.id, seq: r.seq, payer: r.payer, amountCents: r.amount_cents, reason: r.reject_reason, by: r.rejected_by, at: r.rejected_at })),
    rows,
    tape,
    canSend: check,
    steps,
    attachments: { planned: attach.length, done: attach.filter((i) => i.attached_at).length, failed: attach.filter((i) => i.attach_error).length },
    events,
  };
}

export async function laneRow(env: Env) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare('SELECT calls, cap, updated_at FROM ge_lane WHERE day = ?').bind(day).first<{ calls: number; cap: number; updated_at: string }>();
  return { day, calls: r ? r.calls : 0, cap: r ? r.cap : 400, warnAt: 300 };
}
