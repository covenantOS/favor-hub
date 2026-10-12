import { saveList } from '../../../_lib/lists/service.ts';
import { body, work } from '../../../_lib/work/route';

// Save a list. scope is private, team or all.
export const onRequestPost = work(async ({ request, env, wu }) => {
  const b = await body(request);
  return { saved: await saveList(env, { email: wu.email, name: wu.actor }, b) };
});
