/* FavorData: one cache for every API read in FavorOS. Pages and the dock ask it for data instead of calling fetch on their own, so the same
   data is fetched once, shown at once from the last copy, refreshed in the background, and updated everywhere when something changes.

   What it does
     one cache keyed by name        two callers asking for 'nav' share one request and one answer
     stale while revalidate         cached data is handed over at once (from memory, or from sessionStorage after a page change), then refreshed
     refresh on return              coming back to the tab refreshes every watched key older than its stale time
     retry with backoff             a network error or a 5xx retries after 0.6 s, 2 s and 5 s; a 4xx never retries
     invalidation                   FavorData.invalidate('today') marks the key stale and refetches it if anything is watching it; a trailing
                                    colon is a prefix: invalidate('chat:') covers every key that starts with chat:
     persistence                    small answers (under 150 KB) are kept in sessionStorage for 30 minutes so the next page paints at once

   API
     FavorData.watch(key, url, opts, cb)   cb(data, meta) runs now with cached data (if any) and after every change. Returns an unsubscribe function.
                                           opts: { stale: ms (default 20000), persist: true (default), poll: ms, select: (json) => data, ok: (json) => bool }
     FavorData.get(key, url, opts)         a promise of the data: cached when fresh, otherwise fetched (one request however many callers)
     FavorData.peek(key)                   the cached data now, or undefined
     FavorData.set(key, data)              replace the cached data and tell watchers (an optimistic update)
     FavorData.invalidate(key | [keys])    mark stale and refetch watched keys
     FavorData.mutate(fn, keys)            run fn (a promise of the change), then invalidate keys, even when fn fails
     FavorData.keys.*                      the shared key names: nav, today, notifications
   Keys FavorOS shell, Today, the bell and the dock use: nav (/api/hub/nav), today (/api/hub/today), notifications (/api/hub/notifications),
   dock (/api/chat/dock). A write made through window.fetch to a known route invalidates the keys it moves (see keysFor), so a page that
   changes data needs no call of its own. Full notes for page authors: docs/DATA.md. */
