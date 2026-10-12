// favor-work-drain: two jobs for the Work Center, both a call to the hub with the agent key.
//   */15 0-7 * * *  POST /api/work/drain   sends held batches until none are left, the day's lane is full, or Blackbaud says wait
//   */10 10-18 * * *  POST /api/gift-entry/drain  notices that Jennifer approved a gift batch and copies the check photos (gift entry)
//   */10 11-14 * * 1-5  POST /api/work/digest  the morning email: the hub sends nothing before a person's 7:30 or 8:00 Eastern, nothing after 10:30, never twice a day
//   */5 * * * *     POST /api/meet/meetings/remind and /pump  meeting reminders, repeats, recordings to Drive, notes
//   */5 * * * *     POST /api/projects/status/run  Friday 3 PM Eastern: posts each project's update where the owner turned it on
//   */5 * * * *     POST /api/work/snapshots  re-reads the Blackbaud answers the Work lists keep (6 AM to 9 PM Eastern)
//   */10 * * * *    POST /api/receipts/warm  reads the Receipts waiting list from Blackbaud so the page never waits on it (10:00 to 02:00 UTC)
//   */5 * * * *     POST /api/ai/reconcile  on every tenth minute: Cloudflare's own AI neuron totals over the budget guard's estimate
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

// Meetings: reminders and repeats, then up to a few units of saving and note-making for finished meetings.
async function warm(env, at) {
  const out = await call(env, '/api/work/snapshots').catch((err) => ({ error: String(err).slice(0, 160) }));
  if (out.refreshed || out.error) console.log('snapshots:', JSON.stringify(out));
  const d = new Date(at);
  const hour = d.getUTCHours();
  if (d.getUTCMinutes() % 10 === 0 && (hour >= 10 || hour < 2)) {
    const r = await call(env, '/api/receipts/warm').catch((err) => ({ error: String(err).slice(0, 160) }));
    console.log('receipts warm:', JSON.stringify(r));
  }
}

async function meetings(env) {
  const r = await call(env, '/api/meet/meetings/remind');
  let work = 0;
  for (let i = 0; i < 6; i++) {
    const p = await call(env, '/api/meet/meetings/pump').catch(() => null);
    if (!p || p.done) break;
    work++;
  }
  console.log('meetings: sent ' + r.sent + ', made ' + r.made + ', work ' + work);
  // Friday project updates: the hub answers at once unless it is Friday after 3 PM Eastern and a project has the update on.
  const u = await call(env, '/api/projects/status/run').catch((err) => ({ error: String(err).slice(0, 160) }));
  if ((u.posted && u.posted.length) || (u.failed && u.failed.length) || (u.error && !/ 403: /.test(u.error))) console.log('project updates:', JSON.stringify(u));
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.AGENT_API_KEY) throw new Error('AGENT_API_KEY is not set');
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(meetings(env));
      ctx.waitUntil(warm(env, event.scheduledTime));
      if (new Date(event.scheduledTime).getUTCMinutes() % 10 === 0) ctx.waitUntil(call(env, '/api/ai/reconcile').then((r) => console.log('ai budget:', JSON.stringify(r))));
    }
    else if (event.cron === '*/10 11-14 * * 1-5') ctx.waitUntil(call(env, '/api/work/digest').then((r) => console.log('digest:', JSON.stringify(r))));
    else if (event.cron === '*/10 10-18 * * *') ctx.waitUntil(call(env, '/api/gift-entry/drain').then((r) => console.log('gift-entry:', JSON.stringify(r))));
    else if (event.cron === '35 * * * *') ctx.waitUntil(call(env, '/api/lists/refresh?ifnewer=1').then((r) => console.log('lists:', JSON.stringify(r))));
    else if (event.cron === '10 * * * *') ctx.waitUntil(call(env, '/api/work/fresh').then((r) => console.log('fresh:', JSON.stringify(r))));
    else ctx.waitUntil(drainAll(env));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
