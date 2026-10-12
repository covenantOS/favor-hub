// Learn reporting for authors (hub admins and people marked HR): who is assigned what, who is done, who is overdue, quiz scores.
// Also the learning record other areas read (Evaluations shows completed learning on the supervisor summary).
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { allCourses, allPaths, lessonTotals, pathCourseMap } from './content';
import { lower, today } from './db';
import { hrefFor } from './assign';

type Status = 'done' | 'overdue' | 'in_progress' | 'not_started';

export interface ReportRow {
  assignment_id: string;
  email: string;
  name: string;
  team: string;
  kind: 'course' | 'path';
  title: string;
  slug: string;
  href: string;
  due_date: string | null;
  status: Status;
  pct: number;
  done: number;
  total: number;
  last_at: string | null;
  completed_at: string | null;
  best_score: number | null;
  assigned_at: string;
  source: string;
}

interface Agg {
  done: Map<string, number>;
  last: Map<string, string>;
  comp: Map<string, string>;
  score: Map<string, number>;
}

/** Progress, completions and mean best quiz score for everyone, keyed by "email|course". */
async function aggregate(env: Env): Promise<Agg> {
  const [prog, comp, score] = await Promise.all([
    env.DB.prepare("SELECT email, course_id, SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done, MAX(updated_at) AS last FROM learn_progress GROUP BY email, course_id").all<{ email: string; course_id: string; done: number; last: string }>(),
    env.DB.prepare('SELECT email, course_id, completed_at FROM learn_completions').all<{ email: string; course_id: string; completed_at: string }>(),
    env.DB.prepare('SELECT email, course_id, AVG(best) AS avg FROM (SELECT email, course_id, lesson_id, MAX(score) AS best FROM learn_attempts GROUP BY email, course_id, lesson_id) GROUP BY email, course_id').all<{ email: string; course_id: string; avg: number }>(),
  ]);
  const key = (e: string, c: string) => `${e}|${c}`;
  return {
    done: new Map((prog.results || []).map((r) => [key(r.email, r.course_id), Number(r.done) || 0])),
    last: new Map((prog.results || []).map((r) => [key(r.email, r.course_id), r.last])),
    comp: new Map((comp.results || []).map((r) => [key(r.email, r.course_id), r.completed_at])),
    score: new Map((score.results || []).map((r) => [key(r.email, r.course_id), Math.round(Number(r.avg))])),
  };
}

interface Filter {
  course?: string;
  path?: string;
  team?: string;
  status?: string;
  q?: string;
}

