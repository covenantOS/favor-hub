// Learn authoring: courses, lessons and paths. Everything an author changes goes through here; the learner's views are in views.ts.
import { nowIso, type Env } from '../http';
import {
  COLORS,
  STATUSES,
  bad,
  cleanLesson,
  id,
  lower,
  uniqueSlug,
  type CourseRow,
  type LessonRow,
  type PathRow,
} from './db';

const COURSE_COLS = 'id, slug, title, summary, audience, color, status, seed_key, created_by, created_at, updated_by, updated_at';
const LESSON_COLS = 'id, course_id, sort, kind, title, ref, body, minutes, created_at, updated_at';

/* ------------------------------------------------------------------------------------------------ reads */

export async function courseByRef(env: Env, ref: string): Promise<CourseRow | null> {
  return env.DB.prepare(`SELECT ${COURSE_COLS} FROM learn_courses WHERE id = ?1 OR slug = ?1`).bind(ref).first<CourseRow>();
}

export async function pathByRef(env: Env, ref: string): Promise<PathRow | null> {
  return env.DB.prepare(`SELECT ${COURSE_COLS} FROM learn_paths WHERE id = ?1 OR slug = ?1`).bind(ref).first<PathRow>();
}

export async function lessonsOf(env: Env, courseId: string): Promise<LessonRow[]> {
  return ((await env.DB.prepare(`SELECT ${LESSON_COLS} FROM learn_lessons WHERE course_id = ? AND kind <> 'video' AND NOT (kind = 'article' AND ref = 'blackbaud-videos') ORDER BY sort, created_at, id`).bind(courseId).all<LessonRow>()).results || []) as LessonRow[];
}

export async function lessonById(env: Env, lessonId: string): Promise<LessonRow | null> {
  return env.DB.prepare(`SELECT ${LESSON_COLS} FROM learn_lessons WHERE id = ?`).bind(lessonId).first<LessonRow>();
}

export async function allCourses(env: Env): Promise<CourseRow[]> {
  return ((await env.DB.prepare(`SELECT ${COURSE_COLS} FROM learn_courses ORDER BY title COLLATE NOCASE`).all<CourseRow>()).results || []) as CourseRow[];
}

export async function allPaths(env: Env): Promise<PathRow[]> {
  return ((await env.DB.prepare(`SELECT ${COURSE_COLS} FROM learn_paths ORDER BY title COLLATE NOCASE`).all<PathRow>()).results || []) as PathRow[];
}

/** Courses of every path: path id to course ids in order. */
export async function pathCourseMap(env: Env): Promise<Map<string, string[]>> {
  const rows = ((await env.DB.prepare('SELECT path_id, course_id FROM learn_path_courses ORDER BY path_id, sort, course_id').all<{ path_id: string; course_id: string }>()).results || []) as Array<{ path_id: string; course_id: string }>;
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.path_id) || [];
    list.push(r.course_id);
    out.set(r.path_id, list);
  }
  return out;
}

export async function pathCoursesOf(env: Env, pathId: string): Promise<string[]> {
  return ((await env.DB.prepare('SELECT course_id FROM learn_path_courses WHERE path_id = ? ORDER BY sort, course_id').bind(pathId).all<{ course_id: string }>()).results || []).map((r) => (r as { course_id: string }).course_id);
}

/** Number of lessons and minutes for every course. */
export async function lessonTotals(env: Env): Promise<Map<string, { lessons: number; minutes: number }>> {
  const rows = ((await env.DB.prepare('SELECT course_id, COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM learn_lessons GROUP BY course_id').all<{ course_id: string; n: number; m: number }>()).results || []) as Array<{ course_id: string; n: number; m: number }>;
  return new Map(rows.map((r) => [r.course_id, { lessons: Number(r.n) || 0, minutes: Number(r.m) || 0 }]));
}

/* ------------------------------------------------------------------------------------------------ courses */

interface CourseInput {
  title?: unknown;
  summary?: unknown;
  audience?: unknown;
  color?: unknown;
  status?: unknown;
}

