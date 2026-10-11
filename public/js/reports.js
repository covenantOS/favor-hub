/* Reports: the list, and one report page (filters, tiles, tie-out line, table, exports).
   Every report comes from /api/reports/<id>; this file draws what the server returns and never recomputes a figure.
   The page lives at data-base ("/reports/") and the data at data-api ("/api/reports"), so moving the area means
   changing those two attributes on the page, not this file. A report opens at <base>?r=<id>&<filters>. */
(function () {
  'use strict';
  var root = document.getElementById('rp-app');
  if (!root) return;
  var BASE = root.dataset.base || '/reports/';
  var API = root.dataset.api || '/api/reports';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { var x = Number(n) || 0; return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var num = function (n) { return Number(n).toLocaleString('en-US'); };
  var dshort = function (s) { if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return s || ''; return new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var top = { crumb: $('.h-top__crumb'), title: $('.h-top__title') };
  function setHeader(crumb, title) {
    if (top.crumb) top.crumb.textContent = crumb;
    if (top.title) top.title.textContent = title;
    document.title = title + ' - Favor Hub';
  }

  var toastEl = $('#rp-toast');
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3800);
  }

  function get(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; });
    }).catch(function () { return { ok: false, message: 'The hub could not be reached. Check the connection and try again.', _status: 0 }; });
  }

  /* ---------- the list ---------- */
  var listQuery = '';
  var listGroup = 'all';

  function flags(r) {
    if (!r.ready) return '<span class="rp-tag rp-tag--soon">Coming soon</span>';
    return (r.kpiTie ? '<span class="rp-tag rp-tag--ok">Ties to KPI</span>' : '');
  }

  function drawList(data) {
    setHeader('KPI', 'Reports');
    var groups = data.groups;
    var reports = data.reports;
    var q = listQuery.toLowerCase();
    var segs = [['all', 'All', reports.length]].concat(groups.map(function (g) { return [g.id, g.label, reports.filter(function (r) { return r.group === g.id; }).length]; }))
      .filter(function (c) { return c[0] === 'all' || c[2] > 0; });
    var h = '<div class="rp-top"><div class="rp-seg2" role="group" aria-label="Kind"><button type="button" class="is-on">Reports <small>' + reports.length + '</small></button><a class="rp-segl" href="' + BASE + '?r=query-map">' + esc(data.queryMap.name) + '</a></div>' +
      '<label class="rp-find"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="rp-q" placeholder="Find a report or query" value="' + esc(listQuery) + '" aria-label="Find a report or query"></label></div>' +
      '<div class="rp-groups"><div class="rp-seg2" role="group" aria-label="Group">' +
      segs.map(function (c) { return '<button type="button" class="' + (listGroup === c[0] ? 'is-on' : '') + '" data-g="' + c[0] + '">' + esc(c[1]) + ' <small>' + c[2] + '</small></button>'; }).join('') + '</div></div>';
    var any = false;
    var t = '<div class="h-card rp-list" role="table" aria-label="Reports"><div class="rp-head" role="row"><span>Report</span><span>How often</span><span>Used by</span><span>Flags</span></div>';
    groups.forEach(function (g) {
      if (listGroup !== 'all' && listGroup !== g.id) return;
      var rows = reports.filter(function (r) { return r.group === g.id && (!q || (r.name + ' ' + (r.replaces || '') + ' ' + r.who).toLowerCase().indexOf(q) >= 0); });
      if (!rows.length) return;
      any = true;
      t += '<div class="rp-grp">' + esc(g.label) + ' <b>' + rows.length + '</b></div>';
      rows.forEach(function (r) {
        var inner = '<b class="rp-name">' + esc(r.name) + '</b><span class="rp-c" title="' + esc(r.freq) + '">' + esc(r.freq) + '</span><span class="rp-c" title="' + esc(r.who) + '">' + esc(r.who) + '</span><span class="rp-flags">' + flags(r) + '</span>';
        t += r.ready ? '<a class="rp-row" role="row" href="' + BASE + '?r=' + r.id + '">' + inner + '</a>' : '<div class="rp-row is-soon" role="row">' + inner + '</div>';
      });
    });
    t += '</div>';
    h += any ? t : '<div class="h-card rp-box"><p class="rp-note">No report matches that.</p></div>';
    if (!reports.length) h += '<div class="h-card rp-box"><p class="rp-note">No report is set up for your role yet. Ask the technology team through Feedback if you use a Blackbaud query that is missing.</p></div>';
    root.innerHTML = h;
    var input = $('#rp-q');
    input.addEventListener('input', function (e) {
      listQuery = e.target.value;
      var pos = e.target.selectionStart;
      drawList(data);
      var i = $('#rp-q'); i.focus(); i.setSelectionRange(pos, pos);
    });
    $$('[data-g]').forEach(function (b) { b.addEventListener('click', function () { listGroup = b.dataset.g; drawList(data); }); });
  }

  /* ---------- one report ---------- */
  var cur = null; // { id, res, sort, find, page }
  var SHEET = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><path d="M6 2.5h8.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#0f9d58" stroke="none"/><path d="M14.5 2.5V7H19" fill="#87ceac" stroke="none"/><rect x="8" y="10.5" width="8" height="7" rx=".5" fill="#fff" stroke="none"/><path d="M8 13h8M8 15.3h8M11 10.5v7" stroke="#0f9d58" stroke-width=".9" fill="none"/></svg>';

  function filterQuery(id, values) {
    var p = new URLSearchParams();
    Object.keys(values).forEach(function (k) { if (values[k] !== '') p.set(k, values[k]); });
    return p.toString();
  }
  function apiUrl(id, values, format) {
    var p = new URLSearchParams();
    Object.keys(values || {}).forEach(function (k) { p.set(k, values[k]); });
    if (format) p.set('format', format);
    var q = p.toString();
    return API + '/' + encodeURIComponent(id) + (q ? '?' + q : '');
  }

  function cell(c, v, row) {
    if (c.type === 'cell' || c.type === 'cellint') {
      var key = cur.res.editable.length ? row.__key : '';
      return '<input class="cell" data-edit-key="' + esc(key) + '" data-edit-col="' + esc(c.key) + '" value="' + esc(v == null ? '' : Number(v).toFixed(c.type === 'cellint' ? 0 : 2)) + '" inputmode="' + (c.type === 'cellint' ? 'numeric' : 'decimal') + '" aria-label="' + esc(c.label) + '">';
    }
    if (v == null || v === '') return '';
    if (c.type === 'money') return money(v);
    if (c.type === 'int') return num(v);
    if (c.type === 'date') return esc(dshort(String(v)));
    if (c.type === 'pct') return (Number(v) * 100).toFixed(1) + '%';
    if (c.type === 'chip') {
      var cls = /^(Mailed|Active|Recurring|Thanked)$/.test(v) ? 'rp-tag--ok' : /^(Hold|LYBUNT|Waiting)$/.test(v) ? 'rp-tag--warn' : /^Lapsed$/.test(v) ? 'rp-tag--none' : '';
      return '<span class="rp-tag ' + cls + '">' + esc(v) + '</span>';
    }
    return esc(v);
  }
  var isRight = function (c) { return c.type === 'money' || c.type === 'int' || c.type === 'pct' || c.type === 'cell' || c.type === 'cellint'; };

  function tileValue(t) { return t.kind === 'money' ? money(t.value) : t.kind === 'int' ? num(t.value) : String(t.value); }

  var ARROW_UP = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2.5M2.8 5.5 6 2.3l3.2 3.2"/></svg>';
  var ARROW_DOWN = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v7.5M2.8 6.5 6 9.7l3.2-3.2"/></svg>';
  var ARROW_BOTH = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 4.5 2.5-2.5 2.5 2.5M3.5 7.5 6 10l2.5-2.5"/></svg>';
  var BACK = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
  var CHECK = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  function tieHtml(t) {
    if (t.status === 'none' && !t.note) return '';
    var f = function (v) { return t.kind === 'count' ? num(v) : money(v); };
    if (t.status === 'match') return '<div class="rp-tie is-ok"><span class="rp-tie__i">' + CHECK + '</span><div><b>Matches the KPI dashboard</b><span>' + esc(t.label) + ': ' + f(t.kpi) + '</span></div></div>';
    if (t.status === 'differs') return '<div class="rp-tie is-warn"><span class="rp-tie__i">!</span><div><b>Differs from the KPI dashboard by ' + f(t.diff) + '</b><span>This report ' + f(t.mine) + ', ' + esc(t.label) + ' ' + f(t.kpi) + '</span></div></div>';
    if (t.status === 'unavailable') return '<div class="rp-tie is-off"><span class="rp-tie__i" aria-hidden="true">i</span><div><b>KPI figure not available</b><span>' + esc(t.note || '') + '</span></div></div>';
    return '<div class="rp-tie is-off"><span class="rp-tie__i" aria-hidden="true">i</span><div><b>No KPI line</b><span>' + esc(t.note || '') + '</span></div></div>';
  }

  // Bars by team, from the rows on screen, only when the report has a team column and a money column.
  function teamBars(res, rows) {
    var tc = res.columns.filter(function (c) { return /^(team|credited)/i.test(c.key) || /^credited/i.test(c.label); })[0];
    var mc = res.columns.filter(function (c) { return c.type === 'money'; })[0];
    if (!tc || !mc || !rows.length) return '';
    var sums = {};
    rows.forEach(function (r) { var k = r[tc.key]; if (k) sums[k] = (sums[k] || 0) + (Number(r[mc.key]) || 0); });
    var keys = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; });
    if (!keys.length) return '';
    var max = sums[keys[0]] || 1;
    return '<div class="h-card rp-box"><div class="rp-k">By ' + esc(tc.label.toLowerCase()) + '</div><div class="rp-bars">' + keys.map(function (k) {
      return '<div class="rp-bar"><span>' + esc(k) + '</span><i><u style="width:' + Math.max(2, Math.round(sums[k] / max * 100)) + '%"></u></i><b>' + money(sums[k]) + '</b></div>';
    }).join('') + '</div></div>';
  }

  function visibleRows() {
    var res = cur.res;
    var rows = res.rows;
    var q = (cur.find || '').toLowerCase();
    if (q) rows = rows.filter(function (r) { return res.columns.some(function (c) { return String(r[c.key] == null ? '' : r[c.key]).toLowerCase().indexOf(q) >= 0; }); });
    if (cur.sort) {
      var s = cur.sort;
      rows = rows.slice().sort(function (a, b) {
        var x = a[s.k], y = b[s.k];
        if (x == null) x = ''; if (y == null) y = '';
        return s.d * ((typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y)));
      });
    }
    return rows;
  }

  // A footer total opens the rows it adds up: the report's own rows, never a new query. The total on the page stays as the server sent it.
  function openTotal(key) {
    var res = cur.res;
    var c = res.columns.filter(function (x) { return x.key === key; })[0];
    if (!c || !window.FavorDrill) return;
    var sum = 0;
    res.rows.forEach(function (r) { sum += Number(r[key]) || 0; });
    var isMoney = c.type === 'money' || c.type === 'cell';
    var shown = res.totals ? res.totals[key] : null;
    window.FavorDrill.open({
      title: (top.title ? top.title.textContent : 'Report') + ', ' + c.label + ' total',
      shown: shown == null ? null : Number(shown),
      shownType: isMoney ? 'money' : 'int',
      shownLabel: 'Total on this report',
      columns: res.columns.map(function (x) { return { key: x.key, label: x.label, type: x.type === 'money' || x.type === 'cell' ? 'money' : x.type === 'int' ? 'int' : 'text' }; }),
      rows: res.rows,
      total: Math.round(sum * 100) / 100,
      totalLabel: 'Sum of the rows below',
      rowsLabel: 'Rows in this total',
      sheetTitle: (top.title ? top.title.textContent : 'Report') + ' rows'
    });
  }

  function drawReport() {
    var res = cur.res, rows = visibleRows();
    var oldScroll = $('.rp-scroll', root), keepTop = oldScroll && !cur.top ? oldScroll.scrollTop : 0, keepLeft = oldScroll ? oldScroll.scrollLeft : 0;
    cur.top = false;
    var ps = res.pageSize, pages = Math.max(1, Math.ceil(rows.length / ps));
    cur.page = Math.min(cur.page || 0, pages - 1);
    var pageRows = rows.slice(cur.page * ps, cur.page * ps + ps);
    var searching = !!cur.find;
    var hasFlags = res.columns.some(function (c) { return c.total; });
    var totals = res.totals;
    if (searching && hasFlags) {
      totals = {};
      res.columns.forEach(function (c) { if (c.total) { var s = 0; rows.forEach(function (r) { s += Number(r[c.key]) || 0; }); totals[c.key] = Math.round(s * 100) / 100; } });
    } else if (searching) totals = {};

    var h = '<a class="rp-back" href="' + BASE + '">' + BACK + 'All reports</a><div class="h-card rp-params">';
    var shown = res.filters.filter(function (f) { return !f.showWhen || res.values[f.showWhen.id] === f.showWhen.is; });
    shown.forEach(function (f) {
      var v = res.values[f.id];
      if (f.type === 'seg') h += '<div class="rp-f"><span>' + esc(f.label) + '</span><div class="rp-seg2" role="group" aria-label="' + esc(f.label) + '">' + f.options.map(function (o) { return '<button type="button" data-f="' + f.id + '" data-v="' + esc(o[0]) + '" class="' + (v === o[0] ? 'is-on' : '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>';
      else if (f.type === 'select') h += '<label class="rp-f rp-f--dd' + (v !== f.def ? ' is-set' : '') + '"><span>' + esc(f.label) + '</span><select data-f="' + f.id + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
      else if (f.type === 'date') h += '<label class="rp-f rp-f--dd"><span>' + esc(f.label) + '</span><input type="date" data-f="' + f.id + '" value="' + esc(v) + '"></label>';
      else if (f.type === 'month') h += '<label class="rp-f rp-f--dd"><span>' + esc(f.label) + '</span><input type="month" data-f="' + f.id + '" value="' + esc(v) + '"></label>';
      else h += '<label class="rp-f rp-f--dd"><span>' + esc(f.label) + '</span><input type="text" data-f="' + f.id + '" value="' + esc(v) + '" maxlength="80"></label>';
    });
    h += '<div class="rp-acts">' + (shown.some(function (f) { return res.values[f.id] !== f.def; }) ? '<button type="button" class="rp-link" id="rp-reset">Reset</button>' : '') +
      (res.post != null ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" id="rp-copy">Copy for WhatsApp</button>' : '') +
      '<button type="button" class="h-btn h-btn--ghost h-btn--sm" id="rp-link">Copy link</button>' +
      '<a class="h-btn h-btn--ghost h-btn--sm" id="rp-csv" href="' + apiUrl(res.id, res.values, 'csv') + '" download>CSV</a>' +
      '<button type="button" class="h-btn h-btn--primary h-btn--sm" data-sheets="reports">Google Sheets</button></div></div>';

    var tie = tieHtml(res.tie);
    if (res.tiles.length || tie) {
      h += '<div class="h-card rp-sum">';
      res.tiles.forEach(function (t, i) { h += '<div class="rp-tile' + (i === 0 ? ' is-hero' : '') + (i > 0 && i === res.tiles.length - 1 && i % 2 === 1 ? ' rp-tile--wide' : '') + '"><div class="k">' + esc(t.label) + '</div><div class="n">' + esc(tileValue(t)) + '</div><div class="s">' + esc(t.sub || '') + '</div></div>'; });
      h += tie + '</div>';
    }

    var bars = teamBars(res, rows);
    var side = res.post != null || res.note || bars;
    h += '<div class="rp-main' + (side ? '' : ' is-solo') + '"><div><div class="h-card rp-tcard"><div class="rp-thead"><span class="cnt">Rows <small>' + num(rows.length) + '</small> <span class="copy-stamp" data-copy-stamp></span>' + (res.more ? ' <em>first ' + num(res.rows.length) + ' of ' + num(res.count) + '</em>' : '') + '</span><label class="rp-find"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="rp-find" placeholder="Search these rows" value="' + esc(cur.find || '') + '" aria-label="Search these rows"></label></div><div class="rp-scroll"><table class="rp-table"><thead><tr>' +
      res.columns.map(function (c) { var on = cur.sort && cur.sort.k === c.key; return '<th class="' + (isRight(c) ? 'r ' : '') + (on ? 'is-sort' : '') + '" data-sort="' + c.key + '" aria-sort="' + (on ? (cur.sort.d > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button">' + esc(c.label) + '<span class="ar">' + (on ? (cur.sort.d > 0 ? ARROW_UP : ARROW_DOWN) : ARROW_BOTH) + '</span></button></th>'; }).join('') + '</tr></thead><tbody>';
    pageRows.forEach(function (r) { h += '<tr>' + res.columns.map(function (c) { return '<td class="' + (isRight(c) ? 'r' : c.type === 'id' ? 'id' : '') + '">' + cell(c, r[c.key], r) + '</td>'; }).join('') + '</tr>'; });
    if (!pageRows.length) h += '<tr><td colspan="' + res.columns.length + '" class="rp-empty">No rows for these filters. <button type="button" class="rp-link" id="rp-clear">Clear</button></td></tr>';
    h += '</tbody>';
    // A total opens the rows it adds up (the page's own rows, never a new query). Not while searching or when the list is cut short.
    var canOpen = !searching && !res.more;
    if (Object.keys(totals).length) h += '<tfoot><tr>' + res.columns.map(function (c, i) { var v = totals[c.key]; var txt = i === 0 ? 'Total' : v == null ? '' : c.type === 'money' || c.type === 'cell' ? money(v) : num(v); if (canOpen && i > 0 && v != null) txt = '<span class="dr-num" tabindex="0" role="button" data-report-total="' + esc(c.key) + '">' + txt + '</span>'; return '<td class="' + (isRight(c) ? 'r' : '') + '">' + txt + '</td>'; }).join('') + '</tr></tfoot>';
    h += '</table></div>';
    if (rows.length > ps) h += '<div class="rp-pager"><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="rp-prev"' + (cur.page ? '' : ' disabled') + '>Previous</button><span>' + (cur.page * ps + 1) + ' to ' + Math.min(rows.length, cur.page * ps + ps) + ' of ' + num(rows.length) + '</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="rp-next"' + (cur.page + 1 < pages ? '' : ' disabled') + '>Next</button></div>';
    h += '</div></div>';
    if (side) {
      h += '<aside class="rp-side">' + bars;
      if (res.post != null) h += '<div class="h-card rp-box"><div class="rp-k">Post text</div><div class="rp-pre" id="rp-pre">' + esc(res.post) + '</div></div>';
      if (res.note) h += '<div class="h-card rp-box"><p class="rp-note">' + esc(res.note) + '</p></div>';
      h += '</aside>';
    }
    h += '</div>';
    root.innerHTML = h;
    var newScroll = $('.rp-scroll', root);
    if (newScroll) { newScroll.scrollTop = keepTop; newScroll.scrollLeft = keepLeft; }
    bindReport();
  }

  function reload(values) {
    var id = cur.id;
    var url = BASE + '?r=' + id + (Object.keys(values).length ? '&' + filterQuery(id, values) : '');
    history.replaceState(null, '', url);
    root.classList.add('is-busy');
    return get(apiUrl(id, values)).then(function (d) {
      root.classList.remove('is-busy');
      if (!d.ok) { toast(d.message || 'The report did not load.'); return; }
      cur.res = d.report; cur.page = 0;
      drawReport();
    });
  }

  function bindReport() {
    var res = cur.res;
    $$('[data-f]', root).forEach(function (el) {
      el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'change', function () {
        var v = Object.assign({}, res.values);
        v[el.dataset.f] = el.tagName === 'BUTTON' ? el.dataset.v : el.value;
        reload(v);
      });
    });
    var clr = $('#rp-clear');
    if (clr) clr.addEventListener('click', function () { cur.find = ''; drawReport(); });
    $$('[data-report-total]', root).forEach(function (el) {
      var open = function () { openTotal(el.dataset.reportTotal); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    var reset = $('#rp-reset');
    if (reset) reset.addEventListener('click', function () { cur.find = ''; cur.sort = null; reload({}); });
    $$('[data-sort]', root).forEach(function (th) { th.addEventListener('click', function () { var k = th.dataset.sort; cur.sort = cur.sort && cur.sort.k === k ? { k: k, d: -cur.sort.d } : { k: k, d: 1 }; drawReport(); }); });
    $('#rp-find').addEventListener('input', function (e) { cur.find = e.target.value; cur.page = 0; var p = e.target.selectionStart; drawReport(); var i = $('#rp-find'); i.focus(); i.setSelectionRange(p, p); });
    var pv = $('#rp-prev'), nx = $('#rp-next');
    if (pv) pv.addEventListener('click', function () { cur.page -= 1; cur.top = true; drawReport(); });
    if (nx) nx.addEventListener('click', function () { cur.page += 1; cur.top = true; drawReport(); });
    var lk = $('#rp-link');
    if (lk) lk.addEventListener('click', function () {
      var fail = function () { toast('Copy did not work. Copy the address bar instead.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(function () { toast('Link copied.'); }, fail);
      else fail();
    });
    var cp = $('#rp-copy');
    if (cp) cp.addEventListener('click', function () {
      var done = function () { toast('Post text copied.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(res.post).then(done, function () { toast('Copy did not work. Select the post text and copy it.'); });
      else toast('Copy did not work. Select the post text and copy it.');
    });
    $$('[data-edit-key]', root).forEach(function (i) {
      i.addEventListener('change', function () {
        fetch(API + '/edit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: res.id, key: i.dataset.editKey, col: i.dataset.editCol, value: i.value }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (!d.ok) { toast(d.message || 'That did not save.'); return; } reload(cur.res.values); })
          .catch(function () { toast('That did not save. Check the connection.'); });
      });
    });
  }

  if (window.FavorSheets) {
    window.FavorSheets.register('reports', function () {
      if (!cur) return null;
      return get(apiUrl(cur.id, cur.res.values, 'sheet')).then(function (d) {
        if (!d.ok) throw new Error(d.message || 'The sheet did not build.');
        return d.spec;
      });
    });
  }

  /* ---------- routing ---------- */
  function openReport(id, asked) {
    root.innerHTML = '<p class="rp-note rp-loading">Loading</p>';
    get(apiUrl(id, asked)).then(function (d) {
      if (!d.ok) {
        setHeader('KPI', 'Reports');
        root.innerHTML = '<div class="h-card rp-box"><p class="rp-note">' + esc(d.message || 'That report did not load.') + '</p><p><a class="h-btn h-btn--ghost h-btn--sm" href="' + BASE + '">All reports</a></p></div>';
        return;
      }
      cur = { id: id, res: d.report, sort: null, find: '', page: 0 };
      setHeader('Reports', d.report.name);
      drawReport();
    });
  }

  function route() {
    var p = new URLSearchParams(location.search);
    var id = p.get('r');
    if (id && /^[a-z0-9-]+$/.test(id)) {
      var asked = {};
      p.forEach(function (v, k) { if (k !== 'r' && k !== 'google') asked[k] = v; });
      openReport(id, asked);
      return;
    }
    root.innerHTML = '<p class="rp-note rp-loading">Loading</p>';
    get(API).then(function (d) {
      if (!d.ok) { root.innerHTML = '<div class="h-card rp-box"><p class="rp-note">' + esc(d.message || 'Reports did not load.') + '</p></div>'; return; }
      drawList(d);
    });
  }
  route();
})();
