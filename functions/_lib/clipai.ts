// Clips: the transcript, the auto title, the summary and the chapters. All of it runs on Cloudflare Workers AI on the
// Marketing account (the AI binding in wrangler.toml). Whisper turns the recording's sound into timed words. A small
// text model names the clip and cuts it into chapters. The page never says where the words came from.
import { J, audioPrefix, sliceTextKey, MAX_AUDIO_BYTES, type AudioSeg, type Clip, type ClipsEnv, type PartRec } from './clips';
import { chapterLines, chapterRange, cleanChapters, fallbackChapters, parseAiJson, startAtZero, type ClipChapter, type ClipSegment, type ClipWord } from './clipChapters';

export const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** Small first. If it errors the larger model the hub already uses for routing steps in. */
export const TEXT_MODELS = ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
/**
 * Whisper writes clean text and drops "um" and "uh" unless the prompt shows it that fillers belong in the transcript.
 * Speech that sounds like this prompt is kept verbatim. The editor's "Remove filler words" needs them to be there.
 */
export const VERBATIM_PROMPT = 'Umm, let me think like, hmm... Okay, uh, so, you know, I mean, uh, yeah.';

const r2 = (n: number) => Math.round(n * 100) / 100;
type WW = { word?: string; start?: number; end?: number };
type Run = { run(model: string, input: unknown): Promise<unknown> };

