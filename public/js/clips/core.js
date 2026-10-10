// Clips: the shared pieces. No page code here, so tests/clips-core.test.mjs runs it in Node.
// The edit math (keep ranges, trim edges, silences, filler words) is ported from ServiceLine Flow's videos.ts.

/* ------------------------------------------------------------------ small helpers */

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const r2 = (n) => Math.round(n * 100) / 100;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** 1:07.25 */
export function fmtPrecise(t) {
  const x = Math.max(0, t);
  const m = Math.floor(x / 60);
  return `${m}:${(x - m * 60).toFixed(2).padStart(5, '0')}`;
}

/** "2 min 33 sec" */
export function longTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m} min ${r} sec` : `${r} sec`;
}

/** "1:07" or "67" to seconds, null when it is not a time. */
export function parseClock(v) {
  const m = /^\s*(?:(\d+):)?(\d+):(\d{1,2})(?:\.\d+)?\s*$/.exec(v);
  if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(String(v).trim());
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
}

export function et(iso, opts) {
  return new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
}

export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return et(iso, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ------------------------------------------------------------------ network */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, init = {}) {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers || {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* not JSON */
  }
  if (!res.ok || (data && data.ok === false)) throw new ApiError(res.status, (data && data.message) || `Something went wrong (${res.status}).`);
  return data;
}

/** One part, one audio slice or the poster. Retries with backoff while the network is down; gives up only when told to stop. */
export async function putWithRetry(url, body, headers, stop, onRetry) {
  let attempt = 0;
  for (;;) {
    if (stop && stop.cancelled) throw new Error('cancelled');
    try {
      const res = await fetch(url, { method: 'PUT', body, headers, credentials: 'same-origin' });
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const j = await res.json().catch(() => ({}));
        throw new ApiError(res.status, j.message || 'Upload refused');
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
    attempt++;
    if (onRetry) onRetry(attempt);
    if (attempt > 40) throw new Error('The network did not come back.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await new Promise((ok) => {
        const done = () => {
          window.removeEventListener('online', done);
          ok();
        };
        window.addEventListener('online', done);
        setTimeout(done, 15000);
      });
    } else {
      await sleep(Math.min(1000 * 2 ** Math.min(attempt, 5), 20000));
    }
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

export function toast(msg, tone) {
  const t = document.createElement('div');
  t.className = 'cl-toast' + (tone === 'bad' ? ' is-bad' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ------------------------------------------------------------------ edit math */

export const NO_EDITS = { trimStart: 0, trimEnd: null, cuts: [] };
export const MIN_SEGMENT = 0.1;
export const PEAKS_PPS = 20;

/** Take [a, b] out of a list of ranges (bringing the words back). */
export function subtractRange(ranges, a, b) {
  const out = [];
  for (const [x, y] of ranges || []) {
    if (y <= a || x >= b) out.push([x, y]);
    else {
      if (a - x > 0.04) out.push([x, a]);
      if (y - b > 0.04) out.push([b, y]);
    }
  }
  return out;
}

/** Overlapping or touching cuts become one. Sorted. */
export function mergeCuts(cuts) {
  const sorted = cuts.filter(([a, b]) => b - a > 0.04).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c[0] <= last[1] + 0.02) last[1] = Math.max(last[1], c[1]);
    else out.push([c[0], c[1]]);
  }
  return out;
}

export const allCuts = (e) => [...e.cuts, ...(e.silences || []), ...(e.fillers || [])];

export function hasEdits(e) {
  return e.trimStart > 0.01 || e.trimEnd !== null || e.cuts.length > 0 || Boolean(e.silences && e.silences.length) || Boolean(e.fillers && e.fillers.length);
}

export const normEdits = (e) => ({ trimStart: 0, trimEnd: null, cuts: [], ...(e || {}) });

/** The stretches of the source that are kept, in order: [trimStart, trimEnd] minus every cut. */
export function keepRanges(e, duration) {
  const start = Math.max(0, e.trimStart);
  const end = Math.min(e.trimEnd == null ? duration : e.trimEnd, duration || e.trimEnd || 0);
  if (end - start <= 0.05) return duration ? [[0, duration]] : [];
  const out = [];
  let at = start;
  for (const [a, b] of mergeCuts(allCuts(e))) {
    if (b <= at) continue;
    if (a >= end) break;
    if (a > at) out.push([at, Math.min(a, end)]);
    at = Math.max(at, b);
  }
  if (at < end) out.push([at, end]);
  return out;
}

export const rangesLength = (r) => r.reduce((s, [a, b]) => s + (b - a), 0);

/** Source time to edited time (what the viewer sees on the scrubber). A time inside a cut maps to where the cut starts. */
export function toEdited(t, ranges) {
  let acc = 0;
  for (const [a, b] of ranges) {
    if (t < a) return acc;
    if (t <= b) return acc + (t - a);
    acc += b - a;
  }
  return acc;
}

/** Edited time back to source time. */
export function toSource(e, ranges) {
  let acc = 0;
  for (const [a, b] of ranges) {
    if (e <= acc + (b - a)) return a + Math.max(0, e - acc);
    acc += b - a;
  }
  return ranges.length ? ranges[ranges.length - 1][1] : 0;
}

/** Where playback must jump when the source time `t` is not inside a kept range: the next kept start, or null at the end. */
export function skipFrom(t, ranges) {
  if (!ranges.length) return undefined;
  for (const [a, b] of ranges) {
    if (t >= a - 0.001 && t < b) return undefined;
    if (t < a) return a;
  }
  return null;
}

/**
 * Move one edge of a timeline segment from `edge` to `to` (source seconds). Inward trims, outward brings back what was
 * taken out. The very first and last edges move the trim; every other edge adds or removes a cut. Always computed from
 * the edits at the start of a drag, so dragging back restores exactly.
 */
export function trimEdge(edits, side, edge, to, duration, otherEdge) {
  const next = { ...edits, cuts: edits.cuts.map((c) => [...c]) };
  const t = r2(Math.max(0, Math.min(duration || Infinity, to)));
  const bring = (a, b) => {
    next.cuts = subtractRange(next.cuts, a, b);
    if (edits.silences) next.silences = subtractRange(edits.silences, a, b);
    if (edits.fillers) next.fillers = subtractRange(edits.fillers, a, b);
    if (!next.silences || !next.silences.length) delete next.silences;
    if (!next.fillers || !next.fillers.length) delete next.fillers;
  };
  if (side === 'start') {
    const lo = Math.min(t, otherEdge - MIN_SEGMENT);
    const at = Math.max(0, lo);
    if (Math.abs(edge - edits.trimStart) < 0.02) {
      if (at < edge) bring(at, edge);
      next.trimStart = r2(at);
    } else if (at > edge) next.cuts.push([r2(edge), r2(at)]);
    else bring(at, edge);
  } else {
    const hi = Math.max(t, otherEdge + MIN_SEGMENT);
    const at = duration ? Math.min(duration, hi) : hi;
    const end = edits.trimEnd == null ? duration : edits.trimEnd;
    if (Math.abs(edge - end) < 0.02) {
      if (at > edge) bring(edge, at);
      next.trimEnd = duration && at >= duration - 0.01 ? null : r2(at);
    } else if (at < edge) next.cuts.push([r2(at), r2(edge)]);
    else bring(edge, at);
  }
  next.cuts = mergeCuts(next.cuts);
  return next;
}

/* ------------------------------------------------------------------ words, fillers, silences */

/** Words with times. Real word timings (from the transcript pass) when the clip has them; otherwise spread across each line by letter count. */
export function wordsOf(segments, real) {
  if (real && real.length) {
    const out = [];
    let line = 0;
    real.forEach(([s, e, t], i) => {
      while (line < segments.length - 1 && s >= segments[line + 1].s - 0.05) line++;
      out.push({ i, s, e: Math.max(e, s + 0.02), t, line });
    });
    return out;
  }
  const out = [];
  segments.forEach((seg, line) => {
    const parts = seg.t.split(/\s+/).filter(Boolean);
    const total = parts.reduce((s, w) => s + w.length + 1, 0) || 1;
    let at = seg.s;
    const span = Math.max(seg.e - seg.s, 0.2);
    for (const w of parts) {
      const len = ((w.length + 1) / total) * span;
      out.push({ i: out.length, s: at, e: at + len, t: w, line });
      at += len;
    }
  });
  return out;
}

export function wordKept(w, ranges) {
  const mid = (w.s + w.e) / 2;
  return ranges.some(([a, b]) => mid >= a && mid < b);
}

const FILLER = /^(u+h+m*|u+m+h*|e+r+m*|h+m+|m+h?m+|a+h+|e+h+)$/;
const clean = (t) => t.toLowerCase().replace(/[^a-z']/g, '');
const PAUSE = 0.2;
const stops = (t) => /[,.!?;:…—-]\s*$/.test(t);

function breakBefore(words, i, gap = PAUSE) {
  if (i === 0) return true;
  const p = words[i - 1];
  if (stops(p.t)) return true;
  return p.e !== undefined && words[i].s !== undefined && words[i].s - p.e >= gap;
}
function breakAfter(words, i, gap = PAUSE) {
  if (i === words.length - 1) return true;
  if (stops(words[i].t)) return true;
  const n = words[i + 1];
  return words[i].e !== undefined && n.s !== undefined && n.s - words[i].e >= gap;
}

/**
 * Filler words, one list of word indexes per filler. Conservative: um, uh, er, hmm and the like are always filler;
 * "like", "you know" and "I mean" only when set off by a pause or punctuation on both sides; "so" only when it starts
 * a sentence and a pause (or a comma) follows. Real words in the middle of a sentence are left alone.
 */
export function fillerGroups(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const c = clean(words[i].t);
    if (FILLER.test(c)) out.push([i]);
    else if (c === 'like' && breakBefore(words, i) && breakAfter(words, i)) out.push([i]);
    else if (c === 'so' && (i === 0 || /[.!?]\s*$/.test(words[i - 1].t)) && breakAfter(words, i, 0.3)) out.push([i]);
    else if (i + 1 < words.length && ((c === 'you' && clean(words[i + 1].t) === 'know') || (c === 'i' && clean(words[i + 1].t) === 'mean')) && breakBefore(words, i) && breakAfter(words, i + 1)) {
      out.push([i, i + 1]);
      i++;
    }
  }
  return out;
}

export const fillerIndexes = (words) => fillerGroups(words).flat();

export function fillerCuts(words) {
  return mergeCuts(fillerGroups(words).map((g) => [r2(Math.max(0, words[g[0]].s - 0.03)), r2(words[g[g.length - 1]].e + 0.03)]));
}

/** Pauses of more than `minGap` seconds between words, shortened to a short beat. The fallback when there is no audio. */
export function silenceCuts(words, duration, minGap = 1.2, keep = 0.35) {
  const out = [];
  if (!words.length) return out;
  if (words[0].s > minGap + keep) out.push([0, words[0].s - keep]);
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].s - words[i].e;
    if (gap >= minGap) out.push([words[i].e + keep, words[i + 1].s - keep]);
  }
  const last = words[words.length - 1];
  if (duration && duration - last.e > minGap + keep) out.push([last.e + keep, duration]);
  return mergeCuts(out.map(([a, b]) => [r2(a), r2(b)]));
}

export const SILENCE_LEVELS = [
  { id: 'gentle', label: 'Gentle', min: 1 },
  { id: 'normal', label: 'Normal', min: 0.7 },
  { id: 'tight', label: 'Tight', min: 0.4 },
];
export const SILENCE_DEFAULT = 0.7;
export const SILENCE_PAD = 0.15;

/**
 * Silences from the audio energy, not only the gaps between words. A frame is quiet when its level is close to the
 * recording's own noise floor; a quiet run of at least `minSeconds` that holds no spoken word is cut, minus `pad` on each
 * side that touches speech. With no audio, it falls back to long gaps between words.
 */
export function silenceRanges(peaks, words, duration, minSeconds = SILENCE_DEFAULT, pad = SILENCE_PAD) {
  const out = [];
  const spoken = words.map((w) => [w.s, w.e]).sort((a, b) => a[0] - b[0]);
  const runs = [];
  if (peaks && peaks.length > PEAKS_PPS) {
    const frames = Math.min(peaks.length, Math.ceil(duration * PEAKS_PPS));
    const sorted = Array.from(peaks.subarray(0, frames)).sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
    const floor = at(0.1);
    const loud = at(0.9);
    const thr = floor + Math.max(0.03, (loud - floor) * 0.14);
    let from = -1;
    for (let i = 0; i <= frames; i++) {
      const quiet = i < frames && peaks[i] <= thr;
      if (quiet && from < 0) from = i;
      if (!quiet && from >= 0) {
        runs.push([from / PEAKS_PPS, i / PEAKS_PPS]);
        from = -1;
      }
    }
  } else if (spoken.length) {
    let prev = 0;
    for (const [s, e] of spoken) {
      if (s > prev) runs.push([prev, s]);
      prev = Math.max(prev, e);
    }
    if (duration > prev) runs.push([prev, duration]);
  }
  for (const [ra, rb] of runs) {
    let parts = [[ra, rb]];
    for (const [ws, we] of spoken) {
      if (we <= ra || ws >= rb) continue;
      parts = parts.flatMap(([a, b]) => (we <= a || ws >= b ? [[a, b]] : [[a, Math.max(a, ws)], [Math.min(b, we), b]]));
    }
    for (const [a, b] of parts) {
      if (b - a < minSeconds) continue;
      const lo = a <= 0.001 ? 0 : a + pad;
      const hi = duration && b >= duration - 0.001 ? duration : b - pad;
      if (hi - lo >= 0.1) out.push([r2(lo), r2(hi)]);
    }
  }
  return mergeCuts(out);
}

/** The edits with "remove silences" or "remove filler words" turned on or off. Computed from the word times; stored as ranges. */
export function withAuto(edits, kind, on, words, duration, o = {}) {
  const next = { ...edits };
  const min = o.silenceMin || edits.silenceMin || SILENCE_DEFAULT;
  const ranges = on ? (kind === 'silences' ? (o.peaks || words.length ? silenceRanges(o.peaks || null, words, duration, min) : silenceCuts(words, duration)) : fillerCuts(words)) : [];
  if (ranges.length) next[kind] = ranges;
  else delete next[kind];
  if (kind === 'silences') {
    if (on || o.silenceMin) next.silenceMin = min;
    else delete next.silenceMin;
  }
  return next;
}

/* ------------------------------------------------------------------ transcript files */

function clock(t, comma) {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sec)}${comma ? ',' : '.'}${p(ms % 1000, 3)}`;
}

