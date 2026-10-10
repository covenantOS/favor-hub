// Clips: the pop-up recorder. A camera button at the top right of the hub opens this card over whatever page you are on.
// Pick what to record, whether the camera and microphone are on, press Start. A 3, 2, 1 countdown runs, a small bar
// holds Pause, Mute and Stop, and the round camera can be dragged anywhere (and floated above other windows in Chrome and Edge).
// Everything is built here (no framework); styles are in launcher.css.
import { api, copyText, esc, fmtTime, toast } from './core.js';
import { BUBBLE_FRACTION, ClipRecorder, canRecordCamera, canRecordScreen } from './recorder.js';
import { MAX_UPLOAD_BYTES, uploadVideoFile } from './upload.js';

const PREFS_KEY = 'favor.clips.prefs';
const DEFAULTS = { source: 'screen', camOn: false, camId: '', micOn: true, micId: '', systemAudio: true, size: 'M' };
const BUBBLE_PX = { S: 140, M: 200, L: 280 };

const I = {
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  window: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M6.5 7h.01"/>',
  tab: '<path d="M4 8h16v11H4z"/><path d="M4 8V6a1 1 0 0 1 1-1h5l2 3"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  cameraOff: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/><path d="M3 3l18 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M3 3l18 18"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  float: '<rect x="3" y="4" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  list: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const svg = (n, cls = '') => `<svg class="cr-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

function readPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch (e) {
    return { ...DEFAULTS };
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (e) {
    /* not remembered */
  }
}

function debugFlag(k) {
  try {
    return !!JSON.parse(localStorage.getItem('favor.clips.debug') || '{}')[k];
  } catch (e) {
    return false;
  }
}

const docPip = () => (typeof window !== 'undefined' && window.documentPictureInPicture) || null;
const isPhone = () => matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1023px)').matches);

let cssReady = false;
function ensureCss() {
  if (cssReady) return;
  cssReady = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/js/clips/launcher.css?v=1';
  l.id = 'cr-css';
  document.head.appendChild(l);
}

/* ------------------------------------------------------------------ module state */

const S = {
  prefs: readPrefs(),
  anchor: null,
  card: null, // the launcher card element
  live: { cam: null, mic: null, ctx: null, raf: 0, camStream: null, micStream: null },
  rec: null,
  rs: null,
  barEl: null,
  barCtl: null,
  bubbleEl: null,
  pip: null, // { win, kind: 'bubble' | 'controls', ctl }
  countEl: null,
  countTimer: 0,
  savedCard: null,
  busy: false,
};

const recordingNow = () => !!(S.rec && S.rs && ['preparing', 'ready', 'recording', 'paused', 'finishing'].includes(S.rs.phase)) || S.busy;

/* ------------------------------------------------------------------ the launcher card */

function sourceTiles() {
  const p = S.prefs;
  const t = (id, label, icon) => `<button type="button" class="cr-tile${p.source === id ? ' is-on' : ''}" data-src="${id}" aria-pressed="${p.source === id}">${svg(icon)}<span>${label}</span></button>`;
  return t('screen', 'Full screen', 'screen') + t('window', 'Window', 'window') + t('tab', 'Tab', 'tab') + t('camera', 'Camera only', 'camera');
}

function cardHtml(phone) {
  const p = S.prefs;
  const cameraOnly = p.source === 'camera';
  const camShown = p.camOn || cameraOnly;
  const screenOk = canRecordScreen() && !phone;
  const sizes = ['S', 'M', 'L'].map((s) => `<button type="button" class="cr-size${p.size === s ? ' is-on' : ''}" data-size="${s}" aria-pressed="${p.size === s}" aria-label="Camera size ${s === 'S' ? 'small' : s === 'M' ? 'medium' : 'large'}">${s}</button>`).join('');
  return `
  <div class="cr-head"><h2>Record a clip</h2><button type="button" class="cr-x" data-act="close" aria-label="Close">${svg('close')}</button></div>
  ${screenOk ? `<div class="cr-tiles" role="group" aria-label="What to record">${sourceTiles()}</div>` : '<p class="cr-note">This browser records the camera only. Use a computer to record the screen.</p>'}
  <div class="cr-row" data-row="camera">
    <span class="cr-row__ico ${camShown ? '' : 'is-off'}">${svg(camShown ? 'camera' : 'cameraOff')}</span>
    <span class="cr-row__txt"><b>Camera</b><em id="cr-camname">${camShown ? 'On' : 'Off'}</em></span>
    <button type="button" class="cr-switch" role="switch" aria-checked="${camShown}" aria-label="Camera" data-act="cam" ${cameraOnly ? 'disabled' : ''}><i></i></button>
  </div>
  ${camShown ? `<div class="cr-camwrap"><div class="cr-preview" id="cr-preview"><video muted playsinline></video><span class="cr-preview__msg" id="cr-previewmsg">Starting the camera</span></div>
    ${cameraOnly ? '' : `<div class="cr-sizes" role="group" aria-label="Camera size">${sizes}</div><p class="cr-hint">Drag the round camera anywhere while you record.</p>`}
    <select id="cr-camsel" class="cr-sel" aria-label="Choose a camera" hidden></select></div>` : ''}
  <div class="cr-row" data-row="mic">
    <span class="cr-row__ico ${p.micOn ? '' : 'is-off'}">${svg(p.micOn ? 'mic' : 'micOff')}</span>
    <span class="cr-row__txt"><b>Microphone</b><em id="cr-micname">${p.micOn ? 'On' : 'Off'}</em></span>
    <button type="button" class="cr-switch" role="switch" aria-checked="${p.micOn}" aria-label="Microphone" data-act="mic"><i></i></button>
    ${p.micOn ? '<span class="cr-level" aria-hidden="true"><i id="cr-level"></i></span>' : ''}
  </div>
  ${p.micOn ? '<select id="cr-micsel" class="cr-sel" aria-label="Choose a microphone" hidden></select>' : ''}
  ${!cameraOnly && screenOk ? `<label class="cr-check"><input type="checkbox" data-act="sys" ${p.systemAudio ? 'checked' : ''}/><span>Include computer sound</span></label>` : ''}
  <p class="cr-err" id="cr-err" role="alert" hidden></p>
  <button type="button" class="cr-start" data-act="start" id="cr-start"><i aria-hidden="true"></i>Start recording</button>
  <p class="cr-keep">Keep this tab open while you record. Switch to what you want to show.</p>
  <div class="cr-foot">
    <button type="button" class="cr-link" data-act="file">${svg('upload')}Upload a video</button>
    <a class="cr-link" href="/clips/">${svg('list')}My clips</a>
  </div>`;
}

function stopLive() {
  const L = S.live;
  cancelAnimationFrame(L.raf);
  [L.camStream, L.micStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  if (L.ctx) L.ctx.close().catch(() => undefined);
  S.live = { cam: null, mic: null, ctx: null, raf: 0, camStream: null, micStream: null };
}

async function startLive() {
  stopLive();
  const card = S.card;
  if (!card) return;
  const p = S.prefs;
  const L = S.live;
  const gen = (L.gen = (L.gen || 0) + 1);
  const camShown = p.camOn || p.source === 'camera';
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const fillList = async () => {
    try {
      const all = await md.enumerateDevices();
      const fill = (sel, kind, current, label) => {
        if (!sel) return;
        const list = all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'communications');
        if (list.length < 2) return;
        sel.innerHTML = `<option value="">Default ${label}</option>` + list.filter((d) => d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}"${d.deviceId === current ? ' selected' : ''}>${esc(d.label || label)}</option>`).join('');
        sel.hidden = false;
      };
      fill(card.querySelector('#cr-camsel'), 'videoinput', p.camId, 'camera');
      fill(card.querySelector('#cr-micsel'), 'audioinput', p.micId, 'microphone');
    } catch (e) {
      /* names are a nicety */
    }
  };
  if (camShown) {
    try {
      const s = await md.getUserMedia({ video: p.camId ? { deviceId: { exact: p.camId } } : true, audio: false });
      if (gen !== L.gen || !S.card) return s.getTracks().forEach((t) => t.stop());
      L.camStream = s;
      const v = card.querySelector('#cr-preview video');
      if (v) {
        v.srcObject = s;
        v.play().catch(() => undefined);
        const msg = card.querySelector('#cr-previewmsg');
        if (msg) msg.hidden = true;
      }
      fillList();
    } catch (e) {
      const msg = card.querySelector('#cr-previewmsg');
      if (msg) msg.textContent = 'Allow the camera in your browser to see it here.';
    }
  }
  if (p.micOn) {
    try {
      const s = await md.getUserMedia({ audio: p.micId ? { deviceId: { exact: p.micId } } : true });
      if (gen !== L.gen || !S.card) return s.getTracks().forEach((t) => t.stop());
      L.micStream = s;
      const AC = window.AudioContext || window.webkitAudioContext;
      L.ctx = new AC();
      const an = L.ctx.createAnalyser();
      an.fftSize = 512;
      L.ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const loop = (t) => {
        L.raf = requestAnimationFrame(loop);
        if (t - last < 66) return;
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += ((b - 128) / 128) ** 2;
        const bar = card.querySelector('#cr-level');
        if (bar) bar.style.width = Math.round(Math.min(1, Math.sqrt(sum / buf.length) * 4) * 100) + '%';
      };
      L.raf = requestAnimationFrame(loop);
      fillList();
    } catch (e) {
      const n = card.querySelector('#cr-micname');
      if (n) n.textContent = 'Allow the microphone in your browser';
    }
  }
}

