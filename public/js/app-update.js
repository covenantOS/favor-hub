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
