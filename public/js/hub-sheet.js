/* Phone sheets follow the finger (2026-10-14). A sheet that rises from the bottom (the More menu, Help, Feedback, Today's
   sheets) can be pulled down to close, the way Vaul and the iPhone's own sheets work:
   - the sheet moves with the finger from the first pixel; pulled up past its top it only stretches a little;
   - let go past a quarter of its height, or with a quick flick (0.4 px per ms), and it slides away and closes;
   - otherwise it settles back where it was;
   - a sheet whose list is scrolled down scrolls first, and pulls only from the top of its list or from its handle row.
   Numbers from Vaul (Emil Kowalski, MIT): close at 25% or 0.4 px/ms, settle with cubic-bezier(0.32, 0.72, 0, 1) over 0.5 s. */
(function () {
  if (window.hubSheet) return;
  var phone = window.matchMedia ? matchMedia('(max-width: 860px)') : { matches: false };
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)', MS = 500, CLOSE_AT = 0.25, FLICK = 0.4, HEAD = 64;

  function clickIn(root, sel) { var b = root && root.querySelector(sel); if (b) { b.click(); return true; } return false; }
  var KINDS = [
    { sel: '.h-app.is-nav > .h-side', scroller: '.h-side__in', more: true,
      close: function () { var x = document.getElementById('h-side-x'); if (x) x.click(); else document.getElementById('h-app').classList.remove('is-nav'); } },
    { sel: 'dialog.lp[open]', scroller: '.lp__in', close: function (el) { el.close(); } },
    { sel: 'dialog.fb[open]', scroller: null, close: function (el) { el.close(); } },
    { sel: '.t2-sheet', scroller: null, fadeParent: true, close: function (el) { clickIn(el.parentNode, '[data-t2-close]'); } },
    { sel: '.pj-sheet', scroller: '.pj-sheet__body', fadePrev: true, close: function (el) { var sc = el.previousElementSibling; if (sc && sc.classList.contains('pj-scrim')) sc.click(); } },
    { sel: '[data-sheet-drag]', scroller: '[data-sheet-scroll]', close: function (el) { if (!clickIn(el, '[data-sheet-close]')) el.dispatchEvent(new CustomEvent('sheet-close', { bubbles: true })); } }
  ];
  function scrim(kind, el) { return kind.more ? document.getElementById('h-app') : kind.fadeParent ? el.parentNode : kind.fadePrev && el.previousElementSibling ? el.previousElementSibling : el; }

  var g = null; // the drag in progress
  document.addEventListener('touchstart', function (e) {
    if (!phone.matches || e.touches.length !== 1) return;
    var t = e.target;
    if (!t.closest || t.closest('input, textarea, select, [contenteditable="true"], input[type="range"]')) return;
    for (var i = 0; i < KINDS.length; i++) {
      var el = t.closest(KINDS[i].sel);
      if (!el) continue;
      var k = KINDS[i];
      var sc = k.scroller ? el.querySelector(k.scroller) : el;
      var r = el.getBoundingClientRect();
      g = { k: k, el: el, sc: sc, y0: e.touches[0].clientY, x0: e.touches[0].clientX, h: r.height, head: e.touches[0].clientY - r.top < HEAD, on: false, d: 0, pts: [] };
      // Listening to every finger move on the page would make all scrolling wait for this script; only a touch on a sheet is followed.
      document.addEventListener('touchmove', move, { passive: false, capture: true });
      return;
    }
  }, { passive: true, capture: true });

  function move(e) {
    if (!g) return;
    var y = e.touches[0].clientY, dy = y - g.y0, dx = e.touches[0].clientX - g.x0;
    if (!g.on) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      // Sideways, upward from inside a list, or down a list that is scrolled: leave it to the browser.
      if (Math.abs(dx) > Math.abs(dy) || (!g.head && (dy < 0 || (g.sc && g.sc.scrollTop > 0)))) { g = null; document.removeEventListener('touchmove', move, { capture: true }); return; }
      g.on = true;
      g.y0 = y; dy = 0;
      g.el.style.transition = 'none';
      g.el.classList.add('is-dragging');
    }
    if (e.cancelable) e.preventDefault();
    var d = dy >= 0 ? dy : -(Math.abs(dy) / (1.5 + Math.abs(dy) / 20));
    g.d = d;
    g.pts.push([Date.now(), d]);
    if (g.pts.length > 6) g.pts.shift();
    g.el.style.transform = 'translate3d(0,' + d + 'px,0)';
    scrim(g.k, g.el).style.setProperty('--sheet-fade', String(Math.max(0, Math.min(1, d / g.h))));
  }

  function end() {
    document.removeEventListener('touchmove', move, { capture: true });
    if (!g) return;
    var s = g; g = null;
    if (!s.on) return;
    s.el.classList.remove('is-dragging');
    var a = s.pts[0] || [Date.now(), 0], b = s.pts[s.pts.length - 1] || a;
    var v = (b[1] - a[1]) / Math.max(1, b[0] - a[0]);
    var shut = s.d > s.h * CLOSE_AT || (v > FLICK && s.d > 10);
    var fadeHost = scrim(s.k, s.el);
    var ms = reduce.matches ? 0 : shut ? Math.round(Math.max(180, Math.min(MS, (s.h - s.d) / Math.max(v, 1.2)))) : MS;
    s.el.style.transition = 'transform ' + ms + 'ms ' + EASE;
    fadeHost.style.setProperty('--sheet-fade-ms', ms + 'ms');
    if (!shut) {
      s.el.style.transform = 'translate3d(0,0,0)';
      fadeHost.style.setProperty('--sheet-fade', '0');
      setTimeout(function () { s.el.style.transition = ''; s.el.style.transform = ''; fadeHost.style.removeProperty('--sheet-fade'); fadeHost.style.removeProperty('--sheet-fade-ms'); }, ms + 20);
      return;
    }
    s.el.style.transform = 'translate3d(0,' + (s.h + 24) + 'px,0)';
    fadeHost.style.setProperty('--sheet-fade', '1');
    setTimeout(function () {
      // The More menu: the sheet is already off the screen, so it closes without the slide-away copy hub-motion.js draws.
      if (s.k.more) { s.el.classList.add('m-nav-gone'); window.__hubSheetClosed = true; }
      if (window.hubHaptic) window.hubHaptic('light');
      s.k.close(s.el);
      requestAnimationFrame(function () {
        s.el.style.transition = ''; s.el.style.transform = '';
        fadeHost.style.removeProperty('--sheet-fade'); fadeHost.style.removeProperty('--sheet-fade-ms');
        if (s.k.more) setTimeout(function () { s.el.classList.remove('m-nav-gone'); window.__hubSheetClosed = false; }, 360);
      });
    }, ms);
  }
  document.addEventListener('touchend', end, { capture: true });
  document.addEventListener('touchcancel', end, { capture: true });
  window.hubSheet = { kinds: KINDS };
})();
