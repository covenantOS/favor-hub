// Clips: makes a saved recording start playing at once. functions/_lib/clipmux.ts works out the new layout (one index at
// the front); this file runs it against R2 and D1.
//
// A clip moves through these states (hub_clips.mux):
//   ''      not looked at yet. The media route serves the file as it was recorded.
//   'plan'  the source has been read once and the new front of the file is stored (clips/<id>/mux/head, plan.json).
//           From here the media route already serves the new layout, put together from the head and the source's media
//           bytes, so the clip starts fast seconds after Stop however long it is.
//   'done'  the new file is written to clips/<id>/video.fast, checked against the source and served from there. Its bytes
//           are the same as what 'plan' served, so a player in the middle of a clip does not notice the change.
//   'final' the recording as it was first stored (clips/<id>/video) has been removed, a week after 'done'.
//   'skip'  nothing to do: WebM, or an MP4 that already starts with its index.
//   'error' the file could not be read. The clip plays as it did before; mux_info says why.
// Writing the new file is done in parts, a few per run, so a long clip is finished over several short runs. A run is
// started when a clip is saved, and again by anything that touches a clip that is not finished (watching it, the library).
import { nowIso } from './http';
import { J, videoKey, type Clip, type ClipsEnv } from './clips';
import { MuxError, checkPlan, dataRanges, planMux, readHead, type MuxPlan, type MuxTrack } from './clipmux';

export const fastKey = (id: string) => `clips/${id}/video.fast`;
export const muxHeadKey = (id: string) => `clips/${id}/mux/head`;
export const muxPlanKey = (id: string) => `clips/${id}/mux/plan.json`;

/** R2 wants every part but the last to be one size. */
export const MUX_PART_BYTES = 16 * 1024 * 1024;
/** Another run may take over a clip whose last sign of life is older than this. */
const LOCK_MS = 45_000;
/** The first recording is kept this long after the new file passes its checks. */
export const KEEP_ORIGINAL_MS = 7 * 24 * 3_600_000;
const MAX_TRIES = 3;

export type MuxState = '' | 'plan' | 'done' | 'final' | 'skip' | 'error';

export interface MuxInfo {
  kind?: 'frag' | 'tail';
  /** Length of the new file and of its head. */
  total?: number;
  headLen?: number;
  /** The ETag the media route gives the new layout, the same before and after the file is written. */
  etag?: string;
  srcEtag?: string;
  srcSize?: number;
  tracks?: MuxTrack[];
  durationMs?: number;
  fragments?: number;
  warn?: string[];
  /** The multipart upload of the new file while it is being written. */
  upload?: { id: string; partBytes: number; parts: Array<{ n: number; etag: string }> };
  reason?: string;
  error?: string;
  tries?: number;
  planMs?: number;
  copyMs?: number;
  at?: string;
}

interface StoredPlan { plan: MuxPlan; srcEtag: string }

export const muxInfo = (clip: Pick<Clip, 'mux_info'>): MuxInfo => J<MuxInfo>(clip.mux_info, {});

/** Does this clip still have work waiting? False when the columns are not there yet (db/clips-mux.sql not run). */
export function muxPending(clip: Pick<Clip, 'mux' | 'mux_at' | 'status'>, now = Date.now()): boolean {
  if (clip.mux !== '' && clip.mux !== 'plan') return false;
  if (clip.status !== 'ready' && clip.status !== 'processing') return false;
  return !clip.mux_at || now - Date.parse(clip.mux_at) > LOCK_MS;
}

/* ------------------------------------------------------------------ reading the new layout */

