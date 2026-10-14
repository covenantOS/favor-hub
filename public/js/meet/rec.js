// Meetings: recording in a participant's browser. The host's browser mixes the meeting (a picture of the gallery and the sound of
// everyone) into a MediaRecorder and sends it up in one second pieces as it goes. The transcript is read from each person's own track (see startPieces). If that browser closes, another person in the
// room takes over: a standby watches the recording's heartbeat and claims it when the last piece is more than three seconds old.
// Sound-only meetings record no picture at all. Phase 0 measured the takeover gap at 3.1 to 4.1 seconds.
import { initials, hashColor } from './ui.js';

const W = 960, H = 540, FPS = 10;
// A person's track counts as talking above this level; a piece needs 0.4 s of it to be sent; 0.7 s of quiet ends a piece.
const VOICE_ON = 0.012, VOICE_MIN = 4, PAUSE_MS = 700, PIECE_MAX_MS = 20000, IDLE_MS = 3000;

export class Recorder {
  constructor({ MID, S, api, getInput, toast, hostish }) {
    Object.assign(this, { MID, S, api, getInput, toast, hostish });
    this.mr = null;
    this.epoch = 0;
    this.seq = 0;
    this.lastAt = 0;
    this.queue = Promise.resolve();
    this.canvas = null;
    this.ctx2d = null;
    this.timer = null;
    this.actx = null;
    this.dest = null;
    this.srcs = new Map();
    this.claiming = false;
    this.warm = false;
    this.stats = { chunks: 0, bytes: 0, failed: 0 };
    this.voices = null; this.vN = 0; this.vEpoch = 0; this.vMime = ''; this.aq = Promise.resolve();
  }

  get mode() { return (this.S.recording && this.S.recording.mode) || this.S.meeting.rec; }
  get active() { return !!this.mr && this.mr.state !== 'inactive'; }
  url(p) { return `meetings/${this.MID}/rec/${p}${p.includes('?') ? '&' : '?'}pid=${this.S.me.pid}`; }

  async start() {
    const r = await this.api(this.url('start'), { method: 'POST', body: {} });
    this.begin(r.epoch, r.mode);
  }

  async stop() {
    await this.stopIfOwner(true);
    await this.api(this.url('stop'), { method: 'POST', body: {} });
  }

  async stopIfOwner(force) {
    if (!this.mr) return;
    const mr = this.mr;
    this.mr = null;
    this.stopPieces();
    if (mr.state !== 'inactive') {
      const done = new Promise((res) => { mr.onstop = res; });
      try { mr.stop(); } catch {}
      await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    }
    await new Promise((r) => setTimeout(r, 500));
    await this.queue;
    await this.aq;
    this.teardown();
  }

