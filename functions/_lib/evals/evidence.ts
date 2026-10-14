// Evidence for a reviewer: what the person's records show for the year before the evaluation. Tasks finished in Projects, partner
// contacts made through the Work Center and Learn courses completed. Counts and titles only. No partner name, gift or note is read
// here, so the panel shows what was done and never whose record it was. Each source answers an empty result where its table is
// not there yet, so an evaluation always opens.
import type { Env } from '../http';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export interface Evidence {
  /** The window the numbers cover, YYYY-MM-DD, and why it starts where it does. */
  from: string;
  to: string;
  startedWithinYear: boolean;
  tasks: { done: number; late: number; recent: Array<{ title: string; doneAt: string }> };
  partners: { contacted: number; actions: number; byKind: Array<{ kind: string; n: number }> };
  courses: { done: number; list: Array<{ title: string; completedAt: string }> };
}

const KIND_WORD: Record<string, string> = {
  complete: 'Actions completed',
  create: 'Contacts logged',
  thank: 'Thank-yous sent',
  close_thanked: 'Thank-yous closed',
  reassign: 'Actions reassigned',
  reschedule: 'Actions rescheduled',
};

/** The year before `endsOn` (the day week 1 starts), cut to the start date when the person started inside that year. */
export function windowFor(endsOn: string, startDate: string): { from: string; to: string; startedWithinYear: boolean } {
  const yearAgo = addDays(endsOn, -365);
  const started = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') && startDate > yearAgo && startDate <= endsOn;
  return { from: started ? startDate : yearAgo, to: endsOn, startedWithinYear: started };
}

export async function evidenceFor(env: Db, email: string, endsOn: string, startDate: string): Promise<Evidence> {
  const e = lower(email);
  const w = windowFor(endsOn, startDate);
  const fromIso = `${w.from}T00:00:00.000Z`;
  const toIso = `${addDays(w.to, 1)}T00:00:00.000Z`;
  const out: Evidence = {
    ...w,
    tasks: { done: 0, late: 0, recent: [] },
    partners: { contacted: 0, actions: 0, byKind: [] },
    courses: { done: 0, list: [] },
  };
  try {
    const t = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND substr(done_at, 1, 10) > due_date THEN 1 ELSE 0 END), 0) AS late
         FROM hub_tasks WHERE status = 'done' AND COALESCE(done_by, owner_email) = ? AND done_at >= ? AND done_at < ?`
    ).bind(e, fromIso, toIso).first<{ n: number; late: number }>();
    out.tasks.done = Number(t?.n) || 0;
    out.tasks.late = Number(t?.late) || 0;
    const r = await env.DB.prepare(
      `SELECT title, done_at FROM hub_tasks WHERE status = 'done' AND (COALESCE(done_by, owner_email) = ?) AND done_at >= ? AND done_at < ?
          AND project_id IN (SELECT id FROM hub_projects WHERE visibility = 'staff') ORDER BY done_at DESC LIMIT 12`
    ).bind(e, fromIso, toIso).all<{ title: string; done_at: string }>();
    out.tasks.recent = (r.results || []).map((x) => ({ title: String(x.title).slice(0, 120), doneAt: String(x.done_at).slice(0, 10) }));
  } catch {
    // Projects is not switched on.
  }
  try {
    const p = await env.DB.prepare(
      `SELECT b.op AS op, COUNT(*) AS n, COUNT(DISTINCT o.cid) AS partners
         FROM act_outbox o JOIN act_batches b ON b.id = o.batch_id
        WHERE lower(b.actor_email) = ? AND o.state IN ('sent', 'verified') AND b.op NOT IN ('undo', 'reassign', 'reschedule') AND b.created_at >= ? AND b.created_at < ?
        GROUP BY b.op`
    ).bind(e, fromIso, toIso).all<{ op: string; n: number; partners: number }>();
    for (const row of p.results || []) out.partners.byKind.push({ kind: KIND_WORD[row.op] || row.op, n: Number(row.n) || 0 });
    out.partners.actions = out.partners.byKind.reduce((s, k) => s + k.n, 0);
    const d = await env.DB.prepare(
      `SELECT COUNT(DISTINCT o.cid) AS n FROM act_outbox o JOIN act_batches b ON b.id = o.batch_id
        WHERE lower(b.actor_email) = ? AND o.state IN ('sent', 'verified') AND b.op NOT IN ('undo', 'reassign', 'reschedule') AND o.cid IS NOT NULL AND b.created_at >= ? AND b.created_at < ?`
    ).bind(e, fromIso, toIso).first<{ n: number }>();
    out.partners.contacted = Number(d?.n) || 0;
  } catch {
    // The Work Center is not switched on.
  }
  try {
    const c = await env.DB.prepare('SELECT course_title, completed_at FROM learn_completions WHERE email = ? AND completed_at >= ? AND completed_at < ? ORDER BY completed_at DESC LIMIT 40').bind(e, fromIso, toIso).all<{ course_title: string; completed_at: string }>();
    out.courses.list = (c.results || []).map((x) => ({ title: x.course_title, completedAt: String(x.completed_at).slice(0, 10) }));
    out.courses.done = out.courses.list.length;
  } catch {
    // Learn is not switched on.
  }
  return out;
}
