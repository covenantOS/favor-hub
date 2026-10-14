// Each person's recording default for the meetings and huddles they start (Will, 2026-10-14): Record video (video and notes),
// Transcribe only (notes, no video) or Neither. Set in Settings; the host can change it for one meeting, before or during it.
// No saved row, or no table yet, means Record video, the rule since 2026-10-13.
import { HttpError, nowIso, type Env } from './http';

export type RecMode = 'video' | 'notes' | 'off';
export const REC_MODES: RecMode[] = ['video', 'notes', 'off'];
export const isRecMode = (v: unknown): v is RecMode => REC_MODES.includes(String(v) as RecMode);

export async function recPrefOf(env: Pick<Env, 'DB'>, email: string): Promise<RecMode> {
  try {
    const r = await env.DB.prepare('SELECT rec FROM hub_meet_prefs WHERE email = ?').bind(String(email || '').toLowerCase()).first<{ rec: string }>();
    return r && isRecMode(r.rec) ? r.rec : 'video';
  } catch {
    return 'video';
  }
}

export async function setRecPref(env: Pick<Env, 'DB'>, email: string, rec: unknown): Promise<RecMode> {
  if (!isRecMode(rec)) throw new HttpError(400, 'bad_rec', 'Pick Record video, Transcribe only or Neither.');
  await env.DB.prepare('INSERT INTO hub_meet_prefs (email, rec, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET rec = excluded.rec, updated_at = excluded.updated_at')
    .bind(String(email).toLowerCase(), rec, nowIso()).run();
  return rec;
}
