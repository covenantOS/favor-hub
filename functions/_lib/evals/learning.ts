// The Learn courses an employee finished, shown on the supervisor's page, and the course list a development goal can link to.
// Reads the Learn lane's tables (db/learn.sql). Until those tables exist both answer an empty list.
import type { Env } from '../http';

export interface Done {
  title: string;
  completedAt: string;
}

export async function completedLearning(env: Pick<Env, 'DB'>, email: string, sinceIso = ''): Promise<Done[]> {
  try {
    // One source for what a person finished: Learn's own record.
    const { learningRecord } = await import('../learn/report');
    const rec = await learningRecord(env as Env, email, { since: sinceIso || undefined });
    return rec.completed.slice(0, 40).map((c) => ({ title: c.course, completedAt: c.completed_at }));
  } catch {
    return [];
  }
}

export async function courseList(env: Pick<Env, 'DB'>): Promise<Array<{ id: string; title: string }>> {
  try {
    const r = await env.DB.prepare("SELECT id, title FROM learn_courses WHERE status = 'published' ORDER BY title LIMIT 200").all<{ id: string; title: string }>();
    return r.results || [];
  } catch {
    return [];
  }
}