function cleanMeta(input: CourseInput, prev?: { title: string; summary: string; audience: string; color: string; status: string }) {
  const title = String(input.title ?? prev?.title ?? '').trim().slice(0, 120);
  if (!title) throw bad('Name the course.', 'missing_title');
  const color = String(input.color ?? prev?.color ?? 'leaf');
  const status = String(input.status ?? prev?.status ?? 'draft');
  if (!(STATUSES as readonly string[]).includes(status)) throw bad('Status is draft, published or archived.', 'bad_status');
  return {
    title,
    summary: String(input.summary ?? prev?.summary ?? '').trim().slice(0, 400),
    audience: String(input.audience ?? prev?.audience ?? '').trim().slice(0, 80),
    color: COLORS.includes(color) ? color : 'leaf',
    status,
  };
}

export async function createCourse(env: Env, by: string, input: CourseInput): Promise<CourseRow> {
  const m = cleanMeta(input);
  const now = nowIso();
  const row: CourseRow = { id: id('crs'), slug: await uniqueSlug(env, 'learn_courses', m.title), ...m, seed_key: null, created_by: lower(by), created_at: now, updated_by: lower(by), updated_at: now };
  await env.DB.prepare(`INSERT INTO learn_courses (${COURSE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.slug, row.title, row.summary, row.audience, row.color, row.status, null, row.created_by, row.created_at, row.updated_by, row.updated_at)
    .run();
  return row;
}

export async function updateCourse(env: Env, by: string, course: CourseRow, input: CourseInput): Promise<CourseRow> {
  const m = cleanMeta(input, course);
  if (m.status === 'published' && course.status !== 'published') {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM learn_lessons WHERE course_id = ?').bind(course.id).first<{ n: number }>();
    if (!Number(n?.n)) throw bad('Add a lesson before you publish the course.', 'empty_course');
  }
  const now = nowIso();
  await env.DB.prepare('UPDATE learn_courses SET title = ?, summary = ?, audience = ?, color = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(m.title, m.summary, m.audience, m.color, m.status, lower(by), now, course.id)
    .run();
  return { ...course, ...m, updated_by: lower(by), updated_at: now };
}

/** A course nobody has started can be removed; one with records is archived so the records stay readable. */
export async function removeCourse(env: Env, by: string, course: CourseRow): Promise<'deleted' | 'archived'> {
  const used = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM learn_progress WHERE course_id = ?1) + (SELECT COUNT(*) FROM learn_completions WHERE course_id = ?1) + (SELECT COUNT(*) FROM learn_assignments WHERE kind = 'course' AND target_id = ?1) AS n`
  )
    .bind(course.id)
    .first<{ n: number }>();
  if (Number(used?.n)) {
    await updateCourse(env, by, course, { status: 'archived' });
    return 'archived';
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM learn_lessons WHERE course_id = ?').bind(course.id),
    env.DB.prepare('DELETE FROM learn_path_courses WHERE course_id = ?').bind(course.id),
    env.DB.prepare('DELETE FROM learn_courses WHERE id = ?').bind(course.id),
  ]);
  return 'deleted';
}

/* ------------------------------------------------------------------------------------------------ lessons */

const nextSort = async (env: Env, courseId: string): Promise<number> => {
  const r = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM learn_lessons WHERE course_id = ?').bind(courseId).first<{ m: number }>();
  return (Number(r?.m) || 0) + 10;
};

