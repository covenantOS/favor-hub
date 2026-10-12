import { adminRoute, readBody } from '../../_lib/admin/route';
import { adoption, sendAgain } from '../../_lib/hub/tours';

// Admin > Tours. GET lists everyone with where they stand on the core tour and each release. POST { what, emails | team }
// sends the tour or a release again to a person or a team.
export const onRequestGet = adminRoute(async ({ env }) => adoption(env));

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  return sendAgain(env, user.email, String(b.what || ''), { emails: b.emails, team: b.team });
});
