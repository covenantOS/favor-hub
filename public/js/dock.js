/* The floating dock: a small circle at the bottom right of every FavorOS page for people who have Chat. It keeps one live socket,
   counts what needs a reply, shows a toast with an inline Reply for a direct message or a mention, and opens a compact panel with
   two tabs (Chat and Favor Brain). The panel's code (dock-panel.js and its styles) loads the first time it opens.
   State that must survive a page change lives in sessionStorage (favor.dock.v1) and the panel redraws from it. Hidden on the
   Chat and Brain pages and on phones. window.FavorDock is what dock-panel.js builds on. */
(function () {
  'use strict';
  if (window.FavorDock) return;
  var KEY = 'favor.dock.v1', DATA = 'favor.dock.data.v1', SIZE = 'favor.dock.size.v1';
  var root = document.documentElement;
  var desk = matchMedia('(min-width: 861px)');
  var D = window.FavorDock = { ch: {}, users: {}, me: '', threads: 0, on: on, req: req, save: save, paint: paint, toggle: toggle, open: open, close: close, plain: plain, name: name, mentions: mentions, size: size };
  var st = read(KEY, {}), handlers = [], el = null, panelEl = null, tray = null, loaded = 0, ready = false, ws = null, wsT = 0, retry = 0, pingT = 0, poll = 0, lastSeen = Date.now(), everOpen = false, refreshing = null;

  function read(k, d) { try { var v = JSON.parse((k === SIZE ? localStorage : sessionStorage).getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function save(patch) { if (patch) for (var k in patch) st[k] = patch[k]; try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode */ } }
  D.state = function () { return st; };
  function size(v) { if (v) { try { localStorage.setItem(SIZE, JSON.stringify(v)); } catch (e) { /* full */ } } return read(SIZE, {}); }
  function on(fn) { handlers.push(fn); }
  function emit(ev) { handlers.forEach(function (h) { try { h(ev); } catch (e) { console.error(e); } }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function req(method, path, body) {
    var h = { 'X-Hub-Request': '1' };
    if (body) h['Content-Type'] = 'application/json';
    return fetch('/api/chat/' + path, { method: method, credentials: 'same-origin', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = r.status; throw e; } return d; }); });
  }

  /* ---------------------------------------------------------------- who and where */
  function name(id) { var u = D.users[id]; return u ? u.name : id === 'brain' ? 'Favor Brain' : String(id || '').split('@')[0]; }
  function mentions() { var o = {}; Object.keys(D.users).forEach(function (k) { o[k] = D.users[k].name; }); o.brain = 'Favor Brain'; return o; }
  function plain(text) { var t = String(text || ''); return window.FavorMention ? window.FavorMention.plain(t, mentions()) : t.replace(/<@([^>]+)>/g, function (_, id) { return '@' + name(id); }); }
  function mentionsMe(m) { var b = m.body || ''; return b.indexOf('<@' + D.me + '>') >= 0 || b.indexOf('<@channel>') >= 0 || b.indexOf('<@all>') >= 0; }
  function page() { return document.body ? document.body.dataset.nav || '' : ''; }
  function eligible() { return root.classList.contains('has-chat') && desk.matches && document.body && !!document.getElementById('h-app'); }
  function visible() { var p = page(); return eligible() && p !== 'chat' && p !== 'brain'; }

  /* ---------------------------------------------------------------- the circle */
  function mount() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'fd'; el.id = 'fd';
    el.innerHTML = '<button type="button" class="fd__btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Chat and Favor Brain" title="Chat and Favor Brain (Ctrl .)">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/></svg><b class="fd__n" hidden></b></button><div class="fd__tray" aria-live="polite"></div>';
    document.body.appendChild(el);
    tray = el.querySelector('.fd__tray');
    el.querySelector('.fd__btn').addEventListener('click', function () { toggle(); });
  }
  function paint() {
    if (!el) return;
    var n = 0;
    Object.keys(D.ch).forEach(function (k) { n += D.ch[k].mentions || 0; });
    n += D.threads || 0;
    var b = el.querySelector('.fd__n');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('has-n', !!n);
    el.querySelector('.fd__btn').setAttribute('aria-label', 'Chat and Favor Brain' + (n ? ', ' + n + ' to read' : ''));
    emit({ type: 'dock:paint' });
  }

  /* ---------------------------------------------------------------- never cover the page's own buttons */
  var dodgeT = 0;
  function dodge() {
    if (!el) return;
    clearTimeout(dodgeT);
    dodgeT = setTimeout(function () {
      var lift = 0, W = innerWidth, H = innerHeight, zone = { l: W - 20 - 56 - 10, t: H - 20 - 56 - 10, r: W, b: H };
      var list = document.querySelectorAll('.h-main .h-btn--primary, .h-main button[type="submit"], .h-main [data-dock-avoid], .h-drawer .h-btn--primary, .rd .h-btn--primary');
      for (var i = 0; i < list.length && i < 60; i++) {
        var r = list[i].getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > H) continue;
        if (r.right > zone.l && r.left < zone.r && r.bottom > zone.t && r.top < zone.b) lift = Math.max(lift, H - r.top + 10 - 20 - 0);
      }
      lift = Math.min(lift, Math.round(H * 0.45));
      el.style.setProperty('--fd-lift', lift + 'px');
    }, 120);
  }

  /* ---------------------------------------------------------------- the panel shell (instant), its code loads on first open */
  function shell() {
    if (panelEl) return panelEl;
    var s = size(), w = s.w || 400, h = s.h || 600;
    panelEl = document.createElement('section');
    panelEl.className = 'fd-p'; panelEl.id = 'fd-p';
    panelEl.setAttribute('role', 'dialog'); panelEl.setAttribute('aria-label', 'Chat and Favor Brain'); panelEl.setAttribute('aria-modal', 'false');
    panelEl.style.setProperty('--fd-w', w + 'px'); panelEl.style.setProperty('--fd-h', h + 'px');
    if (s.x) panelEl.classList.add('is-big');
    panelEl.innerHTML = '<div class="fd-p__grip" data-grip title="Drag to resize"></div>' +
      '<header class="fd-p__h"><div class="fd-p__tabs" role="tablist"><button type="button" role="tab" data-tab="chat" aria-selected="false">Chat<b class="fd-p__n" hidden></b></button><button type="button" role="tab" data-tab="brain" aria-selected="false">Favor Brain</button></div>' +
      '<button type="button" class="fd-p__ib" data-big aria-label="Make the panel larger" title="Larger"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>' +
      '<button type="button" class="fd-p__ib" data-x aria-label="Close the panel" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>' +
      '<div class="fd-p__body" data-body><div class="fd-p__wait"><i></i><i></i><i></i></div></div>';
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab],[data-x],[data-big]');
      if (!t) return;
      if (t.hasAttribute('data-x')) close();
      else if (t.hasAttribute('data-big')) bigger();
      else tab(t.getAttribute('data-tab'));
    });
    panelEl.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('[data-pop]')) { e.stopPropagation(); close(true); } });
    grip(panelEl.querySelector('[data-grip]'));
    return panelEl;
  }
  function bigger() {
    var s = size(); s.x = !s.x; size(s);
    panelEl.classList.toggle('is-big', !!s.x);
    var b = panelEl.querySelector('[data-big]'); b.setAttribute('aria-label', s.x ? 'Make the panel smaller' : 'Make the panel larger');
    emit({ type: 'dock:size' });
  }
  function grip(g) {
    g.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var r = panelEl.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, w0 = r.width, h0 = r.height;
      panelEl.classList.add('is-sizing'); panelEl.classList.remove('is-big');
      var mv = function (m) {
        var w = Math.max(340, Math.min(Math.round(w0 + (x0 - m.clientX)), innerWidth - 40, 900));
        var h = Math.max(380, Math.min(Math.round(h0 + (y0 - m.clientY)), innerHeight - 110));
        panelEl.style.setProperty('--fd-w', w + 'px'); panelEl.style.setProperty('--fd-h', h + 'px');
      };
      var up = function () {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        panelEl.classList.remove('is-sizing');
        var r2 = panelEl.getBoundingClientRect(); size({ w: Math.round(r2.width), h: Math.round(r2.height), x: false });
        emit({ type: 'dock:size' });
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
  }
  function tab(t) {
    if (t !== 'chat' && t !== 'brain') t = 'chat';
    save({ tab: t });
    panelEl.querySelectorAll('[data-tab]').forEach(function (b) { var on = b.getAttribute('data-tab') === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    emit({ type: 'dock:tab', tab: t });
  }
  function loadPanel() {
    if (loaded) return loaded;
    var v = '2';
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/dock-panel.css?v=' + v; document.head.appendChild(css);
    var css2 = document.createElement('link'); css2.rel = 'stylesheet'; css2.href = '/css/chat-smart.css?v=1'; document.head.appendChild(css2);
    loaded = new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = '/js/dock-panel.js?v=' + v; s.onload = ok; s.onerror = function () { loaded = 0; bad(new Error('The panel did not load.')); };
      document.head.appendChild(s);
    });
    return loaded;
  }
  function open(where) {
    if (!visible()) return;
    mount(); shell();
    if (where && where.tab) save({ tab: where.tab });
    if (where && where.ch) save({ ch: where.ch, th: where.th || null, list: 0 });
    save({ open: 1 });
    root.classList.add('fd-open');
    el.querySelector('.fd__btn').setAttribute('aria-expanded', 'true');
    panelEl.hidden = false;
    clearToasts();
    tab(st.tab || 'chat');
    loadPanel().then(function () { if (window.FavorDockPanel) window.FavorDockPanel.show(); }).catch(function (e) {
      var b = panelEl.querySelector('[data-body]'); b.innerHTML = '<div class="fd-p__err">' + esc(e.message) + ' <button type="button" data-retry>Try again</button></div>';
      b.querySelector('[data-retry]').onclick = function () { loaded = 0; open(); };
    });
  }
  function close(refocus) {
    save({ open: 0 });
    root.classList.remove('fd-open');
    if (panelEl) panelEl.hidden = true;
    if (el) { var b = el.querySelector('.fd__btn'); b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
    emit({ type: 'dock:close' });
  }
  function toggle() { if (st.open && panelEl && !panelEl.hidden) close(true); else open(); }

  /* ---------------------------------------------------------------- toasts with Reply */
  function clearToasts() { if (tray) tray.innerHTML = ''; }
  function toast(m, c) {
    if (!tray || page() === 'chat') return;
    var who = name(m.user_id), where = c.kind === 'dm' ? '' : c.kind === 'group' ? ' in a group conversation' : ' in #' + c.name;
    var text = plain(m.body).replace(/<#[^>]+>/g, '').trim() || 'Shared an attachment';
    var u = D.users[m.user_id] || {};
    var t = document.createElement('div');
    t.className = 'fd-t'; t.setAttribute('role', 'status');
    t.innerHTML = '<div class="fd-t__top"><span class="fd-t__av">' + (u.picture ? '<img alt="" src="' + esc(u.picture) + '" referrerpolicy="no-referrer">' : esc(String(who).split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase())) + '</span>' +
      '<span class="fd-t__w"><b>' + esc(who) + '</b>' + esc(where) + '</span><button type="button" class="fd-t__x" data-tx aria-label="Dismiss">&times;</button></div>' +
      '<p class="fd-t__b">' + esc(text.length > 160 ? text.slice(0, 157) + '...' : text) + '</p>' +
      '<div class="fd-t__a"><button type="button" data-treply>Reply</button><button type="button" data-topen>Open</button></div>' +
      '<form class="fd-t__f" hidden><input type="text" maxlength="4000" aria-label="Reply to ' + esc(who) + '" placeholder="Reply" autocomplete="off"><button type="submit">Send</button></form>';
    var kill = function () { clearTimeout(t._h); t.classList.add('is-out'); setTimeout(function () { t.remove(); }, 160); };
    var arm = function () { clearTimeout(t._h); t._h = setTimeout(kill, 9000); };
    t.addEventListener('mouseenter', function () { clearTimeout(t._h); });
    t.addEventListener('mouseleave', function () { if (t.querySelector('form').hidden) arm(); });
    t.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-tx')) kill();
      else if (b.hasAttribute('data-topen')) { kill(); open({ tab: 'chat', ch: m.channel_id, th: m.thread_id || null }); }
      else if (b.hasAttribute('data-treply')) { var f = t.querySelector('form'); f.hidden = false; b.hidden = true; clearTimeout(t._h); f.querySelector('input').focus(); }
    });
    t.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = t.querySelector('input'), v = inp.value.trim(); if (!v) return;
      inp.disabled = true;
      req('POST', 'channels/' + encodeURIComponent(m.channel_id) + '/messages', Object.assign({ body: v }, m.thread_id ? { thread_id: m.thread_id } : {})).then(function (d) {
        c.unread = 0; c.mentions = 0; req('POST', 'channels/' + encodeURIComponent(m.channel_id) + '/read', { upTo: d.message.id }).catch(function () {}); paint();
        t.querySelector('.fd-t__b').textContent = 'Sent'; t.querySelector('form').hidden = true; t.querySelector('.fd-t__a').hidden = true; setTimeout(kill, 1200);
      }).catch(function (err) { inp.disabled = false; t.querySelector('.fd-t__b').textContent = err.message; });
    });
    while (tray.children.length >= 3) tray.firstChild.remove();
    tray.appendChild(t); arm();
    if (document.hidden || !document.hasFocus()) desktop(m, c, who, where, text);
  }
  // A desktop notice when the tab is out of sight and the person already allowed notices in Chat. Never asked for here.
  function desktop(m, c, who, where, text) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try { var n = new Notification(c.kind === 'dm' ? who : who + where, { body: text.slice(0, 180), tag: 'chat-' + c.id, icon: '/images/favor-icon.png' }); n.onclick = function () { window.focus(); open({ tab: 'chat', ch: m.channel_id, th: m.thread_id || null }); n.close(); }; } catch (e) { /* no notices here */ }
  }

  /* ---------------------------------------------------------------- the numbers */
  function refresh(force) {
    if (refreshing) return refreshing;
    if (!force && ready && Date.now() - (D.at || 0) < 20000) return Promise.resolve();
    refreshing = (window.FavorData ? window.FavorData.get('dock', '/api/chat/dock', { stale: force ? 0 : 20000, persist: false }) : req('GET', 'dock')).then(function (d) {
      D.me = d.me; D.lang = d.lang || ''; D.langs = d.langs || []; D.users = d.users || {}; D.threads = d.threads_unread || 0; D.at = Date.now();
      var next = {}; (d.channels || []).forEach(function (c) { next[c.id] = c; }); D.ch = next; ready = true;
      try { sessionStorage.setItem(DATA, JSON.stringify({ at: D.at, me: D.me, lang: D.lang, langs: D.langs, users: D.users, ch: D.ch, threads: D.threads })); } catch (e) { /* full */ }
      paint();
    }).catch(function () { /* the next resync tries again */ }).then(function () { refreshing = null; });
    return refreshing;
  }
  function fromCache() {
    try { var c = JSON.parse(sessionStorage.getItem(DATA) || 'null'); if (c && c.me && Date.now() - c.at < 30 * 60000) { D.me = c.me; D.lang = c.lang || ''; D.langs = c.langs || []; D.users = c.users || {}; D.ch = c.ch || {}; D.threads = c.threads || 0; D.at = c.at; ready = true; paint(); } } catch (e) { /* no cache */ }
  }
  D.ready = function () { return ready ? Promise.resolve() : refresh(true); };
  D.refresh = refresh;

  function viewing(m) { return !!(st.open && panelEl && !panelEl.hidden && st.tab === 'chat' && st.ch === m.channel_id && !document.hidden && document.hasFocus()); }
  function onMessage(m) {
    var c = D.ch[m.channel_id];
    if (m.visible_to && m.visible_to !== D.me) return;
    if (!c) { refresh(true).then(function () { if (D.ch[m.channel_id]) onMessage(m); }); return; }
    if (m.user_id === D.me) { emit({ type: 'message', message: m }); return; }
    var care = mentionsMe(m) || c.kind === 'dm' || c.kind === 'group';
    var here = viewing(m);
    if (m.thread_id) { if (!here) refresh(true); }
    else if (!here) { c.unread = (c.unread || 0) + 1; if (care) c.mentions = (c.mentions || 0) + 1; }
    emit({ type: 'message', message: m });
    paint();
    if (!here && care && !c.muted && !m.visible_to) toast(m, c);
  }
  function onEvent(ev) {
    if (ev.type === 'message') onMessage(ev.message);
    else if (ev.type === 'channel' && ev.channel) { D.ch[ev.channel.id] = Object.assign(D.ch[ev.channel.id] || { unread: 0, mentions: 0 }, ev.channel); paint(); emit(ev); }
    else if (ev.type === 'users' && ev.users) { Object.assign(D.users, ev.users); emit(ev); }
    else if (ev.type === 'resync') { refresh(true); emit(ev); }
    else emit(ev);
  }

  /* ---------------------------------------------------------------- the socket (one per page, closed on Chat and on phones) */
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (!visible() && !(eligible() && page() === 'brain')) return;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws'); } catch (e) { fallback(); return; }
    ws.onopen = function () {
      retry = 0; clearInterval(pingT); clearInterval(poll); poll = 0;
      pingT = setInterval(function () { if (ws && ws.readyState === 1) ws.send('ping'); }, 30000);
      if (document.hidden) ws.send(JSON.stringify({ t: 'p', s: 'away' }));
      emit({ type: 'conn', ok: true });
      if (everOpen || Date.now() - lastSeen > 20000) onEvent({ type: 'resync' });
      everOpen = true;
    };
    ws.onmessage = function (e) { lastSeen = Date.now(); if (e.data === 'pong') return; try { onEvent(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
    ws.onclose = function () {
      clearInterval(pingT); ws = null;
      if (!eligible() || page() === 'chat') return;
      emit({ type: 'conn', ok: false });
      retry = Math.min(retry + 1, 6);
      clearTimeout(wsT); wsT = setTimeout(connect, retry <= 1 ? 250 : Math.min(30000, 800 * Math.pow(2, retry)));
      fallback();
    };
    ws.onerror = function () { /* onclose follows */ };
  }
  function fallback() { if (poll) return; poll = setInterval(function () { if (!document.hidden) onEvent({ type: 'resync' }); }, 20000); }
  function hang() { clearTimeout(wsT); clearInterval(poll); poll = 0; clearInterval(pingT); if (ws) { var w = ws; ws = null; try { w.close(); } catch (e) { /* gone */ } } }
  document.addEventListener('visibilitychange', function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', s: document.hidden ? 'away' : 'online' }));
    if (!document.hidden && eligible() && page() !== 'chat') { if (!ws || ws.readyState !== 1) { retry = 0; connect(); } refresh(); }
  });
  addEventListener('online', function () { retry = 0; connect(); });

  /* ---------------------------------------------------------------- when to show */
  function sync() {
    if (!document.body) return;
    var show = visible();
    var live = eligible() && page() !== 'chat';
    if (live) { mount(); if (!ready) fromCache(); refresh(); connect(); el.hidden = false; el.classList.toggle('is-off', !show); }
    else { hang(); if (el) el.hidden = true; }
    if (show) {
      dodge();
      if (st.open && (!panelEl || panelEl.hidden)) open();
    } else {
      if (panelEl) panelEl.hidden = true;
      root.classList.remove('fd-open');
    }
  }
  addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === '.' || e.code === 'Period')) {
      if (!visible()) return;
      e.preventDefault(); toggle();
    }
  });
  document.addEventListener('favor-hub', sync);
  // The menu script sets has-chat on the page once it knows who is signed in, after the favor-hub event fires.
  var hadChat = root.classList.contains('has-chat');
  new MutationObserver(function () { var now = root.classList.contains('has-chat'); if (now !== hadChat) { hadChat = now; sync(); } }).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('hub-swapped', function () { sync(); dodge(); });
  desk.addEventListener('change', sync);
  addEventListener('resize', dodge);
  addEventListener('scroll', dodge, { passive: true, capture: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
  // The page may finish drawing its buttons after this runs.
  addEventListener('load', function () { sync(); setTimeout(dodge, 600); });
  addEventListener('pagehide', function () { save(); });
})();