/** Lets through only the bytes of `ranges` (source offsets, in order) from a stream that starts at source offset `base`. */
export function squeeze(body: ReadableStream<Uint8Array>, base: number, ranges: Array<[number, number]>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let pos = base;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        if (i >= ranges.length) {
          ctrl.close();
          await reader.cancel().catch(() => undefined);
          return;
        }
        const { done, value } = await reader.read();
        if (done || !value) {
          ctrl.error(new Error('The recording ended early.'));
          return;
        }
        let sent = false;
        let o = 0;
        while (o < value.byteLength && i < ranges.length) {
          const [start, len] = ranges[i];
          const abs = pos + o;
          if (abs < start) {
            o += Math.min(value.byteLength - o, start - abs);
            continue;
          }
          const take = Math.min(value.byteLength - o, start + len - abs);
          if (take > 0) {
            ctrl.enqueue(value.subarray(o, o + take));
            sent = true;
          }
          o += take;
          if (abs + take >= start + len) i++;
        }
        pos += value.byteLength;
        if (sent) return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Bytes [start, start + length) of the new layout, read from the stored head and the source recording. */
export async function readLayout(env: ClipsEnv, id: string, plan: MuxPlan, start: number, length: number, head?: Uint8Array): Promise<ReadableStream<Uint8Array>> {
  const end = start + length;
  let front: Uint8Array | null = null;
  if (start < plan.headLen) {
    const to = Math.min(end, plan.headLen);
    if (head) front = head.subarray(start, to);
    else {
      const obj = await env.CLIPS.get(muxHeadKey(id), { range: { offset: start, length: to - start } });
      if (!obj) throw new Error('The stored head is missing.');
      front = new Uint8Array(await obj.arrayBuffer());
    }
  }
  let rest: ReadableStream<Uint8Array> | null = null;
  if (end > plan.headLen) {
    const from = Math.max(start, plan.headLen) - plan.headLen;
    const ranges = dataRanges(plan.ext, from, end - plan.headLen - from);
    if (ranges.length) {
      const first = ranges[0][0];
      const last = ranges[ranges.length - 1];
      const obj = await env.CLIPS.get(videoKey(id), { range: { offset: first, length: last[0] + last[1] - first } });
      if (!obj) throw new Error('The recording is missing.');
      // One stretch of the source needs no filtering, so R2's own stream goes straight through.
      rest = ranges.length === 1 ? (obj.body as ReadableStream<Uint8Array>) : squeeze(obj.body as ReadableStream<Uint8Array>, first, ranges);
    }
  }
  if (!front) return rest ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
  const lead = front;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let sentLead = false;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!sentLead) {
        sentLead = true;
        ctrl.enqueue(lead);
        if (!rest) ctrl.close();
        return;
      }
      if (!reader) reader = rest!.getReader();
      const { done, value } = await reader.read();
      if (done) ctrl.close();
      else ctrl.enqueue(value);
    },
    cancel(reason) {
      return reader ? reader.cancel(reason) : rest ? rest.cancel(reason) : undefined;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  const reader = stream.getReader();
  let w = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (w + value.byteLength > length) throw new Error('The recording returned more bytes than the plan holds.');
    out.set(value, w);
    w += value.byteLength;
  }
  if (w !== length) throw new Error('The recording returned fewer bytes than the plan holds.');
  return out;
}

export async function loadPlan(env: ClipsEnv, id: string): Promise<StoredPlan | null> {
  const obj = await env.CLIPS.get(muxPlanKey(id));
  if (!obj) return null;
  const got = J<StoredPlan | null>(await obj.text(), null);
  return got && got.plan && got.plan.v === 1 && Array.isArray(got.plan.ext) ? got : null;
}

/* ------------------------------------------------------------------ the job */

const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** The written file against the plan and the source: its length, its head, and the first, middle and last chunk of each track. */
async function verify(env: ClipsEnv, id: string, plan: MuxPlan, head: Uint8Array): Promise<void> {
  const obj = await env.CLIPS.head(fastKey(id));
  if (!obj || obj.size !== plan.total) throw new MuxError(`The new file is ${obj ? obj.size : 0} bytes, not ${plan.total}.`);
  const part = async (off: number, len: number) => {
    const o = await env.CLIPS.get(fastKey(id), { range: { offset: off, length: len } });
    if (!o) throw new MuxError('The new file could not be read back.');
    return new Uint8Array(await o.arrayBuffer());
  };
  const front = await part(0, plan.headLen);
  if (!same(front, head)) throw new MuxError('The new file does not start with the new index.');
  checkPlan(plan, front);
  const spots: Array<[number, number]> = readHead(front).tracks.flatMap((t) => t.probes).filter(([, len]) => len > 0);
  spots.push([Math.max(plan.headLen, plan.total - 64), Math.min(64, plan.total - plan.headLen)]);
  for (const [off, len] of spots) {
    const want = await collect(await readLayout(env, id, plan, off, len, head), len);
    if (!same(await part(off, len), want)) throw new MuxError(`The new file differs from the recording at byte ${off}.`);
  }
}

