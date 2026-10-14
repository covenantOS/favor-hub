// Run with: npm test
// Meetings: cutting stretches out of a WebM recording (functions/_lib/webmtrim.ts).
// The fixtures in tests/fixtures/webmtrim were made with ffmpeg from a test pattern and a tone (no real recording), then rewritten
// into the shape a browser's MediaRecorder writes (Segment and clusters of unknown size, no Cues):
//   av-live.webm   20 s, VP8 at 15 fps with a keyframe every 2 s, and Opus
//   a-live.webm    20 s, Opus only
// Where ffmpeg and ffprobe are installed the result is decoded in full and its length checked.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './support/resolve-ts.mjs';

const FIX = new URL('./fixtures/webmtrim/', import.meta.url);
const fixture = (name) => new Uint8Array(readFileSync(new URL(name, FIX)));
const hasFfmpeg = spawnSync('ffprobe', ['-version']).status === 0 && spawnSync('ffmpeg', ['-version']).status === 0;

let lib;
before(async () => { lib = await import('../functions/_lib/webmtrim.ts'); });

/** Runs the trimmer over the source in windows of `win` bytes, as the Drive job does, and returns the new file and the state. */
function run(src, cuts, { win = 40000, holes = [] } = {}) {
  const st = lib.newState();
  const parts = [];
  let guard = 0;
  while (!st.done) {
    if (guard++ > 10000) throw new Error('no progress');
    let size = win;
    for (;;) {
      const from = st.pos;
      const end = Math.min(src.length, from + size);
      const before = st.pos;
      const out = lib.trimWindow(src.subarray(from, end), end >= src.length, st, cuts, holes);
      parts.push(out);
      if (st.pos !== before || st.done) break;
      size *= 2; // a cluster larger than the window: read more
    }
  }
  return { file: new Uint8Array(Buffer.concat(parts)), st };
}

function probe(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'webmtrim-'));
  try {
    const f = join(dir, 'x.webm');
    writeFileSync(f, buf);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
    const pk = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'packet=codec_type,pts_time', '-of', 'csv=p=0', f], { encoding: 'utf8' });
    const rows = pk.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [type, t] = l.split(','); return { type, t: Number(t) }; });
    return { errors: dec.stderr.trim(), status: dec.status, rows };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const last = (rows, type) => Math.max(...rows.filter((r) => r.type === type).map((r) => r.t));

describe('webm trim', () => {
  it('copies a file whole when nothing is cut', () => {
    const src = fixture('av-live.webm');
    const { file, st } = run(src, []);
    assert.equal(st.blocksIn, st.blocksOut);
    assert.ok(st.video > 0);
    if (!hasFfmpeg) return;
    const p = probe(file);
    assert.equal(p.status, 0); assert.equal(p.errors, '');
    assert.ok(last(p.rows, 'video') > 19.5);
  });

  it('cuts a stretch from a video file and starts again on a keyframe', () => {
    const src = fixture('av-live.webm');
    const { file, st } = run(src, [[5000, 9000]]);
    // The cut runs from 5 s to the first keyframe at or after 9 s, which is 10 s with a keyframe every 2 s.
    assert.deepEqual(st.removed, [[5000, 10000]]);
    assert.ok(st.blocksOut < st.blocksIn);
    if (!hasFfmpeg) return;
    const p = probe(file);
    assert.equal(p.status, 0); assert.equal(p.errors, '');
    const v = last(p.rows, 'video'), a = last(p.rows, 'audio');
    assert.ok(v > 14.4 && v < 15.1, 'video ends near 15 s, got ' + v);
    assert.ok(a > 14.4 && a < 15.1, 'sound ends near 15 s, got ' + a);
    // Times run forward with no jump: nothing in the new file sits past where the cut was taken out.
    const vt = p.rows.filter((r) => r.type === 'video').map((r) => r.t);
    for (let i = 1; i < vt.length; i++) assert.ok(vt[i] - vt[i - 1] < 0.2, 'no gap at ' + vt[i]);
  });

  it('cuts two stretches and the end', () => {
    const src = fixture('av-live.webm');
    const { file, st } = run(src, [[2000, 4000], [8000, 10000], [16000, Infinity]]);
    assert.deepEqual(st.removed, [[2000, 4000], [8000, 10000], [16000, Infinity]]);
    if (!hasFfmpeg) return;
    const p = probe(file);
    assert.equal(p.status, 0); assert.equal(p.errors, '');
    const v = last(p.rows, 'video');
    assert.ok(v > 11.4 && v < 12.1, 'video ends near 12 s, got ' + v);
  });

  it('cuts sound at the exact second', () => {
    const src = fixture('a-live.webm');
    const { file, st } = run(src, [[3000, 7500]]);
    assert.equal(st.video, 0);
    assert.deepEqual(st.removed, [[3000, 7500]]);
    if (!hasFfmpeg) return;
    const p = probe(file);
    assert.equal(p.status, 0); assert.equal(p.errors, '');
    const a = last(p.rows, 'audio');
    assert.ok(a > 15.3 && a < 15.6, 'sound ends near 15.5 s, got ' + a);
  });

  it('keeps only the middle', () => {
    const src = fixture('av-live.webm');
    const { file } = run(src, [[0, 6000], [14000, Infinity]]);
    if (!hasFfmpeg) return;
    const p = probe(file);
    assert.equal(p.status, 0); assert.equal(p.errors, '');
    const v = last(p.rows, 'video');
    assert.ok(v > 7.4 && v < 8.1, 'video ends near 8 s, got ' + v);
  });

  it('reads past a hole where pieces were never stored, in any window size', () => {
    const src = fixture('av-live.webm');
    // Take out bytes from the middle of a cluster to the middle of a later one, as a dropped run of one second pieces does.
    const a = 120000, b = 180000;
    const holed = new Uint8Array(src.length - (b - a)); holed.set(src.subarray(0, a), 0); holed.set(src.subarray(b), a);
    for (const win of [9000, 40000, 1e6]) {
      const { file, st } = run(holed, [], { win, holes: [a] });
      assert.ok(st.blocksOut > 0);
      if (!hasFfmpeg) continue;
      const p = probe(file);
      assert.equal(p.status, 0);
      assert.ok(last(p.rows, 'audio') > 19.5, 'sound after the hole is kept');
    }
  });

  it('moves a new cut through the cuts made before', () => {
    // First cut took 5 s to 10 s out. A cut asked for at 12 s to 14 s of the original lands at 7 s to 9 s of the file as it is.
    const trims = [[[5000, 10000]]];
    assert.equal(lib.throughTrims(12000, trims), 7000);
    assert.equal(lib.throughTrims(14000, trims), 9000);
    assert.equal(lib.throughTrims(7000, trims), 5000);
    assert.equal(lib.throughTrims(3000, trims), 3000);
    assert.equal(lib.throughTrims(30000, [[[5000, null]]]), 5000);
  });
});
