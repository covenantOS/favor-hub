/* Lists: build a list of partners or gifts from menus, watch the count change, save it, open it in Google Sheets.
   Everything is a menu value; the server checks each one and compiles the query (functions/_lib/lists). This file never writes SQL
   and never recomputes a figure. A saved list or a report's drill-down opens at /lists/?l=<id> or /lists/?spec=<json in base64url>. */
(function () {
  'use strict';
  var root = document.getElementById('ls-app');
  if (!root) return;
  var API = root.dataset.api || '/api/lists';
  var U = window.FavorUI || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return Number(n).toLocaleString('en-US'); };
  var money = function (n) { return U.money ? U.money(n) : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var day = function (s) { return U.day ? U.day(s) : s; };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var toastEl = document.getElementById('ls-toast');
  var toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3800); }

  function call(path, body, method) {
    var opt = body === undefined && !method ? { credentials: 'same-origin' } : { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) };
    return fetch(API + path, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); })
      .catch(function () { return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.', _status: 0 }; });
  }

  /* ---------- the spec ---------- */
  function blank(kind) {
    return {
      kind: kind || 'partners',
      partner: { status: [], deceased: 'exclude', major: 'any', type: 'any', cameIn: 'any', firstCats: [], holders: [], holderTypes: [], teams: [], holder: 'any', states: [], cities: [], zips: [], lifetime: {}, largest: {}, gifts: {}, giving: [], firstGift: {}, lastGift: {}, contactBefore: '', neverContacted: false, mailReady: false, solicitHas: [], solicitNot: [], codesHas: [], codesNot: [], attrsHas: [], attrsNot: [], relsHas: [], eventsHas: [] },
      gift: { from: '', to: '', min: null, max: null, funds: [], fundCats: [], appeals: [], appealCats: [], kinds: [], methods: [], creditedTo: [], soft: 'any' },
      columns: [], sort: { key: '', dir: 'desc' }
    };
  }
  var S = { meta: null, spec: blank(), count: null, tie: null, page: 1, data: null, savedId: '', savedName: '', busy: false, ms: null };

  function merge(into, from) {
    Object.keys(from || {}).forEach(function (k) {
      if (from[k] && typeof from[k] === 'object' && !Array.isArray(from[k]) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) merge(into[k], from[k]);
      else into[k] = from[k];
    });
    return into;
  }
  function fromSaved(spec) { var b = blank(spec && spec.kind); return merge(b, spec || {}); }
  var getp = function (path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, S.spec); };
  var setp = function (path, v) { var ks = path.split('.'); var o = S.spec; ks.slice(0, -1).forEach(function (k) { o = o[k]; }); o[ks[ks.length - 1]] = v; changed(); };

  /* ---------- little DOM helpers ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- popover ---------- */
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escClose, true); } }
  function outside(e) { if (pop && !pop.contains(e.target) && !(pop._anchor && pop._anchor.contains(e.target))) closePop(); }
  function escClose(e) { if (e.key === 'Escape') { var a = pop && pop._anchor; closePop(); if (a) a.focus(); } }
  function openPop(anchor, build) {
    var same = pop && pop._anchor === anchor;
    closePop();
    if (same) return;
    pop = el('div', { class: 'ls-pop', role: 'dialog' });
    pop._anchor = anchor;
    build(pop);
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var narrow = window.innerWidth <= 860;
    if (narrow) { pop.classList.add('is-sheet'); }
    else {
      var w = Math.min(340, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      var below = window.innerHeight - r.bottom;
      pop.style.top = (below > 300 || below > r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - pop.offsetHeight)) + 'px';
    }
    setTimeout(function () { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escClose, true); var f = pop && pop.querySelector('input'); if (f) f.focus(); }, 0);
  }

  /* ---------- field builders ---------- */
  function field(label, node, hint) { return el('div', { class: 'ls-f' }, [el('span', { class: 'ls-fl', text: label }), node, hint ? el('small', { text: hint }) : null]); }

  function seg(path, opts) {
    var wrap = el('div', { class: 'ls-seg', role: 'group' });
    opts.forEach(function (o) {
      var b = el('button', { type: 'button', text: o[1], 'aria-pressed': String(getp(path) === o[0]), onclick: function () { setp(path, o[0]); [].forEach.call(wrap.children, function (x, i) { x.setAttribute('aria-pressed', String(opts[i][0] === o[0])); }); } });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function chips(path, opts) {
    var wrap = el('div', { class: 'ls-chips', role: 'group' });
    opts.forEach(function (o) {
      var on = (getp(path) || []).indexOf(o[0]) >= 0;
      wrap.appendChild(el('button', { type: 'button', class: 'ls-chip', 'aria-pressed': String(on), text: o[1], onclick: function (e) {
        var cur = (getp(path) || []).slice(); var i = cur.indexOf(o[0]);
        if (i >= 0) cur.splice(i, 1); else cur.push(o[0]);
        e.currentTarget.setAttribute('aria-pressed', String(i < 0)); setp(path, cur);
      } }));
    });
    return wrap;
  }
  function check(path, label) {
    var id = 'c' + Math.random().toString(36).slice(2, 8);
    var box = el('input', { type: 'checkbox', id: id, onchange: function (e) { setp(path, e.target.checked); } });
    box.checked = getp(path) === true;
    return el('label', { class: 'ls-check', for: id }, [box, label]);
  }
  function numIn(path, ph) {
    var i = el('input', { type: 'text', inputmode: 'decimal', placeholder: ph, 'aria-label': ph, onchange: function (e) { var v = e.target.value.replace(/[$,\s]/g, ''); setp(path, v === '' || isNaN(Number(v)) ? null : Number(v)); } });
    var v = getp(path); if (v !== null && v !== undefined && v !== '') i.value = v;
    return i;
  }
  function range(path, unit) { return el('div', { class: 'ls-pair' }, [numIn(path + '.min', unit ? 'Min ' + unit : 'Min'), el('i', { text: 'to' }), numIn(path + '.max', unit ? 'Max ' + unit : 'Max')]); }
  function dateIn(path, ph) { var i = el('input', { type: 'date', 'aria-label': ph, onchange: function (e) { setp(path, e.target.value); } }); i.value = getp(path) || ''; return i; }
  function span(path) { return el('div', { class: 'ls-pair' }, [dateIn(path + '.from', 'From'), el('i', { text: 'to' }), dateIn(path + '.to', 'To')]); }
  function textList(path, ph) {
    var i = el('input', { type: 'text', placeholder: ph, 'aria-label': ph, onchange: function (e) { setp(path, e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)); } });
    i.value = (getp(path) || []).join(', ');
    return i;
  }

  /* A menu with a search box: selected values show as chips with a remove mark, "Add" opens the list. */
  function multi(path, label, optsFn) {
    var holder = el('div', { class: 'ls-multi' });
    function draw() {
      holder.textContent = '';
      var cur = getp(path) || [];
      var opts = optsFn();
      var name = function (v) { var o = opts.find(function (x) { return x[0] === v; }); return o ? o[1] : v; };
      cur.forEach(function (v) { holder.appendChild(el('button', { type: 'button', class: 'ls-tag', title: 'Remove ' + name(v), onclick: function () { setp(path, cur.filter(function (x) { return x !== v; })); draw(); } }, [name(v), el('span', { 'aria-hidden': 'true', text: '×' })])); });
      var add = el('button', { type: 'button', class: 'ls-add', text: cur.length ? 'Add' : label, 'aria-haspopup': 'dialog' });
      add.addEventListener('click', function () {
        openPop(add, function (p) {
          var all = optsFn();
          var q = el('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search ' + label.toLowerCase() });
          var list = el('div', { class: 'ls-opts', role: 'listbox', 'aria-multiselectable': 'true' });
          function fill() {
            list.textContent = '';
            var t = q.value.trim().toLowerCase();
            var shown = all.filter(function (o) { return !t || (o[1] + ' ' + (o[2] || '')).toLowerCase().indexOf(t) >= 0; }).slice(0, 120);
            if (!shown.length) list.appendChild(el('p', { class: 'ls-none', text: 'Nothing matches' }));
            shown.forEach(function (o) {
              var on = (getp(path) || []).indexOf(o[0]) >= 0;
              list.appendChild(el('button', { type: 'button', role: 'option', 'aria-selected': String(on), class: 'ls-opt', onclick: function () {
                var c = (getp(path) || []).slice(); var i = c.indexOf(o[0]); if (i >= 0) c.splice(i, 1); else c.push(o[0]);
                setp(path, c); fill(); draw();
              } }, [el('b', { text: o[1] }), o[2] ? el('small', { text: o[2] }) : null]));
            });
          }
          q.addEventListener('input', fill);
          p.appendChild(q); p.appendChild(list); fill();
        });
      });
      holder.appendChild(add);
    }
    draw();
    holder._redraw = draw;
    return holder;
  }

  /* ---------- the criteria card ---------- */
  var M = function () { return S.meta.menus || {}; };
  var plain = function (arr) { return (arr || []).map(function (v) { return [v, v]; }); };
  function section(title, open, kids, id) {
    var d = el('details', { class: 'ls-sec', 'data-sec': id }, [el('summary', {}, [el('span', { text: title }), el('b', { class: 'ls-secn', 'data-n': id })])].concat(kids));
    if (open) d.open = true;
    return d;
  }

  function givingBlocks() {
    var wrap = el('div', { class: 'ls-giving' });
    function draw() {
      wrap.textContent = '';
      var gs = S.spec.partner.giving;
      gs.forEach(function (g, i) {
        var base = 'partner.giving.' + i;
        wrap.appendChild(el('div', { class: 'ls-gv' }, [
          el('span', { class: 'ls-fl', text: 'Gave between' }),
          span(base),
          range(base, '$'),
          el('button', { type: 'button', class: 'ls-x', 'aria-label': 'Remove this period', text: '×', onclick: function () { gs.splice(i, 1); changed(); draw(); } })
        ]));
      });
      if (gs.length < 3) wrap.appendChild(el('button', { type: 'button', class: 'ls-add', text: gs.length ? 'Add another period' : 'Giving in a period', onclick: function () { gs.push({ from: '', to: '', min: null, max: null }); draw(); } }));
    }
    draw();
    return wrap;
  }

  function criteria() {
    var m = M();
    var holders = function () { return (m.holders || []).map(function (h) { return [h.id, h.name, h.team ? (m.teams.find(function (t) { return t.id === h.team; }) || { label: h.team }).label : '']; }); };
    var teams = function () { return (m.teams || []).map(function (t) { return [t.id, t.label]; }); };
    var funds = function () { return (m.funds || []).map(function (f) { return [f.id, f.name, f.inactive ? 'Closed fund' : f.category]; }); };
    var appeals = function () { return (m.appeals || []).map(function (a) { return [a.id, a.code, a.name]; }); };
    var out = el('div', { class: 'ls-secs' });
    out.appendChild(section('Partner status', true, [
      field('Status', chips('partner.status', [['active', 'Active'], ['lybunt', 'LYBUNT'], ['lapsed', 'Lapsed']])),
      field('Major', seg('partner.major', [['any', 'Any'], ['yes', 'Major'], ['no', 'Not major']])),
      field('Type', seg('partner.type', [['any', 'Any'], ['individual', 'Individuals'], ['organization', 'Organizations']])),
      field('Came in through', seg('partner.cameIn', [['any', 'Any'], ['acquisition', 'Acquisition'], ['other', 'Other']])),
      field('First appeal category', multi('partner.firstCats', 'Pick categories', function () { return plain(m.firstCats); })),
      field('Deceased and inactive', seg('partner.deceased', [['exclude', 'Leave out'], ['include', 'Include'], ['only', 'Only']]))
    ], 'status'));
    out.appendChild(section('Held by', false, [
      field('Person', multi('partner.holders', 'Pick people', holders)),
      field('Team', multi('partner.teams', 'Pick teams', teams)),
      field('Role', multi('partner.holderTypes', 'Pick roles', function () { return plain(m.holderTypes); })),
      field('Holder', seg('partner.holder', [['any', 'Any'], ['some', 'Has one'], ['none', 'None']]))
    ], 'held'));
    out.appendChild(section('Place', false, [
      field('State', multi('partner.states', 'Pick states', function () { return plain(m.states); })),
      field('City', textList('partner.cities', 'Tampa, Austin')),
      field('ZIP starts with', textList('partner.zips', '336, 78701'))
    ], 'place'));
    out.appendChild(section('Giving', false, [
      field('Lifetime giving', range('partner.lifetime', '$')),
      field('Largest gift', range('partner.largest', '$')),
      field('Number of gifts', range('partner.gifts')),
      givingBlocks(),
      field('First gift', span('partner.firstGift')),
      field('Last gift', span('partner.lastGift'))
    ], 'giving'));
    out.appendChild(section('Gifts', false, [
      field('Gift date', span('gift')),
      field('Gift amount', range('gift', '$')),
      field('Fund', multi('gift.funds', 'Pick funds', funds)),
      field('Fund category', multi('gift.fundCats', 'Pick categories', function () { return plain(m.fundCats); })),
      field('Appeal', multi('gift.appeals', 'Pick appeals', appeals)),
      field('Appeal category', multi('gift.appealCats', 'Pick categories', function () { return plain(m.appealCats); })),
      field('Gift type', chips('gift.kinds', [['one_time', 'One-time'], ['recurring', 'Recurring']])),
      field('Paid by', multi('gift.methods', 'Pick methods', function () { return plain(m.methods); })),
      field('Fundraiser credit', multi('gift.creditedTo', 'Pick people', holders)),
      field('Soft credit', seg('gift.soft', [['any', 'Any'], ['yes', 'Soft credited'], ['no', 'Not soft credited']]))
    ], 'gifts'));
    out.appendChild(section('Records', false, [
      field('Has solicit code', multi('partner.solicitHas', 'Pick codes', function () { return plain(m.solicit); })),
      field('Lacks solicit code', multi('partner.solicitNot', 'Pick codes', function () { return plain(m.solicit); })),
      field('Constituent code', multi('partner.codesHas', 'Pick codes', function () { return plain(m.codes); })),
      field('Lacks constituent code', multi('partner.codesNot', 'Pick codes', function () { return plain(m.codes); })),
      field('Attribute', multi('partner.attrsHas', 'Pick attributes', function () { return plain(m.attrs); })),
      field('Relationship', multi('partner.relsHas', 'Pick relationships', function () { return plain(m.rels); })),
      field('Event', multi('partner.eventsHas', 'Pick events', function () { return plain(m.events); })),
      field('No contact since', dateIn('partner.contactBefore', 'No contact since')),
      check('partner.neverContacted', 'Never contacted'),
      check('partner.mailReady', 'Mail-ready only')
    ], 'records'));
    return out;
  }

  /* How many criteria are set in each section, shown beside its title. */
  function sectionCounts() {
    var p = S.spec.partner, g = S.spec.gift;
    var rg = function (r) { return r && (r.min != null || r.max != null) ? 1 : 0; };
    var sp = function (r) { return r && (r.from || r.to) ? 1 : 0; };
    var c = {
      status: p.status.length + (p.major !== 'any') + (p.type !== 'any') + (p.cameIn !== 'any') + p.firstCats.length + (p.deceased !== 'exclude'),
      held: p.holders.length + p.teams.length + p.holderTypes.length + (p.holder !== 'any'),
      place: p.states.length + p.cities.length + p.zips.length,
      giving: rg(p.lifetime) + rg(p.largest) + rg(p.gifts) + p.giving.length + sp(p.firstGift) + sp(p.lastGift),
      gifts: sp(g) + rg(g) + g.funds.length + g.fundCats.length + g.appeals.length + g.appealCats.length + g.kinds.length + g.methods.length + g.creditedTo.length + (g.soft !== 'any'),
      records: p.solicitHas.length + p.solicitNot.length + p.codesHas.length + p.codesNot.length + p.attrsHas.length + p.relsHas.length + p.eventsHas.length + (p.contactBefore ? 1 : 0) + (p.neverContacted ? 1 : 0) + (p.mailReady ? 1 : 0)
    };
    var total = 0;
    Object.keys(c).forEach(function (k) { c[k] = Number(c[k]); total += c[k]; var n = root.querySelector('[data-n="' + k + '"]'); if (n) n.textContent = c[k] ? String(c[k]) : ''; });
    var t = $('#ls-critn'); if (t) t.textContent = total ? String(total) : '';
    var clr = $('#ls-clear'); if (clr) clr.hidden = !total;
    return total;
  }

  /* ---------- results ---------- */
  var timer, rowTimer, seq = 0;
  function changed() { sectionCounts(); S.page = 1; clearTimeout(timer); clearTimeout(rowTimer); timer = setTimeout(refreshCount, 180); rowTimer = setTimeout(refreshRows, 380); }

  function refreshCount() {
    var my = ++seq;
    call('/count', { spec: S.spec }).then(function (d) {
      if (my !== seq) return;
      if (d.ok === false) { drawSum(null, d.message); return; }
      S.count = d.count; S.tie = d.tie; S.ms = d.ms; S.left = d.leftOut || 0; drawSum();
    });
  }
  function refreshRows() {
    var my = seq;
    S.busy = true; $('#ls-table') && $('#ls-table').classList.add('is-busy');
    call('/rows', { spec: S.spec, page: S.page }).then(function (d) {
      S.busy = false;
      if (my !== seq) return;
      if (d.ok === false) { $('#ls-table').innerHTML = '<p class="rp-note ls-pad">' + esc(d.message || 'The list did not load.') + '</p>'; return; }
      S.data = d; S.count = d.count; drawTable();
    });
  }

  function countWords() {
    var c = S.count; if (!c) return ['—', ''];
    var gifts = S.spec.kind === 'gifts';
    return [num(c.n), gifts ? (c.n === 1 ? 'gift' : 'gifts') : (c.n === 1 ? 'partner' : 'partners')];
  }
  function drawSum(_, err) {
    var host = $('#ls-sum'); if (!host) return;
    var c = S.count;
    var w = countWords();
    var gifts = S.spec.kind === 'gifts';
    var facts = [];
    if (c) {
      facts.push(gifts ? money(c.total) + ' credited' : money(c.total) + ' lifetime');
      if (gifts) facts.push(num(c.partners) + (c.partners === 1 ? ' partner' : ' partners'));
      if (S.spec.partner.mailReady && S.left) facts.push(num(S.left) + ' left out (Do Not Mail or no valid address)');
    }
    var tie = S.tie
      ? '<div class="ls-tie ' + (S.tie.status === 'match' ? 'is-ok' : S.tie.status === 'differs' ? 'is-warn' : 'is-off') + '"><span class="ls-tie__i" aria-hidden="true">' + (S.tie.status === 'match' ? '✓' : '≠') + '</span><div><b>' + (S.tie.status === 'match' ? 'Ties to the KPI dashboard' : S.tie.status === 'differs' ? 'Differs from the KPI dashboard' : 'KPI dashboard not answering') + '</b><span>' + esc(S.tie.label) + ': ' + (S.tie.kpi == null ? '—' : num(S.tie.kpi)) + (S.tie.status === 'differs' ? ' · this list ' + num(S.tie.mine) + (S.tie.note ? ' · ' + esc(S.tie.note) : '') : '') + '</span></div></div>'
      : '';
    host.innerHTML = '<div class="ls-big"><b data-flow="lists-count">' + w[0] + '</b><span>' + w[1] + '</span></div><div class="ls-facts">' + (err ? esc(err) : esc(facts.join(' · '))) + '</div>' + tie;
  }

  function cell(col, v, row) {
    if (v == null || v === '') return '';
    if (col.type === 'money') return esc(money(v));
    if (col.type === 'int') return esc(num(v));
    if (col.type === 'date') return esc(day(v));
    if (col.type === 'chip') return '<span class="ls-st ls-st--' + String(v).toLowerCase() + '">' + esc(v) + '</span>';
    if (col.key === 'partner' && row._rid) return '<a href="/work/partner/' + encodeURIComponent(row._rid) + '">' + esc(v) + '</a>';
    return esc(v);
  }
  function drawTable() {
    var host = $('#ls-table'); if (!host || !S.data) return;
    var d = S.data, cols = d.columns;
    host.classList.remove('is-busy');
    var sortKey = S.spec.sort.key || (S.spec.kind === 'gifts' ? 'gift_date' : 'last_gift');
    var head = cols.map(function (c) {
      var on = c.key === sortKey;
      return '<th class="' + (c.type === 'money' || c.type === 'int' ? 'r ' : '') + (on ? 'is-sort' : '') + '" aria-sort="' + (on ? (S.spec.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + esc(c.key) + '">' + esc(c.label) + '<span class="ar">' + (on ? (S.spec.sort.dir === 'asc' ? '↑' : '↓') : '') + '</span></button></th>';
    }).join('');
    var body = d.rows.map(function (r) {
      return '<tr>' + cols.map(function (c) { return '<td class="' + (c.type === 'money' || c.type === 'int' ? 'r' : c.type === 'id' ? 'id' : '') + '">' + cell(c, r[c.key], r) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var pages = Math.max(1, Math.ceil(d.count.n / d.pageSize));
    host.innerHTML = '<div class="ls-scroll rp-scroll"><table class="rp-table ls-t"><thead><tr>' + head + '</tr></thead><tbody>' + (body || '<tr><td class="rp-empty" colspan="' + cols.length + '">No rows</td></tr>') + '</tbody></table></div>' +
      (pages > 1 ? '<div class="rp-pager"><span>' + num((d.page - 1) * d.pageSize + 1) + ' to ' + num(Math.min(d.page * d.pageSize, d.count.n)) + ' of ' + num(d.count.n) + '</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pg="-1"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pg="1"' + (d.page >= pages ? ' disabled' : '') + '>Next</button></div>' : '');
    host.querySelectorAll('[data-sort]').forEach(function (b) { b.addEventListener('click', function () {
      var k = b.dataset.sort; var asc = S.spec.sort.key === k && S.spec.sort.dir === 'desc';
      S.spec.sort = { key: k, dir: asc ? 'asc' : 'desc' }; S.page = 1; refreshRows();
    }); });
    host.querySelectorAll('[data-pg]').forEach(function (b) { b.addEventListener('click', function () { S.page += Number(b.dataset.pg); refreshRows(); }); });
  }

  /* ---------- columns, saved lists, exports ---------- */
  function availableColumns() { return (S.meta.columns || []).filter(function (c) { return (!c.only || c.only === S.spec.kind) && (c.live !== 'contact' || S.meta.contacts); }); }
  function columnsPop(anchor) {
    openPop(anchor, function (p) {
      var avail = availableColumns();
      var shown = (S.data ? S.data.columns : []).map(function (c) { return c.key; });
      var chosen = S.spec.columns.length ? S.spec.columns.slice() : shown;
      p.appendChild(el('p', { class: 'ls-pt', text: 'Columns' }));
      var list = el('div', { class: 'ls-opts' });
      avail.forEach(function (c) {
        var id = 'col' + c.key;
        var box = el('input', { type: 'checkbox', id: id }); box.checked = chosen.indexOf(c.key) >= 0;
        box.addEventListener('change', function () {
          var next = avail.map(function (x) { return x.key; }).filter(function (k) { return k === c.key ? box.checked : chosen.indexOf(k) >= 0; });
          chosen = next; S.spec.columns = next.length ? next : []; refreshRows();
        });
        list.appendChild(el('label', { class: 'ls-copt', for: id }, [box, c.label]));
      });
      p.appendChild(list);
      if (S.spec.kind === 'partners') p.appendChild(el('button', { type: 'button', class: 'ls-link', text: 'Mail house columns', onclick: function () {
        S.spec.columns = ['addressee', 'salutation', 'address', 'city', 'state', 'zip', 'lookup'].filter(function (k) { return avail.some(function (c) { return c.key === k; }); });
        S.spec.partner.mailReady = true; closePop(); draw(); changed();
      } }));
      p.appendChild(el('button', { type: 'button', class: 'ls-link', text: 'Reset to the usual columns', onclick: function () { S.spec.columns = []; closePop(); refreshRows(); } }));
    });
  }

  var SCOPE_WORDS = { private: 'Only me', team: 'My team', all: 'Everyone' };
  function savedPop(anchor) {
    openPop(anchor, function (p) {
      var list = S.meta.saved || [];
      p.appendChild(el('p', { class: 'ls-pt', text: 'Saved lists' }));
      if (!list.length) p.appendChild(el('p', { class: 'ls-none', text: 'None yet' }));
      var box = el('div', { class: 'ls-opts' });
      list.forEach(function (s) {
        box.appendChild(el('button', { type: 'button', class: 'ls-opt', onclick: function () { loadSaved(s); closePop(); } }, [el('b', { text: s.name }), el('small', { text: (s.mine ? 'You' : s.ownerName) + ' · ' + SCOPE_WORDS[s.scope] + (s.scope === 'team' && s.team ? '' : '') })]));
      });
      p.appendChild(box);
    });
  }
  function loadSaved(s) { S.spec = fromSaved(s.spec); S.savedId = s.id; S.savedName = s.name; S.page = 1; draw(); history.replaceState(null, '', '/lists/?l=' + encodeURIComponent(s.id)); }

  function saveDialog(anchor) {
    openPop(anchor, function (p) {
      var cur = (S.meta.saved || []).find(function (s) { return s.id === S.savedId; });
      var mine = cur && cur.mine;
      var name = el('input', { type: 'text', placeholder: 'List name', maxlength: '80', 'aria-label': 'List name' }); name.value = mine ? cur.name : '';
      var scope = el('div', { class: 'ls-seg' });
      var pick = mine ? cur.scope : 'private';
      [['private', 'Only me'], ['team', 'My team'], ['all', 'Everyone']].forEach(function (o) { scope.appendChild(el('button', { type: 'button', text: o[1], 'aria-pressed': String(o[0] === pick), onclick: function () { pick = o[0]; [].forEach.call(scope.children, function (b, i) { b.setAttribute('aria-pressed', String(['private', 'team', 'all'][i] === pick)); }); } })); });
      var go = el('button', { type: 'button', class: 'h-btn h-btn--ghost h-btn--sm', text: mine ? 'Update' : 'Save', onclick: function () {
        call(mine ? '/saved/' + cur.id : '/saved', { name: name.value, scope: pick, spec: S.spec }, mine ? 'PUT' : undefined).then(function (d) {
          if (!d.ok) { toast(d.message || 'The list did not save.'); return; }
          closePop(); S.savedId = d.saved.id; S.savedName = d.saved.name; reloadSaved(); toast('Saved'); history.replaceState(null, '', '/lists/?l=' + encodeURIComponent(d.saved.id)); drawBar();
        });
      } });
      p.appendChild(el('p', { class: 'ls-pt', text: mine ? 'Update this list' : 'Save this list' }));
      p.appendChild(name); p.appendChild(field('Share with', scope));
      var row = el('div', { class: 'ls-prow' }, [go]);
      if (mine) row.appendChild(el('button', { type: 'button', class: 'ls-danger', text: 'Delete', onclick: function () {
        call('/saved/' + cur.id, undefined, 'DELETE').then(function (d) {
          if (!d.ok) { toast(d.message || 'Not deleted.'); return; } closePop(); S.savedId = ''; S.savedName = ''; reloadSaved(); history.replaceState(null, '', '/lists/'); drawBar(); toast('Deleted');
        });
      } }));
      p.appendChild(row);
    });
  }
  function reloadSaved() { call('').then(function (d) { if (d.ok !== false) { S.meta.saved = d.saved; } }); }

  function csv() {
    fetch(API + '/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ spec: S.spec, format: 'csv', title: S.savedName || (S.spec.kind === 'gifts' ? 'Gift list' : 'Partner list') }) })
      .then(function (r) { if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || 'The file did not build.'); }); return r.blob().then(function (b) { return [b, (r.headers.get('Content-Disposition') || '').replace(/.*filename="([^"]+)".*/, '$1')]; }); })
      .then(function (x) { var a = document.createElement('a'); a.href = URL.createObjectURL(x[0]); a.download = x[1] || 'list.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); })
      .catch(function (e) { toast(e.message); });
  }

  /* ---------- page frame ---------- */
  function drawBar() {
    var b = $('#ls-bar'); if (!b) return;
    var cur = S.savedName ? '<span class="ls-cur">' + esc(S.savedName) + '</span>' : '';
    b.querySelector('.ls-curwrap').innerHTML = cur;
  }
  function stamp() {
    var m = S.meta.snapshot; if (!m) return 'No data yet';
    var d = new Date(m.builtAt);
    return 'Data as of ' + (U.when ? U.when(d) : d.toLocaleString('en-US'));
  }
  function draw() {
    if (!S.meta.snapshot) {
      root.innerHTML = '<div class="h-card ls-pad"><p class="rp-note">The lists data has not been built yet.' + (S.meta.admin ? ' <button type="button" class="ls-link" id="ls-build">Build it now</button>' : '') + '</p></div>';
      var bb = $('#ls-build'); if (bb) bb.addEventListener('click', function () { bb.textContent = 'Building'; bb.disabled = true; fetch(API + '/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(function () { location.reload(); }); });
      return;
    }
    var gifts = S.spec.kind === 'gifts';
    root.innerHTML =
      '<div class="ls-top" id="ls-bar"><div class="rp-seg2" role="group" aria-label="List of"><button type="button" data-kind="partners" class="' + (!gifts ? 'is-on' : '') + '">Partners</button><button type="button" data-kind="gifts" class="' + (gifts ? 'is-on' : '') + '">Gifts</button></div><span class="ls-curwrap"></span>' +
      '<span class="ls-grow"></span><span class="ls-stamp">' + esc(stamp()) + '</span>' +
      '<button type="button" class="ls-quiet" id="ls-saved">Saved lists <span class="ls-caret" aria-hidden="true"></span></button></div>' +
      '<div class="ls-grid"><details class="h-card ls-crit" id="ls-critc" open><summary class="ls-crit__h"><span>Criteria <b id="ls-critn"></b></span><button type="button" class="ls-link" id="ls-clear" hidden>Clear</button></summary><div id="ls-critbody"></div><div class="ls-show"><button type="button" class="h-btn h-btn--primary h-btn--sm" id="ls-show">Show results</button></div></details>' +
      '<div class="ls-out"><div class="h-card ls-sumc"><div id="ls-sum" class="ls-sum"></div><div class="ls-acts"><button type="button" class="ls-quiet" id="ls-save">Save list</button><button type="button" class="ls-quiet" id="ls-cols">Columns <span class="ls-caret" aria-hidden="true"></span></button><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="ls-csv">CSV</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-sheets="lists">Open in Google Sheets</button></div></div>' +
      '<div class="h-card ls-tcard"><div id="ls-table" class="ls-tbl"><p class="rp-note ls-pad rp-loading">Loading</p></div></div></div></div>';
    $('#ls-critbody').appendChild(criteria());
    drawBar();
    sectionCounts();
    root.querySelectorAll('[data-kind]').forEach(function (b) { b.addEventListener('click', function () {
      if (S.spec.kind === b.dataset.kind) return;
      S.spec.kind = b.dataset.kind; S.spec.columns = []; S.spec.sort = { key: '', dir: 'desc' }; S.data = null; draw(); changed();
    }); });
    $('#ls-saved').addEventListener('click', function (e) { savedPop(e.currentTarget); });
    $('#ls-save').addEventListener('click', function (e) { saveDialog(e.currentTarget); });
    $('#ls-cols').addEventListener('click', function (e) { columnsPop(e.currentTarget); });
    $('#ls-csv').addEventListener('click', csv);
    $('#ls-show').addEventListener('click', function () { $('#ls-critc').open = false; $('#ls-sum').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    $('#ls-clear').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); S.spec = blank(S.spec.kind); S.savedId = ''; S.savedName = ''; history.replaceState(null, '', '/lists/'); draw(); changed(); });
    if (window.innerWidth <= 860) $('#ls-critc').open = false;
    drawSum(); refreshCount(); refreshRows();
  }

  if (window.FavorSheets) {
    window.FavorSheets.register('lists', function () {
      return fetch(API + '/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ spec: S.spec, format: 'sheet', title: S.savedName || (S.spec.kind === 'gifts' ? 'Gift list' : 'Partner list') }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (!d.ok) throw new Error(d.message || 'The sheet did not build.'); return d.spec; });
    });
  }

  /* ---------- start ---------- */
  function b64(s) { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } }
  call('').then(function (d) {
    if (d.ok === false) { root.innerHTML = '<div class="h-card ls-pad"><p class="rp-note">' + esc(d.message || 'Lists did not load.') + '</p></div>'; return; }
    S.meta = d;
    var q = new URLSearchParams(location.search);
    var id = q.get('l'), raw = q.get('spec');
    var s = id && (d.saved || []).find(function (x) { return x.id === id; });
    if (s) { S.spec = fromSaved(s.spec); S.savedId = s.id; S.savedName = s.name; }
    else if (raw) { var sp = b64(raw); if (sp) S.spec = fromSaved(sp); }
    draw();
  });
})();
