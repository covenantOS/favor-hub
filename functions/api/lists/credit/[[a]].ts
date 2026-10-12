import { HttpError } from '../../../_lib/http';
import { mirror, ops } from '../../../_lib/foundations/blackbaud';
import { mayApprove } from '../../../_lib/lists/credit.ts';
import {
  actorOf, cancel, decide, history, listChanges, lookupGift, lookupPartner, propose, putSetting, queueDone, queued, scan, searchPartners, setting,
  SETTING_APPLY, SETTING_APPROVERS, SETTING_TEST_ONLY, TEST_RECORD,
} from '../../../_lib/lists/credit-service.ts';
import { todayET } from '../../../_lib/lists/service.ts';
import { body, work } from '../../../_lib/work/route';

// Credit and assignments. GET with no path is the overview; the rest are actions named by the path.
//   GET  /                      proposals waiting, recent decisions, the apply setting, who may approve
//   GET  /lookup?q=|gift=|rid=  a gift or a partner with credits, assignments and history
//   GET  /log?id=               the audit trail of one change
//   POST /scan                  look at recent gifts and store proposals (approvers)
//   POST /propose               a person suggests a change
//   POST /decide                an approver approves or rejects
//   POST /cancel                take a proposal back
//   POST /setting               an admin sets apply on or off, the test limit and the approvers
//   GET  /queue, POST /queue/done   the desktop runner's queue (agent key only)
const mirrorQ = (env: any) => (sql: string, p: unknown[]) => mirror(env, sql, p) as Promise<any[]>;

export const onRequestGet = work(async ({ env, wu, params, url }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  const actor = await actorOf(env, wu.email, wu.user.role === 'admin' && wu.scope.all);
  if (a === 'queue') {
    if (wu.user.via !== 'agent') throw new HttpError(403, 'agent_only', 'Only the runner reads this queue.');
    return { queue: await queued(env) };
  }
  if (a === 'lookup') {
    const gid = url.searchParams.get('gift');
    const rid = url.searchParams.get('rid');
    const q = url.searchParams.get('q');
    if (gid) {
      if (!/^\d{1,12}$/.test(gid)) throw new HttpError(400, 'gift', 'Give the gift ID.');
      const out = await lookupGift(env, mirrorQ(env), gid, todayET());
      if (!out) throw new HttpError(404, 'no_gift', 'That gift is not in the Blackbaud copy.');
      return out;
    }
    if (rid) {
      if (!/^\d{1,12}$/.test(rid)) throw new HttpError(400, 'record', 'Give the partner record.');
      return await lookupPartner(env, mirrorQ(env), rid);
    }
    return { matches: await searchPartners(mirrorQ(env), q || '') };
  }
  if (a === 'log') return { log: await history(env, String(url.searchParams.get('id') || '')) };
  const [waiting, recent] = await Promise.all([listChanges(env, ['proposed']), listChanges(env, ['approved', 'queued', 'applied', 'failed', 'rejected', 'cancelled'], 40)]);
  return {
    waiting,
    recent,
    apply: (await setting(env, SETTING_APPLY, 'off')) === 'on',
    testLimit: await setting(env, SETTING_TEST_ONLY, TEST_RECORD),
    approvers: actor.admin ? await setting(env, SETTING_APPROVERS) : undefined,
    mayApprove: mayApprove(actor),
    admin: actor.admin,
    me: wu.email,
  };
});

export const onRequestPost = work(async ({ request, env, wu, params }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  const sub = String((params.a as string[] | undefined)?.[1] || '');
  const b = await body(request);
  const actor = await actorOf(env, wu.email, wu.user.role === 'admin' && wu.scope.all);
  const today = todayET();
  if (a === 'queue' && sub === 'done') {
    if (wu.user.via !== 'agent') throw new HttpError(403, 'agent_only', 'Only the runner reports here.');
    await queueDone(env, String(b.id || ''), b.ok === true, String(b.result || ''));
    return {};
  }
  if (a === 'scan') {
    if (!mayApprove(actor)) throw new HttpError(403, 'not_approver', 'Only an approver runs the scan.');
    const to = today;
    const days = Math.min(120, Math.max(1, Math.floor(Number(b.days) || 45)));
    const from = new Date(Date.parse(to + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10);
    return { ...(await scan(env, mirrorQ(env), from, to, today)), from, to };
  }
  if (a === 'propose') return { id: await propose(env, mirrorQ(env), { email: wu.email }, b, today) };
  if (a === 'decide') {
    const d = b.decision === 'reject' ? 'reject' : 'approve';
    return await decide(env, actor, String(b.id || ''), d, String(b.note || ''), today, (m, p, bd) => ops(env, m, p, bd));
  }
  if (a === 'cancel') {
    await cancel(env, actor, String(b.id || ''));
    return {};
  }
  if (a === 'setting') {
    if (!actor.admin) throw new HttpError(403, 'admin_only', 'Only an admin changes these settings.');
    if (b.apply === 'on' || b.apply === 'off') await putSetting(env, SETTING_APPLY, b.apply);
    if (typeof b.testLimit === 'string' && /^[0-9, ]{0,60}$/.test(b.testLimit)) await putSetting(env, SETTING_TEST_ONLY, b.testLimit.replace(/\s/g, ''));
    if (typeof b.approvers === 'string' && /^[a-z0-9@._, -]{0,400}$/i.test(b.approvers)) await putSetting(env, SETTING_APPROVERS, b.approvers.toLowerCase());
    return { apply: (await setting(env, SETTING_APPLY, 'off')) === 'on', testLimit: await setting(env, SETTING_TEST_ONLY, TEST_RECORD) };
  }
  throw new HttpError(404, 'no_action', 'There is no such action.');
});
