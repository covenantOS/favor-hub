/* Favor Brain answers inside Favor Chat. The blocks are drawn and pressed by the same code as on the Brain page
   (public/js/brain-blocks.js: BrainBlocks.render and BrainBlocks.handle); this file is only what Chat adds around them:
   which message an answer belongs to, where a follow-up question is posted, and the large table view that opens over the chat.
   chat.js passes html() to chat-ui.js as renderBlocks and calls attach(app) once the screen is up. */
(function () {
  'use strict';
  var B = window.BrainBlocks;
  var DAY = 864e5;
  var app = null;        // what chat-ui.js returns from mount()
  var me = null;         // /api/brain/me: the person's Brain packages (Google Sheets among them)
  var turns = {};        // message id -> { id, sig, rev, q, asked_as, blocks, follow, extras, lists, html }
  var openTable = null;  // the table shown large, if any

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opt) {
    opt = opt || {};
    return fetch('/api/brain/' + path, { method: opt.body ? 'POST' : 'GET', credentials: 'same-origin', headers: opt.body ? { 'Content-Type': 'application/json' } : undefined, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (!res.ok || d.ok === false) { var e = new Error(d.message || d.error || 'The Brain did not answer (' + res.status + ').'); e.status = res.status; throw e; }
          return d;
        });
      });
  }
  function has(k) { return !!(me && (me.packages || []).some(function (p) { return p.key === k && p.has; })); }
  function canRequest(k) {
    return !!(me && (me.packages || []).some(function (p) { return p.key === k && !p.has && p.requestable; })) && !(me.requests || []).some(function (r) { return r.package === k && r.status === 'pending'; });
  }
  function canSheets() { return has('sheets') && !!window.FavorSheets; }

  /** The answer in a message, kept between redraws so a sorted table, a pressed option and a drawn chart stay as they are. */
  function turnFor(m) {
    var b = m.brain || {};
    var sig = JSON.stringify([b.blocks, b.follow]);
    var t = turns[m.id];
    if (!t || t.sig !== sig) {
      t = turns[m.id] = { id: m.id, sig: sig, rev: 0, q: b.q || b.asked_as || '', asked_as: b.asked_as || b.q || '', blocks: JSON.parse(JSON.stringify(b.blocks || [])), follow: (b.follow || []).slice(), lists: (b.lists || []).slice(), extras: [], html: null };
    }
    t.at = m.created_at;
    t.channel = m.channel_id;
    t.thread = m.thread_id || null;
    t.hidden = !!m.visible_to;
    return t;
  }
  function html(blocks, m) {
    if (!B || !B.render || !m) return '';
    var t = turnFor(m);
    var sheets = canSheets();
    var key = t.rev + ':' + (sheets ? 1 : 0);
    if (t.html && t.key === key) return t.html;
    // Lists are kept for a day; an older table shows its preview rows and offers to ask again.
    var expired = Date.now() - new Date(m.created_at).getTime() > DAY;
    var ctx = function (i) { return { ti: m.id, bi: i, canSheets: sheets, canRequest: canRequest, expired: expired }; };
    var h = t.blocks.map(function (b, i) { try { return B.render(b, ctx(i)); } catch (e) { return ''; } }).join('');
    h += t.extras.map(function (x) { try { return B.render(x, ctx(-1)); } catch (e) { return ''; } }).join('');
    if (t.follow.length) h += '<div class="blk-follow" aria-label="Follow-up questions">' + t.follow.map(function (q) { return '<button type="button" class="fu" data-act="ask" data-turn="' + m.id + '" data-q="' + esc(q) + '">' + B.ic('arrow') + esc(q) + '</button>'; }).join('') + '</div>';
    t.key = key;
    t.html = '<div class="bc-root" data-brain="' + m.id + '" data-rev="' + key + '">' + h + '</div>';
    return t.html;
  }

  function turnOfEl(el, tableId) {
    var id = el && el.dataset && el.dataset.turn;
    if (!id) {
      var wrap = (el && el.closest && el.closest('[data-brain]')) || (tableId && document.querySelector('[data-brain] [data-tbwrap="' + tableId + '"]'));
      wrap = wrap && wrap.closest ? wrap.closest('[data-brain]') : wrap;
      id = wrap ? wrap.getAttribute('data-brain') : openTable ? openTable.turn : null;
    }
    return id != null ? turns[id] || null : null;
  }
  var host = {
    page: '/chat/',
    api: api,
    toast: function (msg, link) { if (app) app.toast(msg, link); },
    turn: turnOfEl,
    rerender: function (t) { if (!t) return; t.rev++; t.html = null; if (app) app.redraw(); },
    // A question pressed inside an answer is posted where the answer is: the same thread, or the channel. When the answer
    // is the asker's alone, the follow-up question is too.
    ask: function (q, o) {
      o = o || {};
      var t = turnOfEl(o.el);
      if (host.closeTable) host.closeTable();
      if (app) app.askBrain(q, { intent: o.intent, channel: t ? t.channel : null, thread: t ? t.thread : null, hidden: t ? t.hidden : false });
    },
    confirm: function (t, b, action, bi) {
      return fetch('/api/chat/messages/' + t.id + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ bi: bi, action: action }) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) throw new Error(d.message || 'That did not work. Try again.'); return d; }); });
    },
    focusInput: function (el) { var t = turnOfEl(el); if (app) app.focusComposer(t && t.thread ? 'thread' : 'main', '@Favor Brain '); },
    accessAsked: function (pkg) { if (me) me.requests = (me.requests || []).concat([{ package: pkg, status: 'pending' }]); },
    openTable: function (id, el) {
      var tb = B.TB[id];
      if (!tb || !app) return;
      var t = turnOfEl(el, id);
      var n = tb.count || tb.rows.length;
      var sheet = app.sheet({ name: tb.title, sub: n.toLocaleString('en-US') + ' ' + (tb.noun || 'rows') }, '<div class="bc-root"><div class="ch-tv">' + B.tablePanel(tb, { head: false }) + '</div></div>', 'ch-view--table');
      if (!sheet) return;
      openTable = { id: id, turn: t ? t.id : null };
      var sub = sheet.querySelector('.ch-view__t small');
      if (sub) sub.setAttribute('data-pcnt', id);
      B.refreshTable(id);
      B.tableFades();
      B.loadRows(tb, host);
    },
    closeTable: function () { if (openTable && window.FavorChatView && window.FavorChatView.isOpen()) window.FavorChatView.close(); openTable = null; },
  };

  // Presses inside an answer, wherever it is drawn: a message, a thread, the Threads view, or the large table view.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el || !B || !B.handle) return;
    if (!el.closest('[data-brain]') && !el.closest('.ch-tv')) return;
    if (B.handle(e, el, host)) e.stopPropagation();
  }, true);

  /** Charts are drawn once their message is on screen (a chart needs its box's width). */
  function draw(root) {
    if (!B || !root || !root.querySelector || !root.querySelector('[data-chart], [data-count]')) return;
    B.drawCharts(root);
    B.countUp(root, true);
  }
  var resizeT = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { document.querySelectorAll('#chat-root [data-brain]').forEach(draw); }, 150); });

  function attach(a) {
    app = a;
    // The person's Brain packages decide whether Open in Google Sheets shows, as on the Brain page. Read once, and only when
    // an answer is on screen or the person asks one.
    var loaded = false;
    var load = function () {
      if (loaded) return;
      loaded = true;
      api('me').then(function (d) { me = d; var had = Object.keys(turns).length; if (had && canSheets()) { Object.keys(turns).forEach(function (k) { turns[k].html = null; }); app.redraw(); } }).catch(function () { loaded = false; });
    };
    host.load = load;
  }
  // The large table view closing (X, Escape, Back) takes its small menu with it.
  document.addEventListener('favor-chat:view-closed', function () { openTable = null; if (B && B.closePop) B.closePop(); });

  window.FavorChatBrain = { html: function (blocks, m) { if (host.load) host.load(); return html(blocks, m); }, attach: attach, draw: draw, host: host, turns: turns };
})();
