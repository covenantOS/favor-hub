// A person's progress: where they stopped in a lesson, lessons done, quiz attempts, completing a course and the certificate.
// Progress is recorded only on published courses, so an author previewing a draft leaves nothing behind.
import { HttpError, nowIso, type Env } from '../http';
import { staffDirectory } from '../people';
import { supervisorOf } from '../people-dev';
import { courseByRef, lessonById, lessonsOf } from './content';
import { bad, id, lower, parseQuiz, type CourseRow, type LessonRow } from './db';
import { settleAssignments } from './assign';

export interface Completion {
  email: string;
  course_id: string;
  course_title: string;
  completed_at: string;
  cert: string;
}

export interface LessonProgress {
  lesson_id: string;
  state: 'started' | 'done';
  position: number;
  updated_at: string;
  done_at: string | null;
}

export async function progressOf(env: Env, email: string, courseId: string): Promise<Map<string, LessonProgress>> {
  const rows = ((await env.DB.prepare('SELECT lesson_id, state, position, updated_at, done_at FROM learn_progress WHERE email = ? AND course_id = ?').bind(lower(email), courseId).all<LessonProgress>()).results || []) as LessonProgress[];
  return new Map(rows.map((r) => [r.lesson_id, r]));
}

export async function completionOf(env: Env, email: string, courseId: string): Promise<Completion | null> {
  return env.DB.prepare('SELECT email, course_id, course_title, completed_at, cert FROM learn_completions WHERE email = ? AND course_id = ?').bind(lower(email), courseId).first<Completion>();
}

/** Best quiz score for each quiz lesson of a course, and how many tries it took. */
export async function bestScores(env: Env, email: string, courseId: string): Promise<Map<string, { best: number; attempts: number; passed: boolean }>> {
  const rows = ((await env.DB.prepare('SELECT lesson_id, MAX(score) AS best, COUNT(*) AS n, MAX(passed) AS passed FROM learn_attempts WHERE email = ? AND course_id = ? GROUP BY lesson_id').bind(lower(email), courseId).all<{ lesson_id: string; best: number; n: number; passed: number }>()).results || []) as Array<{ lesson_id: string; best: number; n: number; passed: number }>;
  return new Map(rows.map((r) => [r.lesson_id, { best: Number(r.best) || 0, attempts: Number(r.n) || 0, passed: !!r.passed }]));
}

async function lessonAndCourse(env: Env, lessonId: string): Promise<{ lesson: LessonRow; course: CourseRow }> {
  const lesson = await lessonById(env, lessonId);
  if (!lesson) throw new HttpError(404, 'not_found', 'That lesson is gone.');
  const course = await courseByRef(env, lesson.course_id);
  if (!course) throw new HttpError(404, 'not_found', 'That course is gone.');
  return { lesson, course };
}

export interface CourseState {
  done: number;
  total: number;
  pct: number;
  completed: { at: string; cert: string } | null;
}

export async function stateOf(env: Env, email: string, course: CourseRow, lessons?: LessonRow[]): Promise<CourseState> {
  const ls = lessons || (await lessonsOf(env, course.id));
  const prog = await progressOf(env, email, course.id);
  const done = ls.filter((l) => prog.get(l.id)?.state === 'done').length;
  const c = await completionOf(env, email, course.id);
  return { done, total: ls.length, pct: ls.length ? Math.round((done / ls.length) * 100) : 0, completed: c ? { at: c.completed_at, cert: c.cert } : null };
}

