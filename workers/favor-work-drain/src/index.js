// favor-work-drain: two jobs for the Work Center, both a call to the hub with the agent key.
//   */15 0-7 * * *  POST /api/work/drain   sends held batches until none are left, the day's lane is full, or Blackbaud says wait
//   */10 10-18 * * *  POST /api/gift-entry/drain  notices that Jennifer approved a gift batch and copies the check photos (gift entry)
//   */10 11-14 * * 1-5  POST /api/work/digest  the morning email: the hub sends nothing before a person's 7:30 or 8:00 Eastern, nothing after 10:30, never twice a day
//   */5 * * * *     POST /api/meet/meetings/remind and /pump  meeting reminders, repeats, recordings to Drive, notes
//   */5 * * * *     POST /api/work/chat-email  Chat email: welcome, first message, unread after 10 minutes
//   */5 * * * *     POST /api/work/notify  task tag emails (a burst goes as one), feedback reply emails, weekday morning nudges
//   */5 * * * *     POST /api/projects/status/run  Friday 3 PM Eastern: posts each project's update where the owner turned it on
//   */5 * * * *     POST /api/work/snapshots  re-reads the Blackbaud answers the Work lists keep (6 AM to 9 PM Eastern)
//   */5 * * * *     POST /api/work/prewarm  cadence rows and the asks read kept current (5 AM to 9 PM Eastern), briefings built 5 to 7 AM
//   */10 * * * *    POST /api/receipts/warm  reads the Receipts waiting list from Blackbaud so the page never waits on it (10:00 to 02:00 UTC)
//   */5 * * * *     POST /api/ai/reconcile  on every tenth minute: Cloudflare's own AI neuron totals over the budget guard's estimate
//   */5 * * * *     on minutes 0 and 30: the production smoke check (GET /login/, /version.json, a script, then POST /api/hub/smoke)
//   */5 * * * *     POST /api/asana/run  the two-way Asana sync for Projects: queued changes both ways, then what Asana changed since the last pass
//   10 * * * *      POST /api/work/fresh   asks Blackbaud which actions changed and has them re-read into the mirror
// Every job writes its outcome to the hub database (hub_cron_runs, through the DB binding): last_ok on success, last_error and a fails
// count on a failure. Admin > Overview reads it as "Scheduled jobs" and "Smoke check", so a job that stops or fails shows the same day.
// The hub also records what some passes did (act_settings drain:last and fresh:last, shown on /api/work/health).

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

/** Runs one job and writes how it went. A failure is recorded and logged, never thrown past here, so one job cannot stop the others. */
export async function job(env, id, run) {
  const t0 = Date.now();
  const at = new Date().toISOString();
  let ok = true;
  let detail = '';
  try {
    const out = await run();
    detail = typeof out === 'string' ? out : '';
  } catch (err) {
    ok = false;
    detail = String((err && err.message) || err).slice(0, 300);
    console.error(`${id} failed:`, detail);
  }
  const ms = Date.now() - t0;
  if (!env.DB) return ok;
  const sql = ok
    ? `INSERT INTO hub_cron_runs (job, last_run, last_ok, detail, fails, ms) VALUES (?1, ?2, ?2, ?3, 0, ?4)
       ON CONFLICT(job) DO UPDATE SET last_run = ?2, last_ok = ?2, detail = ?3, fails = 0, ms = ?4`
    : `INSERT INTO hub_cron_runs (job, last_run, last_error, error_at, fails, ms) VALUES (?1, ?2, ?3, ?2, 1, ?4)
       ON CONFLICT(job) DO UPDATE SET last_run = ?2, last_error = ?3, error_at = ?2, fails = fails + 1, ms = ?4`;
  await env.DB.prepare(sql).bind(id, at, detail.slice(0, 300), ms).run().catch((err) => console.error('cron record failed:', String(err)));
  return ok;
}

/** The production smoke check: what a person opening FavorOS needs, from outside, then the hub's own checks of its key reads. */
async function smoke(env) {
  const bad = [];
  const get = async (path, test) => {
    try {
      const res = await fetch(env.HUB_URL + path, { redirect: 'manual', headers: { 'User-Agent': 'favor-work-drain smoke' } });
      const text = await res.text();
      if (res.status !== 200 || (test && !test(text))) bad.push(`${path} answered ${res.status}`);
    } catch (err) {
      bad.push(`${path}: ${String(err).slice(0, 80)}`);
    }
  };
  await Promise.all([get('/login/', (t) => /Sign in/.test(t)), get('/version.json', (t) => /"build"/.test(t)), get('/js/hub-nav.js', (t) => t.length > 1000)]);
  const r = await call(env, '/api/hub/smoke').catch((err) => {
    // A failed check answers 200 with ok false; call() throws then, with the body in the message.
    const m = String((err && err.message) || err);
    const body = m.slice(m.indexOf(': ') + 2);
    try { return JSON.parse(body); } catch { return { ok: false, failed: m.slice(0, 200) }; }
  });
  if (!r.ok) bad.push(r.failed || 'the FavorOS smoke check failed');
  if (bad.length) throw new Error(bad.join('; '));
  return (r.checks || []).map((c) => `${c.name} ${c.ms} ms`).join(', ');
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
  const line = `${sent} sent, ${left} left${held ? ', held: ' + held : ''}`;
  console.log('drain: ' + line);
  return line;
}