function paintCard() {
  if (!S.card) return;
  const phone = isPhone();
  if (phone && S.prefs.source !== 'camera') S.prefs = { ...S.prefs, source: 'camera', camOn: true };
  S.card.innerHTML = cardHtml(phone);
  startLive();
}

function placeCard() {
  const c = S.card;
  if (!c) return;
  if (isPhone()) {
    c.classList.add('is-sheet');
    c.style.cssText = '';
    return;
  }
  c.classList.remove('is-sheet');
  const r = S.anchor ? S.anchor.getBoundingClientRect() : null;
  const w = 380;
  const right = r ? Math.max(12, window.innerWidth - r.right) : 20;
  c.style.top = (r ? Math.round(r.bottom + 10) : 76) + 'px';
  c.style.right = Math.min(right, window.innerWidth - w - 12 > 0 ? right : 12) + 'px';
  c.style.maxHeight = `calc(100dvh - ${(r ? Math.round(r.bottom + 10) : 76) + 12}px)`;
}

export function openLauncher(anchor) {
  if (recordingNow()) return pulseBar();
  ensureCss();
  closeSaved();
  if (S.card) return closeLauncher();
  S.anchor = anchor || S.anchor;
  S.prefs = readPrefs();
  const c = document.createElement('div');
  c.className = 'cr-card';
  c.setAttribute('role', 'dialog');
  c.setAttribute('aria-label', 'Record a clip');
  c.id = 'cr-card';
  const back = document.createElement('div');
  back.className = 'cr-back';
  back.id = 'cr-back';
  back.addEventListener('pointerdown', closeLauncher);
  document.body.append(back, c);
  S.card = c;
  placeCard();
  paintCard();
  c.addEventListener('click', onCardClick);
  c.addEventListener('change', onCardChange);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', placeCard);
  const first = c.querySelector('[data-src].is-on') || c.querySelector('[data-act=start]');
  if (first) first.focus();
  if (S.anchor) S.anchor.setAttribute('aria-expanded', 'true');
}

