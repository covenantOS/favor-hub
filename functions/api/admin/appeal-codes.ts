import { HttpError } from '../../_lib/http';
import { adminRoute, readBody } from '../../_lib/admin/route';
import { appealsOverview, build, createAppeals, existing, onlineTwin } from '../../_lib/admin/appealcodes';
import { addRequest, closeRequest, listRequests } from '../../_lib/admin/coderequests';

// Appeal codes. GET lists the newest appeals from the D1 copy of Blackbaud, the categories and the open fund and campaign requests.
// POST { op: 'preview', draft } builds the code and says whether it exists; { op: 'create', draft, online } creates the appeal (and its -WS twin)
// in Blackbaud; { op: 'request', kind, code, description } and { op: 'close', id, state } keep the fund and campaign list.
export const onRequestGet = adminRoute(async ({ env }) => ({ ...(await appealsOverview(env)), requests: await listRequests(env) }));

export const onRequestPost = adminRoute(async ({ env, request, user }) => {
  const b = await readBody(request);
  const op = String(b.op || '');
  if (op === 'preview') {
    const built = build(b.draft || {});
    const list = [built, ...(b.online ? [onlineTwin(built)] : [])];
    const have = await existing(env, list.map((x) => x.code)).catch(() => []);
    return { built: list, exists: have };
  }
  if (op === 'create') return (await createAppeals(env, user.email, { draft: b.draft || {}, online: !!b.online })) as any;
  if (op === 'request') return { request: await addRequest(env, user.email, b) } as any;
  if (op === 'close') {
    await closeRequest(env, user.email, String(b.id || ''), b.state === 'dropped' ? 'dropped' : 'done');
    return { requests: await listRequests(env) } as any;
  }
  throw new HttpError(400, 'bad_op', 'Unknown action.');
});
