import { isAdmin } from '../_lib/auth';
import { checkRateAndCreate } from '../_lib/create';
import { attachmentsFor, listRequests, publicShape } from '../_lib/db';
import { handleError, json, type Env } from '../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const admin = await isAdmin(env, request);
    const rows = await listRequests(env, admin);
    const atts = await attachmentsFor(env, rows.map((r) => r.id));
    return json({
      ok: true,
      admin,
      requests: rows.map((r) => publicShape(r, atts.get(r.id) || [], [], admin)),
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return checkRateAndCreate(ctx);
};
