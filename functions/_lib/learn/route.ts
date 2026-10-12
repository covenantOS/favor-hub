// Learn's routes. One router so tests can call it with a stand-in database, like the request board's.
//   Everyone who may open Learn
//     GET  home                       My learning: assigned, continue, in progress, completed
//     GET  catalog                    published courses and paths with my progress
//     GET  course/:ref                a course with its lessons (quiz answers stay on the server)
//     GET  path/:ref                  a path with its courses
//     POST progress                   { lesson_id, state: started | done, position }
//     POST quiz/:lessonId             { answers: { questionId: optionIndex } } -> score, pass, what to review
//     GET  certificate/:course        ?email= for a supervisor, HR or an admin
//     GET  record                     ?email= the person's learning record (self, supervisor, HR, admin)
//     GET  search?q=                  courses and paths for Ctrl K
//     GET  notices   POST notices     my learning reminders, mark read
//   Authors (hub admins and people marked HR in Admin > People)
//     GET  admin/overview             every course and path with counts
//     GET  admin/course/:id           a course for the editor, quizzes with their answers
//     POST admin/courses              PATCH admin/course/:id   DELETE admin/course/:id
//     POST admin/course/:id/lessons   PATCH admin/lesson/:id   DELETE admin/lesson/:id   PUT admin/course/:id/order { ids }
//     POST admin/paths                PATCH admin/path/:id     DELETE admin/path/:id     (courses: [ids] sets the order)
//     POST admin/assign               { kind, target, emails | team | everyone, due_date, note }
//     DELETE admin/assignments/:id
//     GET  admin/report               ?course= &path= &team= &status= &q=
//     GET  admin/people               staff and their teams for the pickers
//     GET  admin/clips                my own clips      GET admin/drive?q=  Drive search
import { HttpError, errorJson, handleError, json, type Env } from '../http';
import type { HubUser } from '../session';
import { staffDirectory } from '../people';
import { supervisorOf } from '../people-dev';
import { driveSearch, type ChatRouteEnv } from '../chat/route';
import { actorOf, type Actor, type TaskEnv } from '../requests/tasks';
import { assignLearning, removeAssignment } from './assign';
import {
  addLesson,
  allCourses,
  allPaths,
  courseByRef,
  createCourse,
  createPath,
  lessonById,
  lessonsOf,
  lessonTotals,
  orderLessons,
  pathByRef,
  pathCourseMap,
  removeCourse,
  removeLesson,
  removePath,
  updateCourse,
  updateLesson,
  updatePath,
} from './content';
import { bad, learnMode, learnReady, standing, lower, type Standing } from './db';
import { noticesFor, readNotices } from './notices';
import { certificateFor, setProgress, submitQuiz } from './progress';
import { learningRecord, reportFor } from './report';
import { ensureSeed } from './seed';
import { catalogFor, courseFor, homeFor, pathFor, searchFor } from './views';

export interface Ctx {
  request: Request;
  env: Env;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    return handleError(err);
  }
}

const needAuthor = (st: Standing) => {
  if (!st.author) throw new HttpError(403, 'forbidden', 'Building and assigning courses is for FavorOS admins and HR.');
};

