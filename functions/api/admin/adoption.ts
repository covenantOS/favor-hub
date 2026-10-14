import { adminRoute } from '../../_lib/admin/route';
import { overview, personLog } from '../../_lib/admin/adoption';

// Admin > Adoption. GET gives the summary, the people, the ones who never signed in and the feedback feed.
// GET ?person=email@favorintl.org gives that person's day-by-day log.
export const onRequestGet = adminRoute(async ({ env, url, user }) => {
  const person = (url.searchParams.get('person') || '').trim();
  if (person) return personLog(env, person);
  return overview(env, user.email);
});
