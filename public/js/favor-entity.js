/* FavorEntity: the things FavorOS knows by name, drawn one way on every page.
   A colleague, a partner, a fund, an appeal code, a task, a request, a meeting, a clip or a course appears as a chip. On a computer, hovering a chip
   (or a link to one of these things) opens a card with its key facts and what you can do with it. On a phone, pressing a chip opens the same card as a sheet.
   Facts come from POST /api/hub/entity, which applies the signed-in person's access: a partner shows lifetime giving, last gift and holder only to people
   who may open the Work Center, and a thing the person may not read shows its name and nothing else.

   Use it from any page script (no setup, it loads on every page):
     FavorEntity.chip('partner', '12345', 'Ada Lovelace')      HTML for a chip. Kinds: person, partner, fund, appeal, task, request, meeting, clip, course.
     <span data-entity="task:SB-0003">SB-0003</span>            any element with data-entity="kind:id" gets the card; no script call.
     <a href="/work/partner/12345">...</a>                     links FavorOS already draws (partner, request, task, meeting, clip, course, mailto a favorintl.org address)
                                                               get the card on hover without a change.
     FavorEntity.linkify(element)                              turns task codes in text into chips (only codes that resolve for this person).
     FavorEntity.open(kind, id, anchor, label)                 opens the card by hand.
     FavorEntity.cardHtml(attachment, {esc})                   the Chat card for an attachment of type entity.
   Send to (public/js/favor-share.js) loads the first time a card needs it. Full notes for page authors: docs/ENTITIES.md. */
