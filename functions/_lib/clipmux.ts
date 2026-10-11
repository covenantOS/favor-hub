// Clips: turns the fragmented MP4 a browser's MediaRecorder writes into a plain progressive MP4 that starts playing at once.
//
// A recorder writes ftyp, a small moov with no samples, then one moof+mdat pair every second or so. A browser handed that
// file as <video src> reads every moof with its own range request before it shows a frame (22 seconds for a 6 minute clip).
// A progressive file has one moov at the front that lists every sample, so one request is enough.
//
// This module has no Cloudflare code in it. It reads the source once, front to back, skipping the media bytes, and returns
//   head   the new front of the file: ftyp, the full moov and the mdat header
//   plan   where the media bytes sit in the source (ext) and how long the new file is
// The new file is head followed by the source bytes the plan names, in order. Media bytes are never changed or re-encoded.
// functions/_lib/clipmuxjob.ts writes that file to R2 and serves it.
//
// It also moves a moov that sits at the end of an uploaded MP4 or MOV to the front (kind "tail"), and leaves alone what
// already starts with its moov, WebM, and anything it does not understand.

export interface MuxSource {
  size: number;
  /** The source bytes from `offset` to the end. */
  open(offset: number): Promise<ReadableStream<Uint8Array>>;
}

export interface MuxTrack {
  id: number;
  /** "vide" or "soun". */
  handler: string;
  samples: number;
  /** Key frames. Equal to samples when every sample is one (sound). */
  sync: number;
  timescale: number;
  /** In the track's own timescale. */
  duration: number;
}

export interface MuxPlan {
  v: 1;
  /** frag: built from moof boxes. tail: a progressive file whose moov was at the end. */
  kind: 'frag' | 'tail';
  srcSize: number;
  headLen: number;
  /** Length of the new file. */
  total: number;
  /** Source byte ranges that follow the head, as offset, length, offset, length. */
  ext: number[];
  tracks: MuxTrack[];
  durationMs: number;
  fragments: number;
  warn: string[];
}

export type MuxResult =
  | { kind: 'frag' | 'tail'; plan: MuxPlan; head: Uint8Array }
  /** Nothing to do: `progressive` already starts with its moov, `other` is not an MP4 (WebM). */
  | { kind: 'progressive' | 'other'; reason: string };

export class MuxError extends Error {}

const MAX_MOOV = 96 * 1024 * 1024;
const MAX_MOOF = 16 * 1024 * 1024;
/** A skip longer than this reopens the source at the new place; a shorter one reads through. */
const REOPEN_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ bytes */

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u32 = (b: Uint8Array, o: number) => dv(b).getUint32(o);
const i32 = (b: Uint8Array, o: number) => dv(b).getInt32(o);
const u64 = (b: Uint8Array, o: number) => dv(b).getUint32(o) * 4294967296 + dv(b).getUint32(o + 4);
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const isType = (b: Uint8Array, o: number) => {
  for (let i = 0; i < 4; i++) {
    const c = b[o + i];
    // Box names are printable ASCII; QuickTime also uses the copyright sign (0xA9).
    if (!((c >= 0x20 && c <= 0x7e) || c === 0xa9)) return false;
  }
  return true;
};

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.byteLength;
  const out = new Uint8Array(n);
  let w = 0;
  for (const p of parts) {
    out.set(p, w);
    w += p.byteLength;
  }
  return out;
}

function words(...n: number[]): Uint8Array {
  const out = new Uint8Array(n.length * 4);
  const v = dv(out);
  n.forEach((x, i) => v.setUint32(i * 4, x >>> 0));
  return out;
}

/** Big-endian 32-bit numbers from a list of any length (a spread would overflow the call stack on a long clip). */
function wordsOf(list: ArrayLike<number>, n = list.length): Uint8Array {
  const out = new Uint8Array(n * 4);
  const v = dv(out);
  for (let i = 0; i < n; i++) v.setUint32(i * 4, list[i] >>> 0);
  return out;
}

function put64(v: DataView, o: number, n: number) {
  v.setUint32(o, Math.floor(n / 4294967296));
  v.setUint32(o + 4, n >>> 0);
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  let n = 8;
  for (const p of parts) n += p.byteLength;
  const out = new Uint8Array(n);
  dv(out).setUint32(0, n);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let w = 8;
  for (const p of parts) {
    out.set(p, w);
    w += p.byteLength;
  }
  return out;
}

const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, words(((version << 24) | flags) >>> 0), ...parts);

interface Child {
  type: string;
  /** The whole box, header included. */
  raw: Uint8Array;
  /** What follows the header. */
  body: Uint8Array;
  /** Where the box starts inside its parent's body. */
  at: number;
}

/** The boxes inside a container's body. Stops quietly at the first one that does not fit. */
function children(body: Uint8Array): Child[] {
  const out: Child[] = [];
  let o = 0;
  while (o + 8 <= body.byteLength) {
    let size = u32(body, o);
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > body.byteLength) break;
      size = u64(body, o + 8);
      hdr = 16;
    } else if (size === 0) size = body.byteLength - o;
    if (size < hdr || o + size > body.byteLength || !isType(body, o + 4)) break;
    out.push({ type: fourcc(body, o + 4), raw: body.subarray(o, o + size), body: body.subarray(o + hdr, o + size), at: o });
    o += size;
  }
  return out;
}

