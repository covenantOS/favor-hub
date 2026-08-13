import { isAdmin } from '../../_lib/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return json({ ok: true, admin: await isAdmin(env, request) });
};
