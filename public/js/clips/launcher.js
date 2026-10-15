// Clips: the pop-up recorder. A camera button at the top right of the hub opens this card in a window of its own.
// Pick what to record, whether the camera and microphone are on, press Start. A 3, 2, 1 countdown runs, then the
// recording controls show in three places at once: this window, a small window that floats above every app (Chrome and
// Edge, Document Picture-in-Picture) and a pill on hub pages (see pill.js). All three drive the same recording.
// Everything is built here (no framework); styles are in launcher.css, the controls in controls.js.
import { api, copyText, esc, toast } from './core.js';
import { LEVELS, levelLabel, levelOfClip, openShare } from './sharesheet.js';
import { BUBBLE_FRACTION, ClipRecorder, canRecordCamera, canRecordScreen, setMaxSeconds } from './recorder.js';
import { MAX_UPLOAD_BYTES, uploadVideoFile } from './upload.js';
import { controlsHtml, makeDraggable, wireControls, wireShortcuts } from './controls.js';

const CSS_URL = '/js/clips/launcher.css?v=9';
const PREFS_KEY = 'favor.clips.prefs';
const PILL_KEY = 'favor.clips.pill';
const DEFAULTS = { source: 'screen', camOn: false, camId: '', micOn: true, micId: '', systemAudio: true, size: 'M', float: true, bx: 0.12, by: 0.78 };
const BUBBLE_PX = { S: 140, M: 200, L: 280 };
const PIP_BAR = { width: 500, height: 68 };
const SOURCES = {
  screen: { label: 'Full screen', icon: 'screen', note: 'Chosen in the browser prompt' },
  window: { label: 'Window', icon: 'window', note: 'Chosen in the browser prompt' },
  tab: { label: 'Tab', icon: 'tab', note: 'Chosen in the browser prompt' },
  camera: { label: 'Camera only', icon: 'camera', note: '' },
};

const I = {
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  window: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M6.5 7h.01"/>',
  tab: '<path d="M4 8h16v11H4z"/><path d="M4 8V6a1 1 0 0 1 1-1h5l2 3"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  cameraOff: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/><path d="M3 3l18 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M3 3l18 18"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  float: '<rect x="3" y="4" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  list: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const svg = (n, cls = '') => `<svg class="cr-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

// What the chosen source looks like, drawn small on the preview stage.
const ART = {
  screen: '<svg viewBox="0 0 160 100" aria-hidden="true"><rect class="a-frame" x="14" y="6" width="132" height="76" rx="7"/><rect class="a-fill" x="20" y="12" width="120" height="64" rx="3"/><rect class="a-line" x="30" y="24" width="52" height="6" rx="3"/><rect class="a-line a-soft" x="30" y="37" width="92" height="5" rx="2.5"/><rect class="a-line a-soft" x="30" y="48" width="76" height="5" rx="2.5"/><rect class="a-line a-soft" x="30" y="59" width="84" height="5" rx="2.5"/><path class="a-stand" d="M66 94h28M80 82v12"/></svg>',
  window: '<svg viewBox="0 0 160 100" aria-hidden="true"><rect class="a-desk" x="6" y="6" width="148" height="88" rx="8"/><rect class="a-frame" x="30" y="20" width="100" height="62" rx="6"/><path class="a-bar" d="M30 26a6 6 0 0 1 6-6h88a6 6 0 0 1 6 6v6H30z"/><circle class="a-dot" cx="38" cy="26" r="2"/><circle class="a-dot" cx="45" cy="26" r="2"/><circle class="a-dot" cx="52" cy="26" r="2"/><rect class="a-line" x="40" y="42" width="40" height="5" rx="2.5"/><rect class="a-line a-soft" x="40" y="53" width="78" height="4" rx="2"/><rect class="a-line a-soft" x="40" y="63" width="62" height="4" rx="2"/></svg>',
  tab: '<svg viewBox="0 0 160 100" aria-hidden="true"><rect class="a-frame" x="14" y="10" width="132" height="80" rx="7"/><path class="a-bar" d="M14 17a7 7 0 0 1 7-7h118a7 7 0 0 1 7 7v11H14z"/><path class="a-tab" d="M24 28v-8a4 4 0 0 1 4-4h34a4 4 0 0 1 4 4v8z"/><rect class="a-ghost" x="70" y="17" width="34" height="8" rx="4"/><rect class="a-ghost" x="108" y="17" width="28" height="8" rx="4"/><rect class="a-line" x="28" y="42" width="46" height="6" rx="3"/><rect class="a-line a-soft" x="28" y="55" width="100" height="5" rx="2.5"/><rect class="a-line a-soft" x="28" y="66" width="82" height="5" rx="2.5"/></svg>',
};

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

// The recorder window (/clips/rec/): a small window of its own that holds the streams, the recorder and the controls.
// Navigating or reloading the hub never touches it. In a hub page the same code runs as a card (phones, blocked pop-ups).
const STANDALONE = typeof document !== 'undefined' && document.documentElement.dataset.crStandalone === '1';
const CHANNEL = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('favor-clips') : null;
const post = (m) => {
  try {
    if (CHANNEL) CHANNEL.postMessage(m);
  } catch (e) {
    /* nobody is listening */
  }
};

/** Resize the recorder window to fit what it shows (a card, the controls, a saved note). */
function fitWindow(w, h) {
  if (!STANDALONE) return;
  try {
    const maxH = (screen.availHeight || 900) - 40;
    window.resizeTo(w + (window.outerWidth - window.innerWidth), Math.min(maxH, h + (window.outerHeight - window.innerHeight)));
  } catch (e) {
    /* the browser keeps the size the person chose */
  }
}

// Arc creates a Document Picture-in-Picture window requested during the screen picker but never shows it. A window requested
// by a plain click, with no picker open, shows (ServiceLine Flow's Float button does exactly that), so in Arc the floating
// window opens from the click that ends the countdown wait.
const isArc = () => {
  try {
    return !!getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title').trim();
  } catch (e) {
    return false;
  }
};
const docPip = () => (typeof window !== 'undefined' && window.documentPictureInPicture) || null;
const videoPipOk = () => typeof document !== 'undefined' && !!document.pictureInPictureEnabled && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
const isPhone = () => !STANDALONE && (matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1023px)').matches));
const hubTarget = STANDALONE ? ' target="favor-hub-main"' : '';

let cssReady = false;
function ensureCss() {
  if (cssReady || document.getElementById('cr-css') || STANDALONE) return;
  cssReady = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = CSS_URL;
  l.id = 'cr-css';
  document.head.appendChild(l);
}

/* ------------------------------------------------------------------ module state */

const newLive = () => ({ camKey: null, micKey: null, camStream: null, micStream: null, camErr: false, micErr: false, ctx: null, analyser: null, raf: 0, devices: null });

const S = {
  prefs: readPrefs(),
  anchor: null,
  card: null, // the launcher card element
  live: newLive(), // the card's own camera and microphone, for the preview and the level meter
  rec: null,
  rs: null,
  unsub: null,
  bar: null, // { el, ctl, drag } the controls in this page or window
  panel: null, // the recorder window's recording view (holds the bar)
  bubbleEl: null,
  pip: null, // { win, kind: 'bubble' | 'controls', ctl }
  countEl: null,
  countTimer: 0,
  countN: 0,
  countGo: null,
  savedCard: null,
  busy: false,
};

const recordingNow = () => !!(S.rec && S.rs && ['preparing', 'ready', 'recording', 'paused', 'finishing'].includes(S.rs.phase)) || S.busy;

/* ------------------------------------------------------------------ the launcher card */

function sourceTiles() {
  const p = S.prefs;
  return Object.entries(SOURCES)
    .map(([id, s]) => `<button type="button" class="cr-tile${p.source === id ? ' is-on' : ''}" data-src="${id}" role="radio" aria-checked="${p.source === id}">${svg(s.icon)}<span>${s.label}</span></button>`)
    .join('');
}

const switchHtml = (act, on, label, disabled) => `<button type="button" class="cr-switch" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}" ${disabled ? 'disabled' : ''}><i></i></button>`;

