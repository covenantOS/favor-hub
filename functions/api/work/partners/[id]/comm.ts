import { HttpError } from '../../../../_lib/http';
import { work, param } from '../../../../_lib/work/route';
import { mirrorQ, SYSTEM_ID } from '../../../../_lib/work/partner';
import { loadComm } from '../../../../_lib/work/comm';
import { todayEt } from '../../../../_lib/work/service';

// Every contact with one partner in the last 12 months, and the thank-you count for the year. Reads the D1 mirror and the hub's own tables.
export const onRequestGet = work(async ({ env, params }) => {
  const id = param(params, 'id');
  if (!SYSTEM_ID.test(id)) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  return { comm: await loadComm(env, mirrorQ(env), id, todayEt()) };
});
