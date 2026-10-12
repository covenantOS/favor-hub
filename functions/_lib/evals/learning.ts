// The Learn courses an employee finished, shown on the supervisor's page, and the course list a development goal can link to.
// Reads the Learn lane's tables (db/learn.sql). Until those tables exist both answer an empty list.
import type { Env } from '../http';

export interface Done {
  title: string;
  completedAt: string;
}

export async function completedLearning(env: Pick<Env, 'DB'>, email: string, sinceIso = ''): Promise<Done[]> {
  try {
    const r = await env.DB.prepare(
      `SELECT c.title AS title, p.completed_at AS completedAt FROM learn_completions p JOIN learn_courses c ON c.id = p.course_id
        WHERE lower(p.email) = ? AND p.completed_at IS NOT NULL AND p.completed_at >= ? ORDER BY p.completed_at DESC LIMIT 40`
    )
      .bind(String(email).toLowerCase(), sinceIso)
      .all<Done>();
    return r.results || [];
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
