// The guided tour and the New in FavorOS walkthroughs: each person's progress in the hub D1, the adoption list for admins,
// and Send again. The table (db/tours.sql) may not exist yet: every read then answers "not ready" and the browser keeps
// the progress itself, so nothing breaks before the table is added.
import { HttpError, nowIso, type Env } from '../http';
import { staffDirectory } from '../people';
import { cleanProgress, merge, requeue, type ItemState, type Progress } from '../../../src/scripts/tour-state';
import { RELEASES, allItems, coreItem, featureItem, releaseItem } from '../../../src/scripts/tours';

interface Row { email: string; item: string; state: string; snoozes: number; snooze_until: string | null; updated_at: string; first_at: string; done_at: string | null }

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const missing = (err: unknown) => /no such table/i.test(String((err as Error)?.message || err));

export async function toursReady(env: Pick<Env, 'DB'>): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT 1 FROM hub_tours LIMIT 1').first();
    return true;
  } catch (err) {
    if (missing(err)) return false;
    throw err;
  }
}

const toState = (r: Row): ItemState => {
  const s = r.state === 'done' || r.state === 'snoozed' || r.state === 'queued' ? r.state : 'offered';
  return r.snooze_until ? { s, n: Number(r.snoozes) || 0, until: r.snooze_until, at: r.updated_at } : { s, n: Number(r.snoozes) || 0, at: r.updated_at };
};

export async function progressFor(env: Pick<Env, 'DB'>, email: string): Promise<Progress> {
  const rows = ((await env.DB.prepare('SELECT email, item, state, snoozes, snooze_until, updated_at, first_at, done_at FROM hub_tours WHERE email = ?').bind(lower(email)).all<Row>()).results || []) as Row[];
  const out: Progress = {};
  for (const r of rows) out[r.item] = toState(r);
  return out;
}

async function write(env: Pick<Env, 'DB'>, email: string, items: Progress, queuedBy = ''): Promise<void> {
  const now = nowIso();
  const stmts = Object.entries(items).map(([item, v]) =>
    env.DB.prepare(
      `INSERT INTO hub_tours (email, item, state, snoozes, snooze_until, updated_at, first_at, done_at, queued_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email, item) DO UPDATE SET state = excluded.state, snoozes = excluded.snoozes, snooze_until = excluded.snooze_until,
         updated_at = excluded.updated_at, done_at = excluded.done_at, queued_by = excluded.queued_by`
    ).bind(lower(email), item, v.s, v.n, v.until || null, v.at, now, v.s === 'done' ? v.at : null, v.s === 'queued' ? queuedBy : null)
  );
  // One batch: a D1 batch is a single call however many rows it holds.
  if (stmts.length) await env.DB.batch(stmts);
}

export interface SyncResult { ready: boolean; items: Progress; coreJustDone: boolean }

/** Take what the browser has, merge it with what is stored, store the result and answer with it. */
export async function syncProgress(env: Pick<Env, 'DB'>, email: string, raw: unknown): Promise<SyncResult> {
  if (!(await toursReady(env))) return { ready: false, items: {}, coreJustDone: false };
  const known = new Set(allItems());
  const mine = cleanProgress(raw);
  for (const k of Object.keys(mine)) if (!known.has(k)) delete mine[k];
  const stored = await progressFor(env, email);
  const merged = merge(stored, mine);
  const changed: Progress = {};
  for (const [k, v] of Object.entries(merged)) {
    const s = stored[k];
    if (!s || s.s !== v.s || s.n !== v.n || (s.until || '') !== (v.until || '') || s.at !== v.at) changed[k] = v;
  }
  await write(env, email, changed);
  return { ready: true, items: merged, coreJustDone: merged[coreItem]?.s === 'done' && stored[coreItem]?.s !== 'done' };
}

/** Finishing the core tour completes "The guided tour" lesson of the FavorOS basics course in Learn, when that course is there. */
export async function recordLearn(env: Env, email: string): Promise<boolean> {
  try {
    const lesson = await env.DB.prepare(
      `SELECT l.id FROM learn_lessons l JOIN learn_courses c ON c.id = l.course_id
        WHERE c.seed_key = 'course:favoros-basics' AND c.status = 'published' AND l.kind = 'article' AND l.ref = 'guided-tour' LIMIT 1`
    ).first<{ id: string }>();
    if (!lesson) return false;
    const { setProgress } = await import('../learn/progress');
    await setProgress(env, email, lesson.id, { state: 'done' });
    return true;
  } catch {
    // Learn is not set up here, or the lesson was removed: the tour still counts as done.
    return false;
  }
}