const child = (list: Child[], type: string) => list.find((c) => c.type === type);

/** A list of 32-bit numbers that grows. A long clip holds a few hundred thousand samples. */
class Nums {
  a: Uint32Array | Int32Array;
  n = 0;
  private signed: boolean;
  constructor(signed = false) {
    this.signed = signed;
    this.a = signed ? new Int32Array(1024) : new Uint32Array(1024);
  }
  push(x: number) {
    if (this.n === this.a.length) {
      const b = this.signed ? new Int32Array(this.a.length * 2) : new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
  }
  get(i: number) {
    return this.a[i];
  }
  set(i: number, x: number) {
    this.a[i] = x;
  }
}

/* ------------------------------------------------------------------ reading forward */

class Forward {
  pos = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private left: Uint8Array | null = null;
  private src: MuxSource;
  constructor(src: MuxSource) {
    this.src = src;
  }

  private async chunk(): Promise<Uint8Array | null> {
    if (this.left) {
      const c = this.left;
      this.left = null;
      return c;
    }
    if (!this.reader) {
      if (this.pos >= this.src.size) return null;
      this.reader = (await this.src.open(this.pos)).getReader();
    }
    const r = await this.reader.read();
    return r.done ? null : r.value;
  }

  /** The next n bytes, or fewer at the end of the source. */
  async take(n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    let w = 0;
    while (w < n) {
      const c = await this.chunk();
      if (!c) break;
      const use = Math.min(c.byteLength, n - w);
      out.set(c.subarray(0, use), w);
      w += use;
      if (use < c.byteLength) this.left = c.subarray(use);
    }
    this.pos += w;
    return w === n ? out : out.subarray(0, w);
  }

  async skip(n: number): Promise<void> {
    if (n <= 0) return;
    const have = this.left ? this.left.byteLength : 0;
    if (n - have > REOPEN_BYTES || this.pos + n >= this.src.size) {
      await this.close();
      this.pos = Math.min(this.src.size, this.pos + n);
      return;
    }
    let left = n;
    while (left > 0) {
      const c = await this.chunk();
      if (!c) break;
      const use = Math.min(c.byteLength, left);
      if (use < c.byteLength) this.left = c.subarray(use);
      left -= use;
      this.pos += use;
    }
  }

