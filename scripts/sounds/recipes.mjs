// The FavorOS sound family (2026-10-14). One key (A major: A, C#, E, F#, B), two voices (a soft mallet and a bell), short tails and a
// low, even level. The marketing app's Cuelume palette (MIT) is the starting point: the same sine bells with a soft echo, moved down
// into a warmer register and lowpassed so nothing reads as a beep. render.mjs turns these into public/sounds/*.mp3.
//
// A layer: { t: start s, kind: 'sine'|'triangle'|'noise', f: Hz, to: glide to Hz, glide: s, a: attack s, d: decay s, g: peak,
//            filter: 'bandpass'|'lowpass'|'highpass' (noise), q, sweep: Hz the noise filter moves to }
// A recipe: { level: target peak in dBFS, lowpass: Hz, echo: { delay, feedback, wet, lowpass }, layers }

export const NOTE = { A4: 440, Cs5: 554.37, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, Cs6: 1108.73, E6: 1318.51, E4: 329.63, Cs4: 277.18 };

/** A soft mallet: the note, a quiet octave that fades faster, a short fourth partial and a faint click for the strike. */
function mallet(f, t = 0, len = 0.3, g = 1) {
  return [
    { t, kind: 'sine', f, a: 0.004, d: len, g },
    { t, kind: 'sine', f: f * 2, a: 0.003, d: len * 0.45, g: g * 0.16 },
    { t, kind: 'sine', f: f * 4, a: 0.002, d: 0.035, g: g * 0.05 },
    { t, kind: 'noise', filter: 'bandpass', f: Math.min(f * 3, 6000), q: 1.2, a: 0.001, d: 0.012, g: g * 0.12 },
  ];
}
/** A bell: the note, a soft octave and one inharmonic partial that dies early, so it shines and then rests. */
function bell(f, t = 0, len = 0.6, g = 1) {
  return [
    { t, kind: 'sine', f, a: 0.006, d: len, g },
    { t, kind: 'sine', f: f * 2, a: 0.005, d: len * 0.6, g: g * 0.22 },
    { t, kind: 'sine', f: f * 2.76, a: 0.004, d: len * 0.22, g: g * 0.07 },
  ];
}
/** A pad: a slower start and two sines a few cents apart, for things that arrive rather than strike. */
function pad(f, t = 0, len = 0.4, g = 1) {
  return [
    { t, kind: 'sine', f, a: 0.025, d: len, g },
    { t, kind: 'sine', f, detune: 9, a: 0.03, d: len * 1.05, g: g * 0.7 },
    { t, kind: 'sine', f: f * 2, a: 0.02, d: len * 0.4, g: g * 0.08 },
  ];
}

