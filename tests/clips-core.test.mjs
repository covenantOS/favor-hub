// Run with: npm test
// Clips: the edit math the player and the editor share (public/js/clips/core.js), which runs in the browser and here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fillerCuts, fillerGroups, fmtTime, hasEdits, keepRanges, mergeCuts, normEdits, parseClock, rangesLength, silenceRanges, skipFrom, subtractRange,
  toEdited, toSource, transcriptFile, trimEdge, withAuto, wordsOf, PEAKS_PPS,
} from '../public/js/clips/core.js';

const E = (o = {}) => normEdits(o);

describe('time helpers', () => {
  it('formats and parses clock times', () => {
    assert.equal(fmtTime(67), '1:07');
    assert.equal(fmtTime(3725), '1:02:05');
    assert.equal(parseClock('1:07'), 67);
    assert.equal(parseClock('67'), 67);
    assert.equal(parseClock('x'), null);
  });
});

describe('keep ranges', () => {
  it('keeps everything with no edits', () => {
    assert.deepEqual(keepRanges(E(), 60), [[0, 60]]);
    assert.equal(hasEdits(E()), false);
  });
  it('applies the trim and the cuts, in order', () => {
    const e = E({ trimStart: 2, trimEnd: 50, cuts: [[10, 20], [15, 25], [40, 41]] });
    assert.deepEqual(keepRanges(e, 60), [[2, 10], [25, 40], [41, 50]]);
    assert.equal(hasEdits(e), true);
  });
  it('counts silences and filler words as cuts', () => {
    const e = E({ silences: [[5, 8]], fillers: [[20, 21]] });
    assert.deepEqual(keepRanges(e, 30), [[0, 5], [8, 20], [21, 30]]);
  });
  it('merges touching cuts and drops tiny ones', () => {
    assert.deepEqual(mergeCuts([[1, 2], [2.01, 3], [9, 9.02]]), [[1, 3]]);
  });
});

describe('edited and source time', () => {
  const r = [[0, 10], [20, 30]];
  it('maps both ways', () => {
    assert.equal(toEdited(5, r), 5);
    assert.equal(toEdited(25, r), 15);
    assert.equal(toEdited(15, r), 10); // inside a cut: where the cut starts
    assert.equal(toSource(15, r), 25);
    assert.equal(rangesLength(r), 20);
  });
  it('says where playback must jump', () => {
    assert.equal(skipFrom(5, r), undefined);
    assert.equal(skipFrom(12, r), 20);
    assert.equal(skipFrom(30, r), null);
  });
});

describe('trimming an edge', () => {
  it('moving the first edge in sets the trim, and moving it back clears what it took', () => {
    const a = trimEdge(E(), 'start', 0, 5, 60, 60);
    assert.equal(a.trimStart, 5);
    const back = trimEdge(a, 'start', 5, 0, 60, 60);
    assert.equal(back.trimStart, 0);
  });
  it('moving the last edge in sets the trim end; all the way out clears it', () => {
    const a = trimEdge(E(), 'end', 60, 40, 60, 0);
    assert.equal(a.trimEnd, 40);
    const back = trimEdge(a, 'end', 40, 60, 60, 0);
    assert.equal(back.trimEnd, null);
  });
  it('an inner edge adds a cut, and moving it back removes the cut', () => {
    const a = trimEdge(E({ cuts: [[20, 30]] }), 'end', 20, 15, 60, 0);
    assert.deepEqual(a.cuts, [[15, 30]]);
    const b = trimEdge(a, 'end', 15, 20, 60, 0);
    assert.deepEqual(b.cuts, [[20, 30]]);
  });
  it('subtractRange splits a range around the part taken back', () => {
    assert.deepEqual(subtractRange([[10, 20]], 14, 16), [[10, 14], [16, 20]]);
  });
});

describe('words, fillers and silences', () => {
  const lines = [{ s: 0, e: 4, t: 'Um so hello there everyone.' }];
  it('spreads words over a line when there are no word times', () => {
    const w = wordsOf(lines);
    assert.equal(w.length, 5);
    assert.ok(w[0].s === 0 && w[4].e <= 4.001);
  });
  it('takes real word times when the clip has them', () => {
    const real = [[0.2, 0.5, 'Um,'], [0.9, 1.1, 'so'], [1.2, 1.6, 'hello']];
    const w = wordsOf([{ s: 0, e: 2, t: 'Um, so hello' }], real);
    assert.deepEqual(w.map((x) => x.t), ['Um,', 'so', 'hello']);
    assert.equal(w[1].line, 0);
  });
  it('finds um and uh, and "so" only at the start of a sentence with a pause after', () => {
    const real = [[0, 0.3, 'Um.'], [0.4, 0.7, 'So,'], [1.2, 1.5, 'we'], [1.6, 1.9, 'so'], [1.95, 2.3, 'went']];
    const w = wordsOf([{ s: 0, e: 3, t: 'Um. So, we so went' }], real);
    const g = fillerGroups(w);
    assert.deepEqual(g, [[0], [1]]);
    const cuts = fillerCuts(w);
    assert.ok(cuts.length >= 1 && cuts[0][0] >= 0);
  });
  it('removes quiet stretches that hold no word, minus a pad on each side', () => {
    const peaks = new Float32Array(PEAKS_PPS * 12).fill(0.6);
    for (let i = PEAKS_PPS * 4; i < PEAKS_PPS * 8; i++) peaks[i] = 0; // 4 to 8 seconds is quiet
    const words = [{ s: 0, e: 3.9 }, { s: 8.1, e: 11 }];
    const cuts = silenceRanges(peaks, words, 12, 0.7, 0.15);
    assert.equal(cuts.length, 1);
    assert.ok(cuts[0][0] >= 4 && cuts[0][1] <= 8);
  });
  it('withAuto stores the cuts and takes them out again', () => {
    const real = [[0, 0.3, 'Um'], [3, 3.4, 'hello']];
    const w = wordsOf([{ s: 0, e: 4, t: 'Um hello' }], real);
    const on = withAuto(E(), 'fillers', true, w, 4);
    assert.equal(on.fillers.length, 1);
    const off = withAuto(on, 'fillers', false, w, 4);
    assert.equal(off.fillers, undefined);
  });
});

describe('transcript files', () => {
  const lines = [{ s: 1, e: 3, t: 'First line.' }, { s: 12, e: 14, t: 'Second line.' }, { s: 22, e: 24, t: 'Third line.' }];
  it('writes plain text on the edited timeline and leaves out cut lines', () => {
    const txt = transcriptFile(lines, [[0, 10], [20, 30]], 'txt');
    assert.equal(txt, '0:01  First line.\n0:12  Third line.\n');
  });
  it('writes SubRip with comma times', () => {
    const srt = transcriptFile([lines[0]], [], 'srt');
    assert.match(srt, /^1\n00:00:01,000 --> 00:00:03,000\nFirst line\./);
  });
});