function stageHtml(p, cameraOnly, camShown) {
  const src = SOURCES[p.source] || SOURCES.screen;
  if (cameraOnly) {
    return `<div class="cr-stage is-camera" id="cr-stage"><video class="cr-stage__full" id="cr-camfull" muted playsinline></video><span class="cr-stage__msg" id="cr-cammsg">Starting the camera</span></div>`;
  }
  return `<div class="cr-stage" id="cr-stage" data-source="${esc(p.source)}">
      <div class="cr-stage__art">${ART[p.source] || ART.screen}</div>
      <div class="cr-stage__src"><b>${src.label}</b><span>${src.note}</span></div>
      ${camShown ? '<div class="cr-stage__bubble" id="cr-stagebubble" title="Camera position"><video muted playsinline></video></div>' : ''}
    </div>`;
}

function cardHtml(phone) {
  const p = S.prefs;
  const cameraOnly = p.source === 'camera';
  const camShown = p.camOn || cameraOnly;
  const screenOk = canRecordScreen() && !phone;
  const floatOk = !!docPip() && !phone;
  const sizes = ['S', 'M', 'L'].map((z) => `<button type="button" class="cr-size${p.size === z ? ' is-on' : ''}" data-size="${z}" aria-pressed="${p.size === z}" aria-label="Camera size ${z === 'S' ? 'small' : z === 'M' ? 'medium' : 'large'}" title="${z === 'S' ? 'Small' : z === 'M' ? 'Medium' : 'Large'} camera">${z}</button>`).join('');
  const meter = `<span class="cr-meter" id="cr-meter" aria-hidden="true">${Array.from({ length: 12 }, () => '<i></i>').join('')}</span>`;
  return `
  <div class="cr-head"><h2>Record a clip</h2>${STANDALONE ? '' : `<button type="button" class="cr-x" data-act="close" aria-label="Close">${svg('close')}</button>`}</div>
  <div class="cr-cols">
    <div class="cr-stagecol">${stageHtml(p, cameraOnly, camShown)}</div>
    <div class="cr-ctlcol">
      ${screenOk ? `<div class="cr-tiles" role="radiogroup" aria-label="What to record">${sourceTiles()}</div>` : '<p class="cr-note cr-note--top">This browser records the camera only. A computer records the screen.</p>'}
      <div class="cr-opts">
        <div class="cr-row" data-row="camera">
          <span class="cr-row__ico ${camShown ? '' : 'is-off'}">${svg(camShown ? 'camera' : 'cameraOff')}</span>
          <span class="cr-row__txt"><b>Camera</b><span class="cr-dev" id="cr-camdev">${camShown ? 'On' : 'Off'}</span></span>
          ${camShown && !cameraOnly ? `<span class="cr-sizes" role="group" aria-label="Camera size">${sizes}</span>` : ''}
          ${switchHtml('cam', camShown, 'Camera', cameraOnly)}
        </div>
        <div class="cr-row" data-row="mic">
          <span class="cr-row__ico ${p.micOn ? '' : 'is-off'}">${svg(p.micOn ? 'mic' : 'micOff')}</span>
          <span class="cr-row__txt"><b>Microphone</b><span class="cr-dev" id="cr-micdev">${p.micOn ? 'On' : 'Off'}</span></span>
          ${p.micOn ? meter : ''}
          ${switchHtml('mic', p.micOn, 'Microphone')}
        </div>
        ${!cameraOnly && screenOk ? `<div class="cr-row" data-row="sys">
          <span class="cr-row__ico ${p.systemAudio ? '' : 'is-off'}">${svg('sound')}</span>
          <span class="cr-row__txt"><b>Computer sound</b><span class="cr-dev">${p.systemAudio ? 'On' : 'Off'}</span></span>
          ${switchHtml('sys', p.systemAudio, 'Computer sound')}
        </div>` : ''}
        ${floatOk ? `<div class="cr-row" data-row="float">
          <span class="cr-row__ico ${p.float !== false ? '' : 'is-off'}">${svg('float')}</span>
          <span class="cr-row__txt"><b>Floating controls</b><span class="cr-dev">${p.float !== false ? 'Above every window' : 'Off'}</span></span>
          ${switchHtml('float', p.float !== false, 'Floating controls')}
        </div>` : ''}
      </div>
      <p class="cr-err" id="cr-err" role="alert" hidden></p>
      <p class="cr-note cr-usage" id="cr-usage" hidden></p>
      <button type="button" class="cr-start" data-act="start" id="cr-start"><i aria-hidden="true"></i>Start recording</button>
      <p class="cr-keep">${STANDALONE ? 'Keeps recording while you use other tabs and apps.' : 'The recording runs in this tab.'}</p>
      <div class="cr-foot">
        <button type="button" class="cr-link" data-act="file">${svg('upload')}Upload a video</button>
        <a class="cr-link" href="/clips/"${hubTarget}>${svg('list')}My clips</a>
      </div>
    </div>
  </div>`;
}

const stopStream = (s) => s && s.getTracks().forEach((t) => t.stop());

function stopLive() {
  const L = S.live;
  cancelAnimationFrame(L.raf);
  stopStream(L.camStream);
  stopStream(L.micStream);
  if (L.ctx) L.ctx.close().catch(() => undefined);
  S.live = newLive();
}

const tidyLabel = (s) => String(s || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^Default - /, '');

async function listDevices() {
  const L = S.live;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    if (S.live !== L) return;
    const of = (kind) => all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'communications' && d.deviceId !== 'default' && d.label);
    L.devices = { cam: of('videoinput'), mic: of('audioinput') };
  } catch (e) {
    /* names are a nicety */
  }
}

/** Device names: a picker when there is a choice, the one device's name when there is not. */
function paintDevices() {
  const card = S.card;
  if (!card) return;
  const p = S.prefs;
  const L = S.live;
  const fill = (el, on, err, list, current, noun, selId) => {
    if (!el) return;
    if (!on) return (el.textContent = 'Off');
    if (err) return (el.textContent = `${noun} not available`);
    if (!list || !list.length) return (el.textContent = 'On');
    if (list.length === 1) return (el.textContent = tidyLabel(list[0].label));
    el.innerHTML = `<select id="${selId}" class="cr-sel" aria-label="Choose a ${noun.toLowerCase()}"><option value="">Default ${noun.toLowerCase()}</option>${list.map((d) => `<option value="${esc(d.deviceId)}"${d.deviceId === current ? ' selected' : ''}>${esc(tidyLabel(d.label))}</option>`).join('')}</select>`;
  };
  const camShown = p.camOn || p.source === 'camera';
  fill(card.querySelector('#cr-camdev'), camShown, L.camErr, L.devices && L.devices.cam, p.camId, 'Camera', 'cr-camsel');
  fill(card.querySelector('#cr-micdev'), p.micOn, L.micErr, L.devices && L.devices.mic, p.micId, 'Microphone', 'cr-micsel');
}

