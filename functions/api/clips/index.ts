// Clips: list the library (with a search that reads titles, summaries and what was said), start a new upload.
import { asTrimmed, errorJson, handleError, json, nowIso } from '../../_lib/http';
import { CAP_BYTES, PART_BYTES, STALE_UPLOAD_MS, staffOrError, teamOf, usageOf, purgeClip, cleanKind, cleanMime, clipId, extFor, videoKey, J, type Clip, type ClipsEnv } from '../../_lib/clips';
import type { ClipSegment } from '../../_lib/clipChapters';

/** The first transcript line that holds the search words, for the library's result row. */
function snippet(transcript: string, q: string): { at: number; text: string } | null {
  const needle = q.toLowerCase();
  for (const s of J<ClipSegment[]>(transcript, [])) if (s.t.toLowerCase().includes(needle)) return { at: s.s, text: s.t };
  return null;
}

export const onRequestGet: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
    // Everyone sees their own clips. An admin can open the admin view (?scope=all) to see every person's clips.
    const all = url.searchParams.get('scope') === 'all';
    if (all && who.user.role !== 'admin') return errorJson('forbidden', 'The all-clips view is for hub admins.', 403);
    const where = ["status IN ('ready', 'processing')"];
    const args: unknown[] = [];
    if (!all) {
      where.push('owner_email = ?');
      args.push(who.user.email);
    }
    const pat = `%${q.replace(/[%_\\]/g, '')}%`;
    if (q) {
      // What was said and what was on screen are searched in a person's own library only. The admin view reads titles and summaries.
      if (all) {
        where.push('(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(owner_name) LIKE ?)');
        args.push(pat, pat, pat);
      } else {
        where.push('(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(transcript) LIKE ? OR id IN (SELECT clip_id FROM hub_clip_frames WHERE LOWER(text) LIKE ? OR LOWER(app) LIKE ? OR LOWER(page) LIKE ?))');
        args.push(pat, pat, pat, pat, pat, pat);
      }
    }
    const rows = await env.DB.prepare(
      `SELECT id, owner_email, owner_name, owner_team, title, summary, status, share, kind, size_bytes, duration_ms, has_poster, views, created_at${q && !all ? ', transcript' : ''} FROM hub_clips WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`
    ).bind(...args).all<Clip>();
    const hits = new Map<string, { at: number; text: string }>();
    if (q && !all) {
      // The first matching spot on screen, for the library's result row.
      const f = await env.DB.prepare('SELECT clip_id, t_ms, app, page, text FROM hub_clip_frames WHERE clip_id IN (SELECT id FROM hub_clips WHERE owner_email = ?) AND (LOWER(text) LIKE ? OR LOWER(app) LIKE ? OR LOWER(page) LIKE ?) ORDER BY t_ms LIMIT 300').bind(who.user.email, pat, pat, pat).all<{ clip_id: string; t_ms: number; app: string; page: string; text: string }>();
      for (const r of f.results || []) {
        if (hits.has(r.clip_id)) continue;
        const i = r.text.toLowerCase().indexOf(q);
        const near = i >= 0 ? r.text.slice(Math.max(0, i - 40), i + q.length + 60) : [r.app, r.page].filter(Boolean).join(', ');
        hits.set(r.clip_id, { at: r.t_ms / 1000, text: `On screen: ${near}` });
      }
    }
    const clips = (rows.results || []).map((c) => {
      const { transcript, owner_email, ...rest } = c;
      const word = q && !all ? snippet(transcript || '', q) : null;
      return { ...rest, ...(all ? { owner_email } : {}), mine: owner_email === who.user.email, match: word || hits.get(c.id) || null };
    });
    // Recordings that never finished and were never picked up: tidy them away on the way past.
    void tidy(env).catch(() => undefined);
    const out: Record<string, unknown> = { ok: true, clips, scope: all ? 'all' : 'mine' };
    if (all) {
      const ppl = await env.DB.prepare(
        `SELECT c.owner_email AS email, MAX(c.owner_name) AS name, MAX(c.owner_team) AS team, COUNT(*) AS clips, COALESCE(SUM(c.size_bytes), 0) AS bytes, COALESCE(MAX(u.blocked), 0) AS blocked
           FROM hub_clips c LEFT JOIN hub_users u ON u.email = c.owner_email WHERE c.status != 'failed' GROUP BY c.owner_email ORDER BY bytes DESC LIMIT 100`
      ).all();
      out.people = ppl.results || [];
      out.cap = CAP_BYTES;
    } else {
      out.usage = await usageOf(env, who.user.email);
    }
    return json(out, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};

async function tidy(env: ClipsEnv) {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const stale = await env.DB.prepare("SELECT id, upload_id FROM hub_clips WHERE status = 'uploading' AND updated_at < ? LIMIT 5").bind(cutoff).all<{ id: string; upload_id: string | null }>();
  for (const row of stale.results || []) {
    if (row.upload_id) await env.CLIPS.resumeMultipartUpload(videoKey(row.id), row.upload_id).abort().catch(() => undefined);
    await purgeClip(env, row.id);
    await env.DB.prepare('DELETE FROM hub_clip_frames WHERE clip_id = ?').bind(row.id).run();
    await env.DB.prepare('DELETE FROM hub_clips WHERE id = ?').bind(row.id).run();
  }
}

// Starts a multipart upload. The browser then PUTs parts while it records and posts complete.
export const onRequestPost: PagesFunction<ClipsEnv> = async ({ request, env }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const body = (await request.json().catch(() => ({}))) as { title?: string; mime?: string; kind?: string };
    const use = await usageOf(env, who.user.email);
    if (use.full) return errorJson('storage_full', 'Your clips use all 10 GB. Delete clips you no longer need in My clips, then record again.', 409);
    const given = asTrimmed(body.title, 'title', 120, false);
    const mime = cleanMime(body.mime);
    const id = clipId();
    const upload = await env.CLIPS.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: mime } });
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO hub_clips (id, owner_email, owner_name, owner_team, title, title_auto, status, share, mime, kind, upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)'
    ).bind(id, who.user.email, who.user.name, await teamOf(env, who.user.email), given, given ? 0 : 1, 'uploading', mime, cleanKind(body.kind), upload.uploadId, now, now).run();
    return json({ ok: true, id, ext: extFor(mime), partBytes: PART_BYTES }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
