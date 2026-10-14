// Meetings: cutting stretches out of a recording that is already in Google Drive.
// A host or hub admin removes a stretch on the notes page (see cutSection). For each Drive file the stretch touches, a job here reads
// the file as it was (a pinned revision), writes it again without the stretch (webmtrim.ts), and uploads the new bytes to the same
// file, so every link keeps working. The upload is a resumable session, finished only when the whole file is written, so the file
// stays as it was until the last part lands. Then every older version is deleted from Drive's version history. If Drive refuses
// that, the new file is copied (a copy has no history), links move to the copy, and the old file is trashed.
// No copy of the recording is kept anywhere else: the job reads Drive and writes Drive, holding at most one window in memory and up
// to 256 KB between windows in R2 (meet/<id>/trim/<epoch>.carry), deleted when the job ends.
import { saToken } from './work/sheetsa';
import { nowIso } from './http';
import type { MeetEnv, Meeting } from './meet';
import { newState, throughTrims, trimWindow, type Cut, type TrimState } from './webmtrim';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const WIN = 12 * 1024 * 1024;
const QUANTUM = 256 * 1024;
const LEASE_MS = 90_000;
const STEP_MS = 20_000;

type TEnv = MeetEnv & { MEET_DRIVE_FOLDER?: string };
type Job = { meeting_id: string; epoch: number; file_id: string; rev: string; src_size: number; cuts: string; holes: string; session_url: string; out_sent: number; st: string; state: string; tries: number };

const tok = (env: TEnv) => saToken(env as never, fetch, 'https://www.googleapis.com/auth/drive');
const startOf = (m: Pick<Meeting, 'started_at' | 'created_at'>) => Date.parse(m.started_at || m.created_at) || 0;
const carryKey = (id: string, epoch: number) => `meet/${id}/trim/${epoch}.carry`;

// Infinity does not survive JSON, so an open end is written as null.
const enc = (st: TrimState) => JSON.stringify({ ...st, removed: st.removed.map(([a, b]) => [a, b === Infinity ? null : b]) });
const dec = (s: string): TrimState => { const o = JSON.parse(s); o.removed = (o.removed || []).map(([a, b]: [number, number | null]) => [a, b == null ? Infinity : b]); return o; };
const cutsOf = (s: string): Cut[] => (JSON.parse(s) as Array<[number, number | null]>).map(([a, b]) => [a, b == null ? Infinity : b]);

/** Merges stretches that touch, sorted, in seconds from the start of the meeting. to null runs to the end. */
export function mergeRanges(ranges: Array<{ from: number; to: number | null }>): Array<{ from: number; to: number | null }> {
  const r = ranges.map((x) => ({ from: Math.max(0, x.from), to: x.to })).sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number | null }> = [];
  for (const x of r) {
    const p = out[out.length - 1];
    if (p && (p.to == null || x.from <= p.to)) { if (p.to != null) p.to = x.to == null ? null : Math.max(p.to, x.to); continue; }
    out.push({ ...x });
  }
  return out;
}

/** Where each recording file starts in the meeting (ms), where it ends, and the byte offsets where pieces were never stored. */
async function epochInfo(env: TEnv, m: Meeting, epoch: number) {
  const rows = (await env.DB.prepare('SELECT seq, t0, t1, bytes FROM hub_meeting_chunks WHERE meeting_id = ? AND epoch = ? ORDER BY seq').bind(m.id, epoch).all<{ seq: number; t0: number; t1: number; bytes: number }>()).results || [];
  const holes: number[] = [];
  let off = 0, prev = -1;
  for (const r of rows) { if (prev >= 0 && r.seq !== prev + 1) holes.push(off); off += r.bytes; prev = r.seq; }
  const t0 = rows.length ? rows[0].t0 - startOf(m) : 0;
  const t1 = rows.length ? rows[rows.length - 1].t1 - startOf(m) : Infinity;
  return { start: t0, end: t1, holes, bytes: off };
}

/**
 * Queues the cut of the given stretches (seconds from the start of the meeting) from every recording file they touch. A file the
 * stretches cover whole is returned in `whole` for the caller to delete. Returns the number of files queued.
 */
