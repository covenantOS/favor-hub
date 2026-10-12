// What the learner sees: My learning, the catalog, a course with its lessons, a path with its courses. Quiz answers never leave here.
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { allCourses, allPaths, lessonsOf, lessonTotals, pathCoursesOf, pathCourseMap } from './content';
import { addDays, lower, publicQuiz, parseQuiz, today, videoBySlug, type CourseRow, type LessonRow, type PathRow } from './db';
import { allAssignments, hrefFor, openAssignments, settleAssignments, type AssignmentRow } from './assign';
import { bestScores, progressOf } from './progress';
import { readFor } from './notices';

export interface Card {
  kind: 'course' | 'path';
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: string;
  href: string;
  lessons: number;
  minutes: number;
  courses?: number;
  done: number;
  total: number;
  pct: number;
  state: 'new' | 'started' | 'done';
  completed_at: string | null;
  cert?: string;
  last_at: string | null;
}

interface Totals {
  lessons: number;
  minutes: number;
}

interface Mine {
  done: Map<string, number>;
  last: Map<string, string>;
  completions: Map<string, { at: string; cert: string }>;
}

async function mineOf(env: Env, email: string): Promise<Mine> {
  const me = lower(email);
  const [prog, comp] = await Promise.all([
    env.DB.prepare("SELECT course_id, SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done, MAX(updated_at) AS last FROM learn_progress WHERE email = ? GROUP BY course_id").bind(me).all<{ course_id: string; done: number; last: string }>(),
    env.DB.prepare('SELECT course_id, completed_at, cert FROM learn_completions WHERE email = ?').bind(me).all<{ course_id: string; completed_at: string; cert: string }>(),
  ]);
  return {
    done: new Map((prog.results || []).map((r) => [r.course_id, Number(r.done) || 0])),
    last: new Map((prog.results || []).map((r) => [r.course_id, r.last])),
    completions: new Map((comp.results || []).map((r) => [r.course_id, { at: r.completed_at, cert: r.cert }])),
  };
}