(function () {
  'use strict';
  if (window.FavorEntity) return;
  var UI = window.FavorUI;
  var esc = UI ? UI.esc : function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var root = document.documentElement;

  var P = {
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.4-6 7-6s6.2 2 7 6"/>',
    partner: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/>',
    fund: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.5-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
    appeal: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    request: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5 13 7 5h10l2 8v6H5z"/>',
    meeting: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    clip: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    course: '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
    page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    brain: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    send: '<path d="M21 3 3 11l7 3 3 7z"/><path d="m10 14 4-4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  };
  var ic = function (n) { return '<svg class="fe-i" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; };
  var LABEL = { person: 'Colleague', partner: 'Partner', fund: 'Fund', appeal: 'Appeal code', task: 'Task', request: 'Request', meeting: 'Meeting', clip: 'Clip', course: 'Course', page: 'Page', file: 'File' };
  var KINDS = ['person', 'partner', 'fund', 'appeal', 'task', 'request', 'meeting', 'clip', 'course'];

  /* ------------------------------------------------------------------ data */
  var cache = {}, inflight = {};
  var norm = function (kind, id) { id = String(id || '').trim(); return kind === 'person' ? id.toLowerCase() : kind === 'task' || kind === 'appeal' ? id.toUpperCase() : id; };
  var keyOf = function (kind, id) { return kind + ':' + norm(kind, id); };
  function load(kind, id) {
    var k = keyOf(kind, id), c = cache[k];
    if (c && Date.now() - c.at < 120000) return Promise.resolve(c.item);
    if (inflight[k]) return inflight[k];
    var p = fetch('/api/hub/entity?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(norm(kind, id)), { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
      .then(function (r) { return r.ok ? r.json() : { item: null }; })
      .then(function (d) { cache[k] = { at: Date.now(), item: d.item || null }; delete inflight[k]; return cache[k].item; })
      .catch(function () { delete inflight[k]; return null; });
    inflight[k] = p;
    return p;
  }
  function loadMany(refs) {
    var need = refs.filter(function (r) { var c = cache[keyOf(r.kind, r.id)]; return !(c && Date.now() - c.at < 120000); });
    if (!need.length) return Promise.resolve();
    return fetch('/api/hub/entity', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: need.slice(0, 24).map(function (r) { return { kind: r.kind, id: norm(r.kind, r.id) }; }) }) })
      .then(function (r) { return r.ok ? r.json() : { items: {} }; })
      .then(function (d) { need.slice(0, 24).forEach(function (r) { var it = (d.items || {})[r.kind + ':' + norm(r.kind, r.id)]; cache[keyOf(r.kind, r.id)] = { at: Date.now(), item: it || null }; }); })
      .catch(function () { /* the next look asks again */ });
  }

  /* ------------------------------------------------------------------ finding the entity behind an element */
  var SKIP = '.fe-card, .fe-sheet, .h-side, .h-tabs, #h-bar, .cmdk, #wm-bell, .wm-pop, .mi';
  function fromHref(h) {
    var u;
    try { u = new URL(h, location.href); } catch (_) { return null; }
    if (u.protocol === 'mailto:') { var m = decodeURIComponent(u.pathname).toLowerCase(); return /^[a-z0-9._%+-]+@favorintl\.org$/.test(m) ? { kind: 'person', id: m } : null; }
    if (u.origin !== location.origin) return null;
    var p = u.pathname.replace(/\/+$/, ''), q = u.searchParams, x;
    if ((x = p.match(/^\/work\/partner\/(\d{1,12})$/))) return { kind: 'partner', id: x[1] };
    if (p === '/requests' && q.get('r')) return { kind: 'request', id: q.get('r') };
    if ((p === '/projects/p' || p === '/projects') && q.get('t')) return { kind: 'task', id: q.get('t') };
    if ((p === '/meet/notes' || p === '/meet/room') && /^[0-9a-f]{24}$/.test(q.get('m') || '')) return { kind: 'meeting', id: q.get('m') };
    if ((x = p.match(/^\/c\/([0-9a-f]{32})$/))) return { kind: 'clip', id: x[1] };
    if (p === '/learn/c' && q.get('c')) return { kind: 'course', id: q.get('c') };
    return null;
  }
  function refOf(el) {
    if (!el || !el.closest || el.closest(SKIP)) return null;
    var d = el.closest('[data-entity]');
    if (d && !d.closest(SKIP)) {
      var v = d.getAttribute('data-entity') || '', i = v.indexOf(':');
      if (i > 0 && (KINDS.indexOf(v.slice(0, i)) >= 0)) return { kind: v.slice(0, i), id: v.slice(i + 1), el: d, label: d.getAttribute('data-label') || '' };
    }
    var mi = el.closest('.mi-chip[data-mi-id], .ch-at[data-mi-id]');
    if (mi) { var id = mi.getAttribute('data-mi-id'); if (id && id.indexOf('@') > 0) return { kind: 'person', id: id, el: mi, label: mi.textContent.replace(/^@/, '') }; }
    var a = el.closest('a[href], a[data-href]');
    if (a && !a.hasAttribute('data-fe-off')) { var r = fromHref(a.getAttribute('href') || a.getAttribute('data-href')); if (r) return { kind: r.kind, id: r.id, el: a, label: a.textContent.trim().slice(0, 80), link: true }; }
    return null;
  }

  /* ------------------------------------------------------------------ the card */
  var cardEl = null, scrim = null, curKey = '', showT = 0, hideT = 0, ovTok = null, anchorEl = null;
  var phone = function () { return !matchMedia('(hover: hover)').matches || matchMedia('(max-width: 860px)').matches; };
  var can = function (a) { return a === 'message' ? root.classList.contains('has-chat') : a === 'task' ? root.classList.contains('has-projects') : true; };
  function avatar(it) {
    if (it.kind === 'person') return it.pic ? '<span class="fe-av"><img src="' + esc(it.pic) + '" alt="" referrerpolicy="no-referrer" /></span>' : '<span class="fe-av">' + esc(UI ? UI.ini(it.title) : it.title.slice(0, 2)) + '</span>';
    return '<span class="fe-av fe-av--' + esc(it.kind) + '">' + ic(it.kind) + '</span>';
  }
  function askText(it) {
    var t = it.title;
    switch (it.kind) {
      case 'person': return 'What is on ' + t + "'s plate?";
      case 'partner': return 'Tell me about ' + (it.lookup ? 'lookup ' + it.lookup : t);
      case 'fund': return 'How is the ' + t + ' fund doing this year?';
      case 'appeal': return 'How did appeal ' + it.id + ' do?';
      case 'task': return 'What is the status of task ' + it.id + ' (' + t + ')?';
      case 'request': return 'What is the status of the request "' + t + '"?';
      case 'meeting': return 'Summarize the meeting "' + t + '"';
      case 'clip': return 'What is in the clip "' + t + '"?';
      case 'course': return 'What does the course "' + t + '" cover?';
      default: return 'Tell me about ' + t;
    }
  }
  function body(it, ref) {
    if (!it) return '<div class="fe-card__head">' + avatar({ kind: ref.kind, title: ref.label || '' }) + '<div class="fe-card__who"><b>' + esc(ref.label || LABEL[ref.kind]) + '</b><span>' + esc(LABEL[ref.kind]) + '</span></div></div><p class="fe-card__note">Not available to you.</p>';
    if (it.restricted) return '<div class="fe-card__head">' + avatar({ kind: ref.kind, title: ref.label || '' }) + '<div class="fe-card__who"><b>' + esc(ref.label || LABEL[ref.kind]) + '</b><span>' + esc(LABEL[ref.kind]) + '</span></div></div><p class="fe-card__note">' + (ref.kind === 'task' ? 'Projects access shows task details.' : 'Work Center access shows these details.') + '</p>';
    var lookup = (it.facts || []).filter(function (f) { return f.k === 'Lookup ID'; })[0];
    if (lookup) it.lookup = lookup.v;
    var acts = (it.acts || []).filter(can);
    var btns = acts.map(function (a) {
      if (a === 'open') return it.url ? '<a class="fe-btn fe-btn--main" href="' + esc(it.url) + '" data-fe-act="open">' + ic('open') + 'Open</a>' : '';
      var name = { message: 'Message', task: 'Make a task', brain: 'Ask Brain', send: 'Send to' }[a];
      return name ? '<button type="button" class="fe-btn' + (a === 'message' ? ' fe-btn--main' : '') + '" data-fe-act="' + a + '">' + ic(a === 'task' ? 'task' : a) + name + (a === 'send' ? '…' : '') + '</button>' : '';
    }).join('');
    return '<div class="fe-card__head">' + avatar(it) + '<div class="fe-card__who"><b>' + esc(it.title) + '</b><span>' + esc(it.sub || LABEL[it.kind]) + '</span></div>' +
      (phone() ? '<button type="button" class="fe-x" data-fe-act="close" aria-label="Close">' + ic('x') + '</button>' : '') + '</div>' +
      ((it.facts || []).length ? '<dl class="fe-facts">' + it.facts.map(function (f) { return '<div><dt>' + esc(f.k) + '</dt><dd>' + esc(f.v) + '</dd></div>'; }).join('') + '</dl>' : '') +
      '<div class="fe-acts">' + btns + '</div>';
  }
  function place(card, el) {
    var r = el.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, m = 10;
    var left = Math.max(m, Math.min(document.documentElement.clientWidth - w - m, r.left + r.width / 2 - w / 2));
    var below = r.bottom + 8, top = below + h > innerHeight - m && r.top - h - 8 > m ? r.top - h - 8 : Math.min(below, Math.max(m, innerHeight - h - m));
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }
  function close() {
    clearTimeout(showT); clearTimeout(hideT);
    if (cardEl) { cardEl.remove(); cardEl = null; }
    if (scrim) { scrim.remove(); scrim = null; }
    if (ovTok && window.hubOv) { var t = ovTok; ovTok = null; window.hubOv.off(t); }
    curKey = ''; anchorEl = null;
  }
  function open(kind, id, anchor, label, opts) {
    opts = opts || {};
    var ref = { kind: kind, id: id, el: anchor, label: label || '' };
    var k = keyOf(kind, id);
    if (curKey === k && cardEl) return;
    close();
    curKey = k; anchorEl = anchor;
    var sheet = phone() || opts.sheet;
    cardEl = document.createElement('div');
    cardEl.className = 'fe-card' + (sheet ? ' fe-sheet' : '');
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-label', label || LABEL[kind]);
    cardEl.innerHTML = '<div class="fe-card__head"><span class="fe-av fe-av--wait"></span><div class="fe-card__who"><b>' + esc(label || LABEL[kind]) + '</b><span>' + esc(LABEL[kind]) + '</span></div></div><div class="fe-wait"><i></i><i></i><i></i></div>';
    if (sheet) {
      scrim = document.createElement('div'); scrim.className = 'fe-scrim'; scrim.addEventListener('click', close); document.body.appendChild(scrim);
      if (window.hubOv) ovTok = window.hubOv.on(function () { ovTok = null; close(); });
    } else {
      cardEl.addEventListener('pointerenter', function () { clearTimeout(hideT); });
      cardEl.addEventListener('pointerleave', function () { hideT = setTimeout(close, 220); });
    }
    document.body.appendChild(cardEl);
    if (!sheet) place(cardEl, anchor);
    load(kind, id).then(function (it) {
      if (curKey !== k || !cardEl) return;
      if (!it && kind === 'person') { close(); return; }
      if (it && !it.title) it.title = label || '';
      cardEl.innerHTML = body(it, ref);
      cardEl.__item = it; cardEl.__ref = ref;
      if (!sheet) place(cardEl, anchor);
    });
  }

  /* ------------------------------------------------------------------ actions on the card */
  function run(act, it) {
    if (!it) return;
    var anchor = anchorEl || document.body;
    if (act === 'close') { close(); return; }
    if (act === 'brain') { close(); location.href = '/brain/?ask=' + encodeURIComponent(askText(it)); return; }
    if (act === 'message') { withShare(function (S) { close(); S.dm(it.id); }); return; }
    if (act === 'task') {
      close();
      if (window.PJLinks) window.PJLinks.makeTask({ title: it.kind === 'person' ? 'Follow up with ' + it.title : it.kind === 'task' ? 'Follow up on ' + it.title : it.title, owner: it.kind === 'person' ? it.id : undefined });
      else if (UI) UI.toast('Projects is not open to you yet.');
      return;
    }
    if (act === 'send') { withShare(function (S) { var a = anchor; close(); S.menu(a, { kind: it.kind, id: it.id, title: it.title, url: it.url, sub: it.sub, lookup: it.lookup }); }); return; }
  }
  var shareP = null;
  function withShare(fn) {
    if (window.FavorShare) { fn(window.FavorShare); return; }
    if (!shareP) shareP = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/js/favor-share.js?v=1'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    shareP.then(function () { fn(window.FavorShare); }, function () { if (UI) UI.toast('Send to did not load. Reload the page and try again.'); });
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse' || phone()) return;
    var ref = refOf(e.target);
    if (!ref) { if (cardEl && !cardEl.contains(e.target) && !(anchorEl && anchorEl.contains(e.target))) { clearTimeout(hideT); hideT = setTimeout(close, 220); } return; }
    clearTimeout(hideT); clearTimeout(showT);
    if (curKey === keyOf(ref.kind, ref.id)) return;
    showT = setTimeout(function () { open(ref.kind, ref.id, ref.el, ref.label); }, 420);
  });
  document.addEventListener('pointerout', function (e) {
    if (e.pointerType !== 'mouse') return;
    var ref = refOf(e.target);
    if (ref && !(e.relatedTarget && ref.el.contains(e.relatedTarget))) { clearTimeout(showT); if (cardEl) { clearTimeout(hideT); hideT = setTimeout(close, 260); } }
  });
  document.addEventListener('click', function (e) {
    var act = e.target.closest && e.target.closest('[data-fe-act]');
    if (act && cardEl && cardEl.contains(act)) {
      if (act.getAttribute('data-fe-act') === 'open') { close(); return; }
      e.preventDefault(); run(act.getAttribute('data-fe-act'), cardEl.__item); return;
    }
    if (cardEl && !cardEl.contains(e.target) && !(anchorEl && anchorEl.contains(e.target))) close();
    // A chip with no link of its own opens the card on a click (a keyboard or a phone has no hover). A chip that is a link goes there on a computer.
    var chip = e.target.closest && e.target.closest('.fe-chip, .fe-code, .ch-at[data-entity], .mi-chip[data-mi-id], [data-fe-click]');
    if (chip && !chip.closest(SKIP)) {
      var ref = refOf(chip);
      if (!ref) return;
      var isLink = chip.tagName === 'A' && chip.getAttribute('href');
      if (!isLink || (phone() && chip.classList.contains('fe-chip'))) { e.preventDefault(); e.stopPropagation(); open(ref.kind, ref.id, chip, ref.label || chip.textContent.trim()); }
    }
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cardEl) { var a = anchorEl; close(); if (a && a.focus) a.focus(); } });
  addEventListener('scroll', function () { if (cardEl && !cardEl.classList.contains('fe-sheet')) close(); }, true);
  document.addEventListener('hub-swapped', close);

  /* ------------------------------------------------------------------ chips and Chat cards */
  function hrefFor(kind, id, url) {
    if (url) return url;
    if (kind === 'partner') return '/work/partner/' + encodeURIComponent(id);
    return '';
  }
  function chip(kind, id, label, o) {
    o = o || {};
    var href = hrefFor(kind, id, o.url);
    var inner = '<span class="fe-chip__i">' + ic(kind) + '</span><span class="fe-chip__t">' + esc(label || id) + '</span>';
    var attrs = ' class="fe-chip fe-chip--' + esc(kind) + '" data-entity="' + esc(kind + ':' + id) + '" data-label="' + esc(label || '') + '"';
    return href ? '<a' + attrs + ' href="' + esc(href) + '">' + inner + '</a>' : '<button type="button"' + attrs + '>' + inner + '</button>';
  }
  function cardHtml(a, u) {
    var e = (u && u.esc) || esc;
    var tag = a.url ? 'a' : 'button';
    var open = a.url ? ' href="' + e(a.url) + '"' : ' type="button"';
    return '<' + tag + ' class="ch-card fe-ecard"' + open + ' data-entity="' + e(a.kind + ':' + a.id) + '" data-label="' + e(a.title) + '"' + (a.kind === 'page' ? ' data-fe-off="1"' : '') + '>' +
      '<span class="fe-ecard__ic fe-av fe-av--' + e(a.kind) + '">' + ic(a.kind) + '</span>' +
      '<span class="fe-ecard__t"><span class="ch-kicker">' + e(LABEL[a.kind] || 'Link') + '</span><span class="ch-card__t">' + e(a.title) + '</span>' + (a.sub ? '<span class="ch-card__m">' + e(a.sub) + '</span>' : '') + '</span>' +
      '<span class="ch-btn ch-btn--sm">' + (a.url ? 'Open' : 'Details') + '</span></' + tag + '>';
  }

  /* ------------------------------------------------------------------ task codes in text */
  var CODE = /\b([A-Z][A-Z0-9]{1,5}-\d{1,5})\b/g;
  var TEXT_SEL = '.ch-msg__text, .rq-msg__text, .rq__body, .blk-text, .mt-text, [data-fe-text]';
  function linkify(host) {
    if (!host || !host.querySelectorAll) return;
    var hosts = host.matches && host.matches(TEXT_SEL) ? [host] : Array.prototype.slice.call(host.querySelectorAll(TEXT_SEL));
    if (!hosts.length) return;
    var found = [];
    hosts.forEach(function (h) {
      if (h.__feDone === h.textContent) return;
      var w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode.closest('a, button, code, pre, textarea, [data-entity], .fe-chip') ? NodeFilter.FILTER_REJECT : CODE.test(n.nodeValue) ? (CODE.lastIndex = 0, NodeFilter.FILTER_ACCEPT) : NodeFilter.FILTER_REJECT; } });
      var n; while ((n = w.nextNode())) found.push({ h: h, n: n });
    });
    if (!found.length) { hosts.forEach(function (h) { h.__feDone = h.textContent; }); return; }
    var codes = {};
    found.forEach(function (f) { f.n.nodeValue.replace(CODE, function (m) { codes[m] = 1; return m; }); });
    var refs = Object.keys(codes).slice(0, 24).map(function (c) { return { kind: 'task', id: c }; });
    loadMany(refs).then(function () {
      found.forEach(function (f) {
        if (!f.n.parentNode) return;
        var t = f.n.nodeValue, frag = document.createDocumentFragment(), last = 0, hit = false, m;
        CODE.lastIndex = 0;
        while ((m = CODE.exec(t))) {
          var c = cache[keyOf('task', m[1])];
          if (!c || !c.item || c.item.restricted) continue;
          hit = true;
          frag.appendChild(document.createTextNode(t.slice(last, m.index)));
          var s = document.createElement('span'); s.className = 'fe-code'; s.setAttribute('data-entity', 'task:' + m[1]); s.setAttribute('data-label', c.item.title); s.tabIndex = 0; s.textContent = m[1]; frag.appendChild(s);
          last = m.index + m[1].length;
        }
        if (hit) { frag.appendChild(document.createTextNode(t.slice(last))); f.n.parentNode.replaceChild(frag, f.n); }
      });
      hosts.forEach(function (h) { h.__feDone = h.textContent; });
    });
  }
  var lt = 0;
  function sweep() { clearTimeout(lt); lt = setTimeout(function () { linkify(document.body); }, 350); }
  new MutationObserver(sweep).observe(document.body || document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', sweep);
  document.addEventListener('hub-swapped', sweep);

  window.FavorEntity = { chip: chip, open: open, close: close, load: load, loadMany: loadMany, linkify: linkify, cardHtml: cardHtml, ic: ic, label: LABEL, askText: askText };
})();
