// Clips: the recording controls. One set of markup and wiring, drawn in three places: the recorder window, the small
// window that floats above every app (Chrome and Edge), and the pill on hub pages. Each place passes its own `on(cmd)`:
// the recorder window acts on the recording, the hub pill sends the command to the recorder window.
import { fmtTime } from './core.js';

const I = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M3 3l18 18"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  share: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="M9.5 10.5 12 8l2.5 2.5"/><path d="M12 8v5"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  camOff: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/><path d="M3 3l18 18"/>',
  float: '<rect x="3" y="4" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
};
const svg = (n, cls = '') => `<svg class="cr-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

const ASK = {
  discard: { q: 'Discard this recording?', yes: 'Discard', cmd: 'discard', red: true },
  restart: { q: 'Start over?', yes: 'Start over', cmd: 'restart', red: false },
};

/** `grip` adds the handle that drags the pill; `float` adds the button that opens the floating window; `level` the microphone bars. */
export function controlsHtml({ grip = false, float = false, level = true } = {}) {
  return `${grip ? `<button type="button" class="cr-grip" data-ctl="grip" aria-label="Move the recording controls. Arrow keys move them." title="Drag to move">${svg('grip')}</button>` : ''}
  <span class="cr-v cr-v--wait" data-v="wait"><i class="cr-spinner" aria-hidden="true"></i><span data-wait>Waiting for the screen</span></span>
  <span class="cr-v cr-v--count" data-v="count"><span>Recording in</span><b class="cr-cnum" data-n>3</b><button type="button" class="cr-pill cr-pill--sm" data-ctl="skip">Start now</button><button type="button" class="cr-pill cr-pill--sm is-ghost" data-ctl="cancel">Cancel</button></span>
  <span class="cr-v cr-v--live" data-v="live">
    <button type="button" class="cr-ic cr-ic--stop" data-ctl="stop" aria-label="Stop and save" title="Stop and save">${svg('stop')}</button>
    <span class="cr-rec"><i class="cr-rdot" aria-hidden="true"></i><b class="cr-time" data-t role="timer" aria-label="Recorded">0:00</b></span>
    ${level ? `<span class="cr-bars" data-bars aria-hidden="true">${[0.2, 0.4, 0.6, 0.8, 1].map((b) => `<i data-bar="${b}"></i>`).join('')}</span>` : ''}
    <button type="button" class="cr-ic" data-ctl="pause" aria-label="Pause" title="Pause">${svg('pause')}</button>
    <button type="button" class="cr-ic" data-ctl="mute" aria-pressed="false" aria-label="Mute microphone" title="Mute microphone">${svg('mic')}</button>
    <button type="button" class="cr-ic" data-ctl="share" aria-label="Change what I'm sharing" title="Change what I'm sharing">${svg('share')}</button>
    <button type="button" class="cr-ic" data-ctl="cam" aria-pressed="false" aria-label="Turn the camera off" title="Turn the camera off" hidden>${svg('cam')}</button>
    <button type="button" class="cr-ic" data-ctl="ask-restart" aria-label="Start over" title="Start over">${svg('restart')}</button>
    <button type="button" class="cr-ic cr-ic--x" data-ctl="ask-discard" aria-label="Discard recording" title="Discard">${svg('trash')}</button>
    ${float ? `<button type="button" class="cr-ic cr-ic--float" data-ctl="float" aria-label="Float the controls above other windows" title="Float above other windows" hidden>${svg('float')}</button>` : ''}
    <span class="cr-sub" data-sub role="status"></span>
  </span>
  <span class="cr-v cr-v--ask" data-v="ask"><span class="cr-askq" data-q></span><button type="button" class="cr-pill cr-pill--sm" data-ctl="yes" data-yes></button><button type="button" class="cr-pill cr-pill--sm is-ghost" data-ctl="no">Keep going</button></span>
  <span class="cr-v cr-v--saving" data-v="saving"><i class="cr-spinner" aria-hidden="true"></i><span>Saving</span><b class="cr-time" data-t2>0:00</b></span>
  <span class="cr-v cr-v--saved" data-v="saved"><span class="cr-okdot" aria-hidden="true">${svg('check')}</span><b>Clip saved</b><a class="cr-pill cr-pill--sm" data-ctl="open" data-open href="/clips/">Open</a><button type="button" class="cr-pill cr-pill--sm is-ghost" data-ctl="copy">${svg('link')}Copy link</button><button type="button" class="cr-ic" data-ctl="dismiss" aria-label="Close">${svg('close')}</button></span>`;
}

/**
 * Wire one controls element. `on(cmd, extra)` receives: stop, pause, resume, mute, restart, discard, float, skip, cancel,
 * open, copy, dismiss. Returns { update(state), saved(id), view() }.
 * state: { phase, elapsed, level, muted, hasMic, retrying, count, canFloat, cameraOnly }
 */
export function wireControls(host, on) {
  const $ = (sel) => host.querySelector(sel);
  let asking = '';
  let last = { phase: 'idle', elapsed: 0 };
  let savedId = '';

  const setView = (v) => {
    if (host.dataset.view === v) return;
    host.dataset.view = v;
    host.querySelectorAll('[data-v]').forEach((el) => (el.hidden = el.dataset.v !== v));
  };
  const viewOf = (st) => {
    if (savedId) return 'saved';
    if (st.phase === 'finishing' || st.phase === 'done') return 'saving';
    if (st.phase === 'countdown') return 'count';
    if (st.phase === 'recording' || st.phase === 'paused') return asking ? 'ask' : 'live';
    return 'wait';
  };

  host.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ctl]');
    if (!b || !host.contains(b)) return;
    const c = b.dataset.ctl;
    if (c === 'grip') return;
    if (c === 'ask-discard' || c === 'ask-restart') {
      asking = c.slice(4);
      const a = ASK[asking];
      $('[data-q]').textContent = a.q;
      const y = $('[data-yes]');
      y.textContent = a.yes;
      y.classList.toggle('is-red', a.red);
      setView('ask');
      y.focus();
      return;
    }
    if (c === 'yes') {
      const cmd = ASK[asking] ? ASK[asking].cmd : '';
      asking = '';
      if (cmd) on(cmd);
      return;
    }
    if (c === 'no') {
      asking = '';
      update(last);
      const back = $('[data-ctl=pause]');
      if (back) back.focus();
      return;
    }
    if (c === 'cam') return on(last.camOn === false ? 'camon' : 'camoff');
    if (c === 'pause') return on(last.phase === 'paused' ? 'resume' : 'pause');
    if (c === 'open') {
      ev.preventDefault();
      return on('open', savedId);
    }
    if (c === 'copy') return on('copy', savedId);
    on(c);
  });

  function update(st) {
    last = st;
    if (st.phase !== 'recording' && st.phase !== 'paused') asking = '';
    const paused = st.phase === 'paused';
    host.classList.toggle('is-paused', paused);
    setView(viewOf(st));
    const time = fmtTime(st.elapsed || 0);
    const t = $('[data-t]');
    if (t && t.textContent !== time) t.textContent = time;
    const t2 = $('[data-t2]');
    if (t2 && t2.textContent !== time) t2.textContent = time;
    const n = $('[data-n]');
    if (n && st.count && n.textContent !== String(st.count)) n.textContent = String(st.count);
    const w = $('[data-wait]');
    if (w) w.textContent = st.cameraOnly ? 'Starting the camera' : 'Waiting for the screen';
    const bars = $('[data-bars]');
    if (bars) {
      bars.hidden = st.hasMic === false;
      bars.querySelectorAll('[data-bar]').forEach((el) => el.classList.toggle('is-on', !st.muted && (st.level || 0) >= Number(el.dataset.bar) * 0.9));
    }
    const m = $('[data-ctl=mute]');
    if (m) {
      m.hidden = st.hasMic === false;
      if (m.getAttribute('aria-pressed') !== String(!!st.muted)) {
        m.setAttribute('aria-pressed', String(!!st.muted));
        m.setAttribute('aria-label', st.muted ? 'Unmute microphone' : 'Mute microphone');
        m.title = st.muted ? 'Unmute microphone' : 'Mute microphone';
        m.classList.toggle('is-on', !!st.muted);
        m.innerHTML = svg(st.muted ? 'micOff' : 'mic');
      }
    }
    const sh = $('[data-ctl=share]');
    if (sh) sh.hidden = !!st.cameraOnly;
    const cm = $('[data-ctl=cam]');
    if (cm) {
      cm.hidden = !st.hasCam;
      const off = st.camOn === false;
      if (cm.getAttribute('aria-pressed') !== String(off)) {
        cm.setAttribute('aria-pressed', String(off));
        cm.setAttribute('aria-label', off ? 'Turn the camera on' : 'Turn the camera off');
        cm.title = off ? 'Turn the camera on' : 'Turn the camera off';
        cm.classList.toggle('is-on', off);
        cm.innerHTML = svg(off ? 'camOff' : 'cam');
      }
    }
    const p = $('[data-ctl=pause]');
    if (p && p.dataset.paused !== String(paused)) {
      p.dataset.paused = String(paused);
      p.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      p.title = paused ? 'Resume' : 'Pause';
      p.innerHTML = svg(paused ? 'play' : 'pause');
    }
    const sub = $('[data-sub]');
    if (sub) {
      const txt = st.retrying ? 'Retrying' : paused ? 'Paused' : '';
      if (sub.textContent !== txt) sub.textContent = txt;
      sub.hidden = !txt;
    }
    const fl = $('[data-ctl=float]');
    if (fl) fl.hidden = !st.canFloat;
  }

  /** After Stop: the controls say the clip is saved and link to it. */
  function saved(id) {
    savedId = id;
    asking = '';
    const a = $('[data-open]');
    if (a) a.href = `/c/${id}`;
    setView('saved');
  }

  host.querySelectorAll('[data-v]').forEach((el) => (el.hidden = true));
  return { update, saved, view: () => host.dataset.view || '' };
}

/**
 * Keyboard shortcuts for a window that shows the controls: Alt+Shift+P pauses or resumes, Alt+Shift+S stops and saves.
 * A browser gives a page keys only while one of its windows has the focus, so each window that shows controls calls this.
 * `get()` returns the current phase; `on(cmd)` runs a command. Returns a function that removes the listener.
 */
export function wireShortcuts(doc, get, on) {
  const h = (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const k = (e.code || '').replace('Key', '');
    const phase = get();
    if (phase !== 'recording' && phase !== 'paused') return;
    if (k === 'P') {
      e.preventDefault();
      on(phase === 'paused' ? 'resume' : 'pause');
    } else if (k === 'S') {
      e.preventDefault();
      on('stop');
    }
  };
  doc.addEventListener('keydown', h, true);
  return () => doc.removeEventListener('keydown', h, true);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Let a fixed element be dragged anywhere in the page, by its body or its grip. The place is kept in localStorage as a
 * fraction of the viewport, so it comes back in the same spot on the next page. Returns { place(), destroy() }.
 */
export function makeDraggable(el, key) {
  const win = el.ownerDocument.defaultView;
  const M = 8;
  let pos = null;
  try {
    pos = JSON.parse(win.localStorage.getItem(key) || 'null');
  } catch (e) {
    pos = null;
  }
  const save = () => {
    try {
      win.localStorage.setItem(key, JSON.stringify(pos));
    } catch (e) {
      /* not remembered */
    }
  };
  const place = () => {
    if (!pos || typeof pos.x !== 'number') {
      el.classList.remove('is-placed');
      el.style.left = el.style.top = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    const x = clamp(pos.x * win.innerWidth - w / 2, M, Math.max(M, win.innerWidth - w - M));
    const y = clamp(pos.y * win.innerHeight - h / 2, M, Math.max(M, win.innerHeight - h - M));
    el.classList.add('is-placed');
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  };
  const setFromBox = (left, top) => {
    const r = el.getBoundingClientRect();
    const x = clamp(left, M, Math.max(M, win.innerWidth - r.width - M));
    const y = clamp(top, M, Math.max(M, win.innerHeight - r.height - M));
    pos = { x: (x + r.width / 2) / win.innerWidth, y: (y + r.height / 2) / win.innerHeight };
    place();
  };
  let drag = null;
  const down = (e) => {
    if (e.button) return;
    const onGrip = e.target.closest('[data-ctl=grip]');
    if (!onGrip && e.target.closest('button, a, input, select')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      const r = el.getBoundingClientRect();
      if (Math.abs(e.clientX - r.left - drag.dx) + Math.abs(e.clientY - r.top - drag.dy) < 4) return;
      drag.moved = true;
      el.classList.add('is-drag');
    }
    e.preventDefault();
    setFromBox(e.clientX - drag.dx, e.clientY - drag.dy);
  };
  const up = (e) => {
    if (!drag) return;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* already released */
    }
    if (drag.moved) save();
    drag = null;
    el.classList.remove('is-drag');
  };
  const key2 = (e) => {
    if (!e.target.closest || !e.target.closest('[data-ctl=grip]')) return;
    const step = e.shiftKey ? 48 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    setFromBox(r.left + d[0], r.top + d[1]);
    save();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', key2);
  win.addEventListener('resize', place);
  place();
  return {
    place,
    destroy() {
      win.removeEventListener('resize', place);
    },
  };
}
