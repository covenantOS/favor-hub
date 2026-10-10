import { gift, jsonBody, pid } from '../../../_lib/gifts/route';
import { recompute } from '../../../_lib/gifts/capture';
import { blockers, cleanEdit, getDeposit, getGift, logEvent, parseJson, updateGift, type Dup } from '../../../_lib/gifts/store';
import { HttpError, nowIso } from '../../../_lib/http';
import { depositView } from '../../../_lib/gifts/view';
import { settleDeposit } from '../../../_lib/gifts/flow';

const CONFIRM_LINE = 'Look it over and press Looks right.';

// Step 5: a person's changes to one row, and the human glance. Editing any field takes the glance back, so a changed row is looked at again.
export const onRequestPatch = gift(async ({ request, env, params, actor, deps }) => {
  const id = pid(params);
  let g = await getGift(env, id);
  if (!g || g.status === 'removed') throw new HttpError(404, 'not_found', 'That row is not here.');
  const dep = await getDeposit(env, g.deposit_id);
  if (!dep || dep.status !== 'open') {
    if (!(dep && ['needs_person'].includes(dep.status))) throw new HttpError(409, 'locked', 'This deposit was sent. Rows can no longer change here.');
  }
  const b = await jsonBody(request);
  const action = typeof b.action === 'string' ? b.action : '';
  const edit = b.set && typeof b.set === 'object' ? cleanEdit(b.set as Record<string, unknown>) : {};
  if (dep!.status !== 'open' && Object.keys(edit).length) throw new HttpError(409, 'locked', 'This deposit was sent. Fix the gift in Blackbaud or mark it entered by hand.');

  if (Object.keys(edit).length) {
    // Choosing a different partner drops a duplicate decision and the proposed candidates, and a new fund or amount re-checks the rule.
    await updateGift(env, id, { ...edit, confirmed_by: null, confirmed_at: null });
    await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'row_edited', actor, detail: Object.keys(edit) });
    g = await recompute(env, deps, id);
  }

  if (action === 'confirm') {
    const left = blockers(g).filter((x) => x !== CONFIRM_LINE);
    if (left.length) throw new HttpError(409, 'not_ready', left[0]);
    await updateGift(env, id, { confirmed_by: actor, confirmed_at: nowIso() });
    await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'row_confirmed', actor });
  } else if (action === 'unconfirm') {
    await updateGift(env, id, { confirmed_by: null, confirmed_at: null });
  } else if (action === 'dup_keep' || action === 'dup_remove') {
    const dup = parseJson<Dup | null>(g.dup_json, null);
    if (!dup) throw new HttpError(409, 'no_dup', 'There is no duplicate to decide.');
    if (action === 'dup_remove') {
      await updateGift(env, id, { status: 'removed' });
      await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'row_removed_duplicate', actor, detail: dup.message });
    } else {
      await updateGift(env, id, { dup_json: JSON.stringify({ ...dup, decision: 'keep' }), confirmed_by: null, confirmed_at: null });
      await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'duplicate_kept', actor, detail: dup.message });
    }
  } else if (action === 'by_hand') {
    // Counts on the tape, goes to Blackbaud by hand: a partner nobody found, or a gift Blackbaud stored with an error.
    await updateGift(env, id, { status: 'by_hand', confirmed_by: actor, confirmed_at: nowIso(), error: null });
    await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'entered_by_hand', actor });
    await settleDeposit(env, g.deposit_id);
  } else if (action === 'back_to_review') {
    await updateGift(env, id, { status: 'review', confirmed_by: null, confirmed_at: null });
  } else if (action) {
    throw new HttpError(400, 'bad_action', 'That is not something this row does.');
  }
  return { view: await depositView(env, g.deposit_id) };
});

export const onRequestDelete = gift(async ({ env, params, actor }) => {
  const id = pid(params);
  const g = await getGift(env, id);
  if (!g) throw new HttpError(404, 'not_found', 'That row is not here.');
  const dep = await getDeposit(env, g.deposit_id);
  if (!dep || dep.status !== 'open') throw new HttpError(409, 'locked', 'This deposit was sent. Rows can no longer be removed here.');
  await updateGift(env, id, { status: 'removed' });
  await logEvent(env, { deposit_id: g.deposit_id, gift_id: id, kind: 'row_removed', actor });
  return { view: await depositView(env, g.deposit_id) };
});
