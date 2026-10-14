// Meetings: sound and picture clean-up that runs in this browser, free, with nothing sent to any service.
// Voice: a high-pass filter (rumble, desk knocks), an optional noise gate for a loud room, a compressor and a make-up gain so
// quiet and loud talkers land near the same level. Camera: background blur, a background picture, and a brighten pass for a dark
// room, from Google's MediaPipe selfie segmenter (Apache 2.0) loaded from jsDelivr on first use. Both give back a new track that
// goes on the same sender; the camera effect turns itself off when this device cannot keep up.

// ---------------------------------------------------------------- voice
const GATE_WORKLET = `
class Gate extends AudioWorkletProcessor {
  constructor() { super(); this.g = 1; this.floor = 0.003; this.hold = 0; }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0]; if (!i || !i[0]) return true;
    const x = i[0]; let s = 0; for (let k = 0; k < x.length; k++) s += x[k] * x[k];
    const rms = Math.sqrt(s / x.length);
    // The noise floor follows the quietest stretches; speech is anything well above it.
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.9995 + rms * 0.0005;
    const open = rms > Math.max(0.006, this.floor * 3.2);
    if (open) this.hold = 24; else if (this.hold > 0) this.hold--;
    const target = open || this.hold > 0 ? 1 : 0.12;
    for (let c = 0; c < o.length; c++) { const xi = i[c] || x, oc = o[c]; let g = this.g; for (let k = 0; k < oc.length; k++) { g += (target - g) * (target > g ? 0.02 : 0.002); oc[k] = xi[k] * g; } if (c === o.length - 1) this.g = g; }
    return true;
  }
}
registerProcessor('favor-gate', Gate);`;

const NS = 'https://cdn.jsdelivr.net/npm/@sapphi-red/web-noise-suppressor@0.3.5/dist/';
let rnnWasm = null;
async function rnnoiseNode(ctx) {
  if (ctx.sampleRate !== 48000 || !ctx.audioWorklet) return null;
  if (!rnnWasm) rnnWasm = (async () => {
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    const r = await fetch(NS + (simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm'));
    if (!r.ok) throw new Error('rnnoise ' + r.status);
    return r.arrayBuffer();
  })().catch((e) => { rnnWasm = null; throw e; });
  const [bin] = await Promise.all([rnnWasm, ctx.audioWorklet.addModule(NS + 'rnnoise/workletProcessor.js')]);
  return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', { processorOptions: { maxChannels: 1, wasmBinary: bin.slice(0) } });
}

export class VoiceFx {
  /** opts: { gate: boolean } */
  constructor(opts = {}) { this.opts = opts; this.ctx = null; this.out = null; }
  /** Returns the processed track, or null when the audio engine is not running (the caller then sends the raw track). */
  async start(raw) {
    this.stop();
    const C = window.AudioContext || window.webkitAudioContext;
    // RNNoise works on 48 kHz frames, so the engine runs at that rate when strong noise reduction is on.
    const ctx = (this.ctx = new C(this.opts.gate ? { latencyHint: 'interactive', sampleRate: 48000 } : { latencyHint: 'interactive' }));
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]); } catch {} }
    if (ctx.state !== 'running') { this.stop(); return null; }
    const src = ctx.createMediaStreamSource(new MediaStream([raw]));
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -32; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    const gain = ctx.createGain(); gain.gain.value = 1.7;
    const dest = ctx.createMediaStreamDestination();
    let node = src; node.connect(hp); node = hp;
    // Strong noise reduction: RNNoise (xiph, BSD) in an AudioWorklet, from @sapphi-red/web-noise-suppressor (MIT) on jsDelivr,
    // loaded on first use and cached by the browser. It removes keyboards, fans and dogs that the browser's own filter lets
    // through. When it cannot load, the simpler gate below takes its place.
    let rnn = null;
    if (this.opts.gate) rnn = await rnnoiseNode(ctx).catch(() => null);
    if (rnn) { node.connect(rnn); node = rnn; this.rnn = rnn; }
    else if (this.opts.gate) {
      try {
        const url = URL.createObjectURL(new Blob([GATE_WORKLET], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        const g = new AudioWorkletNode(ctx, 'favor-gate'); node.connect(g); node = g;
      } catch { /* no worklet: the rest of the chain still runs */ }
    }
    node.connect(comp); comp.connect(gain); gain.connect(dest);
    this.out = dest.stream.getAudioTracks()[0];
    return this.out;
  }
  stop() { try { this.rnn && this.rnn.port.postMessage('destroy'); } catch {} this.rnn = null; try { this.ctx && this.ctx.close(); } catch {} this.ctx = null; if (this.out) { this.out.stop(); this.out = null; } }
}

// ---------------------------------------------------------------- camera
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
let segP = null;
function segmenter() {
  if (!segP) segP = (async () => {
    const v = await import(/* @vite-ignore */ MP + '/vision_bundle.mjs');
    const files = await v.FilesetResolver.forVisionTasks(MP + '/wasm');
    const make = (delegate) => v.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })().catch((e) => { segP = null; throw e; });
  return segP;
}

