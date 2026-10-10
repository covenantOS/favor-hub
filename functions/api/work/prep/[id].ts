import { HttpError } from '../../../_lib/http';
import { SYSTEM_ID } from '../../../_lib/work/partner';
import { briefFor } from '../../../_lib/work/prep';
import { giftsForPartner } from '../../../_lib/work/gifts-svc';
import { partnerNotes } from '../../../_lib/work/edit';
import { todayEt } from '../../../_lib/work/service';
import { param, work } from '../../../_lib/work/route';

// The call-prep brief for one partner. Records come from the D1 copy of Blackbaud; the partner's notes are one live call kept ten
// minutes (the same copy the partner drawer reads), and a failed read leaves the brief without notes rather than without a brief.
export const onRequestGet = work(async ({ env, ctx, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  const owed = await giftsForPartner(ctx, id).catch(() => []);
  const notes = await partnerNotes(ctx, id).then((n) => n.map((x: any) => ({ date: String(x.date || ''), summary: String(x.summary || ''), text: String(x.text || ''), source: 'Note' }))).catch(() => null);
  const brief = await briefFor(env, id, { today: todayEt(), notes, owed: owed.map((g) => ({ giftId: g.giftId, amount: g.amount, date: g.date, fund: g.fund, ageDays: g.ageDays })) });
  if (!brief) throw new HttpError(404, 'no_partner', 'No partner has that number. The copy of Blackbaud refreshes at 5 AM and 5 PM, so a record added since then is not in it yet.');
  return { brief, owedRows: owed.map((g) => ({ key: g.key, giftId: g.giftId, cid: g.cid, amount: g.amount, date: g.date, fund: g.fund, ownerNames: g.ownerNames })) };
});
