/* PT: the Partners lists' shared table parts. Every list under Partners (Actions, Gifts to thank, My partners, Asks, Cadence, My week,
   Entry, Grants, Foundations and the directory) draws its density toggle, sortable headers, column chooser and pager from here, so
   they read and behave alike. Styles: src/styles/ptable.css.

     PT.density()                         'compact' or 'comfortable' (one setting for every list, kept in this browser)
     PT.densityHTML()                     the Comfortable / Compact switch
     PT.size(key, fallback)               the page size this person picked for one list (25, 50 or 100)
     PT.pager(key, { total, page, size }) the pager: "1-50 of 1,170", page numbers, Rows 25/50/100. page is 1-based.
     PT.on(key, { page, sort, cols })     handlers: page(page, size), sort(col, dir), cols(hiddenSet)
     PT.th(key, col, label, sort)         a sortable header cell; sort = { col, dir } with dir 'asc' or 'desc'
     PT.hidden(key, defaults)             the Set of column keys hidden in one list
     PT.colsHTML(key, cols)               the Columns menu; cols = [{ k, l, fixed }]
     PT.slice(list, page, size)           one page of an array

   Keyboard, on any list marked data-pt-list: j and k (or the arrow keys) move between rows marked data-pt-row, Enter opens the row
   (presses its [data-pt-open], else its first link), x presses its checkbox, / goes to the list's search box ([data-pt-search]),
   [ and ] turn the page. The Work Center's own action rows keep their own keys. */
