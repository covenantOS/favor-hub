// The link to Learn (lane LEARN, db/learn.sql). Onboarding assigns the two New hire paths on day one and reads their completion
// back, so the steps "Finish New hire: FavorOS" and "Finish New hire: Favor" close when the paths are finished. Learn's own
// tables are read and written here with plain SQL; where they are missing every function answers "not there" and onboarding
// carries on. The assignment is not given a task of its own: the onboarding step is that task.
import { newId, nowIso, type Env } from '../http';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/** Path slug for each onboarding step key. Learn writes the starter paths under these titles. */
export const PATH_FOR_STEP: Record<string, { slug: string; title: string }> = {
  ospath: { slug: 'new-hire-favoros', title: 'New hire: FavorOS' },
  favpath: { slug: 'new-hire-favor', title: 'New hire: Favor' },
};

export async function learnReady(env: Db): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM learn_paths LIMIT 1').first();
    await env.DB.prepare('SELECT id FROM learn_assignments LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

export interface Given {
  slug: string;
  title: string;
  state: 'given' | 'already' | 'missing' | 'off';
}

/** Gives the person each path with a due date. Safe to run again: a path already given stays as it is, a removed one reopens. */
export async function assignPaths(env: Db, email: string, by: string, dues: Record<string, string | null>): Promise<Given[]> {
  const out: Given[] = [];
  const ready = await learnReady(env);
  for (const [stepKey, p] of Object.entries(PATH_FOR_STEP)) {
    if (!ready) { out.push({ slug: p.slug, title: p.title, state: 'off' }); continue; }
    const path = await env.DB.prepare('SELECT id FROM learn_paths WHERE slug = ?').bind(p.slug).first<{ id: string }>();
    if (!path) { out.push({ slug: p.slug, title: p.title, state: 'missing' }); continue; }
    const now = nowIso();
    const have = await env.DB.prepare(`SELECT id, closed_at, closed_why FROM learn_assignments WHERE email = ? AND kind = 'path' AND target_id = ?`)
      .bind(lower(email), path.id)
      .first<{ id: string; closed_at: string | null; closed_why: string | null }>();
    if (have && !(have.closed_at && have.closed_why === 'removed')) { out.push({ slug: p.slug, title: p.title, state: 'already' }); continue; }
    if (have) {
      await env.DB.prepare(`UPDATE learn_assignments SET closed_at = NULL, closed_why = NULL, due_date = ?, source = 'onboarding', assigned_by = ?, assigned_at = ? WHERE id = ?`).bind(dues[stepKey] || null, lower(by), now, have.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO learn_assignments (id, email, kind, target_id, due_date, source, group_label, note, assigned_by, assigned_at) VALUES (?, ?, 'path', ?, ?, 'onboarding', 'New hire', '', ?, ?)`
      )
        .bind(newId('asg'), lower(email), path.id, dues[stepKey] || null, lower(by), now)
        .run();
    }
    out.push({ slug: p.slug, title: p.title, state: 'given' });
  }
  return out;
}

/** True for each step key whose path the person finished. */
export async function pathsFinished(env: Db, email: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!(await learnReady(env))) return out;
  for (const [stepKey, p] of Object.entries(PATH_FOR_STEP)) {
    const row = await env.DB.prepare(
      `SELECT a.closed_why FROM learn_assignments a JOIN learn_paths p ON p.id = a.target_id WHERE a.email = ? AND a.kind = 'path' AND p.slug = ?`
    )
      .bind(lower(email), p.slug)
      .first<{ closed_why: string | null }>()
      .catch(() => null);
    if (row && row.closed_why === 'complete') out[stepKey] = true;
  }
  return out;
}

/** What the person still has open in Learn, for the offboarding panel. */
export async function openAssignments(env: Db, email: string): Promise<number> {
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM learn_assignments WHERE email = ? AND closed_at IS NULL').bind(lower(email)).first<{ n: number }>();
    return Number(r?.n) || 0;
  } catch {
    return 0;
  }
}

/** Closes the person's open assignments when they leave. The rows stay, closed as removed. */
export async function closeAssignments(env: Db, email: string): Promise<number> {
  try {
    const r = await env.DB.prepare(`UPDATE learn_assignments SET closed_at = ?, closed_why = 'removed' WHERE email = ? AND closed_at IS NULL`).bind(nowIso(), lower(email)).run();
    return Number((r.meta as { changes?: number }).changes) || 0;
  } catch {
    return 0;
  }
}