export const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Plain text for the page: no em dashes (house rule), no stray quotes or line breaks. */
export function plain(s: unknown, max: number): string {
  return String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Words out of a Whisper reply: per-segment `words`, or a top-level `words`. Times are relative to the slice. */
export function whisperWords(res: { segments?: { words?: WW[] }[]; words?: WW[] }, offset: number): ClipWord[] {
  const raw = [...(res.segments ?? []).flatMap((p) => p.words ?? []), ...(res.words ?? [])];
  const seen = new Set<string>();
  const out: ClipWord[] = [];
  for (const w of raw) {
    const t = String(w.word ?? '').trim();
    if (!t || !Number.isFinite(Number(w.start)) || !Number.isFinite(Number(w.end))) continue;
    const key = `${w.start}|${w.end}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([r2(offset + Number(w.start)), r2(offset + Number(w.end)), t]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

interface SliceOut { lines: ClipSegment[]; words: ClipWord[] }

/** The model's own words about a silent or music-only slice. Whisper makes these up when nothing is said. */
const GHOST = /^(thanks for watching|thank you for watching|thank you\.?|you\.?|bye\.?|\.+)$/i;

/** One audio slice to timed text and word times. Cached in R2, so a retry never pays twice. */
export async function transcribeSlice(env: ClipsEnv, clip: Pick<Clip, 'id'>, seg: AudioSeg, sliceEnd: number): Promise<SliceOut | null> {
  const cached = await env.CLIPS.get(sliceTextKey(clip.id, seg.n));
  if (cached) {
    const o = J<Partial<SliceOut>>(await cached.text(), {});
    return { lines: o.lines ?? [], words: o.words ?? [] };
  }
  const audio = await env.CLIPS.get(`${audioPrefix(clip.id)}${seg.n}.${seg.ext}`);
  if (!audio) return null;
  if (audio.size > MAX_AUDIO_BYTES) return { lines: [], words: [] };
  const ai = env.AI as Run | undefined;
  const out: SliceOut = { lines: [], words: [] };
  if (!ai) return null;
  const buf = new Uint8Array(await audio.arrayBuffer());
  if (!buf.length) return { lines: [], words: [] };
  const res = (await ai.run(WHISPER, { audio: toBase64(buf), initial_prompt: VERBATIM_PROMPT, condition_on_previous_text: false })) as {
    text?: string;
    segments?: { start?: number; end?: number; text?: string; no_speech_prob?: number; words?: WW[] }[];
    words?: WW[];
  };
  const parts = Array.isArray(res.segments) ? res.segments : [];
  const kept = parts.filter((p) => (p.text ?? '').trim() && !(typeof p.no_speech_prob === 'number' && p.no_speech_prob > 0.9) && !GHOST.test(String(p.text).trim()));
  out.lines = kept.map((p) => ({ s: r2(seg.start + (Number(p.start) || 0)), e: r2(seg.start + (Number(p.end) || 0)), t: String(p.text).trim() }));
  out.words = whisperWords({ segments: kept, words: res.words }, seg.start);
  const whole = String(res.text ?? '').trim();
  if (!out.lines.length && whole && !GHOST.test(whole)) out.lines = [{ s: seg.start, e: Math.max(sliceEnd, seg.start + 1), t: whole }];
  await env.CLIPS.put(sliceTextKey(clip.id, seg.n), JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } });
  return out;
}

/** Forget the saved text of every slice, so the next read asks Whisper again. */
export async function forgetSlices(env: ClipsEnv, clip: Clip) {
  const slices = J<AudioSeg[]>(clip.audio_segments, []);
  if (slices.length) await env.CLIPS.delete(slices.map((x) => sliceTextKey(clip.id, x.n)));
}

export async function transcribeAll(env: ClipsEnv, clip: Clip): Promise<{ segments: ClipSegment[]; words: ClipWord[]; missing: number }> {
  const slices = J<AudioSeg[]>(clip.audio_segments, []).sort((a, b) => a.n - b.n);
  const duration = clip.duration_ms / 1000;
  const all: ClipSegment[] = [];
  const words: ClipWord[] = [];
  let missing = 0;
  // Three at a time: slices are independent and each is a few seconds of model time.
  for (let i = 0; i < slices.length; i += 3) {
    const batch = slices.slice(i, i + 3);
    const got = await Promise.all(
      batch.map((s, k) => {
        const end = slices[i + k + 1]?.start ?? (duration || s.start + 240);
        return transcribeSlice(env, clip, s, end).catch((err) => {
          console.warn('[clips] whisper', clip.id, s.n, err);
          return null;
        });
      })
    );
    for (const g of got) {
      if (g === null) missing++;
      else {
        all.push(...g.lines);
        words.push(...g.words);
      }
    }
  }
  return { segments: all.sort((a, b) => a.s - b.s), words: words.sort((a, b) => a[0] - b[0]), missing };
}

/* ------------------------------------------------------------------ text model */

/** One JSON answer from the small model, falling back to the larger one. */
export async function chatJson<T>(env: ClipsEnv, system: string, user: string, maxTokens = 900, models: string[] = TEXT_MODELS): Promise<T> {
  const ai = env.AI as Run | undefined;
  if (!ai) throw new Error('no ai binding');
  let last: unknown = null;
  for (const model of models) {
    try {
      const res = (await ai.run(model, {
        messages: [
          { role: 'system', content: `${VOICE}\n\n${system}\n\nReply with one JSON object only.` },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      })) as { response?: unknown };
      const raw = res.response;
      if (raw && typeof raw === 'object') return raw as T;
      return parseAiJson(String(raw ?? '')) as T;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('text model failed');
}

const VOICE =
  'You work for Favor International, a Christian nonprofit. You are given the transcript of a screen or camera recording a staff member made for coworkers. ' +
  'Write plainly and specifically. Never invent facts, names, dates or numbers; if something is not in the transcript, leave it out. ' +
  'Leave out personal details of any partner or donor (names, addresses, phone numbers, emails) and any gift amount tied to a person. ' +
  'Do not use em dashes. Do not mention artificial intelligence or that this was written from a transcript.';

export async function nameIt(env: ClipsEnv, text: string): Promise<{ title: string; summary: string } | null> {
  if (!text.trim()) return null;
  try {
    const out = await chatJson<{ title?: unknown; summary?: unknown }>(
      env,
      'Return keys: title (at most 8 words, plain, no quotes, says what the recording is about, no trailing period) and summary (2 to 3 sentences on what is shown and decided; no filler).',
      `Transcript:\n${clipText(text)}`,
      500
    );
    const title = plain(out.title, 120).replace(/^["']|["']$/g, '').replace(/\.$/, '');
    const summary = plain(out.summary, 1200);
    if (!title) return null;
    return { title, summary };
  } catch (err) {
    console.warn('[clips] title', err);
    return null;
  }
}

/** Keep a long transcript inside what the model reads: the start and the end carry the point. */
export function clipText(text: string, limit = 24000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.round(limit * 0.7))}\n[...]\n${text.slice(-Math.round(limit * 0.3))}`;
}

/** Chapters from the transcript: the model names the sections; the times are the transcript's own. Never empty for a transcript with text. */
export async function chaptersFor(env: ClipsEnv, segments: ClipSegment[], duration: number, words: ClipWord[] = []): Promise<ClipChapter[]> {
  const lines = chapterLines(segments, words);
  if (!lines.length) return [];
  const dur = duration || lines[lines.length - 1].e;
  const [lo, hi] = chapterRange(dur);
  try {
    const text = lines.map((l) => `[${stamp(l.s)}] ${l.t}`).join('\n').slice(0, 30000);
    const out = await chatJson<unknown>(
      env,
      'Split the transcript into chapters like a video table of contents. Return {"chapters":[{"at":0,"title":"..."}]}. ' +
        'at is the start in whole seconds (a number, not "m:ss"), taken from a [m:ss] stamp in the transcript; the first chapter starts at 0. title is 2 to 6 plain words naming that section. ' +
        `Use ${lo === hi ? lo : `${lo} to ${hi}`} chapter${hi === 1 ? '' : 's'} (this recording is ${Math.round(dur)} seconds long; a very short one still gets at least 1). Never invent topics that are not in the transcript.`,
      text,
      1200
    );
    const got = cleanChapters(out, dur, dur < 60 ? 3 : 5).map((c) => ({ ...c, title: plain(c.title, 90) }));
    if (got.length) return startAtZero(got);
  } catch (err) {
    console.warn('[clips] chapters', err);
  }
  // The model was unreachable or answered in a shape we could not read: still give the clip a table of contents.
  return fallbackChapters(lines, dur);
}

/** One model step, tried twice: a hiccup on the first call should not leave a clip without a summary. */
async function twice<T>(fn: () => Promise<T>, empty: (v: T) => boolean): Promise<T | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const v = await fn();
      if (!empty(v)) return v;
    } catch (err) {
      console.warn('[clips] ai step', err);
    }
  }
  return null;
}

