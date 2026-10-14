/* Lite mode: FavorOS on an old phone or a weak, costly connection. Inlined in the head of every hub page by src/layouts/App.astro,
   right after hub-own.js, so it decides before any other script runs. The same setting as the phone app's Data saver
   (localStorage favor.lowdata: 'auto', 'on' or 'off'; phone-core.js and meet/prejoin.js read it too).
   When Lite is on:
     timers      hub-own.js asks liteIv() for every repeating timer: polls of 15 seconds or more run three to four times less often.
     read-ahead  no speculative page loads and no warming of the phone bar's pages (hub-swap.js checks FavorLite.on).
     fonts       fonts already on the phone, so the three web fonts (about 120 KB) are never fetched.
     files       the service worker keeps versioned scripts and styles and answers from its copy (sw.js, the lite flag below).
     pictures    chat photos and link pictures wait for a tap; photos shrink to about 150 KB before they upload.
     chat        every message goes through the phone's outbox (phone-core.js), so a message written without signal is sent later.
     meetings    the room opens as an audio call (meet/room.js reads FavorLite.on); video is a tap away.
   The data meter runs for everyone: what this browser downloaded for FavorOS pages, files and meetings, by day and by month. */
(function () {
  if (window.FavorLite) return;
  var KEY = 'favor.lowdata', USE = 'favor.lite.usage', CAP = 'favor.lite.cap', RTT = 'favor.lite.rtt';
  var ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }
  function get(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function put(k, v) { try { if (ls) ls.setItem(k, v); } catch (e) { /* private mode or full */ } }

  function setting() { var v = get(KEY); return v === 'on' || v === 'off' ? v : 'auto'; }

  /** Why this phone counts as a weak one. Empty when nothing points that way. */
  function reasons() {
    var out = [], n = navigator, c = n.connection || n.mozConnection || n.webkitConnection;
    if (c) {
      if (c.saveData) out.push('the phone has Data Saver on');
      if (/^(slow-2g|2g|3g)$/.test(String(c.effectiveType || ''))) out.push('the connection is ' + String(c.effectiveType).toUpperCase());
      else if (c.rtt >= 700) out.push('the connection is slow');
    }
    if (n.deviceMemory && n.deviceMemory <= 1) out.push('the phone has little memory');
    if (n.hardwareConcurrency && n.hardwareConcurrency <= 2 && n.deviceMemory && n.deviceMemory <= 2) out.push('the phone is an older model');
    var r = Number(get(RTT));
    if (r >= 900) out.push('pages took long to answer');
    return out;
  }

  var mode = setting(), why = mode === 'auto' ? reasons() : [];
  var on = mode === 'on' || (mode === 'auto' && why.length > 0);
  var html = document.documentElement;
  if (on) html.classList.add('is-lite');
  // The phone's own fonts: in Lite, Inter and Playfair Display point at fonts already on the phone, so no web font is fetched.
  // These rules must come after the site's own @font-face rules (the last matching one wins), so the style moves to the end of
  // the head before the page is drawn. The frame a held-back picture shows is here too.
  var css = document.createElement('style');
  if (on) {
    var face = function (fam, src, w, st) { return '@font-face{font-family:"' + fam + '";src:' + src + ';font-weight:' + w + ';font-style:' + (st || 'normal') + '}'; };
    var sans = 'local("Roboto"),local("Segoe UI"),local("Helvetica Neue"),local("Arial")', serif = 'local("Noto Serif"),local("Georgia"),local("Times New Roman")';
    css.textContent = face('Inter', sans, '100 900') + face('Inter', sans, '100 900', 'italic') +
      ['400 500', '400', '500', '600', '700 900'].map(function (w) { return face('Playfair Display', serif, w); }).join('') + face('Playfair Display', serif, '400', 'italic');
  }
  css.textContent += '[data-lite-box]{position:relative;min-height:72px;min-width:160px;background:#ece4cf!important;border-radius:12px}' +
    '[data-lite-box] img{visibility:hidden}' +
    '[data-lite-box]::after{content:attr(data-lite-box);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;font:600 13px/1.3 system-ui,sans-serif;color:#4a4232}';
  document.head.appendChild(css);
  // App.astro calls this first thing in <body>, when every stylesheet link of the head is in place and nothing is drawn yet.
  function fontsLast() { if (on) document.head.appendChild(css); }
  if (on) document.addEventListener('DOMContentLoaded', fontsLast);

  /* ---------------------------------------------------------------- timers (hub-own.js calls this) */
  window.__liteIv = on ? function (t) {
    t = Number(t) || 0;
    if (t < 15000) return t;
    // A socket keep-alive of 30 seconds becomes 55 (phone networks drop a quiet connection after about a minute); slower polls run
    // four times less often.
    return t <= 30000 ? Math.max(t, Math.min(t * 3, 55000)) : t * 4;
  } : null;

  /* ---------------------------------------------------------------- read-ahead off */
  if (on) {
    try {
      var mo = new MutationObserver(function (list) {
        list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.tagName === 'SCRIPT' && n.type === 'speculationrules') n.remove(); }); });
      });
      mo.observe(html, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', function () { mo.disconnect(); Array.prototype.forEach.call(document.querySelectorAll('script[type=speculationrules]'), function (s) { s.remove(); }); });
    } catch (e) { /* old browser */ }
  }

  /* ---------------------------------------------------------------- the service worker's flag */
  // sw.js answers versioned /js/ and /css/ files from its own copy while this flag is set, so a page open does not ask the server
  // about each of 80 files again. Pages and the worker share Cache Storage, so the flag lives there.
  function swFlag() {
    if (!('serviceWorker' in navigator) || !window.caches) return;
    var name = 'favoros-flags';
    if (on) {
      caches.open(name).then(function (c) { return c.put('/__lite', new Response('1')); }).catch(function () {});
      navigator.serviceWorker.getRegistration('/').then(function (r) { if (!r) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {}); }).catch(function () {});
    } else {
      caches.open(name).then(function (c) { return c.delete('/__lite'); }).catch(function () {});
    }
  }

  /* ---------------------------------------------------------------- data meter */
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function usage() { try { return JSON.parse(get(USE) || '{}') || {}; } catch (e) { return {}; } }
  var pend = { page: 0, meet: 0, upload: 0 }, flushT = 0;
  function add(bytes, kind) {
    bytes = Math.max(0, Number(bytes) || 0);
    if (!bytes) return;
    pend[kind || 'page'] = (pend[kind || 'page'] || 0) + bytes;
    if (!flushT) flushT = setTimeout(flush, 3000);
  }
  function flush() {
    flushT = 0;
    var u = usage(), d = today(), m = d.slice(0, 7);
    if (u.month !== m) u = { month: m, days: {}, kinds: {} };
    var tot = 0;
    Object.keys(pend).forEach(function (k) { tot += pend[k]; u.kinds[k] = (u.kinds[k] || 0) + pend[k]; pend[k] = 0; });
    if (!tot) return;
    u.days[d] = (u.days[d] || 0) + tot;
    put(USE, JSON.stringify(u));
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  function summary() {
    flush();
    var u = usage(), d = today(), month = 0;
    if (u.month !== d.slice(0, 7)) u = { days: {}, kinds: {} };
    Object.keys(u.days || {}).forEach(function (k) { month += u.days[k]; });
    var cap = Number(get(CAP)) || 0;
    return { today: (u.days || {})[d] || 0, month: month, kinds: u.kinds || {}, cap: cap * 1048576, capMb: cap };
  }
  // Every file and API answer this page downloads. transferSize is 0 for a file served from the phone's cache, which costs nothing.
  try {
    var po = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { add(e.transferSize || 0, 'page'); });
    });
    po.observe({ type: 'resource', buffered: true });
    po.observe({ type: 'navigation', buffered: true });
  } catch (e) {
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { add(e.transferSize || 0, 'page'); }); }).observe({ entryTypes: ['resource', 'navigation'] }); } catch (e2) { /* no meter */ }
  }
  // Pages that took long to answer: the next page reads this when Data saver is on Auto.
  addEventListener('load', function () {
    setTimeout(function () {
      try {
        var nav = performance.getEntriesByType('navigation')[0];
        if (!nav || !nav.responseStart) return;
        var wait = nav.responseStart - nav.requestStart;
        if (wait > 0) { var old = Number(get(RTT)) || wait; put(RTT, String(Math.round(old * 0.7 + wait * 0.3))); }
      } catch (e) { /* ignore */ }
    }, 0);
  });
  // A meeting's sound and video do not show up as files: the room's own connection is read once a minute.
  var meetLast = 0;
  setInterval(function () {
    var M = window.__meet, pc = M && M.rtc && M.rtc.pc;
    if (!pc || pc.connectionState === 'closed') { meetLast = 0; return; }
    pc.getStats().then(function (rep) {
      var n = 0;
      rep.forEach(function (s) { if (s.type === 'transport') n += (s.bytesReceived || 0) + (s.bytesSent || 0); });
      if (meetLast && n > meetLast) add(n - meetLast, 'meet');
      meetLast = n;
    }).catch(function () {});
  }, 60000);

  /* ---------------------------------------------------------------- pictures */
  // About 150 KB for a phone photo: the long side at most 1280 pixels, JPEG quality stepped down until it fits under 200 KB.
  var PHOTO = { max: 1280, goal: 200 * 1024, qualities: [0.62, 0.5, 0.4] };
  function compressPhoto(file) {
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') || file.size <= PHOTO.goal) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, PHOTO.max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        var i = 0;
        (function next() {
          cv.toBlob(function (b) {
            if (b && b.size > PHOTO.goal && i < PHOTO.qualities.length - 1) { i++; next(); return; }
            if (!b || b.size >= file.size) { resolve(file); return; }
            var out;
            try { out = new File([b], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }); } catch (e) { out = b; out.name = 'photo.jpg'; }
            resolve(out);
          }, 'image/jpeg', PHOTO.qualities[i]);
        })();
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  var shown = {};
  // A picture held back in Lite carries data-lite-src. A tap anywhere on its frame loads it.
  document.addEventListener('click', function (e) {
    var box = e.target && e.target.closest && e.target.closest('[data-lite-box]');
    if (!box) return;
    var im = box.querySelector('img[data-lite-src]');
    if (im) { shown[im.getAttribute('data-lite-src')] = 1; im.src = im.getAttribute('data-lite-src'); im.removeAttribute('data-lite-src'); box.removeAttribute('data-lite-box'); box.classList.add('is-loaded'); }
  }, true);
  function kbText(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  /* ---------------------------------------------------------------- chat outbox */
  var box = null, boxP = null;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function outbox() {
    if (box) return Promise.resolve(box);
    if (!boxP) boxP = (window.FavorPhone ? Promise.resolve() : loadScript('/js/phone-core.js?v=2')).then(function () {
      var P = window.FavorPhone;
      box = P.createOutbox(P.idbStore(), P.chatTransport(), function () { box.list().then(function (l) { var n = l.filter(function (x) { return !x.failed; }).length; put('favor.lite.outbox', String(n)); document.dispatchEvent(new CustomEvent('favor:outbox', { detail: { waiting: n, items: l } })); }); });
      return box;
    });
    return boxP;
  }
  /** Sends a chat message through the outbox. Resolves { message } when it went now, { queued: true } when it waits for signal. */
  function chatSend(channel, payload) {
    return outbox().then(function (b) {
      return b.send({ channel: channel, thread_id: payload.thread_id || null, body: payload.body || '', attachments: payload.attachments || [], also: payload.also });
    });
  }
  function flushOutbox() { if (box || Number(get('favor.lite.outbox')) > 0) outbox().then(function (b) { return b.flush(); }).catch(function () {}); }
  addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && navigator.onLine) flushOutbox(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'flush-outbox') flushOutbox(); });

  /* ---------------------------------------------------------------- the switch */
  function set(v) {
    put(KEY, v === 'on' || v === 'off' ? v : 'auto');
    mode = setting(); why = mode === 'auto' ? reasons() : [];
    var was = on; on = mode === 'on' || (mode === 'auto' && why.length > 0);
    window.FavorLite.on = on; window.FavorLite.mode = mode; window.FavorLite.why = why;
    html.classList.toggle('is-lite', on);
    swFlag();
    return on !== was;
  }
  function openPanel() { loadScript('/js/lite-panel.js?v=1').then(function () { if (window.FavorLitePanel) window.FavorLitePanel.open(); }).catch(function () {}); }
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-lite-open]'); if (t) { e.preventDefault(); openPanel(); } });

  window.FavorLite = { on: on, mode: mode, why: why, set: set, reasons: reasons, add: add, summary: summary, compressPhoto: compressPhoto, PHOTO: PHOTO, shown: shown, kb: kbText, chatSend: chatSend, outbox: outbox, fontsLast: fontsLast, flushOutbox: flushOutbox, open: openPanel };
  swFlag();
  setTimeout(flushOutbox, 4000);
})();
