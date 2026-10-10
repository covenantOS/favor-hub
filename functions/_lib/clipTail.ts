// Joins the tail pieces a recorder sent (see api/clips/[id]/tail.ts) to the whole parts already stored, so a recording that
// ended without its final part still keeps everything up to the last few seconds.
import { PART_BYTES, tailPrefix, type ClipsEnv, type PartRec } from './clips';

/** Parts 1..k with no gap, in order. R2 needs them to run without a hole. */
export function contiguous(parts: PartRec[]): PartRec[] {
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  const out: PartRec[] = [];
  for (const p of sorted) {
    if (p.n !== out.length + 1) break;
    out.push(p);
  }
  return out;
}

/** Uploads the bytes the tail holds beyond the stored parts as more parts. Returns the full part list. */
export async function foldTail(env: ClipsEnv, id: string, uploadId: string, stored: PartRec[]): Promise<PartRec[]> {
  const parts = contiguous(stored);
  const full = parts;
  const base = full.reduce((a, p) => a + p.size, 0);
  const pieces: Array<{ key: string; off: number; size: number }> = [];
  for (let cursor: string | undefined; ; ) {
    const page = await env.CLIPS.list({ prefix: tailPrefix(id), cursor, limit: 500 });
    for (const o of page.objects) pieces.push({ key: o.key, off: Number(o.key.slice(tailPrefix(id).length)), size: o.size });
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  pieces.sort((a, b) => a.off - b.off);
  let at = base;
  const chunks: Uint8Array[] = [];
  for (const p of pieces) {
    if (p.off + p.size <= at) continue;
    if (p.off > at) break; // a gap: stop at the last whole stretch
    const obj = await env.CLIPS.get(p.key);
    if (!obj) break;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const skip = at - p.off;
    chunks.push(skip ? bytes.subarray(skip) : bytes);
    at += bytes.byteLength - skip;
  }
  if (at === base) return full;
  // Only a clean boundary can take more parts: the last stored part must be a whole 8 MiB one.
  if (full.length && full[full.length - 1].size !== PART_BYTES) return full;
  const joined = new Uint8Array(at - base);
  let w = 0;
  for (const c of chunks) {
    joined.set(c, w);
    w += c.byteLength;
  }
  const mpu = env.CLIPS.resumeMultipartUpload(`clips/${id}/video`, uploadId);
  const out = [...full];
  for (let off = 0; off < joined.byteLength; off += PART_BYTES) {
    const slice = joined.subarray(off, Math.min(off + PART_BYTES, joined.byteLength));
    const n = out.length + 1;
    const up = await mpu.uploadPart(n, slice);
    out.push({ n, etag: up.etag, size: slice.byteLength });
  }
  return out;
}

export async function clearTail(env: ClipsEnv, id: string): Promise<void> {
  for (let cursor: string | undefined; ; ) {
    const page = await env.CLIPS.list({ prefix: tailPrefix(id), cursor, limit: 500 });
    if (page.objects.length) await env.CLIPS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) break;
    cursor = page.cursor;
  }
}