export function closeLauncher() {
  if (!S.card) return;
  stopLive();
  S.card.remove();
  const b = document.getElementById('cr-back');
  if (b) b.remove();
  S.card = null;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', placeCard);
  if (S.anchor) S.anchor.setAttribute('aria-expanded', 'false');
}

function onKey(e) {
  if (e.key === 'Escape' && S.card) {
    e.preventDefault();
    closeLauncher();
    if (S.anchor) S.anchor.focus();
  }
}

function setErr(msg) {
  const e = S.card && S.card.querySelector('#cr-err');
  if (e) {
    e.textContent = msg || '';
    e.hidden = !msg;
  }
}

function onCardClick(ev) {
  const t = ev.target.closest('[data-act],[data-src],[data-size]');
  if (!t) return;
  const p = S.prefs;
  if (t.dataset.src) {
    S.prefs = { ...p, source: t.dataset.src, ...(t.dataset.src === 'camera' ? { camOn: true } : {}) };
    savePrefs(S.prefs);
    return paintCard();
  }
  if (t.dataset.size) {
    S.prefs = { ...p, size: t.dataset.size };
    savePrefs(S.prefs);
    S.card.querySelectorAll('[data-size]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.size === S.prefs.size);
      b.setAttribute('aria-pressed', String(b.dataset.size === S.prefs.size));
    });
    const pv = S.card.querySelector('#cr-preview');
    if (pv) pv.dataset.size = S.prefs.size;
    return;
  }
  switch (t.dataset.act) {
    case 'close':
      return closeLauncher();
    case 'cam':
      S.prefs = { ...p, camOn: !p.camOn };
      savePrefs(S.prefs);
      return paintCard();
    case 'mic':
      S.prefs = { ...p, micOn: !p.micOn };
      savePrefs(S.prefs);
      return paintCard();
    case 'start':
      return startRecording();
    case 'file':
      return pickFile();
    default:
  }
}