function courseCard(c: CourseRow, t: Totals | undefined, m: Mine): Card {
  const total = t?.lessons || 0;
  const comp = m.completions.get(c.id);
  const done = comp ? total : Math.min(total, m.done.get(c.id) || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return {
    kind: 'course',
    id: c.id,
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    audience: c.audience,
    color: c.color,
    status: c.status,
    href: hrefFor('course', c.slug),
    lessons: total,
    minutes: t?.minutes || 0,
    done,
    total,
    pct,
    state: comp ? 'done' : done > 0 || m.last.has(c.id) ? 'started' : 'new',
    completed_at: comp?.at || null,
    cert: comp?.cert,
    last_at: m.last.get(c.id) || null,
  };
}

function pathCard(p: PathRow, ids: string[], cards: Map<string, Card>): Card {
  const mine = ids.map((x) => cards.get(x)).filter((x): x is Card => !!x);
  const total = mine.reduce((n, c) => n + c.total, 0);
  const done = mine.reduce((n, c) => n + c.done, 0);
  const allDone = mine.length > 0 && mine.every((c) => c.state === 'done');
  const last = mine.map((c) => c.last_at).filter(Boolean).sort().pop() || null;
  return {
    kind: 'path',
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    audience: p.audience,
    color: p.color,
    status: p.status,
    href: hrefFor('path', p.slug),
    lessons: total,
    minutes: mine.reduce((n, c) => n + c.minutes, 0),
    courses: mine.length,
    done,
    total,
    pct: allDone ? 100 : total ? Math.round((done / total) * 100) : 0,
    state: allDone ? 'done' : done > 0 || last ? 'started' : 'new',
    completed_at: allDone ? mine.map((c) => c.completed_at).filter(Boolean).sort().pop() || null : null,
    last_at: last,
  };
}

/** Every published course as a card with this person's progress, and the same for paths. */
export async function catalogFor(env: Env, email: string) {
  const [courses, paths, totals, m, pc] = await Promise.all([allCourses(env), allPaths(env), lessonTotals(env), mineOf(env, email), pathCourseMap(env)]);
  const live = courses.filter((c) => c.status === 'published' && (totals.get(c.id)?.lessons || 0) > 0);
  const cards = new Map(live.map((c) => [c.id, courseCard(c, totals.get(c.id), m)]));
  const pathCards = paths.filter((p) => p.status === 'published').map((p) => pathCard(p, pc.get(p.id) || [], cards)).filter((p) => (p.courses || 0) > 0);
  return { cards, courses: [...cards.values()], paths: pathCards, pathCourses: pc };
}

/** The first lesson not done in a course, in order. */
async function nextLesson(env: Env, email: string, course: CourseRow): Promise<{ id: string; title: string; kind: string } | null> {
  const [ls, prog] = await Promise.all([lessonsOf(env, course.id), progressOf(env, email, course.id)]);
  const n = ls.find((l) => prog.get(l.id)?.state !== 'done');
  return n ? { id: n.id, title: n.title, kind: n.kind } : null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

export interface AssignedOut extends Card {
  assignment_id: string;
  due_date: string | null;
  overdue: boolean;
  days_left: number | null;
  note: string;
  assigned_by: string;
  assigned_at: string;
  next: { id: string; title: string; kind: string } | null;
  parts?: Array<{ slug: string; title: string; pct: number; state: string }>;
}

async function nameOfMap(env: Env): Promise<Map<string, string>> {
  return new Map((await staffDirectory(env)).map((p) => [p.email, p.name]));
}

/** My learning: what is assigned (soonest due first), where to continue, what is in progress, what is finished. */
export async function homeFor(env: Env, email: string) {
  const me = lower(email);
  await settleAssignments(env, me).catch(() => 0);
  const [cat, open, names, all] = await Promise.all([catalogFor(env, me), openAssignments(env, me), nameOfMap(env), allAssignments(env, me)]);
  const day = today();
  const assigned: AssignedOut[] = [];
  for (const a of open) {
    const card = a.kind === 'path' ? cat.paths.find((p) => p.id === a.target_id) : cat.cards.get(a.target_id);
    if (!card) continue;
    let next: AssignedOut['next'] = null;
    let parts: AssignedOut['parts'];
    if (a.kind === 'course') {
      const c = (await allCourses(env)).find((x) => x.id === a.target_id);
      next = c ? await nextLesson(env, me, c) : null;
    } else {
      const ids = cat.pathCourses.get(a.target_id) || [];
      parts = ids.map((x) => cat.cards.get(x)).filter((x): x is Card => !!x).map((c) => ({ slug: c.slug, title: c.title, pct: c.pct, state: c.state }));
      const first = ids.map((x) => cat.cards.get(x)).find((c) => c && c.state !== 'done');
      if (first) {
        const c = (await allCourses(env)).find((x) => x.id === first.id);
        next = c ? await nextLesson(env, me, c) : null;
      }
    }
    assigned.push({
      ...card,
      assignment_id: a.id,
      due_date: a.due_date,
      overdue: !!a.due_date && a.due_date < day,
      days_left: a.due_date ? daysBetween(day, a.due_date) : null,
      note: a.note,
      assigned_by: names.get(a.assigned_by) || '',
      assigned_at: a.assigned_at,
      next,
      parts,
    });
  }
  await readFor(env, me, open.map((a) => a.id)).catch(() => undefined);
  const assignedCourseIds = new Set(open.filter((a) => a.kind === 'course').map((a) => a.target_id));
  const inProgress = cat.courses.filter((c) => c.state === 'started' && !assignedCourseIds.has(c.id)).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
  const completed = cat.courses.filter((c) => c.state === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const touched = [...assigned.filter((a) => a.state === 'started'), ...inProgress].sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)))[0] || null;
  const doneAssignments = all.filter((a) => a.closed_why === 'complete').length;
  return {
    assigned,
    continue: touched ? { kind: touched.kind, title: touched.title, href: touched.href, pct: touched.pct, slug: touched.slug } : null,
    in_progress: inProgress,
    completed,
    stats: { assigned: assigned.length, overdue: assigned.filter((a) => a.overdue).length, due_soon: assigned.filter((a) => a.due_date && !a.overdue && (a.days_left ?? 99) <= 7).length, completed: completed.length, assignments_done: doneAssignments },
  };
}

