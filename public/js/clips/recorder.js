// Clips: the recording engine (no page code). Screen or camera, a microphone, optional computer audio, an optional round
// camera bubble drawn into the picture. Ported from ServiceLine Flow's recorderEngine.
//
// What leaves the browser, while you record:
//   video  MediaRecorder output cut into exact parts (8 MiB) and sent as R2 multipart parts (PUT /api/clips/:id/part?n=).
//          Parts are retried with backoff and held in memory until the server has them.
//   audio  the mixed microphone and computer sound, recorded a second time as small standalone files (about 2 minutes each),
//          each sent to PUT /api/clips/:id/audio?n= and read by the transcript service (POST /api/clips/:id/transcribe?n=).
//   poster one JPEG about 2 seconds in.
// On stop only the last part and the last slice are left, then POST /complete. If the tab dies, the server holds the parts it
// already has and the next page load completes them as a partial clip.
import { api, putWithRetry } from './core.js';

export const MAX_SECONDS = 45 * 60;
let maxSeconds = MAX_SECONDS;
/** The longest clip an admin allows; the launcher sets it from the usage answer. */
export function setMaxSeconds(n) { if (n > 0) maxSeconds = n; }
const VIDEO_BPS = 2500000;
const AUDIO_BPS = 32000;
const SLICE_SECONDS = 120;
const TAIL_MS = 3000;
const TAIL_PIECE = 3 * 1024 * 1024;
const FRAME_WIDTH = 1024;
const MAX_FRAMES = 90;

export const BUBBLE_FRACTION = { S: 0.17, M: 0.25, L: 0.36 };
export const BUBBLE_KEY = 'favor.clips.bubble';

/** Debug knobs for local tests only: localStorage 'favor.clips.debug' = {"bps":20000000,"sliceSeconds":6}. */
function debug() {
  try {
    return JSON.parse(localStorage.getItem('favor.clips.debug') || '{}');
  } catch (e) {
    return {};
  }
}

const VIDEO_TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];

/** MP4 (H.264 and AAC) when the browser can write it, else WebM. */
export function pickVideoType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
const pickAudioType = () => (typeof MediaRecorder === 'undefined' ? '' : AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '');

export const canRecordScreen = () => typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
export const canRecordCamera = () => typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';

/** A timer that keeps running when the tab is in the background (workers are not throttled like page timers). */
function workerTick(ms, fn) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch (e) {
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }
}