function onCardChange(ev) {
  const t = ev.target;
  if (t.dataset && t.dataset.act === 'sys') {
    S.prefs = { ...S.prefs, systemAudio: t.checked };
    savePrefs(S.prefs);
  } else if (t.id === 'cr-camsel') {
    S.prefs = { ...S.prefs, camId: t.value };
    savePrefs(S.prefs);
    startLive();
  } else if (t.id === 'cr-micsel') {
    S.prefs = { ...S.prefs, micId: t.value };
    savePrefs(S.prefs);
    startLive();
  }
}

/* ------------------------------------------------------------------ start: screen picker, countdown, record */

function settingsOf(p) {
  const screen = p.source !== 'camera';
  return {
    source: !screen ? 'camera' : p.camOn ? 'screen+camera' : 'screen',
    surface: p.source === 'screen' ? 'monitor' : p.source === 'window' ? 'window' : p.source === 'tab' ? 'browser' : undefined,
    micId: p.micOn ? p.micId : null,
    camId: p.camId || null,
    systemAudio: p.systemAudio,
  };
}

function startRecording() {
  if (!canRecordCamera()) {
    setErr('This browser cannot record video. Use Chrome, Edge, Firefox or Safari.');
    return;
  }
  const p = S.prefs;
  const settings = settingsOf(p);
  if (settings.source !== 'camera' && !canRecordScreen()) {
    setErr('This browser cannot record the screen. Use Chrome, Edge, Firefox or Safari on a computer.');
    return;
  }
  savePrefs(p);
  stopLive(); // the card's preview lets go of the camera and microphone first
  const rec = new ClipRecorder(settings);
  rec.setBubble({ size: p.size });
  S.rec = rec;
  S.rs = rec.state;
  S.busy = true;
  rec.nativeCheck = () => {
    if (!rec.wholeScreen || debugFlag('composite')) return false;
    return !!(S.pip && S.pip.kind === 'bubble') || (!!S.bubbleEl && document.visibilityState === 'visible');
  };
  rec.subscribe(onRecState);
  // The floating camera window and the screen picker both need this click, so both start before anything is awaited.
  const wantBubble = settings.source === 'screen+camera';
  const winP = wantBubble && docPip() ? openPip('bubble').catch(() => null) : null;
  const prep = rec.prepare();
  closeLauncher();
  prep.then(
    async () => {
      if (winP) await winP;
      if (S.rec !== rec) return;
      if (S.pip && S.pip.attach && rec.camStream) S.pip.attach(rec.camStream);
      if (S.pip && S.pip.showCorners) S.pip.showCorners();
      if (wantBubble && !(S.pip && S.pip.kind === 'bubble')) mountPageBubble(rec);
      if (settings.source === 'camera') mountPageBubble(rec, true);
      countdown(rec);
    },
    (e) => {
      S.busy = false;
      closePip();
      removeBubble();
      S.rec = null;
      toast(e && e.message ? e.message : 'Recording could not start.', 'bad');
    }
  );
}

function countdown(rec) {
  let n = 3;
  const el = document.createElement('div');
  el.className = 'cr-count';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Recording starts soon');
  el.innerHTML = `<div class="cr-count__n" id="cr-count-n" aria-live="assertive">3</div><p>Recording starts now. Switch to what you want to show.</p><div class="cr-count__btns"><button type="button" data-act="skip" class="cr-pill">Start now</button><button type="button" data-act="cancel" class="cr-pill is-ghost">Cancel</button></div>`;
  document.body.appendChild(el);
  S.countEl = el;
  const tick = () => {
    n -= 1;
    if (n <= 0) return go();
    const nn = el.querySelector('#cr-count-n');
    nn.textContent = String(n);
    nn.style.animation = 'none';
    void nn.offsetWidth;
    nn.style.animation = '';
    S.countTimer = setTimeout(tick, 1000);
  };
  const go = () => {
    clearTimeout(S.countTimer);
    el.remove();
    S.countEl = null;
    if (S.rec !== rec) return;
    mountBar(rec);
    rec.begin();
  };
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'skip') go();
    if (a.dataset.act === 'cancel') cancelCountdown(rec);
  });
  S.countTimer = setTimeout(tick, 1000);
}

function cancelCountdown(rec) {
  clearTimeout(S.countTimer);
  if (S.countEl) S.countEl.remove();
  S.countEl = null;
  rec.discard();
  teardown();
}

