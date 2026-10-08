import { actorOf, requireFoundationsUser } from '../../../_lib/foundations/auth';
import { HOWS, OUTCOMES, PEOPLE, TAGS, postContact } from '../../../_lib/foundations/blackbaud';
import { getFoundation, logEvent, publicContact } from '../../../_lib/foundations/db';
import { HttpError, asTrimmed, errorJson, handleError, json, newId, nowIso, type Env } from '../../../_lib/http';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Log a contact. It is saved here first, then posted to Blackbaud in the same request, as an RDD Action for an RDD and a Grants Action for a grant writer. */
export const onRequestPost: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  try {
    await requireFoundationsUser(env, request);
    const f = await getFoundation(env, String(params.id));
    if (!f) return errorJson('not_found', 'That foundation is not on the list.', 404);
    const data = (await request.json()) as Record<string, unknown>;
    const actor = actorOf(request);
    if (!actor) throw new HttpError(400, 'who', 'Choose your name at the top of the page first.');

    const date = asTrimmed(data.date, 'date', 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (!DATE.test(date) || date < '2020-01-01' || date > tomorrow) throw new HttpError(400, 'bad_date', 'Pick the day the contact happened.');
    const how = asTrimmed(data.how, 'how', 20);
    if (!HOWS[how]) throw new HttpError(400, 'bad_how', 'Choose how the contact was made.');
    const person = PEOPLE.find((p) => p.name === asTrimmed(data.rdd, 'fundraiser', 60));
    if (!person) throw new HttpError(400, 'bad_rdd', 'Choose whose contact this was.');
    const note = asTrimmed(data.note, 'what happened', 4000);
    const outcome = asTrimmed(data.outcome, 'outcome', 60, false);
    if (outcome && !OUTCOMES.includes(outcome)) throw new HttpError(400, 'bad_outcome', 'Choose an outcome from the list.');
    const tags = (Array.isArray(data.tags) ? data.tags : []).map(String).filter((t) => TAGS[t]);

    const id = newId('fnc');
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO fnd_contacts (id, foundation_id, contact_date, how, category, rdd_name, rdd_id, summary, note, outcome, tags, source, bb_state, bb_tags_state, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', 'pending', 'none', ?, ?, ?)`
    )
      .bind(id, f.id, date, how, HOWS[how].category, person.name, person.id, `${f.name} - ${how}`.slice(0, 255), note, outcome, JSON.stringify([...new Set(tags)]), actor, now, now)
      .run();
    await env.DB.prepare('UPDATE fnd_foundations SET updated_at = ? WHERE id = ?').bind(now, f.id).run();
    await logEvent(env, { foundation_id: f.id, contact_id: id, kind: 'contact_logged', actor, detail: `${how} for ${person.name} on ${date}` });

    const saved = await postContact(env, id, actor);
    return json({ ok: true, contact: saved ? publicContact(saved) : null });
  } catch (err) {
    return handleError(err);
  }
};
