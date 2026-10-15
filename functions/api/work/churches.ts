import { HttpError, nowIso } from '../../_lib/http';
import { loadChurchDetail, loadChurches } from '../../_lib/work/churches';
import { listMirrorQ, mirrorQ, SYSTEM_ID } from '../../_lib/work/partner';
import { work } from '../../_lib/work/route';
import { todayEt } from '../../_lib/work/service';

// Churches: the church partners, their giving, contacts and next calls, from the mirror. Read only.
// Church Engagement and admins open it. Partner Care and the other teams do not work with churches and are turned away.
export const onRequestGet = work(async ({ ctx, env, url }) => {
  const s = ctx.scope;
  if (s && s.role !== 'admin' && s.team !== 'Church Engagement') throw new HttpError(403, 'not_yours', 'Churches is for Church Engagement.');
  const today = todayEt();
  const id = (url.searchParams.get('church') || '').trim();
  if (id) {
    if (!SYSTEM_ID.test(id)) throw new HttpError(400, 'bad_id', 'That is not a church record.');
    const detail = await loadChurchDetail(mirrorQ(env), id, today);
    if (!detail) throw new HttpError(404, 'not_found', 'That record is not a church.');
    return { detail };
  }
  const list = await loadChurches(listMirrorQ(env), today);
  return { ...list, at: nowIso() };
});