function teardown() {
  S.rec = null;
  S.rs = null;
  S.busy = false;
  if (S.barEl) S.barEl.remove();
  S.barEl = null;
  S.barCtl = null;
  removeBubble();
  closePip();
}

/* ------------------------------------------------------------------ controls (shared by the page bar and the floating window) */

function controlsHtml() {
  return `<span class="cr-rec"><i class="cr-rdot"></i><b class="cr-time" data-t>0:00</b></span>
  <span class="cr-bars" aria-hidden="true">${[0.2, 0.4, 0.6, 0.8, 1].map((b) => `<i data-bar="${b}"></i>`).join('')}</span>
  <button type="button" class="cr-ic" data-ctl="mute" aria-pressed="false" aria-label="Mute microphone" title="Mute">${svg('mic')}</button>
  <button type="button" class="cr-ic" data-ctl="pause" aria-label="Pause" title="Pause">${svg('pause')}</button>
  <button type="button" class="cr-ic cr-ic--stop" data-ctl="stop" aria-label="Stop and save" title="Stop and save">${svg('stop')}</button>
  <button type="button" class="cr-ic cr-ic--float" data-ctl="float" aria-label="Float these controls above other windows" title="Float these controls above other windows">${svg('float')}</button>
  <button type="button" class="cr-ic cr-ic--x" data-ctl="discard" aria-label="Discard recording" title="Discard">${svg('close')}</button>
  <span class="cr-sub" data-sub></span>`;
}

/** Wire a controls element (in this page or the floating window). Returns { update(rs) }. */
function wireControls(host, rec) {
  const $ = (sel) => host.querySelector(sel);
  const doc = host.ownerDocument;
  let asking = false;
  host.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ctl]');
    if (!b) return;
    const rs = rec.state;
    switch (b.dataset.ctl) {
      case 'mute':
        rec.setMuted(!rs.muted);
        break;
      case 'pause':
        if (rs.phase === 'recording') rec.pause();
        else if (rs.phase === 'paused') rec.resume();
        break;
      case 'stop':
        finishRecording(rec);
        break;
      case 'float':
        floatControls();
        break;
      case 'discard':
        if (!asking) {
          asking = true;
          host.classList.add('is-asking');
          $('[data-ask]') || host.insertAdjacentHTML('beforeend', `<span class="cr-ask" data-ask><span>Discard this recording?</span><button type="button" class="cr-pill is-red" data-ctl="yes">Discard</button><button type="button" class="cr-pill is-ghost" data-ctl="no">Keep going</button></span>`);
        }
        break;
      case 'yes':
        discardRecording(rec);
        break;
      case 'no':
        asking = false;
        host.classList.remove('is-asking');
        $('[data-ask]')?.remove();
        break;
      default:
    }
  });
  const update = (rs) => {
    const paused = rs.phase === 'paused';
    const fin = rs.phase === 'finishing';
    host.classList.toggle('is-paused', paused);
    host.classList.toggle('is-finishing', fin);
    const t = $('[data-t]');
    if (t) t.textContent = fmtTime(rs.elapsed);
    host.querySelectorAll('[data-bar]').forEach((el) => el.classList.toggle('is-on', rs.level >= Number(el.dataset.bar) * 0.9));
    const m = $('[data-ctl=mute]');
    if (m) {
      m.setAttribute('aria-pressed', String(rs.muted));
      m.setAttribute('aria-label', rs.muted ? 'Unmute microphone' : 'Mute microphone');
      m.classList.toggle('is-on', rs.muted);
      m.innerHTML = svg(rs.muted ? 'micOff' : 'mic');
    }
    const p = $('[data-ctl=pause]');
    if (p) {
      p.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      p.innerHTML = svg(paused ? 'play' : 'pause');
    }
    const sub = $('[data-sub]');
    if (sub) sub.textContent = fin ? 'Saving' : rs.retrying ? 'Reconnecting' : rs.pending > 1 ? 'Uploading' : 'Saved';
    const fl = $('[data-ctl=float]');
    if (fl) fl.hidden = !docPip() || !!S.pip || doc !== document;
  };
  update(rec.state);
  return { update };
}

function mountBar(rec) {
  const bar = document.createElement('div');
  bar.className = 'cr-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Recording controls');
  bar.id = 'cr-bar';
  bar.innerHTML = controlsHtml();
  document.body.appendChild(bar);
  S.barEl = bar;
  S.barCtl = wireControls(bar, rec);
}

function pulseBar() {
  const b = S.barEl;
  if (!b) return;
  b.classList.remove('is-pulse');
  void b.offsetWidth;
  b.classList.add('is-pulse');
}

