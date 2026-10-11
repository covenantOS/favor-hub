// A home screen app has no reload button and iOS keeps its page in memory, so fixes never arrived. When the app comes back to
// the front, this asks which build is live and reloads once if it is newer, unless the person is typing or in a meeting room.
(function () {
  var meta = document.querySelector('meta[name="hub-build"]');
  if (!meta) return;
  var mine = meta.getAttribute('content');
  var last = 0;
  function busy() {
    if (/^\/meet\/(room|g)\b/.test(location.pathname)) return true;
    var a = document.activeElement;
    return !!(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value);
  }
  function check() {
    if (Date.now() - last < 30000) return;
    last = Date.now();
    fetch('/version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.build && j.build !== mine && !busy()) location.reload(); })
      .catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
  window.addEventListener('focus', check);
})();

// The phone tab bar's real height (it grows by the home bar's inset in a home screen app). Pages pinned above it read
// --h-bar-h instead of assuming 63 px.
(function () {
  function bar() {
    var b = document.querySelector('.h-navbar');
    if (!b) return;
    var h = getComputedStyle(b).display === 'none' ? 0 : Math.round(b.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--h-bar-h', h + 'px');
  }
  bar();
  document.addEventListener('DOMContentLoaded', bar);
  window.addEventListener('resize', bar);
  window.addEventListener('orientationchange', bar);
})();

// Phone keyboard. A home screen app shrinks the whole page when the keyboard opens and Safari does not, so the keyboard is
// read from focus: while a text box has focus on a touch screen, body.kb-open hides the tab bar and pages pinned to the
// screen fit the visible area (--vv-top, --vv-h). Pages that size themselves listen for the hub-kb event.
(function () {
  if (!window.matchMedia || !matchMedia('(pointer: coarse)').matches) return;
  var vv = window.visualViewport;
  var typing = function (el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    return el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color|date|time|month|week)$/i.test(el.type || '');
  };
  function frame() {
    var root = document.documentElement.style;
    if (vv) { root.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px'); root.setProperty('--vv-h', Math.round(vv.height) + 'px'); }
    var b = document.querySelector('.h-navbar');
    var open = document.body && document.body.classList.contains('kb-open');
    root.setProperty('--h-bar-h', open || !b ? '0px' : Math.round(b.getBoundingClientRect().height) + 'px');
  }
  function set(open) {
    if (!document.body || document.body.classList.contains('kb-open') === open) return;
    document.body.classList.toggle('kb-open', open);
    frame();
    window.dispatchEvent(new Event('hub-kb'));
  }
  var off = 0;
  document.addEventListener('focusin', function (e) { if (typing(e.target)) { clearTimeout(off); set(true); } });
  document.addEventListener('focusout', function () { clearTimeout(off); off = setTimeout(function () { set(typing(document.activeElement)); }, 120); });
  if (vv) { vv.addEventListener('resize', function () { frame(); window.dispatchEvent(new Event('hub-kb')); }); vv.addEventListener('scroll', function () { frame(); window.dispatchEvent(new Event('hub-kb')); }); }
})();
