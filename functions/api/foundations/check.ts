import { requireFoundationsUser } from '../../_lib/foundations/auth';
import { searchOrgs } from '../../_lib/foundations/blackbaud';
import { words } from '../../_lib/foundations/db';
import { handleError, json, type Env } from '../../_lib/http';

/** One search over the prospect list and every organization in Blackbaud. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
    const toks = words(q).filter((w) => w.length > 1).slice(0, 5);
    if (!toks.length) return json({ ok: true, q, prospects: [], blackbaud: [] });

    const where = toks.map(() => 'f.name LIKE ?').join(' AND ');
    const prospects = await env.DB.prepare(
      `SELECT f.id, f.name, f.location, f.status, f.dead_reason, f.bb_lookup_id, f.bb_name,
         (SELECT COUNT(*) FROM fnd_contacts c WHERE c.foundation_id = f.id) AS contacts,
         (SELECT MAX(c.contact_date) FROM fnd_contacts c WHERE c.foundation_id = f.id) AS last_contact,
         (SELECT c.rdd_name FROM fnd_contacts c WHERE c.foundation_id = f.id ORDER BY c.contact_date DESC, c.created_at DESC LIMIT 1) AS last_rdd,
         (SELECT GROUP_CONCAT(DISTINCT c.rdd_name) FROM fnd_contacts c WHERE c.foundation_id = f.id AND c.rdd_name <> '') AS rdds
       FROM fnd_foundations f WHERE ${where} ORDER BY contacts DESC, f.name COLLATE NOCASE LIMIT 12`
    )
      .bind(...toks.map((t) => `%${t}%`))
      .all();

    let blackbaud: unknown[] = [];
    let offline = false;
    try {
      blackbaud = await searchOrgs(env, q, 12);
    } catch (err) {
      console.error('[foundations] mirror', err);
      offline = true;
    }
    return json({ ok: true, q, prospects: prospects.results, blackbaud, offline });
  } catch (err) {
    return handleError(err);
  }
};