export function fallbackTitle(createdAt: string): string {
  const d = new Date(createdAt);
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return `Clip, ${day}, ${time}`;
}

export interface Processed {
  title: string;
  summary: string;
  transcript: ClipSegment[];
  words: ClipWord[];
  chapters: ClipChapter[];
  error: string | null;
}

/**
 * After the upload completes (and again on a retry): read every audio slice, then write the title, the summary and the
 * chapters, with no button to press. `again` reads the audio afresh and rewrites the title, summary and chapters.
 */
export async function processClip(env: ClipsEnv, clip: Clip, again = false): Promise<Processed> {
  if (again) await forgetSlices(env, clip);
  const { segments, words, missing } = await transcribeAll(env, clip);
  const text = segments.map((s) => s.t).join(' ');
  const duration = clip.duration_ms / 1000;
  const hasChapters = cleanChapters(J<unknown>(clip.chapters, []), duration, 1).length > 0;
  const needName = clip.title_auto === 1 || !clip.title || !clip.summary || again;
  const [named, chapters] = await Promise.all([
    needName && text.trim() ? twice(() => nameIt(env, text), (v) => !v || !v.summary) : Promise.resolve(null),
    text.trim() && (again || !hasChapters) ? twice(() => chaptersFor(env, segments, duration, words), (v) => !v.length) : Promise.resolve(null),
  ]);
  const autoTitle = clip.title_auto === 1 || !clip.title;
  return {
    title: autoTitle ? (named?.title || (clip.title_auto === 1 && clip.title) || fallbackTitle(clip.created_at)) : clip.title,
    summary: named?.summary && (again || !clip.summary) ? named.summary : clip.summary,
    transcript: segments,
    words,
    chapters: chapters?.length ? chapters : J<ClipChapter[]>(clip.chapters, []),
    error: missing && !segments.length ? 'The transcript could not be written. Use Redo the transcript in the menu.' : null,
  };
}