  async close(): Promise<void> {
    this.left = null;
    const r = this.reader;
    this.reader = null;
    if (r) await r.cancel().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ the source's moov */

interface SrcTrack {
  /** The trak box this came from. */
  box: Child;
  id: number;
  handler: string;
  timescale: number;
  trak: Child[];
  mdia: Child[];
  minf: Child[];
  stbl: Child[];
  /** Samples the moov itself lists (none in a fragmented file). */
  listed: number;
  /** media_time of the source's edit list, when it has one. */
  mediaTime: number;
  hadEdits: boolean;
  trex: { sdi: number; dur: number; size: number; flags: number };
}

interface SrcMoov {
  raw: Uint8Array;
  kids: Child[];
  timescale: number;
  hasMvex: boolean;
  tracks: SrcTrack[];
}

function readMoov(raw: Uint8Array, hdr: number): SrcMoov {
  const kids = children(raw.subarray(hdr));
  const mvhd = child(kids, 'mvhd');
  if (!mvhd) throw new MuxError('The file has no movie header.');
  const timescale = mvhd.body[0] === 1 ? u32(mvhd.body, 20) : u32(mvhd.body, 12);
  const mvex = child(kids, 'mvex');
  const trex = new Map<number, SrcTrack['trex']>();
  if (mvex) {
    for (const c of children(mvex.body)) {
      if (c.type === 'trex' && c.body.byteLength >= 24) trex.set(u32(c.body, 4), { sdi: u32(c.body, 8), dur: u32(c.body, 12), size: u32(c.body, 16), flags: u32(c.body, 20) });
    }
  }
  const tracks: SrcTrack[] = [];
  for (const t of kids.filter((k) => k.type === 'trak')) {
    const trak = children(t.body);
    const tkhd = child(trak, 'tkhd');
    const mdiaBox = child(trak, 'mdia');
    if (!tkhd || !mdiaBox) continue;
    const id = tkhd.body[0] === 1 ? u32(tkhd.body, 20) : u32(tkhd.body, 12);
    const mdia = children(mdiaBox.body);
    const mdhd = child(mdia, 'mdhd');
    const hdlr = child(mdia, 'hdlr');
    const minfBox = child(mdia, 'minf');
    if (!mdhd || !minfBox) continue;
    const minf = children(minfBox.body);
    const stblBox = child(minf, 'stbl');
    if (!stblBox) continue;
    const stbl = children(stblBox.body);
    const stsz = child(stbl, 'stsz');
    const stz2 = child(stbl, 'stz2');
    const listed = stsz && stsz.body.byteLength >= 12 ? u32(stsz.body, 8) : stz2 && stz2.body.byteLength >= 12 ? u32(stz2.body, 8) : 0;
    let mediaTime = 0;
    let hadEdits = false;
    const edts = child(trak, 'edts');
    const elst = edts ? child(children(edts.body), 'elst') : undefined;
    if (elst && elst.body.byteLength >= 8) {
      const v1 = elst.body[0] === 1;
      const n = u32(elst.body, 4);
      const step = v1 ? 20 : 12;
      for (let i = 0; i < n && 8 + (i + 1) * step <= elst.body.byteLength; i++) {
        const o = 8 + i * step;
        const mt = v1 ? (i32(elst.body, o + 8) < 0 ? -1 : u64(elst.body, o + 8)) : i32(elst.body, o + 4);
        if (mt >= 0) {
          mediaTime = mt;
          hadEdits = true;
          break;
        }
      }
    }
    tracks.push({
      box: t,
      id,
      handler: hdlr && hdlr.body.byteLength >= 12 ? fourcc(hdlr.body, 8) : '',
      timescale: mdhd.body[0] === 1 ? u32(mdhd.body, 20) : u32(mdhd.body, 12),
      trak,
      mdia,
      minf,
      stbl,
      listed,
      mediaTime,
      hadEdits,
      trex: trex.get(id) || { sdi: 1, dur: 0, size: 0, flags: 0 },
    });
  }
  return { raw, kids, timescale: timescale || 1000, hasMvex: !!mvex, tracks };
}

/* ------------------------------------------------------------------ collecting fragments */

interface Acc {
  src: SrcTrack;
  sizes: Nums;
  durs: Nums;
  /** Composition offsets, kept only once a sample has one. */
  ctos: Nums | null;
  negCto: boolean;
  /** 1-based numbers of the key frames. */
  sync: Nums;
  /** One chunk per run of samples that sit together in the source. */
  chunkOff: number[];
  chunkFirst: number[];
  chunkCount: number[];
  chunkSdi: number[];
  /** Decode time of the first sample, and of the sample after the last one. */
  start: number;
  dts: number;
  /** Where the last run ended in the source, to join runs that touch. */
  lastEnd: number;
}

const newAcc = (src: SrcTrack): Acc => ({ src, sizes: new Nums(), durs: new Nums(), ctos: null, negCto: false, sync: new Nums(), chunkOff: [], chunkFirst: [], chunkCount: [], chunkSdi: [], start: -1, dts: 0, lastEnd: -1 });

/** Reads one moof into the tracks. `moofAt` is its place in the source; samples past `srcSize` (a recording cut short) are dropped. */
function readMoof(body: Uint8Array, moofAt: number, srcSize: number, accs: Map<number, Acc>, warn: Set<string>) {
  let prevEnd = -1; // where the traf before this one ended, for files without default-base-is-moof
  for (const traf of children(body).filter((c) => c.type === 'traf')) {
    const kids = children(traf.body);
    const tfhd = child(kids, 'tfhd');
    if (!tfhd || tfhd.body.byteLength < 8) continue;
    const tf = u32(tfhd.body, 0) & 0xffffff;
    const acc = accs.get(u32(tfhd.body, 4));
    if (!acc) continue;
    let o = 8;
    let base = -1;
    let sdi = acc.src.trex.sdi || 1;
    let dDur = acc.src.trex.dur;
    let dSize = acc.src.trex.size;
    let dFlags = acc.src.trex.flags;
    if (tf & 0x1) {
      base = u64(tfhd.body, o);
      o += 8;
    }
    if (tf & 0x2) {
      sdi = u32(tfhd.body, o);
      o += 4;
    }
    if (tf & 0x8) {
      dDur = u32(tfhd.body, o);
      o += 4;
    }
    if (tf & 0x10) {
      dSize = u32(tfhd.body, o);
      o += 4;
    }
    if (tf & 0x20) dFlags = u32(tfhd.body, o);
    if (base < 0) base = tf & 0x20000 || prevEnd < 0 ? moofAt : prevEnd;

    const tfdt = child(kids, 'tfdt');
    if (tfdt && tfdt.body.byteLength >= 8) {
      const t = tfdt.body[0] === 1 ? u64(tfdt.body, 4) : u32(tfdt.body, 4);
      const n = acc.sizes.n;
      if (acc.start < 0) {
        acc.start = t;
        acc.dts = t;
      } else if (n > 0 && t !== acc.dts) {
        // The fragment says where it starts. A gap (a pause) lengthens the sample before it; an overlap shortens it.
        const last = acc.durs.get(n - 1);
        const next = Math.max(1, Math.min(0xffffffff, last + (t - acc.dts)));
        acc.durs.set(n - 1, next);
        acc.dts += next - last;
        if (acc.dts !== t) warn.add('fragment times overlap');
      }
    } else if (acc.start < 0) {
      acc.start = 0;
      acc.dts = 0;
    }

    let at = base;
    let firstRun = true;
    for (const trun of kids.filter((c) => c.type === 'trun')) {
      const b = trun.body;
      if (b.byteLength < 8) continue;
      const version = b[0];
      const f = u32(b, 0) & 0xffffff;
      const count = u32(b, 4);
      let p = 8;
      if (f & 0x1) {
        at = base + i32(b, p);
        p += 4;
      } else if (firstRun && !(tf & 0x1) && !(tf & 0x20000) && prevEnd >= 0) at = prevEnd;
      firstRun = false;
      let firstFlags = -1;
      if (f & 0x4) {
        firstFlags = u32(b, p);
        p += 4;
      }
      const per = (f & 0x100 ? 4 : 0) + (f & 0x200 ? 4 : 0) + (f & 0x400 ? 4 : 0) + (f & 0x800 ? 4 : 0);
      if (p + count * per > b.byteLength) throw new MuxError('A fragment lists more samples than it holds.');
      const runStart = at;
      const firstSample = acc.sizes.n + 1;
      let kept = 0;
      for (let i = 0; i < count; i++) {
        let dur = dDur;
        let size = dSize;
        let flags = i === 0 && firstFlags >= 0 ? firstFlags : dFlags;
        let cto = 0;
        if (f & 0x100) {
          dur = u32(b, p);
          p += 4;
        }
        if (f & 0x200) {
          size = u32(b, p);
          p += 4;
        }
        if (f & 0x400) {
          flags = u32(b, p);
          p += 4;
        }
        if (f & 0x800) {
          cto = version === 0 ? u32(b, p) : i32(b, p);
          p += 4;
        }
        if (at + size > srcSize) {
          warn.add('the recording ends inside a fragment');
          break;
        }
        acc.sizes.push(size);
        acc.durs.push(dur);
        acc.dts += dur;
        if (cto !== 0 && !acc.ctos) {
          acc.ctos = new Nums(true);
          for (let k = 1; k < acc.sizes.n; k++) acc.ctos.push(0);
        }
        if (acc.ctos) acc.ctos.push(cto);
        if (cto < 0) acc.negCto = true;
        if (!(flags & 0x10000)) acc.sync.push(acc.sizes.n);
        at += size;
        kept++;
      }
      if (kept) {
        const last = acc.chunkOff.length - 1;
        if (last >= 0 && acc.lastEnd === runStart && acc.chunkSdi[last] === sdi) acc.chunkCount[last] += kept;
        else {
          acc.chunkOff.push(runStart);
          acc.chunkFirst.push(firstSample);
          acc.chunkCount.push(kept);
          acc.chunkSdi.push(sdi);
        }
        acc.lastEnd = at;
      }
      if (kept < count) break;
    }
    prevEnd = at;
  }
}

/* ------------------------------------------------------------------ where source bytes land */

/** Maps a source offset to its place in the new file. -1 when the plan does not carry that byte. */
export function mapper(ext: number[], headLen: number): (srcOff: number) => number {
  const n = ext.length / 2;
  const before = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    before[i] = sum;
    sum += ext[i * 2 + 1];
  }
  return (srcOff: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = ext[mid * 2];
      if (srcOff < s) hi = mid - 1;
      else if (srcOff >= s + ext[mid * 2 + 1]) lo = mid + 1;
      else return headLen + before[mid] + (srcOff - s);
    }
    return -1;
  };
}

/** The source ranges that make up bytes [start, start + length) of the part of the new file after the head. */
export function dataRanges(ext: number[], start: number, length: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = 0;
  const end = start + length;
  for (let i = 0; i < ext.length && at < end; i += 2) {
    const len = ext[i + 1];
    const a = Math.max(start, at);
    const b = Math.min(end, at + len);
    if (b > a) out.push([ext[i] + (a - at), b - a]);
    at += len;
  }
  return out;
}

/* ------------------------------------------------------------------ writing the moov */

function runLength(values: Nums, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; ) {
    const v = values.get(i);
    let j = i + 1;
    while (j < n && values.get(j) === v) j++;
    out.push(j - i, v);
    i = j;
  }
  return out;
}