function onRecState(rs) {
  S.rs = rs;
  if (S.barCtl) S.barCtl.update(rs);
  if (S.pip && S.pip.ctl) S.pip.ctl.update(rs);
  if (rs.phase === 'error') {
    toast(rs.error || 'The recording failed.', 'bad');
    teardown();
  }
}

/* ------------------------------------------------------------------ the round camera on the page */

function mountPageBubble(rec, previewOnly) {
  removeBubble();
  if (!rec.camStream) return;
  const el = document.createElement('div');
  el.className = 'cr-bubble' + (previewOnly ? ' is-preview' : '');
  el.dataset.size = rec.bubble.size;
  el.innerHTML = `<video muted playsinline></video><div class="cr-bubble__sz" role="group" aria-label="Camera size">${['S', 'M', 'L'].map((s) => `<button type="button" data-size="${s}" aria-pressed="${s === rec.bubble.size}">${s}</button>`).join('')}</div>`;
  const v = el.querySelector('video');
  v.srcObject = rec.camStream;
  v.play().catch(() => undefined);
  document.body.appendChild(el);
  S.bubbleEl = el;
  const px = () => Math.max(96, Math.round(BUBBLE_FRACTION[rec.bubble.size] * window.innerHeight));
  const place = () => {
    const d = px();
    el.style.width = el.style.height = d + 'px';
    const x = Math.min(window.innerWidth - d / 2 - 8, Math.max(d / 2 + 8, rec.bubble.cx * window.innerWidth));
    const y = Math.min(window.innerHeight - d / 2 - 8, Math.max(d / 2 + 8, rec.bubble.cy * window.innerHeight));
    el.style.left = Math.round(x - d / 2) + 'px';
    el.style.top = Math.round(y - d / 2) + 'px';
  };
  place();
  el.__place = place;
  window.addEventListener('resize', place);
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left - r.width / 2, dy: e.clientY - r.top - r.height / 2 };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    rec.setBubble({ cx: Math.min(0.98, Math.max(0.02, (e.clientX - drag.dx) / window.innerWidth)), cy: Math.min(0.98, Math.max(0.02, (e.clientY - drag.dy) / window.innerHeight)) });
    place();
  });
  const endDrag = () => {
    drag = null;
    el.classList.remove('is-drag');
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    setBubbleSize(rec, b.dataset.size);
  });
}

function setBubbleSize(rec, size) {
  rec.setBubble({ size });
  S.prefs = { ...S.prefs, size };
  savePrefs(S.prefs);
  if (S.bubbleEl) {
    S.bubbleEl.dataset.size = size;
    S.bubbleEl.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
    if (S.bubbleEl.__place) S.bubbleEl.__place();
  }
  if (S.pip && S.pip.kind === 'bubble') {
    const w = S.pip.win;
    S.pip.setSize(size);
    try {
      w.resizeTo(BUBBLE_PX[size] + 28, BUBBLE_PX[size] + 28 + 64);
    } catch (e) {
      /* the browser may keep the size the person chose */
    }
  }
}

function removeBubble() {
  if (S.bubbleEl) {
    window.removeEventListener('resize', S.bubbleEl.__place);
    const v = S.bubbleEl.querySelector('video');
    if (v) v.srcObject = null;
    S.bubbleEl.remove();
  }
  S.bubbleEl = null;
}

/* ------------------------------------------------------------------ the floating window (Chrome and Edge) */