async function route(ctx: Ctx): Promise<Response> {
  const { request, path } = ctx;
  const method = request.method.toUpperCase();
  const actor = actorOf(request, ctx.user);
  if (!actor) throw new HttpError(401, 'signin', 'Sign in with your Favor Google account first.');
  const env: TaskEnv = Object.assign(Object.create(ctx.env) as TaskEnv, { DEFER: ctx.waitUntil });
  if (!(await learnReady(env))) return errorJson('not_ready', 'Learn is not switched on yet.', 503);
  const st = await standing(env, actor);
  if (!st.may) {
    const mode = await learnMode(env);
    return errorJson('forbidden', mode === 'off' ? 'Learn is switched off.' : 'Learn is open to FavorOS admins and HR for now.', 403);
  }
  await ensureSeed(env).catch((err) => console.error('[learn] seed', err));
  const url = new URL(request.url);
  const q = url.searchParams;
  const me = actor.email;
  const [a, b, c, d] = path;

  /* ---------------------------------------------------------------------------------------------- learners */
  if (a === 'home' && method === 'GET') return json({ ok: true, me: { email: me, name: actor.name, author: st.author }, ...(await homeFor(env, me)) });

  if (a === 'catalog' && method === 'GET') {
    const cat = await catalogFor(env, me);
    return json({ ok: true, courses: cat.courses, paths: cat.paths });
  }

  if (a === 'course' && b && method === 'GET') {
    const course = await courseByRef(env, b);
    if (!course || (course.status !== 'published' && !st.author)) throw new HttpError(404, 'not_found', 'There is no course by that name.');
    return json({ ok: true, preview: course.status !== 'published', course: await courseFor(env, me, course) });
  }

  if (a === 'path' && b && method === 'GET') {
    const p = await pathByRef(env, b);
    if (!p || (p.status !== 'published' && !st.author)) throw new HttpError(404, 'not_found', 'There is no learning path by that name.');
    return json({ ok: true, preview: p.status !== 'published', path: await pathFor(env, me, p) });
  }

  if (a === 'progress' && method === 'POST') {
    const input = await body(request);
    const lid = String(input.lesson_id || '');
    if (!lid) throw bad('Say which lesson.', 'missing_lesson');
    return json({ ok: true, ...(await setProgress(env, me, lid, input)) });
  }

  if (a === 'quiz' && b && method === 'POST') {
    const input = await body(request);
    return json({ ok: true, ...(await submitQuiz(env, me, b, (input.answers as Record<string, unknown>) || {})) });
  }

  if (a === 'certificate' && b && method === 'GET') {
    const cert = await certificateFor(env, { email: me, author: st.author }, b, q.get('email') || me);
    return json({ ok: true, certificate: cert });
  }

  if (a === 'record' && method === 'GET') {
    const who = lower(q.get('email') || me);
    if (who !== me && !st.author && (await supervisorOf(env, who)) !== me) throw new HttpError(403, 'forbidden', 'Only the person, their supervisor or HR can read a learning record.');
    return json({ ok: true, record: await learningRecord(env, who, { since: q.get('since') || undefined }) });
  }

  if (a === 'search' && method === 'GET') return json({ ok: true, results: await searchFor(env, q.get('q') || '') });

  if (a === 'notices') {
    if (method === 'POST') {
      const input = await body(request);
      await readNotices(env, me, { id: Number(input.id) || null });
    }
    return json({ ok: true, ...(await noticesFor(env, me)) });
  }

  /* ---------------------------------------------------------------------------------------------- authors */
  if (a !== 'admin') return errorJson('not_found', 'No such route.', 404);
  needAuthor(st);
  const rest = path.slice(1);
  const [x, y, z] = rest;
  void c;
  void d;

  if (x === 'overview' && method === 'GET') {
    const [courses, paths, totals, pc, assigned] = await Promise.all([
      allCourses(env),
      allPaths(env),
      lessonTotals(env),
      pathCourseMap(env),
      env.DB.prepare("SELECT kind, target_id, COUNT(*) AS n, SUM(CASE WHEN closed_why = 'complete' THEN 1 ELSE 0 END) AS done FROM learn_assignments WHERE closed_why IS NULL OR closed_why = 'complete' GROUP BY kind, target_id").all<{ kind: string; target_id: string; n: number; done: number }>(),
    ]);
    const as = new Map((assigned.results || []).map((r) => [`${r.kind}:${r.target_id}`, { assigned: Number(r.n) || 0, done: Number(r.done) || 0 }]));
    const completions = new Map(((await env.DB.prepare('SELECT course_id, COUNT(*) AS n FROM learn_completions GROUP BY course_id').all<{ course_id: string; n: number }>()).results || []).map((r) => [r.course_id, Number(r.n) || 0]));
    return json({
      ok: true,
      courses: courses.map((k) => ({ id: k.id, slug: k.slug, title: k.title, summary: k.summary, audience: k.audience, color: k.color, status: k.status, lessons: totals.get(k.id)?.lessons || 0, minutes: totals.get(k.id)?.minutes || 0, completions: completions.get(k.id) || 0, ...(as.get(`course:${k.id}`) || { assigned: 0, done: 0 }), updated_at: k.updated_at })),
      paths: paths.map((p) => ({ id: p.id, slug: p.slug, title: p.title, summary: p.summary, audience: p.audience, color: p.color, status: p.status, courses: pc.get(p.id) || [], ...(as.get(`path:${p.id}`) || { assigned: 0, done: 0 }), updated_at: p.updated_at })),
    });
  }

  if (x === 'people' && method === 'GET') {
    const people = await staffDirectory(env);
    return json({ ok: true, people, teams: [...new Set(people.map((p) => p.team).filter(Boolean))].sort() });
  }

  if (x === 'report' && method === 'GET') {
    return json({ ok: true, ...(await reportFor(env, { course: q.get('course') || undefined, path: q.get('path') || undefined, team: q.get('team') || undefined, status: q.get('status') || undefined, q: q.get('q') || undefined })) });
  }

  if (x === 'courses' && method === 'POST') {
    const course = await createCourse(env, me, await body(request));
    return json({ ok: true, course: await adminCourse(env, course.id) }, 201);
  }
  if (x === 'course' && y) {
    const course = await courseByRef(env, y);
    if (!course) throw new HttpError(404, 'not_found', 'There is no course by that name.');
    if (!z && method === 'GET') return json({ ok: true, course: await adminCourse(env, course.id) });
    if (!z && method === 'PATCH') {
      await updateCourse(env, me, course, await body(request));
      return json({ ok: true, course: await adminCourse(env, course.id) });
    }
    if (!z && method === 'DELETE') return json({ ok: true, result: await removeCourse(env, me, course) });
    if (z === 'lessons' && method === 'POST') {
      const lesson = await addLesson(env, me, course, await body(request));
      return json({ ok: true, lesson, course: await adminCourse(env, course.id) }, 201);
    }
    if (z === 'order' && method === 'PUT') {
      const input = await body(request);
      await orderLessons(env, me, course, Array.isArray(input.ids) ? input.ids.map(String) : []);
      return json({ ok: true, course: await adminCourse(env, course.id) });
    }
  }
  if (x === 'lesson' && y) {
    const lesson = await lessonById(env, y);
    if (!lesson) throw new HttpError(404, 'not_found', 'That lesson is gone.');
    const course = await courseByRef(env, lesson.course_id);
    if (!course) throw new HttpError(404, 'not_found', 'That course is gone.');
    if (method === 'PATCH') {
      await updateLesson(env, me, lesson, await body(request));
      return json({ ok: true, course: await adminCourse(env, course.id) });
    }
    if (method === 'DELETE') {
      await removeLesson(env, me, lesson);
      return json({ ok: true, course: await adminCourse(env, course.id) });
    }
  }

  if (x === 'paths' && method === 'POST') {
    const p = await createPath(env, me, await body(request));
    return json({ ok: true, path: p }, 201);
  }
  if (x === 'path' && y) {
    const p = await pathByRef(env, y);
    if (!p) throw new HttpError(404, 'not_found', 'There is no learning path by that name.');
    if (method === 'PATCH') return json({ ok: true, path: await updatePath(env, me, p, await body(request)) });
    if (method === 'DELETE') return json({ ok: true, result: await removePath(env, me, p) });
  }

  if (x === 'assign' && method === 'POST') {
    const input = await body(request);
    const res = await assignLearning(env, actor, {
      kind: input.kind === 'path' ? 'path' : 'course',
      target: String(input.target || ''),
      emails: Array.isArray(input.emails) ? input.emails.map(String) : undefined,
      team: input.team ? String(input.team) : undefined,
      everyone: input.everyone === true,
      due_date: (input.due_date as string | null | undefined) ?? null,
      note: String(input.note || ''),
    });
    return json({ ok: true, ...res });
  }
  if (x === 'assignments' && y && method === 'DELETE') {
    await removeAssignment(env, actor, y);
    return json({ ok: true });
  }

  if (x === 'clips' && method === 'GET') {
    // A person's clips are their own. An author lists their own here, and can paste a link someone sent them for any other.
    const s = `%${lower(q.get('q')).replace(/[%_\\]/g, '')}%`;
    const rows = await env.DB.prepare("SELECT id, title, summary, duration_ms, created_at FROM hub_clips WHERE owner_email = ? AND status IN ('ready', 'processing') AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) ORDER BY created_at DESC LIMIT 30").bind(me, s, s).all();
    return json({ ok: true, clips: rows.results || [] });
  }
  if (x === 'drive' && method === 'GET') {
    if (!ctx.user) throw new HttpError(401, 'signin', 'Sign in first.');
    return json({ ok: true, files: await driveSearch(env as unknown as ChatRouteEnv, ctx.user, q.get('q') || '') });
  }

  return errorJson('not_found', 'No such route.', 404);
}

/** A course for the editor: its fields and every lesson with the quiz as written, answers included. */
async function adminCourse(env: Env, courseId: string) {
  const course = await courseByRef(env, courseId);
  if (!course) throw new HttpError(404, 'not_found', 'There is no course by that name.');
  const lessons = await lessonsOf(env, course.id);
  const used = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM learn_assignments WHERE kind = 'course' AND target_id = ?1 AND closed_why IS NULL) AS open, (SELECT COUNT(*) FROM learn_completions WHERE course_id = ?1) AS done").bind(course.id).first<{ open: number; done: number }>();
  return {
    ...course,
    lessons: lessons.map((l) => ({ id: l.id, kind: l.kind, title: l.title, ref: l.ref, minutes: l.minutes, body: l.kind === 'quiz' ? '' : l.body, quiz: l.kind === 'quiz' ? safeQuiz(l.body) : undefined })),
    open_assignments: Number(used?.open) || 0,
    completions: Number(used?.done) || 0,
  };
}

function safeQuiz(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { pass: 80, questions: [] };
  }
}

export type { Actor };
