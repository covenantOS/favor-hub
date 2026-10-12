// Clips: the recording pill on hub pages. While a recording runs in the recorder window, every hub page shows this
// small bar: the time, Pause, Mute, Start over, Stop and Discard. It can be dragged anywhere and comes back in the same
// place on the next page. The buttons send a command to the recorder window, which holds the recording.
// In Chrome and Edge the floating window does this job above every app; the pill shows when that window is closed,
// and in Safari and Firefox, which have no floating window.
import { controlsHtml, makeDraggable, wireControls, wireShortcuts } from './controls.js';
import { copyText } from './core.js';

const PILL_KEY = 'favor.clips.pill';
const CSS_URL = '/js/clips/launcher.css?v=9';
const LIVE = ['preparing', 'countdown', 'recording', 'paused', 'finishing'];

let el = null;
let ctl = null;
let drag = null;
let timer = 0;
let st = null;
let at = 0;
let send = () => undefined;
let savedTimer = 0;
let savedId = '';
let offKeys = null;

function ensureCss() {
  if (document.getElementById('cr-css') || document.querySelector('link[href*="/js/clips/launcher.css"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = CSS_URL;
  l.id = 'cr-css';
  document.head.appendChild(l);
}

/** The time on the pill runs between the recorder window's messages (one a second). */
function now() {
  const run = st && st.phase === 'recording' ? (Date.now() - at) / 1000 : 0;
  return { ...st, elapsed: (st ? st.elapsed || 0 : 0) + run };
}

function paint() {
  if (!el || !st || savedId) return;
  // No word from the recorder window for a while: it was closed or it crashed. The hub finishes the clip (clips-launch.js).
  if (Date.now() - at > 8000) return hide();
  ctl.update(now());
}

function onCmd(cmd, extra) {
  if (cmd === 'open') {
    location.href = `/c/${extra}`;
    return;
  }
  if (cmd === 'copy') {
    copyText(`${location.origin}/c/${extra}`).then((ok) => {
      const b = el && el.querySelector('[data-ctl=copy]');
      if (b) b.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
    });
    return;
  }
  if (cmd === 'dismiss') return hide();
  // Shown at once, then confirmed by the recorder window's next message.
  if (st && cmd === 'pause' && st.phase === 'recording') st = { ...now(), phase: 'paused' };
  else if (st && cmd === 'resume' && st.phase === 'paused') st = { ...st, phase: 'recording' };
  else if (st && cmd === 'mute') st = { ...now(), muted: !st.muted };
  else if (st && (cmd === 'camon' || cmd === 'camoff')) st = { ...now(), camOn: cmd === 'camon' };
  else if (st && cmd === 'stop') st = { ...now(), phase: 'finishing' };
  at = Date.now();
  if (st && ctl) ctl.update(now());
  send({ t: 'cmd', c: cmd });
}

function mount() {
  if (el) return;
  ensureCss();
  el = document.createElement('div');
  el.className = 'cr-bar cr-bar--remote';
  el.id = 'cr-remote';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Recording controls');
  el.innerHTML = controlsHtml({ grip: true, float: true, level: false });
  document.body.appendChild(el);
  ctl = wireControls(el, onCmd);
  drag = makeDraggable(el, PILL_KEY);
  timer = setInterval(paint, 250);
  offKeys = wireShortcuts(document, () => (st ? st.phase : ''), onCmd);
}

export function hide() {
  clearInterval(timer);
  clearTimeout(savedTimer);
  if (offKeys) offKeys();
  offKeys = null;
  if (drag) drag.destroy();
  if (el) el.remove();
  el = null;
  ctl = null;
  drag = null;
  st = null;
  savedId = '';
}

/** `post` sends a message to the recorder window. */
export function init(post) {
  send = post;
}

/** One state message from the recorder window. `when` is the time it was written (a stored one can be a few seconds old). */
export function show(state, when) {
  if (savedId) return;
  if (!state || !LIVE.includes(state.phase) || state.pip) return hide();
  mount();
  st = state;
  at = when || Date.now();
  ctl.update(now());
  // The pill is wider or narrower from one state to the next; keep it inside the page.
  drag.place();
}

/** The recording was stopped and saved: the pill links to the clip for a few seconds, then leaves. */
export function saved(id) {
  mount();
  savedId = id;
  ctl.saved(id);
  drag.place();
  clearTimeout(savedTimer);
  savedTimer = setTimeout(hide, 15000);
}
