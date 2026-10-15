import { HttpError, errorJson, handleError, json, type Env } from '../../_lib/http';
import { body, sameSite } from '../../_lib/work/route';
import { assign, decidePair, done, listFlags, listPairs, pairDetail, queue, requireCare, rescan, setMeta, summary } from '../../_lib/datacare/service';

// Data care. GET with no path is the overview; the rest are named by the path.
//   GET  /                      counts, the reviewer, the Sheet link
//   GET  /flags?state=&q=&offset=&limit=   partners who gave this year and have no mailing address
//   GET  /pairs?tab=review|not_same|done   possible duplicate pairs
//   GET  /pair?id=              one pair side by side
//   POST /scan                  rebuild both lists from the Blackbaud copy (admin or the agent key; the morning job)
//   POST /assign                send the review to the reviewer: task, tag, one email. {to} other than the reviewer is a test send
//   POST /pair/decide           {id, action: merge | not_same | undo, keep, picks}
//   POST /meta                  {sheet}: save the Google Sheet link (admin)
//   GET  /queue, POST /done     the desktop runner's merge queue (agent key only)
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const who = await requireCare(env, request);
    const a = String((params.a as string[] | undefined)?.[0] || '');
    const url = new URL(request.url);
    if (a === 'queue') {
      if (!who.agent) throw new HttpError(403, 'agent_only', 'Only the runner reads this queue.');
      return json({ ok: true, queue: await queue(env) });
    }
    if (a === 'flags') {
      const out = await listFlags(env, { state: url.searchParams.get('state') || 'open', offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 25), search: (url.searchParams.get('q') || '').slice(0, 60) });
      return json({ ok: true, ...out });
    }
    if (a === 'pairs') return json({ ok: true, pairs: await listPairs(env, url.searchParams.get('tab') || 'review') });
    if (a === 'pair') return json({ ok: true, ...(await pairDetail(env, url.searchParams.get('id') || '')) });
    return json({ ok: true, summary: await summary(env), me: { email: who.email, admin: who.admin } });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    if (!sameSite(request)) return errorJson('cross_site', 'That change did not come from the Data care page. Reload the page and try again.', 403);
    const who = await requireCare(env, request);
    const a = (params.a as string[] | undefined) || [];
    const b = await body(request);
    if (a[0] === 'done') {
      if (!who.agent) throw new HttpError(403, 'agent_only', 'Only the runner reports here.');
      await done(env, String(b.id || ''), b.ok === true, String(b.result || ''));
      return json({ ok: true });
    }
    if (a[0] === 'scan') {
      if (!who.admin && !who.agent) throw new HttpError(403, 'admin_only', 'Only an admin can refresh the lists.');
      return json({ ok: true, scan: await rescan(env) });
    }
    if (a[0] === 'assign') return json({ ok: true, ...(await assign(env, who, { to: b.to ? String(b.to) : undefined, again: b.again === true })) });
    if (a[0] === 'pair' && a[1] === 'decide') return json({ ok: true, pair: await decidePair(env, who, String(b.id || ''), b) });
    if (a[0] === 'meta') {
      if (!who.admin && !who.agent) throw new HttpError(403, 'admin_only', 'Only an admin can change this.');
      for (const k of ['sheet', 'reviewer']) if (typeof b[k] === 'string') await setMeta(env, k, String(b[k]).trim().slice(0, 300));
      return json({ ok: true });
    }
    throw new HttpError(404, 'not_found', 'There is nothing at that address.');
  } catch (err) {
    return handleError(err);
  }
};
