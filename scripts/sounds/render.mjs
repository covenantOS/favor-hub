#!/usr/bin/env node
// Renders the FavorOS sound family (recipes.mjs) to public/sounds/<name>.mp3 through a browser's OfflineAudioContext, so the files
// sound exactly like Web Audio would play them live. Each file is normalized to its recipe's level, trimmed at -60 dB and encoded as
// 64 kbit/s mono MP3 (every browser decodes it; each file stays well under 20 KB).
//
//   node scripts/sounds/render.mjs            needs Microsoft Edge (Playwright channel msedge) and ffmpeg on the PATH
//   node scripts/sounds/render.mjs --wav      also keeps the WAV next to each MP3 in the --out folder
//   node scripts/sounds/render.mjs --out DIR  write somewhere else (default public/sounds)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { RECIPES } from './recipes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'public', 'sounds');
const KEEP_WAV = args.includes('--wav');
const RATE = 48000;

function renderInPage({ recipe, rate }) {
  // A small seeded generator, so the noise in each sound is the same on every render.
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const echoTail = (e) => (e ? e.delay * (1 + Math.ceil(Math.log(0.001) / Math.log(e.feedback))) : 0);
  const end = Math.max(...recipe.layers.map((l) => (l.t || 0) + l.a + l.d + 0.05)) + echoTail(recipe.echo) + 0.05;
  const ctx = new OfflineAudioContext(1, Math.ceil(end * rate), rate);
  const master = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = recipe.lowpass || 6000; lp.Q.value = 0.5;
  master.connect(lp); lp.connect(ctx.destination);
  if (recipe.echo) {
    const e = recipe.echo, dl = ctx.createDelay(1), fl = ctx.createBiquadFilter(), fb = ctx.createGain(), wet = ctx.createGain();
    dl.delayTime.value = e.delay; fl.type = 'lowpass'; fl.frequency.value = e.lowpass; fb.gain.value = e.feedback; wet.gain.value = e.wet;
    master.connect(dl); dl.connect(fl); fl.connect(fb); fb.connect(dl); fl.connect(wet); wet.connect(lp);
  }
  for (const l of recipe.layers) {
    const t = l.t || 0, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(l.g, t + l.a); g.gain.exponentialRampToValueAtTime(0.0001, t + l.a + l.d);
    g.connect(master);
    if (l.kind === 'noise') {
      const len = Math.ceil((l.a + l.d + 0.05) * rate), buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = 2 * rnd() - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = l.filter || 'bandpass'; f.frequency.setValueAtTime(l.f, t); if (l.q) f.Q.value = l.q;
      if (l.sweep) f.frequency.exponentialRampToValueAtTime(l.sweep, t + l.a + l.d);
      src.connect(f); f.connect(g); src.start(t); src.stop(t + l.a + l.d + 0.05);
    } else {
      const o = ctx.createOscillator(); o.type = l.kind; o.frequency.setValueAtTime(l.f, t); if (l.detune) o.detune.value = l.detune;
      if (l.to) o.frequency.exponentialRampToValueAtTime(l.to, t + (l.glide || l.a + l.d));
      o.connect(g); o.start(t); o.stop(t + l.a + l.d + 0.05);
    }
  }
  return ctx.startRendering().then((b) => Array.from(b.getChannelData(0)));
}

function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2));
  return buf;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.goto('about:blank');
for (const [name, recipe] of Object.entries(RECIPES)) {
  let s = await page.evaluate(renderInPage, { recipe, rate: RATE });
  const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const k = Math.pow(10, recipe.level / 20) / peak;
  s = s.map((v) => v * k);
  // Trim the tail where it falls below -60 dB, with a 10 ms fade so the cut is silent.
  const floor = Math.pow(10, -60 / 20);
  let last = s.length - 1; while (last > 0 && Math.abs(s[last]) < floor) last--;
  s = s.slice(0, Math.min(s.length, last + Math.round(RATE * 0.01)));
  const fade = Math.round(RATE * 0.01); for (let i = 0; i < fade && i < s.length; i++) s[s.length - 1 - i] *= i / fade;
  const w = join(OUT, name + '.wav'), m = join(OUT, name + '.mp3');
  writeFileSync(w, wav(s, RATE));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', m]);
  if (!KEEP_WAV) rmSync(w);
  console.log(name.padEnd(10), (s.length / RATE).toFixed(2) + ' s', statSync(m).size + ' bytes');
}
await browser.close();
