// Run with: npm test
// Clips: highlights, chapters filled in where missing, and a draft Learn course from a clip. Made-up clips and people only; the
// database is an in-memory copy and no model is called (the AI binding is absent, so chapters come from the transcript fallback).
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { GRANTS, HR, NOW, WILL, learnWorld, rows } from './support/learn-world.mjs';

const H = await import('../functions/_lib/clipHighlights.ts');
const M = await import('../functions/_lib/clipMake.ts');

const lines = [
  { s: 0, e: 6, t: 'Hi, this is how we add a partner note in the Work Center.' },
  { s: 8, e: 14, t: 'First open the partner and press New action.' },
  { s: 30, e: 38, t: 'Make sure you pick the right action type, because it feeds the report.' },
  { s: 55, e: 60, t: 'um' },
  { s: 70, e: 80, t: 'Remember to press Save before you leave the page, it never autosaves.' },
  { s: 100, e: 110, t: 'Then check the gift list for the same partner on the right.' },
];

test('highlights: stressed lines and chapter starts, spaced apart, in time order; a short clip gets none', () => {
  const h = H.clipHighlights(lines, [{ at: 0, title: 'Start' }, { at: 98, title: 'Check the gifts' }], 120);
  assert.ok(h.length >= 2 && h.length <= 4);
  assert.deepEqual(h.map((x) => x.at), [...h.map((x) => x.at)].sort((a, b) => a - b));
  assert.ok(h.some((x) => x.at === 30 && x.why === 'Stressed'));
  assert.ok(h.some((x) => x.at === 70 && x.why === 'Stressed'));
  for (let i = 1; i < h.length; i++) assert.ok(h[i].at - h[i - 1].at >= 20);
  assert.ok(!h.some((x) => x.text === 'um'));
  assert.deepEqual(H.clipHighlights(lines, [], 12), []);
  // A reaction pulls a plain line up.
  const r = H.clipHighlights(lines, [], 120, [100, 101, 102]);
  assert.ok(r.some((x) => x.at === 100 && x.why === 'Reactions'));
});

let seq = 0;
function addClip(w, over = {}) {
  const id = (++seq).toString(16).padStart(32, '0');
  const c = { title: 'Adding a partner note', summary: 'How to log a note.', status: 'ready', chapters: '[]', transcript: JSON.stringify(lines), words: '[]', duration_ms: 120000, help_draft: '', ...over };
  w.d1.db.prepare("INSERT INTO hub_clips (id, owner_email, owner_name, mime, title, summary, status, chapters, transcript, words, duration_ms, help_draft, created_at, updated_at) VALUES (?, ?, ?, 'video/webm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, WILL.email, WILL.name, c.title, c.summary, c.status, c.chapters, c.transcript, c.words, c.duration_ms, c.help_draft, NOW, NOW);
  return w.d1.db.prepare('SELECT * FROM hub_clips WHERE id = ?').get(id);
}

test('chapters are written for a ready clip that has words and none, and a written list is never overwritten', async () => {
  const w = learnWorld();
  const env = { ...w.env, CLIPS: {} };
  const clip = addClip(w);
  const made = await M.ensureChapters(env, clip);
  assert.ok(made.length >= 1);
  assert.equal(made[0].at, 0);
  assert.equal(JSON.parse(rows(w, 'SELECT chapters FROM hub_clips WHERE id = ?', clip.id)[0].chapters).length, made.length);
  // Already has chapters: returned as they are.
  const kept = addClip(w, { chapters: JSON.stringify([{ at: 0, title: 'Mine' }]) });
  assert.deepEqual(await M.ensureChapters(env, kept), [{ at: 0, title: 'Mine' }]);
  // No words, or still processing: nothing to write.
  assert.deepEqual(await M.ensureChapters(env, addClip(w, { transcript: '[]' })), []);
  assert.deepEqual(await M.ensureChapters(env, addClip(w, { status: 'processing' })), []);
  // A list written after the clip was read is not replaced.
  const stale = addClip(w);
  w.d1.db.prepare("UPDATE hub_clips SET chapters = ? WHERE id = ?").run(JSON.stringify([{ at: 0, title: 'Written meanwhile' }]), stale.id);
  await M.ensureChapters(env, stale);
  assert.equal(JSON.parse(rows(w, 'SELECT chapters FROM hub_clips WHERE id = ?', stale.id)[0].chapters)[0].title, 'Written meanwhile');
});

test('Make a Learn lesson: a draft course with the clip and a written page, for admins and HR only', async () => {
  const w = learnWorld();
  const env = { ...w.env, CLIPS: {} };
  const draft = ['---', 'title: Add a partner note', 'summary: Log a note.', '---', '', 'Use this when you talk to a partner.', '', '## Steps', '', '1. **Open the partner.** Press New action.'].join('\n');
  const clip = addClip(w, { help_draft: draft });
  assert.equal(M.articleBody(draft).startsWith('Use this when'), true);
  const out = await M.makeLesson(env, WILL, clip);
  assert.equal(out.lessons, 2);
  const course = rows(w, 'SELECT * FROM learn_courses WHERE id = ?', out.course.id)[0];
  assert.equal(course.status, 'draft', 'nobody sees it until an author publishes it');
  assert.equal(course.title, 'Adding a partner note');
  const les = rows(w, 'SELECT kind, ref, body FROM learn_lessons WHERE course_id = ? ORDER BY sort', out.course.id);
  assert.deepEqual(les.map((l) => l.kind), ['clip', 'page']);
  assert.equal(les[0].ref, clip.id);
  assert.match(les[1].body, /Open the partner/);
  // HR may; a grant writer may not; a clip still processing is refused.
  assert.equal((await M.makeLesson(env, HR, clip)).lessons, 2);
  await assert.rejects(() => M.makeLesson(env, GRANTS, clip), (e) => e.status === 403);
  await assert.rejects(() => M.makeLesson(env, WILL, addClip(w, { status: 'processing' })), (e) => e.status === 409);
});
