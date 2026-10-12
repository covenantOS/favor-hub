import { gift, jsonBody, pid } from '../../../../_lib/gifts/route';
import { getDeposit, getGift, logEvent, parseJson, updateGift } from '../../../../_lib/gifts/store';
import { loadCatalog } from '../../../../_lib/gifts/match';
import { HttpError, nowIso } from '../../../../_lib/http';

// A person settles the appeal for a gift on the needs-coding list. While the deposit is open the row simply takes it. After the batch was
// made, the decision is recorded here and the change in Blackbaud follows Favor's rule for appeal changes on saved gifts (the browser
// runner, never the API).
export const onRequestPost = gift(async ({ request, env, params, actor, q }) => {
  const id = pid(params);
  const g = await getGift(env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That gift is not here.');
  const b = await jsonBody(request);
  const appealId = /^\d{1,12}$/.test(String(b.appeal_id || '')) ? String(b.appeal_id) : '';
  if (!appealId) throw new HttpError(400, 'bad_appeal', 'Pick the appeal.');
  const cat = await loadCatalog(q);
  const a = cat.appeals.find((x) => x.id === appealId);
  if (!a) throw new HttpError(404, 'no_appeal', 'That appeal is not in the list.');
  const why = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!why) throw new HttpError(400, 'reason_needed', 'Say how you know the appeal.');
  const dep = await getDeposit(env, g.deposit_id);
  const f = parseJson<any>(g.fields_json, {});
  f.defaults = { ...(f.defaults || {}), appealSource: 'person' };
  const set: Record<string, string | number | null> = { needs_coding: 0, coded_by: actor, coded_at: nowIso(), fields_json: JSON.stringify(f), coding_json: JSON.stringify({ source: 'person', reason: why, suggestions: [] }) };
  const open = !!dep && dep.status === 'open';
  if (open) Object.assign(set, { appeal_id: a.id, appeal_name: a.name, confirmed_by: null, confirmed_at: null, approved2_by: null, approved2_at: null });
  await updateGift(env, id, set);
  await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: open ? 'coding_set' : 'coding_decided', actor, detail: { appeal: a.code, was: g.appeal_name, reason: why } });
  return { coded: true, appeal: { id: a.id, code: a.code, name: a.name }, change: open ? 'row' : 'blackbaud_pending' };
});
