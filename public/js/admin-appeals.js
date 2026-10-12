/* Appeal codes page: builds a code from the scheme (prefix, year, month character, suffix), checks it against the Blackbaud copy and creates
   the appeal through POST /api/admin/appeal-codes. Funds and campaigns the Blackbaud connection cannot create yet wait in a list. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var D = null, timer = 0, busy = false;

  function opt(v, label) { return '<option value="' + A.esc(v) + '">' + A.esc(label) + '</option>'; }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
  function prefix() { var l = $('ap-kind').value; return D.prefixes.filter(function (p) { return p.letter === l; })[0]; }
  function draft() { return { letter: $('ap-kind').value, date: $('ap-date').value, suffix: $('ap-suffix').value, title: $('ap-title').value, description: $('ap-desc').value, category: $('ap-cat').value }; }

  function fillKind() {
    var p = prefix();
    $('ap-hint').textContent = p.hint;
    $('ap-datelab').textContent = p.letter === 'N' ? 'Send date' : 'Start date';
    $('ap-suffix').placeholder = p.letter === 'N' ? 'EMW and the week, filled in for you' : p.suffix || '';
    var cat = $('ap-cat');
    var has = D.categories.some(function (c) { return c.category === p.category; });
    cat.value = has ? p.category : '';
    $('ap-online').checked = p.letter === 'L';
  }

  function preview() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var box = $('ap-preview'), go = $('ap-create');
      if (!$('ap-date').value) { box.innerHTML = ''; go.disabled = true; return; }
      A.api('/api/admin/appeal-codes', { op: 'preview', draft: draft(), online: $('ap-online').checked }).then(function (d) {
        box.innerHTML = (d.built || []).map(function (b) {
          var gone = (d.exists || []).indexOf(b.code.toUpperCase()) >= 0;
          return '<div><code>' + A.esc(b.code) + '</code> ' + A.esc(b.description) + (gone ? ' <span class="is-bad">already exists in Blackbaud</span>' : '') + '</div>';
        }).join('');
        go.disabled = busy || !(d.built || []).length || (d.exists || []).length > 0;
        if (!busy) { $('ap-msg').textContent = ''; $('ap-msg').className = 'ad-msg'; }
      }).catch(function (e) { box.innerHTML = '<div class="is-bad">' + A.esc(e.message) + '</div>'; go.disabled = true; });
    }, 220);
  }

  function create() {
    var msg = $('ap-msg'), go = $('ap-create');
    busy = true; go.disabled = true; msg.className = 'ad-msg'; msg.textContent = 'Creating';
    A.api('/api/admin/appeal-codes', { op: 'create', draft: draft(), online: $('ap-online').checked }).then(function (d) {
      busy = false;
      var bad = d.created.filter(function (c) { return !c.ok; });
      msg.className = 'ad-msg' + (bad.length ? ' ad-msg--bad' : ' ad-msg--ok');
      msg.textContent = d.created.map(function (c) { return c.ok ? 'Created ' + c.code + '.' : c.code + ': ' + c.error; }).join(' ') + ' ' + d.wiring.join(' ');
      load();
    }).catch(function (e) { busy = false; msg.className = 'ad-msg ad-msg--bad'; msg.textContent = e.message; preview(); });
  }

  function drawRecent() {
    $('ap-recent').innerHTML = D.recent.length ? D.recent.map(function (r) {
      return '<tr><td data-label="Code"><b>' + A.esc(r.code) + '</b>' + (r.inactive ? ' <span class="bu-chip">Inactive</span>' : '') + '</td><td data-label="Description">' + A.esc(r.description) + '</td><td data-label="Category">' + A.esc(r.category) + '</td><td data-label="Starts">' + A.esc(r.start) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="au-empty">No appeals in the Blackbaud copy.</td></tr>';
  }

  function drawRequests() {
    var box = $('rq-list');
    if (!D.requests.length) { box.innerHTML = '<p class="bu-none">Nothing waiting.</p>'; return; }
    box.innerHTML = '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Request</th><th>Asked</th><th>Status</th><th></th></tr></thead><tbody>' + D.requests.map(function (r) {
      var open = r.state === 'open';
      return '<tr><td data-label="Request"><b>' + A.esc(r.kind === 'fund' ? 'Fund' : 'Campaign') + ' ' + A.esc(r.code) + '</b><br><span class="bu-mail">' + A.esc(r.description) + (r.category ? ' · ' + A.esc(r.category) : '') + (r.start_date ? ' · starts ' + A.esc(r.start_date) : '') + '</span></td>' +
        '<td data-label="Asked">' + A.esc(A.when(r.requested_at)) + '<br><span class="bu-mail">' + A.esc(r.requested_by) + '</span></td>' +
        '<td data-label="Status"><span class="bu-chip' + (r.state === 'done' ? ' bu-chip--ok' : '') + '">' + A.esc(r.state === 'open' ? 'Waiting' : r.state === 'done' ? 'Created' : 'Dropped') + '</span></td>' +
        '<td data-label="">' + (open ? '<button type="button" class="ad-btn" data-rq="done" data-id="' + A.esc(r.id) + '">Mark created</button> <button type="button" class="ad-btn" data-rq="dropped" data-id="' + A.esc(r.id) + '">Drop</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function load() {
    return A.api('/api/admin/appeal-codes').then(function (d) {
      D = d;
      if (!$('ap-kind').options.length) {
        $('ap-kind').innerHTML = d.prefixes.map(function (p) { return opt(p.letter, p.label + ' (' + p.letter + ')'); }).join('');
        $('ap-cat').innerHTML = opt('', 'Same as the kind') + d.categories.map(function (c) { return opt(c.category, c.category); }).join('');
        $('ap-date').value = today();
        fillKind();
      }
      drawRecent(); drawRequests(); preview();
    }).catch(function (e) { A.fail($('ad-root'), e); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ['ap-date', 'ap-suffix', 'ap-title', 'ap-desc', 'ap-cat', 'ap-online'].forEach(function (id) { $(id).addEventListener('input', preview); $(id).addEventListener('change', preview); });
    $('ap-kind').addEventListener('change', function () { fillKind(); preview(); });
    $('ap-create').addEventListener('click', create);
    $('rq-add').addEventListener('click', function () {
      var msg = $('rq-msg'); msg.className = 'ad-msg'; msg.textContent = 'Saving';
      A.api('/api/admin/appeal-codes', { op: 'request', kind: $('rq-kind').value, code: $('rq-code').value, description: $('rq-desc').value, category: $('rq-cat').value, start_date: $('rq-start').value }).then(function () {
        ['rq-code', 'rq-desc', 'rq-cat', 'rq-start'].forEach(function (id) { $(id).value = ''; });
        msg.textContent = ''; return load();
      }).catch(function (e) { msg.className = 'ad-msg ad-msg--bad'; msg.textContent = e.message; });
    });
    $('rq-list').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rq]'); if (!b) return;
      b.disabled = true;
      A.api('/api/admin/appeal-codes', { op: 'close', id: b.getAttribute('data-id'), state: b.getAttribute('data-rq') }).then(load).catch(function (er) { b.disabled = false; $('rq-msg').className = 'ad-msg ad-msg--bad'; $('rq-msg').textContent = er.message; });
    });
    load();
  });
})();
