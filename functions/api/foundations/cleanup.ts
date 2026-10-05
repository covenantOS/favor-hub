import { requireFoundationsUser } from '../../_lib/foundations/auth';
import { CATCH_ALL, thinRecords } from '../../_lib/foundations/blackbaud';
import { getSetting } from '../../_lib/foundations/db';
import { handleError, json, type Env } from '../../_lib/http';

/** Contacts sitting on Unsolicited Foundations whose foundation has its own Blackbaud record, and records made at a first call. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireFoundationsUser(env, request);
    const rows = await env.DB.prepare(
      `SELECT f.id, f.name, f.bb_lookup_id, f.bb_name, f.bb_match_reason, f.bb_linked_at,
              c.id AS contact_id, c.contact_date, c.category, c.rdd_name, c.summary, c.tags
       FROM fnd_contacts c JOIN fnd_foundations f ON f.id = c.foundation_id
       WHERE f.bb_lookup_id IS NOT NULL AND c.bb_on = ? AND c.bb_state = 'posted'
       ORDER BY f.name COLLATE NOCASE, c.contact_date`
    )
      .bind(CATCH_ALL.lookup)
      .all();
    let thin: unknown[] = [];
    let offline = false;
    try {
      thin = await thinRecords(env);
    } catch (err) {
      console.error('[foundations] mirror', err);
      offline = true;
    }
    return json({ ok: true, misplaced: rows.results, thin, offline, moves: await getSetting(env, 'moves', 'off') });
  } catch (err) {
    return handleError(err);
  }
};
