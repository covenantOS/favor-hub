import { isFoundationsUser } from '../../_lib/foundations/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return json({ ok: true, unlocked: await isFoundationsUser(env, request) });
};
