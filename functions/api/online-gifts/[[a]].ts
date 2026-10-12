// Online gifts. Admins and the people an admin gave Gift entry access (the admin desk, Partner Care).
//   GET  /?days=1|3|7|14&gift=  the gifts (gift= adds one gift by its ID, whatever its date)
//                              with comment and designation, the Blackbaud batches waiting, the write setting
//   GET  /log?key=             the audit trail of one gift's review
//   POST /approve              { from, items: [{ key, fundId }] } record who approved which designation; queue a change when writes are on
//   POST /setting              admins: { apply: 'on' | 'off', testLimit }
//   GET  /queue, POST /queue/done   the desktop web view runner (agent key only)
import { gift, jsonBody } from '../../_lib/gifts/route';
import { HttpError, nowIso, type Env } from '../../_lib/http';
import { mirror, ops } from '../../_lib/foundations/blackbaud';
import { aiFor } from '../../_lib/ai/guard';
import { isTester } from '../../_lib/testuser';
import { etParts } from '../../_lib/actions/intake';
import {
  approve, BLACKBAUD_HOME, fetchFru, history, overview, putSetting, queueDone, queued, setting, SETTING_APPLY, SETTING_TEST_ONLY, TEST_RECORD,
  type Deps, type FruDonation, type Viewer,
} from '../../_lib/online-gifts/service';

const FRU_CACHE_MS = 10 * 60 * 1000;

function deps(env: Env): Deps {
  const e = env;
  return {
    db: env.DB as any,
    mirror: (sql, p) => mirror(env, sql, p) as Promise<any[]>,
    ops: (m, p, b) => ops(env, m, p, b),
    ai: env.AI ? aiFor(env.AI, 'online-gift-reading') : null,
    fru: e.FUNDRAISEUP_API_KEY
      ? async (from: string) => {
          const c = await setting(env.DB as any, 'og:fru');
          if (c) {
            try {
              const v = JSON.parse(c) as { at: string; from: string; list: FruDonation[] };
              if (v.from <= from && Date.now() - Date.parse(v.at) < FRU_CACHE_MS) return v.list;
            } catch {
              // fetch again
            }
          }
          const list = await fetchFru(e.FUNDRAISEUP_API_KEY!, from);
          await putSetting(env.DB as any, 'og:fru', JSON.stringify({ at: nowIso(), from, list }), nowIso());
          return list;
        }
      : undefined,
  };
}

const viewerOf = (user: { email: string; name?: string; role: string }): Viewer => ({ email: user.email.toLowerCase(), name: user.name || user.email, admin: user.role === 'admin', tester: isTester(user.email) });

function fromOf(daysRaw: unknown): string {
  const days = [1, 3, 7, 14].includes(Number(daysRaw)) ? Number(daysRaw) : 3;
  const today = etParts(new Date()).date;
  return new Date(Date.parse(today + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
}

export const onRequestGet = gift(async ({ env, user, params, url }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  if (a === 'queue') {
    if (user.via !== 'agent') throw new HttpError(403, 'agent_only', 'Only the runner reads this queue.');
    return { queue: await queued(env.DB as any) };
  }
  if (a === 'log') return { log: await history(env.DB as any, String(url.searchParams.get('key') || '')) };
  if (a) throw new HttpError(404, 'no_action', 'There is no such page.');
  const viewer = viewerOf(user);
  const from = fromOf(url.searchParams.get('days'));
  const one = url.searchParams.get('gift') || '';
  const ov = await overview(deps(env), viewer, from, { showTest: url.searchParams.get('test') === '1', giftId: /^\d{1,12}$/.test(one) ? one : '' });
  return { ...ov, me: viewer.email, admin: viewer.admin, blackbaud: BLACKBAUD_HOME, testRecord: TEST_RECORD };
});

export const onRequestPost = gift(async ({ request, env, user, params }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  const sub = String((params.a as string[] | undefined)?.[1] || '');
  const b = await jsonBody(request);
  if (a === 'queue' && sub === 'done') {
    if (user.via !== 'agent') throw new HttpError(403, 'agent_only', 'Only the runner reports here.');
    try {
      await queueDone(deps(env), String(b.key || ''), b.ok === true, String(b.result || ''));
    } catch {
      throw new HttpError(409, 'not_queued', 'That gift is not waiting for the runner.');
    }
    return {};
  }
  const viewer = viewerOf(user);
  if (a === 'approve') {
    const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((x: any) => ({ key: String(x?.key || ''), fundId: String(x?.fundId || '') })) : [];
    if (!items.length) throw new HttpError(400, 'nothing', 'Pick a gift to approve.');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b.from || '')) ? String(b.from) : fromOf(14);
    return { results: await approve(deps(env), viewer, items, from, /^\d{1,12}$/.test(String(b.gift || '')) ? String(b.gift) : '') };
  }
  if (a === 'setting') {
    if (!viewer.admin) throw new HttpError(403, 'admin_only', 'Only an admin changes this.');
    const at = nowIso();
    if (b.apply === 'on' || b.apply === 'off') await putSetting(env.DB as any, SETTING_APPLY, b.apply, at);
    if (typeof b.testLimit === 'string' && /^[0-9, ]{0,60}$/.test(b.testLimit)) await putSetting(env.DB as any, SETTING_TEST_ONLY, b.testLimit.replace(/\s/g, ''), at);
    return { apply: (await setting(env.DB as any, SETTING_APPLY, 'off')) === 'on', testLimit: await setting(env.DB as any, SETTING_TEST_ONLY, TEST_RECORD) };
  }
  throw new HttpError(404, 'no_action', 'There is no such action.');
});