/** A copy of a movie, track or media header with its duration replaced. The three share one layout up to that field. */
function withDuration(raw: Uint8Array, hdr: number, at0: number, at1: number, duration: number): Uint8Array {
  const out = raw.slice();
  const v = dv(out);
  if (out[hdr] === 1) put64(v, hdr + at1, duration);
  else v.setUint32(hdr + at0, Math.min(duration, 0xffffffff));
  return out;
}
const hdrLen = (c: Child) => c.raw.byteLength - c.body.byteLength;

interface Built {
  moov: Uint8Array;
  /** For each track, where its chunk offset table sits in the moov, to fill in once the moov's length is known. */
  slots: Array<{ acc: Acc; at: number; wide: boolean }>;
  tracks: MuxTrack[];
  durationMs: number;
}

function buildMoov(src: SrcMoov, accs: Acc[], wide: boolean): Built {
  const live = accs.filter((a) => a.sizes.n > 0);
  if (!live.length) throw new MuxError('The recording holds no samples.');
  const scale = src.timescale;
  const startSec = Math.min(...live.map((a) => a.start / a.src.timescale));
  let movieDur = 0;
  const traks: Uint8Array[] = [];
  const slotIn: Array<{ acc: Acc; at: number }> = [];
  const tracks: MuxTrack[] = [];

  for (const a of live) {
    const t = a.src;
    const n = a.sizes.n;
    const mediaDur = a.dts - a.start;
    // A track that starts later than the first one waits behind an empty edit, so sound and picture stay in step.
    const delay = Math.round((a.start / t.timescale - startSec) * scale);
    const shown = Math.max(0, Math.round(((mediaDur - t.mediaTime) / t.timescale) * scale));
    const trackDur = delay + shown;
    movieDur = Math.max(movieDur, trackDur);

    const stsd = child(t.stbl, 'stsd');
    if (!stsd) throw new MuxError('A track has no sample description.');
    const stts = runLength(a.durs, n);
    const tables: Uint8Array[] = [stsd.raw, full('stts', 0, 0, words(stts.length / 2), wordsOf(stts))];
    if (a.ctos) {
      const c = runLength(a.ctos, n);
      tables.push(full('ctts', a.negCto ? 1 : 0, 0, words(c.length / 2), wordsOf(c)));
    }
    if (a.sync.n < n) tables.push(full('stss', 0, 0, words(a.sync.n), wordsOf(a.sync.a, a.sync.n)));
    const stsc: number[] = [];
    for (let i = 0; i < a.chunkCount.length; i++) {
      const m = stsc.length;
      if (m && stsc[m - 2] === a.chunkCount[i] && stsc[m - 1] === a.chunkSdi[i]) continue;
      stsc.push(i + 1, a.chunkCount[i], a.chunkSdi[i]);
    }
    tables.push(full('stsc', 0, 0, words(stsc.length / 3), wordsOf(stsc)));
    let same = n > 0;
    for (let i = 1; i < n && same; i++) same = a.sizes.get(i) === a.sizes.get(0);
    if (same) tables.push(full('stsz', 0, 0, words(a.sizes.get(0), n)));
    else {
      const sz = new Uint8Array(n * 4);
      const v = dv(sz);
      for (let i = 0; i < n; i++) v.setUint32(i * 4, a.sizes.get(i));
      tables.push(full('stsz', 0, 0, words(0, n), sz));
    }
    const co = full(wide ? 'co64' : 'stco', 0, 0, words(a.chunkOff.length), new Uint8Array(a.chunkOff.length * (wide ? 8 : 4)));
    const stbl = box('stbl', ...tables, co);
    const coAtInStbl = stbl.byteLength - co.byteLength + 16;

    // minf, mdia and trak keep what the source had (the handler, vmhd or smhd, dinf) around the new sample table.
    const minfParts = t.minf.map((c) => (c.type === 'stbl' ? stbl : c.raw));
    const minf = box('minf', ...minfParts);
    const stblAtInMinf = 8 + t.minf.filter((c, i) => i < t.minf.findIndex((x) => x.type === 'stbl')).reduce((s, c) => s + c.raw.byteLength, 0);
    const mdiaParts = t.mdia.map((c) => (c.type === 'minf' ? minf : c.type === 'mdhd' ? withDuration(c.raw, hdrLen(c), 16, 24, mediaDur) : c.raw));
    const mdia = box('mdia', ...mdiaParts);
    const minfAtInMdia = 8 + t.mdia.filter((c, i) => i < t.mdia.findIndex((x) => x.type === 'minf')).reduce((s, c) => s + c.raw.byteLength, 0);

    const trakParts: Uint8Array[] = [];
    let mdiaAtInTrak = 8;
    let placed = false;
    for (const c of t.trak) {
      if (c.type === 'edts') continue;
      if (c.type === 'mdia') {
        if (delay > 0 || t.mediaTime > 0 || t.hadEdits) {
          const big = trackDur > 0xffffffff || t.mediaTime > 0x7fffffff;
          const rows: Array<[number, number]> = [];
          if (delay > 0) rows.push([delay, -1]);
          rows.push([shown, t.mediaTime]);
          const body = new Uint8Array(rows.length * (big ? 20 : 12));
          const v = dv(body);
          rows.forEach(([d, mt], i) => {
            const o = i * (big ? 20 : 12);
            if (big) {
              put64(v, o, d);
              if (mt < 0) {
                v.setInt32(o + 8, -1);
                v.setInt32(o + 12, -1);
              } else put64(v, o + 8, mt);
              v.setUint32(o + 16, 0x00010000);
            } else {
              v.setUint32(o, d);
              v.setInt32(o + 4, mt);
              v.setUint32(o + 8, 0x00010000);
            }
          });
          const edts = box('edts', full('elst', big ? 1 : 0, 0, words(rows.length), body));
          trakParts.push(edts);
          if (!placed) mdiaAtInTrak += edts.byteLength;
        }
        trakParts.push(mdia);
        placed = true;
        continue;
      }
      const part = c.type === 'tkhd' ? withDuration(c.raw, hdrLen(c), 20, 28, trackDur) : c.raw;
      trakParts.push(part);
      if (!placed) mdiaAtInTrak += part.byteLength;
    }
    const trak = box('trak', ...trakParts);
    slotIn.push({ acc: a, at: mdiaAtInTrak + minfAtInMdia + stblAtInMinf + coAtInStbl });
    traks.push(trak);
    tracks.push({ id: t.id, handler: t.handler, samples: n, sync: a.sync.n, timescale: t.timescale, duration: mediaDur });
  }

  // The moov keeps the source's order and extras (udta, meta); mvex goes, because the file is no longer fragmented.
  const parts: Uint8Array[] = [];
  const slots: Built['slots'] = [];
  let w = 8;
  let ti = 0;
  for (const k of src.kids) {
    if (k.type === 'mvex') continue;
    if (k.type === 'trak') {
      // A trak with no samples (or one whose headers could not be read) is left out.
      if (ti >= live.length || live[ti].src.box !== k) continue;
      slots.push({ acc: slotIn[ti].acc, at: w + slotIn[ti].at, wide });
      parts.push(traks[ti]);
      w += traks[ti].byteLength;
      ti++;
      continue;
    }
    const part = k.type === 'mvhd' ? withDuration(k.raw, hdrLen(k), 16, 24, movieDur) : k.raw;
    parts.push(part);
    w += part.byteLength;
  }
  if (ti !== live.length) throw new MuxError('The tracks could not be matched to the movie header.');
  return { moov: box('moov', ...parts), slots, tracks, durationMs: Math.round((movieDur / scale) * 1000) };
}

