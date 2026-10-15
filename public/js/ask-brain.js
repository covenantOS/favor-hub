/* Ask Favor Brain from anything, and answers back out.
   1. Select text in an email, a Chat message, a task, a request, meeting notes, a partner page or any page: an "Ask Favor Brain" button
      shows beside the selection. It opens Favor Brain in the side dock with the selection as the context (the full Brain page on a phone
      or where the dock is not shown). Mail's message bodies are frames; Mail forwards their selection as the window event
      'favor-mail-selection' { text, rect }.
   2. Every Favor Brain answer (dock and Brain page) can be dragged into what you are writing (a Chat message, a task, the email
      composer) and has Send to email, which hands the answer to the composer (window.FavorCompose.add) as an item:
      { kind: 'brain', title, text, html, rows?, csv?, partner, mayShare }. The composer refuses partner data a person may not share.
   The Brain's own rules decide what it answers (the person's packages, field scope); nothing here widens them.
     FavorAskBrain.ask(text, source)          open the Brain with this context
     FavorAskBrain.compose(question, ctx)     the question sent with a context
     FavorAskBrain.footer()                   the drag handle and Send to email row for an answer
     FavorAskBrain.register(fn)               fn(el) returns the answer (turn) an element belongs to, or null */
(function () {
  'use strict';
  if (window.FavorAskBrain) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var root = document.documentElement;
  var resolvers = [];
  var pill = null, cur = null, hideT = 0;
  var MIN = 2, MAX = 2000;

  function brainOn() { return !(root.classList.contains('is-field') && !root.classList.contains('has-brain')); }
  function onBrainPage() { return (document.body && document.body.dataset.nav === 'brain') || /^\/brain(\/|$)/.test(location.pathname); }

  /* ---------------------------------------------------------------- where a selection came from */
  var SOURCES = [
    ['[data-brain-context="mail"], .ml-thread, .fc-win', 'an email'],
    ['.rq, [data-request-drawer]', 'a request'],
    ['.pj-dr, [data-task-drawer]', 'a task'],
    ['.pp, [data-partner]', 'a partner page'],
    ['.fd, .ch-msg, .ch-thread, [data-chat-msg]', 'a Chat message'],
  ];
  function sourceOf(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var tagged = el && el.closest('[data-brain-context]');
    if (tagged) {
      var k = tagged.getAttribute('data-brain-context');
      return { mail: 'an email', chat: 'a Chat message', task: 'a task', request: 'a request', note: 'a note', notes: 'meeting notes', doc: 'a document', partner: 'a partner page' }[k] || 'this page';
    }
    for (var i = 0; i < SOURCES.length; i++) if (el && el.closest(SOURCES[i][0])) return SOURCES[i][1];
    var p = location.pathname;
    if (/^\/chat/.test(p)) return 'a Chat message';
    if (/^\/mail/.test(p)) return 'an email';
    if (/^\/projects/.test(p)) return 'a task';
    if (/^\/requests/.test(p)) return 'a request';
    if (/^\/meet/.test(p)) return 'meeting notes';
    if (/^\/work\/partner/.test(p)) return 'a partner page';
    return (document.title || 'this page').replace(/\s*[-|]\s*FavorOS.*$/, '');
  }
  function skip(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return true;
    // The Brain itself, the menu, the top bar, sheets and form fields are left alone.
    return !!el.closest('[data-brain], .fp-conv[data-brain], .h-side, .h-top, .fx-sheet, .rt-sheet, .fx-askpill, input, textarea, select, .h-nav, nav');
  }

  /* ---------------------------------------------------------------- the button beside a selection */
  function ensurePill() {
    if (pill) return pill;
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'fx-askpill';
    pill.hidden = true;
    pill.innerHTML = '<span class="fx-askpill__dot" aria-hidden="true"></span>Ask Favor Brain';
    pill.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pill.addEventListener('click', function () { var c = cur; hide(); if (c) ask(c.text, c.source); });
    document.body.appendChild(pill);
    return pill;
  }
  function hide() { clearTimeout(hideT); if (pill) pill.hidden = true; cur = null; }
  function showAt(rect, text, source) {
    if (!brainOn() || onBrainPage()) return;
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < MIN || t.length > MAX || !rect) { hide(); return; }
    cur = { text: t, source: source };
    var p = ensurePill();
    p.hidden = false;
    var w = p.offsetWidth || 150, h = p.offsetHeight || 34;
    var x = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    // On a phone the system's copy menu sits above a selection, so the button goes below it.
    var coarse = matchMedia('(pointer: coarse)').matches;
    var y = coarse ? rect.bottom + 14 : rect.top - h - 8;
    if (y < 64) y = rect.bottom + 8;
    p.style.left = Math.round(x) + 'px';
    p.style.top = Math.round(Math.min(innerHeight - h - 8, y)) + 'px';
  }
  function check() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hide(); return; }
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    if (skip(node)) { hide(); return; }
    var r = range.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) { hide(); return; }
    showAt(r, sel.toString(), sourceOf(node));
  }
  var t0 = 0;
  function soon() { clearTimeout(t0); t0 = setTimeout(check, 180); }
  document.addEventListener('mouseup', function (e) { if (pill && e.target === pill) return; soon(); });
  document.addEventListener('keyup', function (e) { if (e.shiftKey || e.key === 'Shift') soon(); if (e.key === 'Escape') hide(); });
  document.addEventListener('selectionchange', function () { var s = window.getSelection(); if (!s || s.isCollapsed) { clearTimeout(hideT); hideT = setTimeout(function () { var s2 = window.getSelection(); if (!s2 || s2.isCollapsed) hide(); }, 120); } else if (matchMedia('(pointer: coarse)').matches) soon(); });
  addEventListener('scroll', function () { if (pill && !pill.hidden) hide(); }, true);
  addEventListener('resize', hide);
  // Mail's message bodies are frames: Mail forwards their selection (rect in this window's coordinates).
  addEventListener('favor-mail-selection', function (e) {
    var d = (e && e.detail) || {};
    if (!d.text) { hide(); return; }
    showAt(d.rect, d.text, 'an email');
  });

  /* ---------------------------------------------------------------- opening the Brain with the context */
  function suggestion(text) {
    var t = String(text || '').trim();
    return t.length <= 120 ? t : '';
  }
  /** The question as the Brain receives it: what the person typed, then the selection in quotes when it is not in the question already. */
  function compose(question, ctx) {
    var q = String(question || '').trim();
    var c = ctx && String(ctx.text || '').replace(/\s+/g, ' ').trim();
    if (!c || q.indexOf(c) >= 0) return q.slice(0, 600);
    if (!q) return c.slice(0, 600);
    var room = 600 - q.length - 12;
    if (room < 40) return q.slice(0, 600);
    return (q + '\n\nAbout: "' + (c.length > room ? c.slice(0, room - 3) + '...' : c) + '"').slice(0, 600);
  }
  function dockReady() {
    var D = window.FavorDock;
    if (!D || !D.open) return false;
    // The dock shows on desktops for people with Chat, away from the Chat and Brain pages.
    if (!root.classList.contains('has-chat') || !matchMedia('(min-width: 861px)').matches) return false;
    var nav = document.body ? document.body.dataset.nav || '' : '';
    return nav !== 'chat' && nav !== 'brain';
  }
  function ask(text, source) {
    var ctx = { text: String(text || '').slice(0, MAX), source: source || 'this page', page: location.pathname + location.search };
    if (dockReady()) {
      window.FavorDock.open({ tab: 'brain' });
      var n = 0;
      (function wait() {
        // The React dock (app/src/shell/Dock.tsx) says it draws the Brain tab itself; wait for that tab, not the classic panel.
        var P = window.FavorDockBrainNative ? window.FavorDockNativeBrain : window.FavorDockPanel;
        if (P && P.askWith) { P.askWith(ctx); return; }
        if (++n < 60) setTimeout(wait, 80);
        else location.href = '/brain/?ctx=' + encodeURIComponent(ctx.text.slice(0, 600)) + '&from=' + encodeURIComponent(ctx.source);
      })();
      return;
    }
    location.href = '/brain/?ctx=' + encodeURIComponent(ctx.text.slice(0, 600)) + '&from=' + encodeURIComponent(ctx.source);
  }
  /** The context card shown above the question box, and the question box's starting words. */
  function card(ctx) {
    if (!ctx) return '';
    // A short selection is already in the question box; the card then only says where it came from.
    var t = String(ctx.text || '');
    return '<div class="fx-askctx" data-askctx><b>From ' + esc(ctx.source || 'this page') + '</b>' + (suggestion(t) ? '' : '<p>' + esc(t.slice(0, 400)) + (t.length > 400 ? '...' : '') + '</p>') + '</div>';
  }

  /* ---------------------------------------------------------------- answers back out: drag and Send to email */
  var PERSON_COL = /^(name|partner|partners|lookup_id|email|phone|address|given_through|funder|holder|household|households|constituent|donor|contact)$/i;
  function blockHasPartnerData(b) {
    var t = String((b && b.type) || '');
    if (t === 'partner' || t === 'coverage' || t === 'sheet' || t === 'choice' || t === 'confirm') return true;
    if (t !== 'table') return false;
    if (b.token) return true;
    var keys = Array.isArray(b.keys) ? b.keys.map(String) : Array.isArray(b.rows) && b.rows[0] && typeof b.rows[0] === 'object' ? Object.keys(b.rows[0]) : [];
    return keys.some(function (k) { return PERSON_COL.test(k); });
  }
  var meP = null;
  function packages() {
    // /api/brain/me lists every package with has: true for the ones this person holds.
    if (!meP) meP = fetch('/api/brain/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (m) {
      var keys = (Array.isArray(m && m.packages) ? m.packages : []).filter(function (p) { return p && p.has; }).map(function (p) { return String(p.key); });
      if (m && m.admin) keys.push('admin');
      return keys;
    }).catch(function () { meP = null; return []; });
    return meP;
  }
  function turnOf(el) {
    var i = Number(el.getAttribute('data-abody'));
    try {
      if (el.closest('#bc-thread') && window.BrainPage) { var st = window.BrainPage.state(); if (st.cur) return st.cur.turns[i] || null; }
      if (el.closest('#fd-p, .fd-p') && window.FavorDockPanel && window.FavorDockPanel.brainTurn) return window.FavorDockPanel.brainTurn(i);
    } catch (e) { /* fall through to the others */ }
    for (var k = 0; k < resolvers.length; k++) { try { var t = resolvers[k](el); if (t) return t; } catch (e2) { /* next */ } }
    return null;
  }
  function bodyOf(el) { return el.closest('[data-abody]'); }
  function textOf(body) {
    var c = body.cloneNode(true);
    c.querySelectorAll('.fx-bout, .m-foot, .blk-follow, .bc-cardline, .hintline, button, [data-reading], .reading, .blk-reading').forEach(function (x) { x.remove(); });
    return (c.innerText || c.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Number formats as the Brain shows them (brain-blocks.js and app/src/features/brain/fmt.ts). The React Brain page does not load
  // brain-blocks.js, so these are kept here.
  var F = (function () {
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var money = function (n) { return n == null || n === '' ? '' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); };
    var moneyS = function (n) { var a = Math.abs(n); var s = a >= 1e6 ? '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a).toLocaleString('en-US'); return n < 0 ? '-' + s : s; };
    var int = function (n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); };
    var dlong = function (iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso || ''); };
    var fmt = function (v, f) {
      if (v == null || v === '') return '';
      if (typeof v === 'string' && f !== 'money' && f !== 'money_short' && f !== 'int' && f !== 'pct') return f === 'date' ? dlong(v) : v;
      var n = Number(v);
      if (!isFinite(n)) return String(v);
      return f === 'money' ? money(n) : f === 'money_short' ? moneyS(n) : f === 'pct' ? n + '%' : f === 'date' ? dlong(v) : int(n);
    };
    return { money: money, moneyS: moneyS, int: int, dlong: dlong, fmt: fmt };
  })();
  // The answer's one figure: the headline line the answer shows, else its first figure tile, else a team's total.
  function headlineOf(turn, body) {
    var B = window.BrainBlocks && window.BrainBlocks.fmt ? window.BrainBlocks : F;
    var h = body && body.querySelector('.blk-head');
    if (h) {
      var b = h.querySelector('b'), sp = h.querySelector('span');
      var v = b && b.getAttribute('data-count') != null && B.fmt ? B.fmt(Number(b.getAttribute('data-count')), b.getAttribute('data-f') || 'int') : b ? b.textContent : '';
      if (String(v).trim()) return { value: String(v).trim(), label: sp ? sp.textContent.trim() : '' };
    }
    var blocks = (turn && Array.isArray(turn.blocks)) ? turn.blocks : [];
    for (var i = 0; i < blocks.length; i++) {
      var x = blocks[i];
      if (x && x.type === 'tiles' && x.tiles && x.tiles.length) {
        var t = x.tiles[0];
        return { value: typeof t.value === 'number' && B.fmt ? B.fmt(t.value, t.format || 'int') : String(t.value == null ? '' : t.value), label: String(t.label || '') };
      }
      if (x && x.type === 'team' && x.total != null) return { value: B.money ? B.money(x.total) : String(x.total), label: String(x.team || '') + (x.year ? ' in ' + x.year : '') };
    }
    return null;
  }
  // When the numbers were true: the Blackbaud copy's sync time the answer shows, else when the answer was given.
  function asOfOf(turn, body) {
    var st = body && body.querySelector('[data-copy-stamp]');
    if (st && st.dataset.at) return st.dataset.at;
    return (turn && turn.at) || new Date().toISOString();
  }
  function item(turn, body, mayShare) {
    var blocks = (turn && Array.isArray(turn.blocks)) ? turn.blocks : [];
    var partner = (turn && Array.isArray(turn.lists) && turn.lists.length > 0) || blocks.some(blockHasPartnerData);
    // The answer's own text when the Brain sent one (what Copy uses), else what the answer shows.
    var text = (turn && turn.markdown ? String(turn.markdown).replace(/\*\*/g, '') : '') || (body ? textOf(body) : '');
    var it = { kind: 'brain', title: String((turn && turn.q) || 'Favor Brain answer').slice(0, 200), text: text, html: '<p>' + esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>', partner: partner, mayShare: !!mayShare, asOf: asOfOf(turn, body) };
    var head = headlineOf(turn, body);
    if (head && head.value) it.headline = head;
    var tb = blocks.filter(function (b) { return b && b.type === 'table' && Array.isArray(b.rows) && b.rows.length; })[0];
    if (tb && Array.isArray(tb.cols) && tb.cols.length) {
      // The table as the answer shows it: its column names, money as money, counts with commas, numbers right-aligned.
      var B = window.BrainBlocks && window.BrainBlocks.money ? window.BrainBlocks : F;
      var NUM = { money: 1, int: 1, pct: 1, score: 1 };
      var shown = tb.cols.filter(function (c) { return c && !c.panel_only; });
      var fmtCell = function (c, v) {
        if (v == null || v === '') return '';
        if (c.type === 'money' && B.money) return B.money(v);
        if (c.type === 'int' && B.int) return B.int(v);
        if (c.type === 'pct') return v + '%';
        if (c.type === 'date' && B.dlong) return B.dlong(v);
        return plain(v);
      };
      it.rows = { title: String(tb.title || ''), columns: shown.map(function (c) { return String(c.label || c.key); }), align: shown.map(function (c) { return NUM[c.type] ? 'right' : 'left'; }), rows: tb.rows.map(function (r) { return shown.map(function (c) { return fmtCell(c, r[c.key]); }); }) };
    } else if (tb) {
      var keys =Array.isArray(tb.keys) && tb.keys.length ? tb.keys : typeof tb.rows[0] === 'object' && !Array.isArray(tb.rows[0]) ? Object.keys(tb.rows[0]) : [];
      var labels = Array.isArray(tb.columns) && tb.columns.length ? tb.columns.map(function (c) { return String((c && (c.label || c.name)) || c); }) : keys;
      it.rows = { title: String(tb.title || ''), columns: labels, rows: tb.rows.map(function (r) { return Array.isArray(r) ? r.map(plain) : keys.map(function (k) { return plain(r[k]); }); }) };
    }
    var list = turn && Array.isArray(turn.lists) ? turn.lists[0] : null;
    if (list && (list.url || list.csv)) it.csv = { name: String(list.name || list.title || 'list.csv'), url: String(list.url || list.csv) };
    return it;
  }
  function plain(v) { return v == null ? '' : typeof v === 'object' ? String(v.label || v.text || v.value || '') : String(v); }
  var GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
  function footer() {
    var fc = window.FavorCompose;
    return '<div class="fx-bout" role="group" aria-label="Use this answer elsewhere">' +
      '<span class="fx-btn fx-drag" tabindex="0" role="button" data-brain-drag title="Drag into an email, a Chat message or any text box" aria-label="Drag this answer into an email or any text box">' + GRIP + 'Drag</span>' +
      (fc && fc.add ? '<button type="button" class="fx-btn" data-brain-email><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>Send to email</button>' : '') +
      (fc && fc.copy ? '<button type="button" class="fx-btn" data-brain-copyf title="Copies the title, the figure, the table and the source, ready to paste"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>Copy as formatted</button>' : '') +
      '</div>';
  }
  function note(text) {
    if (window.hubToast) { window.hubToast(text); return; }
    var t = document.querySelector('.fx-toast');
    if (!t) { t = document.createElement('div'); t.className = 'rt-toast fx-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.classList.add('is-on');
    clearTimeout(note.t); note.t = setTimeout(function () { t.classList.remove('is-on'); }, 3400);
  }
  // The share check is read once; the drag starts at once with what is known and the composer checks again on drop.
  var shareKnown = null;
  function learnShare() { if (shareKnown === null) packages().then(function (p) { shareKnown = p.indexOf('partners') >= 0 || p.indexOf('admin') >= 0; }); }
  document.addEventListener('pointerover', function (e) { if (shareKnown === null && e.target && e.target.closest && e.target.closest('[data-brain-drag], [data-brain-email], [data-brain-copyf]')) learnShare(); });
  learnShare();
  var REFUSED = 'This answer names partners. Your Favor Brain access does not cover sharing partner details.';
  document.addEventListener('dragstart', function (e) {
    var h = e.target && e.target.closest && e.target.closest('[data-brain-drag]');
    if (!h) return;
    var body = bodyOf(h); if (!body) return;
    var it = item(turnOf(body), body, shareKnown);
    if (it.partner && shareKnown === false) { e.preventDefault(); note(REFUSED); return; }
    // The composer sets the item, its email HTML, plain text and the preview card; without it, plain text and the item.
    if (window.FavorCompose && window.FavorCompose.dragStart) { window.FavorCompose.dragStart(e, it); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', it.text);
    try { e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(it)); } catch (err) { /* older browsers: text only */ }
  });
  // The Drag handle drags with the pointer (compose.js pointerDrag): a card follows it, and letting go over an email, the
  // "start an email" box or any text box puts the answer there. Mouse, pen and touch alike.
  // No text selection starts from the handle.
  document.addEventListener('mousedown', function (e) { if (e.button === 0 && e.target && e.target.closest && e.target.closest('[data-brain-drag]')) e.preventDefault(); });
  document.addEventListener('pointerdown', function (e) {
    var h = e.target && e.target.closest && e.target.closest('[data-brain-drag]');
    if (!h || !window.FavorCompose || !window.FavorCompose.pointerDrag) return;
    learnShare();
    window.FavorCompose.pointerDrag(e, function () {
      var body = bodyOf(h); if (!body) return null;
      var it = item(turnOf(body), body, shareKnown);
      if (it.partner && shareKnown === false) { note(REFUSED); return null; }
      return it;
    });
  });
  function withItem(b, fn) {
    var body = bodyOf(b); if (!body) return;
    packages().then(function (p) {
      var may = p.indexOf('partners') >= 0 || p.indexOf('admin') >= 0;
      var it = item(turnOf(body), body, may);
      if (it.partner && !may) { note(REFUSED); return; }
      fn(it, body);
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-brain-email], [data-brain-copyf]');
    if (!b || !window.FavorCompose) return;
    if (b.hasAttribute('data-brain-copyf')) { withItem(b, function (it) { window.FavorCompose.copy(it); }); return; }
    // The answer stays in view: a new email opens beside it (or asks which open draft gets it, New email first).
    withItem(b, function (it, body) { window.FavorCompose.add(it, { anchor: b, from: body }); });
  });
  // Keyboard: Enter or Space on the drag handle copies the answer as formatted text, the way to move it without a mouse.
  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.closest) return;
    var h = e.target.closest('[data-brain-drag]');
    if (!h || !window.FavorCompose || !window.FavorCompose.copy) return;
    e.preventDefault();
    withItem(h, function (it) { window.FavorCompose.copy(it); });
  });

  window.FavorAskBrain = { ask: ask, compose: compose, card: card, suggestion: suggestion, footer: footer, item: item, register: function (fn) { if (typeof fn === 'function') resolvers.push(fn); }, hide: hide };
})();
