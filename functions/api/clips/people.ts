// The staff picker in a clip's Share window: Favor staff by name or email. Active directory people and signed-in FavorOS people,
// never a blocked account or a field account.
import { handleError, json } from '../../_lib/http';
import { staffOrError, type ClipsEnv } from '../../_lib/clips';

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const q = (new URL(request.url).searchParams.get('q') || '').trim().toLowerCase().replace(/[%_\\]/g, '').slice(0, 60);
    if (q.length < 2) return json({ ok: true, people: [] }, 200, { 'Cache-Control': 'private, no-store' });
    const pat = `%${q}%`;
    const r = await env.DB.prepare(
      `SELECT email, MAX(name) AS name FROM (
         SELECT lower(u.email) AS email, COALESCE(NULLIF(u.name, ''), u.email) AS name FROM hub_users u WHERE u.blocked = 0 AND u.role <> 'field' AND (lower(u.email) LIKE ?1 OR lower(u.name) LIKE ?1)
         UNION ALL
         SELECT lower(d.email), COALESCE(NULLIF(d.name, ''), d.email) FROM meet_directory d WHERE d.active = 1 AND (lower(d.email) LIKE ?1 OR lower(d.name) LIKE ?1)
       ) WHERE email <> ?2 AND email NOT IN (SELECT lower(email) FROM hub_users WHERE blocked = 1) GROUP BY email ORDER BY name LIMIT 8`
    ).bind(pat, who.user.email.toLowerCase()).all<{ email: string; name: string }>();
    return json({ ok: true, people: r.results || [] }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