/* ------------------------------------------------------------------------------------------------ a course */

export interface LessonOut {
  id: string;
  kind: string;
  title: string;
  ref: string;
  minutes: number;
  /** A written page's text. */
  body: string;
  quiz?: { pass: number; questions: Array<{ id: string; kind: string; text: string; options: string[] }> };
  state: 'new' | 'started' | 'done';
  position: number;
  best?: number;
  attempts?: number;
  seconds?: number;
  cut?: string;
  captions?: boolean;
}

export function lessonOut(l: LessonRow, prog: Awaited<ReturnType<typeof progressOf>>, best: Awaited<ReturnType<typeof bestScores>>, author = false): LessonOut {
  const p = prog.get(l.id);
  const out: LessonOut = {
    id: l.id,
    kind: l.kind,
    title: l.title,
    ref: l.ref,
    minutes: l.minutes,
    body: l.kind === 'page' ? l.body : '',
    state: p?.state === 'done' ? 'done' : p ? 'started' : 'new',
    position: p?.position || 0,
  };
  if (l.kind === 'quiz') {
    const q = parseQuiz(l.body);
    out.quiz = publicQuiz(q);
    const b = best.get(l.id);
    if (b) {
      out.best = b.best;
      out.attempts = b.attempts;
    }
    if (author) (out as LessonOut & { key?: unknown }).key = q;
  }
  if (l.kind === 'video') {
    const v = videoBySlug(l.ref);
    if (v) {
      out.seconds = v.seconds;
      out.cut = v.cut;
      out.captions = true;
    }
  }
  return out;
}

export async function courseFor(env: Env, email: string, course: CourseRow, opts: { author?: boolean } = {}) {
  const me = lower(email);
  const [lessons, prog, best, mine, open, pc, paths] = await Promise.all([
    lessonsOf(env, course.id),
    progressOf(env, me, course.id),
    bestScores(env, me, course.id),
    mineOf(env, me),
    openAssignments(env, me),
    pathCourseMap(env),
    allPaths(env),
  ]);
  const t = { lessons: lessons.length, minutes: lessons.reduce((n, l) => n + l.minutes, 0) };
  const card = courseCard(course, t, mine);
  const out = lessons.map((l) => lessonOut(l, prog, best, !!opts.author));
  const next = out.find((l) => l.state !== 'done') || null;
  // The lesson to resume: the one last touched and not done, else the first not done.
  const resume = lessons.filter((l) => prog.get(l.id) && prog.get(l.id)!.state !== 'done').sort((a, b) => String(prog.get(b.id)!.updated_at).localeCompare(String(prog.get(a.id)!.updated_at)))[0];
  const a = open.find((x) => x.kind === 'course' && x.target_id === course.id) || null;
  const inPaths = paths.filter((p) => p.status === 'published' && (pc.get(p.id) || []).includes(course.id)).map((p) => ({ slug: p.slug, title: p.title }));
  const names = a ? await nameOfMap(env) : new Map<string, string>();
  return {
    ...card,
    lesson_list: out,
    next_id: (resume || next) ? (resume?.id || next?.id || null) : null,
    assignment: a ? { id: a.id, due_date: a.due_date, overdue: !!a.due_date && a.due_date < today(), note: a.note, assigned_by: names.get(a.assigned_by) || '' } : null,
    paths: inPaths,
  };
}