/* ------------------------------------------------------------------ help article */

export interface ArticleDraft { title: string; summary: string; markdown: string }

/** A help article for the hub's help docs, written from the transcript. The editor decides before anything is published. */
export async function helpArticle(env: ClipsEnv, clip: Clip): Promise<ArticleDraft | null> {
  const lines = J<ClipSegment[]>(clip.transcript, []);
  if (!lines.length) return null;
  const text = clipText(lines.map((l) => `[${stamp(l.s)}] ${l.t}`).join('\n'), 28000);
  const out = await chatJson<{ title?: unknown; summary?: unknown; intro?: unknown; steps?: unknown; tips?: unknown }>(
    env,
    'Write a help article for Favor staff from this recording of a walkthrough. Return keys: title (at most 8 words, names the task, starts with a verb or "How to"), ' +
      'summary (one sentence, what the reader can do after reading), intro (two or three sentences: who this is for and when to use it), ' +
      'steps (3 to 10 items in order; each {title: short imperative step naming the exact buttons, pages and tools the speaker used, details: one or two plain sentences}), ' +
      'tips (up to 4 short things the speaker warned about; may be empty). Leave out small talk. Never add a step that is not in the transcript.',
    text,
    2400
  );
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { title: plain(o.title, 160), details: plain(o.details, 500) };
    })
    .filter((s) => s.title)
    .slice(0, 12);
  if (!steps.length) return null;
  const title = plain(out.title, 120) || clip.title;
  const summary = plain(out.summary, 220) || clip.summary.slice(0, 220);
  const tips = (Array.isArray(out.tips) ? out.tips : []).map((t) => plain(t, 260)).filter(Boolean).slice(0, 4);
  const body = [
    plain(out.intro, 600),
    '',
    '## Steps',
    '',
    ...steps.map((s, i) => `${i + 1}. **${s.title.replace(/[.:]$/, '')}.**${s.details ? ` ${s.details}` : ''}`),
    ...(tips.length ? ['', '## Good to know', '', ...tips.map((t) => `- ${t}`)] : []),
  ].join('\n');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const markdown = ['---', `title: ${yamlLine(title)}`, `summary: ${yamlLine(summary)}`, 'topic: work', 'order: 50', 'for: [all]', 'related: []', `updated: ${today}`, '---', '', body, ''].join('\n');
  return { title, summary, markdown };
}

function yamlLine(s: string): string {
  return /[:#\[\]{}'",&*!|>%@`]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

export type { PartRec };

/* ------------------------------------------------------------------ translated transcript */

export const LANGS: Record<string, string> = { es: 'Spanish', en: 'English' };

/** The transcript lines in another language, one string per line, in the same order. Names, numbers and web addresses stay. */
export async function translateLines(env: ClipsEnv, lines: ClipSegment[], lang: string): Promise<string[] | null> {
  const name = LANGS[lang];
  if (!name) return null;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 30) {
    const chunk = lines.slice(i, i + 30);
    const res = await chatJson<{ lines?: unknown }>(
      env,
      `Translate each numbered line of a spoken transcript into natural ${name}. Keep names, product names, numbers and web addresses as they are. Return key: lines (an array of exactly ${chunk.length} strings, in the same order, without the numbers).`,
      chunk.map((l, k) => `${k + 1}. ${l.t}`).join('\n'),
      3000,
      // The larger model translates better than the small one that names clips.
      [TEXT_MODELS[1], TEXT_MODELS[0]]
    );
    const got = Array.isArray(res.lines) ? res.lines.map((x) => String(x ?? '').trim()) : [];
    if (got.length !== chunk.length) return null;
    out.push(...got.map((x, k) => plain(x, 2000) || chunk[k].t));
  }
  return out;
}
