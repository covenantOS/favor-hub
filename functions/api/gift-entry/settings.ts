import { gift, jsonBody } from '../../_lib/gifts/route';
import { candidates, listPeople, secondCents, setPerson, setSecondCents } from '../../_lib/gifts/perm';

// Admins: who may open Gift entry, who may send a deposit to Blackbaud, and the amount that needs a second approver. All off at first.
export const onRequestGet = gift(async ({ env }) => ({
  people: await listPeople(env),
  candidates: await candidates(env),
  second: await secondCents(env),
}), { adminOnly: true });

export const onRequestPut = gift(async ({ request, env, actor, user }) => {
  const b = await jsonBody(request);
  if (b.email !== undefined) await setPerson(env, user.email, String(b.email), { access: b.access === undefined ? undefined : !!b.access, posting: b.posting === undefined ? undefined : !!b.posting });
  if (b.secondDollars !== undefined) await setSecondCents(env, actor, Math.round(Number(b.secondDollars) * 100));
  return { people: await listPeople(env), candidates: await candidates(env), second: await secondCents(env) };
}, { adminOnly: true });