/* ------------------------------------------------------------ admin: who has finished what */

export interface AdoptionPerson {
  email: string;
  name: string;
  team: string;
  /** state is empty until the person is shown the tour, then offered | snoozed | done | queued. */
  core: { state: string; at: string; skips: number };
  releases: Record<string, { done: number; shown: number; skips: number; at: string; features: Record<string, string> }>;
  lastSeen: string;
}

export async function adoption(env: Pick<Env, 'DB'>) {
  const releases = RELEASES.map((r) => ({ id: r.id, title: r.title, features: r.features.map((f) => ({ id: f.id, title: f.title })) }));
  if (!(await toursReady(env))) return { ready: false, releases, people: [] as AdoptionPerson[], teams: [] as string[] };
  const [dir, rowsRes, users] = await Promise.all([
    staffDirectory(env),
    env.DB.prepare('SELECT email, item, state, snoozes, snooze_until, updated_at, first_at, done_at FROM hub_tours').all<Row>(),
    env.DB.prepare("SELECT email, last_seen FROM hub_users WHERE lower(email) <> 'tester@favorintl.org'").all<{ email: string; last_seen: string | null }>().catch(() => ({ results: [] as { email: string; last_seen: string | null }[] })),
  ]);
  const seen = new Map((users.results || []).map((u) => [lower(u.email), u.last_seen || '']));
  const by = new Map<string, Row[]>();
  for (const r of rowsRes.results || []) by.set(r.email, [...(by.get(r.email) || []), r]);
  const people: AdoptionPerson[] = dir.map((p) => {
    const rows = new Map((by.get(p.email) || []).map((r) => [r.item, r]));
    const c = rows.get(coreItem);
    const rel: AdoptionPerson['releases'] = {};
    for (const r of RELEASES) {
      const g = rows.get(releaseItem(r.id));
      const features: Record<string, string> = {};
      let done = 0;
      let shown = 0;
      let at = g?.updated_at || '';
      for (const f of r.features) {
        const row = rows.get(featureItem(r.id, f.id));
        if (!row) continue;
        shown++;
        features[f.id] = row.state;
        if (row.state === 'done') done++;
        if (row.updated_at > at) at = row.updated_at;
      }
      rel[r.id] = { done, shown, skips: Number(g?.snoozes) || 0, at, features };
    }
    return { email: p.email, name: p.name, team: p.team, core: { state: c?.state || '', at: c?.updated_at || '', skips: Number(c?.snoozes) || 0 }, releases: rel, lastSeen: seen.get(p.email) || '' };
  });
  return { ready: true, releases, people, teams: [...new Set(dir.map((p) => p.team).filter(Boolean))].sort() };
}

/** Send again: the tour or the release opens by itself for these people on their next quiet page. */
export async function sendAgain(env: Pick<Env, 'DB'>, actor: string, what: string, to: { emails?: unknown; team?: unknown }): Promise<{ sent: number }> {
  if (!(await toursReady(env))) throw new HttpError(409, 'not_ready', 'Send again works once the tours table is added to the database.');
  const release = RELEASES.find((r) => releaseItem(r.id) === what);
  if (what !== coreItem && !release) throw new HttpError(400, 'bad_item', 'Pick the tour or a release to send.');
  const dir = await staffDirectory(env);
  const team = String(to.team || '').trim();
  const asked = new Set((Array.isArray(to.emails) ? to.emails : []).map(lower));
  const people = dir.filter((p) => (team ? p.team === team : asked.has(p.email)));
  if (!people.length) throw new HttpError(400, 'nobody', 'Pick a person or a team.');
  const at = nowIso();
  for (const p of people) {
    const stored = await progressFor(env, p.email);
    let next: Progress = requeue({}, what, at);
    // A release goes out again with the walkthroughs the person was shown before; one they never saw is still new to them.
    if (release) for (const f of release.features) if (stored[featureItem(release.id, f.id)]) next = requeue(next, featureItem(release.id, f.id), at);
    await write(env, p.email, next, lower(actor));
  }
  return { sent: people.length };
}