// Favor backgrounds drawn in code (brand greens and golds), so nothing has to be stored or downloaded.
export const BACKGROUNDS = [
  { id: 'leaf', label: 'Leaf', paint: (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2f4a2a'); g.addColorStop(1, '#6f8a5a'); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
  { id: 'ivory', label: 'Ivory', paint: (c, w, h) => { const g = c.createRadialGradient(w * 0.3, h * 0.2, 10, w * 0.5, h * 0.5, w * 0.8); g.addColorStop(0, '#fbf8f0'); g.addColorStop(1, '#d9d1bd'); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
  { id: 'gold', label: 'Gold', paint: (c, w, h) => { const g = c.createLinearGradient(0, h, w, 0); g.addColorStop(0, '#7a5a22'); g.addColorStop(1, '#d6b46a'); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
  { id: 'office', label: 'Office', paint: (c, w, h) => { c.fillStyle = '#e9e4d8'; c.fillRect(0, 0, w, h); c.fillStyle = '#d4ccb9'; c.fillRect(0, h * 0.72, w, h * 0.28); c.fillStyle = '#5a7250'; for (let i = 0; i < 3; i++) c.fillRect(w * (0.12 + i * 0.3), h * 0.18, w * 0.2, h * 0.34); } },
];

export class CamFx {
  /** opts: { bg: 'none' | 'blur' | 'image', image: background id or a data URL, light: boolean, onSlow() } */
  constructor(opts = {}) { this.opts = opts; this.out = null; this.run = false; this.ms = []; }
  static wanted(p) { return (p.bg && p.bg !== 'none') || !!p.light; }
  async start(raw) {
    this.stop();
    const st = raw.getSettings();
    const W = st.width || 1280, H = st.height || 720;
    const video = (this.video = document.createElement('video')); video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([raw]);
    await video.play().catch(() => {});
    const canvas = (this.canvas = document.createElement('canvas')); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const needSeg = this.opts.bg === 'blur' || this.opts.bg === 'image';
    const seg = needSeg ? await segmenter() : null;
    const mask = document.createElement('canvas'), mctx = mask.getContext('2d');
    const person = document.createElement('canvas'); person.width = W; person.height = H; const pctx = person.getContext('2d');
    let bgImg = null;
    if (this.opts.bg === 'image') {
      const pre = BACKGROUNDS.find((b) => b.id === this.opts.image);
      bgImg = document.createElement('canvas'); bgImg.width = W; bgImg.height = H;
      if (pre || !this.opts.image) (pre || BACKGROUNDS[0]).paint(bgImg.getContext('2d'), W, H);
      else { const im = new Image(); im.src = this.opts.image; await im.decode().catch(() => {}); const c = bgImg.getContext('2d'); const s = Math.max(W / (im.width || W), H / (im.height || H)); c.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s); }
    }
    const light = this.opts.light ? 'brightness(1.18) contrast(1.06) saturate(1.06)' : 'none';
    this.run = true;
    const frame = () => {
      if (!this.run) return;
      const t0 = performance.now();
      try {
        if (seg) {
          const res = seg.segmentForVideo(video, t0);
          const m = res.confidenceMasks && res.confidenceMasks[0];
          if (m) {
            const mw = m.width, mh = m.height, f = m.getAsFloat32Array();
            if (mask.width !== mw) { mask.width = mw; mask.height = mh; this.id = mctx.createImageData(mw, mh); }
            const d = this.id.data;
            for (let i = 0; i < f.length; i++) { const a = f[i]; d[i * 4 + 3] = a < 0.35 ? 0 : a > 0.75 ? 255 : ((a - 0.35) / 0.4) * 255; }
            mctx.putImageData(this.id, 0, 0);
          }
          res.close && res.close();
          // The person: the mask, then the camera picture kept only where the mask is.
          pctx.globalCompositeOperation = 'copy'; pctx.filter = 'blur(2px)'; pctx.drawImage(mask, 0, 0, W, H);
          pctx.globalCompositeOperation = 'source-in'; pctx.filter = light; pctx.drawImage(video, 0, 0, W, H);
          // The background under it.
          ctx.globalCompositeOperation = 'copy';
          if (bgImg) { ctx.filter = 'none'; ctx.drawImage(bgImg, 0, 0); } else { ctx.filter = 'blur(14px)'; ctx.drawImage(video, 0, 0, W, H); }
          ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.drawImage(person, 0, 0);
        } else { ctx.filter = light; ctx.drawImage(video, 0, 0, W, H); }
      } catch { /* a dropped frame */ }
      // Keep an eye on the cost: a device that needs over 45 ms a frame for three seconds gets the plain camera back.
      // The first two seconds are the model warming up (shader compile, first inference) and are not counted.
      this.n = (this.n || 0) + 1;
      if (this.n > 48) { this.ms.push(performance.now() - t0); if (this.ms.length > 72) this.ms.shift(); }
      if (this.ms.length >= 72 && this.ms.reduce((a, b) => a + b, 0) / this.ms.length > 45 && this.opts.onSlow) { const cb = this.opts.onSlow; this.opts.onSlow = null; cb(); return; }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame); else setTimeout(frame, 40);
    };
    frame();
    this.out = canvas.captureStream(24).getVideoTracks()[0];
    this.out._raw = raw;
    return this.out;
  }
  avgMs() { return this.ms.length ? this.ms.reduce((a, b) => a + b, 0) / this.ms.length : 0; }
  stop() { this.run = false; if (this.out) { this.out.stop(); this.out = null; } if (this.video) { this.video.srcObject = null; this.video = null; } }
}
