// Highlights for a clip: the few moments worth jumping to. Pure, so tests/clips-ops.test.mjs covers it. No model call: a moment
// scores on what the speaker stressed ("make sure", "never", "remember"), the start of each chapter, and what watchers reacted to.
import type { ClipChapter, ClipSegment } from './clipChapters';

export interface Highlight {
  /** Seconds in the source file. */
  at: number;
  /** The line spoken there, trimmed. */
  text: string;
  /** Why it was picked, in words the page shows. */
  why: 'Stressed' | 'Chapter start' | 'Reactions' | 'Step';
}

const STRESS = /\b(important|remember|make sure|be sure|don'?t forget|never|always|careful|watch out|warning|key (thing|point|step)|the (trick|catch)|note that|this is where|mistake|common|must|before you)\b/i;
const STEP = /\b(first|next|then|finally|click|press|select|open|go to|choose|type|enter)\b/i;
const FILLER = /^(um+|uh+|so|okay|ok|alright|yeah|and|well)[\s,.]*$/i;

const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
const cut = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n).replace(/[\s,;:-]+\S*$/, '')}...` : t);

/**
 * Up to `max` highlights at least `gap` seconds apart, in time order. A clip under 20 seconds gets none: the whole clip is the highlight.
 * `reactions` are the watchers' reaction times in seconds.
 */
export function clipHighlights(lines: ClipSegment[], chapters: ClipChapter[], duration: number, reactions: number[] = [], max = 4, gap = 20): Highlight[] {
  if (duration && duration < 20) return [];
  const scored: Array<Highlight & { score: number }> = [];
  const near = (t: number, w = 5) => reactions.filter((r) => Math.abs(r - t) <= w).length;
  for (const l of lines) {
    const text = clean(l.t);
    if (text.length < 18 || FILLER.test(text)) continue;
    let score = 0;
    let why: Highlight['why'] = 'Step';
    if (STRESS.test(text)) {
      score += 3;
      why = 'Stressed';
    } else if (STEP.test(text)) score += 1;
    const r = near(l.s);
    if (r) {
      score += 2 + r;
      why = 'Reactions';
    }
    if (score) scored.push({ at: l.s, text: cut(text), why, score });
  }
  for (const c of chapters) {
    if (c.at < 3) continue;
    const line = lines.find((l) => l.s >= c.at - 0.5 && clean(l.t).length >= 12);
    scored.push({ at: c.at, text: c.title, why: 'Chapter start', score: 2 + (line ? 0 : -1) });
  }
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= max) break;
    if (picked.every((p) => Math.abs(p.at - s.at) >= gap)) picked.push(s);
  }
  return picked.sort((a, b) => a.at - b.at).map(({ at, text, why }) => ({ at: Math.round(at * 100) / 100, text, why }));
}
