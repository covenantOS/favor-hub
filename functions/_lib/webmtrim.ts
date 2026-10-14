// Meetings: cutting stretches out of a WebM recording without decoding it.
// A browser's MediaRecorder writes a WebM file: a header (EBML, Segment, Info, Tracks) and then clusters, each a timecode and the
// frames (blocks) that follow it. Cutting a stretch drops every block whose time falls inside it and moves the later blocks back by
// the length taken out, so the file plays straight through with no gap. Video frames need the last keyframe to draw, so after a
// cut the file picks up again at the next video keyframe (the cut grows by the wait, never shrinks). Sound blocks stand alone.
// The file is read in windows (a few MB at a time) and written in the same order, so a 400 MB recording never sits in memory.
// Stretches the recorder never stored (pieces dropped during a private moment) leave holes in the bytes; the reader treats each hole
// as the end of what came before and finds the next cluster after it.

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
  Cues: 0x1c53bb6b, Tags: 0x1254c367, Chapters: 0x1043a770, Attachments: 0x1941a469, Void: 0xec,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
  Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb,
};
const TOP = new Set([ID.Cluster, ID.Cues, ID.Tags, ID.Chapters, ID.Attachments, ID.SeekHead, ID.Info, ID.Tracks, ID.EBML, ID.Void]);
const UNKNOWN = -1;

/** Carried from one window to the next. All times are in the file's own ticks (milliseconds for browser recordings). */
export interface TrimState {
  pos: number;            // byte offset in the source where the next window starts (always a cluster or header start)
  head: boolean;          // the header has been written
  scale: number;          // nanoseconds per tick
  video: number;          // the video track number, 0 for a sound-only file
  shift: number;          // ticks taken out so far, before the block being read
  ci: number;             // the next cut to reach
  inCut: boolean;         // blocks are being dropped for cut ci
  removed: Array<[number, number]>; // what was taken out, in source ticks, as it really came out (cuts grow to a keyframe)
  lastOut: number;        // the time of the last block written, in output ticks
  blocksIn: number;
  blocksOut: number;
  done: boolean;
}

export const newState = (): TrimState => ({ pos: 0, head: false, scale: 1_000_000, video: 0, shift: 0, ci: 0, inCut: false, removed: [], lastOut: 0, blocksIn: 0, blocksOut: 0, done: false });

/** One cut, in source ticks. to = Infinity runs to the end. */
export type Cut = [number, number];

function readId(b: Uint8Array, p: number, end: number): { id: number; len: number } | null {
  if (p >= end) return null;
  const f = b[p];
  const len = f & 0x80 ? 1 : f & 0x40 ? 2 : f & 0x20 ? 3 : f & 0x10 ? 4 : 0;
  if (!len || p + len > end) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}

function readSize(b: Uint8Array, p: number, end: number): { size: number; len: number } | null {
  if (p >= end) return null;
  const f = b[p];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(f & mask)) { len++; mask >>= 1; }
  if (len > 8 || p + len > end) return null;
  let v = f & (mask - 1);
  let all = v === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) all = false; }
  return { size: all ? UNKNOWN : v, len };
}

function readUint(b: Uint8Array, p: number, n: number): number { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }

