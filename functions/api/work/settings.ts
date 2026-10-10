import { HttpError, nowIso, type Env } from '../../_lib/http';
import { work, body } from '../../_lib/work/route';
import { getSetting, logEvent, setSetting } from '../../_lib/work/db';

// Admin settings: who the Work Center is open to, the kill switch for posting, the daily lane and how a thank-you is recorded.
async function read(env: Env) {
  return {
    release: (await getSetting(env, 'release', 'admins')) === 'support' ? 'support' : 'admins',
    posting: (await getSetting(env, 'posting', 'on')) === 'off' ? 'off' : 'on',
    lane_cap: Number(await getSetting(env, 'lane_cap', '2400')) || 2400,
    thank_mode: (await getSetting(env, 'thank_mode', 'one')) === 'two' ? 'two' : 'one',
  };
}

export const onRequestGet = work(async ({ env }) => ({ settings: await read(env) }), { adminOnly: true });

export const onRequestPost = work(
  async ({ request, env, ctx }) => {
    const b = await body(request);
    const before = await read(env);
    if (b.release !== undefined) {
      if (b.release !== 'admins' && b.release !== 'support') throw new HttpError(400, 'bad_value', 'Release is admins or support.');
      await setSetting(env, 'release', b.release);
    }
    if (b.posting !== undefined) {
      if (b.posting !== 'on' && b.posting !== 'off') throw new HttpError(400, 'bad_value', 'Posting is on or off.');
      await setSetting(env, 'posting', b.posting);
    }
    if (b.lane_cap !== undefined) {
      const n = Math.floor(Number(b.lane_cap));
      if (!Number.isFinite(n) || n < 100 || n > 2900) throw new HttpError(400, 'bad_value', 'The lane is 100 to 2,900 calls a day.');
      await setSetting(env, 'lane_cap', String(n));
    }
    if (b.thank_mode !== undefined) {
      if (b.thank_mode !== 'one' && b.thank_mode !== 'two') throw new HttpError(400, 'bad_value', 'Thank-you mode is one or two.');
      await setSetting(env, 'thank_mode', b.thank_mode);
    }
    const after = await read(env);
    await logEvent(env, { actor: ctx.actor, actor_email: ctx.email, kind: 'release_changed', detail: `${JSON.stringify(before)} -> ${JSON.stringify(after)} at ${nowIso()}` });
    return { settings: after };
  },
  { adminOnly: true }
);
