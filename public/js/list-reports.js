/* Standard reports: pick a report, set the period, read the rows and the tie to the KPI dashboard, press a row to see the partners or gifts behind it.
   Every figure comes from /api/lists/report; this file only draws it. A row's drill opens the Lists page with the criteria already set. */
(function () {
  'use strict';
  var root = document.getElementById('lr-app');
  if (!root) return;
  var API = root.dataset.api;
  var U = window.FavorUI || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return Number(n).toLocaleString('en-US'); };
  var money = function (n) { return U.money ? U.money(n) : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var day = function (s) { return U.day ? U.day(s) : s; };
  var S = { list: null, id: '', values: {}, res: null };

  function get(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' }; });
  }
  function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function cell(c, v) {
    if (v == null || v === '') return '';
    if (c.type === 'money') return esc(money(v));
    if (c.type === 'int') return esc(num(v));
    if (c.type === 'date') return esc(day(v));
    return esc(v);
  }
  function query() {
    var q = ['id=' + encodeURIComponent(S.id)];
    Object.keys(S.values).forEach(function (k) { if (S.values[k] !== '' && S.values[k] != null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(S.values[k])); });
    return q.join('&');
  }
  function tabs() {
    return '<div class="ls-top"><div class="rp-seg2" role="group" aria-label="Lists"><a class="rp-segl" href="/lists/">Builder</a><button type="button" class="is-on">Standard reports</button></div></div>';
  }

  function drawMenu() {
    var groups = ['Giving', 'Partners', 'Team'];
    var h = tabs() + '<div class="lr-grid">';
    groups.forEach(function (g) {
      var items = S.list.reports.filter(function (r) { return r.group === g; });
      h += '<div class="h-card lr-grp"><div class="rp-k">' + esc(g) + '</div>' + items.map(function (r) {
        return '<button type="button" class="lr-item" data-id="' + esc(r.id) + '"' + (r.open ? '' : ' disabled') + '><b>' + esc(r.name) + '</b><small>' + esc(r.about) + '</small></button>';
      }).join('') + '</div>';
    });
    root.innerHTML = h + '</div>';
    root.querySelectorAll('.lr-item').forEach(function (b) { b.addEventListener('click', function () { S.id = b.dataset.id; S.values = {}; history.replaceState(null, '', '/lists/reports/?r=' + encodeURIComponent(S.id)); load(); }); });
  }

  function params(res) {
    var h = '';
    res.params.forEach(function (p) {
      var cur = S.values[p.id] != null ? S.values[p.id] : (res.values && res.values[p.id]) || p.def;
      var opts = p.type === 'period' ? S.list.periods : p.options;
      h += '<label class="lr-p"><span>' + esc(p.label) + '</span><select data-p="' + esc(p.id) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
      if (p.type === 'period' && cur === 'custom') h += '<label class="lr-p"><span>From</span><input type="date" data-p="from" value="' + esc(S.values.from || res.from) + '"></label><label class="lr-p"><span>To</span><input type="date" data-p="to" value="' + esc(S.values.to || res.to) + '"></label>';
    });
    return h;
  }

  function draw() {
    var res = S.res;
    var h = tabs() + '<div class="lr-head"><button type="button" class="ls-link" id="lr-back">All reports</button><h2>' + esc(res.name) + '</h2></div>';
    h += '<div class="h-card lr-bar">' + params(res) + '<span class="lr-range">' + esc(day(res.from)) + ' to ' + esc(day(res.to)) + '</span></div>';
    h += '<div class="h-card ls-sumc"><div class="lr-tiles">' + res.tiles.map(function (t) { return '<div class="lr-tile"><b>' + (t.kind === 'money' ? esc(money(t.value)) : t.kind === 'int' ? esc(num(t.value)) : esc(t.value)) + '</b><span>' + esc(t.label) + '</span></div>'; }).join('') + '</div>';
    h += res.ties.map(function (t) {
      return '<div class="ls-tie ' + (t.status === 'match' ? 'is-ok' : t.status === 'differs' ? 'is-warn' : 'is-off') + '"><span class="ls-tie__i" aria-hidden="true">' + (t.status === 'match' ? '✓' : '≠') + '</span><div><b>' + (t.status === 'match' ? 'Ties to the KPI dashboard' : t.status === 'differs' ? 'Differs from the KPI dashboard' : 'KPI dashboard not answering') + '</b><span>' + esc(t.label) + ': ' + (t.kpi == null ? '—' : (typeof t.kpi === 'number' && Math.abs(t.kpi) >= 1000 && t.mine % 1 !== 0 ? esc(money(t.kpi)) : esc(num(t.kpi)))) + (t.status === 'differs' ? ' · here ' + esc(t.mine % 1 !== 0 ? money(t.mine) : num(t.mine)) : '') + '</span></div></div>';
    }).join('') + '</div>';
    var rows = res.rows.map(function (r) {
      var tds = res.columns.map(function (c) { return '<td class="' + (c.type === 'money' || c.type === 'int' ? 'r' : '') + '">' + cell(c, r[c.key]) + '</td>'; }).join('');
      return '<tr' + (r._drill ? ' class="lr-row" tabindex="0" data-drill="' + esc(b64(r._drill)) + '"' : '') + '>' + tds + '</tr>';
    }).join('');
    h += '<div class="h-card ls-tcard"><div class="ls-scroll rp-scroll"><table class="rp-table ls-t"><thead><tr>' + res.columns.map(function (c) { return '<th class="' + (c.type === 'money' || c.type === 'int' ? 'r' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows || '<tr><td class="rp-empty" colspan="' + res.columns.length + '">No rows</td></tr>') + '</tbody></table></div>' + (res.rows.some(function (r) { return r._drill; }) ? '<div class="rp-pager"><span>Press a row to see the rows behind it</span></div>' : '') + '</div>';
    if (res.note) h += '<p class="rp-note lr-note">' + esc(res.note) + '</p>';
    root.innerHTML = h;
    root.querySelector('#lr-back').addEventListener('click', function () { S.id = ''; S.res = null; history.replaceState(null, '', '/lists/reports/'); drawMenu(); });
    root.querySelectorAll('[data-p]').forEach(function (el) { el.addEventListener('change', function () { S.values[el.dataset.p] = el.value; if (el.dataset.p === 'period' && el.value === 'custom') { S.values.from = res.from; S.values.to = res.to; } load(); }); });
    root.querySelectorAll('.lr-row').forEach(function (tr) {
      var go = function () { location.href = '/lists/?spec=' + tr.dataset.drill; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
  }

  function load() {
    root.classList.add('is-busy');
    get(API + '?' + query()).then(function (d) {
      root.classList.remove('is-busy');
      if (d.ok === false) { root.innerHTML = tabs() + '<div class="h-card ls-pad"><p class="rp-note">' + esc(d.message || 'The report did not load.') + '</p></div>'; return; }
      S.res = d; draw();
    });
  }

  get(API).then(function (d) {
    if (d.ok === false) { root.innerHTML = '<div class="h-card ls-pad"><p class="rp-note">' + esc(d.message || 'Reports did not load.') + '</p></div>'; return; }
    S.list = d;
    var r = new URLSearchParams(location.search).get('r');
    if (r && d.reports.some(function (x) { return x.id === r; })) { S.id = r; load(); } else drawMenu();
  });
})();
