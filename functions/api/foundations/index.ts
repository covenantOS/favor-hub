import { actorOf, requireFoundationsUser } from '../../_lib/foundations/auth';
import { CATCH_ALL, HOWS, OUTCOMES, RDDS, TAGS, retryWaiting } from '../../_lib/foundations/blackbaud';
import { getSetting, listFoundations, logEvent, nameKey } from '../../_lib/foundations/db';
import { HttpError, asTrimmed, handleError, json, newId, nowIso, type Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    await requireFoundationsUser(env, request);
    // Anything that missed Blackbaud earlier gets another try each time the list opens.
    waitUntil(retryWaiting(env, actorOf(request)).catch((err) => console.error('[foundations] retry', err)));
    return json({
      ok: true,
      foundations: await listFoundations(env),
      settings: { posting: await getSetting(env, 'posting', 'on'), moves: await getSetting(env, 'moves', 'off') },
      rdds: RDDS.map((r) => r.name),
      hows: Object.keys(HOWS),
      tags: Object.keys(TAGS),
      outcomes: OUTCOMES,
      catch_all: { lookup: CATCH_ALL.lookup, name: CATCH_ALL.name },
    });
  } catch (err) {
    return handleError(err);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const data = (await request.json()) as Record<string, unknown>;
    const name = asTrimmed(data.name, 'name', 160);
    if (name.length < 3) throw new HttpError(400, 'short_name', 'Give the foundation its full name.');
    const key = nameKey(name);
    const twin = await env.DB.prepare('SELECT id, name FROM fnd_foundations WHERE name_key = ? LIMIT 1').bind(key).first<{ id: string; name: string }>();
    if (twin && data.force !== true) {
      return json({ ok: false, error: 'already_listed', message: `${twin.name} is already on the list.`, id: twin.id }, 409);
    }
    const id = newId('fnd');
    const now = nowIso();
    const actor = actorOf(request);
    await env.DB.prepare(
      `INSERT INTO fnd_foundations (id, name, name_key, location, phone, email, website, ein, assets, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    )
      .bind(
        id,
        name,
        key,
        asTrimmed(data.location, 'location', 120, false),
        asTrimmed(data.phone, 'phone', 40, false),
        asTrimmed(data.email, 'email', 120, false),
        asTrimmed(data.website, 'website', 200, false),
        asTrimmed(data.ein, 'ein', 20, false),
        asTrimmed(data.assets, 'assets', 60, false),
        asTrimmed(data.notes, 'notes', 2000, false),
        actor,
        now,
        now
      )
      .run();
    await logEvent(env, { foundation_id: id, kind: 'added', actor, detail: name });
    return json({ ok: true, id });
  } catch (err) {
    return handleError(err);
  }
};
