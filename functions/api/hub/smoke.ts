// The production smoke check, called every 30 minutes by the favor-work-drain Worker with the agent key. It runs the reads every page
// leans on as a non-admin would (the menu, the bell), checks the hub database, Favor Brain, the KPI dashboard and the meeting connection
// minting, and answers with each check's result and time. It changes nothing. The Worker records the answer in hub_cron_runs, which
// Admin > Overview shows as "Smoke check".
import { agentKeyOk, TESTER2_EMAIL, TESTER2_NAME } from '../../_lib/testuser';
import { errorJson, handleError, json, type Env } from '../../_lib/http';
import { withUserHeaders, type HubUser } from '../../_lib/session';
import { accessOf, navCounts } from '../../_lib/hub/today';
import { notificationsFor } from '../../_lib/hub/notifications';
import { kpiGet } from '../../_lib/hub/kpi';
import { SFU, type MeetEnv } from '../../_lib/meet';

/** The TURN credentials a meeting asks for on join. The room quietly falls back to STUN when this fails, so only a check like this sees it. */
async function mintCheck(env: MeetEnv): Promise<string> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) throw new Error('the TURN key is not set');
  const r = await fetch(`${SFU}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: 60 }),
  });
  const d = (await r.json().catch(() => null)) as { iceServers?: unknown[] } | null;
  if (!r.ok || !d?.iceServers?.length) throw new Error(`Cloudflare answered ${r.status}`);
  return `${d.iceServers.length} servers`;
}

interface Check { name: string; ok: boolean; ms: number; note?: string }

async function timed(name: string, run: () => Promise<string | void>, slowMs: number): Promise<Check> {
  const t0 = Date.now();
  try {
    const note = await Promise.race([run(), new Promise<never>((_, no) => setTimeout(() => no(new Error('no answer in 10 seconds')), 10_000))]);
    const ms = Date.now() - t0;
    if (ms > slowMs) return { name, ok: false, ms, note: `slow: ${ms} ms, limit ${slowMs} ms` };
    return { name, ok: true, ms, ...(note ? { note } : {}) };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, note: String((err as Error)?.message || err).slice(0, 160) };
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!agentKeyOk(env, request)) return errorJson('forbidden', 'Invalid or missing agent key', 403);
    // A staff member's view: the second test account as plain staff, so the non-admin paths run too.
    const user: HubUser = { email: TESTER2_EMAIL, name: TESTER2_NAME, picture: '', role: 'staff', via: 'google', kpi: true };
    const req = withUserHeaders(new Request(new URL('/', request.url).toString()), user);
    const checks = await Promise.all([
      timed('database', async () => { const r = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>(); if (r?.one !== 1) throw new Error('no row'); }, 1500),
      timed('menu and bell', async () => {
        const access = await accessOf(env, req, user);
        await Promise.all([navCounts(env, user, access, req), notificationsFor(env, user, access)]);
      }, 3000),
      timed('Favor Brain', async () => {
        const r = await fetch('https://mcp.favorintl.org/health', { headers: { 'User-Agent': 'favor-hub smoke' } });
        const d = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (!r.ok || !d?.ok) throw new Error(`answered ${r.status}`);
      }, 4000),
      timed('KPI dashboard', async () => { await kpiGet(env, '/auth/verify', { email: TESTER2_EMAIL, name: TESTER2_NAME }); }, 5000),
      timed('meeting connection', async () => mintCheck(env as MeetEnv), 5000),
    ]);
    const failed = checks.filter((c) => !c.ok);
    return json({ ok: failed.length === 0, checks, failed: failed.map((c) => `${c.name} (${c.note || 'failed'})`).join('; ') });
  } catch (err) {
    return handleError(err);
  }
};