export async function queueTrim(env: TEnv, m: Meeting, ranges: Array<{ from: number; to: number | null }>, by: string): Promise<{ queued: number; whole: string[]; busy: boolean }> {
  const files = (await env.DB.prepare(`SELECT epoch, file_id, trims FROM hub_meeting_drive WHERE meeting_id = ? AND state = 'done' AND file_id != '' ORDER BY epoch`).bind(m.id).all<{ epoch: number; file_id: string; trims: string }>()).results || [];
  const running = await env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_meeting_trim WHERE meeting_id = ? AND state = 'run'`).bind(m.id).first<{ n: number }>();
  if (running?.n) return { queued: 0, whole: [], busy: true };
  let queued = 0;
  const whole: string[] = [];
  for (const f of files) {
    const info = await epochInfo(env, m, f.epoch);
    const trims = JSON.parse(f.trims || '[]') as Array<Array<[number, number | null]>>;
    const cuts: Array<[number, number | null]> = [];
    for (const r of mergeRanges(ranges)) {
      const a = r.from * 1000 - info.start, b = r.to == null ? Infinity : r.to * 1000 - info.start;
      if (b <= 0 || a >= info.end - info.start) continue;
      const a2 = throughTrims(Math.max(0, a), trims), b2 = b === Infinity ? Infinity : throughTrims(b, trims);
      if (b2 <= a2) continue;
      cuts.push([a2, b2 === Infinity ? null : b2]);
    }
    if (!cuts.length) continue;
    if (cuts.length === 1 && cuts[0][0] <= 0 && (cuts[0][1] == null || cuts[0][1] >= throughTrims(info.end - info.start, trims))) { whole.push(f.file_id); continue; }
    await env.DB.prepare(`INSERT OR REPLACE INTO hub_meeting_trim (meeting_id, epoch, file_id, cuts, holes, state, by_email, at) VALUES (?, ?, ?, ?, ?, 'run', ?, ?)`)
      .bind(m.id, f.epoch, f.file_id, JSON.stringify(cuts), JSON.stringify(trims.length ? [] : info.holes), by.toLowerCase(), nowIso()).run();
    queued++;
  }
  if (queued) await env.DB.prepare(`UPDATE hub_meetings SET rec_state = 'trimming' WHERE id = ?`).bind(m.id).run();
  return { queued, whole, busy: false };
}

async function restart(env: TEnv, j: Job, why: string) {
  await env.CLIPS.delete(carryKey(j.meeting_id, j.epoch)).catch(() => undefined);
  await env.DB.prepare(`UPDATE hub_meeting_trim SET session_url = '', out_sent = 0, st = '', rev = '', tries = tries + 1, error = ?, lease = 0 WHERE meeting_id = ? AND epoch = ?`).bind(why.slice(0, 200), j.meeting_id, j.epoch).run();
}

/** Starts the upload session on the same file, pinned to the revision being read. */
async function open(env: TEnv, j: Job): Promise<Job> {
  const t = await tok(env);
  const meta = await fetch(`${FILES}/${encodeURIComponent(j.file_id)}?supportsAllDrives=true&fields=id,size,mimeType,headRevisionId`, { headers: { Authorization: `Bearer ${t}` } });
  const mj = (await meta.json().catch(() => ({}))) as { size?: string; mimeType?: string; headRevisionId?: string };
  if (!meta.ok || !mj.headRevisionId) throw new Error(`drive file ${meta.status}`);
  const r = await fetch(`${UPLOAD}/${encodeURIComponent(j.file_id)}?uploadType=resumable&supportsAllDrives=true&fields=id,size,headRevisionId`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mj.mimeType || 'video/webm' },
    body: '{}',
  });
  const url = r.headers.get('Location');
  if (!r.ok || !url) throw new Error(`drive session ${r.status}`);
  const st = newState();
  await env.DB.prepare(`UPDATE hub_meeting_trim SET rev = ?, src_size = ?, session_url = ?, out_sent = 0, st = ? WHERE meeting_id = ? AND epoch = ?`).bind(mj.headRevisionId, Number(mj.size) || 0, url, enc(st), j.meeting_id, j.epoch).run();
  return { ...j, rev: mj.headRevisionId, src_size: Number(mj.size) || 0, session_url: url, out_sent: 0, st: enc(st) };
}

async function readRange(env: TEnv, j: Job, from: number, to: number): Promise<Uint8Array> {
  const t = await tok(env);
  const r = await fetch(`${FILES}/${encodeURIComponent(j.file_id)}/revisions/${encodeURIComponent(j.rev)}?alt=media`, { headers: { Authorization: `Bearer ${t}`, Range: `bytes=${from}-${to - 1}` } });
  if (r.status !== 206 && r.status !== 200) throw new Error(`drive read ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  return r.status === 200 ? buf.subarray(from, to) : buf;
}