export class ClipRecorder {
  /**
   * settings: { source: 'screen' | 'screen+camera' | 'camera', surface?: 'monitor' | 'window' | 'browser', micId: string | null,
   *             camId: string | null, facing?: 'user' | 'environment', systemAudio: boolean, title?: string }
   */
  constructor(settings) {
    this.settings = settings;
    this.state = { phase: 'idle', elapsed: 0, level: 0, muted: false, pending: 0, retrying: false, error: '', id: '', mime: '' };
    this.listeners = new Set();
    // The round camera in the picture: size S, M or L and its centre as a fraction of the frame.
    this.bubble = { size: 'M', cx: 0.12, cy: 0.78 };
    /** True while a real floating camera window shows the camera over the whole screen: it is already in the capture, so it is not drawn twice. */
    this.bubbleNative = false;
    this.display = null;
    this.cam = null;
    this.mic = null;
    this.actx = null;
    this.dest = null;
    this.micGain = null;
    this.analyser = null;
    this.mainVideo = null;
    this.camVideo = null;
    this.canvas = null;
    this.outStream = null;
    this.audioStream = null;
    this.stopTicks = [];
    this.rec = null;
    this.mime = '';
    this.chunks = [];
    this.chunkBytes = 0;
    // The tail: every few seconds the bytes recorded since the last tail piece go up on their own, so a closed window or a
    // lost connection costs a few seconds, not everything since the last whole 8 MiB part.
    this.tailBlobs = [];
    this.tailPending = 0;
    this.tailOff = 0;
    this.tailAt = 0;
    this.tailQueue = Promise.resolve();
    // Pictures of the screen, so the clip's title, summary and search know what was shown (see api/clips/[id]/frame.ts).
    this.frameQueue = Promise.resolve();
    this.framesSent = 0;
    this.lastFrameAt = -99;
    this.lastSceneAt = 0;
    this.sceneSig = null;
    this.sceneCtx = null;
    this.frameCanvas = null;
    this.partNo = 0;
    this.partBytes = 8 * 1024 * 1024;
    this.idP = null;
    this.queue = Promise.resolve();
    this.audioQueue = Promise.resolve();
    this.audioRec = null;
    this.audioType = '';
    this.sliceNo = 0;
    this.sliceStart = 0;
    this.stopFlag = { cancelled: false };
    this.monitor = false;
    this.t0 = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.thumbDone = false;
    this.failed = null;
    this.stopping = false;
    this.onUnload = (e) => {
      // Only a recording that lives in a hub page reaches this. The recorder window has no prompt at all.
      e.preventDefault();
      e.returnValue = '';
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  get previewStream() {
    return this.settings.source === 'camera' ? this.cam : this.display;
  }
  get camStream() {
    return this.cam;
  }
  get wholeScreen() {
    return this.monitor;
  }
  get hasCamera() {
    return !!this.cam;
  }

  setBubble(patch) {
    this.bubble = { ...this.bubble, ...patch };
  }

  // ---------- 1. ask for the screen, microphone and camera (must run inside the click) ----------

  async prepare() {
    this.set({ phase: 'preparing', error: '' });
    const s = this.settings;
    // Made now, inside the click, so Safari lets it run.
    const AC = window.AudioContext || window.webkitAudioContext;
    this.actx = new AC();
    this.actx.resume().catch(() => undefined);
    try {
      if (s.source !== 'camera') {
        this.display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 }, ...(s.surface ? { displaySurface: s.surface } : {}) },
          audio: s.systemAudio ? { echoCancellation: false, noiseSuppression: false } : false,
        });
        const vt = this.display.getVideoTracks()[0];
        this.monitor = !!vt && vt.getSettings().displaySurface === 'monitor';
        // The browser's own "Stop sharing" button ends the recording and saves what there is.
        if (vt) {
          vt.addEventListener('ended', () => {
            if (this.state.phase === 'recording' || this.state.phase === 'paused') this.stop();
          });
        }
      }
      if (s.source !== 'screen') {
        this.cam = await navigator.mediaDevices.getUserMedia({
          video: { ...(s.camId ? { deviceId: { exact: s.camId } } : { facingMode: s.facing || 'user' }), width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }
      if (s.micId !== null) {
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({ audio: { ...(s.micId ? { deviceId: { exact: s.micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
          // A missing or blocked microphone is not fatal: record without it.
          this.mic = null;
        }
      }
      await this.build();
      this.set({ phase: 'ready' });
    } catch (e) {
      this.release();
      const msg = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'No screen was picked, so nothing is recording.' : e && e.message ? e.message : 'Could not start.';
      this.set({ phase: 'error', error: msg });
      throw e;
    }
  }

  /** Mix the audio, build the picture (direct, or composited with the camera bubble) and the MediaRecorder. */
  async build() {
    const s = this.settings;
    const mk = (stream) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      v.play().catch(() => undefined);
      return v;
    };
    // audio: mic and computer sound into one track
    const sysTracks = this.display ? this.display.getAudioTracks() : [];
    this.dest = this.actx.createMediaStreamDestination();
    if (this.mic && this.mic.getAudioTracks().length) {
      this.micGain = this.actx.createGain();
      this.analyser = this.actx.createAnalyser();
      this.analyser.fftSize = 512;
      const src = this.actx.createMediaStreamSource(this.mic);
      src.connect(this.micGain);
      this.micGain.connect(this.dest);
      this.micGain.connect(this.analyser);
    }
    if (sysTracks.length) this.actx.createMediaStreamSource(new MediaStream(sysTracks)).connect(this.dest);
    const audioTrack = (this.mic && this.mic.getAudioTracks().length) || sysTracks.length ? this.dest.stream.getAudioTracks()[0] : null;

    // picture
    let videoTrack;
    if (s.source === 'camera') {
      this.mainVideo = mk(this.cam);
      videoTrack = this.cam.getVideoTracks()[0];
    } else {
      this.mainVideo = mk(this.display);
      if (s.source === 'screen+camera' && this.cam) this.camVideo = mk(this.cam);
      // The screen always goes through a canvas of one fixed size, so the file has one steady picture even if the person
      // picks another screen, window or tab from the browser's own sharing bar halfway through. The recorder keeps writing
      // the same stream.
      const st = this.display.getVideoTracks()[0].getSettings();
      const scale = Math.min(1, 1920 / (st.width || 1920), 1080 / (st.height || 1080));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((st.width || 1280) * scale) & ~1;
      canvas.height = Math.round((st.height || 720) * scale) & ~1;
      this.canvas = canvas;
      const g = canvas.getContext('2d');
      const draw = () => this.drawFrame(g, canvas);
      draw();
      this.stopTicks.push(workerTick(33, draw));
      this.outStream = canvas.captureStream(30);
      videoTrack = this.outStream.getVideoTracks()[0];
    }

    const stream = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);
    this.mime = pickVideoType();
    const dbg = debug();
    this.rec = new MediaRecorder(stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: dbg.bps || VIDEO_BPS, audioBitsPerSecond: 128000 });
    this.mime = this.rec.mimeType || this.mime || 'video/webm';
    this.set({ mime: this.mime });
    // If the browser's recorder gives up (the shared screen vanished, an encoder error), keep what was captured and save it.
    this.rec.onerror = () => {
      if (this.state.phase === 'recording' || this.state.phase === 'paused') this.stop();
    };
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.chunks.push(e.data);
      this.chunkBytes += e.data.size;
      this.tailBlobs.push(e.data);
      this.tailPending += e.data.size;
      this.cutParts(false);
      if (Date.now() - this.tailAt >= TAIL_MS) this.sendTail();
    };
    // audio-only copy for the transcript
    this.audioType = pickAudioType();
    this.audioStream = audioTrack ? new MediaStream([this.dest.stream.getAudioTracks()[0].clone()]) : null;
  }

  drawFrame(g, canvas) {
    const v = this.mainVideo;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    // Fit the picture inside the canvas (bars at the sides if the shape changed), never stretch it.
    const k = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
    const w = Math.round(v.videoWidth * k);
    const h = Math.round(v.videoHeight * k);
    if (w < canvas.width || h < canvas.height) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    g.drawImage(v, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
    const native = this.nativeCheck ? this.nativeCheck() : this.bubbleNative;
    const c = native ? null : this.camVideo;
    if (!c || c.readyState < 2 || !c.videoWidth) return;
    const r = Math.round((canvas.height * (BUBBLE_FRACTION[this.bubble.size] || BUBBLE_FRACTION.M)) / 2);
    const m = Math.round(r * 0.2);
    const cx = Math.min(canvas.width - r - m, Math.max(r + m, Math.round(this.bubble.cx * canvas.width)));
    const cy = Math.min(canvas.height - r - m, Math.max(r + m, Math.round(this.bubble.cy * canvas.height)));
    const side = Math.min(c.videoWidth, c.videoHeight);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    g.drawImage(c, (c.videoWidth - side) / 2, (c.videoHeight - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.lineWidth = Math.max(3, r * 0.06);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.stroke();
  }

  // ---------- 2. record ----------

  /** Starts after the countdown. Creates the clip on the server and begins recording and uploading. */
  async begin() {
    if (this.state.phase !== 'ready' && this.state.phase !== 'countdown') return;
    this.idP = api('/api/clips', { method: 'POST', json: { mime: this.mime, kind: this.settings.source === 'camera' ? 'camera' : 'screen', title: this.settings.title || '' } }).then((r) => {
      this.partBytes = r.partBytes || this.partBytes;
      this.set({ id: r.id });
      return r.id;
    });
    this.idP.catch((e) => this.fail(e instanceof Error ? e : new Error('Could not start the upload.')));
    if (!this.settings.noUnloadPrompt) window.addEventListener('beforeunload', this.onUnload);
    this.tailAt = Date.now();
    this.t0 = Date.now();
    this.pausedTotal = 0;
    this.rec.start(1000);
    if (this.audioStream && this.audioType) this.startSlice();
    this.set({ phase: 'recording', elapsed: 0 });
    this.stopTicks.push(workerTick(250, () => this.tick()));
  }

  /** Seconds recorded so far, by the wall clock, so it stays right while the tab is throttled. */
  elapsedNow() {
    const paused = this.pausedAt ? Date.now() - this.pausedAt : 0;
    return Math.max(0, (Date.now() - this.t0 - this.pausedTotal - paused) / 1000);
  }

  micLevel() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += ((b - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  tick() {
    if (this.state.phase !== 'recording' && this.state.phase !== 'paused') return;
    const elapsed = this.elapsedNow();
    const level = this.state.phase === 'recording' ? this.micLevel() : 0;
    if (this.state.phase === 'recording') {
      this.frameTick(elapsed);
      if (!this.thumbDone && elapsed >= 2) this.poster();
      if (elapsed - this.sliceStart >= (debug().sliceSeconds || SLICE_SECONDS) && this.audioRec) this.rotateSlice();
      if (elapsed >= maxSeconds) {
        this.stop();
        return;
      }
    }
    // While paused the recorder produces no bytes; a small "still here" message keeps the clip from looking abandoned.
    if (this.state.phase === 'paused' && Date.now() - this.tailAt >= 5000) this.sendTail();
    this.set({ elapsed, level });
  }

  pause() {
    if (this.state.phase !== 'recording') return;
    if (this.rec) this.rec.pause();
    if (this.audioRec) this.audioRec.pause();
    this.pausedAt = Date.now();
    this.set({ phase: 'paused', level: 0 });
  }

  resume() {
    if (this.state.phase !== 'paused') return;
    if (this.rec) this.rec.resume();
    if (this.audioRec) this.audioRec.resume();
    this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.set({ phase: 'recording' });
  }

  setMuted(muted) {
    if (this.micGain) this.micGain.gain.value = muted ? 0 : 1;
    this.set({ muted });
  }

  // ---------- video parts ----------

  /** Slice the buffered data into exact-size parts. With `last`, whatever remains goes up as the final (smaller) part. */
  cutParts(last) {
    while (this.chunkBytes >= this.partBytes || (last && this.chunkBytes > 0)) {
      const all = new Blob(this.chunks);
      const take = last ? all.size : this.partBytes;
      const part = all.slice(0, take, this.mime);
      const rest = all.slice(take, all.size, this.mime);
      this.chunks = rest.size ? [rest] : [];
      this.chunkBytes = rest.size;
      this.sendPart(part);
      if (last) break;
    }
  }

  sendPart(blob) {
    const n = ++this.partNo;
    const elapsed = this.elapsedNow();
    this.set({ pending: this.state.pending + 1 });
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      try {
        const id = await this.idP;
        await putWithRetry(`/api/clips/${id}/part?n=${n}`, blob, { 'x-elapsed': elapsed.toFixed(1), 'content-type': 'application/octet-stream' }, this.stopFlag, (a) => this.set({ retrying: a > 0 }));
        this.set({ pending: this.state.pending - 1, retrying: false });
      } catch (e) {
        this.fail(e instanceof Error ? e : new Error('Upload failed'));
      }
    });
  }

  /** Sends the bytes since the last tail piece in pieces of at most 3 MiB. Failures are ignored: the parts are what counts. */
  sendTail() {
    this.tailAt = Date.now();
    const elapsed = this.elapsedNow();
    const all = this.tailPending ? new Blob(this.tailBlobs, { type: this.mime }) : null;
    this.tailBlobs = [];
    this.tailPending = 0;
    const pieces = [];
    if (all) for (let o = 0; o < all.size; o += TAIL_PIECE) pieces.push(all.slice(o, Math.min(o + TAIL_PIECE, all.size)));
    if (!pieces.length) pieces.push(new Blob([]));
    for (const piece of pieces) {
      const off = this.tailOff;
      this.tailOff += piece.size;
      this.tailQueue = this.tailQueue.then(async () => {
        if (this.failed || this.stopping || this.stopFlag.cancelled) return;
        try {
          const id = await this.idP;
          const res = await fetch(`/api/clips/${id}/tail?off=${off}`, { method: 'PUT', body: piece, credentials: 'same-origin', headers: { 'x-elapsed': elapsed.toFixed(1), 'content-type': 'application/octet-stream' } });
          void res;
        } catch (e) {
          // the next piece tries again from its own position
        }
      });
    }
  }

  // ---------- pictures of the screen ----------

  /** Every few seconds, and when the picture changes a lot, send a small JPEG of the screen. */
  frameTick(elapsed) {
    if (this.settings.source === 'camera' || this.framesSent >= MAX_FRAMES || !this.mainVideo || this.mainVideo.readyState < 2) return;
    const since = elapsed - this.lastFrameAt;
    const interval = elapsed < 120 ? 6 : elapsed < 600 ? 12 : 25;
    let take = since >= interval || (this.lastFrameAt < 0 && elapsed >= 1.5);
    if (!take && since >= 3 && elapsed - this.lastSceneAt >= 1) {
      this.lastSceneAt = elapsed;
      take = this.sceneChanged();
    }
    if (!take) return;
    this.lastFrameAt = elapsed;
    this.sendFrame(elapsed);
  }

  /** A tiny gray copy of the screen, compared with the last one. A big average difference means a new screen. */
  sceneChanged() {
    const v = this.mainVideo;
    if (!v || !v.videoWidth) return false;
    if (!this.sceneCtx) {
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = 27;
      this.sceneCtx = c.getContext('2d', { willReadFrequently: true });
    }
    this.sceneCtx.drawImage(v, 0, 0, 48, 27);
    const px = this.sceneCtx.getImageData(0, 0, 48, 27).data;
    const sig = new Uint8Array(48 * 27);
    for (let i = 0; i < sig.length; i++) sig[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
    const prev = this.sceneSig;
    this.sceneSig = sig;
    if (!prev) return false;
    let d = 0;
    for (let i = 0; i < sig.length; i++) d += Math.abs(sig[i] - prev[i]);
    return d / sig.length > 12;
  }

  sendFrame(elapsed) {
    const v = this.mainVideo;
    if (!v || !v.videoWidth) return;
    if (!this.frameCanvas) this.frameCanvas = document.createElement('canvas');
    const c = this.frameCanvas;
    c.width = Math.min(FRAME_WIDTH, v.videoWidth);
    c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const t = Math.round(elapsed * 1000);
    this.framesSent++;
    c.toBlob((blob) => {
      if (!blob) return;
      this.frameQueue = this.frameQueue.then(async () => {
        if (this.failed || this.stopFlag.cancelled) return;
        try {
          const id = await this.idP;
          await fetch(`/api/clips/${id}/frame?t=${t}`, { method: 'PUT', body: blob, credentials: 'same-origin', headers: { 'content-type': 'image/jpeg' } });
        } catch (e) {
          // a missed picture costs a little detail, nothing more
        }
      });
    }, 'image/jpeg', 0.7);
  }

  // ---------- audio slices ----------

  startSlice() {
    const stream = this.audioStream;
    const rec = new MediaRecorder(stream, { ...(this.audioType ? { mimeType: this.audioType } : {}), audioBitsPerSecond: AUDIO_BPS });
    const parts = [];
    const n = this.sliceNo++;
    const start = this.elapsedNow();
    this.sliceStart = start;
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || this.audioType || 'audio/webm' });
      if (blob.size < 2000) return; // nothing was said
      this.sendAudio(n, start, blob);
    };
    rec.start(5000);
    this.audioRec = rec;
  }

  /** Start the next slice before ending this one, so no speech falls between two files. */
  rotateSlice() {
    const old = this.audioRec;
    this.startSlice();
    if (old && old.state !== 'inactive') old.stop();
  }

  sendAudio(n, start, blob) {
    this.audioQueue = this.audioQueue.then(async () => {
      if (this.failed) return;
      try {
        const id = await this.idP;
        await putWithRetry(`/api/clips/${id}/audio?n=${n}&start=${start.toFixed(2)}`, blob, { 'content-type': blob.type || 'audio/webm' }, this.stopFlag);
        // Read it now, while the recording goes on, without holding anything up. The last slice is left to the final pass
        // (which also names the clip), so stopping never waits on the transcript.
        if (!this.stopping) fetch(`/api/clips/${id}/transcribe?n=${n}`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
      } catch (e) {
        // the sound is a bonus; the picture is what matters
      }
    });
  }

  // ---------- poster ----------

  async poster() {
    this.thumbDone = true;
    const v = this.mainVideo;
    if (!v || !v.videoWidth) {
      this.thumbDone = false;
      return;
    }
    const w = 1280;
    const h = Math.round((w * v.videoHeight) / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(this.canvas || v, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
    if (!blob) return;
    const id = await this.idP.catch(() => '');
    if (id) fetch(`/api/clips/${id}/poster`, { method: 'PUT', body: blob, credentials: 'same-origin', headers: { 'content-type': 'image/jpeg' } }).catch(() => undefined);
  }

  // ---------- finish ----------

  fail(e) {
    if (this.failed) return;
    this.failed = e;
    this.stopFlag.cancelled = true;
    window.removeEventListener('beforeunload', this.onUnload);
    this.stopRecorders();
    this.release();
    this.set({ phase: 'error', error: e.message || 'The upload failed.' });
  }

  stopRecorders() {
    for (const r of [this.rec, this.audioRec]) {
      try {
        if (r && r.state !== 'inactive') r.stop();
      } catch (e) {
        // already stopped
      }
    }
  }

  /** Stop, send the last part, and complete. Resolves with { id, durationMs } or null. */
  async stop() {
    if (this.state.phase !== 'recording' && this.state.phase !== 'paused') return null;
    const duration = this.elapsedNow();
    this.stopping = true;
    this.set({ phase: 'finishing', elapsed: duration });
    if (!this.thumbDone && duration >= 0.5) await this.poster();
    const rec = this.rec;
    const finalData = new Promise((ok) => {
      rec.onstop = () => ok();
    });
    const audioRec = this.audioRec;
    const audioDone = new Promise((ok) => {
      if (!audioRec || audioRec.state === 'inactive') return ok();
      const prev = audioRec.onstop;
      audioRec.onstop = (ev) => {
        if (prev) prev.call(audioRec, ev);
        ok();
      };
      if (audioRec.state === 'paused') audioRec.resume();
      audioRec.stop();
    });
    if (rec.state === 'paused') rec.resume();
    rec.stop();
    await Promise.all([finalData, audioDone]);
    this.cutParts(true);
    window.removeEventListener('beforeunload', this.onUnload);
    this.release();
    try {
      await this.queue;
      await this.audioQueue;
      if (this.failed) return null;
      const id = await this.idP;
      const durationMs = Math.round(duration * 1000);
      await api(`/api/clips/${id}/complete`, { method: 'POST', json: { durationMs } });
      this.set({ phase: 'done', id });
      return { id, durationMs };
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error('Could not save the recording.'));
      return null;
    }
  }

  /** Throw the recording away: stops everything and tells the server to delete what it received. */
  async cancel() {
    this.stopFlag.cancelled = true;
    window.removeEventListener('beforeunload', this.onUnload);
    this.stopRecorders();
    this.release();
    const had = this.idP;
    this.set({ phase: 'idle', elapsed: 0, pending: 0 });
    if (had) {
      const id = await had.catch(() => '');
      if (id) await api(`/api/clips/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }

  release() {
    for (const stop of this.stopTicks.splice(0)) stop();
    for (const s of [this.display, this.cam, this.mic, this.outStream, this.audioStream]) if (s) s.getTracks().forEach((t) => t.stop());
    if (this.actx) this.actx.close().catch(() => undefined);
    this.actx = null;
    for (const v of [this.mainVideo, this.camVideo]) if (v) v.srcObject = null;
  }

  /** Close the streams without recording (the card was dismissed before the countdown). */
  discard() {
    this.stopFlag.cancelled = true;
    this.release();
    this.set({ phase: 'idle' });
  }
}