function idBytes(id: number): number[] { const out: number[] = []; while (id > 0) { out.unshift(id & 0xff); id = Math.floor(id / 256); } return out; }
function size8(n: number): number[] { const out = [0x01]; for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff); return out; }
function uintBytes(n: number): number[] { const out: number[] = []; do { out.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0); return out; }
function element(id: number, body: Uint8Array): Uint8Array {
  const h = [...idBytes(id), ...size8(body.length)];
  const out = new Uint8Array(h.length + body.length); out.set(h, 0); out.set(body, h.length); return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

/** A real cluster start: the Cluster id, a size, then a Timecode element. */
function clusterAt(b: Uint8Array, p: number, end: number): boolean {
  if (p + 4 > end || b[p] !== 0x1f || b[p + 1] !== 0x43 || b[p + 2] !== 0xb6 || b[p + 3] !== 0x75) return false;
  const s = readSize(b, p + 4, end); if (!s) return false;
  const q = p + 4 + s.len;
  return q < end && b[q] === 0xe7;
}

/** The next cluster start at or after p, or -1 when none is in the window. */
function findCluster(b: Uint8Array, p: number, end: number): number {
  for (let i = p; i + 4 < end; i++) if (b[i] === 0x1f && clusterAt(b, i, end)) return i;
  return -1;
}

interface Blk { at: number; len: number; tOff: number; track: number; key: boolean; t: number }

function parseBlockHead(b: Uint8Array, p: number, end: number): { track: number; tOff: number; rel: number; flags: number } | null {
  const tn = readSize(b, p, end); if (!tn || tn.size === UNKNOWN) return null;
  const q = p + tn.len; if (q + 3 > end) return null;
  let rel = (b[q] << 8) | b[q + 1]; if (rel & 0x8000) rel -= 0x10000;
  return { track: tn.size, tOff: q, rel, flags: b[q + 2] };
}

/** Header elements: EBML copied, Segment with unknown size, Info without Duration, Tracks copied; SeekHead and Cues dropped. */
function writeHead(b: Uint8Array, base: number, end: number, st: TrimState, out: Uint8Array[]): number | null {
  let p = 0;
  const eb = readId(b, p, end); if (!eb || eb.id !== ID.EBML) throw new Error('not a WebM file');
  const es = readSize(b, p + eb.len, end); if (!es || es.size === UNKNOWN) throw new Error('bad WebM header');
  const ee = p + eb.len + es.len + es.size; if (ee > end) return null;
  out.push(b.slice(p, ee)); p = ee;
  const sg = readId(b, p, end); if (!sg || sg.id !== ID.Segment) throw new Error('no Segment');
  const ss = readSize(b, p + sg.len, end); if (!ss) return null;
  out.push(new Uint8Array([...idBytes(ID.Segment), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  p += sg.len + ss.len;
  for (;;) {
    const e = readId(b, p, end); if (!e) return null;
    if (e.id === ID.Cluster) break;
    const s = readSize(b, p + e.len, end); if (!s || s.size === UNKNOWN) return null;
    const bs = p + e.len + s.len, be = bs + s.size; if (be > end) return null;
    if (e.id === ID.Info) {
      const kids: Uint8Array[] = [];
      for (let q = bs; q < be;) {
        const c = readId(b, q, be); const cs = c && readSize(b, q + c.len, be); if (!c || !cs || cs.size === UNKNOWN) break;
        const ce = q + c.len + cs.len + cs.size;
        if (c.id === ID.TimecodeScale) st.scale = readUint(b, q + c.len + cs.len, cs.size);
        if (c.id !== ID.Duration) kids.push(b.slice(q, ce));
        q = ce;
      }
      out.push(element(ID.Info, concat(kids)));
    } else if (e.id === ID.Tracks) {
      for (let q = bs; q < be;) {
        const c = readId(b, q, be); const cs = c && readSize(b, q + c.len, be); if (!c || !cs || cs.size === UNKNOWN) break;
        const ce = q + c.len + cs.len + cs.size;
        if (c.id === ID.TrackEntry) {
          let num = 0, type = 0;
          for (let r = q + c.len + cs.len; r < ce;) {
            const d = readId(b, r, ce); const ds = d && readSize(b, r + d.len, ce); if (!d || !ds || ds.size === UNKNOWN) break;
            if (d.id === ID.TrackNumber) num = readUint(b, r + d.len + ds.len, ds.size);
            if (d.id === ID.TrackType) type = readUint(b, r + d.len + ds.len, ds.size);
            r += d.len + ds.len + ds.size;
          }
          if (type === 1 && !st.video) st.video = num;
        }
        q = ce;
      }
      out.push(b.slice(p, be));
    }
    p = be;
  }
  st.head = true;
  return base + p;
}

/**
 * Reads one window of the source and returns what to write. buf holds source bytes from st.pos; eof says the window reaches the
 * end of the file; holes are source offsets where stored bytes stop and a later piece begins. cuts are sorted, in source ticks.
 */
export function trimWindow(buf: Uint8Array, eof: boolean, st: TrimState, cuts: Cut[], holes: number[] = []): Uint8Array {
  const base = st.pos;
  const end = buf.length;
  const out: Uint8Array[] = [];
  let p = 0;
  if (!st.head) {
    const at = writeHead(buf, base, end, st, out);
    if (at == null) { if (eof) throw new Error('the recording has no media'); return new Uint8Array(0); }
    p = at - base;
  }
  const holeIn = (from: number, to: number) => { for (const h of holes) if (h > base + from && h < base + to) return h - base; return -1; };
  while (p < end) {
    const e = readId(buf, p, end);
    if (!e || !TOP.has(e.id) || (e.id === ID.Cluster && !clusterAt(buf, p, end))) {
      // Not a cluster here: bytes after a hole, or damage. Find the next real cluster.
      const n = findCluster(buf, p + 1, end);
      if (n < 0) { p = eof ? end : Math.max(p, end - 16); break; }
      p = n; continue;
    }
    const s = readSize(buf, p + e.len, end);
    if (!s) { if (eof) { p = end; } break; }
    const bs = p + e.len + s.len;
    if (e.id !== ID.Cluster) {
      if (s.size === UNKNOWN) { const n = findCluster(buf, bs, end); if (n < 0) { if (eof) p = end; break; } p = n; continue; }
      if (bs + s.size > end) { if (eof) { p = end; } break; }
      p = bs + s.size; continue; // Cues, Tags, Void and the like after the header are not written.
    }
    // A cluster: find where it ends.
    let ce = s.size === UNKNOWN ? -1 : bs + s.size;
    const hole = holeIn(bs, ce < 0 ? end : Math.min(ce, end));
    let cut = false;
    if (hole >= 0) { ce = hole; cut = true; }
    if (ce > end) { if (!eof) break; ce = end; cut = true; }
    let tc = 0;
    const blocks: Blk[] = [];
    let q = bs;
    const limit = ce < 0 ? end : ce;
    let complete = ce >= 0;
    for (;;) {
      if (q >= limit) { if (ce < 0) { complete = eof; if (eof) ce = end; } break; }
      const c = readId(buf, q, limit);
      if (c && ce < 0 && TOP.has(c.id) && c.id !== ID.Void) { ce = q; complete = true; break; }
      const cs = c && readSize(buf, q + c.len, limit);
      if (!c || !cs || cs.size === UNKNOWN || q + c.len + cs.len + cs.size > limit) {
        if (ce < 0 && !eof && limit === end) { complete = false; break; } // more of this cluster is in the next window
        // A damaged or cut-off element: the cluster ends here, and the next cluster is found after it.
        ce = q; complete = true; cut = true; break;
      }
      const ds = q + c.len + cs.len, de = ds + cs.size;
      if (c.id === ID.Timecode) tc = readUint(buf, ds, cs.size);
      else if (c.id === ID.SimpleBlock) {
        const h = parseBlockHead(buf, ds, de);
        if (h) blocks.push({ at: q, len: de - q, tOff: h.tOff, track: h.track, key: !!(h.flags & 0x80), t: tc + h.rel });
      } else if (c.id === ID.BlockGroup) {
        let blk: Blk | null = null, ref = false;
        for (let r = ds; r < de;) {
          const d = readId(buf, r, de); const dz = d && readSize(buf, r + d.len, de); if (!d || !dz || dz.size === UNKNOWN) break;
          const dd = r + d.len + dz.len;
          if (d.id === ID.Block) { const h = parseBlockHead(buf, dd, dd + dz.size); if (h) blk = { at: q, len: de - q, tOff: h.tOff, track: h.track, key: false, t: tc + h.rel }; }
          if (d.id === ID.ReferenceBlock) ref = true;
          r = dd + dz.size;
        }
        if (blk) { blk.key = !ref; blocks.push(blk); }
      }
      q = de;
    }
    if (!complete) break; // wait for the next window, starting at this cluster
    out.push(...keepBlocks(buf, blocks, st, cuts));
    if (st.done) { p = end; break; }
    if (!cut) { p = ce; continue; }
    const n = findCluster(buf, Math.max(ce, bs + 1), end);
    if (n >= 0) { p = n; continue; }
    p = eof ? end : Math.max(ce, end - 16);
    break;
  }
  st.pos = base + p;
  if (eof && p >= end) st.done = true;
  if (st.done && st.inCut) { st.removed.push([cuts[st.ci][0], Infinity]); st.inCut = false; }
  return concat(out);
}

/** Decides each block of one cluster, rewrites the times of those kept, and returns the new cluster (or nothing). */
function keepBlocks(buf: Uint8Array, blocks: Blk[], st: TrimState, cuts: Cut[]): Uint8Array[] {
  const kept: Array<{ b: Blk; t: number }> = [];
  for (const b of blocks) {
    st.blocksIn++;
    let drop = false;
    while (st.ci < cuts.length) {
      const [a, z] = cuts[st.ci];
      if (b.t < a) break;
      if (z === Infinity) { st.removed.push([a, Infinity]); st.done = true; st.inCut = false; break; }
      st.inCut = true;
      if (b.t < z) { drop = true; break; }
      // Past the end of the cut. A video file starts again only on a video keyframe; a sound file starts again at the cut's end.
      if (st.video && !(b.track === st.video && b.key)) { drop = true; break; }
      const close = st.video ? b.t : z;
      st.shift += close - a; st.removed.push([a, close]); st.ci++; st.inCut = false;
    }
    if (st.done) break;
    // A sound block that comes after the keyframe in the file but belongs to the time just cut goes too.
    const last = st.removed[st.removed.length - 1];
    if (!drop && last && b.t >= last[0] && b.t < last[1]) drop = true;
    if (drop) continue;
    kept.push({ b, t: Math.max(0, b.t - st.shift) });
  }
  if (!kept.length) return [];
  const tc = Math.min(...kept.map((k) => k.t));
  const parts: Uint8Array[] = [new Uint8Array([...idBytes(ID.Timecode), 0x80 | uintBytes(tc).length, ...uintBytes(tc)])];
  for (const k of kept) {
    const copy = buf.slice(k.b.at, k.b.at + k.b.len);
    let rel = k.t - tc; if (rel > 32767) rel = 32767;
    const o = k.b.tOff - k.b.at;
    copy[o] = (rel >> 8) & 0xff; copy[o + 1] = rel & 0xff;
    parts.push(copy);
    st.lastOut = Math.max(st.lastOut, k.t);
  }
  st.blocksOut += kept.length;
  return [element(ID.Cluster, concat(parts))];
}

/** Moves a time through the cuts already made to a file, oldest first, so a new cut lands on the file as it is now. */
export function throughTrims(t: number, trims: Array<Array<[number, number | null]>>): number {
  for (const set of trims) {
    let shift = 0;
    for (const [a, b0] of set) {
      const b = b0 == null ? Infinity : b0;
      if (t >= b) shift += b - a;
      else if (t >= a) { shift += t - a; break; }
    }
    t -= shift;
  }
  return t;
}
