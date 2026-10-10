// Emoji reactions. One per person per emoji: the same tap again takes it back. Each keeps the moment it was left at.
import { errorJson, handleError, json, nowIso } from '../../../_lib/http';
import { ID_RE, isWatchable, rowId, staffOrError, type Clip, type ClipsEnv } from '../../../_lib/clips';

const REACTIONS = ['❤️', '👍', '🔥', '👏', '🙌', '👀'];

export const onRequestPost: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  try {
    const who = staffOrError(request);
    if ('res' in who) return who.res;
    const id = String(params.id);
    const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>() : null;
    if (!clip || !isWatchable(clip)) return errorJson('not_found', 'That clip does not exist.', 404);
    const b = (await request.json().catch(() => ({}))) as { emoji?: string; at?: number };
    const emoji = String(b.emoji ?? '');
    if (!REACTIONS.includes(emoji)) return errorJson('bad_emoji', 'Pick one of the reactions.', 400);
    const has = await env.DB.prepare('SELECT id FROM hub_clip_reactions WHERE clip_id = ? AND person_email = ? AND emoji = ?').bind(id, who.user.email, emoji).first<{ id: string }>();
    if (has) {
      await env.DB.prepare('DELETE FROM hub_clip_reactions WHERE id = ?').bind(has.id).run();
      return json({ ok: true, removed: has.id });
    }
    const reaction = { id: rowId('rx'), emoji, at_seconds: Math.max(0, Math.min(Number(b.at) || 0, clip.duration_ms / 1000 || 86_400)), person_email: who.user.email, person_name: who.user.name, created_at: nowIso() };
    await env.DB.prepare('INSERT OR IGNORE INTO hub_clip_reactions (id, clip_id, person_email, person_name, emoji, at_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(reaction.id, id, reaction.person_email, reaction.person_name, emoji, reaction.at_seconds, reaction.created_at).run();
    return json({ ok: true, reaction });
  } catch (err) {
    return handleError(err);
  }
};
