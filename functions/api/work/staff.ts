import { HttpError, nowIso } from '../../_lib/http';
import { work, body, type RouteArgs } from '../../_lib/work/route';
import { listStaff, logEvent } from '../../_lib/work/db';

// The people the Work Center knows: who may open it after release, who has an Entry chip. Admins only; a change is a database edit, never a deploy.
const TEAMS = ['support', 'rdd', 'partner_care', 'church', 'grants', 'admin', 'exec'];
const TYPES = ['RDD Action', 'CED Action', 'Carole Action', 'Terry Action'];

export const onRequestGet = work(async ({ env }) => ({ staff: await listStaff(env) }), { adminOnly: true });

async function upsert({ request, env, ctx }: RouteArgs) {
  const b = await body(request);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]+@favorintl\.org$/.test(email)) throw new HttpError(400, 'bad_email', 'Use a favorintl.org address.');
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'missing_field', 'Add the name.');
  const team = String(b.team || '');
  if (!TEAMS.includes(team)) throw new HttpError(400, 'bad_team', 'Pick a team from the list.');
  const fid = b.bb_fundraiser_id ? String(b.bb_fundraiser_id).replace(/\D/g, '').slice(0, 12) : null;
  const entryType = b.entry_type ? String(b.entry_type) : null;
  if (entryType && !TYPES.includes(entryType)) throw new HttpError(400, 'bad_type', 'Pick an action type from the list.');
  await env.DB.prepare(
    `INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, sheet_tab, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, team = excluded.team, bb_fundraiser_id = excluded.bb_fundraiser_id, work_center = excluded.work_center,
       entry_owner = excluded.entry_owner, entry_type = excluded.entry_type, sheet_tab = excluded.sheet_tab, active = excluded.active, updated_at = excluded.updated_at`
  )
    .bind(email, name, team, fid, b.work_center ? 1 : 0, b.entry_owner ? 1 : 0, entryType, b.sheet_tab ? String(b.sheet_tab).slice(0, 60) : null, b.active === false || b.active === 0 ? 0 : 1, nowIso())
    .run();
  await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, kind: 'staff_changed', detail: `${email} ${team} work=${b.work_center ? 1 : 0}` });
  return { staff: await listStaff(env) };
}

export const onRequestPost = work(upsert, { adminOnly: true });
export const onRequestPatch = work(upsert, { adminOnly: true });
