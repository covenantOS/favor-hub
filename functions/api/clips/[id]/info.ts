// Everything the watch page needs. A signed-out viewer through the share link gets the video's words and nothing
// else: no comments, reactions or viewers. Signed-in staff also get those; an admin also gets the manage controls.
import { errorJson, handleError, json } from '../../../_lib/http';
import { ID_RE, J, PRIVATE, clipPeople, clipView, isWatchable, canWatch, levelOf, postedIn, publicToken, type Clip, type ClipsEnv } from '../../../_lib/clips';
import { hubUserOf } from '../../../_lib/session';
import { ensureChapters } from '../../../_lib/clipMake';
import { clipHighlights } from '../../../_lib/clipHighlights';
import type { ClipChapter, ClipSegment } from '../../../_lib/clipChapters';

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const id = String(params.id);
    const user = hubUserOf(request);
    const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>() : null;
    if (!clip || !isWatchable(clip) || !(await canWatch(env, request, clip))) {
      return user ? errorJson('not_found', 'That clip is gone.', 404) : new Response(JSON.stringify({ ok: false, error: 'signin' }), { status: 401, headers: { ...PRIVATE, 'Content-Type': 'application/json' } });
    }
    // A ready clip with words and no chapters gets them the first time anyone opens it.
    const chapters = await ensureChapters(env, clip).catch(() => J<ClipChapter[]>(clip.chapters, []));
    clip.chapters = JSON.stringify(chapters);
    const out: Record<string, unknown> = { ok: true, clip: clipView(clip), user: user ? { email: user.email, name: user.name, admin: user.role === 'admin' } : null };
    out.highlights = clipHighlights(J<ClipSegment[]>(clip.transcript, []), chapters, clip.duration_ms / 1000);
    // Outside the hub the video and its poster come through signed links that expire.
    if (!user || user.role === 'field') {
      const k = await publicToken(env, clip.id, 'v');
      out.media = k ? { video: `/api/clips/${clip.id}/media?k=${k}`, poster: `/api/clips/${clip.id}/media?poster=1&k=${k}` } : null;
    }
    if (user && user.role !== 'field') {
      const [comments, reactions, views] = await Promise.all([
        env.DB.prepare('SELECT id, at_seconds, author_email, author_name, body, created_at FROM hub_clip_comments WHERE clip_id = ? ORDER BY at_seconds, created_at LIMIT 500').bind(id).all(),
        env.DB.prepare('SELECT id, emoji, at_seconds, person_email, person_name, created_at FROM hub_clip_reactions WHERE clip_id = ? ORDER BY at_seconds LIMIT 500').bind(id).all(),
        env.DB.prepare('SELECT person_email, person_name, at, seconds FROM hub_clip_views WHERE clip_id = ? ORDER BY at DESC LIMIT 300').bind(id).all<{ person_email: string; person_name: string; at: string; seconds: number }>(),
      ]);
      const seen = new Map<string, { email: string; name: string; at: string; seconds: number; plays: number }>();
      for (const v of views.results || []) {
        if (v.person_email === clip.owner_email) continue;
        const cur = seen.get(v.person_email);
        if (!cur) seen.set(v.person_email, { email: v.person_email, name: v.person_name, at: v.at, seconds: v.seconds, plays: 1 });
        else {
          cur.seconds = Math.max(cur.seconds, v.seconds);
          cur.plays++;
        }
      }
      out.highlights = clipHighlights(J<ClipSegment[]>(clip.transcript, []), chapters, clip.duration_ms / 1000, ((reactions.results || []) as Array<{ at_seconds: number }>).map((r) => Number(r.at_seconds)));
      out.comments = comments.results || [];
      out.reactions = reactions.results || [];
      out.views = clip.views;
      // The person who made the clip edits it. An admin may delete any clip to clear space, and nothing else.
      const mine = clip.owner_email === user.email;
      const admin = user.role === 'admin';
      // Who watched, and for how long, goes to the owner and admins. Other staff with the link do not see it.
      if (mine || admin) {
        out.viewers = [...seen.values()];
        out.people = await clipPeople(env, clip.id);
      }
      // The conversations the clip was posted in, for the person who made it (who is in them is their own business).
      if (mine) out.postedIn = await postedIn(env, clip.id);
      out.can = { edit: mine, delete: mine || admin, share: mine };
      out.level = levelOf(clip);
      out.mine = mine;
      if (mine) {
        out.helpDraft = clip.help_draft;
        out.seen = J<unknown[]>(clip.seen, []);
      }
    }
    return json(out, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
