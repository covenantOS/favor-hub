import { actorOf, requireFoundationsUser } from '../../../_lib/foundations/auth';
import { postContact, unpostContact } from '../../../_lib/foundations/blackbaud';
import { getContact, logEvent, publicContact } from '../../../_lib/foundations/db';
import { HttpError, errorJson, handleError, json, type Env } from '../../../_lib/http';

/** Try again on a contact that has not reached Blackbaud. */
export const onRequestPost: PagesFunction<Env, 'cid'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const c = await getContact(env, String(params.cid));
    if (!c) return errorJson('not_found', 'That contact is gone.', 404);
    if (c.source !== 'app') throw new HttpError(400, 'imported', 'This contact came from Blackbaud. There is nothing to send.');
    if (c.bb_state === 'failed') {
      await env.DB.prepare("UPDATE fnd_contacts SET bb_state = 'pending' WHERE id = ?").bind(c.id).run();
    }
    const saved = await postContact(env, c.id, actorOf(request));
    return json({ ok: true, contact: saved ? publicContact(saved) : null });
  } catch (err) {
    return handleError(err);
  }
};

/** Remove a contact that was logged on this page, here and in Blackbaud. Contacts that came from Blackbaud stay. */
export const onRequestDelete: PagesFunction<Env, 'cid'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const c = await getContact(env, String(params.cid));
    if (!c) return errorJson('not_found', 'That contact is gone.', 404);
    if (c.source !== 'app') throw new HttpError(400, 'imported', 'This contact was already in Blackbaud. Remove it there if it is wrong.');
    const actor = actorOf(request);
    const gone = await unpostContact(env, c, actor);
    if (!gone.ok) throw new HttpError(502, 'blackbaud', gone.message || 'Blackbaud would not remove it.');
    await env.DB.prepare('DELETE FROM fnd_contacts WHERE id = ?').bind(c.id).run();
    await logEvent(env, { foundation_id: c.foundation_id, contact_id: c.id, kind: 'contact_removed', actor, detail: c.summary });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
};
