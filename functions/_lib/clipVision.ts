// Clips: what was on screen. While a person records, the browser sends a small picture every few seconds (and when the screen
// changes). A Workers AI vision model on the Marketing account reads each one: the application and page, the text that is
// visible, and what the person is doing. The picture is deleted the moment it is read. Only those words are kept, on the clip's
// own private record, and they are deleted with the clip. They feed the clip's title, summary and chapters and the owner's
// library search. They are never sent anywhere else, never logged and never shown to anyone but the person who made the clip.
import { frameKey, framesPrefix, type ClipsEnv } from './clips';
import { parseAiJson, type ClipChapter } from './clipChapters';
import { plain, stamp } from './clipai';

/** Fast and cheap first (about 64 neurons a picture); a second model reads the picture if the first one errors. */
export const VISION_MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
export const MAX_FRAMES = 90;
export const MAX_FRAME_BYTES = 600 * 1024;

type Run = { run(model: string, input: unknown): Promise<unknown> };

const PROMPT =
  'This is one frame from a screen recording a staff member made to show coworkers how to use a work app. Reply with one JSON object with these keys. ' +
  'app: the application or website, such as "Favor hub", "Blackbaud", "Gmail", "Google Sheets" (empty if it is not clear). ' +
  'page: the page, tab or screen inside it, such as "Request board", "Gift batch", "Today" (empty if it is not clear). ' +
  'text: the most important text you can read on the screen, headings, menu items, button and field labels, copied as written, at most 500 characters. ' +
  'step: what the person appears to be doing, one short phrase starting with a verb, such as "Open a request card". ' +
  'In app, page and step name the tool and the action only. Never put a person\'s name, an address, a phone number, an email address or a dollar amount in app, page or step.';

export interface Seen { app: string; page: string; from: number; to: number }
export interface FrameRow { t_ms: number; app: string; page: string; text: string; step: string; status: string }

function bytesToDataUrl(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(s)}`;
}

/** The text of a vision reply, whichever shape the model returns it in. */
function replyText(res: unknown): string {
  const r = res as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof r?.response === 'string') return r.response;
  if (r?.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text?: unknown }).text ?? '') : '')).join(' ');
  return '';
}

export interface FrameRead { app: string; page: string; text: string; step: string }

export async function readPicture(env: ClipsEnv, bytes: Uint8Array): Promise<FrameRead | null> {
  const ai = env.AI as Run | undefined;
  if (!ai) return null;
  const url = bytesToDataUrl(bytes);
  for (const model of VISION_MODELS) {
    try {
      const res = await ai.run(model, {
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url } }] }],
        max_tokens: 500,
        temperature: 0.1,
      });
      const o = parseAiJson(replyText(res)) as Record<string, unknown> | null;
      if (!o || typeof o !== 'object') continue;
      return { app: plain(o.app, 60), page: plain(o.page, 80), text: plain(o.text, 600), step: plain(o.step, 120) };
    } catch {
      // Not logged: the error text can echo what was in the picture.
    }
  }
  return null;
}

/** Reads one stored picture, keeps the words, deletes the picture. A clip deleted meanwhile leaves nothing behind. */
export async function readFrame(env: ClipsEnv, clipId: string, tMs: number): Promise<boolean> {
  const obj = await env.CLIPS.get(frameKey(clipId, tMs));
  if (!obj) return false;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const got = await readPicture(env, bytes);
  const alive = await env.DB.prepare('SELECT 1 AS ok FROM hub_clips WHERE id = ?').bind(clipId).first();
  if (!alive) {
    await env.CLIPS.delete(frameKey(clipId, tMs)).catch(() => undefined);
    return false;
  }
  if (!got) {
    await env.DB.prepare("UPDATE hub_clip_frames SET status = 'failed' WHERE clip_id = ? AND t_ms = ?").bind(clipId, tMs).run();
    return false;
  }
  await env.DB.prepare("UPDATE hub_clip_frames SET status = 'done', app = ?, page = ?, text = ?, step = ? WHERE clip_id = ? AND t_ms = ?")
    .bind(got.app, got.page, got.text, got.step, clipId, tMs).run();
  await env.CLIPS.delete(frameKey(clipId, tMs)).catch(() => undefined);
  return true;
}

/** Reads every picture that is still waiting (a few at a time), so the title and chapters see the whole recording. */
export async function readPending(env: ClipsEnv, clipId: string, limit = 30): Promise<void> {
  const rows = await env.DB.prepare("SELECT t_ms FROM hub_clip_frames WHERE clip_id = ? AND status IN ('pending', 'failed') ORDER BY t_ms LIMIT ?").bind(clipId, limit).all<{ t_ms: number }>();
  const list = rows.results || [];
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map((r) => readFrame(env, clipId, r.t_ms).catch(() => false)));
}

export async function framesOf(env: ClipsEnv, clipId: string): Promise<FrameRow[]> {
  const r = await env.DB.prepare("SELECT t_ms, app, page, text, step, status FROM hub_clip_frames WHERE clip_id = ? AND status = 'done' ORDER BY t_ms").bind(clipId).all<FrameRow>();
  return r.results || [];
}

/** Consecutive frames on the same app and page become one stretch. */
export function stretches(frames: FrameRow[]): Seen[] {
  const out: Seen[] = [];
  for (const f of frames) {
    if (!f.app && !f.page) continue;
    const last = out[out.length - 1];
    const same = last && last.app.toLowerCase() === f.app.toLowerCase() && last.page.toLowerCase() === f.page.toLowerCase();
    if (same) last.to = f.t_ms / 1000;
    else out.push({ app: f.app, page: f.page, from: f.t_ms / 1000, to: f.t_ms / 1000 });
  }
  return out;
}

/**
 * What the model is shown about the screen: a timeline of where the person was and what they did, plus a few labels that
 * were readable. It carries no raw screen text beyond short labels, and the prompt tells the model to leave personal details out.
 */
export function screenContext(frames: FrameRow[]): string {
  const lines: string[] = [];
  let lastKey = '';
  for (const f of frames) {
    const where = [f.app, f.page].filter(Boolean).join(', ');
    const key = `${where}|${f.step}`;
    if (!where && !f.step) continue;
    if (key === lastKey) continue;
    lastKey = key;
    const labels = f.text ? ` (readable: ${f.text.slice(0, 140)})` : '';
    lines.push(`[${stamp(f.t_ms / 1000)}] ${where || 'screen'}${f.step ? `: ${f.step}` : ''}${labels}`);
  }
  return lines.slice(0, 80).join('\n').slice(0, 9000);
}

/** Chapters from the screen alone, for a recording with nobody speaking. */
export function screenChapters(seen: Seen[], duration: number): ClipChapter[] {
  const out: ClipChapter[] = [];
  for (const s of seen) {
    const title = plain([s.app, s.page].filter(Boolean).join(', '), 60);
    if (!title || (out.length && out[out.length - 1].title === title)) continue;
    out.push({ at: Math.floor(out.length === 0 ? 0 : s.from), title });
  }
  return out.filter((c) => c.at < Math.max(1, duration)).slice(0, 12);
}

export { framesPrefix };
