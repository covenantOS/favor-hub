// Clips: list the library (with a search that reads titles, summaries and what was said), start a new upload.
import { asTrimmed, handleError, json, nowIso } from '../../_lib/http';
import { PART_BYTES, STALE_UPLOAD_MS, adminOrError, cleanKind, cleanMime, clipId, extFor, videoKey, J, type Clip, type ClipsEnv } from '../../_lib/clips';
import type { ClipSegment } from '../../_lib/clipChapters';

/** The first transcript line that holds the search words, for the library's result row. */
function snippet(transcript: string, q: string): { at: number; text: string } | null {
  const needle = q.toLowerCase();
  for (const s of J<ClipSegment[]>(transcript, [])) if (s.t.toLowerCase().includes(needle)) return { at: s.s, text: s.t };
  return null;
}

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
    const mine = url.searchParams.get('mine') === '1';
    const where = ["status IN ('ready', 'processing')"];
    const args: unknown[] = [];
    if (mine) {
      where.push('owner_email = ?');
      args.push(who.user.email);
    }
    if (q) {
      const pat = `%${q.replace(/[%_\\]/g, '')}%`;
      where.push('(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(transcript) LIKE ?)');
      args.push(pat, pat, pat);
    }
    const rows = await env.DB.prepare(
      `SELECT id, owner_email, owner_name, title, summary, status, share, kind, size_bytes, duration_ms, has_poster, views, created_at${q ? ', transcript' : ''} FROM hub_clips WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`
    ).bind(...args).all<Clip>();
    const clips = (rows.results || []).map((c) => {
      const { transcript, owner_email, ...rest } = c;
      return { ...rest, mine: owner_email === who.user.email, match: q ? snippet(transcript || '', q) : null };
    });
    // Recordings that never finished and were never picked up: tidy them away on the way past.
    void tidy(env).catch(() => undefined);
    return json({ ok: true, clips }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};

async function tidy(env: ClipsEnv) {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const stale = await env.DB.prepare("SELECT id, upload_id FROM hub_clips WHERE status = 'uploading' AND updated_at < ? LIMIT 5").bind(cutoff).all<{ id: string; upload_id: string | null }>();
  for (const row of stale.results || []) {
    if (row.upload_id) await env.CLIPS.resumeMultipartUpload(videoKey(row.id), row.upload_id).abort().catch(() => undefined);
    for (let cursor: string | undefined; ; ) {
      const page = await env.CLIPS.list({ prefix: `clips/${row.id}/`, cursor, limit: 500 });
      if (page.objects.length) await env.CLIPS.delete(page.objects.map((o) => o.key));
      if (!page.truncated) break;
      cursor = page.cursor;
    }
    await env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(row.id).run();
  }
}

// Starts a multipart upload. The browser then PUTs parts while it records and posts complete.
export const onRequestPost: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = adminOrError(request);
    if ('res' in who) return who.res;
    const body = (await request.json().catch(() => ({}))) as { title?: string; mime?: string; kind?: string };
    const given = asTrimmed(body.title, 'title', 120, false);
    const mime = cleanMime(body.mime);
    const id = clipId();
    const upload = await env.CLIPS.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: mime } });
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO hub_clips (id, owner_email, owner_name, title, title_auto, status, share, mime, kind, upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)'
    ).bind(id, who.user.email, who.user.name, given, given ? 0 : 1, 'uploading', mime, cleanKind(body.kind), upload.uploadId, now, now).run();
    return json({ ok: true, id, ext: extFor(mime), partBytes: PART_BYTES }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
