// Chapters for a clip: reading what the text model sends back, and shaping the transcript it reads. Pure, so
// tests/clips-ai.test.mjs covers it. Ported from ServiceLine Flow's videoChapters.ts.

export interface ClipSegment { s: number; e: number; t: string }
/** One word: [start, end, text] in source seconds. */
export type ClipWord = [number, number, string];
export interface ClipChapter { at: number; title: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "0:35", "1:07", "01:02:03", "35", "35s", "1m 5s" or a number, to seconds. Null when it is not a time. */
export function clockSeconds(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^\[|\]$/g, '').trim();
  if (!s) return null;
  const parts = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?$/.exec(s);
  if (parts) return parts[3] !== undefined ? Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) : Number(parts[1]) * 60 + Number(parts[2]);
  const ms = /^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/i.exec(s);
  if (ms && (ms[1] || ms[2])) return Number(ms[1] || 0) * 60 + Number(ms[2] || 0);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Every top-level JSON object or array found in `raw` (fenced, wrapped in prose, or bare), first one that parses wins. */
export function parseAiJson(raw: string): unknown {
  const text = raw.replace(/```(?:json|JSON)?/g, ' ');
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('no JSON in the answer');
}

/** The chapter list inside whatever shape the AI used: {chapters:[...]}, a bare array, or {items|sections|toc:[...]}. */
export function chapterItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['chapters', 'key_chapters', 'keyChapters', 'items', 'sections', 'toc', 'tableOfContents']) if (Array.isArray(o[k])) return o[k] as unknown[];
    const first = Object.values(o).find((v) => Array.isArray(v));
    if (first) return first as unknown[];
  }
  return [];
}

/** Clean chapters: times may be seconds or "m:ss" strings, titles may be under `title` or `name`. Sorted, thinned by `minGap`. */
export function cleanChapters(raw: unknown, duration: number, minGap = 5): ClipChapter[] {
  const items = chapterItems(raw);
  const out: ClipChapter[] = [];
  for (const c of items.slice(0, 40)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const at = clockSeconds(o.at ?? o.start ?? o.time ?? o.timestamp ?? o.t ?? o.seconds);
    const title = String(o.title ?? o.name ?? o.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (at === null || at < 0 || !title || (duration > 0 && at > duration + 1)) continue;
    out.push({ at: r2(duration > 0 ? Math.min(at, duration) : at), title });
  }
  out.sort((a, b) => a.at - b.at);
  return out.filter((c, i) => i === 0 || c.at - out[i - 1].at >= minGap);
}

/** How many chapters a recording of this length should get: 1 to 3 for a short one. */
export function chapterRange(duration: number): [number, number] {
  if (duration < 20) return [1, 1];
  if (duration < 60) return [1, 2];
  if (duration < 180) return [2, 4];
  return [3, 8];
}

/**
 * The lines the AI reads. A short recording often comes back from Whisper as one or two long segments, which leaves nothing
 * to point a chapter at, so those are cut into sentences using the word times.
 */
export function chapterLines(segments: ClipSegment[], words: ClipWord[]): ClipSegment[] {
  const lines = segments.filter((l) => l.t.trim());
  if (lines.length >= 4 || words.length < 8) return lines;
  const out: ClipSegment[] = [];
  let cur: ClipWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ s: cur[0][0], e: cur[cur.length - 1][1], t: cur.map((w) => w[2]).join(' ').replace(/\s+([,.!?])/g, '$1') });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')]?$/.test(w[2]) && cur.length >= 6) flush();
  }
  flush();
  return out.length > lines.length ? out : lines;
}

/** Plain-English title from the first words of a line, for when the AI could not be reached. */
const titleFrom = (t: string) => {
  const w = t.replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Recording';
};

/** Last resort so a video always has chapters: evenly spaced lines named after their first words. */
export function fallbackChapters(lines: ClipSegment[], duration: number): ClipChapter[] {
  if (!lines.length) return [];
  const [, max] = chapterRange(duration);
  const n = Math.min(max, Math.max(1, Math.round(duration / 60) || 1), lines.length);
  const picks: ClipChapter[] = [];
  for (let i = 0; i < n; i++) {
    const l = lines[Math.floor((i * lines.length) / n)];
    picks.push({ at: i === 0 ? 0 : l.s, title: titleFrom(l.t) });
  }
  return cleanChapters(picks, duration, 1);
}

/** The first chapter always starts at 0. */
export function startAtZero(ch: ClipChapter[]): ClipChapter[] {
  if (!ch.length) return ch;
  return ch[0].at > 3 ? [{ at: 0, title: 'Start' }, ...ch] : [{ ...ch[0], at: 0 }, ...ch.slice(1)];
}
