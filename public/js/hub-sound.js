/* FavorOS sounds (2026-10-14). One family of short, quiet sounds rendered from code (scripts/sounds/recipes.mjs, render.mjs) into
   /sounds/<name>.mp3, each under 8 KB. Framework-free: the classic pages and the React app both call window.hubSound.

   hubSound.play('message')                 plays if the person's setting allows it
   hubSound.play('mention', { key: id })    the same key within 3 s plays once across every open tab
   hubSound.play('ring', { preview: true }) a preview in Settings: plays whatever the setting and quiet hours say
   hubSound.level() / setLevel('on' | 'subtle' | 'off')    hubSound.volume() / setVolume(0..1)

   Levels:
   - On: everything below.
   - Subtle (the default): what reaches you and what you finish (calls, mentions, direct messages, notices, meetings, recording,
     sent, done, errors), at 70% of the volume. No presses, switches or dismiss sounds.
   - Off: nothing. A ringing call still shows its card and vibrates a phone.
   Quiet hours (the bell's Settings) silence the sounds that arrive from other people: message, mention, notify, ring.
   On an iPhone the sounds follow the ring/silent switch and never stop music (navigator.audioSession 'ambient').
   Nothing plays before the first tap or key on the page (browsers block it), and a tab in the background stays silent when the
   computer is already showing a notification with its own sound. */
