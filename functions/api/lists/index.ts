import { menus } from '../../_lib/lists/run.ts';
import { columns, windowsFor } from '../../_lib/lists/criteria.ts';
import { contactAccess, hubQ, listSaved, snapshotMeta, todayET } from '../../_lib/lists/service.ts';
import { refreshIfStale } from '../../_lib/lists/refresh.ts';
import { work } from '../../_lib/work/route';

// The builder's menus, the column catalog, the snapshot's age and the lists this person may open. Admins can also see the person-wise scope.
export const onRequestGet = work(async ({ env, wu, waitUntil }) => {
  const meta = await snapshotMeta(env);
  refreshIfStale(env, meta, waitUntil);
  const q = hubQ(env);
  const [m, saved] = await Promise.all([meta ? menus(q) : Promise.resolve(null), listSaved(env, wu.email)]);
  const w = windowsFor(todayET());
  return {
    snapshot: meta,
    today: w.today,
    windows: { active: w.t12, lybunt: w.t24 },
    menus: m,
    columns: columns(w).map((c) => ({ key: c.key, label: c.label, type: c.type, only: c.only ?? null, def: Boolean(c.def), live: c.live ?? null })),
    saved,
    contacts: await contactAccess(env, wu.email, wu.scope.all),
    admin: wu.scope.all,
    me: { email: wu.email, name: wu.actor },
  };
});