/* ------------------------------------------------------------------ a moov at the end */

/** Walks a progressive moov and hands every chunk offset to `fn`, writing back what it returns. */
function eachChunkOffset(moov: Uint8Array, hdr: number, fn: (off: number) => number) {
  const v = dv(moov);
  const walk = (body: Uint8Array, baseAt: number, path: string[]) => {
    for (const c of children(body)) {
      const at = baseAt + c.at + (c.raw.byteLength - c.body.byteLength);
      if (c.type === 'stco' || c.type === 'co64') {
        const n = u32(c.body, 4);
        const wide = c.type === 'co64';
        for (let i = 0; i < n; i++) {
          const o = at + 8 + i * (wide ? 8 : 4);
          const next = fn(wide ? u64(moov, o) : u32(moov, o));
          if (wide) put64(v, o, next);
          else {
            if (next > 0xffffffff) throw new MuxError('The file is too large to move its index.');
            v.setUint32(o, next);
          }
        }
      } else if (['trak', 'mdia', 'minf', 'stbl'].includes(c.type) && path.length < 4) walk(c.body, at, [...path, c.type]);
    }
  };
  walk(moov.subarray(hdr), hdr, []);
}

/* ------------------------------------------------------------------ reading a progressive head back */

export interface HeadTrack extends MuxTrack {
  chunks: number;
  /** Place and length of the first, middle and last chunk in the file, for a byte check against the source. */
  probes: Array<[number, number]>;
  /** Lowest and highest byte the track's samples touch. */
  first: number;
  end: number;
}