export async function addLesson(env: Env, by: string, course: CourseRow, input: Record<string, unknown>): Promise<LessonRow> {
  const clean = await cleanLesson(env, input);
  const now = nowIso();
  const lesson: LessonRow = { id: id('les'), course_id: course.id, sort: await nextSort(env, course.id), ...clean, created_at: now, updated_at: now };
  await env.DB.prepare(`INSERT INTO learn_lessons (${'id, course_id, sort, kind, title, ref, body, minutes, created_at, updated_at'}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(lesson.id, lesson.course_id, lesson.sort, lesson.kind, lesson.title, lesson.ref, lesson.body, lesson.minutes, now, now)
    .run();
  await touchCourse(env, course.id, by);
  return lesson;
}

export async function updateLesson(env: Env, by: string, lesson: LessonRow, input: Record<string, unknown>): Promise<LessonRow> {
  const clean = await cleanLesson(env, { ...input, kind: lesson.kind }, lesson);
  const now = nowIso();
  await env.DB.prepare('UPDATE learn_lessons SET title = ?, ref = ?, body = ?, minutes = ?, updated_at = ? WHERE id = ?').bind(clean.title, clean.ref, clean.body, clean.minutes, now, lesson.id).run();
  await touchCourse(env, lesson.course_id, by);
  return { ...lesson, ...clean, updated_at: now };
}

/** Removes a lesson. The progress people made on it goes with it, and a course they now finish is completed on their next visit. */
export async function removeLesson(env: Env, by: string, lesson: LessonRow): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM learn_lessons WHERE id = ?').bind(lesson.id),
    env.DB.prepare('DELETE FROM learn_progress WHERE lesson_id = ?').bind(lesson.id),
  ]);
  await touchCourse(env, lesson.course_id, by);
}

/** Puts the lessons in the order given (the editor's drag). Lessons not named keep their place after the named ones. */
export async function orderLessons(env: Env, by: string, course: CourseRow, ids: string[]): Promise<LessonRow[]> {
  const have = await lessonsOf(env, course.id);
  const known = new Set(have.map((l) => l.id));
  const first = ids.filter((x, i) => known.has(x) && ids.indexOf(x) === i);
  const rest = have.map((l) => l.id).filter((x) => !first.includes(x));
  const order = [...first, ...rest];
  await env.DB.batch(order.map((lid, i) => env.DB.prepare('UPDATE learn_lessons SET sort = ? WHERE id = ?').bind((i + 1) * 10, lid)));
  await touchCourse(env, course.id, by);
  return lessonsOf(env, course.id);
}

async function touchCourse(env: Env, courseId: string, by: string) {
  await env.DB.prepare('UPDATE learn_courses SET updated_by = ?, updated_at = ? WHERE id = ?').bind(lower(by), nowIso(), courseId).run();
}

/* ------------------------------------------------------------------------------------------------ paths */

export async function createPath(env: Env, by: string, input: CourseInput & { courses?: unknown }): Promise<PathRow> {
  const m = cleanMeta(input);
  const now = nowIso();
  const row: PathRow = { id: id('pth'), slug: await uniqueSlug(env, 'learn_paths', m.title), ...m, seed_key: null, created_by: lower(by), created_at: now, updated_by: lower(by), updated_at: now };
  await env.DB.prepare(`INSERT INTO learn_paths (${COURSE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.slug, row.title, row.summary, row.audience, row.color, row.status, null, row.created_by, row.created_at, row.updated_by, row.updated_at)
    .run();
  if (Array.isArray(input.courses)) await setPathCourses(env, row.id, input.courses.map(String));
  return row;
}

export async function updatePath(env: Env, by: string, path: PathRow, input: CourseInput & { courses?: unknown }): Promise<PathRow> {
  const m = cleanMeta(input, path);
  if (m.status === 'published' && path.status !== 'published' && !Array.isArray(input.courses)) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM learn_path_courses WHERE path_id = ?').bind(path.id).first<{ n: number }>();
    if (!Number(n?.n)) throw bad('Add a course before you publish the path.', 'empty_path');
  }
  const now = nowIso();
  await env.DB.prepare('UPDATE learn_paths SET title = ?, summary = ?, audience = ?, color = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(m.title, m.summary, m.audience, m.color, m.status, lower(by), now, path.id)
    .run();
  if (Array.isArray(input.courses)) await setPathCourses(env, path.id, input.courses.map(String));
  return { ...path, ...m, updated_by: lower(by), updated_at: now };
}

export async function setPathCourses(env: Env, pathId: string, ids: string[]): Promise<void> {
  const known = new Set(((await env.DB.prepare('SELECT id FROM learn_courses').all<{ id: string }>()).results || []).map((r) => (r as { id: string }).id));
  const list = ids.filter((x, i) => known.has(x) && ids.indexOf(x) === i);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM learn_path_courses WHERE path_id = ?').bind(pathId),
    ...list.map((cid, i) => env.DB.prepare('INSERT INTO learn_path_courses (path_id, course_id, sort) VALUES (?, ?, ?)').bind(pathId, cid, (i + 1) * 10)),
  ]);
}

export async function removePath(env: Env, by: string, path: PathRow): Promise<'deleted' | 'archived'> {
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM learn_assignments WHERE kind = 'path' AND target_id = ?").bind(path.id).first<{ n: number }>();
  if (Number(used?.n)) {
    await updatePath(env, by, path, { status: 'archived' });
    return 'archived';
  }
  await env.DB.batch([env.DB.prepare('DELETE FROM learn_path_courses WHERE path_id = ?').bind(path.id), env.DB.prepare('DELETE FROM learn_paths WHERE id = ?').bind(path.id)]);
  return 'deleted';
}
