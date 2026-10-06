import { isReceiptsUser } from '../../_lib/receipts/auth';
import { json, type Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return json({ ok: true, unlocked: await isReceiptsUser(env, request) });
};