  teardown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.canvas = null; this.warm = false;
    try { this.actx && this.actx.close(); } catch {}
    this.actx = null; this.dest = null; this.srcs.clear();
  }

  // ---- mixing
  prepare() {
    if (this.warm) return;
    this.warm = true;
    this.actx = new (window.AudioContext || window.webkitAudioContext)();
    this.dest = this.actx.createMediaStreamDestination();
    const video = this.mode === 'video';
    if (video) {
      this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H; this.ctx2d = this.canvas.getContext('2d');
    }
    this.timer = setInterval(() => { this.mixAudio(); this.voiceTick(); if (video) this.draw(); }, 100);
  }

  mixAudio() {
    const { remote, local } = this.getInput();
    const add = (stream) => {
      if (!stream || this.srcs.has(stream.id) || !stream.getAudioTracks().length) return;
      try { const s = this.actx.createMediaStreamSource(stream); s.connect(this.dest); this.srcs.set(stream.id, s); } catch {}
    };
    for (const [, r] of remote) if (r.mid) add(r.stream);
    if (local.mic) { const k = 'local-' + local.mic.id; if (!this.srcs.has(k)) { try { const s = this.actx.createMediaStreamSource(new MediaStream([local.mic])); s.connect(this.dest); this.srcs.set(k, s); } catch {} } }
    if (local.screenAudio) { const k = 'screen-' + local.screenAudio.id; if (!this.srcs.has(k)) { try { const s = this.actx.createMediaStreamSource(new MediaStream([local.screenAudio])); s.connect(this.dest); this.srcs.set(k, s); } catch {} } }
  }

  // The picture is built from the roster, not from the tiles on this host's page, so everyone is in the file by their own name
  // however the gallery is paged. A person whose camera is off, or who is on another page, is drawn as initials.
  draw() {
    const { tiles } = this.getInput();
    const c = this.ctx2d;
    c.fillStyle = '#1f261d'; c.fillRect(0, 0, W, H);
    const people = (this.S.people || []).filter((p) => !p.waiting);
    const shareOf = (p) => tiles.get('share:' + p.pid);
    const liveVideo = (t) => (t && t.el && t.el.isConnected && t.video && t.video.videoWidth && t.video.style.display !== 'none' && t.video.readyState >= 2 ? t.video : null);
    const sharer = people.find((p) => liveVideo(shareOf(p)));
    const cams = people.map((p) => ({ name: p.name, video: p.cam === false ? null : liveVideo(tiles.get(p.pid)) }));
    const cell = (name, v, x, y, w, h, fit) => {
      c.fillStyle = hashColor(name); c.fillRect(x, y, w, h);
      if (v) {
        const vr = v.videoWidth / v.videoHeight, cr = w / h;
        let dw = w, dh = h, dx = x, dy = y;
        if (fit === 'contain') { if (vr > cr) { dh = w / vr; dy = y + (h - dh) / 2; } else { dw = h * vr; dx = x + (w - dw) / 2; } }
        else if (vr > cr) { dw = h * vr; dx = x - (dw - w) / 2; } else { dh = w / vr; dy = y - (dh - h) / 2; }
        c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.drawImage(v, dx, dy, dw, dh); c.restore();
      } else {
        c.fillStyle = 'rgba(255,255,255,.9)'; c.font = `500 ${Math.round(Math.min(h / 3, 72))}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(initials(name), x + w / 2, y + h / 2);
      }
      c.fillStyle = 'rgba(20,24,18,.62)'; c.font = '500 14px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      const tw = Math.min(w - 16, c.measureText(name).width + 16); c.fillRect(x + 8, y + h - 30, tw, 22);
      c.fillStyle = '#f4f2ea'; c.fillText(name.slice(0, 40), x + 16, y + h - 19);
    };
    if (sharer) {
      const sw = Math.floor(W * 0.78);
      cell(sharer.name + "'s screen", liveVideo(shareOf(sharer)), 0, 0, sw, H, 'contain');
      const side = cams.slice(0, 4);
      side.forEach((t, i) => cell(t.name, t.video, sw + 4, i * (H / 4), W - sw - 4, H / 4 - 4, 'cover'));
    } else {
      const n = Math.max(1, cams.length); const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5; const rows = Math.ceil(n / cols);
      const w = W / cols, h = H / rows;
      cams.forEach((t, i) => cell(t.name, t.video, (i % cols) * w + 2, Math.floor(i / cols) * h + 2, w - 4, h - 4, 'cover'));
    }
  }

  // ---- recorder
  begin(epoch, mode) {
    this.prepare();
    this.mixAudio();
    const tracks = [...this.dest.stream.getAudioTracks()];
    const stream = new MediaStream();
    tracks.forEach((t) => stream.addTrack(t));
    let mime;
    if (mode === 'video') {
      this.canvas.captureStream(FPS).getVideoTracks().forEach((t) => stream.addTrack(t));
      mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    } else mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) { this.toast('This browser cannot record. Ask another host to record.'); return; }
    this.epoch = epoch; this.seq = 0; this.lastAt = Date.now();
    // A keyframe every 2 seconds where the browser allows it, so a stretch cut from the video later ends within 2 seconds of where the host asked.
    this.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000, videoKeyFrameIntervalDuration: 2000 });
    this.mr.ondataavailable = (e) => this.piece(e);
    this.mr.start(1000);
    this.startPieces(epoch);
    this.S.recording = { ...(this.S.recording || {}), active: true, owner: this.S.me.pid, mode, epoch };
  }

  // Sound pieces for the transcript, one stream per person. Each participant's microphone arrives here as its own track (and the
  // recorder's own microphone is local), so every track gets its own recorder and a level meter. A piece is cut when that person
  // pauses, or after 20 seconds of talk, and only pieces with a voice in them are sent, tagged with the person's pid and the time
  // the piece started. Silence is thrown away on this computer. The mixed recording above stays for the video file only.
  startPieces(epoch) {
    this.stopPieces();
    this.vMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.vEpoch = epoch; this.vN = 0;
    this.voices = new Map();
  }

  // Called every 100 ms while this browser records.
  voiceTick() {
    if (!this.mr || !this.vMime || !this.voices || !this.actx) return;
    // Recording paused: each person's piece so far is sent (the server drops it if it reaches into the pause) and no new piece starts.
    if (this.S.private) { for (const v of this.voices.values()) if (v.rec) this.cutVoice(v, true); return; }
    const { remote, local } = this.getInput();
    const want = new Map();
    for (const [key, r] of remote) {
      const [pid, name] = key.split('|');
      const tr = name === 'a' && r.stream && r.stream.getAudioTracks()[0];
      if (tr && tr.readyState === 'live') want.set('r:' + pid, { pid, track: tr });
    }
    if (local.mic && local.mic.readyState === 'live') want.set('me', { pid: this.S.me.pid, track: local.mic });
    for (const [k, v] of this.voices) if (!want.has(k) || want.get(k).track !== v.track) { this.closeVoice(v, true); this.voices.delete(k); }
    for (const [k, w] of want) if (!this.voices.has(k)) { const v = this.openVoice(w.pid, w.track); if (v) this.voices.set(k, v); }
    const now = Date.now();
    for (const v of this.voices.values()) {
      if (!v.rec) { try { this.startVoice(v); } catch { continue; } } // after Resume
      v.an.getFloatTimeDomainData(v.buf);
      let sq = 0; for (let i = 0; i < v.buf.length; i++) sq += v.buf[i] * v.buf[i];
      const rms = Math.sqrt(sq / v.buf.length);
      if (rms > VOICE_ON) { v.voiced++; v.lvl += rms; v.lastVoice = now; }
      const talked = v.voiced >= VOICE_MIN;
      if ((talked && now - v.lastVoice > PAUSE_MS) || now - v.t0 > PIECE_MAX_MS || (!talked && now - v.t0 > IDLE_MS && now - v.lastVoice > PAUSE_MS)) this.cutVoice(v);
    }
  }

  openVoice(pid, track) {
    try {
      const src = this.actx.createMediaStreamSource(new MediaStream([track]));
      const an = this.actx.createAnalyser(); an.fftSize = 2048;
      const mute = this.actx.createGain(); mute.gain.value = 0;
      src.connect(an); an.connect(mute); mute.connect(this.actx.destination);
      const v = { pid, track, src, an, mute, buf: new Float32Array(an.fftSize), rec: null };
      this.startVoice(v);
      return v;
    } catch { return null; }
  }

  startVoice(v) {
    const rec = new MediaRecorder(new MediaStream([v.track]), { mimeType: this.vMime, audioBitsPerSecond: 32000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    rec._parts = parts;
    v.rec = rec; v.t0 = Date.now(); v.voiced = 0; v.lvl = 0; v.lastVoice = 0;
    rec.start();
  }

  // Stops the piece; sends it when the person spoke in it; starts the next piece unless the track is closing.
  cutVoice(v, last) {
    const rec = v.rec; if (!rec) return;
    const send = v.voiced >= VOICE_MIN;
    const meta = { pid: v.pid, t0: v.t0, t1: Date.now(), lvl: v.voiced ? v.lvl / v.voiced : 0, n: send ? this.vN++ : -1, epoch: this.vEpoch };
    rec.onstop = () => { if (send) this.sendVoice(new Blob(rec._parts, { type: this.vMime }), meta); };
    try { rec.stop(); } catch {}
    v.rec = null;
    if (!last && this.mr) { try { this.startVoice(v); } catch {} }
  }

  closeVoice(v, flush) {
    if (flush) this.cutVoice(v, true);
    else if (v.rec) { v.rec.onstop = null; try { v.rec.stop(); } catch {} v.rec = null; }
    try { v.src.disconnect(); v.an.disconnect(); v.mute.disconnect(); } catch {}
  }

  sendVoice(blob, m) {
    if (blob.size < 800) return;
    const ext = this.vMime.includes('mp4') ? 'mp4' : 'webm';
    this.stats.voice = (this.stats.voice || 0) + 1;
    const put = async () => {
      for (let i = 0; i < 6; i++) {
        try {
          const r = await fetch(`/api/meet/meetings/${this.MID}/rec/voice/${m.epoch}/${m.n}?pid=${this.S.me.pid}`, { method: 'PUT', headers: { 'x-spk': m.pid, 'x-start': String(m.t0), 'x-end': String(m.t1), 'x-ext': ext, 'x-lvl': m.lvl.toFixed(5) }, body: blob, credentials: 'same-origin' });
          if (r.ok || r.status === 403) return;
        } catch { /* retry */ }
        await new Promise((res) => setTimeout(res, 800 * (i + 1)));
      }
    };
    this.aq = this.aq.then(put);
  }

  stopPieces() {
    const vs = this.voices; this.voices = null;
    if (vs) for (const v of vs.values()) this.closeVoice(v, true);
  }

  piece(e) {
    if (!e.data || !e.data.size) return;
    const t1 = Date.now(), t0 = this.lastAt; this.lastAt = t1;
    const seq = this.seq++, epoch = this.epoch;
    this.stats.chunks++; this.stats.bytes += e.data.size;
    const put = async () => {
      for (let i = 0; i < 6; i++) {
        try {
          const r = await fetch(`/api/meet/meetings/${this.MID}/rec/chunk/${epoch}/${seq}?pid=${this.S.me.pid}`, { method: 'PUT', headers: { 'x-t0': String(t0), 'x-t1': String(t1) }, body: e.data, credentials: 'same-origin' });
          if (r.ok) return;
          if (r.status === 403) { this.lostOwnership(); return; }
        } catch { /* retry */ }
        await new Promise((res) => setTimeout(res, 500 * (i + 1)));
      }
      this.stats.failed++;
    };
    this.queue = this.queue.then(put);
  }

  lostOwnership() {
    if (!this.mr) return;
    this.stopPieces();
    try { this.mr.stop(); } catch {}
    this.mr = null;
  }

  // ---- standby and takeover, driven by the sync
  async onSync(rec, people) {
    if (!rec || !rec.active) { if (this.warm && !this.mr) this.teardown(); return; }
    const me = this.S.me.pid;
    if (this.mr && rec.owner !== me) { this.lostOwnership(); }
    if (rec.owner === me && this.mr) return;
    // Standby: the two people best placed to take over keep the mix warm so a takeover starts at once.
    const eligible = people.filter((p) => p.role !== 'guest' && !p.waiting && p.pid !== rec.owner).sort((a, b) => (a.role === 'staff') - (b.role === 'staff') || a.joinedAt - b.joinedAt);
    const rank = eligible.findIndex((p) => p.pid === me);
    if (rank >= 0 && rank < 2 && !this.warm) { this.mode_ = rec.mode; this.prepare(); }
    if (rec.stale && !this.claiming && (rank >= 0 || rec.owner === me)) {
      this.claiming = true;
      await new Promise((r) => setTimeout(r, Math.max(0, rank) * 400));
      try {
        const r = await this.api(this.url('claim'), { method: 'POST', body: { epoch: rec.epoch } });
        if (r.ok) { this.begin(r.epoch, r.mode); this.toast('You took over the recording'); }
      } catch { /* another person won */ }
      this.claiming = false;
    }
  }
}

/** In-page confirm for stopping the recording. Resolves true when the person stops it. */
export function confirmStopRecording(mode) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="scrim" data-x="no"></div><div class="modal rec-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rc-h"><div class="modal__body"><h3 id="rc-h" class="mt-h2" style="margin:0">Stop the recording?</h3><p class="mt-sub" style="margin:0;font-size:14px">Everything recorded so far is saved. Nothing after this is recorded or written into the notes.</p><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="h-btn h-btn--ghost" data-x="no">Keep recording</button><button class="h-btn" data-x="yes">Stop recording</button></div></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    wrap.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) done(x.dataset.x === 'yes'); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-x="no"].h-btn').focus();
  });
}