(function () {
  'use strict';
  if (window.FavorData) return;
  var PREFIX = 'fd:';
  var MAX_AGE = 30 * 60000, MAX_BYTES = 150000;
  var realFetch = window.fetch.bind(window);
  var C = {}; // key -> { data, at, url, opts, subs: [], inflight, timer, stale, poll }

  var entry = function (key) { return C[key] || (C[key] = { data: undefined, at: 0, subs: [], inflight: null, stale: false, opts: {}, url: '' }); };
  function load(e, key) {
    if (e.data !== undefined || e.loaded) return;
    e.loaded = true;
    if (e.opts.persist === false) return;
    try {
      var s = JSON.parse(sessionStorage.getItem(PREFIX + key) || 'null');
      if (s && Date.now() - s.at < MAX_AGE) { e.data = s.data; e.at = s.at; e.stale = true; }
    } catch (_) { /* unreadable copy, ignored */ }
  }
  function save(e, key) {
    if (e.opts.persist === false) return;
    try { var t = JSON.stringify({ at: e.at, data: e.data }); if (t.length < MAX_BYTES) sessionStorage.setItem(PREFIX + key, t); else sessionStorage.removeItem(PREFIX + key); } catch (_) { /* full */ }
  }
  var tell = function (e, meta) { e.subs.slice().forEach(function (cb) { try { cb(e.data, meta || {}); } catch (err) { if (window.console) console.error(err); } }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function request(e, url, n) {
    return realFetch(url, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(function (r) {
      if (r.status >= 500 && n < 3) return wait([600, 2000, 5000][n]).then(function () { return request(e, url, n + 1); });
      return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, json: j }; });
    }, function (err) {
      if (n < 3) return wait([600, 2000, 5000][n]).then(function () { return request(e, url, n + 1); });
      throw err;
    });
  }
  function fetchKey(key, url, opts) {
    var e = entry(key);
    if (url) e.url = url;
    if (opts) e.opts = Object.assign({}, e.opts, opts);
    if (e.inflight) return e.inflight;
    e.inflight = request(e, e.url, 0).then(function (res) {
      var okFn = e.opts.ok || function (j) { return j && j.ok !== false; };
      if (!res.ok || !okFn(res.json)) { var er = new Error((res.json && res.json.message) || 'Could not load.'); er.status = res.status; throw er; }
      e.data = e.opts.select ? e.opts.select(res.json) : res.json;
      e.at = Date.now(); e.stale = false;
      save(e, key); tell(e, { fresh: true });
      return e.data;
    }).catch(function (err) { tell(e, { error: err }); throw err; }).then(function (d) { e.inflight = null; return d; }, function (err) { e.inflight = null; throw err; });
    return e.inflight;
  }
  var fresh = function (e) { return e.data !== undefined && !e.stale && Date.now() - e.at < (e.opts.stale == null ? 20000 : e.opts.stale); };

  function get(key, url, opts) {
    var e = entry(key); if (opts) e.opts = Object.assign({}, e.opts, opts); if (url) e.url = url;
    load(e, key);
    return fresh(e) ? Promise.resolve(e.data) : fetchKey(key);
  }
  function watch(key, url, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    var e = entry(key); e.opts = Object.assign({}, e.opts, opts || {}); if (url) e.url = url;
    load(e, key);
    e.subs.push(cb);
    if (e.data !== undefined) { try { cb(e.data, { cached: true, stale: !fresh(e) }); } catch (err) { if (window.console) console.error(err); } }
    if (!fresh(e)) fetchKey(key).catch(function () { /* watchers hear it as meta.error */ });
    if (e.opts.poll && !e.timer) e.timer = setInterval(function () { if (!document.hidden && e.subs.length) fetchKey(key).catch(function () {}); }, e.opts.poll);
    return function () {
      var i = e.subs.indexOf(cb); if (i >= 0) e.subs.splice(i, 1);
      if (!e.subs.length && e.timer) { clearInterval(e.timer); e.timer = 0; }
    };
  }
  var peek = function (key) { var e = entry(key); load(e, key); return e.data; };
  function set(key, data) { var e = entry(key); e.data = data; e.at = Date.now(); e.stale = false; save(e, key); tell(e, { set: true }); }

  var pending = {}, pendT = 0;
  function invalidate(keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
      Object.keys(C).forEach(function (name) {
        if (k.slice(-1) === ':' ? name.indexOf(k) === 0 : name === k) { C[name].stale = true; pending[name] = 1; }
      });
    });
    clearTimeout(pendT);
    // One refetch after a short pause, so five changes in a row cost one read.
    pendT = setTimeout(function () {
      var names = Object.keys(pending); pending = {};
      names.forEach(function (n) { var e = C[n]; if (e && e.subs.length && e.url) fetchKey(n).catch(function () {}); });
    }, 250);
  }
  function mutate(fn, keys) {
    var done = function () { invalidate(keys || []); };
    return Promise.resolve().then(fn).then(function (r) { done(); return r; }, function (err) { done(); throw err; });
  }

  // A write made through window.fetch moves the numbers a page shows. The route decides the keys (keysFor); any other /api write refreshes nav and today.
  function keysFor(url) {
    if (/\/api\/(hub\/nav|auth|clips\/|meet\/)/.test(url)) return [];
    if (/\/api\/chat\//.test(url)) return /\/inbox|\/read|\/messages/.test(url) ? ['nav', 'notifications', 'dock'] : [];
    if (/\/api\/(requests|tasks|work|learn|evaluations|expenses|receipts|feedback|mail|admin|hub\/snooze)/.test(url)) return ['nav', 'today', 'notifications'];
    return ['nav', 'today'];
  }
  window.fetch = function (input, init) {
    var p = realFetch.apply(this, arguments);
    var m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD') {
      var u = String((input && input.url) || input);
      if (/\/api\//.test(u)) { var ks = keysFor(u); if (ks.length) p.then(function () { invalidate(ks); }, function () {}); }
    }
    return p;
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    Object.keys(C).forEach(function (k) { var e = C[k]; if (e.subs.length && e.url && !fresh(e)) fetchKey(k).catch(function () {}); });
  });
  addEventListener('online', function () { Object.keys(C).forEach(function (k) { var e = C[k]; if (e.subs.length && e.url) fetchKey(k).catch(function () {}); }); });

  window.FavorData = { watch: watch, get: get, peek: peek, set: set, invalidate: invalidate, mutate: mutate, keys: { nav: 'nav', today: 'today', notifications: 'notifications', dock: 'dock' } };
  // Standard keys, so a page can watch them by name.
  entry('nav').url = '/api/hub/nav'; entry('today').url = '/api/hub/today'; entry('notifications').url = '/api/hub/notifications';
})();
