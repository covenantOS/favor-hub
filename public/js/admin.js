/* Shared helpers for the Admin pages: the API call, escaping, Eastern times and the not-an-admin state. */
(function () {
  'use strict';
  var A = (window.Admin = window.Admin || {});
  A.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // An Admin page draws its cards as its reads answer, and each card used to push the ones under it down as it filled (a layout shift
  // of 0.3 to 0.8 on every tab). The page body now stays hidden behind one skeleton until the reads the page made in its first moments
  // have answered and drawn, then shows at its final size in one frame. Never longer than 2.5 seconds.
  var settle = (function () {
    var root = document.getElementById('ad-root');
    if (!root || root.dataset.settled) return null;
    root.classList.add('ad-settling');
    var open = 0, seen = false, done = false;
    var finish = function () { if (done) return; done = true; root.dataset.settled = '1'; root.classList.remove('ad-settling'); };
    var check = function () { if (!open && seen) requestAnimationFrame(function () { requestAnimationFrame(function () { if (!open) finish(); }); }); };
    setTimeout(finish, 2500);
    // A page with no reads at all shows at once.
    setTimeout(function () { if (!seen) finish(); }, 400);
    return { start: function () { if (done) return; seen = true; open++; }, end: function () { if (done) return; open = Math.max(0, open - 1); setTimeout(check, 0); } };
  })();
  A.api = function (path, body) {
    if (settle) settle.start();
    var opt = { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } };
    if (body !== undefined) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: 'FavorOS answered with something unexpected.' }; }).then(function (d) {
        if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not work.'); e.code = d.error || ''; e.status = r.status; throw e; }
        return d;
      });
    }).then(function (d) { if (settle) settle.end(); return d; }, function (e) { if (settle) settle.end(); throw e; });
  };
  var ET = { timeZone: 'America/New_York' };
  var dayKey = function (d) { return new Intl.DateTimeFormat('en-CA', ET).format(d); };
  A.when = function (iso) {
    if (!iso) return 'No run on record';
    var d = new Date(iso); if (isNaN(d)) return 'No run on record';
    var t = new Intl.DateTimeFormat('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, ET)).format(d) + ' ET';
    var today = dayKey(new Date()), that = dayKey(d), yest = dayKey(new Date(Date.now() - 864e5));
    if (that === today) return 'Today ' + t;
    if (that === yest) return 'Yesterday ' + t;
    return new Intl.DateTimeFormat('en-US', Object.assign({ month: 'short', day: 'numeric' }, ET)).format(d) + ', ' + t;
  };
  A.day = function (iso) {
    if (!iso) return 'No run on record';
    var d = new Date(iso); if (isNaN(d)) return 'No run on record';
    var that = dayKey(d), today = dayKey(new Date()), yest = dayKey(new Date(Date.now() - 864e5));
    if (that === today) return 'Today'; if (that === yest) return 'Yesterday';
    return new Intl.DateTimeFormat('en-US', Object.assign({ month: 'short', day: 'numeric' }, ET)).format(d);
  };
  A.full = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    return new Intl.DateTimeFormat('en-US', Object.assign({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, ET)).format(d) + ' ET';
  };
  A.ago = function (iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    var m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (m < 2) return 'just now'; if (m < 90) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 36) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  };
  A.denied = function (root) {
    root.innerHTML = '<div class="ad-card ad-denied"><p>Settings are for FavorOS admins.</p><p><a href="/">Back to Today</a></p></div>';
  };
  A.fail = function (root, err) {
    if (err && (err.status === 403 || err.status === 401)) return A.denied(root);
    root.innerHTML = '<div class="ad-card"><p class="ad-msg ad-msg--bad">' + A.esc(err && err.message || 'That did not load.') + '</p></div>';
  };
  A.label = { ok: 'OK', late: 'Late', failed: 'Failed', unknown: 'No answer' };
})();
