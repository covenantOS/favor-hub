import { gift, jsonBody } from '../../_lib/gifts/route';
import { createDeposit, listDeposits } from '../../_lib/gifts/store';
import { laneRow } from '../../_lib/gifts/view';
import { HttpError } from '../../_lib/http';
import { etParts } from '../../_lib/actions/intake';
import { STAGE } from '../../_lib/gifts/stage';
import { needsFixByDeposit } from '../../_lib/gifts/comments';
import { secondCents } from '../../_lib/gifts/perm';
import { isTester } from '../../_lib/testuser';

export const onRequestGet = gift(async ({ env, user, canPost }) => {
  const [deposits, needsFix] = await Promise.all([listDeposits(env, 30, isTester(user.email)), needsFixByDeposit(env)]);
  return {
    deposits: deposits.map((d) => ({ ...d, needsFix: needsFix[d.id] || 0 })),
    lane: await laneRow(env), me: { name: user.name, email: user.email, admin: user.role === 'admin', canPost }, stage: STAGE, today: etParts(new Date()).date,
    second: await secondCents(env),
  };
});

// Step 1: set up the deposit with the tape total and count.
export const onRequestPost = gift(async ({ request, env, user, actor }) => {
  const b = await jsonBody(request);
  const kind = ['regular', 'acquisition', 'grant'].includes(b.kind) ? b.kind : null;
  if (!kind) throw new HttpError(400, 'bad_kind', 'Pick Regular, Acquisition or Grant mail.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';
  if (!date) throw new HttpError(400, 'bad_date', 'Enter the deposit date.');
  const today = etParts(new Date()).date;
  if (date > today) throw new HttpError(400, 'future_date', 'The deposit date cannot be in the future.');
  const tapeCents = Math.round(Number(b.tapeTotal) * 100);
  const tapeCount = Math.round(Number(b.tapeCount));
  if (!Number.isFinite(tapeCents) || tapeCents <= 0 || tapeCents > 5_000_000_000) throw new HttpError(400, 'bad_total', 'Enter the tape total in dollars.');
  if (!Number.isFinite(tapeCount) || tapeCount < 1 || tapeCount > 200) throw new HttpError(400, 'bad_count', 'Enter how many items are on the tape (1 to 200).');
  const dup = await env.DB.prepare("SELECT id FROM ge_deposit WHERE kind = ? AND deposit_date = ? AND status <> 'removed' LIMIT 1").bind(kind, date).first<{ id: string }>();
  const row = await createDeposit(env, { name: actor, email: user.email }, { kind, date, tapeCents, tapeCount });
  return { deposit: row, sameDayExists: dup ? dup.id : null };
});
