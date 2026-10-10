import { HttpError } from '../../../_lib/http';
import { getRollout, GROUPS, setRollout } from '../../../_lib/work/digest';
import { listStaff, logEvent } from '../../../_lib/work/db';
import { body, work } from '../../../_lib/work/route';

// Who gets the morning email, by group, and from which day. An admin changes it here; nothing is deployed.
async function view(env: any) {
  const rollout = await getRollout(env);
  const staff = await listStaff(env);
  return {
    groups: GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      from: rollout[g.key],
      people: staff.filter((s) => s.active === 1 && s.work_center === 1 && g.teams.includes(s.team)).map((s) => s.name),
    })),
  };
}

export const onRequestGet = work(async ({ env }) => (await view(env)) as any, { adminOnly: true });

export const onRequestPut = work(
  async ({ request, env, ctx }) => {
    const b = await body(request);
    const patch: Record<string, string | null> = {};
    for (const g of GROUPS) {
      if (!(g.key in b)) continue;
      const v = b[g.key];
      if (v === null || v === '' || v === 'off') patch[g.key] = null;
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) patch[g.key] = v;
      else throw new HttpError(400, 'bad_date', 'Pick a day, or turn the group off.');
    }
    await setRollout(env, patch);
    await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, kind: 'digest_rollout', detail: JSON.stringify(patch).slice(0, 200) });
    return (await view(env)) as any;
  },
  { adminOnly: true }
);
