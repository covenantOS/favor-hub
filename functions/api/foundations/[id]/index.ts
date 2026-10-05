import { actorOf, requireFoundationsUser } from '../../../_lib/foundations/auth';
import { CATCH_ALL, orgByLookup } from '../../../_lib/foundations/blackbaud';
import { contactsFor, getFoundation, logEvent, nameKey, publicContact } from '../../../_lib/foundations/db';
import { HttpError, asTrimmed, errorJson, handleError, json, nowIso, type Env } from '../../../_lib/http';

const TEXT_FIELDS: Record<string, number> = { name: 160, location: 120, phone: 40, email: 120, website: 200, ein: 20, assets: 60, notes: 2000 };

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const f = await getFoundation(env, String(params.id));
    if (!f) return errorJson('not_found', 'That foundation is not on the list.', 404);
    const contacts = await contactsFor(env, f.id);
    const log = await env.DB.prepare('SELECT kind, actor, ok, detail, created_at FROM fnd_log WHERE foundation_id = ? ORDER BY created_at DESC LIMIT 12')
      .bind(f.id)
      .all();
    return json({ ok: true, foundation: f, contacts: contacts.map(publicContact), log: log.results, catch_all: CATCH_ALL.lookup });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const f = await getFoundation(env, String(params.id));
    if (!f) return errorJson('not_found', 'That foundation is not on the list.', 404);
    const data = (await request.json()) as Record<string, unknown>;
    const actor = actorOf(request);
    const set: Record<string, unknown> = {};

    for (const [field, max] of Object.entries(TEXT_FIELDS)) {
      if (field in data) set[field] = asTrimmed(data[field], field, max, field === 'name');
    }
    if (typeof set.name === 'string') set.name_key = nameKey(set.name);

    if (data.status === 'dead') {
      set.status = 'dead';
      set.dead_reason = asTrimmed(data.dead_reason, 'reason', 300);
      await logEvent(env, { foundation_id: f.id, kind: 'dead_end', actor, detail: String(set.dead_reason) });
    } else if (data.status === 'open') {
      set.status = 'open';
      set.dead_reason = '';
      await logEvent(env, { foundation_id: f.id, kind: 'reopened', actor });
    }

    // Tie the prospect to the record it already has in Blackbaud, or untie a wrong match.
    if ('link' in data) {
      if (data.link === null) {
        Object.assign(set, { bb_lookup_id: null, bb_system_id: null, bb_name: null, bb_match_reason: null, bb_linked_at: null });
        await logEvent(env, { foundation_id: f.id, kind: 'unlinked', actor, detail: `was #${f.bb_lookup_id}` });
      } else {
        const lookup = asTrimmed(data.link, 'record number', 12).replace(/^#/, '');
        if (!/^\d{1,9}$/.test(lookup)) throw new HttpError(400, 'bad_record', 'Enter the Blackbaud constituent ID, numbers only.');
        if (lookup === CATCH_ALL.lookup) throw new HttpError(400, 'bad_record', 'That is the Unsolicited Foundations record.');
        const org = await orgByLookup(env, lookup).catch(() => null);
        if (!org) throw new HttpError(404, 'no_record', `Blackbaud has no organization with ID ${lookup}. A record made today shows here after tonight's sync.`);
        Object.assign(set, {
          bb_lookup_id: org.lookup_id,
          bb_system_id: org.system_id,
          bb_name: org.name,
          bb_match_reason: asTrimmed(data.reason, 'reason', 200, false) || `Linked by ${actor || 'staff'}`,
          bb_linked_at: nowIso(),
        });
        await logEvent(env, { foundation_id: f.id, kind: 'linked', actor, detail: `#${org.lookup_id} ${org.name}` });
      }
    }

    const keys = Object.keys(set);
    if (!keys.length) throw new HttpError(400, 'nothing', 'Nothing to change.');
    await env.DB.prepare(`UPDATE fnd_foundations SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => set[k]), nowIso(), f.id)
      .run();
    return json({ ok: true, foundation: await getFoundation(env, f.id) });
  } catch (err) {
    return handleError(err);
  }
};