async function save(env: ClipsEnv, id: string, mux: MuxState, info: MuxInfo, extra: { lock?: string | null; size?: number; durationMs?: number } = {}): Promise<boolean> {
  const sets = ['mux = ?', 'mux_info = ?', 'mux_at = ?'];
  const args: unknown[] = [mux, JSON.stringify(info), extra.lock === undefined ? null : extra.lock];
  if (extra.size) {
    sets.push('size_bytes = ?');
    args.push(extra.size);
  }
  if (extra.durationMs) {
    sets.push('duration_ms = ?');
    args.push(extra.durationMs);
  }
  const r = await env.DB.prepare(`UPDATE hub_clips SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  return !!(r.meta && r.meta.changes);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Reads the source once and stores the new head. After this the clip is served in the new layout. */
async function planStage(env: ClipsEnv, clip: Clip, info: MuxInfo): Promise<{ mux: MuxState; info: MuxInfo }> {
  const t0 = Date.now();
  const src = await env.CLIPS.head(videoKey(clip.id));
  if (!src || !src.size) return { mux: 'error', info: { ...info, error: 'The recording is not in storage.', at: nowIso() } };
  let res;
  try {
    res = await planMux({
      size: src.size,
      open: async (offset) => {
        const obj = await env.CLIPS.get(videoKey(clip.id), { range: { offset } });
        if (!obj) throw new Error('The recording is missing.');
        return obj.body as ReadableStream<Uint8Array>;
      },
    });
    if (res.kind === 'frag' || res.kind === 'tail') checkPlan(res.plan, res.head);
  } catch (err) {
    // A file the muxer cannot read stays as it is. A storage hiccup is tried again on a later run.
    const tries = (info.tries || 0) + 1;
    const fatal = err instanceof MuxError || tries >= MAX_TRIES;
    return { mux: fatal ? 'error' : '', info: { ...info, tries, error: message(err), at: nowIso() } };
  }
  if (res.kind === 'progressive' || res.kind === 'other') return { mux: 'skip', info: { reason: res.reason, srcSize: src.size, at: nowIso() } };
  const { plan, head } = res;
  const stored: StoredPlan = { plan, srcEtag: src.etag };
  await env.CLIPS.put(muxHeadKey(clip.id), head);
  await env.CLIPS.put(muxPlanKey(clip.id), JSON.stringify(stored), { httpMetadata: { contentType: 'application/json' } });
  return {
    mux: 'plan',
    info: { kind: plan.kind, total: plan.total, headLen: plan.headLen, etag: `"${src.etag}-fs"`, srcEtag: src.etag, srcSize: src.size, tracks: plan.tracks, durationMs: plan.durationMs, fragments: plan.fragments, warn: plan.warn, planMs: Date.now() - t0, at: nowIso() },
  };
}

/** Writes parts of the new file until it is whole or the time is up. */
async function copyStage(env: ClipsEnv, clip: Clip, info: MuxInfo, deadline: number, partBytes: number): Promise<{ mux: MuxState; info: MuxInfo; size?: number; gone?: boolean }> {
  const t0 = Date.now();
  const stored = await loadPlan(env, clip.id);
  const src = await env.CLIPS.head(videoKey(clip.id));
  // The stored plan belongs to one exact source file. Without both, start over from the recording.
  if (!stored || !src || src.etag !== stored.srcEtag || src.size !== stored.plan.srcSize) {
    const tries = (info.tries || 0) + 1;
    return { mux: tries >= MAX_TRIES ? 'error' : '', info: { tries, error: 'The plan no longer matches the recording.', at: nowIso() } };
  }
  const { plan } = stored;
  const headObj = await env.CLIPS.get(muxHeadKey(clip.id));
  if (!headObj) return { mux: '', info: { tries: (info.tries || 0) + 1, error: 'The stored head is missing.', at: nowIso() } };
  const head = new Uint8Array(await headObj.arrayBuffer());
  let cur: MuxInfo = { ...info };
  try {
    if (!cur.upload) {
      const up = await env.CLIPS.createMultipartUpload(fastKey(clip.id), { httpMetadata: { contentType: clip.mime } });
      cur.upload = { id: up.uploadId, partBytes, parts: [] };
    }
    // An upload a run before this one began keeps the part size it began with.
    const size = cur.upload.partBytes || partBytes;
    const count = Math.max(1, Math.ceil(plan.total / size));
    const mpu = env.CLIPS.resumeMultipartUpload(fastKey(clip.id), cur.upload.id);
    let wrote = 0;
    while (cur.upload.parts.length < count) {
      // Every run writes at least one part, so a clip always moves forward.
      if (wrote && Date.now() > deadline) {
        cur.copyMs = (cur.copyMs || 0) + (Date.now() - t0);
        return { mux: 'plan', info: cur };
      }
      const n = cur.upload.parts.length + 1;
      const off = (n - 1) * size;
      const len = Math.min(size, plan.total - off);
      const bytes = await collect(await readLayout(env, clip.id, plan, off, len, head), len);
      const up = await mpu.uploadPart(n, bytes);
      wrote++;
      // A part that landed clears the note an earlier failed try left.
      cur = { ...cur, error: undefined, upload: { id: cur.upload.id, partBytes: size, parts: [...cur.upload.parts, { n, etag: up.etag }] } };
      // Each part is written down as it lands (the next run carries on from here) and keeps the lock alive.
      // No row means the clip was deleted while this ran.
      if (!(await save(env, clip.id, 'plan', cur, { lock: nowIso() }))) {
        await mpu.abort().catch(() => undefined);
        return { mux: 'plan', info: cur, gone: true };
      }
    }
    await mpu.complete(cur.upload.parts.map((p) => ({ partNumber: p.n, etag: p.etag })));
    await verify(env, clip.id, plan, head);
  } catch (err) {
    // The clip keeps playing from the plan. The written file is thrown away and tried again, a few times.
    console.warn('[clips] mux copy', clip.id, err);
    if (cur.upload) await env.CLIPS.resumeMultipartUpload(fastKey(clip.id), cur.upload.id).abort().catch(() => undefined);
    await env.CLIPS.delete(fastKey(clip.id)).catch(() => undefined);
    const { upload, ...rest } = cur;
    void upload;
    return { mux: 'plan', info: { ...rest, tries: (info.tries || 0) + 1, error: message(err), at: nowIso() } };
  }
  const { upload, error, tries, ...rest } = cur;
  void upload;
  void error;
  void tries;
  return { mux: 'done', info: { ...rest, copyMs: (cur.copyMs || 0) + (Date.now() - t0), at: nowIso() }, size: plan.total };
}

/**
 * One run of the job for one clip. Safe to call from anywhere, any number of times: a clip with nothing waiting, or one
 * another run holds, returns at once. Never throws. `stage: 'plan'` stops before the file is written (the fast part).
 */
export async function muxStep(env: ClipsEnv, id: string, opts: { budgetMs?: number; stage?: 'plan' | 'all'; partBytes?: number } = {}): Promise<MuxState | null> {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  try {
    let clip = await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
    if (!clip || typeof clip.mux !== 'string') return null;
    if (!muxPending(clip)) return clip.mux as MuxState;
    const t = Date.now();
    const got = await env.DB.prepare("UPDATE hub_clips SET mux_at = ? WHERE id = ? AND mux IN ('', 'plan') AND (mux_at IS NULL OR mux_at < ?)")
      .bind(new Date(t).toISOString(), id, new Date(t - LOCK_MS).toISOString()).run();
    if (!got.meta || !got.meta.changes) return clip.mux as MuxState;
    let mux = clip.mux as MuxState;
    let info = muxInfo(clip);
    try {
      if (mux === '') {
        const out = await planStage(env, clip, info);
        mux = out.mux;
        info = out.info;
        // A recording saved with no length (an upload the browser could not measure) takes the file's own.
        const alive = await save(env, id, mux, info, { lock: mux === 'plan' ? nowIso() : null, durationMs: mux === 'plan' && !clip.duration_ms ? info.durationMs : undefined });
        if (!alive) {
          await env.CLIPS.delete([muxHeadKey(id), muxPlanKey(id)]).catch(() => undefined);
          return null;
        }
      }
      if (mux === 'plan' && opts.stage !== 'plan') {
        if ((info.tries || 0) >= MAX_TRIES) {
          // Writing failed three times. The clip stays on the plan, which plays the same. A lock dated a year ahead keeps
          // later runs away; the backfill route (POST /api/clips/mux with retry) clears it.
          await save(env, id, 'plan', info, { lock: new Date(Date.now() + 365 * 24 * 3_600_000).toISOString() });
          return 'plan';
        }
        clip = (await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>()) ?? clip;
        const out = await copyStage(env, clip, info, deadline, opts.partBytes || MUX_PART_BYTES);
        if (out.gone) return null;
        mux = out.mux;
        info = out.info;
        if (mux === 'done') {
          await save(env, id, 'done', info, { lock: nowIso(), size: out.size });
          await env.CLIPS.delete([muxHeadKey(id), muxPlanKey(id)]).catch(() => undefined);
        } else {
          if (mux !== 'plan') await env.CLIPS.delete([muxHeadKey(id), muxPlanKey(id)]).catch(() => undefined);
          await save(env, id, mux, info, { lock: null });
        }
      } else if (mux === 'plan') {
        await save(env, id, mux, info, { lock: null });
      }
      return mux;
    } catch (err) {
      console.warn('[clips] mux', id, err);
      await env.DB.prepare('UPDATE hub_clips SET mux_at = NULL WHERE id = ? AND mux IN (\'\', \'plan\')').bind(id).run().catch(() => undefined);
      return mux;
    }
  } catch (err) {
    // The columns are not there yet, or D1 is down. The clip plays as it was recorded.
    console.warn('[clips] mux', id, err);
    return null;
  }
}

/** Runs steps until the clip is finished or the time is up. For waitUntil, where about 30 seconds are allowed. */
export async function muxRun(env: ClipsEnv, id: string, budgetMs = 25_000): Promise<MuxState | null> {
  const deadline = Date.now() + budgetMs;
  let state: MuxState | null = null;
  for (let i = 0; i < 4; i++) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    state = await muxStep(env, id, { budgetMs: left - 1500 });
    if (state !== '' && state !== 'plan') break;
    const row = await env.DB.prepare('SELECT mux, mux_at, mux_info, status FROM hub_clips WHERE id = ?').bind(id).first<Pick<Clip, 'mux' | 'mux_at' | 'mux_info' | 'status'>>().catch(() => null);
    // A step that failed is not tried again in the same breath; the next run that comes by takes it.
    if (!row || !muxPending(row) || muxInfo(row).error) break;
  }
  return state;
}

/**
 * Housekeeping on the way past (the library list calls it): one unfinished clip gets a run, and a first recording whose
 * new file has been in place for a week is removed.
 */
export async function muxTidy(env: ClipsEnv): Promise<void> {
  const stale = new Date(Date.now() - LOCK_MS).toISOString();
  const next = await env.DB.prepare("SELECT id FROM hub_clips WHERE mux IN ('', 'plan') AND status IN ('ready', 'processing') AND (mux_at IS NULL OR mux_at < ?) ORDER BY created_at DESC LIMIT 1")
    .bind(stale).first<{ id: string }>().catch(() => null);
  if (next) await muxRun(env, next.id, 20_000);
  const old = await env.DB.prepare("SELECT id FROM hub_clips WHERE mux = 'done' AND mux_at < ? LIMIT 3").bind(new Date(Date.now() - KEEP_ORIGINAL_MS).toISOString()).all<{ id: string }>().catch(() => null);
  for (const row of old?.results || []) {
    // Only when the new file is really there.
    if (!(await env.CLIPS.head(fastKey(row.id)))) continue;
    await env.CLIPS.delete(videoKey(row.id));
    await env.DB.prepare("UPDATE hub_clips SET mux = 'final', mux_at = ? WHERE id = ? AND mux = 'done'").bind(nowIso(), row.id).run();
  }
}

/* ------------------------------------------------------------------ serving */

/** A stream this code builds has no length of its own; this gives the response one, so the player gets Content-Length. */
function fixed(stream: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const F = (globalThis as { FixedLengthStream?: new (n: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).FixedLengthStream;
  if (!F) return stream;
  const f = new F(length);
  stream.pipeTo(f.writable).catch(() => undefined);
  return f.readable;
}

export interface Served {
  size: number;
  etag: string;
  /** Bytes [start, start + length) of the clip as viewers get it. */
  read(start: number, length: number): Promise<ReadableStream<Uint8Array> | null>;
}

/**
 * The clip's video as it should be served right now: the written new file, the new layout put together from the plan, or
 * the recording as stored. Each falls back to the next when its files are not there, so a clip always plays.
 */
export async function servedVideo(env: ClipsEnv, clip: Clip): Promise<Served | null> {
  const info = muxInfo(clip);
  if (clip.mux === 'done' || clip.mux === 'final') {
    const head = await env.CLIPS.head(fastKey(clip.id));
    if (head) {
      return {
        size: head.size,
        etag: info.etag || head.httpEtag,
        read: async (start, length) => (await env.CLIPS.get(fastKey(clip.id), { range: { offset: start, length } }))?.body ?? null,
      };
    }
  }
  if (clip.mux === 'plan') {
    const stored = await loadPlan(env, clip.id).catch(() => null);
    if (stored && info.etag) {
      const { plan } = stored;
      return { size: plan.total, etag: info.etag, read: async (start, length) => fixed(await readLayout(env, clip.id, plan, start, length), length) };
    }
  }
  return storedVideo(env, clip.id);
}

/** The recording exactly as it was stored. Null once it has been removed. */
export async function storedVideo(env: ClipsEnv, id: string): Promise<Served | null> {
  const head = await env.CLIPS.head(videoKey(id));
  if (!head) return null;
  return {
    size: head.size,
    etag: head.httpEtag,
    read: async (start, length) => (await env.CLIPS.get(videoKey(id), { range: { offset: start, length } }))?.body ?? null,
  };
}