// Work list answers every five minutes, and the Receipts waiting list every ten through the working day.
async function warm(env, at) {
  await job(env, 'snapshots', async () => {
    const out = await call(env, '/api/work/snapshots');
    if (out.refreshed) console.log('snapshots:', JSON.stringify(out));
    return out.refreshed ? `${out.refreshed} refreshed` : '';
  });
  // Work Center prewarm: cadence rows and the asks read kept current from 5 AM to 9 PM Eastern, and today's briefings built from 5 to 7 AM.
  await job(env, 'prewarm', async () => {
    const r = await call(env, '/api/work/prewarm');
    if (r.why) return r.why;
    const b = r.briefings ? `, briefings ${r.briefings.made} made ${r.briefings.left} left${r.briefings.failed.length ? ' ' + r.briefings.failed.length + ' failed' : ''}` : '';
    return `cadence ${r.cadence ? r.cadence.ms : '-'} ms, asks ${r.asks && r.asks.ms != null ? r.asks.ms + ' ms' : 'current'}${b}, ${r.ms} ms`;
  });
  const d = new Date(at);
  const hour = d.getUTCHours();
  if (d.getUTCMinutes() % 10 === 0 && (hour >= 10 || hour < 2)) {
    await job(env, 'receipts-warm', async () => {
      const r = await call(env, '/api/receipts/warm');
      console.log('receipts warm:', JSON.stringify(r));
      return `${r.letters ?? 0} letters, ${r.ms ?? 0} ms`;
    });
  }
}

// Meetings: reminders and repeats, then up to a few units of saving and note-making for finished meetings.
async function meetings(env) {
  await job(env, 'meetings', async () => {
    const r = await call(env, '/api/meet/meetings/remind');
    let work = 0;
    let pumpErr = '';
    for (let i = 0; i < 6; i++) {
      const p = await call(env, '/api/meet/meetings/pump').catch((err) => {
        pumpErr = String((err && err.message) || err).slice(0, 160);
        return null;
      });
      if (!p || p.done) break;
      work++;
    }
    console.log('meetings: sent ' + r.sent + ', made ' + r.made + ', work ' + work);
    if (pumpErr) throw new Error('notes and recordings: ' + pumpErr);
    return `sent ${r.sent}, made ${r.made}, work ${work}`;
  });
  // Chat email: the welcome, the first-message email and the unread follow-up. The hub records chatmail:last itself.
  await job(env, 'chat-email', async () => {
    const mailed = await call(env, '/api/work/chat-email');
    if (mailed.sent || mailed.failed) console.log('chat email:', JSON.stringify(mailed));
    if (mailed.failed) throw new Error(`${mailed.failed} chat emails failed`);
    return `${mailed.sent || 0} sent`;
  });
  // Notifications: the hub records notify:last itself.
  await job(env, 'notify', async () => {
    const n = await call(env, '/api/work/notify');
    if ((n.errors && n.errors.length) || n.tasks || (n.feedback && n.feedback.sent) || (n.nudges && n.nudges.emails)) console.log('notify:', JSON.stringify(n));
    if (n.errors && n.errors.length) throw new Error(`notify errors: ${JSON.stringify(n.errors).slice(0, 200)}`);
    return JSON.stringify(n).slice(0, 200);
  });
  // Friday project updates: the hub answers at once unless it is Friday after 3 PM Eastern and a project has the update on.
  await job(env, 'project-status', async () => {
    const u = await call(env, '/api/projects/status/run').catch((err) => {
      // A 403 means Projects is switched off, a quiet answer and not a failure.
      if (/ 403: /.test(String(err && err.message))) return { off: true };
      throw err;
    });
    if ((u.posted && u.posted.length) || (u.failed && u.failed.length)) console.log('project updates:', JSON.stringify(u));
    if (u.failed && u.failed.length) throw new Error(`${u.failed.length} project updates failed`);
    return u.off ? 'Projects is off' : `${(u.posted && u.posted.length) || 0} posted`;
  });
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.AGENT_API_KEY) throw new Error('AGENT_API_KEY is not set');
    const logged = (id, path) =>
      job(env, id, async () => {
        const r = await call(env, path);
        console.log(id + ':', JSON.stringify(r));
        return JSON.stringify(r).slice(0, 200);
      });
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(meetings(env));
      ctx.waitUntil(warm(env, event.scheduledTime));
      const min = new Date(event.scheduledTime).getUTCMinutes();
      if (min % 10 === 0) ctx.waitUntil(logged('ai-reconcile', '/api/ai/reconcile'));
      ctx.waitUntil(logged('asana-sync', '/api/asana/run'));
      if (min % 30 === 0) ctx.waitUntil(job(env, 'smoke', () => smoke(env)));
    } else if (event.cron === '*/10 11-14 * * 1-5') ctx.waitUntil(logged('digest', '/api/work/digest'));
    else if (event.cron === '*/10 10-18 * * *') ctx.waitUntil(logged('gift-entry', '/api/gift-entry/drain'));
    else if (event.cron === '35 * * * *') {
      ctx.waitUntil(logged('lists', '/api/lists/refresh?ifnewer=1'));
      ctx.waitUntil(logged('datacare', '/api/datacare/scan'));
    }
    else if (event.cron === '10 * * * *') ctx.waitUntil(logged('fresh', '/api/work/fresh'));
    else ctx.waitUntil(job(env, 'drain', () => drainAll(env)));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