const certNumber = () => {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(b, (x) => x.toString(32).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
};

/** Writes the completion record once every lesson is done. Returns it when this call completed the course. */
async function completeIfDone(env: Env, email: string, course: CourseRow): Promise<Completion | null> {
  const lessons = await lessonsOf(env, course.id);
  if (!lessons.length) return null;
  const prog = await progressOf(env, email, course.id);
  if (!lessons.every((l) => prog.get(l.id)?.state === 'done')) return null;
  if (await completionOf(env, email, course.id)) return null;
  const rec: Completion = { email, course_id: course.id, course_title: course.title, completed_at: nowIso(), cert: certNumber() };
  const r = await env.DB.prepare('INSERT OR IGNORE INTO learn_completions (email, course_id, course_title, completed_at, cert) VALUES (?, ?, ?, ?, ?)').bind(rec.email, rec.course_id, rec.course_title, rec.completed_at, rec.cert).run();
  if (!Number((r.meta as { changes?: number }).changes)) return null;
  await settleAssignments(env, email);
  return rec;
}

export interface ProgressResult {
  lesson: { id: string; state: 'started' | 'done'; position: number };
  course: CourseState;
  /** Set when this call finished the course. */
  just_completed: boolean;
  preview?: boolean;
}

export async function setProgress(env: Env, email: string, lessonId: string, input: { state?: unknown; position?: unknown }): Promise<ProgressResult> {
  const me = lower(email);
  const { lesson, course } = await lessonAndCourse(env, lessonId);
  const want = input.state === 'done' ? 'done' : 'started';
  const position = Math.max(0, Math.min(86400, Math.round(Number(input.position) || 0)));
  if (want === 'done' && lesson.kind === 'quiz') throw bad('A quiz is finished by passing it.', 'quiz_needs_pass');
  if (course.status !== 'published') {
    return { lesson: { id: lesson.id, state: want, position }, course: { done: 0, total: 0, pct: 0, completed: null }, just_completed: false, preview: true };
  }
  const now = nowIso();
  const prev = await env.DB.prepare('SELECT state, position FROM learn_progress WHERE email = ? AND lesson_id = ?').bind(me, lesson.id).first<{ state: string; position: number }>();
  const state = prev?.state === 'done' ? 'done' : want;
  await env.DB.prepare(
    `INSERT INTO learn_progress (email, lesson_id, course_id, state, position, updated_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email, lesson_id) DO UPDATE SET state = excluded.state, position = excluded.position, updated_at = excluded.updated_at,
       done_at = COALESCE(learn_progress.done_at, excluded.done_at)`
  )
    .bind(me, lesson.id, course.id, state, want === 'started' && prev?.state === 'done' ? prev.position : position, now, state === 'done' ? now : null)
    .run();
  const rec = state === 'done' ? await completeIfDone(env, me, course) : null;
  return { lesson: { id: lesson.id, state, position }, course: await stateOf(env, me, course), just_completed: !!rec };
}

export interface QuizResult {
  score: number;
  passed: boolean;
  pass: number;
  correct: number;
  total: number;
  attempts: number;
  best: number;
  results: Array<{ id: string; correct: boolean; explain: string; answer?: number }>;
  course: CourseState;
  just_completed: boolean;
  preview?: boolean;
}

/** Grades a quiz. The right answers come back only once the person has passed; until then they see which questions missed and why. */
export async function submitQuiz(env: Env, email: string, lessonId: string, answers: Record<string, unknown>): Promise<QuizResult> {
  const me = lower(email);
  const { lesson, course } = await lessonAndCourse(env, lessonId);
  if (lesson.kind !== 'quiz') throw bad('That lesson is not a quiz.', 'not_quiz');
  const quiz = parseQuiz(lesson.body);
  if (!quiz.questions.length) throw bad('This quiz has no questions yet.', 'empty_quiz');
  const given: Record<string, number> = {};
  let correct = 0;
  const results = quiz.questions.map((q) => {
    const a = answers && typeof answers === 'object' ? Number((answers as Record<string, unknown>)[q.id]) : NaN;
    if (Number.isInteger(a)) given[q.id] = a;
    const ok = a === q.answer;
    if (ok) correct++;
    return { id: q.id, correct: ok, explain: q.explain, answer: q.answer };
  });
  if (Object.keys(given).length < quiz.questions.length) throw bad('Answer every question first.', 'unanswered');
  const score = Math.round((correct / quiz.questions.length) * 100);
  const passed = score >= quiz.pass;
  if (course.status !== 'published') {
    return { score, passed, pass: quiz.pass, correct, total: quiz.questions.length, attempts: 0, best: score, results: results.map((r) => (passed ? r : { id: r.id, correct: r.correct, explain: r.explain })), course: { done: 0, total: 0, pct: 0, completed: null }, just_completed: false, preview: true };
  }
  const now = nowIso();
  await env.DB.prepare('INSERT INTO learn_attempts (id, email, lesson_id, course_id, score, passed, answers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id('att'), me, lesson.id, course.id, score, passed ? 1 : 0, JSON.stringify(given), now).run();
  let rec: Completion | null = null;
  if (passed) {
    await env.DB.prepare(
      `INSERT INTO learn_progress (email, lesson_id, course_id, state, position, updated_at, done_at) VALUES (?, ?, ?, 'done', 0, ?, ?)
       ON CONFLICT(email, lesson_id) DO UPDATE SET state = 'done', updated_at = excluded.updated_at, done_at = COALESCE(learn_progress.done_at, excluded.done_at)`
    )
      .bind(me, lesson.id, course.id, now, now)
      .run();
    rec = await completeIfDone(env, me, course);
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO learn_progress (email, lesson_id, course_id, state, position, updated_at) VALUES (?, ?, ?, 'started', 0, ?)").bind(me, lesson.id, course.id, now).run();
  }
  const stats = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(score) AS best FROM learn_attempts WHERE email = ? AND lesson_id = ?').bind(me, lesson.id).first<{ n: number; best: number }>();
  return {
    score,
    passed,
    pass: quiz.pass,
    correct,
    total: quiz.questions.length,
    attempts: Number(stats?.n) || 1,
    best: Number(stats?.best) || score,
    results: results.map((r) => (passed ? r : { id: r.id, correct: r.correct, explain: r.explain })),
    course: await stateOf(env, me, course),
    just_completed: !!rec,
  };
}

/* ------------------------------------------------------------------------------------------------ the certificate */

export interface Certificate {
  cert: string;
  name: string;
  email: string;
  course: string;
  completed_at: string;
}

/** The certificate for one completion. Its owner reads it, and so do their supervisor, HR and hub admins. */
export async function certificateFor(env: Env, viewer: { email: string; author: boolean }, courseRef: string, ownerEmail: string): Promise<Certificate> {
  const owner = lower(ownerEmail || viewer.email);
  const course = await courseByRef(env, courseRef);
  if (!course) throw new HttpError(404, 'not_found', 'There is no course by that name.');
  const mine = owner === lower(viewer.email);
  if (!mine && !viewer.author && (await supervisorOf(env, owner)) !== lower(viewer.email)) throw new HttpError(403, 'forbidden', 'Only the person, their supervisor or HR can open this certificate.');
  const rec = await completionOf(env, owner, course.id);
  if (!rec) throw new HttpError(404, 'not_complete', mine ? 'Finish every lesson to earn the certificate.' : 'That person has not completed the course.');
  const person = (await staffDirectory(env)).find((p) => p.email === owner);
  return { cert: rec.cert, name: person?.name || owner.split('@')[0] || owner, email: owner, course: rec.course_title, completed_at: rec.completed_at };
}
