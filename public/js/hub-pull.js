/* Pull to refresh in the installed phone app (2026-10-14). FavorOS added to a home screen opens without the browser around it,
   so there is no reload button and no browser pull-down; this gives the gesture back. At the top of a page, pull down: a round
   mark follows the finger, turns when it passes the mark (a light tap), and letting go there reloads the page.
   A page can refresh itself instead of reloading: listen for "hub:refresh" and call preventDefault(); the mark spins until
   the event's detail.done() is called. Runs only in the installed app on a touch screen, never inside a dialog, a sheet, the
   open menu, a box scrolled down, Chat, Mail, Favor Brain or a meeting. Framework-free. */
(function () {
  if (window.__hubPull) return;
  window.__hubPull = true;
  var forced = false;
  try { forced = localStorage.getItem('favor.hub.pull.test') === '1'; } catch (e) { /* none */ }
  var standalone = forced || (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (!standalone || !touch) return;
  var MARK = 72, MAX = 120;
  var el = null, s = null, busy = false;

  function mark() {
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.className = 'hpr';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';
    document.body.appendChild(el);
    return el;
  }
  function scrolledInside(t) {
    for (var n = t; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.scrollTop > 0) return true;
      var oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 2 && n.scrollTop > 0) return true;
    }
    return false;
  }
  function blocked(t) {
    var nav = (document.body && document.body.dataset.nav) || '';
    if (/^(chat|mail|brain|meet)/.test(nav) || document.documentElement.classList.contains('in-room')) return true;
    if (document.querySelector('dialog[open], .h-app.is-nav, .pj-sheet, .t2-sheet, .hc, #cmdk:not([hidden])')) return true;
    if (t.closest && t.closest('[data-no-pull], input, textarea, select, [contenteditable="true"], .ht, .pj-dragging')) return true;
    return (document.scrollingElement || document.documentElement).scrollTop > 0 || scrolledInside(t);
  }
  function paint(dy) {
    var m = mark(), p = Math.min(1, dy / MARK);
    m.style.transition = 'none';
    m.style.opacity = String(Math.min(1, p * 1.4));
    m.style.transform = 'translate(-50%, ' + (Math.min(dy, MAX) - 44) + 'px) rotate(' + Math.round(p * 270) + 'deg) scale(' + (0.7 + 0.3 * p) + ')';
    m.classList.toggle('is-ready', dy >= MARK);
  }
  function settle(spin) {
    var m = mark();
    m.style.transition = '';
    if (spin) { m.classList.add('is-busy'); m.style.transform = 'translate(-50%, 28px)'; m.style.opacity = '1'; }
    else { m.classList.remove('is-busy', 'is-ready'); m.style.transform = 'translate(-50%, -44px)'; m.style.opacity = '0'; }
  }

  document.addEventListener('touchstart', function (e) {
    if (busy || e.touches.length !== 1 || blocked(e.target)) { s = null; return; }
    s = { y: e.touches[0].clientY, x: e.touches[0].clientX, dy: 0, on: false, ready: false };
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!s) return;
    var t = e.touches[0], dy = t.clientY - s.y, dx = Math.abs(t.clientX - s.x);
    if (!s.on) {
      if (dy < 10 || dx > dy) { if (dy < -4 || dx > 12) s = null; return; }
      if ((document.scrollingElement || document.documentElement).scrollTop > 0) { s = null; return; }
      s.on = true;
    }
    // Resistance: the mark moves half as far as the finger, less the further it goes.
    s.dy = Math.max(0, dy * 0.5 - Math.max(0, dy * 0.5 - MARK) * 0.4);
    paint(s.dy);
    var ready = s.dy >= MARK;
    if (ready !== s.ready) { s.ready = ready; if (ready && window.hubHaptic) window.hubHaptic('select'); }
  }, { passive: true });
  function end() {
    if (!s) return;
    var go = s.on && s.ready;
    s = null;
    if (!go) { settle(false); return; }
    busy = true;
    settle(true);
    var finish = function () { busy = false; settle(false); };
    var ev = new CustomEvent('hub:refresh', { cancelable: true, detail: { done: finish } });
    if (document.dispatchEvent(ev)) {
      if (window.hubProgress) window.hubProgress.start('nav');
      setTimeout(function () { location.reload(); }, 120);
    }
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', function () { if (s) { s = null; settle(false); } }, { passive: true });
})();