/** Put the running camera and microphone into the card that is on screen now. */
function attachLive() {
  const card = S.card;
  if (!card) return;
  const L = S.live;
  const msg = card.querySelector('#cr-cammsg');
  const v = card.querySelector('#cr-camfull') || card.querySelector('#cr-stagebubble video');
  if (v && L.camStream && v.srcObject !== L.camStream) {
    v.srcObject = L.camStream;
    v.play().catch(() => undefined);
  }
  if (msg) {
    msg.hidden = !!L.camStream;
    if (L.camErr) msg.textContent = 'Camera blocked in the browser';
  }
  paintDevices();
  placeStageBubble();
  cancelAnimationFrame(L.raf);
  const sticks = [...card.querySelectorAll('#cr-meter i')];
  if (!L.analyser || !sticks.length) return;
  const buf = new Uint8Array(L.analyser.fftSize);
  let last = 0;
  let shown = -1;
  const loop = (t) => {
    L.raf = requestAnimationFrame(loop);
    if (t - last < 60) return;
    last = t;
    L.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += ((b - 128) / 128) ** 2;
    const n = Math.round(Math.min(1, Math.sqrt(sum / buf.length) * 4) * sticks.length);
    if (n === shown) return;
    shown = n;
    sticks.forEach((el, i) => el.classList.toggle('is-on', i < n));
  };
  L.raf = requestAnimationFrame(loop);
}

/** Start, stop or switch the card's camera and microphone so they match the switches. Running streams are kept. */
async function syncLive() {
  const card = S.card;
  const md = navigator.mediaDevices;
  if (!card || !md || !md.getUserMedia) return;
  const p = S.prefs;
  const L = S.live;
  const wantCam = p.camOn || p.source === 'camera' ? p.camId || 'default' : '';
  const wantMic = p.micOn ? p.micId || 'default' : '';
  const jobs = [];
  if (L.camKey !== wantCam) {
    L.camKey = wantCam;
    stopStream(L.camStream);
    L.camStream = null;
    L.camErr = false;
    if (wantCam) {
      jobs.push((async () => {
        let s = null;
        try {
          s = await md.getUserMedia({ video: p.camId ? { deviceId: { exact: p.camId } } : true, audio: false }).catch((e) => {
            // The remembered camera is gone (unplugged): use the default one.
            if (p.camId && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return md.getUserMedia({ video: true, audio: false });
            throw e;
          });
        } catch (e) {
          if (S.live === L && L.camKey === wantCam) L.camErr = true;
          return;
        }
        if (S.live !== L || L.camKey !== wantCam) return stopStream(s);
        L.camStream = s;
      })());
    }
  }
  if (L.micKey !== wantMic) {
    L.micKey = wantMic;
    stopStream(L.micStream);
    L.micStream = null;
    L.micErr = false;
    L.analyser = null;
    if (L.ctx) L.ctx.close().catch(() => undefined);
    L.ctx = null;
    if (wantMic) {
      jobs.push((async () => {
        let s = null;
        try {
          s = await md.getUserMedia({ audio: p.micId ? { deviceId: { exact: p.micId } } : true }).catch((e) => {
            if (p.micId && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return md.getUserMedia({ audio: true });
            throw e;
          });
        } catch (e) {
          if (S.live === L && L.micKey === wantMic) L.micErr = true;
          return;
        }
        if (S.live !== L || L.micKey !== wantMic) return stopStream(s);
        L.micStream = s;
        const AC = window.AudioContext || window.webkitAudioContext;
        L.ctx = new AC();
        L.analyser = L.ctx.createAnalyser();
        L.analyser.fftSize = 512;
        L.ctx.createMediaStreamSource(s).connect(L.analyser);
      })());
    }
  }
  attachLive();
  if (!jobs.length) return;
  await Promise.all(jobs);
  if (S.live !== L) return;
  await listDevices();
  if (S.live === L) attachLive();
}

/** The round camera on the stage sits where it will sit in the video, at the size it will have. */
function placeStageBubble() {
  const stage = S.card && S.card.querySelector('#cr-stage');
  const b = stage && stage.querySelector('#cr-stagebubble');
  if (!b) return;
  const p = S.prefs;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  const d = Math.max(40, Math.round(h * (BUBBLE_FRACTION[p.size] || BUBBLE_FRACTION.M)));
  const m = 8;
  const x = Math.min(w - d / 2 - m, Math.max(d / 2 + m, p.bx * w));
  const y = Math.min(h - d / 2 - m, Math.max(d / 2 + m, p.by * h));
  b.style.width = b.style.height = d + 'px';
  b.style.left = Math.round(x - d / 2) + 'px';
  b.style.top = Math.round(y - d / 2) + 'px';
}

/** Dragging the round camera on the stage sets where it starts in the video. */
function onStageDown(e) {
  const b = e.target.closest('#cr-stagebubble');
  const stage = b && b.closest('#cr-stage');
  if (!stage || e.button) return;
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  b.classList.add('is-drag');
  const move = (ev) => {
    const r = stage.getBoundingClientRect();
    S.prefs = { ...S.prefs, bx: Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)), by: Math.min(0.98, Math.max(0.02, (ev.clientY - r.top) / r.height)) };
    placeStageBubble();
  };
  const up = () => {
    b.classList.remove('is-drag');
    b.removeEventListener('pointermove', move);
    b.removeEventListener('pointerup', up);
    b.removeEventListener('pointercancel', up);
    savePrefs(S.prefs);
  };
  b.addEventListener('pointermove', move);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
}

/** Storage note: past 80% of 10 GB the card says so, and at 100% it will not start. */
async function showUsage() {
  if (!S.usage) {
    try {
      const d = await api('/api/clips/usage');
      S.usage = d.usage;
      if (d.usage && d.usage.maxMs) setMaxSeconds(Math.round(d.usage.maxMs / 1000));
    } catch (e) {
      return;
    }
  }
  const el = S.card && S.card.querySelector('#cr-usage');
  const u = S.usage;
  if (!el || !u || !u.warn) return;
  const gb = (n) => (n / 1024 ** 3).toFixed(1);
  el.hidden = false;
  el.innerHTML = u.full
    ? `Your clips use all ${gb(u.cap)} GB. Recording starts again once some are deleted. <a href="/clips/"${hubTarget}>My clips</a>`
    : `${gb(u.used)} of ${gb(u.cap)} GB used. <a href="/clips/"${hubTarget}>My clips</a> lists the oldest clips nobody watched.`;
}

/** Draw the card again after a switch changed. The camera and microphone keep running; focus stays on the same control. */
function paintCard(focusSel) {
  if (!S.card) return;
  const phone = isPhone();
  if (phone && S.prefs.source !== 'camera') S.prefs = { ...S.prefs, source: 'camera', camOn: true };
  S.card.innerHTML = cardHtml(phone);
  const f = focusSel && S.card.querySelector(focusSel);
  if (f) f.focus({ preventScroll: true });
  syncLive();
  showUsage();
}

