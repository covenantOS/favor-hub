// Learn: shared types, who may use it, and small database helpers. Everything here reads the tables in db/learn.sql.
// Who may do what:
//   a staff member   takes published courses, sees their own progress, scores and certificates
//   an author        a hub admin or a person marked HR in Admin > People: builds courses and paths, assigns them, reads every record
// Learn is switched by the hub setting learn.enabled (admins, staff or off). Until db/learn.sql is applied every route answers
// not_ready and the menu entry stays hidden.
import { HttpError, newId, type Env } from '../http';
import { featureMode, groupMembers, type AccessMode } from '../access';
import { isHr } from '../people-dev';
import type { Actor } from '../requests/tasks';
import videos from '../../../src/data/videos.json' with { type: 'json' };

export type LearnMode = AccessMode;
export type LessonKind = 'video' | 'article' | 'doc' | 'page' | 'clip' | 'link' | 'quiz';
export const LESSON_KINDS: LessonKind[] = ['video', 'article', 'doc', 'page', 'clip', 'link', 'quiz'];
export const COLORS = ['leaf', 'teal', 'sky', 'sun', 'dusk', 'terra', 'slate'];
export const STATUSES = ['draft', 'published', 'archived'] as const;
export const ET = 'America/New_York';

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: string;
  seed_key: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export interface LessonRow {
  id: string;
  course_id: string;
  sort: number;
  kind: LessonKind;
  title: string;
  ref: string;
  body: string;
  minutes: number;
  created_at: string;
  updated_at: string;
}

export interface PathRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  color: string;
  status: string;
  seed_key: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  kind: 'choice' | 'tf';
  text: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Quiz {
  pass: number;
  questions: QuizQuestion[];
}

export const lower = (s: unknown) => String(s || '').trim().toLowerCase();
export const FAVOR = /^[a-z0-9._%+-]+@favorintl\.org$/;
export const id = (prefix: string) => newId(prefix);
export const today = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: ET });
export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export const bad = (message: string, code = 'bad_request', status = 400) => new HttpError(status, code, message);

export async function learnMode(env: Env): Promise<LearnMode> {
  return featureMode(env, 'learn');
}

/** False until db/learn.sql is applied. */
export async function learnReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM learn_courses LIMIT 1').first();
    return true;
  } catch {
    return false;
  }
}

/** An admin or a person marked HR. The agent key standing in for a staff member (X-Act-As) is never one. */
export async function isAuthor(env: Env, actor: Pick<Actor, 'email' | 'admin'>): Promise<boolean> {
  if (actor.admin) return true;
  return isHr(env, actor.email);
}

export async function hasAssignment(env: Env, email: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 AS ok FROM learn_assignments WHERE email = ? LIMIT 1').bind(lower(email)).first().catch(() => null);
  return !!r;
}

export interface Standing {
  author: boolean;
  mode: LearnMode;
  /** May open Learn at all. */
  may: boolean;
}

export async function standing(env: Env, actor: Actor): Promise<Standing> {
  const [mode, author] = await Promise.all([learnMode(env), isAuthor(env, actor)]);
  // A person who was given a course reaches it from Today even while the menu entry is for admins and HR only.
  const given = mode === 'admins' && !author ? await hasAssignment(env, actor.email) : false;
  // Group mode (learn.access): admins and the named people and teams. Everyone else has no Learn, assigned courses included.
  const inGroup = mode === 'group' ? actor.admin || (await groupMembers(env, 'learn')).has(lower(actor.email)) : false;
  const may = mode === 'off' ? false : mode === 'staff' ? true : mode === 'group' ? inGroup : author || given;
  return { author: mode === 'group' && !inGroup ? false : author, mode, may };
}

export function slugify(s: string): string {
  const base = String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'course';
}