(function () {
  'use strict';
  if (window.PT) return;
  var root = document.documentElement;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var get = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
  var SIZES = [25, 50, 100];
  var H = {};

  // Density: compact unless the person picked comfortable. A phone always gets the comfortable rows (thumb-sized).
  function density() { return get('pt.density', 'compact') === 'comfortable' ? 'comfortable' : 'compact'; }
  function applyDensity() { root.setAttribute('data-density', density()); }
  applyDensity();
  function densityHTML() {
    var d = density();
    return '<div class="pt-dens" role="group" aria-label="Row size">' +
      '<button type="button" data-pt-density="comfortable" aria-pressed="' + (d === 'comfortable') + '" title="Comfortable rows"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Comfortable</span></button>' +
      '<button type="button" data-pt-density="compact" aria-pressed="' + (d === 'compact') + '" title="Compact rows"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 9.5h16M4 14h16M4 18.5h16"/></svg><span>Compact</span></button></div>';
  }

  function size(key, fallback) { var n = Number(get('pt.size.' + key, '')); return SIZES.indexOf(n) >= 0 ? n : (fallback || 50); }
  function slice(list, page, sz) { var p = Math.max(1, page || 1); return list.slice((p - 1) * sz, p * sz); }
  function pages(total, sz) { return Math.max(1, Math.ceil((Number(total) || 0) / sz)); }
  function clampPage(page, total, sz) { return Math.min(Math.max(1, page || 1), pages(total, sz)); }

  // Page numbers with gaps: 1 ... 4 5 [6] 7 8 ... 24
  function numbers(cur, last) {
    var out = [], lo = Math.max(2, cur - 2), hi = Math.min(last - 1, cur + 2);
    if (cur <= 4) hi = Math.min(last - 1, 5);
    if (cur >= last - 3) lo = Math.max(2, last - 4);
    out.push(1);
    if (lo > 2) out.push(0);
    for (var i = lo; i <= hi; i++) out.push(i);
    if (hi < last - 1) out.push(0);
    if (last > 1) out.push(last);
    return out;
  }
  function pager(key, o) {
    var total = Number(o.total) || 0, sz = o.size || size(key), last = pages(total, sz), cur = clampPage(o.page, total, sz);
    var from = total ? (cur - 1) * sz + 1 : 0, to = Math.min(total, cur * sz);
    var noun = o.noun || 'rows';
    var nums = last > 1 ? numbers(cur, last).map(function (n) {
      return n === 0 ? '<span class="pt-gap" aria-hidden="true">…</span>' : '<button type="button" data-pt-page="' + n + '"' + (n === cur ? ' aria-current="page" class="is-on"' : '') + ' aria-label="Page ' + n + '">' + n + '</button>';
    }).join('') : '';
    return '<nav class="pt-pager" data-pt-pager="' + esc(key) + '" aria-label="Pages">' +
      '<span class="pt-range" aria-live="polite">' + (total ? from.toLocaleString('en-US') + '&ndash;' + to.toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') : 'None') + (o.label ? ' ' + esc(o.label) : '') + '</span>' +
      (last > 1 ? '<span class="pt-nums"><button type="button" data-pt-page="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + ' aria-label="Previous page">&lsaquo;</button>' + nums +
        '<button type="button" data-pt-page="' + (cur + 1) + '"' + (cur >= last ? ' disabled' : '') + ' aria-label="Next page">&rsaquo;</button></span>' : '') +
      (o.sizes === false ? '' : '<label class="pt-size"><span>Rows</span><select data-pt-size aria-label="Rows per page">' + SIZES.map(function (n) { return '<option' + (n === sz ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>') +
      '</nav>';
  }

  function hidden(key, defaults) {
    var raw = get('pt.cols.' + key, null);
    if (raw == null) return new Set(defaults || []);
    try { return new Set(JSON.parse(raw)); } catch (_) { return new Set(defaults || []); }
  }
  function colsHTML(key, cols, defaults) {
    var h = hidden(key, defaults);
    return '<details class="pt-cols" data-pt-cols="' + esc(key) + '"><summary class="h-btn h-btn--ghost h-btn--sm"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M10 5v14M15 5v14"/></svg>Columns</summary>' +
      '<div class="pt-cols__menu" role="group" aria-label="Columns shown">' + cols.map(function (c) {
        return '<label' + (c.fixed ? ' class="is-fixed"' : '') + '><input type="checkbox" data-pt-col="' + esc(c.k) + '"' + (h.has(c.k) ? '' : ' checked') + (c.fixed ? ' disabled' : '') + ' />' + esc(c.l) + '</label>';
      }).join('') + '<button type="button" class="pt-cols__reset" data-pt-colreset>Show the usual columns</button></div></details>';
  }

  function th(key, col, label, sort, cls) {
    var on = sort && sort.col === col;
    var dir = on ? sort.dir : '';
    return '<button type="button" class="pt-th' + (on ? ' is-on' : '') + (cls ? ' ' + cls : '') + '" data-pt-sortkey="' + esc(key) + '" data-pt-sort="' + esc(col) + '" aria-sort="' + (on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
      esc(label) + '<i aria-hidden="true">' + (on ? (dir === 'asc' ? '↑' : '↓') : '↕') + '</i></button>';
  }

  function on(key, handlers) { H[key] = Object.assign(H[key] || {}, handlers); }

  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var d = t.closest('[data-pt-density]');
    if (d) {
      set('pt.density', d.getAttribute('data-pt-density'));
      applyDensity();
      document.querySelectorAll('.pt-dens [data-pt-density]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pt-density') === density())); });
      document.dispatchEvent(new CustomEvent('pt:density', { detail: density() }));
      return;
    }
    var pg = t.closest('[data-pt-page]');
    if (pg && !pg.disabled) {
      var nav = pg.closest('[data-pt-pager]'); var key = nav && nav.getAttribute('data-pt-pager');
      if (key && H[key] && H[key].page) {
        H[key].page(Number(pg.getAttribute('data-pt-page')), size(key));
        var list = document.querySelector('[data-pt-list="' + key + '"]');
        var top = list && list.closest('section, .h-card');
        if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start', behavior: 'instant' in window ? 'instant' : 'auto' });
      }
      return;
    }
    var s = t.closest('[data-pt-sort]');
    if (s) {
      var k = s.getAttribute('data-pt-sortkey');
      if (H[k] && H[k].sort) {
        var col = s.getAttribute('data-pt-sort');
        var was = s.getAttribute('aria-sort');
        H[k].sort(col, was === 'descending' ? 'asc' : was === 'ascending' ? 'desc' : (s.classList.contains('pt-asc') ? 'asc' : 'desc'));
      }
      return;
    }
    var rs = t.closest('[data-pt-colreset]');
    if (rs) {
      var box = rs.closest('[data-pt-cols]'); var ck = box.getAttribute('data-pt-cols');
      try { localStorage.removeItem('pt.cols.' + ck); } catch (_) { /* private mode */ }
      if (H[ck] && H[ck].cols) H[ck].cols(null);
      return;
    }
    // A click outside an open Columns menu closes it.
    document.querySelectorAll('details.pt-cols[open]').forEach(function (m) { if (!m.contains(t)) m.removeAttribute('open'); });
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-pt-size]')) {
      var nav = t.closest('[data-pt-pager]'); var key = nav && nav.getAttribute('data-pt-pager');
      set('pt.size.' + key, t.value);
      if (H[key] && H[key].page) H[key].page(1, Number(t.value));
      return;
    }
    if (t.matches('[data-pt-col]')) {
      var box = t.closest('[data-pt-cols]'); var ck = box.getAttribute('data-pt-cols');
      var hide = []; box.querySelectorAll('[data-pt-col]').forEach(function (c) { if (!c.checked) hide.push(c.getAttribute('data-pt-col')); });
      set('pt.cols.' + ck, JSON.stringify(hide));
      if (H[ck] && H[ck].cols) H[ck].cols(new Set(hide));
    }
  });

  // Keyboard.
  var typing = function (el) { return el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable); };
  function visibleList() {
    var ls = Array.prototype.slice.call(document.querySelectorAll('[data-pt-list]'));
    return ls.find(function (l) { var r = l.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; }) || ls[0] || null;
  }
  function rowsOf(list) { return Array.prototype.slice.call(list.querySelectorAll('[data-pt-row]')); }
  function focusRow(r) {
    if (!r) return;
    rowsOf(r.closest('[data-pt-list]')).forEach(function (x) { x.tabIndex = -1; x.classList.remove('is-cursor'); });
    r.tabIndex = 0; r.classList.add('is-cursor'); r.focus({ preventScroll: true });
    var b = r.getBoundingClientRect();
    if (b.top < 90 || b.bottom > innerHeight - 70) r.scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target)) { if (e.key === 'Escape' && e.target.matches('[data-pt-search]')) e.target.blur(); return; }
    if (document.querySelector('.wc-dlg.is-on, .wc-drawer.is-on, [role="dialog"][aria-modal="true"]:not([hidden])')) return;
    // The Work Center's action rows have their own keys (work.js).
    if (e.target.closest && e.target.closest('.wc-row[data-id]')) return;
    var cur = e.target.closest && e.target.closest('[data-pt-row]');
    var list = (cur && cur.closest('[data-pt-list]')) || visibleList();
    if (!list) return;
    var key = list.getAttribute('data-pt-list');
    var rows = rowsOf(list), i = cur ? rows.indexOf(cur) : -1;
    if (e.key === 'j' || (cur && e.key === 'ArrowDown')) { e.preventDefault(); focusRow(rows[Math.min(rows.length - 1, i + 1)]); return; }
    if (e.key === 'k' || (cur && e.key === 'ArrowUp')) { e.preventDefault(); focusRow(rows[Math.max(0, i - 1)]); return; }
    if (e.key === '/') { var box = list.closest('section, .h-card, main') || document; var s = box.querySelector('[data-pt-search]') || document.querySelector('[data-pt-search]'); if (s) { e.preventDefault(); s.focus(); s.select && s.select(); } return; }
    if (e.key === '[' || e.key === ']') {
      var nav = document.querySelector('[data-pt-pager="' + key + '"]');
      if (nav) { var btns = nav.querySelectorAll('.pt-nums > button'); var b = e.key === '[' ? btns[0] : btns[btns.length - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } }
      return;
    }
    if (!cur) return;
    if (e.key === 'Enter') { var o = cur.querySelector('[data-pt-open]') || cur.querySelector('a[href]'); if (o) { e.preventDefault(); o.click(); } return; }
    if (e.key === 'x' || e.key === ' ') { var cb = cur.querySelector('input[type="checkbox"]'); if (cb) { e.preventDefault(); cb.click(); } }
  });
  // A row clicked or tabbed into becomes the keyboard's place.
  document.addEventListener('focusin', function (e) { var r = e.target.closest && e.target.closest('[data-pt-row]'); if (r && r !== e.target) { rowsOf(r.closest('[data-pt-list]')).forEach(function (x) { x.classList.remove('is-cursor'); }); r.classList.add('is-cursor'); } });

  window.PT = { esc: esc, density: density, densityHTML: densityHTML, size: size, pager: pager, on: on, th: th, hidden: hidden, colsHTML: colsHTML, slice: slice, pages: pages, clampPage: clampPage, focusRow: focusRow, SIZES: SIZES };
})();
