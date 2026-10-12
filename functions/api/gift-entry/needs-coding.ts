import { gift } from '../../_lib/gifts/route';
import { parseJson } from '../../_lib/gifts/store';
import { isTester, notTesterSql } from '../../_lib/testuser';

// Gifts coded White Mail because no slip or letter came with the check, with what is known and the suggestions with their reasons.
export const onRequestGet = gift(async ({ env, user }) => {
  const t = isTester(user.email);
  const rows = (
    await env.DB.prepare(
      `SELECT g.id, g.seq, g.partner_name, g.payer, g.amount_cents, g.gift_date, g.coding_json, g.appeal_name, d.id AS dep, d.name AS dep_name, d.status AS dep_status
         FROM ge_gift g JOIN ge_deposit d ON d.id = g.deposit_id
        WHERE g.needs_coding = 1 AND g.status <> 'removed' AND d.status <> 'removed' ${t ? '' : `AND ${notTesterSql('d.created_by_email')}`}
        ORDER BY g.created_at DESC LIMIT 200`
    ).all<any>()
  ).results;
  return {
    items: rows.map((r) => {
      const c = parseJson<any>(r.coding_json, { reason: '', suggestions: [] });
      return { id: r.id, seq: r.seq, partner: r.partner_name || r.payer, amountCents: r.amount_cents, giftDate: r.gift_date, appeal: r.appeal_name, reason: c.reason, suggestions: c.suggestions || [], deposit: { id: r.dep, name: r.dep_name, status: r.dep_status }, posted: ['created', 'committed'].includes(r.dep_status) };
    }),
  };
});
