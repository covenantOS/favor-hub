// Clips: the processing job. Reads the sound, writes the title, summary and chapters, and marks the clip ready.
// Safe to run twice: slices are cached in R2 and the update writes the same result.
import { nowIso } from './http';
import { processClip, fallbackTitle } from './clipai';
import type { Clip, ClipsEnv } from './clips';

export async function runProcess(env: ClipsEnv, id: string, again = false, wait = false, vision = true): Promise<Clip | null> {
  const clip = await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
  if (!clip || clip.status === 'uploading' || clip.status === 'failed') return clip;
  // One run at a time per clip. The browser asks for processing right after Stop, and the server starts a backup run in case
  // the tab closed; whichever gets here second waits for the first (or gives up when it is only the backup).
  const t = Date.now();
  const got = await env.DB.prepare('UPDATE hub_clips SET proc_at = ? WHERE id = ? AND (proc_at IS NULL OR proc_at < ?)')
    .bind(new Date(t).toISOString(), id, new Date(t - 60_000).toISOString()).run();
  if (!got.meta || !got.meta.changes) {
    if (!wait) return clip;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
      if (!cur || cur.proc_at === null) return cur;
    }
    return env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
  }
  try {
    const out = await processClip(env, clip, again, vision);
    await env.DB.prepare(
      "UPDATE hub_clips SET status = 'ready', proc_at = NULL, title = ?, title_auto = ?, summary = ?, transcript = ?, words = ?, chapters = ?, seen = ?, error = ?, updated_at = ? WHERE id = ?"
    ).bind(
      out.title,
      clip.title_auto === 1 || !clip.title ? 1 : 0,
      out.summary,
      JSON.stringify(out.transcript),
      JSON.stringify(out.words),
      JSON.stringify(out.chapters),
      JSON.stringify(out.seen),
      out.error,
      nowIso(),
      id
    ).run();
  } catch (err) {
    console.warn('[clips] process', id, err);
    await env.DB.prepare("UPDATE hub_clips SET status = 'ready', proc_at = NULL, error = ?, title = ?, updated_at = ? WHERE id = ?")
      .bind('The transcript could not be written. Use Redo the transcript in the menu.', clip.title || fallbackTitle(clip.created_at), nowIso(), id).run();
  }
  return env.DB.prepare('SELECT * FROM hub_clips WHERE id = ?').bind(id).first<Clip>();
}
