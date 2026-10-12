import { staffDirectory } from '../../_lib/people';
import { mirrorQ } from '../../_lib/work/partner';
import { accessOf } from '../../_lib/hub/today';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

// Ctrl K's people, funds and appeal codes. People are the staff directory (everyone signed in may search it); funds and appeal codes come from
// the Blackbaud copy and only reach people who may open the Work Center, the same gate the hover cards use (functions/_lib/hub/entity.ts).
//   GET ?q=words  ->  { ok, people: Hit[], funds: Hit[], appeals: Hit[] }     Hit = { kind, id, title, sub }
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = hubUserOf(request);
    if (!user) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const q = lower(new URL(request.url).searchParams.get('q')).slice(0, 60);
    if (q.length < 2) return json({ ok: true, people: [], funds: [], appeals: [] });
    const access = await accessOf(env, request, user);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const people = (await staffDirectory(env).catch(() => []))
      .filter((p) => lower(`${p.name} ${p.email} ${p.title} ${p.team}`).includes(q))
      .slice(0, 6)
      .map((p) => ({ kind: 'person', id: p.email, title: p.name, sub: [p.title || p.team, p.email].filter(Boolean).join(' · ') }));
    let funds: unknown[] = [];
    let appeals: unknown[] = [];
    if (access.workCenter) {
      const m = mirrorQ(env);
      const [f, a] = await Promise.all([
        m<any>('SELECT id, fund_description AS name FROM funds WHERE lower(fund_description) LIKE ?1 OR id = ?2 LIMIT 5', [like, q]).catch(() => []),
        m<any>('SELECT appeal_id AS code, appeal_description AS description FROM appeals WHERE lower(appeal_id) LIKE ?1 OR lower(appeal_description) LIKE ?1 ORDER BY appeal_inactive, appeal_start_date DESC LIMIT 5', [like]).catch(() => []),
      ]);
      funds = f.map((x) => ({ kind: 'fund', id: String(x.id), title: String(x.name || `Fund ${x.id}`), sub: 'Fund' }));
      appeals = a.map((x) => ({ kind: 'appeal', id: String(x.code), title: String(x.code), sub: String(x.description || 'Appeal code') }));
    }
    return json({ ok: true, people, funds, appeals });
  } catch (err) {
    return handleError(err);
  }
};
