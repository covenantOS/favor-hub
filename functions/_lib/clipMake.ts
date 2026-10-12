// Clips: chapters where they are missing, and one-click "make a Learn lesson" from a clip. The help article draft lives in
// clipai.ts (helpArticle); this file turns what a clip already has into a draft course in Learn.
import { HttpError, nowIso } from './http';
import { J, type Clip, type ClipsEnv } from './clips';
import { chaptersFor } from './clipai';
import { framesOf, screenContext, stretches } from './clipVision';
import type { ClipChapter, ClipSegment, ClipWord } from './clipChapters';
import { helpArticle } from './clipai';
import { isAuthor, learnReady } from './learn/db';
import { addLesson, createCourse } from './learn/content';

/**
 * A ready clip with words and no chapters gets them. Never overwrites: the update only lands while the column is still empty, so a
 * chapter list a person wrote in the meantime stays. Returns the clip's chapters either way.
 */
export async function ensureChapters(env: ClipsEnv, clip: Clip): Promise<ClipChapter[]> {
  const have = J<ClipChapter[]>(clip.chapters, []);
  if (have.length || clip.status !== 'ready') return have;
  const lines = J<ClipSegment[]>(clip.transcript, []);
  if (!lines.length) return have;
  const frames = await framesOf(env, clip.id).catch(() => []);
  const made = await chaptersFor(env, lines, clip.duration_ms / 1000, J<ClipWord[]>(clip.words, []), screenContext(frames), stretches(frames)).catch(() => []);
  if (!made.length) return have;
  await env.DB.prepare("UPDATE hub_clips SET chapters = ?, updated_at = ? WHERE id = ? AND (chapters = '[]' OR chapters = '')").bind(JSON.stringify(made), nowIso(), clip.id).run();
  return made;
}

/** The article's body without its front matter, as the written page of a lesson. */
export function articleBody(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

export interface LessonMade {
  course: { id: string; slug: string; title: string };
  lessons: number;
}

/**
 * A draft course in Learn from one clip: the clip itself, then a written page with the steps. Only a FavorOS admin or HR may.
 * The course stays a draft until an author publishes it in Learn, Manage.
 */
export async function makeLesson(env: ClipsEnv, user: { email: string; role?: string }, clip: Clip): Promise<LessonMade> {
  if (!(await learnReady(env))) throw new HttpError(503, 'not_ready', 'Learn is not switched on yet.');
  if (!(await isAuthor(env, { email: user.email, admin: user.role === 'admin' }))) throw new HttpError(403, 'forbidden', 'Making a Learn lesson is for FavorOS admins and HR.');
  if (clip.status !== 'ready') throw new HttpError(409, 'not_ready', 'The clip is still being written up. Try again in a minute.');
  const title = (clip.title || 'Clip').slice(0, 120);
  const course = await createCourse(env, user.email, { title, summary: clip.summary.slice(0, 400), audience: '', status: 'draft' });
  const minutes = Math.max(1, Math.round(clip.duration_ms / 60000));
  await addLesson(env, user.email, course, { kind: 'clip', ref: clip.id, title, minutes });
  let lessons = 1;
  let md = clip.help_draft || '';
  if (!md && clip.transcript && clip.transcript !== '[]') md = (await helpArticle(env, clip).catch(() => null))?.markdown || '';
  const page = md ? articleBody(md) : clip.summary;
  if (page.trim()) {
    await addLesson(env, user.email, course, { kind: 'page', title: 'The steps in writing', body: page, minutes: 2 });
    lessons++;
  }
  return { course: { id: course.id, slug: course.slug, title: course.title }, lessons };
}