const N = NOTE;
export const RECIPES = {
  // Your own actions (On only, except sent)
  tap: { level: -26, lowpass: 5000, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 1500, q: 1.2, a: 0.001, d: 0.018, g: 1 },
    { t: 0, kind: 'sine', f: N.A5, a: 0.001, d: 0.025, g: 0.25 },
  ] },
  toggle: { level: -25, lowpass: 3600, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 1400, q: 1.4, a: 0.001, d: 0.016, g: 1 },
    { t: 0.026, kind: 'noise', filter: 'bandpass', f: 2200, q: 1.4, a: 0.001, d: 0.018, g: 0.8 },
  ] },
  dismiss: { level: -21, lowpass: 4000, echo: { delay: 0.09, feedback: 0.18, wet: 0.12, lowpass: 2600 }, layers: [
    { t: 0, kind: 'sine', f: N.B5, to: N.E5, glide: 0.12, a: 0.004, d: 0.18, g: 1 },
  ] },
  sent: { level: -22, lowpass: 4000, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 600, sweep: 2400, q: 0.9, a: 0.05, d: 0.09, g: 1 },
    ...mallet(N.E6, 0.085, 0.12, 0.35),
  ] },
  done: { level: -16, lowpass: 5200, echo: { delay: 0.1, feedback: 0.2, wet: 0.12, lowpass: 3600 }, layers: [
    ...mallet(N.A5, 0, 0.16, 0.9), ...mallet(N.Cs6, 0.06, 0.18, 0.9), ...mallet(N.E6, 0.12, 0.36, 1),
  ] },
  error: { level: -15, lowpass: 2600, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 700, q: 1.1, a: 0.001, d: 0.03, g: 1 },
    { t: 0.02, kind: 'triangle', f: N.E4, a: 0.004, d: 0.1, g: 0.5 },
    { t: 0.1, kind: 'triangle', f: N.Cs4, a: 0.004, d: 0.18, g: 0.45 },
  ] },
  // Things that reach you
  message: { level: -16, lowpass: 5200, echo: { delay: 0.09, feedback: 0.15, wet: 0.08, lowpass: 3200 }, layers: [
    ...mallet(N.A5, 0, 0.14, 0.85), ...mallet(N.E6, 0.085, 0.28, 1),
  ] },
  mention: { level: -15, lowpass: 5600, echo: { delay: 0.11, feedback: 0.2, wet: 0.12, lowpass: 3600 }, layers: [
    ...mallet(N.E5, 0, 0.14, 0.8), ...mallet(N.A5, 0.075, 0.16, 0.9), ...bell(N.Cs6, 0.15, 0.42, 1),
  ] },
  notify: { level: -17, lowpass: 4800, echo: { delay: 0.13, feedback: 0.22, wet: 0.14, lowpass: 3200 }, layers: [
    ...bell(N.A5, 0, 0.5, 0.8), ...bell(N.Cs6, 0.012, 0.5, 0.6),
  ] },
  ring: { level: -12, lowpass: 4800, echo: { delay: 0.14, feedback: 0.22, wet: 0.14, lowpass: 3000 }, layers: [
    ...bell(N.E5, 0, 0.5, 0.9), ...bell(N.A5, 0.38, 0.75, 1),
  ] },
  // Meetings and recording
  join: { level: -17, lowpass: 4200, echo: { delay: 0.12, feedback: 0.18, wet: 0.1, lowpass: 2800 }, layers: [
    ...pad(N.A4, 0, 0.22, 0.85), ...pad(N.E5, 0.11, 0.4, 1),
  ] },
  leave: { level: -18, lowpass: 3800, echo: { delay: 0.12, feedback: 0.15, wet: 0.08, lowpass: 2600 }, layers: [
    ...pad(N.E5, 0, 0.2, 0.9), ...pad(N.A4, 0.11, 0.36, 1),
  ] },
  knock: { level: -13, lowpass: 3000, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 520, q: 2, a: 0.001, d: 0.04, g: 1 },
    { t: 0, kind: 'sine', f: 330, a: 0.002, d: 0.06, g: 0.5 },
    { t: 0.15, kind: 'noise', filter: 'bandpass', f: 520, q: 2, a: 0.001, d: 0.04, g: 0.85 },
    { t: 0.15, kind: 'sine', f: 330, a: 0.002, d: 0.06, g: 0.42 },
  ] },
  'rec-start': { level: -17, lowpass: 4200, echo: { delay: 0.1, feedback: 0.15, wet: 0.08, lowpass: 2600 }, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 3000, q: 1.6, a: 0.001, d: 0.014, g: 0.5 },
    { t: 0.02, kind: 'sine', f: N.A4, to: N.E5, glide: 0.16, a: 0.02, d: 0.26, g: 1 },
    { t: 0.02, kind: 'sine', f: N.A4 * 2, to: N.E5 * 2, glide: 0.16, a: 0.02, d: 0.12, g: 0.12 },
  ] },
  'rec-stop': { level: -17, lowpass: 4000, echo: { delay: 0.1, feedback: 0.12, wet: 0.06, lowpass: 2400 }, layers: [
    { t: 0, kind: 'noise', filter: 'bandpass', f: 3000, q: 1.6, a: 0.001, d: 0.014, g: 0.5 },
    { t: 0.02, kind: 'sine', f: N.E5, to: N.A4, glide: 0.16, a: 0.02, d: 0.24, g: 1 },
    { t: 0.02, kind: 'sine', f: N.E5 * 2, to: N.A4 * 2, glide: 0.16, a: 0.02, d: 0.1, g: 0.12 },
  ] },
};
