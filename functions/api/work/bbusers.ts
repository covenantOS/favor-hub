import { body, work } from '../../_lib/work/route';
import { PRODUCTS, loadUsers, saveUsers, summarize } from '../../_lib/work/bbusers';

// Blackbaud users, read only, admins only. GET gives the latest read of the Blackbaud users page. POST takes a new read from the desktop
// job (an admin's session or the agent key). Neither changes a Blackbaud user.
export const onRequestGet = work(async ({ env }) => {
  const snap = await loadUsers(env);
  return { users: snap ? snap.users : [], at: snap ? snap.at : '', reported: snap ? snap.reported : 0, summary: snap ? summarize(snap.users) : null, products: PRODUCTS } as any;
}, { adminOnly: true });

export const onRequestPost = work(async ({ env, request }) => {
  const b = await body(request);
  const snap = await saveUsers(env, { users: b.users, reported: b.reported });
  return { saved: snap.users.length, at: snap.at, summary: summarize(snap.users) } as any;
}, { adminOnly: true });