/** Reads the sample tables of a progressive head (ftyp, moov). Used to check a file after it is written, and by the tests. */
export function readHead(head: Uint8Array): { moovAt: number; moovLen: number; timescale: number; duration: number; tracks: HeadTrack[] } {
  let moov: Child | undefined;
  for (const c of children(head)) if (c.type === 'moov') moov = c;
  if (!moov) throw new MuxError('The new file has no moov.');
  const kids = children(moov.body);
  const mvhd = child(kids, 'mvhd');
  if (!mvhd) throw new MuxError('The new file has no movie header.');
  const v1 = mvhd.body[0] === 1;
  const tracks: HeadTrack[] = [];
  for (const t of kids.filter((k) => k.type === 'trak')) {
    const trak = children(t.body);
    const tkhd = child(trak, 'tkhd');
    const mdia = children(child(trak, 'mdia')?.body ?? new Uint8Array(0));
    const mdhd = child(mdia, 'mdhd');
    const hdlr = child(mdia, 'hdlr');
    const stbl = children(child(children(child(mdia, 'minf')?.body ?? new Uint8Array(0)), 'stbl')?.body ?? new Uint8Array(0));
    const stsz = child(stbl, 'stsz');
    const stsc = child(stbl, 'stsc');
    const stts = child(stbl, 'stts');
    const stss = child(stbl, 'stss');
    const co = child(stbl, 'stco') || child(stbl, 'co64');
    if (!tkhd || !mdhd || !stsz || !stsc || !stts || !co) throw new MuxError('A track in the new file is missing a table.');
    const n = u32(stsz.body, 8);
    const fixed = u32(stsz.body, 4);
    const size = (i: number) => fixed || u32(stsz.body, 12 + i * 4);
    const wide = co.type === 'co64';
    const chunks = u32(co.body, 4);
    const off = (i: number) => (wide ? u64(co.body, 8 + i * 8) : u32(co.body, 8 + i * 4));
    const rows = u32(stsc.body, 4);
    let sample = 0;
    let first = Infinity;
    let end = 0;
    const want = new Set([0, chunks >> 1, chunks - 1]);
    const probes: Array<[number, number]> = [];
    for (let r = 0; r < rows; r++) {
      const from = u32(stsc.body, 8 + r * 12) - 1;
      const per = u32(stsc.body, 12 + r * 12);
      const to = r + 1 < rows ? u32(stsc.body, 8 + (r + 1) * 12) - 1 : chunks;
      for (let c = from; c < to; c++) {
        let bytes = 0;
        for (let k = 0; k < per && sample < n; k++) bytes += size(sample++);
        const o = off(c);
        first = Math.min(first, o);
        end = Math.max(end, o + bytes);
        if (want.has(c)) probes.push([o, Math.min(bytes, 64)]);
      }
    }
    if (sample !== n) throw new MuxError('The new file lists samples no chunk holds.');
    let duration = 0;
    let timed = 0;
    const e = u32(stts.body, 4);
    for (let i = 0; i < e; i++) {
      timed += u32(stts.body, 8 + i * 8);
      duration += u32(stts.body, 8 + i * 8) * u32(stts.body, 12 + i * 8);
    }
    if (timed !== n) throw new MuxError('The new file times a different number of samples than it holds.');
    tracks.push({
      id: tkhd.body[0] === 1 ? u32(tkhd.body, 20) : u32(tkhd.body, 12),
      handler: hdlr ? fourcc(hdlr.body, 8) : '',
      samples: n,
      sync: stss ? u32(stss.body, 4) : n,
      timescale: mdhd.body[0] === 1 ? u32(mdhd.body, 20) : u32(mdhd.body, 12),
      duration,
      chunks,
      probes,
      first: n ? first : 0,
      end,
    });
  }
  return { moovAt: moov.at, moovLen: moov.raw.byteLength, timescale: v1 ? u32(mvhd.body, 20) : u32(mvhd.body, 12), duration: v1 ? u64(mvhd.body, 24) : u32(mvhd.body, 16), tracks };
}

