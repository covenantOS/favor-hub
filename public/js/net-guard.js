/* Network guard, 2026-10-14. Loaded early on every FavorOS page, before the page scripts make their first call.
   - A button or form that starts a save is held until that save answers, so a second tap cannot send it twice.
   - A save that never reached the server, or that the server failed on (5xx), says so, so a change drawn early on the page never
     disappears without a word. A refusal with a reason (4xx) is left to the page, which shows that reason.
   - Offline shows a bar until the connection is back. A read or save still waiting after 6 seconds says the connection is slow.
   Chat and Meetings have their own sending and reconnect handling and are left alone. A button with data-ng-free is never held. */
(function () {
  'use strict';
  if (window.__netGuard || typeof window.fetch !== 'function') return;
  window.__netGuard = 1;
  var SKIP = /^\/api\/(chat|meet|meet-guest|push|brain|ai|clips|uploads|videos)\b/;
  var WRITE = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };
  var SLOW_MS = 6000;
  var origFetch = window.fetch.bind(window);
  var armed = null; // the button or form a person just pressed, for the save it starts in the same moment
  var armedAt = 0;
  var slowN = 0;

  function el(id, cls) {
    var e = document.getElementById(id);
    if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; e.setAttribute('role', 'status'); e.setAttribute('aria-live', 'polite'); (document.body || document.documentElement).appendChild(e); }
    return e;
  }
  var tT;
  function toast(text) {
    var e = el('ng-toast', 'ng-toast');
    e.textContent = text; e.classList.add('is-on');
    clearTimeout(tT); tT = setTimeout(function () { e.classList.remove('is-on'); }, 5000);
  }
  function offline(on) {
    var e = el('ng-offline', 'ng-bar');
    e.textContent = 'You are offline. Changes will not save until the connection is back.';
    e.classList.toggle('is-on', on);
    document.documentElement.classList.toggle('ng-is-offline', on);
  }
  function slow(delta) {
    slowN = Math.max(0, slowN + delta);
    var e = el('ng-slow', 'ng-bar ng-bar--slow');
    e.textContent = 'Slow connection. Still working.';
    e.classList.toggle('is-on', slowN > 0 && navigator.onLine !== false);
  }

  function pathOf(input) {
    try { return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href); } catch (e) { return null; }
  }
  function methodOf(input, init) {
    return String((init && init.method) || (input && typeof input === 'object' && 'method' in input && input.method) || 'GET').toUpperCase();
  }

  function hold(t) {
    if (!t || t.hasAttribute('data-ng-free')) return null;
    t.setAttribute('data-ng-busy', '1');
    t.setAttribute('aria-busy', 'true');
    return t;
  }
  function release(t) {
    if (!t) return;
    // A short pause after the answer, so a double tap that lands just after it is still caught.
    setTimeout(function () { t.removeAttribute('data-ng-busy'); t.removeAttribute('aria-busy'); }, 250);
  }

  window.fetch = function (input, init) {
    var u = pathOf(input);
    var mine = u && u.origin === location.origin && u.pathname.indexOf('/api/') === 0 && !SKIP.test(u.pathname);
    if (!mine) return origFetch(input, init);
    var write = !!WRITE[methodOf(input, init)];
    var held = write && armed && Date.now() - armedAt < 1000 && armed.isConnected ? hold(armed) : null;
    // An upload is slow by nature, so only plain reads and saves count toward the slow-connection bar.
    var b = init && init.body;
    var upload = b && typeof b === 'object' && !(b instanceof URLSearchParams);
    var counted = false;
    var slowT = upload ? 0 : setTimeout(function () { slowT = 0; counted = true; slow(1); }, SLOW_MS);
    var done = function () { if (slowT) clearTimeout(slowT); if (counted) slow(-1); release(held); };
    return origFetch(input, init).then(function (res) {
      done();
      if (write && res.status >= 500) toast('That did not save. FavorOS had a problem (' + res.status + '). Try again in a moment.');
      return res;
    }, function (err) {
      done();
      if (write && !(err && err.name === 'AbortError')) toast(navigator.onLine === false ? 'That did not save: no connection. Try again when you are back online.' : 'That did not save: the connection dropped. Try again.');
      throw err;
    });
  };

  function target(e) {
    var t = e.target && e.target.closest ? e.target.closest('button, [role="button"], input[type="submit"], input[type="button"]') : null;
    if (!t || t.closest('[data-ng-free], .ch, #meet-root, .h-app.is-room')) return null;
    return t;
  }
  // Capture phase: runs before any page handler, so a held button's second tap never reaches it.
  document.addEventListener('click', function (e) {
    var t = target(e);
    if (!t) return;
    if (t.getAttribute('data-ng-busy') === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    armed = t; armedAt = Date.now();
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.hasAttribute('data-ng-free') || (f.closest && f.closest('.ch, #meet-root'))) return;
    var btn = e.submitter && e.submitter.tagName ? e.submitter : f;
    if (btn.getAttribute('data-ng-busy') === '1' || f.getAttribute('data-ng-busy') === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    armed = btn; armedAt = Date.now();
  }, true);

  window.addEventListener('offline', function () { offline(true); });
  window.addEventListener('online', function () { offline(false); toast('Back online.'); });
  if (navigator.onLine === false) document.addEventListener('DOMContentLoaded', function () { offline(true); });
})();