async function openPip(kind) {
  const api2 = docPip();
  if (!api2) throw new Error('no pip');
  const size = kind === 'bubble' ? { width: BUBBLE_PX[S.prefs.size] + 28, height: BUBBLE_PX[S.prefs.size] + 28 + 64 } : { width: 460, height: 96 };
  const win = await api2.requestWindow(size);
  const l = win.document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('/js/clips/launcher.css?v=1', location.href).toString();
  win.document.head.appendChild(l);
  win.document.body.className = 'cr-pipbody';
  win.document.body.style.margin = '0';
  const rec = S.rec;
  const pip = { win, kind, ctl: null, setSize: () => undefined };
  S.pip = pip;
  win.addEventListener('pagehide', () => {
    if (S.pip && S.pip.win === win) {
      S.pip = null;
      // Closing the floating window by hand puts the camera back on the page. The recording is never touched.
      if (S.rec && kind === 'bubble' && S.rec.state.phase !== 'finishing' && S.rec.state.phase !== 'done') mountPageBubble(S.rec);
      if (S.barCtl && S.rec) S.barCtl.update(S.rec.state);
    }
  });
  if (kind === 'bubble') {
    const wrap = win.document.createElement('div');
    wrap.className = 'cr-pip';
    const inner = (rec && rec.bubble.size) || 'M';
    wrap.innerHTML = `<div class="cr-pip__cam"><div class="cr-pipcircle" data-size="${inner}"><video muted playsinline></video><div class="cr-bubble__sz" role="group" aria-label="Camera size">${['S', 'M', 'L'].map((s) => `<button type="button" data-size="${s}" aria-pressed="${s === inner}">${s}</button>`).join('')}</div></div></div>
      <div class="cr-pip__ctl cr-bar cr-bar--pip" role="region" aria-label="Recording controls">${controlsHtml()}</div>`;
    win.document.body.appendChild(wrap);
    const v = wrap.querySelector('video');
    // The window opens inside the click, before the camera is ready; the camera is attached once prepare() finishes.
    pip.attach = (stream) => {
      v.srcObject = stream;
      v.play().catch(() => undefined);
    };
    if (rec && rec.camStream) pip.attach(rec.camStream);
    const circle = wrap.querySelector('.cr-pipcircle');
    pip.setSize = (s) => {
      circle.dataset.size = s;
      wrap.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === s)));
    };
    wrap.querySelector('.cr-bubble__sz').addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (b && S.rec) setBubbleSize(S.rec, b.dataset.size);
    });
    const ctl = wrap.querySelector('.cr-pip__ctl');
    pip.ctl = wireControls(ctl, rec);
    // A recording of a window or tab draws the camera into the picture; the corner buttons say where.
    const corners = win.document.createElement('div');
    corners.className = 'cr-corners';
    corners.hidden = true;
    corners.innerHTML = `<span>Camera in the video</span>${[['tl', 0.12, 0.2], ['tr', 0.88, 0.2], ['bl', 0.12, 0.78], ['br', 0.88, 0.78]].map(([k, x, y]) => `<button type="button" data-corner="${k}" data-x="${x}" data-y="${y}" aria-label="Move the camera to the ${k === 'tl' ? 'top left' : k === 'tr' ? 'top right' : k === 'bl' ? 'bottom left' : 'bottom right'}">${k}</button>`).join('')}`;
    wrap.appendChild(corners);
    corners.addEventListener('click', (e) => {
      const b = e.target.closest('[data-corner]');
      if (b && S.rec) S.rec.setBubble({ cx: Number(b.dataset.x), cy: Number(b.dataset.y) });
    });
    pip.showCorners = () => (corners.hidden = !(S.rec && !S.rec.wholeScreen));
  } else {
    const wrap = win.document.createElement('div');
    wrap.className = 'cr-bar cr-bar--pip cr-bar--solo';
    wrap.innerHTML = controlsHtml();
    win.document.body.appendChild(wrap);
    pip.ctl = wireControls(wrap, rec);
  }
  return win;
}

async function floatControls() {
  if (!S.rec || !docPip() || S.pip) return;
  try {
    await openPip('controls');
    if (S.barEl) S.barEl.hidden = true;
    S.pip.win.addEventListener('pagehide', () => {
      if (S.barEl) S.barEl.hidden = false;
    });
  } catch (e) {
    toast('Your browser would not open the floating controls.', 'bad');
  }
}

function closePip() {
  const p = S.pip;
  S.pip = null;
  if (p) {
    try {
      if (!p.win.closed) p.win.close();
    } catch (e) {
      /* already gone */
    }
  }
  if (S.barEl) S.barEl.hidden = false;
}

/* ------------------------------------------------------------------ stop, save, name */

async function finishRecording(rec) {
  if (rec.state.phase !== 'recording' && rec.state.phase !== 'paused') return;
  const r = await rec.stop();
  if (!r) return; // an error already told the person
  teardown();
  await afterSave(r.id);
}

function discardRecording(rec) {
  rec.cancel();
  teardown();
  toast('Recording discarded');
}

function closeSaved() {
  if (S.savedCard) S.savedCard.remove();
  S.savedCard = null;
}

const linkFor = (id) => `${location.origin}/c/${id}`;

