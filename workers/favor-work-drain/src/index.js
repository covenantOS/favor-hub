// favor-work-drain: two jobs for the Work Center, both a call to the hub with the agent key.
//   */15 0-7 * * *  POST /api/work/drain   sends held batches until none are left, the day's lane is full, or Blackbaud says wait
//   10 * * * *      POST /api/work/fresh   asks Blackbaud which actions changed and has them re-read into the mirror
// The hub records what each pass did (act_settings drain:last and fresh:last, shown on /api/work/health). A failed call throws, so a
// stopped job shows as a failed run in Cloudflare and, a day later, as a stale line in health.

async function call(env, path) {
  const res = await fetch(env.HUB_URL + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.AGENT_API_KEY, 'X-Hub-Request': '1', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok || !data || data.ok === false) throw new Error(`${path} answered ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

async function drainAll(env) {
  let sent = 0;
  let left = 0;
  let held = '';
  // One hub call works for about 20 seconds. Keep calling while it makes progress, and stop when nothing is left, nothing moved, or a hold is reported.
  for (let pass = 0; pass < 40; pass++) {
    const r = await call(env, '/api/work/drain');
    sent += Number(r.ran) || 0;
    left = Number(r.left) || 0;
    held = r.held || '';
    if (!left || !r.ran || held) break;
  }
  console.log(`drain: ${sent} sent, ${left} left${held ? ', held: ' + held : ''}`);
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.AGENT_API_KEY) throw new Error('AGENT_API_KEY is not set');
    if (event.cron === '10 * * * *') ctx.waitUntil(call(env, '/api/work/fresh').then((r) => console.log('fresh:', JSON.stringify(r))));
    else ctx.waitUntil(drainAll(env));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