/** Sends bytes to the session. last: the file ends with these bytes. Returns the finished file's JSON when last. */
async function send(env: TEnv, j: Job, body: Uint8Array, last: boolean): Promise<Record<string, string> | null> {
  const t = await tok(env);
  const a = j.out_sent, total = a + body.length;
  const range = body.length ? `bytes ${a}-${total - 1}/${last ? total : '*'}` : `bytes */${total}`;
  const r = await fetch(j.session_url, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Range': range, 'Content-Length': String(body.length) }, body: body.length ? body : null });
  if (!last) {
    if (r.status !== 308) throw Object.assign(new Error(`drive put ${r.status}`), { status: r.status });
    const got = r.headers.get('Range');
    if (got && Number(got.split('-')[1]) + 1 !== total) throw Object.assign(new Error(`drive kept ${got} of ${total}`), { status: 409 });
    return null;
  }
  if (!r.ok) throw Object.assign(new Error(`drive put ${r.status}`), { status: r.status });
  return (await r.json().catch(() => ({}))) as Record<string, string>;
}

/** Deletes every version of the file but the current one. Returns false when Drive refuses. */
async function dropHistory(env: TEnv, fileId: string): Promise<boolean> {
  const t = await tok(env);
  const r = await fetch(`${FILES}/${encodeURIComponent(fileId)}/revisions?fields=revisions(id)&pageSize=200`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return false;
  const revs = ((await r.json()) as { revisions?: Array<{ id: string }> }).revisions || [];
  let ok = true;
  for (const v of revs.slice(0, -1)) {
    const d = await fetch(`${FILES}/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(v.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    if (!d.ok && d.status !== 404) ok = false;
  }
  return ok;
}

/** When the history cannot be deleted: a copy of the new file (no history) takes the old file's place, and the old one is trashed. */
async function replaceWithCopy(env: TEnv, m: Meeting, epoch: number, fileId: string): Promise<string> {
  const t = await tok(env);
  const meta = (await (await fetch(`${FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=name,parents`, { headers: { Authorization: `Bearer ${t}` } })).json()) as { name?: string; parents?: string[] };
  const c = await fetch(`${FILES}/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true&fields=id`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: meta.name, parents: meta.parents }) });
  const cj = (await c.json().catch(() => ({}))) as { id?: string };
  if (!c.ok || !cj.id) throw new Error(`drive copy ${c.status}`);
  await fetch(`${FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  await env.DB.prepare('UPDATE hub_meeting_drive SET file_id = ? WHERE meeting_id = ? AND epoch = ?').bind(cj.id, m.id, epoch).run();
  await env.DB.prepare('UPDATE hub_meetings SET drive_file_id = ? WHERE id = ? AND drive_file_id = ?').bind(cj.id, m.id, fileId).run();
  return cj.id;
}

export interface TrimProgress { done: boolean; progress: string; finished?: Array<{ epoch: number; removedMs: number; history: 'deleted' | 'copied' }> }

/**
 * One turn of work on the meeting's cut jobs: windows of the file are read, cut and uploaded for up to 20 seconds. A lease keeps two
 * callers (the notes page and the request that queued the job) from working on the same job at once.
 */
export async function pumpTrim(env: TEnv, m: Meeting, opts: { forget?: (ids: string[]) => Promise<unknown> } = {}): Promise<TrimProgress> {
  const until = Date.now() + STEP_MS;
  const finished: NonNullable<TrimProgress['finished']> = [];
  for (;;) {
    const now = Date.now();
    const lease = await env.DB.prepare(`UPDATE hub_meeting_trim SET lease = ? WHERE rowid = (SELECT rowid FROM hub_meeting_trim WHERE meeting_id = ? AND state = 'run' AND lease < ? ORDER BY epoch LIMIT 1) RETURNING *`).bind(now + LEASE_MS, m.id, now).first<Job>();
    if (!lease) break;
    let j = lease;
    try {
      if (j.tries >= 6) throw Object.assign(new Error('gave up'), { fatal: true });
      if (!j.session_url) j = await open(env, j);
      const cuts = cutsOf(j.cuts);
      const holes = JSON.parse(j.holes || '[]') as number[];
      let st = dec(j.st);
      let carry = new Uint8Array(await (await env.CLIPS.get(carryKey(m.id, j.epoch)))?.arrayBuffer() ?? new ArrayBuffer(0));
      while (!st.done && Date.now() < until) {
        let size = WIN, out: Uint8Array;
        for (;;) {
          const to = Math.min(j.src_size, st.pos + size);
          const eof = to >= j.src_size;
          const before = st.pos;
          const buf = st.pos < j.src_size ? await readRange(env, j, st.pos, to) : new Uint8Array(0);
          const trial = { ...st, removed: [...st.removed] };
          out = trimWindow(buf, eof, trial, cuts, holes);
          if (trial.pos !== before || trial.done) { st = trial; break; }
          if (size >= 64 * 1024 * 1024) throw new Error('a cluster larger than 64 MB');
          size *= 2;
        }
        const all = new Uint8Array(carry.length + out.length); all.set(carry, 0); all.set(out, carry.length);
        if (st.done) {
          const res = await send(env, j, all, true);
          if (Number(res?.size) !== j.out_sent + all.length) throw new Error(`drive size ${res?.size} against ${j.out_sent + all.length}`);
          j.out_sent += all.length; carry = new Uint8Array(0);
          break;
        }
        const n = Math.floor(all.length / QUANTUM) * QUANTUM;
        if (n) { await send(env, j, all.subarray(0, n), false); j.out_sent += n; }
        carry = all.slice(n);
        await env.CLIPS.put(carryKey(m.id, j.epoch), carry);
        await env.DB.prepare(`UPDATE hub_meeting_trim SET out_sent = ?, st = ?, lease = ? WHERE meeting_id = ? AND epoch = ?`).bind(j.out_sent, enc(st), Date.now() + LEASE_MS, m.id, j.epoch).run();
      }
      if (!st.done) {
        await env.DB.prepare(`UPDATE hub_meeting_trim SET lease = 0 WHERE meeting_id = ? AND epoch = ?`).bind(m.id, j.epoch).run();
        break;
      }
      // The new file is in place. The older versions go, and the cut is noted on the file so a later cut lands in the right place.
      await env.CLIPS.delete(carryKey(m.id, j.epoch)).catch(() => undefined);
      let fileId = j.file_id;
      let history: 'deleted' | 'copied' = 'deleted';
      if (!(await dropHistory(env, j.file_id))) { fileId = await replaceWithCopy(env, m, j.epoch, j.file_id); history = 'copied'; }
      const ms = st.scale / 1e6;
      const removed = st.removed.map(([a, b]) => [Math.round(a * ms), b === Infinity ? null : Math.round(b * ms)]);
      const row = await env.DB.prepare('SELECT trims FROM hub_meeting_drive WHERE meeting_id = ? AND epoch = ?').bind(m.id, j.epoch).first<{ trims: string }>();
      const trims = JSON.parse(row?.trims || '[]');
      trims.push(removed);
      await env.DB.prepare('UPDATE hub_meeting_drive SET trims = ?, total_bytes = ?, sent_bytes = ? WHERE meeting_id = ? AND epoch = ?').bind(JSON.stringify(trims), j.out_sent, j.out_sent, m.id, j.epoch).run();
      await env.DB.prepare(`UPDATE hub_meeting_trim SET state = 'done', st = ?, out_sent = ?, lease = 0, error = '' WHERE meeting_id = ? AND epoch = ?`).bind(enc(st), j.out_sent, m.id, j.epoch).run();
      if (opts.forget) await opts.forget([j.file_id, fileId]).catch(() => undefined);
      finished.push({ epoch: j.epoch, removedMs: removed.reduce((s, [a, b]) => s + ((b ?? a) - a), 0), history });
    } catch (err) {
      const e = err as { status?: number; fatal?: boolean; message?: string };
      console.warn('[meet] trim', m.id, j.epoch, e.message);
      if (e.fatal) {
        await env.CLIPS.delete(carryKey(m.id, j.epoch)).catch(() => undefined);
        await env.DB.prepare(`UPDATE hub_meeting_trim SET state = 'failed', lease = 0 WHERE meeting_id = ? AND epoch = ?`).bind(m.id, j.epoch).run();
      } else if (e.status === 404 || e.status === 410 || e.status === 409 || e.status === 400) {
        await restart(env, j, String(e.message));
      } else {
        await env.DB.prepare(`UPDATE hub_meeting_trim SET tries = tries + 1, error = ?, lease = 0 WHERE meeting_id = ? AND epoch = ?`).bind(String(e.message).slice(0, 200), m.id, j.epoch).run();
      }
      break;
    }
    if (Date.now() >= until) break;
  }
  const left = (await env.DB.prepare(`SELECT state, src_size, st FROM hub_meeting_trim WHERE meeting_id = ? AND state = 'run'`).bind(m.id).all<{ state: string; src_size: number; st: string }>()).results || [];
  if (!left.length) {
    await env.DB.prepare(`UPDATE hub_meetings SET rec_state = 'stored' WHERE id = ? AND rec_state = 'trimming'`).bind(m.id).run();
    return { done: true, progress: 'done', finished };
  }
  const pct = Math.round(100 * left.reduce((s, r) => s + (r.st ? dec(r.st).pos : 0), 0) / Math.max(1, left.reduce((s, r) => s + (r.src_size || 0), 0)));
  return { done: false, progress: `${Math.min(99, pct)}%`, finished };
}

/** Where the cut jobs stand, for the notes page. */
export async function trimStatus(env: TEnv, id: string): Promise<{ running: boolean; failed: boolean }> {
  const r = (await env.DB.prepare(`SELECT state FROM hub_meeting_trim WHERE meeting_id = ?`).bind(id).all<{ state: string }>().catch(() => ({ results: [] as Array<{ state: string }> }))).results || [];
  return { running: r.some((x) => x.state === 'run'), failed: r.some((x) => x.state === 'failed') };
}
