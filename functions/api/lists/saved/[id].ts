import { deleteSaved, saveList } from '../../../_lib/lists/service.ts';
import { body, param, work } from '../../../_lib/work/route';

export const onRequestPut = work(async ({ request, env, params, wu }) => {
  const b = await body(request);
  return { saved: await saveList(env, { email: wu.email, name: wu.actor }, b, param(params, 'id')) };
});

export const onRequestDelete = work(async ({ env, params, wu }) => {
  await deleteSaved(env, wu.email, param(params, 'id'));
  return {};
});
