/* The loading line at the top of the window (2026-10-14), on NProgress's model: it waits 140 ms (a quick load shows nothing),
   starts at 8%, creeps toward 94% in smaller and smaller steps, and on finish runs to the end in 200 ms and fades.
   Framework-free: window.hubProgress.start(key) / done(key) / wrap(promise). Several callers can hold it at once.
   Shown for: a page swapped in place (hub-swap.js), a page that loads whole (any same-site link the swap does not take, a form
   sent the old way; the installed phone app has no address bar to show one), and anything a page wraps (hubToast.promise does).
   Drawn with transform only. The React app's router pending state calls the same two functions. */
(function () {
  if (window.hubProgress) return;
  var held = {}, count = 0, el = null, val = 0, showT = 0, tickT = 0, endT = 0, shown = false;

  function bar() {
    if (el && el.isConnected) return el;
    el = document.getElementById('h-prog');
    if (!el) { el = document.createElement('div'); el.id = 'h-prog'; document.body.appendChild(el); }
    el.classList.add('hp');
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', 'Loading');
    return el;
  }
  function set(v, ms) {
    val = v;
    var b = bar();
    b.style.transitionDuration = (ms == null ? 300 : ms) + 'ms, 200ms';
    b.style.transform = 'scaleX(' + v + ')';
  }
  function trickle() {
    var step = val < 0.2 ? 0.1 : val < 0.5 ? 0.04 : val < 0.8 ? 0.02 : val < 0.94 ? 0.005 : 0;
    if (step) set(Math.min(0.94, val + step));
    tickT = setTimeout(trickle, 320);
  }
  function show() {
    shown = true;
    clearTimeout(endT);
    var b = bar();
    b.classList.add('is-on');
    set(0, 0);
    void b.offsetWidth;
    set(0.08, 200);
    clearTimeout(tickT);
    tickT = setTimeout(trickle, 320);
  }
  function start(key) {
    key = key || 'x';
    if (held[key]) return;
    held[key] = 1; count++;
    if (count === 1 && !shown) { clearTimeout(showT); showT = setTimeout(show, 140); }
  }
  function done(key) {
    key = key || 'x';
    if (!held[key]) return;
    delete held[key]; count--;
    if (count > 0) return;
    clearTimeout(showT); clearTimeout(tickT);
    if (!shown) return;
    shown = false;
    set(1, 200);
    endT = setTimeout(function () { if (el) el.classList.remove('is-on'); endT = setTimeout(function () { if (!shown) set(0, 0); }, 220); }, 220);
  }
  function wrap(p, key) {
    var k = key || 'w' + Math.random().toString(36).slice(2);
    start(k);
    Promise.resolve(p).then(function () { done(k); }, function () { done(k); });
    return p;
  }
  window.hubProgress = { start: start, done: done, wrap: wrap };

  // A page that loads whole: the line runs until the browser drops this page. Links the page or the swap handled are left alone.
  addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download')) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (er) { return; }
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
    if (/^\/(api|sounds|images|files)\//.test(u.pathname) || /\.(pdf|csv|xlsx?|zip|png|jpe?g|mp4|webm)$/i.test(u.pathname)) return;
    start('nav');
    // A page that asked first (an unsaved recording) and was kept: let the line go after a while.
    setTimeout(function () { done('nav'); }, 15000);
  });
  addEventListener('submit', function (e) { if (!e.defaultPrevented && !(e.target && e.target.target)) start('nav'); });
  // Back to a page kept in memory: nothing is loading any more.
  addEventListener('pageshow', function () { done('nav'); });
  // A link that turned out to be a download or a new window leaves the page in place.
  addEventListener('focus', function () { setTimeout(function () { done('nav'); }, 600); });
})();