function placeCard() {
  const c = S.card;
  if (!c) return;
  placeStageBubble();
  if (STANDALONE) return;
  if (isPhone()) {
    c.classList.add('is-sheet');
    c.style.cssText = '';
    return;
  }
  c.classList.remove('is-sheet');
  const r = S.anchor ? S.anchor.getBoundingClientRect() : null;
  const w = 400;
  const right = r ? Math.max(12, window.innerWidth - r.right) : 20;
  c.style.top = (r ? Math.round(r.bottom + 10) : 76) + 'px';
  c.style.right = Math.min(right, window.innerWidth - w - 12 > 0 ? right : 12) + 'px';
  c.style.maxHeight = `calc(100dvh - ${(r ? Math.round(r.bottom + 10) : 76) + 12}px)`;
}

export function openLauncher(anchor) {
  if (recordingNow()) return pulseBar();
  ensureCss();
  closeSaved();
  if (S.pip && !S.rec) closePip();
  if (S.card) return closeLauncher();
  S.anchor = anchor || S.anchor;
  S.prefs = readPrefs();
  S.usage = null;
  const c = document.createElement('div');
  c.className = 'cr-card' + (STANDALONE ? ' cr-card--solo' : '');
  c.setAttribute('role', 'dialog');
  c.setAttribute('aria-label', 'Record a clip');
  c.id = 'cr-card';
  const back = document.createElement('div');
  back.className = 'cr-back';
  back.id = 'cr-back';
  back.addEventListener('pointerdown', closeLauncher);
  if (STANDALONE) (document.getElementById('cr-root') || document.body).append(c);
  else document.body.append(back, c);
  S.card = c;
  fitWindow(440, 720);
  placeCard();
  paintCard();
  c.addEventListener('click', onCardClick);
  c.addEventListener('change', onCardChange);
  c.addEventListener('pointerdown', onStageDown);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', placeCard);
  // In a hub page the card is a dialog, so the keyboard starts inside it. The recorder window is the card.
  if (!STANDALONE) {
    c.tabIndex = -1;
    c.focus({ preventScroll: true });
  }
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
  if (e.key === 'Escape' && S.card && !STANDALONE) {
    e.preventDefault();
    closeLauncher();
    if (S.anchor) S.anchor.focus();
    return;
  }
  // Arrow keys move between the four sources, as in any radio group.
  const tile = e.target && e.target.closest && e.target.closest('.cr-tile');
  if (tile && S.card && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
    const ids = Object.keys(SOURCES);
    const i = ids.indexOf(tile.dataset.src);
    const next = ids[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? ids.length - 1 : 1)) % ids.length];
    e.preventDefault();
    pickSource(next);
  }
}

function setErr(msg) {
  const e = S.card && S.card.querySelector('#cr-err');
  if (e) {
    e.textContent = msg || '';
    e.hidden = !msg;
  }
}

function pickSource(id) {
  S.prefs = { ...S.prefs, source: id, ...(id === 'camera' ? { camOn: true } : {}) };
  savePrefs(S.prefs);
  paintCard(`[data-src="${id}"]`);
}

function onCardClick(ev) {
  const t = ev.target.closest('[data-act],[data-src],[data-size]');
  if (!t) return;
  const p = S.prefs;
  if (t.dataset.src) return pickSource(t.dataset.src);
  if (t.dataset.size) {
    S.prefs = { ...p, size: t.dataset.size };
    savePrefs(S.prefs);
    S.card.querySelectorAll('[data-size]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.size === S.prefs.size);
      b.setAttribute('aria-pressed', String(b.dataset.size === S.prefs.size));
    });
    placeStageBubble();
    return;
  }
  const flip = (key, act) => {
    S.prefs = { ...p, [key]: !p[key] };
    savePrefs(S.prefs);
    paintCard(`[data-act="${act}"]`);
  };
  switch (t.dataset.act) {
    case 'close':
      return closeLauncher();
    case 'cam':
      return flip('camOn', 'cam');
    case 'mic':
      return flip('micOn', 'mic');
    case 'sys':
      return flip('systemAudio', 'sys');
    case 'float':
      return flip('float', 'float');
    case 'start':
      return startRecording();
    case 'file':
      return pickFile();
    default:
  }
}

function onCardChange(ev) {
  const t = ev.target;
  if (t.id === 'cr-camsel') {
    S.prefs = { ...S.prefs, camId: t.value };
    savePrefs(S.prefs);
    syncLive();
  } else if (t.id === 'cr-micsel') {
    S.prefs = { ...S.prefs, micId: t.value };
    savePrefs(S.prefs);
    syncLive();
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
    noUnloadPrompt: STANDALONE,
  };
}

/** True while a real floating camera window is in a whole-screen capture: the camera is already in the picture. */
const nativeCheckFor = (rec) => () => {
  if (!rec.wholeScreen || debugFlag('composite')) return false;
  return !!(S.pip && S.pip.kind === 'bubble') || (!STANDALONE && !!S.bubbleEl && document.visibilityState === 'visible');
};

function adopt(rec) {
  if (S.unsub) S.unsub();
  S.rec = rec;
  S.rs = rec.state;
  S.busy = true;
  rec.nativeCheck = nativeCheckFor(rec);
  S.unsub = rec.subscribe(onRecState);
}

function startRecording() {
  if (!canRecordCamera()) {
    setErr('This browser cannot record video. Chrome, Edge, Firefox and Safari can.');
    return;
  }
  const p = S.prefs;
  const settings = settingsOf(p);
  if (S.usage && S.usage.full) {
    setErr('Your clips use all 10 GB. Recording starts again once some are deleted in My clips.');
    return;
  }
  if (settings.source !== 'camera' && !canRecordScreen()) {
    setErr('This browser cannot record the screen. Chrome, Edge, Firefox and Safari on a computer can.');
    return;
  }
  savePrefs(p);
  stopLive(); // the card's preview lets go of the camera and microphone first
  const rec = new ClipRecorder(settings);
  rec.setBubble({ size: p.size, cx: p.bx, cy: p.by });
  adopt(rec);
  // The floating window and the screen picker both need this click, so both start before anything is awaited.
  const wantBubble = settings.source === 'screen+camera';
  const wantFloat = !isPhone() && p.float !== false;
  S.pipWanted = (!!docPip() && (wantBubble || wantFloat)) || (!docPip() && videoPipOk() && wantFloat && STANDALONE);
  S.pipVideo = S.pipWanted && !docPip();
  S.floatLater = false; // Arc may hide the auto-opened window, so the Float button stays available in every browser
  S.pipError = '';
  const winP = S.pipWanted && !S.floatLater
    ? (S.pipVideo ? openVideoPip() : openPip(wantBubble ? 'bubble' : 'controls')).catch((e) => {
        // Said out loud (and retried on the next click) so a browser that refuses is never silent.
        S.pipError = (e && (e.name || e.message)) || 'refused';
        return null;
      })
    : null;
  // A picker that was dismissed before the floating window opened leaves no window behind.
  if (winP) winP.then(() => S.rec !== rec && !S.rec && closePip());
  const prep = rec.prepare();
  closeLauncher();
  mountBar(rec);
  prep.then(
    async () => {
      if (winP) await winP;
      if (S.rec !== rec) return;
      if (S.pipWanted && !S.floatLater && !S.pip && !S.vpip) armFloat(rec);
      if (S.pip && S.pip.attach && rec.camStream) S.pip.attach(rec.camStream);
      if (S.pip && S.pip.showCorners) S.pip.showCorners();
      if (wantBubble && !(S.pip && S.pip.kind === 'bubble') && !STANDALONE) mountPageBubble(rec);
      if (settings.source === 'camera' && !STANDALONE) mountPageBubble(rec, true);
      paintLivePanel(rec);
      countdown(rec);
    },
    (e) => {
      // A failed start already toasted through the recorder's error state; say it once.
      if (!(rec.state && rec.state.phase === 'error')) {
        toast(e && e.message ? e.message : 'Recording could not start.', 'bad');
        if (S.rec === rec) teardown();
      }
    }
  );
}