/** The card after Stop: the clip is already watchable; the title and transcript arrive a few seconds later. */
async function afterSave(id, label) {
  closeSaved();
  ensureCss();
  const el = document.createElement('div');
  el.className = 'cr-saved';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="cr-head"><h2>${esc(label || 'Clip saved')}</h2><button type="button" class="cr-x" data-act="dismiss" aria-label="Close">${svg('close')}</button></div>
    <div class="cr-saved__body" data-body><p class="cr-spin"><i></i>Writing the transcript and a title</p></div>
    <div class="cr-saved__btns"><a class="cr-pill" href="/c/${id}" data-act="open">Open it now</a></div>`;
  document.body.appendChild(el);
  S.savedCard = el;
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act=dismiss]')) closeSaved();
  });
  let clip = null;
  try {
    const r = await api(`/api/clips/${id}/process`, { method: 'POST', json: {} });
    clip = r.clip;
  } catch (e) {
    clip = null;
  }
  if (S.savedCard !== el) return;
  const body = el.querySelector('[data-body]');
  const btns = el.querySelector('.cr-saved__btns');
  const title = clip && clip.title ? clip.title : 'Your clip';
  const sum = clip && clip.summary ? clip.summary : '';
  body.innerHTML = `<p class="cr-saved__title">${esc(title)}</p>${sum ? `<p class="cr-saved__sum">${esc(sum.length > 170 ? sum.slice(0, 167) + '...' : sum)}</p>` : ''}
    <label class="cr-check cr-check--share"><input type="checkbox" data-act="share"/><span>Anyone with the link can watch</span></label>
    <p class="cr-note" data-note>Only signed-in Favor staff can open the link.</p>`;
  btns.innerHTML = `<a class="cr-pill" href="/c/${id}">Open</a><button type="button" class="cr-pill is-ghost" data-act="copy">${svg('link')}Copy link</button>`;
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act=copy]')) {
      toast((await copyText(linkFor(id))) ? 'Link copied' : 'Could not copy the link', 'ok');
    }
  });
  el.addEventListener('change', async (ev) => {
    if (ev.target.dataset.act !== 'share') return;
    const on = ev.target.checked;
    try {
      await api(`/api/clips/${id}`, { method: 'PATCH', json: { share: on } });
      el.querySelector('[data-note]').textContent = on ? 'Anyone with the link can watch, signed in or not.' : 'Only signed-in Favor staff can open the link.';
    } catch (e) {
      ev.target.checked = !on;
      toast(e.message, 'bad');
    }
  });
  window.dispatchEvent(new CustomEvent('clips:changed', { detail: { id } }));
}

/* ------------------------------------------------------------------ upload a file */

function pickFile() {
  let input = document.getElementById('cr-file');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'cr-file';
    input.accept = 'video/*,.mov,.mp4,.webm';
    input.hidden = true;
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) uploadFile(f);
    });
    document.body.appendChild(input);
  }
  input.click();
}

async function uploadFile(f) {
  if (f.size > MAX_UPLOAD_BYTES) return toast('That video is over 1 GB. Trim it first.', 'bad');
  closeLauncher();
  closeSaved();
  ensureCss();
  S.busy = true;
  const el = document.createElement('div');
  el.className = 'cr-saved';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="cr-head"><h2>Uploading</h2></div><p class="cr-saved__file">${esc(f.name)}</p><div class="cr-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p class="cr-note" data-label>Uploading</p>`;
  document.body.appendChild(el);
  S.savedCard = el;
  try {
    const r = await uploadVideoFile(f, (frac, label) => {
      el.querySelector('.cr-prog i').style.width = Math.round(frac * 100) + '%';
      el.querySelector('.cr-prog').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
      el.querySelector('[data-label]').textContent = label;
    });
    S.busy = false;
    await afterSave(r.id, 'Video uploaded');
  } catch (e) {
    S.busy = false;
    closeSaved();
    toast(e && e.message ? e.message : 'Upload failed', 'bad');
  }
}

/* ------------------------------------------------------------------ recordings whose tab closed */

export async function resumeUnfinished() {
  try {
    const r = await api('/api/clips/unfinished');
    for (const c of r.clips || []) {
      // Older than three minutes, so a recording in another window of this browser is left alone.
      if (Date.now() - new Date(c.updatedAt).getTime() < 3 * 60000 || !c.parts) continue;
      const done = await api(`/api/clips/${c.id}/complete`, { method: 'POST', json: { durationMs: c.durationMs } }).catch(() => null);
      if (done) {
        toast('Finished a recording that was cut off. It is in My clips.');
        api(`/api/clips/${c.id}/process`, { method: 'POST', json: {} }).catch(() => undefined);
      }
    }
  } catch (e) {
    /* nothing to finish */
  }
}

export const isRecording = recordingNow;
// For tests: the recorder in progress.
export const _state = S;