/** The transcript as plain text ("0:12  text") or as SubRip subtitles. Times follow the edited clip; lines that were cut out are left out. */
export function transcriptFile(lines, ranges, kind) {
  const edited = (t) => (ranges.length ? toEdited(t, ranges) : t);
  const kept = lines.filter((l) => !ranges.length || ranges.some(([a, b]) => (l.s + l.e) / 2 >= a && (l.s + l.e) / 2 < b));
  if (kind === 'txt') return kept.map((l) => `${fmtTime(edited(l.s))}  ${l.t}`).join('\n') + '\n';
  return kept.map((l, i) => `${i + 1}\n${clock(edited(l.s), true)} --> ${clock(Math.max(edited(l.e), edited(l.s) + 0.5), true)}\n${l.t}\n`).join('\n');
}

/* ------------------------------------------------------------------ waveform */

/** Peaks, one per 1/PEAKS_PPS second, 0 to 1, drawn from the small audio slices stored with the clip. */
export async function loadPeaks(id, duration, signal) {
  try {
    const res = await fetch(`/api/clips/${id}/audio`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const { slices } = await res.json();
    if (!slices || !slices.length) return null;
    const peaks = new Float32Array(Math.ceil(Math.max(duration, 1) * PEAKS_PPS) + PEAKS_PPS);
    let any = false;
    for (const s of slices) {
      if (signal && signal.cancelled) return null;
      const r = await fetch(`/api/clips/${id}/audio?n=${s.n}`, { credentials: 'same-origin' });
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      let audio;
      try {
        audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
      } catch (e) {
        continue;
      }
      const data = audio.getChannelData(0);
      const per = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PPS));
      const first = Math.round(s.start * PEAKS_PPS);
      for (let i = 0, p = 0; i < data.length; i += per, p++) {
        let m = 0;
        const end = Math.min(data.length, i + per);
        for (let j = i; j < end; j++) {
          const v = Math.abs(data[j]);
          if (v > m) m = v;
        }
        if (first + p < peaks.length) peaks[first + p] = Math.max(peaks[first + p], m);
      }
      any = true;
    }
    if (!any) return null;
    const sorted = Array.from(peaks).filter((v) => v > 0).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.97)] || 1;
    for (let i = 0; i < peaks.length; i++) peaks[i] = Math.min(1, peaks[i] / ref);
    return peaks;
  } catch (e) {
    return null;
  }
}

export function peakBetween(peaks, a, b) {
  const i0 = Math.max(0, Math.floor(a * PEAKS_PPS));
  const i1 = Math.min(peaks.length - 1, Math.max(i0, Math.ceil(b * PEAKS_PPS)));
  let m = 0;
  for (let i = i0; i <= i1; i++) if (peaks[i] > m) m = peaks[i];
  return m;
}
