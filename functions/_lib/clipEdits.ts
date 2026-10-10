// Clips: the edit list. Edits are JSON in source seconds and never touch the file in R2; the player applies them.
// Ported from ServiceLine Flow's cleanEdits, with the same shape so the editor math carries over.

import type { ClipSegment, ClipWord } from './clipChapters';

export interface ClipEdits {
  trimStart: number;
  trimEnd: number | null;
  /** Cuts made by hand (a selection, struck words). */
  cuts: [number, number][];
  /** "Remove silences" is on: the stretches it takes out. */
  silences?: [number, number][];
  /** "Remove filler words" is on: the ranges of the um and uh words it takes out. */
  fillers?: [number, number][];
  /** Where the editor split the timeline. A split alone changes nothing in playback. */
  splits?: number[];
  /** The shortest pause "Remove silences" takes out, in seconds. */
  silenceMin?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function cleanEdits(raw: unknown, duration = 0): ClipEdits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cap = (v: number) => Math.max(0, duration > 0 ? Math.min(v, duration) : v);
  const ranges = (v: unknown, max: number): [number, number][] => {
    const out: [number, number][] = [];
    if (!Array.isArray(v)) return out;
    for (const c of v.slice(0, max)) {
      if (!Array.isArray(c)) continue;
      const a = num(c[0]);
      const b = num(c[1]);
      if (a === null || b === null) continue;
      const lo = cap(Math.min(a, b));
      const hi = cap(Math.max(a, b));
      if (hi - lo >= 0.05) out.push([r2(lo), r2(hi)]);
    }
    return out.sort((x, y) => x[0] - y[0]);
  };
  const trimStart = cap(num(r.trimStart) ?? 0);
  const te = num(r.trimEnd);
  const trimEnd = te === null ? null : cap(te);
  const cuts = ranges(r.cuts, 300);
  const silences = ranges(r.silences, 800);
  const fillers = ranges(r.fillers, 800);
  const splits = (Array.isArray(r.splits) ? r.splits : [])
    .map(num)
    .filter((v): v is number => v !== null && v > 0 && (duration <= 0 || v < duration))
    .map(r2)
    .sort((a, b) => a - b)
    .slice(0, 300);
  const sm = num(r.silenceMin);
  return {
    trimStart: r2(trimStart),
    trimEnd: trimEnd === null ? null : r2(trimEnd),
    cuts,
    ...(silences.length ? { silences } : {}),
    ...(fillers.length ? { fillers } : {}),
    ...(splits.length ? { splits } : {}),
    ...(sm !== null && sm >= 0.2 && sm <= 3 ? { silenceMin: r2(sm) } : {}),
  };
}

/** Word times for corrected lines: a line whose word count is unchanged keeps its times; otherwise the new words share the old span. */
export function respread(old: ClipSegment[], next: ClipSegment[], words: ClipWord[]): ClipWord[] {
  if (words.length <= 4) return words;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: ClipWord[] = [];
  let at = 0;
  for (let i = 0; i < next.length; i++) {
    const hi = i + 1 < next.length ? next[i + 1].s - 0.05 : Infinity;
    const mine: ClipWord[] = [];
    while (at < words.length && words[at][0] < hi) mine.push(words[at++]);
    if (next[i].t === old[i].t || !mine.length) {
      out.push(...mine);
      continue;
    }
    const toks = next[i].t.split(/\s+/).filter(Boolean);
    if (toks.length === mine.length) {
      mine.forEach((w, k) => out.push([w[0], w[1], toks[k]]));
      continue;
    }
    const a = mine[0][0];
    const z = Math.max(mine[mine.length - 1][1], a + 0.2);
    const total = toks.reduce((sum, w) => sum + w.length + 1, 0) || 1;
    let t = a;
    for (const w of toks) {
      const len = ((w.length + 1) / total) * (z - a);
      out.push([r2(t), r2(t + len), w]);
      t += len;
    }
  }
  out.push(...words.slice(at));
  return out;
}