function countdown(rec) {
  let n = 3;
  clearTimeout(S.countTimer);
  if (S.countEl) S.countEl.remove();
  const el = document.createElement('div');
  el.className = 'cr-count';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Recording starts soon');
  const wait = !!S.floatLater && !S.pip && !S.vpip;
  el.innerHTML = wait
    ? `<p class="cr-count__wait">The screen is ready. The recording controls open in a floating window when you press Start.</p><div class="cr-count__btns"><button type="button" data-act="skip" class="cr-pill">Start recording</button><button type="button" data-act="cancel" class="cr-pill is-ghost">Cancel</button></div>`
    : `<div class="cr-count__n" id="cr-count-n" aria-live="assertive">3</div><p>Recording starts</p><div class="cr-count__btns"><button type="button" data-act="skip" class="cr-pill">Start now</button><button type="button" data-act="cancel" class="cr-pill is-ghost">Cancel</button></div>`;
  document.body.appendChild(el);
  S.countEl = el;
  S.countN = n;
  paintControls();
  const go = () => {
    clearTimeout(S.countTimer);
    el.remove();
    S.countEl = null;
    S.countN = 0;
    S.countGo = null;
    if (S.rec !== rec) return;
    fitLive(rec);
    rec.begin();
    paintControls();
  };
  const tick = () => {
    n -= 1;
    if (n <= 0) return go();
    // One second before the recording starts: the family's recording sound, finished before the microphone opens.
    if (n === 1 && window.hubSound) window.hubSound.play('rec-start');
    S.countN = n;
    const nn = el.querySelector('#cr-count-n');
    nn.textContent = String(n);
    nn.style.animation = 'none';
    void nn.offsetWidth;
    nn.style.animation = '';
    paintControls();
    S.countTimer = setTimeout(tick, 1000);
  };
  S.countGo = go;
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'skip') {
      // Opened by this click, with no screen picker open, so the browser shows the window.
      if (wait) floatControls();
      go();
    }
    if (a.dataset.act === 'cancel') cancelCountdown(rec);
  });
  if (!wait) S.countTimer = setTimeout(tick, 1000);
}

function cancelCountdown(rec) {
  if (!S.countEl && !S.countN) return;
  clearTimeout(S.countTimer);
  if (S.countEl) S.countEl.remove();
  S.countEl = null;
  S.countN = 0;
  S.countGo = null;
  if (S.unsub) S.unsub();
  S.unsub = null;
  rec.discard();
  teardown();
}

function teardown(keepClosed, keepPip) {
  if (S.unsub) S.unsub();
  S.unsub = null;
  S.rec = null;
  S.rs = null;
  S.busy = false;
  S.countN = 0;
  S.countGo = null;
  clearTimeout(S.countTimer);
  if (S.countEl) S.countEl.remove();
  S.countEl = null;
  if (S.bar && S.bar.drag) S.bar.drag.destroy();
  if (S.bar) S.bar.el.remove();
  S.bar = null;
  if (S.panel) S.panel.remove();
  S.panel = null;
  removeBubble();
  if (!keepPip) {
    closePip();
    closeVideoPip();
  }
  if (STANDALONE && !keepClosed && !S.leaving) {
    post({ t: 'state', phase: 'idle' });
    if (S.card) closeLauncher();
    openLauncher();
  }
}

/* ------------------------------------------------------------------ controls: this window, the floating window, the hub pill */

function viewState() {
  const rs = S.rs || { phase: 'idle', elapsed: 0 };
  const rec = S.rec;
  return {
    phase: S.countN ? 'countdown' : rs.phase === 'ready' ? 'preparing' : rs.phase,
    elapsed: rs.elapsed || 0,
    level: rs.level || 0,
    muted: !!rs.muted,
    hasMic: rec ? (rec.hasMic || (rs.phase === 'preparing' && rec.settings.micId !== null)) : false,
    retrying: !!rs.retrying,
    count: S.countN,
    canFloat: !!docPip(),
    cameraOnly: !!rec && rec.settings.source === 'camera',
    hasCam: !!rec && rec.settings.source === 'screen+camera' && !!rec.camStream,
    camOn: !(rec && rec.camOff),
  };
}

function paintControls() {
  const st = viewState();
  if (S.bar) S.bar.ctl.update(st);
  if (S.pip && S.pip.ctl && S.rec) S.pip.ctl.update(st);
  if (S.panel) S.panel.classList.toggle('has-pip', !!S.pip);
  const camHidden = !!S.rec && S.rec.camOff;
  if (S.pip && S.pip.wrap) S.pip.wrap.classList.toggle('is-camoff', camHidden);
  if (S.bubbleEl) S.bubbleEl.hidden = camHidden;
  if (STANDALONE) announce(st);
}

/** One command from any set of controls (this window, the floating window, a hub page). */
function onCtl(cmd, extra) {
  const rec = S.rec;
  switch (cmd) {
    case 'pause':
      if (rec) rec.pause();
      break;
    case 'resume':
      if (rec) rec.resume();
      break;
    case 'mute':
      if (rec) rec.setMuted(!rec.state.muted);
      break;
    case 'stop':
      if (rec) finishRecording(rec);
      break;
    case 'restart':
      if (rec) restartRecording(rec);
      break;
    case 'discard':
      if (rec) discardRecording(rec);
      break;
    case 'float':
      floatControls();
      break;
    case 'share':
      changeShare(extra && extra.navigator ? extra.navigator : null, extra === 'remote');
      break;
    case 'camoff':
      if (rec) rec.setCamera(false);
      break;
    case 'camon':
      if (rec) rec.setCamera(true);
      break;
    case 'skip':
      if (S.countGo) S.countGo();
      break;
    case 'cancel':
      if (rec) cancelCountdown(rec);
      break;
    case 'open':
      if (extra) window.open(`/c/${extra}`, 'favor-hub-main');
      closePip();
      break;
    case 'dismiss':
      closePip();
      break;
    default:
  }
}

/**
 * The floating window did not open from the Start click (a browser can refuse when the picker used the click up). Say so,
 * and open it from the next click or key press in this window, which is a fresh gesture.
 */
function armFloat(rec) {
  toast(`The floating controls did not open${S.pipError ? ' (' + S.pipError + ')' : ''}. Click anywhere in this window and they open.`, 'bad');
  const again = () => {
    if (S.rec !== rec || S.pip) return off();
    floatControls().then(() => {
      if (S.pip) off();
    });
  };
  const off = () => {
    document.removeEventListener('pointerdown', again, true);
    document.removeEventListener('keydown', again, true);
  };
  document.addEventListener('pointerdown', again, true);
  document.addEventListener('keydown', again, true);
}

