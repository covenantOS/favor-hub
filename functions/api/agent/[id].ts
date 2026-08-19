import { requireAgent } from '../../_lib/auth';
import { addEvent, attachmentsFor, eventsFor, getRequest, publicShape, setPageUrl, setStatus } from '../../_lib/db';
import { HttpError, asTrimmed, handleError, json, type Env } from '../../_lib/http';
import { firstHttpUrl, notifyRequestDone } from '../../_lib/notify';

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params, waitUntil }) => {
  try {
    const denied = requireAgent(env, request);
    if (denied) return denied;
    const id = String(params.id || '');
    const body = (await request.json()) as { action?: unknown; note?: unknown; page_url?: unknown };
    const action = asTrimmed(body.action, 'action', 40);
    const note = asTrimmed(body.note, 'note', 4000, false);
    const row = await getRequest(env, id);
    if (!row) throw new HttpError(404, 'not_found', 'Request not found');

    if (action === 'claim') {
      if (row.status !== 'approved') {
        throw new HttpError(409, 'not_claimable', 'Only approved cards can be claimed.');
      }
      const next = await setStatus(env, id, 'in_progress', 'agent', {});
      if (note) await addEvent(env, id, 'note', 'agent', { note });
      const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
      return json({ ok: true, request: publicShape(next, atts.get(id) || [], events, true) });
    }
    if (action === 'complete') {
      const pageUrl =
        asTrimmed(body.page_url, 'page_url', 400, false) || firstHttpUrl(note) || row.page_url || '';
      if (pageUrl && pageUrl !== row.page_url) {
        await setPageUrl(env, id, pageUrl);
      }
      const wasDone = row.status === 'done';
      const next = await setStatus(env, id, 'done', 'agent', {});
      if (note) await addEvent(env, id, 'note', 'agent', { note });
      if (!wasDone) {
        waitUntil(
          notifyRequestDone(env, { ...next, page_url: pageUrl || next.page_url }, { pageUrl, note }).catch((err) =>
            console.error('[requests] done notify', err)
          )
        );
      }
      const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
      return json({ ok: true, request: publicShape(next, atts.get(id) || [], events, true) });
    }
    if (action === 'note') {
      if (!note) throw new HttpError(400, 'missing_note', 'note is required');
      await addEvent(env, id, 'note', 'agent', { note });
      const [atts, events] = await Promise.all([attachmentsFor(env, [id]), eventsFor(env, id)]);
      return json({ ok: true, request: publicShape(row, atts.get(id) || [], events, true) });
    }
    throw new HttpError(400, 'bad_action', 'action must be claim, complete, or note');
  } catch (err) {
    return handleError(err);
  }
};
