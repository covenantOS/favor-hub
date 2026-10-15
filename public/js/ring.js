/* Huddle rings (Will, 2026-10-14). Loaded on every FavorOS page for people who have Chat.
   - FavorRing.call({ to: [email] })   rings one person or several (a group huddle) and opens the room straight away.
     FavorRing.call({ channel: id })   rings the people of a direct message or a group.
   - When someone rings this person, every open tab shows the ringing card with a sound (one tab plays it), Join and Decline, and
     Decline with a quick message. Join or Decline on one tab or device stops the others (server event ring_end).
   Events come from the live chat socket: the dock's on desktop pages, Chat's own on the Chat page, and a socket of its own on a
   phone and in a meeting room, where the dock is off. A ring that started before the page opened is read from GET /api/chat/ring.
   A closed browser or a locked phone gets the web push instead (public/sw.js shows Join and Decline on the notice). */
(function () {
  'use strict';
  if (window.FavorRing) return;
  var root = document.documentElement;
  var shown = {}, over = {}, wrap = null, ws = null, wsT = 0, retry = 0, pingT = 0, attached = false, tab = Math.random().toString(36).slice(2);

  var CSS = '' +
    '.fr-wrap{position:fixed;z-index:2147483100;top:calc(env(safe-area-inset-top,0px) + 12px);right:16px;display:grid;gap:10px;width:min(380px,calc(100vw - 24px));pointer-events:none}' +
    '@media (max-width:860px){.fr-wrap{left:12px;right:12px;width:auto}}' +
    '.fr{pointer-events:auto;background:#1f241d;color:#f4efe0;border-radius:20px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);font:400 14px/1.4 var(--h-font,system-ui,sans-serif);opacity:0;transform:translateY(-8px) scale(.98);transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1)}' +
    '.fr.is-in{opacity:1;transform:none}' +
    '@media (prefers-reduced-motion:reduce){.fr{transition:opacity .12s}.fr{transform:none}}' +
    '.fr-top{display:flex;gap:12px;align-items:center}' +
    '.fr-av{position:relative;flex:none;width:46px;height:46px;border-radius:50%;background:#3b4a35;display:grid;place-items:center;font-weight:600}' +
    '.fr-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}' +
    '.fr-av i{position:absolute;inset:-4px;border-radius:50%;border:2px solid #6fbf87;animation:fr-p 1.6s ease-out infinite}' +
    '@keyframes fr-p{0%{opacity:.9;transform:scale(.92)}100%{opacity:0;transform:scale(1.25)}}' +
    '@media (prefers-reduced-motion:reduce){.fr-av i{animation:none}}' +
    '.fr-t{min-width:0;display:grid}.fr-t b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fr-t span{color:#c9c4b4;font-size:13px}' +
    '.fr-acts{display:flex;gap:8px;margin-top:12px}' +
    '.fr-acts button{flex:1;min-height:44px;border-radius:999px;border:0;font:600 14px var(--h-font,system-ui,sans-serif);cursor:pointer}' +
    '.fr-no{background:#a8573a;color:#fff}.fr-more{background:rgba(255,255,255,.12);color:#f4efe0}.fr-yes{background:#3f8f5a;color:#fff}' +
    '.fr-acts button:focus-visible,.fr-chips button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '.fr-msg{margin-top:10px;display:grid;gap:8px}.fr-chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.fr-chips button{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#f4efe0;font:400 13px var(--h-font,system-ui,sans-serif);cursor:pointer}' +
    '.fr-msg input{min-height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;padding:0 12px;font:400 14px var(--h-font,system-ui,sans-serif)}';
  function styles() { if (document.getElementById('fr-css')) return; var st = document.createElement('style'); st.id = 'fr-css'; st.textContent = CSS; document.head.appendChild(st); }
  var QUICK = ["Can't talk right now.", "I'll call you back in a few minutes.", "In a meeting. I'll call you after."];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function toast(t) { if (window.FavorUI && window.FavorUI.toast) window.FavorUI.toast(t); else console.warn(t); }
  function req(method, path, body) {
    return fetch('/api/chat/' + path, { method: method, credentials: 'same-origin', keepalive: method === 'POST', headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = r.status; throw e; } return d; }); });
  }
  function hasChat() { return root.classList.contains('has-chat'); }
  function inRoom() { return /^\/meet\/(room|g)\//.test(location.pathname); }

  /* ------------------------------------------------------------ calling someone */
  // Opens the room at once with the microphone on and the camera off, the way a call starts. The room page skips its lobby.
  function go(mid, url) {
    try { sessionStorage.setItem('meet.prejoin', JSON.stringify({ mid: mid, at: Date.now(), mic: true, cam: false })); } catch (e) { /* private mode: the lobby shows */ }
    var back = location.pathname + location.search;
    location.href = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'pj=1' + (inRoom() ? '' : '&back=' + encodeURIComponent(back));
  }
  var calling = false;
  function call(opts) {
    if (calling) return Promise.resolve(null);
    calling = true;
    return req('POST', 'ring', opts || {}).then(function (d) {
      calling = false;
      var rung = (d.rings || []).filter(function (r) { return r.state === 'ringing'; }).length;
      var quiet = (d.rings || []).filter(function (r) { return r.why === 'quiet'; });
      if (quiet.length && !rung) toast(quiet.map(function (r) { return r.name.split(' ')[0]; }).join(', ') + (quiet.length > 1 ? ' are' : ' is') + ' in quiet hours, so nothing rang. FavorOS left a missed huddle note.');
      go(d.id, d.url);
      return d;
    }).catch(function (e) { calling = false; toast(e.message); return null; });
  }

  /* ------------------------------------------------------------ being rung */
  function host() {
    if (wrap && wrap.isConnected) return wrap;
    styles();
    wrap = document.createElement('div'); wrap.className = 'fr-wrap'; wrap.setAttribute('aria-live', 'assertive');
    document.body.appendChild(wrap);
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('.fr-msg input')) { e.preventDefault(); var c = e.target.closest('.fr'); decline(c.dataset.id, e.target.value); }
    });
    return wrap;
  }
  function show(r) {
    if (!r || !r.id || over[r.id] || shown[r.id] || !(r.left > 800)) return;
    var others = (r.with || []).length ? 'Huddle with you, ' + r.with.map(esc).join(', ') : 'Huddle';
    var el = document.createElement('div');
    el.className = 'fr'; el.dataset.id = r.id; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', r.fromName + ' is calling');
    el.innerHTML = '<div class="fr-top"><span class="fr-av">' + (r.picture ? '<img src="' + esc(r.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(r.fromName))) + '<i></i></span>' +
      '<div class="fr-t"><b>' + esc(r.fromName) + '</b><span>' + others + '</span></div></div>' +
      '<div class="fr-acts"><button type="button" class="fr-no" data-fr="decline">Decline</button><button type="button" class="fr-more" data-fr="more" aria-expanded="false">Message</button><button type="button" class="fr-yes" data-fr="join">Join</button></div>' +
      '<div class="fr-msg" hidden><div class="fr-chips">' + QUICK.map(function (q) { return '<button type="button" data-fr="say" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div><input type="text" maxlength="300" placeholder="Or write a reply, then press Enter" aria-label="Reply and decline" /></div>';
    host().appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    var st = { el: el, r: r, until: Date.now() + r.left };
    shown[r.id] = st;
    st.end = setTimeout(function () { req('POST', 'ring/' + r.id, { action: 'timeout' }).catch(function () {}); end(r.id, 'missed'); }, r.left + 400);
    ringSound(st);
    var j = el.querySelector('.fr-yes'); if (j && !document.querySelector('.fr .fr-msg:not([hidden])')) j.focus({ preventScroll: true });
  }
  function end(id, state) {
    over[id] = state || 'over';
    var st = shown[id]; if (!st) return;
    delete shown[id];
    clearTimeout(st.end); clearTimeout(st.snd);
    st.el.classList.remove('is-in');
    setTimeout(function () { st.el.remove(); }, 200);
  }
  function join(id) {
    var st = shown[id]; if (!st) return;
    var r = st.r; end(id, 'joined');
    req('POST', 'ring/' + id, { action: 'join' }).catch(function () {});
    go(r.mid, r.url);
  }
  function decline(id, note) {
    note = String(note || '').trim();
    end(id, 'declined');
    req('POST', 'ring/' + id, { action: 'decline', note: note }).then(function () { if (note) toast('Sent: ' + note); }).catch(function (e) { toast(e.message); });
  }
  function onClick(e) {
    var b = e.target.closest('[data-fr]'); if (!b) return;
    var c = b.closest('.fr'); var id = c && c.dataset.id; if (!id) return;
    var a = b.dataset.fr;
    if (a === 'join') join(id);
    else if (a === 'decline') decline(id, '');
    else if (a === 'say') decline(id, b.dataset.v);
    else if (a === 'more') { var m = c.querySelector('.fr-msg'); m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) { var st = shown[id]; if (st) clearTimeout(st.snd); var i = m.querySelector('input'); if (i) i.focus(); } }
  }

  /* ------------------------------------------------------------ the sound: two soft notes every 2.4 seconds, from one tab only */
  var actx = null;
  function claim(id) {
    var k = 'favor.ring.snd.' + id, now = Date.now(), v = null;
    try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { v = null; }
    if (v && v.tab !== tab && now - v.at < 3200) return false;
    try { localStorage.setItem(k, JSON.stringify({ tab: tab, at: now })); } catch (e) { /* full */ }
    return true;
  }
  function tone(at, f, len) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.18, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + len + 0.05);
  }
  function ringSound(st) {
    if (!shown[st.r.id]) return;
    var msgOpen = st.el.querySelector('.fr-msg:not([hidden])');
    if (!msgOpen && claim(st.r.id)) {
      // The family's ring (hub-sound.js) follows the person's Sounds setting; the two plain notes below are for a page without it.
      if (window.hubSound) window.hubSound.play('ring');
      else try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume().catch(function () {});
        var t = actx.currentTime + 0.02;
        tone(t, 784, 0.35); tone(t + 0.42, 1046.5, 0.5);
      } catch (e) { /* no sound on this page: the card still shows */ }
      if (window.hubHaptic) window.hubHaptic('ring'); else if (navigator.vibrate && matchMedia('(max-width: 860px)').matches) { try { navigator.vibrate([250, 150, 250]); } catch (e) { /* no vibration */ } }
    }
    st.snd = setTimeout(function () { ringSound(st); }, 2400);
  }

  /* ------------------------------------------------------------ where the events come from */
  function onEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'ring' && ev.ring) show(ev.ring);
    else if (ev.type === 'ring_end') end(ev.id, ev.state);
    else if (ev.type === 'resync' || (ev.type === 'conn' && ev.ok)) pending();
  }
  function pending() {
    if (!hasChat()) return;
    req('GET', 'ring').then(function (d) { (d.rings || []).forEach(show); }).catch(function () {});
  }
  // The dock keeps a socket on desktop pages other than Chat and the meeting room; Chat keeps its own; elsewhere this file opens one.
  function needOwn() {
    if (document.getElementById('chat-root')) return false;
    if (inRoom()) return true;
    return matchMedia('(max-width: 860px)').matches || !document.getElementById('h-app') || !window.FavorDock;
  }
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (document.hidden || !needOwn() || !hasChat()) return;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws'); } catch (e) { return; }
    ws.onopen = function () { retry = 0; clearInterval(pingT); pingT = setInterval(function () { if (ws && ws.readyState === 1) ws.send('ping'); }, 30000); pending(); };
    ws.onmessage = function (e) { if (e.data === 'pong') return; try { onEvent(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
    ws.onclose = function () { clearInterval(pingT); ws = null; if (document.hidden) return; retry = Math.min(retry + 1, 6); clearTimeout(wsT); wsT = setTimeout(connect, Math.min(30000, 600 * Math.pow(2, retry))); };
    ws.onerror = function () { /* onclose follows */ };
  }
  function hang() { clearTimeout(wsT); clearInterval(pingT); if (ws) { var w = ws; ws = null; try { w.close(); } catch (e) { /* gone */ } } }
  function attach() {
    if (!hasChat()) return;
    if (!attached) {
      attached = true;
      if (window.FavorDock && window.FavorDock.on) window.FavorDock.on(onEvent);
      var tries = 0;
      (function chat() { if (window.FavorChatLive) window.FavorChatLive.on(onEvent); else if (document.getElementById('chat-root') && tries++ < 30) setTimeout(chat, 200); })();
      pending();
      // Opened from the ringing notice on a phone (?ring= on the room address): answering is the tap itself.
      var q = new URLSearchParams(location.search).get('ring');
      if (q && /^[0-9a-f]{24}$/.test(q)) { over[q] = 'joined'; req('POST', 'ring/' + q, { action: 'join' }).catch(function () {}); }
    }
    if (needOwn()) connect(); else hang();
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (/iPhone|iPad|Android/.test(navigator.userAgent)) hang(); } else { attach(); pending(); } });
  document.addEventListener('hub-swapped', attach);
  addEventListener('online', function () { retry = 0; attach(); });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { var d = e.data && e.data.data; if (e.data && e.data.type === 'push' && d && d.ring && !d.ringEnd) pending(); });
  new MutationObserver(function () { if (hasChat()) attach(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();

  window.FavorRing = { call: call, onEvent: onEvent };
})();
