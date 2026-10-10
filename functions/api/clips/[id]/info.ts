// Everything the watch page needs. A signed-out viewer through the share link gets the video's words and nothing
// else: no comments, reactions or viewers. Signed-in staff also get those; an admin also gets the manage controls.
import { errorJson, handleError, json } from '../../../_lib/http';
import { ID_RE, PRIVATE, clipView, isWatchable, mayWatch, type Clip, type ClipsEnv } from '../../../_lib/clips';
import { hubUserOf } from '../../../_lib/session';

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const id = String(params.id);
    const user = hubUserOf(request);
    const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>() : null;
    if (!clip || !isWatchable(clip) || !mayWatch(request, clip)) {
      return user ? errorJson('not_found', 'That clip is gone.', 404) : new Response(JSON.stringify({ ok: false, error: 'signin' }), { status: 401, headers: { ...PRIVATE, 'Content-Type': 'application/json' } });
    }
    const out: Record<string, unknown> = { ok: true, clip: clipView(clip), user: user ? { email: user.email, name: user.name, admin: user.role === 'admin' } : null };
    if (user) {
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
      out.comments = comments.results || [];
      out.reactions = reactions.results || [];
      out.viewers = [...seen.values()];
      out.views = clip.views;
      const admin = user.role === 'admin';
      out.can = { edit: admin, delete: admin, share: admin };
      if (admin) {
        out.mine = clip.owner_email === user.email;
        out.helpDraft = clip.help_draft;
      }
    }
    return json(out, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return handleError(err);
  }
};