/** Change what is being recorded without ending the clip. `nav` is the navigator of the window that was clicked. */
async function changeShare(nav, remote) {
  const rec = S.rec;
  if (!rec) return;
  try {
    const ok = await rec.changeShare(nav);
    if (ok) toast('Sharing the new screen. The clip keeps going.');
  } catch (e) {
    const noClick = e && (e.name === 'NotAllowedError' || e.name === 'InvalidStateError');
    if (remote && noClick) {
      // A browser only opens its picker for a click in the window that asks. Bring this window forward and say so.
      try {
        window.focus();
      } catch (err) {
        /* the browser decides */
      }
      toast("Press Change what I'm sharing in the recorder window.", 'bad');
      pulseBar();
    } else if (!(e && e.name === 'NotAllowedError')) {
      toast(e && e.message ? e.message : 'Could not change the screen.', 'bad');
    }
  }
}

/** The recorder window's view while a recording runs: the controls, the camera when it is the picture, and where the round camera sits. */
function paintLivePanel(rec) {
  const panel = S.panel;
  if (!panel) return;
  const cam = panel.querySelector('[data-livecam]');
  if (cam) {
    cam.hidden = !(rec.settings.source === 'camera' && rec.camStream);
    const v = cam.querySelector('video');
    if (!cam.hidden && v.srcObject !== rec.camStream) {
      v.srcObject = rec.camStream;
      v.play().catch(() => undefined);
    }
  }
  const corners = panel.querySelector('.cr-corners');
  // Without a floating camera window the camera is drawn into the picture; these buttons pick its corner.
  if (corners) corners.hidden = !(rec.settings.source === 'screen+camera' && rec.camStream && !(S.pip && S.pip.kind === 'bubble'));
}

const CORNERS = [['tl', 0.12, 0.2, 'top left'], ['tr', 0.88, 0.2, 'top right'], ['bl', 0.12, 0.78, 'bottom left'], ['br', 0.88, 0.78, 'bottom right']];
const cornersHtml = () => `<span>Camera in the video</span>${CORNERS.map(([k, x, y, name]) => `<button type="button" data-corner="${k}" data-x="${x}" data-y="${y}" aria-label="Move the camera to the ${name}"><i></i></button>`).join('')}`;
function wireCorners(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-corner]');
    if (b && S.rec) S.rec.setBubble({ cx: Number(b.dataset.x), cy: Number(b.dataset.y) });
  });
}

function fitLive(rec) {
  if (!STANDALONE) return;
  const camera = rec.settings.source === 'camera';
  const composite = rec.settings.source === 'screen+camera' && !(S.pip && S.pip.kind === 'bubble');
  fitWindow(500, camera ? 440 : composite ? 190 : 150);
}

function mountBar(rec) {
  if (S.bar) return;
  const bar = document.createElement('div');
  bar.className = 'cr-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Recording controls');
  bar.id = 'cr-bar';
  bar.innerHTML = controlsHtml({ grip: !STANDALONE, float: true });
  if (STANDALONE) {
    const panel = document.createElement('section');
    panel.className = 'cr-live';
    panel.id = 'cr-live';
    panel.setAttribute('aria-label', 'Recording');
    panel.innerHTML = `<div class="cr-live__cam" data-livecam hidden><video muted playsinline></video></div><div class="cr-live__slot"></div><div class="cr-corners cr-corners--bar" hidden>${cornersHtml()}</div><p class="cr-live__note"><span class="cr-live__here">This window holds the recording.</span><span class="cr-live__float">This window holds the recording. The controls float above your other windows.</span></p>`;
    panel.querySelector('.cr-live__slot').appendChild(bar);
    wireCorners(panel.querySelector('.cr-corners'));
    (document.getElementById('cr-root') || document.body).appendChild(panel);
    S.panel = panel;
  } else {
    document.body.appendChild(bar);
  }
  S.bar = { el: bar, ctl: wireControls(bar, onCtl), drag: null };
  if (!STANDALONE) S.bar.drag = makeDraggable(bar, PILL_KEY);
  paintControls();
  void rec;
}

function pulseBar() {
  const b = S.bar && S.bar.el;
  if (!b) return;
  b.classList.remove('is-pulse');
  void b.offsetWidth;
  b.classList.add('is-pulse');
}

let lastPost = 0;
let lastSig = '';
/** Tell every hub page what the recording is doing (their camera button and their pill follow it). */
function announce(st) {
  const rs = S.rs;
  if (!rs) return;
  const now = Date.now();
  const sig = [st.phase, st.muted, !!S.pip, st.count, st.retrying, st.hasCam, st.camOn].join('|');
  if (sig === lastSig && now - lastPost < 1000) return;
  lastPost = now;
  lastSig = sig;
  post({ t: 'state', phase: st.phase, id: rs.id || '', elapsed: st.elapsed, muted: st.muted, hasMic: st.hasMic, pip: !!S.pip, canFloat: st.canFloat, count: st.count, retrying: st.retrying, cameraOnly: st.cameraOnly, hasCam: st.hasCam, camOn: st.camOn });
}