(function () {
  if (window.hubSound) return;
  var NAMES = ['tap', 'toggle', 'dismiss', 'sent', 'done', 'error', 'message', 'mention', 'notify', 'ring', 'join', 'leave', 'knock', 'rec-start', 'rec-stop'];
  var ON_ONLY = { tap: 1, toggle: 1, dismiss: 1 };
  var FROM_OTHERS = { message: 1, mention: 1, notify: 1, ring: 1 };
  var LABELS = {
    ring: 'A call or huddle', mention: 'Someone mentions you', message: 'A direct message', notify: 'A new notice in the bell',
    join: 'Someone joins your meeting', leave: 'Someone leaves your meeting', knock: 'Someone is waiting to be let in',
    'rec-start': 'Recording starts', 'rec-stop': 'Recording stops', sent: 'Your message is sent', done: 'A task or step is done',
    error: 'Something did not work', tap: 'Pressing a main button', toggle: 'Flipping a switch', dismiss: 'Closing or clearing'
  };
  var KEY = 'favor.hub.sound.v2', KEY_OLD = 'favor.hub.sound', KEY_VOL = 'favor.hub.sound.vol', KEY_LAST = 'favor.hub.sound.last';
  var build = (document.querySelector('meta[name="hub-build"]') || {}).content || '1';
  var ctx = null, master = null, bytes = {}, bufs = {}, loading = null, lastAt = {};

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function level() {
    var v = store(KEY);
    if (v === 'on' || v === 'subtle' || v === 'off') return v;
    return store(KEY_OLD) === 'off' ? 'off' : 'subtle';
  }
  function volume() { var v = parseFloat(store(KEY_VOL)); return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7; }
  function emit() { try { document.dispatchEvent(new CustomEvent('hub:sound', { detail: { level: level(), volume: volume() } })); } catch (e) { /* old browser */ } }
  function setLevel(v) {
    if (v !== 'on' && v !== 'subtle' && v !== 'off') return;
    store(KEY, v);
    // Older pages read the first key as on or off (the account menu switch, the Brain menu).
    store(KEY_OLD, v === 'off' ? 'off' : 'on');
    emit();
  }
  function setVolume(v) { store(KEY_VOL, String(Math.max(0, Math.min(1, Number(v) || 0)))); emit(); }

  // Quiet hours, read from /api/hub/quiet at most every ten minutes and worked out here on each sound.
  var Q = null, qAt = 0;
  try { var qs = JSON.parse(sessionStorage.getItem('favor.hub.quiet') || 'null'); if (qs) { Q = qs.q; qAt = qs.at; } } catch (e) { /* none */ }
  function readQuiet() {
    if (Date.now() - qAt < 600000 || !document.querySelector('.h-body')) return;
    qAt = Date.now();
    fetch('/api/hub/quiet', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.ok) return;
      Q = { on: !!d.on, start: d.start, end: d.end, weekends: !!d.weekends, tz: d.tz };
      try { sessionStorage.setItem('favor.hub.quiet', JSON.stringify({ q: Q, at: qAt })); } catch (e) { /* full */ }
    }).catch(function () { /* stays as it was */ });
  }
  function quietNow() {
    if (!Q || !Q.on) return false;
    var min, dow;
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: Q.tz || 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date());
      var get = function (t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value; return ''; };
      min = Number(get('hour')) * 60 + Number(get('minute'));
      dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    } catch (e) { return false; }
    if (Q.weekends && (dow === 0 || dow === 6)) return true;
    if (Q.start === Q.end) return false;
    return Q.start > Q.end ? min >= Q.start || min < Q.end : min >= Q.start && min < Q.end;
  }

  function fetchAll() {
    if (loading) return loading;
    loading = Promise.all(NAMES.map(function (n) {
      return fetch('/sounds/' + n + '.mp3?b=' + build).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (b) { if (b) bytes[n] = b; }).catch(function () { /* that one stays silent */ });
    }));
    return loading;
  }
  function context() {
    if (ctx) return ctx;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    // Follow the iPhone's silent switch and mix with music instead of pausing it (Safari 16.4+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* not offered */ }
    try { ctx = new C({ latencyHint: 'interactive' }); } catch (e) { return null; }
    master = ctx.createGain(); master.connect(ctx.destination);
    return ctx;
  }
  function decode(n) {
    if (bufs[n]) return Promise.resolve(bufs[n]);
    if (!bytes[n] || !context()) return Promise.resolve(null);
    var copy = bytes[n].slice(0);
    return new Promise(function (ok) {
      try { ctx.decodeAudioData(copy, function (b) { bufs[n] = b; ok(b); }, function () { ok(null); }); } catch (e) { ok(null); }
    });
  }
  function warm() {
    // The first press on the page: make the audio context (browsers allow it now) and get every sound ready.
    if (!context()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    fetchAll().then(function () { NAMES.forEach(decode); });
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { addEventListener(t, warm, { capture: true, passive: true, once: true }); });
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 2500); };
  addEventListener('load', function () { idle(function () { fetchAll(); readQuiet(); }); });

  function claimed(key) {
    // One tab plays a sound that every open tab hears about (a message, a ring).
    if (!key) return false;
    var now = Date.now(), last = null;
    try { last = JSON.parse(store(KEY_LAST) || 'null'); } catch (e) { last = null; }
    if (last && last.k === key && now - last.at < 3000) return true;
    store(KEY_LAST, JSON.stringify({ k: key, at: now }));
    return false;
  }

  function allowed(name, o) {
    if (o.preview) return true;
    var lv = level();
    if (lv === 'off') return false;
    if (lv === 'subtle' && ON_ONLY[name]) return false;
    if (FROM_OTHERS[name]) {
      readQuiet();
      if (quietNow()) return false;
      if (document.hidden && o.notified) return false;
    }
    return true;
  }

  function play(name, opts) {
    var o = opts || {};
    if (NAMES.indexOf(name) < 0 || !allowed(name, o)) return false;
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return false;
    var now = performance.now();
    if (lastAt[name] && now - lastAt[name] < 90) return false;
    if (claimed(o.key)) return false;
    lastAt[name] = now;
    if (!context()) return false;
    var asked = now;
    var go = function (buf) {
      // A sound that took longer than half a second to get ready is no longer about what just happened.
      if (!buf || performance.now() - asked > 500) return;
      var src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = volume() * (level() === 'subtle' && !o.preview ? 0.7 : 1) * (o.gain || 1);
      src.buffer = buf; src.connect(g); g.connect(master); src.start();
    };
    var start = function () { if (bufs[name]) go(bufs[name]); else fetchAll().then(function () { return decode(name); }).then(go); };
    if (ctx.state === 'running') start();
    else ctx.resume().then(start, function () {});
    return true;
  }

  /* ------------------------------------------------------------ the Sounds sheet (opened from the bell's Settings and the account menu) */
  var ICON_PLAY = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5.5v9l7.5-4.5z"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function openSettings() {
    var d = document.getElementById('hs-dlg');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'hs-dlg'; d.className = 'hs-dlg'; d.setAttribute('aria-labelledby', 'hs-h');
      d.setAttribute('data-sheet-drag', '');
      document.body.appendChild(d);
      d.addEventListener('click', function (e) {
        var t = e.target;
        if (t === d || (t.closest && t.closest('[data-hs-close]'))) { d.close(); return; }
        var lv = t.closest && t.closest('[data-hs-level]');
        if (lv) { setLevel(lv.getAttribute('data-hs-level')); paint(d); if (lv.getAttribute('data-hs-level') !== 'off') play('notify', { preview: true }); return; }
        var p = t.closest && t.closest('[data-hs-play]');
        if (p) { warm(); play(p.getAttribute('data-hs-play'), { preview: true }); }
      });
      d.addEventListener('input', function (e) {
        if (e.target.matches('[data-hs-vol]')) { setVolume(e.target.value / 100); var o = d.querySelector('[data-hs-volout]'); if (o) o.textContent = Math.round(volume() * 100) + '%'; }
        if (e.target.matches('[data-hs-buzz]') && window.hubHaptic) { window.hubHaptic.setOn(e.target.checked); if (e.target.checked) window.hubHaptic('success'); }
      });
      d.addEventListener('change', function (e) { if (e.target.matches('[data-hs-vol]')) play('notify', { preview: true }); });
    }
    paint(d);
    warm();
    if (!d.open) d.showModal();
  }
  function paint(d) {
    var lv = level(), seg = function (v, l, sub) { return '<button type="button" class="hs-seg__b' + (lv === v ? ' is-on' : '') + '" data-hs-level="' + v + '" aria-pressed="' + (lv === v) + '"><b>' + l + '</b><small>' + sub + '</small></button>'; };
    var row = function (n) {
      var off = lv === 'off' || (lv === 'subtle' && ON_ONLY[n]);
      return '<li class="hs-row' + (off ? ' is-off' : '') + '"><button type="button" class="hs-play" data-hs-play="' + n + '" aria-label="Play: ' + esc(LABELS[n]) + '">' + ICON_PLAY + '</button><span>' + esc(LABELS[n]) + '</span>' + (FROM_OTHERS[n] ? '<small>Quiet hours mute it</small>' : ON_ONLY[n] ? '<small>On only</small>' : '') + '</li>';
    };
    var buzz = window.hubHaptic && window.hubHaptic.supported() ? '<label class="hs-buzz"><input type="checkbox" class="wm-switch" data-hs-buzz ' + (window.hubHaptic.on() ? 'checked' : '') + ' /> <span><b>Vibration</b><small>A light tap on this phone when you finish, flick or hold something</small></span></label>' : '';
    d.innerHTML = '<div class="hs-in"><header class="hs-head"><h2 id="hs-h">Sounds</h2><button type="button" class="hs-x" data-hs-close data-sheet-close aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></header>' +
      '<div class="hs-seg" role="group" aria-label="Sounds">' + seg('on', 'On', 'Every sound') + seg('subtle', 'Subtle', 'Calls, mentions, done') + seg('off', 'Off', 'No sounds') + '</div>' +
      '<label class="hs-vol"><span>Volume</span><input type="range" min="0" max="100" step="5" value="' + Math.round(volume() * 100) + '" data-hs-vol aria-label="Volume" /><output data-hs-volout>' + Math.round(volume() * 100) + '%</output></label>' + buzz +
      '<h3 class="hs-sub">Listen</h3><ul class="hs-list">' + NAMES.slice().sort(function (a, b) { return order(a) - order(b); }).map(row).join('') + '</ul>' +
      '<p class="hs-note">On an iPhone, the ring/silent switch mutes these sounds too.</p></div>';
  }
  var ORDER = ['ring', 'mention', 'message', 'notify', 'join', 'leave', 'knock', 'rec-start', 'rec-stop', 'sent', 'done', 'error', 'tap', 'toggle', 'dismiss'];
  function order(n) { return ORDER.indexOf(n); }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-hs-open]');
    if (b) { e.preventDefault(); openSettings(); }
  });

  // A task checked off anywhere (Projects rows and cards, the calendar's agenda, anything marked data-done-sound) plays done.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[role="checkbox"][data-act="done"], [data-done-sound]');
    if (t && t.getAttribute('aria-checked') !== 'true') play('done');
  }, true);

  window.hubSound = { ready: function () { return Object.keys(bufs).length; }, play: play, level: level, setLevel: setLevel, volume: volume, setVolume: setVolume, names: NAMES.slice(), labels: LABELS, open: openSettings, quietNow: quietNow };
})();
