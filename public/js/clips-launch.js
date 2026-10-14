// Loaded on every hub page. The camera button at the top right (shown by hub-shell.js) opens the recorder.
// The recorder lives in a small window of its own (/clips/rec/), so going to another hub page, reloading or switching
// tabs never touches a recording. Phones, and browsers that block the window, get the same card inside the page.
// While a recording runs, a small pill with the time and Pause, Mute, Start over, Stop and Discard shows on every hub page
// (clips/pill.js). It is not shown while the floating window is open (Chrome and Edge), which does the same job.
(function () {
  var btn = document.getElementById('clip-cam');
  var NAME = 'favor-clip-recorder';
  var LIVE_KEY = 'favor.clips.live';
  var ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('favor-clips') : null;
  if (!btn && !ch) return;
  var mod = null;
  var pillMod = null;
  function pill() {
    if (!pillMod) {
      pillMod = import('/js/clips/pill.js?v=2').then(function (m) {
        m.init(function (msg) { if (ch) ch.postMessage(msg); });
        return m;
      });
    }
    return pillMod;
  }
  function remember(m) {
    try {
      if (m) localStorage.setItem(LIVE_KEY, JSON.stringify({ at: Date.now(), m: m }));
      else localStorage.removeItem(LIVE_KEY);
    } catch (e) { /* the pill appears a moment later */ }
  }
  var rec = { phase: 'idle', id: '', at: 0 };
  // True once a recorder window has answered. Only then is the named window looked up (looking up a name that does not exist
  // would open a blank tab).
  var winAlive = false;

  function load() {
    if (!mod) mod = import('/js/clips/launcher.js?v=8');
    return mod;
  }
  function isPhone() {
    return matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1023px)').matches);
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'h-toast';
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2a2722;color:#fff;padding:10px 18px;border-radius:999px;font:500 14px Inter,system-ui,sans-serif;z-index:3000;max-width:calc(100vw - 24px)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }
  function recording() {
    return rec.phase === 'recording' || rec.phase === 'paused' || rec.phase === 'finishing';
  }
  function busy(phase) {
    return phase === 'preparing' || phase === 'countdown' || phase === 'recording' || phase === 'paused' || phase === 'finishing';
  }
  function paint() {
    if (!btn) return;
    var live = recording();
    btn.classList.toggle('is-rec', live);
    btn.setAttribute('aria-label', live ? 'Recording. Open the recorder window' : 'Record a clip');
    btn.title = live ? 'Recording in the recorder window' : 'Record a clip';
  }

  // The recorder window reports to every hub page in the browser, whatever page the person is on.
  if (ch) {
    ch.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.t === 'gone') {
        winAlive = false;
        remember(null);
        if (pillMod) pillMod.then(function (p) { p.show(null); });
        return;
      }
      if (m.t === 'state' || m.t === 'saved' || m.t === 'closed') winAlive = true;
      if (m.t === 'state') {
        rec = { phase: m.phase || 'idle', id: m.id || '', at: Date.now() };
        paint();
        if (busy(m.phase) && !m.pip) {
          remember(m);
          pill().then(function (p) { p.show(m); });
        } else {
          remember(null);
          if (pillMod) pillMod.then(function (p) { p.show(null); });
        }
      } else if (m.t === 'saved') {
        rec = { phase: 'idle', id: '', at: 0 };
        paint();
        remember(null);
        // The floating window already says so when it is open.
        if (!m.pip) pill().then(function (p) { p.saved(m.id); });
        window.dispatchEvent(new CustomEvent('clips:changed', { detail: { id: m.id } }));
      } else if (m.t === 'closed') {
        rec = { phase: 'idle', id: '', at: 0 };
        paint();
        remember(null);
        if (pillMod) pillMod.then(function (p) { p.show(null); });
        toast('The recorder window closed. The clip so far is saved in My clips.');
      }
    });
    // A page that loads in the middle of a recording shows the pill at once, from the last state another page heard.
    try {
      var kept = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null');
      if (kept && kept.m && Date.now() - kept.at < 4000 && busy(kept.m.phase)) pill().then(function (p) { p.show(kept.m, kept.at); });
    } catch (e) { /* the answer to the ping shows it */ }
    ch.postMessage({ t: 'ping' });
  }
  if (!btn) return;

  // A recorder window that stops reporting without saying goodbye (a crash) is finished here from what the server holds.
  setInterval(function () {
    if (!recording() || !rec.id || Date.now() - rec.at < 20000) return;
    var id = rec.id;
    rec = { phase: 'idle', id: '', at: 0 };
    paint();
    fetch('/api/clips/' + id + '/complete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"recover":true}' })
      .then(function (r) { if (r.ok) toast('A recording was cut off. The clip so far is in My clips.'); })
      .catch(function () {});
  }, 5000);

  function openWindow() {
    // An open recorder window is brought forward, never replaced.
    if (winAlive) {
      var existing = null;
      try { existing = window.open('', NAME); } catch (e) { existing = null; }
      if (existing) {
        try { existing.focus(); } catch (e) { /* the browser decides */ }
        if (ch) ch.postMessage({ t: 'open' });
        return true;
      }
    }
    // Links in the recorder window ("Open the clip", "My clips") come back to this tab.
    if (!window.name) window.name = 'favor-hub-main';
    var w = 440, h = Math.min(720, Math.max(520, (screen.availHeight || 800) - 90));
    var left = Math.max(0, Math.round(window.screenX + window.outerWidth - w - 40));
    var top = Math.max(0, Math.round(window.screenY + 80));
    var win = window.open('/clips/rec/', NAME, 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    if (!win) return false;
    winAlive = true;
    try { win.focus(); } catch (e) { /* the browser decides */ }
    return true;
  }

  function go() {
    if (!openWindow()) {
      toast('Your browser blocked the recorder window. Allow pop-ups for this site, or record here and keep this tab open.');
      load().then(function (m) { m.openLauncher(btn); });
    }
  }
  btn.addEventListener('click', function () {
    if (isPhone() || typeof BroadcastChannel === 'undefined') {
      load().then(function (m) { m.openLauncher(btn); });
      return;
    }
    // Ask once more whether a recorder window is open (a page that just loaded may not have heard yet).
    if (!winAlive && ch) {
      ch.postMessage({ t: 'ping' });
      setTimeout(go, 180);
    } else go();
  });

  // A recording whose window closed is finished the next time anyone opens a hub page (quiet for 90 seconds).
  var checked = false;
  function whenShown() {
    if (checked || btn.hidden) return;
    checked = true;
    // Looked at most once every ten minutes per browser, so moving between pages does not load the recorder code each time.
    try {
      var last = Number(localStorage.getItem('favor.clips.unfinished.at') || 0);
      if (Date.now() - last < 600000) return;
      localStorage.setItem('favor.clips.unfinished.at', String(Date.now()));
    } catch (e) { /* storage refused; check as before */ }
    setTimeout(function () { load().then(function (m) { m.resumeUnfinished(); }); }, 4000);
  }
  new MutationObserver(whenShown).observe(btn, { attributes: true, attributeFilter: ['hidden'] });
  whenShown();
})();