function onRecState(rs) {
  S.rs = rs;
  paintControls();
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
    if (!b || !S.rec) return;
    setBubbleSize(S.rec, b.dataset.size);
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
      const box = pipSize('bubble', size);
      w.resizeTo(box.width + (w.outerWidth - w.innerWidth), box.height + (w.outerHeight - w.innerHeight));
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

// The camera window leaves room for the camera, the controls and the row that places the camera in the video.
const pipSize = (kind, size) => (kind === 'bubble' ? { width: Math.max(BUBBLE_PX[size] + 28, PIP_BAR.width), height: BUBBLE_PX[size] + 16 + PIP_BAR.height + 36 } : { ...PIP_BAR });

/** Copy from the floating window: the clipboard belongs to the window that has the focus. */
async function copyFrom(win, text) {
  try {
    await win.navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return copyText(text);
  }
}

/**
 * Open the small always-on-top window. It holds the recording controls (and the round camera when the camera is on),
 * stays above every app and tab, and can be dragged anywhere on the screen. Closing it never touches the recording:
 * the recorder window holds the streams.
 */
async function openPip(kind) {
  const api2 = docPip();
  if (!api2) throw new Error('no pip');
  if (S.pip) closePip();
  const win = await api2.requestWindow({ ...pipSize(kind, S.prefs.size), disallowReturnToOpener: true });
  const doc = win.document;
  doc.title = 'Recording';
  const l = doc.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL(CSS_URL, location.href).toString();
  doc.head.appendChild(l);
  // The fonts are declared by the page, so the floating window declares them too.
  const st = doc.createElement('style');
  st.textContent = `@font-face{font-family:'Inter';src:url('${new URL('/fonts/inter-var.woff2', location.href)}') format('woff2');font-weight:100 900;font-display:swap}`;
  doc.head.appendChild(st);
  doc.documentElement.lang = 'en';
  doc.body.className = 'cr-pipbody';
  const rec = S.rec;
  const pip = { win, kind, ctl: null, setSize: () => undefined, timer: 0 };
  S.pip = pip;
  win.addEventListener('pagehide', () => {
    clearTimeout(pip.timer);
    if (S.pip !== pip) return;
    S.pip = null;
    // Closing the floating window by hand puts the camera back on the page. The recording is never touched.
    const live = S.rec && S.rec.state.phase !== 'finishing' && S.rec.state.phase !== 'done';
    if (live && kind === 'bubble' && !STANDALONE) mountPageBubble(S.rec);
    if (S.rec) paintLivePanel(S.rec);
    paintControls();
  });
  const wrap = doc.createElement('div');
  wrap.className = 'cr-pip';
  wrap.dataset.kind = kind;
  const inner = (rec && rec.bubble.size) || 'M';
  wrap.innerHTML = `${kind === 'bubble' ? `<div class="cr-pip__cam"><div class="cr-pipcircle" data-size="${inner}"><video muted playsinline></video><div class="cr-bubble__sz" role="group" aria-label="Camera size">${['S', 'M', 'L'].map((s) => `<button type="button" data-size="${s}" aria-pressed="${s === inner}">${s}</button>`).join('')}</div></div></div>` : ''}
    <div class="cr-pip__ctl cr-bar cr-bar--pip" role="region" aria-label="Recording controls">${controlsHtml()}</div>
    ${kind === 'bubble' ? `<div class="cr-corners" hidden>${cornersHtml()}</div>` : ''}`;
  doc.body.appendChild(wrap);
  const ctlEl = wrap.querySelector('.cr-pip__ctl');
  pip.wrap = wrap;
  const offKeys = wireShortcuts(doc, () => S.rs && S.rs.phase, onCtl);
  win.addEventListener('pagehide', offKeys);
  pip.ctl = wireControls(ctlEl, async (cmd, extra) => {
    // The picker opens only for a click in the window that asks, so the floating window asks for itself.
    if (cmd === 'share') return onCtl('share', win);
    if (cmd === 'copy') {
      const ok = await copyFrom(win, `${location.origin}/c/${extra}`);
      const b = ctlEl.querySelector('[data-ctl=copy]');
      if (b) b.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
      return;
    }
    onCtl(cmd, extra);
  });
  if (kind === 'bubble') {
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
    // A recording of a window or tab draws the camera into the picture; the corner buttons say where.
    const corners = wrap.querySelector('.cr-corners');
    wireCorners(corners);
    pip.showCorners = () => (corners.hidden = !(S.rec && !S.rec.wholeScreen));
    pip.hideCam = () => {
      v.srcObject = null;
      wrap.classList.add('is-done');
      try {
        win.resizeTo(PIP_BAR.width + (win.outerWidth - win.innerWidth), PIP_BAR.height + (win.outerHeight - win.innerHeight));
      } catch (e) {
        /* the size stays; the note sits in the middle */
      }
    };
  }
  paintControls();
  return win;
}

/** The Float button in the recorder window: bring the controls back above every window after the floating one was closed. */
async function floatControls() {
  if (S.pipVideo && !S.vpip && S.rec && !S.pipOpening) {
    S.pipOpening = true;
    try {
      await openVideoPip();
    } catch (e) {
      toast('The browser did not open the floating player.', 'bad');
    } finally {
      S.pipOpening = false;
    }
    return;
  }
  if (!S.rec || !docPip() || S.pipOpening) return;
  const rec = S.rec;
  const bubble = rec.settings.source === 'screen+camera' && !!rec.camStream;
  S.pipOpening = true;
  try {
    await openPip(bubble ? 'bubble' : 'controls');
    if (S.pip && S.pip.showCorners) S.pip.showCorners();
    if (bubble) removeBubble();
    paintLivePanel(rec);
    paintControls();
  } catch (e) {
    toast('The browser did not open the floating controls.', 'bad');
  } finally {
    S.pipOpening = false;
  }
}

/**
 * A browser with no usable floating window (Arc, Safari): the picture-in-picture video player. It shows the time and state
 * drawn on a small canvas, and the player's own buttons (play and pause, hang up, microphone) drive the recording through
 * the media session. Needs the Start click, like the floating window.
 */
async function openVideoPip() {
  if (S.vpip) return;
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 270;
  const g = canvas.getContext('2d');
  const draw = () => {
    const st = viewState();
    const paused = st.phase === 'paused';
    g.fillStyle = '#26211c';
    g.fillRect(0, 0, 480, 270);
    g.fillStyle = paused ? '#c9a24a' : '#d4452f';
    g.beginPath();
    g.arc(60, 70, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '600 22px Inter, system-ui, sans-serif';
    g.fillText(paused ? 'Paused' : st.phase === 'recording' ? 'Recording' : st.phase === 'finishing' ? 'Saving' : 'Starting', 90, 78);
    g.font = '700 84px Inter, system-ui, sans-serif';
    const t = Math.floor(st.elapsed || 0);
    g.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 50, 175);
    g.font = '500 18px Inter, system-ui, sans-serif';
    g.fillStyle = '#d9d2c6';
    g.fillText(st.muted ? 'Microphone muted' : 'Pause and hang up are in this player', 50, 225);
  };
  draw();
  let timer = 0;
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),250)'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = draw;
    timer = () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch (e) {
    const id = window.setInterval(draw, 250);
    timer = () => window.clearInterval(id);
  }
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = canvas.captureStream(10);
  v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  const vp = { video: v, stop: timer };
  S.vpip = vp;
  try {
    await v.play();
    await v.requestPictureInPicture();
  } catch (e) {
    closeVideoPip();
    throw e;
  }
  const ms = navigator.mediaSession;
  const act = (name, fn) => {
    try {
      ms.setActionHandler(name, fn);
    } catch (e) {
      // this browser has no such button
    }
  };
  if (ms) {
    ms.metadata = new MediaMetadata({ title: 'Recording a clip', artist: 'FavorOS' });
    ms.playbackState = 'playing';
    act('pause', () => {
      onCtl('pause');
      v.play().catch(() => undefined);
    });
    act('play', () => {
      onCtl('resume');
      v.play().catch(() => undefined);
    });
    act('hangup', () => onCtl('stop'));
    act('togglemicrophone', () => onCtl('mute'));
  }
  v.addEventListener('leavepictureinpicture', () => {
    if (S.vpip === vp) closeVideoPip();
  });
  paintControls();
}

function closeVideoPip() {
  const vp = S.vpip;
  S.vpip = null;
  if (!vp) return;
  vp.stop();
  try {
    if (document.pictureInPictureElement === vp.video) void document.exitPictureInPicture().catch(() => undefined);
  } catch (e) {
    // already closed
  }
  vp.video.srcObject = null;
  vp.video.remove();
  try {
    for (const a of ['pause', 'play', 'hangup', 'togglemicrophone']) navigator.mediaSession.setActionHandler(a, null);
  } catch (e) {
    // nothing to clear
  }
}