export async function reportFor(env: Env, f: Filter = {}) {
  const [asg, courses, paths, totals, pc, dir, agg] = await Promise.all([
    env.DB.prepare("SELECT id, email, kind, target_id, due_date, source, assigned_at, closed_at, closed_why FROM learn_assignments WHERE closed_why IS NULL OR closed_why = 'complete' ORDER BY assigned_at DESC").all<{ id: string; email: string; kind: 'course' | 'path'; target_id: string; due_date: string | null; source: string; assigned_at: string; closed_at: string | null; closed_why: string | null }>(),
    allCourses(env),
    allPaths(env),
    lessonTotals(env),
    pathCourseMap(env),
    staffDirectory(env),
    aggregate(env),
  ]);
  const day = today();
  const person = new Map(dir.map((p) => [p.email, p]));
  const cMap = new Map(courses.map((c) => [c.id, c]));
  const pMap = new Map(paths.map((p) => [p.id, p]));
  const rows: ReportRow[] = [];
  for (const a of asg.results || []) {
    const t = a.kind === 'course' ? cMap.get(a.target_id) : pMap.get(a.target_id);
    if (!t) continue;
    const ids = a.kind === 'course' ? [a.target_id] : (pc.get(a.target_id) || []).filter((x) => cMap.get(x)?.status === 'published');
    const total = ids.reduce((n, c) => n + (totals.get(c)?.lessons || 0), 0);
    const complete = ids.length > 0 && ids.every((c) => agg.comp.has(`${a.email}|${c}`));
    const done = complete ? total : ids.reduce((n, c) => n + Math.min(totals.get(c)?.lessons || 0, agg.done.get(`${a.email}|${c}`) || 0), 0);
    const lasts = ids.map((c) => agg.last.get(`${a.email}|${c}`)).filter((x): x is string => !!x).sort();
    const scores = ids.map((c) => agg.score.get(`${a.email}|${c}`)).filter((x): x is number => typeof x === 'number');
    const closed = a.closed_why === 'complete' || complete;
    const status: Status = closed ? 'done' : a.due_date && a.due_date < day ? 'overdue' : done > 0 || lasts.length ? 'in_progress' : 'not_started';
    const p = person.get(a.email);
    rows.push({
      assignment_id: a.id,
      email: a.email,
      name: p?.name || a.email.split('@')[0] || a.email,
      team: p?.team || '',
      kind: a.kind,
      title: t.title,
      slug: t.slug,
      href: hrefFor(a.kind, t.slug),
      due_date: a.due_date,
      status,
      pct: complete ? 100 : total ? Math.round((done / total) * 100) : 0,
      done,
      total,
      last_at: lasts.pop() || null,
      completed_at: ids.map((c) => agg.comp.get(`${a.email}|${c}`)).filter((x): x is string => !!x).sort().pop() || null,
      best_score: scores.length ? Math.round(scores.reduce((n, x) => n + x, 0) / scores.length) : null,
      assigned_at: a.assigned_at,
      source: a.source,
    });
  }
  const q = lower(f.q);
  const shown = rows.filter((r) => {
    if (f.course && r.slug !== f.course && cMap.get(f.course)?.slug !== r.slug) return false;
    if (f.path && !(r.kind === 'path' && (r.slug === f.path))) return false;
    if (f.team && lower(r.team) !== lower(f.team)) return false;
    if (f.status && r.status !== f.status) return false;
    if (q && !`${r.name} ${r.email} ${r.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const count = (s: Status) => shown.filter((r) => r.status === s).length;
  const scored = shown.map((r) => r.best_score).filter((x): x is number => typeof x === 'number');
  const byTarget = new Map<string, { title: string; kind: string; slug: string; assigned: number; done: number; overdue: number; scores: number[] }>();
  for (const r of shown) {
    const k = `${r.kind}:${r.slug}`;
    const g = byTarget.get(k) || { title: r.title, kind: r.kind, slug: r.slug, assigned: 0, done: 0, overdue: 0, scores: [] };
    g.assigned++;
    if (r.status === 'done') g.done++;
    if (r.status === 'overdue') g.overdue++;
    if (r.best_score !== null) g.scores.push(r.best_score);
    byTarget.set(k, g);
  }
  const byPerson = new Map<string, { email: string; name: string; team: string; assigned: number; done: number; overdue: number }>();
  for (const r of shown) {
    const g = byPerson.get(r.email) || { email: r.email, name: r.name, team: r.team, assigned: 0, done: 0, overdue: 0 };
    g.assigned++;
    if (r.status === 'done') g.done++;
    if (r.status === 'overdue') g.overdue++;
    byPerson.set(r.email, g);
  }
  return {
    summary: { assigned: shown.length, done: count('done'), overdue: count('overdue'), in_progress: count('in_progress'), not_started: count('not_started'), avg_score: scored.length ? Math.round(scored.reduce((n, x) => n + x, 0) / scored.length) : null },
    rows: shown,
    targets: [...byTarget.values()].map((g) => ({ title: g.title, kind: g.kind, slug: g.slug, assigned: g.assigned, done: g.done, overdue: g.overdue, avg_score: g.scores.length ? Math.round(g.scores.reduce((n, x) => n + x, 0) / g.scores.length) : null })),
    people: [...byPerson.values()].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name)),
    teams: [...new Set(dir.map((p) => p.team).filter(Boolean))].sort(),
  };
}

/* ------------------------------------------------------------------------------------------------ one person's record */

export interface LearningRecord {
  email: string;
  completed: Array<{ course: string; slug: string; completed_at: string; best_score: number | null }>;
  open: Array<{ title: string; kind: string; due_date: string | null; overdue: boolean; pct: number }>;
}

/** What a person has finished and what is still open. Evaluations reads this for the supervisor summary. */
export async function learningRecord(env: Env, email: string, opts: { since?: string } = {}): Promise<LearningRecord> {
  const me = lower(email);
  const rep = await reportFor(env, {});
  const mine = rep.rows.filter((r) => r.email === me);
  const comp = ((await env.DB.prepare('SELECT c.course_id, c.course_title, c.completed_at, k.slug FROM learn_completions c LEFT JOIN learn_courses k ON k.id = c.course_id WHERE c.email = ? ORDER BY c.completed_at DESC').bind(me).all<{ course_id: string; course_title: string; completed_at: string; slug: string | null }>()).results || []);
  const agg = await aggregate(env);
  return {
    email: me,
    completed: comp.filter((c) => !opts.since || c.completed_at >= opts.since).map((c) => ({ course: c.course_title, slug: c.slug || '', completed_at: c.completed_at, best_score: agg.score.get(`${me}|${c.course_id}`) ?? null })),
    open: mine.filter((r) => r.status !== 'done').map((r) => ({ title: r.title, kind: r.kind, due_date: r.due_date, overdue: r.status === 'overdue', pct: r.pct })),
  };
}