/* ------------------------------------------------------------------ the plan */

/** Reads the source once and says what to do with it. Throws MuxError for an MP4 it cannot rewrite safely. */
export async function planMux(src: MuxSource): Promise<MuxResult> {
  const f = new Forward(src);
  try {
    let ftyp: Uint8Array | null = null;
    let ftypAt = -1;
    let moov: SrcMoov | null = null;
    let moovAt = -1;
    let moovLen = 0;
    let moovHdr = 8;
    let firstMdat = -1;
    let fragments = 0;
    const mdat: number[] = [];
    const accs = new Map<number, Acc>();
    const warn = new Set<string>();
    let boxes = 0;

    while (f.pos + 8 <= src.size) {
      const at = f.pos;
      const h = await f.take(8);
      if (h.byteLength < 8) break;
      let size = u32(h, 0);
      let hdr = 8;
      if (!isType(h, 4)) {
        if (!boxes) return { kind: 'other', reason: 'not an MP4' };
        warn.add('bytes after the last box were left out');
        break;
      }
      const type = fourcc(h, 4);
      if (size === 1) {
        const big = await f.take(8);
        if (big.byteLength < 8) break;
        size = u64(big, 0);
        hdr = 16;
      } else if (size === 0) size = src.size - at;
      if (size < hdr) {
        if (!boxes) return { kind: 'other', reason: 'not an MP4' };
        break;
      }
      boxes++;
      const bodyLen = size - hdr;
      const whole = at + size <= src.size;

      if (type === 'ftyp' && whole && bodyLen <= 4096) {
        const body = await f.take(bodyLen);
        if (!ftyp) {
          ftyp = concat([h, body]);
          ftypAt = at;
        }
      } else if (type === 'moov' && !moov) {
        if (!whole) throw new MuxError('The file ends inside its index.');
        if (bodyLen > MAX_MOOV) throw new MuxError('The index of this file is too large.');
        const raw = concat([h, hdr === 16 ? new Uint8Array(8) : new Uint8Array(0), await f.take(bodyLen)]);
        if (hdr === 16) put64(dv(raw), 8, size);
        moov = readMoov(raw, hdr);
        moovAt = at;
        moovLen = size;
        moovHdr = hdr;
        if (child(moov.kids, 'cmov')) return { kind: 'progressive', reason: 'compressed index' };
        const listed = moov.tracks.reduce((s, t) => s + t.listed, 0);
        if (listed > 0 && !moov.hasMvex) {
          if (firstMdat < 0) return { kind: 'progressive', reason: 'the index is already at the front' };
          break; // a moov after the media: move it to the front
        }
        if (listed > 0) throw new MuxError('The file mixes a full index with fragments.');
        for (const t of moov.tracks) accs.set(t.id, newAcc(t));
      } else if (type === 'moof') {
        if (!whole) {
          warn.add('the recording ends inside a fragment');
          break;
        }
        if (bodyLen > MAX_MOOF) throw new MuxError('A fragment header is too large.');
        const body = await f.take(bodyLen);
        if (!moov) throw new MuxError('A fragment came before the movie header.');
        readMoof(body, at, src.size, accs, warn);
        fragments++;
      } else if (type === 'mdat') {
        if (firstMdat < 0) firstMdat = at;
        const have = Math.min(bodyLen, src.size - (at + hdr));
        if (have > 0) mdat.push(at + hdr, have);
        await f.skip(bodyLen);
      } else {
        await f.skip(bodyLen);
      }
    }

    if (!moov) {
      if (!ftyp) return { kind: 'other', reason: 'not an MP4' };
      throw new MuxError('The file has no index.');
    }
    const head0 = ftyp ?? box('ftyp', new TextEncoder().encode('isom'), words(0x200), new TextEncoder().encode('isomiso2mp41'));

    if (!accs.size) {
      // Progressive, with the moov after the media. The new file is ftyp, the moov, then everything else as it was.
      const ext: number[] = [];
      const cut = [ftypAt >= 0 ? [ftypAt, ftyp!.byteLength] : null, [moovAt, moovLen]].filter(Boolean) as number[][];
      cut.sort((a, b) => a[0] - b[0]);
      let at = 0;
      for (const [o, len] of cut) {
        if (o > at) ext.push(at, o - at);
        at = o + len;
      }
      if (src.size > at) ext.push(at, src.size - at);
      const headLen = head0.byteLength + moovLen;
      const map = mapper(ext, headLen);
      const copy = moov.raw.slice();
      eachChunkOffset(copy, moovHdr, (off) => {
        const to = map(off);
        if (to < 0) throw new MuxError('The index points outside the file.');
        return to;
      });
      const head = concat([head0, copy]);
      const read = readHead(head);
      const total = headLen + ext.reduce((s, x, i) => (i % 2 ? s + x : s), 0);
      return {
        kind: 'tail',
        head,
        plan: { v: 1, kind: 'tail', srcSize: src.size, headLen, total, ext, tracks: read.tracks.map(({ id, handler, samples, sync, timescale, duration }) => ({ id, handler, samples, sync, timescale, duration })), durationMs: Math.round((read.duration / (read.timescale || 1000)) * 1000), fragments: 0, warn: [...warn] },
      };
    }

    if (!fragments) throw new MuxError('The file has an empty index and no fragments.');
    const list = [...accs.values()];
    const dataLen = mdat.reduce((s, x, i) => (i % 2 ? s + x : s), 0);
    const wide = dataLen + MAX_MOOV + 4096 > 0xffffffff;
    const built = buildMoov(moov, list, wide);
    const mdatHdr = wide ? concat([words(1), new TextEncoder().encode('mdat'), new Uint8Array(8)]) : concat([words(8 + dataLen), new TextEncoder().encode('mdat')]);
    if (wide) put64(dv(mdatHdr), 8, 16 + dataLen);
    const headLen = head0.byteLength + built.moov.byteLength + mdatHdr.byteLength;
    const map = mapper(mdat, headLen);
    const mv = dv(built.moov);
    for (const s of built.slots) {
      for (let i = 0; i < s.acc.chunkOff.length; i++) {
        const to = map(s.acc.chunkOff[i]);
        let bytes = 0;
        for (let k = 0; k < s.acc.chunkCount[i]; k++) bytes += s.acc.sizes.get(s.acc.chunkFirst[i] - 1 + k);
        // A run of samples must sit whole inside one mdat, or the index would point at bytes the new file does not carry.
        if (to < 0 || (bytes > 0 && map(s.acc.chunkOff[i] + bytes - 1) !== to + bytes - 1)) throw new MuxError('A fragment points outside its media data.');
        if (s.wide) put64(mv, s.at + i * 8, to);
        else mv.setUint32(s.at + i * 4, to);
      }
    }
    return {
      kind: 'frag',
      head: concat([head0, built.moov, mdatHdr]),
      plan: { v: 1, kind: 'frag', srcSize: src.size, headLen, total: headLen + dataLen, ext: mdat, tracks: built.tracks, durationMs: built.durationMs, fragments, warn: [...warn] },
    };
  } finally {
    await f.close();
  }
}