/** A path with its courses in order, each as a card with this person's progress. */
export async function pathFor(env: Env, email: string, path: PathRow) {
  const me = lower(email);
  const cat = await catalogFor(env, me);
  const ids = await pathCoursesOf(env, path.id);
  const cards = ids.map((x) => cat.cards.get(x)).filter((x): x is Card => !!x);
  const card = pathCard(path, ids, cat.cards);
  const open = (await openAssignments(env, me)).find((a) => a.kind === 'path' && a.target_id === path.id) || null;
  const names = open ? await nameOfMap(env) : new Map<string, string>();
  const firstOpen = cards.find((c) => c.state !== 'done') || null;
  return {
    ...card,
    course_list: cards,
    next_course: firstOpen ? { slug: firstOpen.slug, title: firstOpen.title, href: firstOpen.href } : null,
    assignment: open ? { id: open.id, due_date: open.due_date, overdue: !!open.due_date && open.due_date < today(), note: open.note, assigned_by: names.get(open.assigned_by) || '' } : null,
  };
}

/** Ctrl K: published courses and paths whose title, summary, audience or lesson titles hold the words. */
export async function searchFor(env: Env, q: string): Promise<Array<{ title: string; desc: string; href: string }>> {
  const needle = String(q || '').trim().toLowerCase().slice(0, 60);
  if (needle.length < 2) return [];
  const [courses, paths, totals, lessonRows] = await Promise.all([
    allCourses(env),
    allPaths(env),
    lessonTotals(env),
    env.DB.prepare('SELECT course_id, title FROM learn_lessons').all<{ course_id: string; title: string }>(),
  ]);
  const titles = new Map<string, string>();
  for (const r of lessonRows.results || []) titles.set(r.course_id, (titles.get(r.course_id) || '') + ' ' + r.title);
  const out: Array<{ title: string; desc: string; href: string; rank: number }> = [];
  for (const c of courses) {
    if (c.status !== 'published' || !totals.get(c.id)?.lessons) continue;
    const head = `${c.title} ${c.summary} ${c.audience}`.toLowerCase();
    const inLessons = (titles.get(c.id) || '').toLowerCase().includes(needle);
    if (!head.includes(needle) && !inLessons) continue;
    out.push({ title: c.title, desc: `Course, ${totals.get(c.id)!.lessons} lessons${c.audience ? ', ' + c.audience : ''}`, href: hrefFor('course', c.slug), rank: c.title.toLowerCase().includes(needle) ? 0 : 1 });
  }
  const pc = await pathCourseMap(env);
  for (const p of paths) {
    if (p.status !== 'published' || !(pc.get(p.id) || []).length) continue;
    if (!`${p.title} ${p.summary} ${p.audience}`.toLowerCase().includes(needle)) continue;
    out.push({ title: p.title, desc: `Learning path, ${(pc.get(p.id) || []).length} courses`, href: hrefFor('path', p.slug), rank: p.title.toLowerCase().includes(needle) ? 0 : 1 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).slice(0, 6).map(({ title, desc, href }) => ({ title, desc, href }));
}

/** The assignments Today and the menu badge count: open ones for a person. */
export async function badgeFor(env: Env, email: string): Promise<{ open: number; overdue: number; due_soon: number; next: { title: string; due_date: string | null; href: string } | null }> {
  const open = await openAssignments(env, email);
  const day = today();
  const soon = addDays(day, 7);
  const rows = await Promise.all(
    open.map(async (a: AssignmentRow) => {
      const t = await env.DB.prepare(a.kind === 'path' ? 'SELECT title, slug FROM learn_paths WHERE id = ?' : 'SELECT title, slug FROM learn_courses WHERE id = ?').bind(a.target_id).first<{ title: string; slug: string }>();
      return t ? { a, t } : null;
    })
  );
  const live = rows.filter((x): x is { a: AssignmentRow; t: { title: string; slug: string } } => !!x);
  const first = live[0];
  return {
    open: live.length,
    overdue: live.filter((x) => x.a.due_date && x.a.due_date < day).length,
    due_soon: live.filter((x) => x.a.due_date && x.a.due_date >= day && x.a.due_date <= soon).length,
    next: first ? { title: first.t.title, due_date: first.a.due_date, href: hrefFor(first.a.kind, first.t.slug) } : null,
  };
}