export async function uniqueSlug(env: Env, table: 'learn_courses' | 'learn_paths', title: string, ownId = ''): Promise<string> {
  const base = slugify(title);
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const hit = await env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(slug).first<{ id: string }>();
    if (!hit || hit.id === ownId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------------------------------------ the help library */

export interface HelpVideo {
  slug: string;
  title: string;
  summary: string;
  seconds: number;
  topic: string;
  roles: string[];
  cut?: string;
}

const LIB = videos as unknown as HelpVideo[];
export const helpVideos = () => LIB;
export const videoBySlug = (slug: string) => LIB.find((v) => v.slug === slug) || null;

/* ------------------------------------------------------------------------------------------------ quizzes */

export function parseQuiz(body: string): Quiz {
  try {
    const q = JSON.parse(body || '{}') as Partial<Quiz>;
    return {
      pass: Math.min(100, Math.max(1, Math.round(Number(q.pass) || 80))),
      questions: Array.isArray(q.questions) ? (q.questions as QuizQuestion[]) : [],
    };
  } catch {
    return { pass: 80, questions: [] };
  }
}

/** Checks a quiz an author wrote and returns the cleaned JSON. Throws a plain message the editor shows. */
export function cleanQuiz(raw: unknown): Quiz {
  const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(q.questions) ? q.questions : [];
  if (!list.length) throw bad('Add at least one question.');
  if (list.length > 40) throw bad('A quiz can hold up to 40 questions.');
  const questions: QuizQuestion[] = list.map((x, i) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const kind = r.kind === 'tf' ? 'tf' : 'choice';
    const text = String(r.text || '').trim().slice(0, 400);
    if (!text) throw bad(`Question ${i + 1} needs its text.`);
    let options = kind === 'tf' ? ['True', 'False'] : (Array.isArray(r.options) ? r.options : []).map((o) => String(o || '').trim().slice(0, 240)).filter(Boolean);
    if (kind === 'choice' && (options.length < 2 || options.length > 6)) throw bad(`Question ${i + 1} needs two to six answers.`);
    options = options.slice(0, 6);
    const answer = Number(r.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw bad(`Question ${i + 1} needs its right answer marked.`);
    return { id: String(r.id || `q${i + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || `q${i + 1}`, kind, text, options, answer, explain: String(r.explain || '').trim().slice(0, 500) };
  });
  const ids = new Set(questions.map((x) => x.id));
  if (ids.size !== questions.length) questions.forEach((x, i) => (x.id = `q${i + 1}`));
  const pass = Math.min(100, Math.max(1, Math.round(Number(q.pass) || 80)));
  return { pass, questions };
}

/** The quiz as a learner may see it: no answers and no explanations. */
export function publicQuiz(quiz: Quiz) {
  return { pass: quiz.pass, questions: quiz.questions.map((x) => ({ id: x.id, kind: x.kind, text: x.text, options: x.options })) };
}

/* ------------------------------------------------------------------------------------------------ lesson input */

const HTTPS = /^https:\/\/[^\s]+$/i;
const DRIVE = /^https:\/\/(docs|drive)\.google\.com\/[^\s]+$/i;
const CLIP_ID = /^[A-Za-z0-9_-]{6,60}$/;

export function minutesFor(kind: LessonKind, ref: string, body: string): number {
  if (kind === 'video') return Math.max(1, Math.round((videoBySlug(ref)?.seconds || 120) / 60));
  if (kind === 'page') return Math.max(1, Math.round(body.trim().split(/\s+/).length / 180));
  if (kind === 'quiz') return Math.max(1, Math.round(parseQuiz(body).questions.length * 0.5));
  if (kind === 'article') return 4;
  if (kind === 'doc') return 6;
  return 5;
}

export interface LessonInput {
  kind: LessonKind;
  title: string;
  ref: string;
  body: string;
  minutes: number;
}

/** Validates one lesson from the editor. The reference must fit the kind, so a lesson never points at nothing. */
export async function cleanLesson(env: Env, input: Record<string, unknown>, prev?: LessonRow): Promise<LessonInput> {
  const kind = (String(input.kind || prev?.kind || '') as LessonKind);
  if (!LESSON_KINDS.includes(kind)) throw bad('Pick what kind of lesson this is.', 'bad_kind');
  let ref = String(input.ref ?? prev?.ref ?? '').trim();
  let body = String(input.body ?? prev?.body ?? '');
  let title = String(input.title ?? prev?.title ?? '').trim().slice(0, 160);
  if (kind === 'video') {
    const v = videoBySlug(ref);
    if (!v) throw bad('That video is not in the help library.', 'bad_ref');
    title = title || v.title;
    body = '';
  } else if (kind === 'article') {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(ref)) throw bad('Pick a help article.', 'bad_ref');
    if (!title) throw bad('Name the lesson.');
    body = '';
  } else if (kind === 'doc') {
    if (!DRIVE.test(ref)) throw bad('Paste the address of a Google Doc, Sheet, Slides file or a Drive file.', 'bad_ref');
    if (!title) throw bad('Name the lesson.');
    body = '';
  } else if (kind === 'link') {
    if (!HTTPS.test(ref)) throw bad('Paste a web address that starts with https://.', 'bad_ref');
    if (!title) throw bad('Name the lesson.');
    body = '';
  } else if (kind === 'clip') {
    if (!CLIP_ID.test(ref)) throw bad('Pick a clip.', 'bad_ref');
    const clip = await env.DB.prepare("SELECT title, duration_ms FROM hub_clips WHERE id = ? AND status IN ('ready', 'processing')").bind(ref).first<{ title: string; duration_ms: number }>().catch(() => null);
    if (!clip && !prev) throw bad('That clip is not saved yet.', 'bad_ref');
    title = title || clip?.title || 'Clip';
    body = '';
  } else if (kind === 'page') {
    ref = '';
    body = body.trim().slice(0, 20000);
    if (!title) throw bad('Name the page.');
    if (!body) throw bad('Write the page.');
  } else if (kind === 'quiz') {
    ref = '';
    let raw: unknown = input.quiz;
    if (raw === undefined) {
      try {
        raw = JSON.parse(body);
      } catch {
        raw = null;
      }
    }
    body = JSON.stringify(cleanQuiz(raw));
    title = title || 'Quiz';
  }
  const asked = Number(input.minutes);
  const minutes = Number.isFinite(asked) && asked > 0 ? Math.min(240, Math.round(asked)) : kind === 'clip' ? 5 : minutesFor(kind, ref, body);
  return { kind, title: title.slice(0, 160), ref, body, minutes };
}
