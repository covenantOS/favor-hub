// The 5-minute notification pass (favor-work-drain calls POST /api/work/notify): task notices waiting on a burst to settle, feedback
// replies, then the weekday morning nudges. Each part fails on its own; the result is written to act_settings notify:last as
// ok|time|summary or error|time|summary, so a stalled pass shows up instead of going quiet.
import type { Env } from '../http';
import { mailFresh } from '../projects/links/email';
import { feedbackPass } from './feedback';
import { nudgePass } from './nudges';

export async function runNotify(env: Env, now = new Date()): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  const part = async <T>(name: string, p: Promise<T>): Promise<T | { error: string }> =>
    p.catch((err) => {
      const msg = `${name}: ${String((err as Error)?.message || err).slice(0, 160)}`;
      errors.push(msg);
      return { error: msg };
    });
  const tasks = await part('tasks', mailFresh(env, now));
  const feedback = await part('feedback', feedbackPass(env));
  const nudges = await part('nudges', nudgePass(env, now));
  const out = { ok: true, tasks, feedback, nudges, errors };
  const summary = JSON.stringify({ tasks, feedback, nudges }).slice(0, 400);
  const v = `${errors.length ? 'error' : 'ok'}|${new Date().toISOString()}|${errors.length ? errors.join('; ').slice(0, 300) : summary}`;
  await env.DB.prepare(
    `INSERT INTO act_settings (key, value, updated_at) VALUES ('notify:last', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(v, new Date().toISOString())
    .run()
    .catch(() => null);
  return out;
}
