// Run with: npm test
// Clips: reading what the text model sends back, cleaning edits, and the pieces of the processing job that need no network.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let ch;
let ai;
let ed;
before(async () => {
  ch = await import('../functions/_lib/clipChapters.ts');
  ai = await import('../functions/_lib/clipai.ts');
  ed = await import('../functions/_lib/clipEdits.ts');
});

describe('chapters from the model', () => {
  it('reads clock strings and seconds, in any wrapper', () => {
    assert.equal(ch.clockSeconds('1:07'), 67);
    assert.equal(ch.clockSeconds('35s'), 35);
    const raw = 'Sure! ```json\n{"chapters":[{"at":"0:00","title":"Hello"},{"start":"1:07","name":"Pricing page"}]}\n``` Hope that helps.';
    assert.deepEqual(ch.cleanChapters(ch.parseAiJson(raw), 200), [{ at: 0, title: 'Hello' }, { at: 67, title: 'Pricing page' }]);
  });
  it('drops junk, out-of-range items and near duplicates', () => {
    const out = ch.cleanChapters({ chapters: [{ at: 0, title: 'A' }, { at: 2, title: 'Too close' }, { at: 999, title: 'Past the end' }, { at: 20, title: '' }, null] }, 60, 5);
    assert.deepEqual(out, [{ at: 0, title: 'A' }]);
  });
  it('sizes the list by the length of the clip, and the first chapter starts at 0', () => {
    assert.deepEqual(ch.chapterRange(12), [1, 1]);
    assert.deepEqual(ch.chapterRange(900), [3, 8]);
    assert.deepEqual(ch.startAtZero([{ at: 9, title: 'Late' }]), [{ at: 0, title: 'Start' }, { at: 9, title: 'Late' }]);
  });
  it('always gives a clip with words a table of contents', () => {
    const lines = [{ s: 0, e: 5, t: 'Open the board' }, { s: 40, e: 45, t: 'Pick the team' }, { s: 90, e: 95, t: 'Drag the card' }];
    const f = ch.fallbackChapters(lines, 120);
    assert.ok(f.length >= 1 && f[0].at === 0);
  });
});

describe('text for the page', () => {
  it('has no em dashes, no line breaks and a length cap', () => {
    assert.equal(ai.plain('A — B\nC', 50), 'A, B C');
    assert.equal(ai.plain('x'.repeat(500), 20).length, 20);
  });
  it('pulls word times out of the transcript service reply', () => {
    const w = ai.whisperWords({ segments: [{ words: [{ word: ' Hello', start: 0.1, end: 0.4 }, { word: 'world', start: 0.5, end: 0.9 }] }] }, 120);
    assert.deepEqual(w, [[120.1, 120.4, 'Hello'], [120.5, 120.9, 'world']]);
  });
  it('shortens a very long transcript from the middle', () => {
    const t = 'a'.repeat(50000);
    const c = ai.clipText(t, 1000);
    assert.ok(c.length < 1100 && c.includes('[...]'));
  });
  it('names a clip by date when nothing was said', () => {
    assert.match(ai.fallbackTitle('2026-10-10T19:45:00.000Z'), /^Clip, Oct 10, 3:45 PM$/);
  });
});

describe('the edit list the server keeps', () => {
  it('rounds, orders and bounds ranges and splits', () => {
    const e = ed.cleanEdits({ trimStart: -4, trimEnd: 999, cuts: [[30, 20], [1, 1.01], 'x'], splits: [5.004, 0, 99, 5.004], silenceMin: 0.7 }, 60);
    assert.equal(e.trimStart, 0);
    assert.equal(e.trimEnd, 60);
    assert.deepEqual(e.cuts, [[20, 30]]);
    assert.deepEqual(e.splits, [5, 5]);
    assert.equal(e.silenceMin, 0.7);
  });
  it('keeps nothing from a bad body', () => {
    assert.deepEqual(ed.cleanEdits('junk', 10), { trimStart: 0, trimEnd: null, cuts: [] });
  });
  it('re-spreads corrected lines over the old word times', () => {
    const old = [{ s: 0, e: 4, t: 'helo there my dear friend' }];
    const next = [{ s: 0, e: 4, t: 'hello there my dear friend' }];
    const words = [[0, 0.5, 'helo'], [0.6, 1.2, 'there'], [1.3, 1.5, 'my'], [1.6, 2, 'dear'], [2.1, 2.6, 'friend']];
    const out = ed.respread(old, next, words);
    assert.deepEqual(out.map((w) => w[2]), ['hello', 'there', 'my', 'dear', 'friend']);
    assert.equal(out[0][0], 0);
  });
});