/** A plan's own numbers must agree before anything is written: the lengths add up and every sample sits inside the file. */
export function checkPlan(plan: MuxPlan, head: Uint8Array): void {
  if (head.byteLength !== plan.headLen) throw new MuxError('The new front of the file is the wrong length.');
  let data = 0;
  for (let i = 0; i < plan.ext.length; i += 2) {
    if (plan.ext[i] < 0 || plan.ext[i + 1] <= 0 || plan.ext[i] + plan.ext[i + 1] > plan.srcSize) throw new MuxError('The plan reads outside the source.');
    if (i && plan.ext[i] < plan.ext[i - 2] + plan.ext[i - 1]) throw new MuxError('The plan reads the source out of order.');
    data += plan.ext[i + 1];
  }
  if (plan.headLen + data !== plan.total) throw new MuxError('The new length does not add up.');
  const read = readHead(head);
  if (read.tracks.length !== plan.tracks.length || !read.tracks.length) throw new MuxError('The new index has the wrong tracks.');
  read.tracks.forEach((t, i) => {
    const p = plan.tracks[i];
    if (t.samples !== p.samples || t.duration !== p.duration || t.sync !== p.sync) throw new MuxError('The new index does not match what was read.');
    if (t.samples && (t.first < read.moovAt + read.moovLen || t.end > plan.total)) throw new MuxError('The new index points outside the file.');
  });
}
