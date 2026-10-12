/* Online gifts: each online gift with the partner's comment and the designation read from it, Approve per gift or all at once,
   the Blackbaud batches that still need Approve in Blackbaud, and the write switch for admins.
   The rules and every decision are on the server (functions/_lib/online-gifts). This page shows what it returns and posts choices. */
(function () {
  'use strict';
  var root = document.getElementById('og-app');
  if (!root) return;
  var API = root.dataset.api;
  var U = window.FavorUI || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return U.money ? U.money(n) : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var day = function (s) { return U.day ? U.day(String(s).slice(0, 10)) : String(s).slice(0, 10); };
  var time = function (s) { return U.time ? U.time(s) : ''; };
  var toastEl = document.getElementById('og-toast'), tt;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('is-on'); }, 4200); }
  var qs = new URLSearchParams(location.search);
  var S = { days: qs.get('days') || '3', ov: null, pick: {}, busy: false };
  var DAYS = { '1': 'Today', '3': 'Last 3 days', '7': 'Last 7 days', '14': 'Last 14 days' };
  var SRC = { website: 'Website', form: 'Blackbaud form', 'fundraise up': 'International' };
  var STATE = { approved: 'No change', queued: 'Queued', applied: 'Saved', failed: 'Failed', held: 'Held', noted: 'Noted' };
  var PILL = { approved: 'applied', queued: 'queued', applied: 'applied', failed: 'failed', held: 'approved', noted: 'approved' };

  function call(path, body) {
    var opt = { credentials: 'same-origin' };
    if (body !== undefined) { opt.method = 'POST'; opt.headers = { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }; opt.body = JSON.stringify(body); }
    return fetch(API + path, opt).then(function (r) { return r.json().catch(function () { return {}; }); }).catch(function () { return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' }; });
  }
  function fundName(id) { var f = (S.ov.funds || []).find(function (x) { return x.id === id; }); return f ? f.name : 'No fund'; }
  function partner(r) {
    var nm = esc(r.name || 'Partner');
    return r.recordId ? '<a class="og-n" href="/work/partner/' + esc(r.recordId) + '" data-partner-id="' + esc(r.recordId) + '">' + nm + '</a>' : '<span class="og-n">' + nm + '</span>';
  }
  function facts(r) {
    var b = [money(r.amount)];
    if (r.original) b.push(r.original);
    b.push(SRC[r.source] || r.source);
    b.push(day(r.date));
    if (r.monthly) b.push('Monthly');
    if (r.tribute) b.push('Tribute');
    if (r.test) b.push('Test record');
    return b.join(' · ');
  }
  function chosen(r) { return S.pick[r.key] || (r.review && r.review.state !== 'failed' ? r.review.chosen_fund : r.read.fundId) || r.currentFund; }
  function select(r) {
    var cur = chosen(r);
    var opts = (S.ov.funds || []).map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === cur ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('');
    if (!cur) opts = '<option value="" selected>Pick a designation</option>' + opts;
    return '<label class="og-des"><select class="og-sel" data-key="' + esc(r.key) + '" aria-label="Designation for ' + esc(r.name) + '">' + opts + '</select></label>';
  }
  function readLine(r) {
    var to = chosen(r);
    var bits = [];
    if (r.read.by === 'comment' || r.read.by === 'model') bits.push('From the comment');
    else if (r.read.by === 'form' && r.source !== 'form') bits.push('From the form');
    if (r.inBlackbaud && r.currentFund && to && to !== r.currentFund) bits.push('In Blackbaud: ' + fundName(r.currentFund));
    return bits.length ? '<span class="og-why">' + esc(bits.join(' · ')) + '</span>' : '';
  }
  function row(r) {
    var changes = r.inBlackbaud && r.currentFund && chosen(r) !== r.currentFund;
    var pill = changes ? '<span class="ls-st ls-st--queued og-pill">Changes fund</span>' : !r.inBlackbaud ? '<span class="ls-st og-pill">Not in Blackbaud yet</span>' : '';
    return '<div class="og-row" data-key="' + esc(r.key) + '"><div class="og-main"><b>' + partner(r) + pill + '</b><span class="og-f">' + esc(facts(r)) + '</span>' +
      (r.comment ? '<q class="og-c">' + esc(r.comment) + '</q>' : '') + readLine(r) + '</div>' +
      '<div class="og-acts">' + select(r) + '<button type="button" class="ls-link" data-act="approve">Approve</button></div></div>';
  }
  function doneRow(r) {
    var v = r.review;
    var who = (v.approved_name || v.approved_by || '') + ', ' + day(v.approved_at) + (time(v.approved_at) ? ' ' + time(v.approved_at) : '');
    return '<div class="og-row og-row--done" data-key="' + esc(r.key) + '"><div class="og-main"><b>' + partner(r) + '</b><span class="og-f">' + esc(facts(r)) + '</span>' +
      (r.comment ? '<q class="og-c">' + esc(r.comment) + '</q>' : '') +
      '<span class="og-f">' + esc(fundName(v.chosen_fund) + ' · ' + who) + '</span>' + (v.result && v.state !== 'approved' && v.state !== 'applied' ? '<span class="og-why">' + esc(v.result) + '</span>' : '') + '</div>' +
      '<div class="og-acts og-acts--done"><span class="ls-st ls-st--' + (PILL[v.state] || 'approved') + '">' + esc(STATE[v.state] || v.state) + '</span><button type="button" class="ls-link og-again" data-act="reopen">Change</button></div></div>';
  }

  function draw() {
    var o = S.ov;
    var rank = function (r) { return r.inBlackbaud && r.currentFund && chosen(r) !== r.currentFund ? 0 : r.comment ? 1 : 2; };
    var todo = o.rows.filter(function (r) { return !r.review || r.reopen; }).map(function (r, i) { return [r, i]; }).sort(function (a, b) { return rank(a[0]) - rank(b[0]) || a[1] - b[1]; }).map(function (x) { return x[0]; });
    var done = o.rows.filter(function (r) { return r.review && !r.reopen; });
    var total = o.rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    var withC = o.rows.filter(function (r) { return r.comment; }).length;
    var h = '<div class="og-wrap">';
    h += '<div class="h-card cr-card og-card"><div class="cr-h"><b>Online gifts <small>' + o.rows.length + '</small></b>' +
      '<label class="og-period"><span class="sr-only">Period</span><select id="og-days" aria-label="Period">' + Object.keys(DAYS).map(function (k) { return '<option value="' + k + '"' + (k === S.days ? ' selected' : '') + '>' + DAYS[k] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="og-sum"><span>' + esc(money(total)) + '<i class="og-wide"> · ' + withC + (withC === 1 ? ' comment' : ' comments') + '</i> · ' + todo.length + ' to approve</span>' +
      (todo.length ? '<button type="button" class="h-btn h-btn--primary h-btn--sm" id="og-all">Approve all ' + todo.length + '</button>' : '') + '</div>';
    if (o.batches && o.batches.waiting && o.batches.waiting.length) {
      var w = o.batches.waiting, g = w.reduce(function (s, b) { return s + b.gifts; }, 0), amt = w.reduce(function (s, b) { return s + b.amount; }, 0);
      h += '<div class="og-bb"><span><b>Approve in Blackbaud</b> · ' + w.length + (w.length === 1 ? ' batch' : ' batches') + ' · ' + g + (g === 1 ? ' gift' : ' gifts') + ' · ' + esc(money(amt)) + '</span><a class="ls-link" href="' + esc(o.blackbaud) + '" target="_blank" rel="noopener">Open Blackbaud</a></div>';
    }
    h += (todo.length ? todo.map(row).join('') : '<p class="cr-none">Every gift here is approved</p>') + '</div>';
    if (done.length) h += '<div class="h-card cr-card og-card"><div class="cr-h"><b>Approved <small>' + done.length + '</small></b></div>' + done.map(doneRow).join('') + '</div>';
    if (o.admin) {
      h += '<div class="h-card cr-card og-card"><div class="cr-h"><b>Writes to Blackbaud</b><span class="ls-st ls-st--' + (o.apply ? 'applied' : 'rejected') + '">' + (o.apply ? 'On' : 'Off') + '</span></div>' +
        '<div class="og-sum"><span>' + esc(o.testLimit ? 'Only record ' + o.testLimit : 'Every record') + '</span><button type="button" class="ls-quiet" id="og-flip">Turn ' + (o.apply ? 'off' : 'on') + '</button></div></div>';
    }
    h += '</div>';
    root.innerHTML = h;
    bind();
  }

  function approve(items) {
    if (S.busy || !items.length) return;
    S.busy = true;
    call('/approve', { from: S.ov.from, items: items, gift: qs.get('gift') || '' }).then(function (r) {
      S.busy = false;
      if (r.ok === false) { toast(r.message || 'Not saved.'); return; }
      var res = r.results || [];
      var q = res.filter(function (x) { return x.state === 'queued'; }).length;
      var held = res.filter(function (x) { return x.state === 'held'; });
      var miss = res.filter(function (x) { return x.state === 'missing'; });
      var msg = res.length === 1 ? 'Approved' : 'Approved ' + (res.length - miss.length);
      if (q) msg += ' · ' + q + ' queued for Blackbaud';
      if (held.length) msg += ' · ' + held[0].result;
      if (miss.length) msg += ' · ' + miss[0].result;
      toast(msg);
      S.pick = {};
      load();
    });
  }

  function bind() {
    var d = document.getElementById('og-days');
    if (d) d.addEventListener('change', function () { S.days = d.value; var u = new URL(location.href); u.searchParams.set('days', S.days); history.replaceState(null, '', u); load(); });
    root.querySelectorAll('.og-sel').forEach(function (s) { s.addEventListener('change', function () { S.pick[s.dataset.key] = s.value; draw(); }); });
    root.querySelectorAll('.og-row [data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.closest('.og-row').dataset.key;
        var r = S.ov.rows.find(function (x) { return x.key === key; });
        if (!r) return;
        if (b.dataset.act === 'reopen') { r.reopen = true; draw(); return; }
        var f = chosen(r);
        if (!f) { toast('Pick a designation first'); return; }
        approve([{ key: key, fundId: f }]);
      });
    });
    var all = document.getElementById('og-all');
    if (all) all.addEventListener('click', function () {
      var items = S.ov.rows.filter(function (r) { return !r.review || r.reopen; }).map(function (r) { return { key: r.key, fundId: chosen(r) }; }).filter(function (x) { return x.fundId; });
      approve(items);
    });
    var fl = document.getElementById('og-flip');
    if (fl) fl.addEventListener('click', function () {
      if (!S.ov.apply && !confirm('Approved changes of designation will go to Blackbaud' + (S.ov.testLimit ? ' for record ' + S.ov.testLimit + ' only' : ' for every record') + '. Turn writes on?')) return;
      call('/setting', { apply: S.ov.apply ? 'off' : 'on' }).then(function (r) { toast(r.ok === false ? r.message : 'Writes are ' + (r.apply ? 'on' : 'off')); load(); });
    });
  }

  function load() {
    var extra = (qs.get('test') === '1' ? '&test=1' : '') + (/^\d+$/.test(qs.get('gift') || '') ? '&gift=' + qs.get('gift') : '');
    call('?days=' + encodeURIComponent(S.days) + extra).then(function (o) {
      if (o.ok === false) { root.innerHTML = '<p class="rp-note">' + esc(o.message || 'The online gifts did not load.') + '</p>'; return; }
      S.ov = o;
      draw();
    });
  }
  load();
})();
