/* The pre-join sheet for huddles and meetings. Opens over the page (a bottom sheet on a phone, a dialog on a desktop) with who is in
   the room now, a camera preview, a microphone level, microphone and camera toggles, device pickers and one Join button. Join saves
   the choices for the room page (sessionStorage meet.prejoin), which then goes straight in with them, and passes the page the person
   came from so Leave brings them back there.
   FavorPrejoin.open({
     title,                       sheet title
     load(): Promise<{ live, startedAt, people: [{ name, email, pid }] }>   polled every 4 seconds while open
     me: { email, pid? },         this person; their own earlier visit (same pid) is left out of the faces
     face(person): html,          optional avatar renderer
     emptyLine, joinLabel(state), labels for "nobody here" and the button
     join(): Promise<{ id, url }> start or find the room; the sheet then opens url
   }) */
(function () {
  'use strict';
  var KEY = 'meet.prejoin', PREF = 'favor.prejoin.pref';
  var ICON = {
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micOff: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>',
    cam: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    camOff: '<path d="M16 16v1a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1m4 0h5a1 1 0 0 1 1 1v3.5l5-3v9"/><path d="M3 3l18 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    head: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { return String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join('') || '?'; }
  function hue(n) { var h = 0; String(n || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return h % 6; }
  function face(p) { return '<span class="pj-av" data-h="' + hue(p.email || p.name) + '" title="' + esc(p.name) + '">' + esc(initials(p.name)) + '</span>'; }
  function dur(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
  function pref() { try { return Object.assign({ mic: true, cam: false, micId: '', camId: '' }, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (e) { return { mic: true, cam: false, micId: '', camId: '' }; } }

  var cur = null;

  function open(o) {
    if (cur) close();
    o.me = o.me || {};
    // A page that does not know the person's name reads it from the hub menu's saved copy.
    if (!o.me.name) { try { var nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (nv && nv.user) { o.me.name = nv.user.name || ''; o.me.email = o.me.email || String(nv.user.email || '').toLowerCase(); } } catch (e) { /* ignore */ } }
    var p = pref();
    var S = cur = { o: o, mic: p.mic, cam: p.cam, micId: p.micId, camId: p.camId, stream: null, state: null, timer: 0, tick: 0, meter: 0, actx: null, busy: false, devs: false, denied: '', prevFocus: document.activeElement, pushed: false };
    var wrap = document.createElement('div');
    wrap.className = 'pj';
    wrap.innerHTML = '<div class="pj-scrim" data-pj="close"></div>' +
      '<section class="pj-sheet" role="dialog" aria-modal="true" aria-labelledby="pj-title">' +
      '<div class="pj-grab" aria-hidden="true"></div>' +
      '<header class="pj-head"><span class="pj-kick">' + ic('head') + '</span><div class="pj-ht"><h2 id="pj-title">' + esc(o.title) + '</h2><p class="pj-status" id="pj-status" aria-live="polite">Checking who is here</p></div>' +
      '<button type="button" class="pj-x" data-pj="close" aria-label="Close">' + ic('x') + '</button></header>' +
      '<div class="pj-who" id="pj-who"></div>' +
      '<div class="pj-prev" id="pj-prev"><video id="pj-video" muted playsinline autoplay></video><span class="pj-me" id="pj-me"></span><span class="pj-camoff" id="pj-camoff">Camera off</span></div>' +
      '<div class="pj-lvl" aria-hidden="true"><span>' + ic('mic') + '</span><i><b id="pj-lvl"></b></i></div>' +
      '<p class="pj-note" id="pj-note" hidden></p>' +
      '<div class="pj-ctl"><button type="button" class="pj-tg" id="pj-mic" data-pj="mic"></button><button type="button" class="pj-tg" id="pj-cam" data-pj="cam"></button><button type="button" class="pj-tg pj-tg--dev" data-pj="devs" aria-expanded="false" aria-controls="pj-devs">' + ic('gear') + '<span>Devices</span></button></div>' +
      '<div class="pj-devs" id="pj-devs" hidden></div>' +
      '<div class="pj-acts"><button type="button" class="pj-cancel" data-pj="close">Cancel</button><button type="button" class="pj-go" id="pj-go" data-pj="join" disabled>Join</button></div>' +
      '</section>';
    document.body.appendChild(wrap);
    S.el = wrap;
    document.documentElement.classList.add('pj-open');
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('change', onChange);
    wrap.addEventListener('keydown', onKey);
    // Back on a phone closes the sheet instead of leaving the page.
    try { history.pushState({ pj: 1 }, ''); S.pushed = true; } catch (e) { /* ignore */ }
    window.addEventListener('popstate', onPop);
    paintToggles();
    paintMe();
    media();
    refresh();
    S.timer = setInterval(function () { if (!document.hidden) refresh(); }, 4000);
    S.tick = setInterval(paintStatus, 1000);
    setTimeout(function () { var g = document.getElementById('pj-go'); if (g) g.focus(); }, 60);
    return { close: close };
  }

  function close(keepHistory) {
    var S = cur; if (!S) return;
    cur = null;
    clearInterval(S.timer); clearInterval(S.tick); clearInterval(S.meter);
    stopMedia(S);
    window.removeEventListener('popstate', onPop);
    if (S.pushed && !keepHistory && history.state && history.state.pj) { try { history.back(); } catch (e) { /* ignore */ } }
    document.documentElement.classList.remove('pj-open');
    S.el.classList.remove('is-in');
    setTimeout(function () { S.el.remove(); }, 220);
    if (S.prevFocus && S.prevFocus.focus) try { S.prevFocus.focus(); } catch (e) { /* ignore */ }
  }
  function onPop() { if (cur) close(true); }
  function stopMedia(S) {
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    S.stream = null;
    if (S.actx) { try { S.actx.close(); } catch (e) { /* ignore */ } S.actx = null; }
  }

  function $(id) { return document.getElementById(id); }

  // The camera opens only while the camera toggle is on, so its light is off for a person joining with sound only.
  function media() {
    var S = cur; if (!S) return;
    clearInterval(S.meter);
    stopMedia(S);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { S.denied = 'This browser cannot use a microphone here. You can still join to listen.'; paintNote(); return; }
    var want = { audio: S.micId ? { deviceId: { ideal: S.micId } } : true, video: S.cam ? Object.assign({ width: 640, height: 360 }, S.camId ? { deviceId: { ideal: S.camId } } : {}) : false };
    var mine = S;
    navigator.mediaDevices.getUserMedia(want).catch(function (e) {
      if (want.video) { mine.cam = false; paintToggles(); return navigator.mediaDevices.getUserMedia({ audio: want.audio }).catch(function (e2) { throw e2; }); }
      throw e;
    }).then(function (st) {
      if (cur !== mine) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      mine.stream = st; mine.denied = '';
      var a = st.getAudioTracks()[0]; if (a) a.enabled = mine.mic;
      paintPreview(); meter(); paintNote();
      if (mine.devs) devices();
    }).catch(function (e) {
      if (cur !== mine) return;
      mine.denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'The browser blocked the microphone. Allow it from the lock icon in the address bar, or join to listen.' : 'No microphone found. You can still join to listen.';
      paintPreview(); paintNote();
    });
  }
  function meter() {
    var S = cur; if (!S || !S.stream) return;
    var tr = S.stream.getAudioTracks()[0]; if (!tr) return;
    var an, buf;
    try { var C = window.AudioContext || window.webkitAudioContext; S.actx = new C(); var src = S.actx.createMediaStreamSource(new MediaStream([tr])); an = S.actx.createAnalyser(); an.fftSize = 512; src.connect(an); buf = new Uint8Array(an.fftSize); } catch (e) { return; }
    S.meter = setInterval(function () {
      var el = $('pj-lvl'); if (!el || !cur) return;
      if (S.actx && S.actx.state === 'suspended') S.actx.resume().catch(function () {});
      an.getByteTimeDomainData(buf); var sum = 0; for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
      el.style.width = (S.mic ? Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400)) : 0) + '%';
    }, 100);
  }
  function devices() {
    var S = cur, box = $('pj-devs'); if (!S || !box) return;
    navigator.mediaDevices.enumerateDevices().then(function (all) {
      if (!cur) return;
      var mics = all.filter(function (d) { return d.kind === 'audioinput' && d.deviceId; }), cams = all.filter(function (d) { return d.kind === 'videoinput' && d.deviceId; });
      var curMic = S.stream && S.stream.getAudioTracks()[0] ? S.stream.getAudioTracks()[0].getSettings().deviceId : S.micId;
      var curCam = S.stream && S.stream.getVideoTracks()[0] ? S.stream.getVideoTracks()[0].getSettings().deviceId : S.camId;
      var opt = function (list, c, lab) { return list.map(function (d, i) { return '<option value="' + esc(d.deviceId) + '"' + (d.deviceId === c ? ' selected' : '') + '>' + esc(d.label || lab + ' ' + (i + 1)) + '</option>'; }).join(''); };
      box.innerHTML = (mics.length ? '<label>Microphone<select data-pj="micsel">' + opt(mics, curMic, 'Microphone') + '</select></label>' : '<p>No microphone found</p>') +
        (cams.length ? '<label>Camera<select data-pj="camsel">' + opt(cams, curCam, 'Camera') + '</select></label>' : '<p>No camera found</p>');
    }).catch(function () {});
  }

  function paintToggles() {
    var S = cur; if (!S) return;
    var m = $('pj-mic'), c = $('pj-cam'); if (!m) return;
    m.className = 'pj-tg' + (S.mic ? ' is-on' : ' is-off'); m.setAttribute('aria-pressed', String(S.mic));
    m.innerHTML = ic(S.mic ? 'mic' : 'micOff') + '<span>' + (S.mic ? 'Mic on' : 'Muted') + '</span>';
    c.className = 'pj-tg' + (S.cam ? ' is-on' : ' is-off'); c.setAttribute('aria-pressed', String(S.cam));
    c.innerHTML = ic(S.cam ? 'cam' : 'camOff') + '<span>' + (S.cam ? 'Camera on' : 'Camera off') + '</span>';
  }
  function paintMe() {
    var S = cur, el = $('pj-me'); if (!S || !el) return;
    var me = S.o.me || {};
    el.innerHTML = S.o.face ? S.o.face({ email: me.email, name: me.name }) : face({ email: me.email, name: me.name });
  }
  function paintPreview() {
    var S = cur; if (!S) return;
    var v = $('pj-video'), prev = $('pj-prev');
    var has = S.cam && S.stream && S.stream.getVideoTracks().length;
    prev.classList.toggle('has-video', !!has);
    if (has) { v.srcObject = S.stream; v.play().catch(function () {}); } else v.srcObject = null;
  }
  function paintNote() { var S = cur, n = $('pj-note'); if (!S || !n) return; n.hidden = !S.denied; n.textContent = S.denied; }

  function people() {
    var S = cur; if (!S || !S.state) return [];
    var me = S.o.me || {};
    // A page's own earlier visit (same pid, a reload) is not someone in the room.
    return (S.state.people || []).filter(function (p) { return !(me.pid && p.pid === me.pid); });
  }
  function paintStatus() {
    var S = cur; if (!S) return;
    var st = $('pj-status'), go = $('pj-go'); if (!st) return;
    if (!S.state) return;
    var list = people();
    if (S.state.live && list.length) st.innerHTML = '<span class="pj-live"><i></i>Live</span>' + (S.state.startedAt ? ' ' + dur(Date.now() - S.state.startedAt) : '') + ' · ' + list.length + (list.length === 1 ? ' person' : ' people');
    else st.textContent = S.o.emptyLine || 'Nobody is in the room';
    if (!S.busy) { go.disabled = false; go.innerHTML = esc(S.o.joinLabel ? S.o.joinLabel(S.state, list) : 'Join'); }
  }
  function paintWho() {
    var S = cur, el = $('pj-who'); if (!S || !el) return;
    var list = people(), me = (S.o.me || {}).email;
    if (!list.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    var shown = list.slice(0, 6);
    el.innerHTML = '<div class="pj-faces">' + shown.map(function (p) { return '<span class="pj-face">' + (S.o.face ? S.o.face(p) : face(p)) + '<small>' + esc(p.email && p.email === me ? 'You' : String(p.name || '').split(' ')[0]) + '</small></span>'; }).join('') +
      (list.length > shown.length ? '<span class="pj-face"><span class="pj-av" data-h="x">+' + (list.length - shown.length) + '</span><small>more</small></span>' : '') + '</div>';
  }
  function refresh() {
    var S = cur; if (!S) return;
    Promise.resolve(S.o.load()).then(function (st) {
      if (cur !== S) return;
      S.state = st || { live: false, people: [] };
      paintWho(); paintStatus();
    }).catch(function () {
      if (cur !== S) return;
      if (!S.state) { S.state = { live: false, people: [] }; paintWho(); paintStatus(); }
    });
  }

  function join() {
    var S = cur; if (!S || S.busy) return;
    S.busy = true;
    var go = $('pj-go'); go.disabled = true; go.innerHTML = '<span class="pj-spin" aria-hidden="true"></span>Joining';
    try { localStorage.setItem(PREF, JSON.stringify({ mic: S.mic, cam: S.cam, micId: S.micId, camId: S.camId })); } catch (e) { /* private mode */ }
    Promise.resolve(S.o.join()).then(function (r) {
      if (!r || !r.url) throw new Error('The room did not open. Try again.');
      try { sessionStorage.setItem(KEY, JSON.stringify({ mid: r.id, mic: S.mic, cam: S.cam, micId: S.micId, camId: S.camId, at: Date.now() })); } catch (e) { /* private mode */ }
      var back = location.pathname + location.search;
      var url = r.url + (r.url.indexOf('?') < 0 ? '?' : '&') + 'pj=1&back=' + encodeURIComponent(back);
      // Stop the preview first so the room page can open the same camera and microphone.
      stopMedia(S); clearInterval(S.meter);
      window.removeEventListener('popstate', onPop);
      // The sheet's history entry is replaced by the room, so Back from the room returns to this page.
      if (S.pushed && history.state && history.state.pj) location.replace(url); else location.href = url;
    }).catch(function (e) {
      S.busy = false; go.disabled = false; paintStatus();
      var n = $('pj-note'); if (n) { n.hidden = false; n.textContent = (e && e.message) || 'That did not work. Try again.'; }
    });
  }

  function onClick(e) {
    var t = e.target.closest('[data-pj]'); if (!t || !cur) return;
    var a = t.getAttribute('data-pj'), S = cur;
    if (a === 'close') close();
    else if (a === 'mic') { S.mic = !S.mic; var tr = S.stream && S.stream.getAudioTracks()[0]; if (tr) tr.enabled = S.mic; paintToggles(); }
    else if (a === 'cam') { S.cam = !S.cam; paintToggles(); media(); }
    else if (a === 'devs') { S.devs = !S.devs; t.setAttribute('aria-expanded', String(S.devs)); $('pj-devs').hidden = !S.devs; if (S.devs) devices(); }
    else if (a === 'join') join();
  }
  function onChange(e) {
    var S = cur, a = e.target.getAttribute('data-pj'); if (!S) return;
    if (a === 'micsel') { S.micId = e.target.value; media(); }
    else if (a === 'camsel') { S.camId = e.target.value; if (!S.cam) { S.cam = true; paintToggles(); } media(); }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab' || !cur) return;
    var f = Array.prototype.filter.call(cur.el.querySelectorAll('button:not([disabled]), select, [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  window.FavorPrejoin = { open: open, close: close, isOpen: function () { return !!cur; }, face: face, duration: dur };
})();
