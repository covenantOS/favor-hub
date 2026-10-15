// The guided tour and the What's new line: each person's progress in the hub D1, the adoption list for admins, and Send
// again. Two items are kept: "core" (the tour: its state, its skips and the step the person stopped on) and "news" (when the
// person last saw what changed). The table (db/tours.sql, db/tours-step.sql) may not exist yet: every read then answers "not
// ready" and the browser keeps the progress itself, so nothing breaks before the table is added.
import { HttpError, nowIso, type Env } from '../http';
import { staffDirectory } from '../people';
import { cleanProgress, merge, requeue, type ItemState, type Progress } from '../../../src/scripts/tour-state';
export const coreItem = 'core';
export const newsItem = 'news';
const KNOWN = [coreItem, newsItem];

interface Row { email: string; item: string; state: string; snoozes: number; snooze_until: string | null; updated_at: string; first_at: string; done_at: string | null; step?: number | null }

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
  const row: ItemState = { s, n: Number(r.snoozes) || 0, at: r.updated_at };
  if (r.snooze_until) row.until = r.snooze_until;
  if (Number(r.step) > 0) row.i = Number(r.step);
  return row;
};

// The step column (db/tours-step.sql) may not be there yet: reads and writes fall back to the columns that are.
const noStep = (err: unknown) => /no such column.*step|has no column named step/i.test(String((err as Error)?.message || err));

export async function progressFor(env: Pick<Env, 'DB'>, email: string): Promise<Progress> {
  const q = (cols: string) => env.DB.prepare(`SELECT ${cols} FROM hub_tours WHERE email = ?`).bind(lower(email)).all<Row>();
  let res;
  try {
    res = await q('email, item, state, snoozes, snooze_until, updated_at, first_at, done_at, step');
  } catch (err) {
    if (!noStep(err)) throw err;
    res = await q('email, item, state, snoozes, snooze_until, updated_at, first_at, done_at');
  }
  const out: Progress = {};
  for (const r of (res.results || []) as Row[]) out[r.item] = toState(r);
  return out;
}

async function write(env: Pick<Env, 'DB'>, email: string, items: Progress, queuedBy = ''): Promise<void> {
  const now = nowIso();
  const withStep = (step: boolean) =>
    Object.entries(items).map(([item, v]) =>
      step
        ? env.DB.prepare(
            `INSERT INTO hub_tours (email, item, state, snoozes, snooze_until, updated_at, first_at, done_at, queued_by, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(email, item) DO UPDATE SET state = excluded.state, snoozes = excluded.snoozes, snooze_until = excluded.snooze_until,
               updated_at = excluded.updated_at, done_at = excluded.done_at, queued_by = excluded.queued_by, step = excluded.step`
          ).bind(lower(email), item, v.s, v.n, v.until || null, v.at, now, v.s === 'done' ? v.at : null, v.s === 'queued' ? queuedBy : null, v.i || 0)
        : env.DB.prepare(
            `INSERT INTO hub_tours (email, item, state, snoozes, snooze_until, updated_at, first_at, done_at, queued_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(email, item) DO UPDATE SET state = excluded.state, snoozes = excluded.snoozes, snooze_until = excluded.snooze_until,
               updated_at = excluded.updated_at, done_at = excluded.done_at, queued_by = excluded.queued_by`
          ).bind(lower(email), item, v.s, v.n, v.until || null, v.at, now, v.s === 'done' ? v.at : null, v.s === 'queued' ? queuedBy : null)
    );
  // One batch: a D1 batch is a single call however many rows it holds.
  const stmts = withStep(true);
  if (!stmts.length) return;
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (!noStep(err)) throw err;
    await env.DB.batch(withStep(false));
  }
}

export interface SyncResult { ready: boolean; items: Progress; coreJustDone: boolean }

/** Take what the browser has, merge it with what is stored, store the result and answer with it. */
export async function syncProgress(env: Pick<Env, 'DB'>, email: string, raw: unknown): Promise<SyncResult> {
  if (!(await toursReady(env))) return { ready: false, items: {}, coreJustDone: false };
  const known = new Set(KNOWN);
  const mine = cleanProgress(raw);
  for (const k of Object.keys(mine)) if (!known.has(k)) delete mine[k];
  const stored = await progressFor(env, email);
  const merged = merge(stored, mine);
  const changed: Progress = {};
  for (const [k, v] of Object.entries(merged)) {
    const s = stored[k];
    if (!s || s.s !== v.s || s.n !== v.n || (s.until || '') !== (v.until || '') || (s.i || 0) !== (v.i || 0) || s.at !== v.at) changed[k] = v;
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
  /** Kept so the admin page reads the same shape; the tour has no releases any more. */
  releases: Record<string, never>;
  lastSeen: string;
}

export async function adoption(env: Pick<Env, 'DB'>) {
  if (!(await toursReady(env))) return { ready: false, releases: [] as never[], people: [] as AdoptionPerson[], teams: [] as string[] };
  const [dir, rowsRes, users] = await Promise.all([
    staffDirectory(env),
    env.DB.prepare("SELECT email, item, state, snoozes, snooze_until, updated_at, first_at, done_at FROM hub_tours WHERE item = 'core'").all<Row>(),
    env.DB.prepare("SELECT email, last_seen FROM hub_users WHERE lower(email) NOT IN ('tester@favorintl.org', 'tester2@favorintl.org')").all<{ email: string; last_seen: string | null }>().catch(() => ({ results: [] as { email: string; last_seen: string | null }[] })),
  ]);
  const seen = new Map((users.results || []).map((u) => [lower(u.email), u.last_seen || '']));
  const by = new Map<string, Row>();
  for (const r of rowsRes.results || []) by.set(r.email, r);
  const people: AdoptionPerson[] = dir.map((p) => {
    const c = by.get(p.email);
    return { email: p.email, name: p.name, team: p.team, core: { state: c?.state || '', at: c?.updated_at || '', skips: Number(c?.snoozes) || 0 }, releases: {}, lastSeen: seen.get(p.email) || '' };
  });
  return { ready: true, releases: [] as never[], people, teams: [...new Set(dir.map((p) => p.team).filter(Boolean))].sort() };
}

/** Send again: the tour opens by itself for these people on their next quiet page. */
export async function sendAgain(env: Pick<Env, 'DB'>, actor: string, what: string, to: { emails?: unknown; team?: unknown }): Promise<{ sent: number }> {
  if (!(await toursReady(env))) throw new HttpError(409, 'not_ready', 'Send again works once the tours table is added to the database.');
  if (what !== coreItem) throw new HttpError(400, 'bad_item', 'Pick the tour to send.');
  const dir = await staffDirectory(env);
  const team = String(to.team || '').trim();
  const asked = new Set((Array.isArray(to.emails) ? to.emails : []).map(lower));
  const people = dir.filter((p) => (team ? p.team === team : asked.has(p.email)));
  if (!people.length) throw new HttpError(400, 'nobody', 'Pick a person or a team.');
  const at = nowIso();
  for (const p of people) await write(env, p.email, requeue({}, coreItem, at), lower(actor));
  return { sent: people.length };
}