function closePip() {
  const p = S.pip;
  S.pip = null;
  if (p) {
    clearTimeout(p.timer);
    try {
      if (!p.win.closed) p.win.close();
    } catch (e) {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------------ stop, start over, discard */

async function finishRecording(rec) {
  if (rec.state.phase !== 'recording' && rec.state.phase !== 'paused') return;
  const r = await rec.stop();
  if (!r) return; // an error already told the person
  const pip = S.pip;
  teardown(true, true);
  closeVideoPip();
  // The floating window says the clip is saved and links to it, then closes by itself.
  if (pip && pip.ctl) {
    if (pip.hideCam) pip.hideCam();
    pip.ctl.saved(r.id);
    pip.timer = setTimeout(() => S.pip === pip && closePip(), 30000);
  }
  await afterSave(r.id);
}

function discardRecording(rec) {
  if (S.unsub) S.unsub();
  S.unsub = null;
  rec.cancel();
  teardown();
  toast('Recording discarded');
}

/**
 * Start over: the first take is deleted and a new one begins after the countdown, with the same screen, camera and
 * microphone. The browser is not asked for the screen again.
 */
function restartRecording(old) {
  if (old.state.phase !== 'recording' && old.state.phase !== 'paused') return;
  const muted = !!old.state.muted;
  const bubble = { ...old.bubble };
  const pageBubble = !!S.bubbleEl;
  const preview = pageBubble && S.bubbleEl.classList.contains('is-preview');
  if (S.unsub) S.unsub();
  S.unsub = null;
  const kept = old.handOff();
  old.cancel();
  const rec = new ClipRecorder(old.settings, kept);
  rec.setBubble(bubble);
  adopt(rec);
  paintControls();
  rec.prepare().then(
    () => {
      if (S.rec !== rec) return;
      if (muted) rec.setMuted(true);
      if (S.pip && S.pip.attach && rec.camStream) S.pip.attach(rec.camStream);
      if (pageBubble) mountPageBubble(rec, preview);
      paintLivePanel(rec);
      countdown(rec);
    },
    () => undefined // the recorder's error state closes the controls and says why
  );
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
  el.innerHTML = `<div class="cr-head"><h2>${esc(label || 'Clip saved')}</h2>${STANDALONE ? '' : `<button type="button" class="cr-x" data-act="dismiss" aria-label="Close">${svg('close')}</button>`}</div>
    <div class="cr-saved__body" data-body><p class="cr-spin"><i></i>Writing the transcript and a title</p></div>
    <div class="cr-saved__btns"><a class="cr-pill" href="/c/${id}"${hubTarget} data-act="open">Open the clip</a></div>`;
  (STANDALONE ? document.getElementById('cr-root') || document.body : document.body).appendChild(el);
  S.savedCard = el;
  if (STANDALONE) {
    el.classList.add('cr-saved--solo');
    fitWindow(440, 440);
    post({ t: 'state', phase: 'idle' });
    post({ t: 'saved', id, pip: !!S.pip });
    try {
      window.focus();
    } catch (e) {
      /* the browser decides */
    }
  }
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act=dismiss]')) closeSaved();
    if (ev.target.closest('[data-act=again]')) {
      closeSaved();
      openLauncher();
    }
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
  body.innerHTML = `<p class="cr-saved__title">${esc(title)}</p>${sum ? `<p class="cr-saved__sum">${esc(sum)}</p>` : ''}
    <p class="cr-note" data-note></p>`;
  const lineOf = (lv) => (LEVELS.find((l) => l.id === lv) || LEVELS[1]).line;
  let lvl = levelOfClip(clip || {});
  const showLevel = () => {
    const b = el.querySelector('[data-act=share]');
    if (b) b.textContent = `Who can watch: ${levelLabel(lvl)}`;
    el.querySelector('[data-note]').textContent = lineOf(lvl);
  };
  btns.innerHTML = `<button type="button" class="cr-pill is-ghost" data-act="share"></button><a class="cr-pill" href="/c/${id}"${hubTarget}>Open the clip</a><button type="button" class="cr-pill is-ghost" data-act="copy">${svg('link')}Copy link</button>${STANDALONE ? '<button type="button" class="cr-pill is-ghost" data-act="again">Record another</button>' : ''}`;
  el.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act=copy]')) {
      toast((await copyText(linkFor(id))) ? 'Link copied' : 'Could not copy the link', 'ok');
    }
  });
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act=share]')) openShare(id, { onChange: ({ level }) => { lvl = level; showLevel(); } });
  });
  showLevel();
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
  el.className = 'cr-saved' + (STANDALONE ? ' cr-saved--solo' : '');
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="cr-head"><h2>Uploading</h2></div><p class="cr-saved__file">${esc(f.name)}</p><div class="cr-prog" role="progressbar" aria-label="Upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p class="cr-note" data-label>Uploading</p>`;
  (STANDALONE ? document.getElementById('cr-root') || document.body : document.body).appendChild(el);
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
    if (STANDALONE) openLauncher();
  }
}

/* ------------------------------------------------------------------ recordings whose tab closed */

export async function resumeUnfinished() {
  try {
    const r = await api('/api/clips/unfinished');
    for (const c of r.clips || []) {
      // Quiet for 90 seconds (a live recording sends something every few seconds), so a recording in another window or on another device is left alone.
      if (Date.now() - new Date(c.updatedAt).getTime() < 90000 || !(c.parts || c.tail)) continue;
      const done = await api(`/api/clips/${c.id}/complete`, { method: 'POST', json: { durationMs: c.durationMs, recover: true } }).catch(() => null);
      if (done) {
        toast('Finished a recording that was cut off. It is in My clips.');
        api(`/api/clips/${c.id}/process`, { method: 'POST', json: {} }).catch(() => undefined);
      }
    }
  } catch (e) {
    /* nothing to finish */
  }
}

// Shortcuts in whichever window shows the controls (the recorder window, or a hub page that records inside itself).
if (typeof document !== 'undefined') wireShortcuts(document, () => S.rs && S.rs.phase, onCtl);

export const isRecording = recordingNow;
// For tests: the recorder in progress.
export const _state = S;

/* ------------------------------------------------------------------ the recorder window talks to the hub pages */

if (STANDALONE && CHANNEL) {
  CHANNEL.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.t === 'open') {
      // The camera button was pressed again while this window sat on a saved note: show the card for the next clip.
      if (!S.rec && !S.busy && !S.card) {
        closeSaved();
        openLauncher();
      }
      return;
    }
    // A hub page that just loaded asks whether a recording is running (its camera button shows a red dot).
    if (m.t === 'ping') {
      lastSig = '';
      if (S.rs) announce(viewState());
      else post({ t: 'state', phase: 'idle' });
      return;
    }
    // The pill on a hub page: pause, resume, mute, stop, start over, discard.
    if (m.t === 'cmd' && typeof m.c === 'string' && ['pause', 'resume', 'mute', 'stop', 'restart', 'discard', 'skip', 'cancel', 'camon', 'camoff', 'float'].includes(m.c)) onCtl(m.c);
    if (m.t === 'cmd' && m.c === 'share') onCtl('share', 'remote');
  });
  // Closing the window mid-recording: ask the server to finish the clip from what it already holds (whole parts and the
  // tail). The footage up to the last few seconds is kept and the clip lands in My clips.
  window.addEventListener('pagehide', () => {
    post({ t: 'gone' });
    const rec = S.rec;
    const ph = S.rs && S.rs.phase;
    if (!rec || !S.rs || !S.rs.id || (ph !== 'recording' && ph !== 'paused')) return;
    S.leaving = true;
    try {
      const body = new Blob([JSON.stringify({ durationMs: Math.round(rec.elapsedNow() * 1000) })], { type: 'application/json' });
      navigator.sendBeacon(`/api/clips/${S.rs.id}/complete`, body);
    } catch (e) {
      /* the next visit finishes it */
    }
    post({ t: 'closed', id: S.rs.id });
  });
}
