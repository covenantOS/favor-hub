/* Favor Chat page: the real transport behind chat-ui.js. REST for everything that changes data, one WebSocket (through the
   favor-chat Worker's ChatRoom) for everything that arrives, a poll as the fallback when the socket cannot open. */
(function () {
  'use strict';
  var root = document.getElementById('chat-root');
  if (!root || !window.FavorChat) return;
  var handlers = [];
  var emit = function (ev) { handlers.forEach(function (h) { try { h(ev); } catch (e) { console.error(e); } }); };

  // Lite mode keeps the channel list and each opened channel's latest messages on the phone, so Chat opens with no signal.
  var KEEP = /^(boot|channels\/[^/?]+\/messages)$/;
  function kept() {
    if (!window.indexedDB || !(window.FavorLite && window.FavorLite.on)) return null;
    if (!kept.p) kept.p = new Promise(function (res) {
      var o = indexedDB.open('favor-chat-keep', 1);
      o.onupgradeneeded = function () { o.result.createObjectStore('r'); };
      o.onsuccess = function () { res(o.result); }; o.onerror = function () { res(null); };
    });
    return kept.p;
  }
  function keepPut(k, d) { var p = kept(); if (p) p.then(function (db) { if (db) try { db.transaction('r', 'readwrite').objectStore('r').put(JSON.stringify(d).length < 2e6 ? d : null, k); } catch (e) { /* full */ } }); }
  function keepGet(k) { var p = kept(); return p ? p.then(function (db) { return db ? new Promise(function (res) { try { var r = db.transaction('r').objectStore('r').get(k); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; } catch (e) { res(null); } }) : null; }) : Promise.resolve(null); }
  function req(method, path, body, raw) {
    if (method === 'GET' && KEEP.test(path) && kept()) {
      return req2(method, path, body, raw).then(function (d) { keepPut(path, d); return d; }, function (e) {
        if (e && e.status) throw e;
        return keepGet(path).then(function (d) { if (!d) throw e; d.offline = true; return d; });
      });
    }
    return req2(method, path, body, raw);
  }
  function req2(method, path, body, raw) {
    var headers = { 'X-Hub-Request': '1' };
    if (body && !raw) headers['Content-Type'] = 'application/json';
    return fetch('/api/chat/' + path, { method: method, credentials: 'same-origin', headers: Object.assign(headers, raw ? raw.headers : {}), body: raw ? raw.body : body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = res.status; e.code = d.error || ''; throw e; } return d; }); });
  }

  /* ------------------------------------------------------------------ the socket */
  var ws = null, pingT = 0, retry = 0, pollT = 0, everOpen = false, closedByUs = false, lastSeen = Date.now();
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws';
    try { ws = new WebSocket(url); } catch (e) { fallback(); return; }
    ws.onopen = function () {
      retry = 0; clearInterval(pingT); clearInterval(pollT); pollT = 0;
      pingT = setInterval(function () { if (ws.readyState === 1) ws.send('ping'); }, 30000);
      if (document.hidden) ws.send(JSON.stringify({ t: 'p', s: 'away' }));
      emit({ type: 'conn', ok: true });
      if (everOpen || Date.now() - lastSeen > 20000) emit({ type: 'resync' });
      everOpen = true;
    };
    ws.onmessage = function (e) { lastSeen = Date.now(); clearTimeout(checkT); if (e.data === 'pong') return; try { emit(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
    ws.onclose = function () {
      clearInterval(pingT);
      if (closedByUs) return;
      emit({ type: 'conn', ok: false });
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, retry <= 1 ? 250 : Math.min(30000, 800 * Math.pow(2, retry)));
      fallback();
    };
    ws.onerror = function () { /* onclose follows */ };
  }
  function fallback() {
    if (pollT) return;
    pollT = setInterval(function () { if (!document.hidden) emit({ type: 'resync' }); }, 20000);
  }
  // A phone that was locked or lost its signal can hold a socket that looks open and carries nothing. Coming back, the page asks
  // the room for a pong; no answer in four seconds means a new socket, and a new socket catches up on what was missed.
  var checkT = 0, hiddenAt = 0;
  function check() {
    if (!ws || ws.readyState !== 1) { connect(); return; }
    clearTimeout(checkT);
    try { ws.send('ping'); } catch (_) { /* closing */ }
    checkT = setTimeout(function () { if (ws && ws.readyState === 1) { try { ws.close(); } catch (_) { /* gone */ } } }, 4000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', s: document.hidden ? 'away' : 'online' }));
    if (document.hidden) return;
    if (!ws || ws.readyState !== 1) { retry = 0; connect(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 10000) check();
  });
  window.addEventListener('online', function () { retry = 0; check(); });
  window.addEventListener('offline', function () { emit({ type: 'conn', ok: false }); });

  /* ------------------------------------------------------------------ clips recorded from a channel */
  var pendingClip = null;
  if (typeof BroadcastChannel !== 'undefined') {
    var bc = new BroadcastChannel('favor-clips');
    bc.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.t === 'saved' && m.id && pendingClip) {
        var channel = pendingClip; pendingClip = null;
        api.send(channel, { body: '', attachments: [{ type: 'clip', id: m.id }] }).then(function (msg) { emit({ type: 'message', message: msg }); }).catch(function () {});
      }
    });
  }

  /* ------------------------------------------------------------------ the api chat-ui.js calls */
  var api = {
    boot: function () { return req('GET', 'boot'); },
    history: function (id, o) { return req('GET', 'channels/' + encodeURIComponent(id) + '/messages' + (o && o.before ? '?before=' + o.before : '')); },
    thread: function (id) { return req('GET', 'threads/' + id); },
    send: function (ch, p) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/messages', p).then(function (d) { return d.message; }); },
    edit: function (id, body) { return req('PATCH', 'messages/' + id, { body: body }).then(function (d) { return d.message; }); },
    del: function (id) { return req('DELETE', 'messages/' + id); },
    react: function (id, emoji) { return req('POST', 'messages/' + id + '/reactions', { emoji: emoji }); },
    read: function (ch, upTo) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/read', { upTo: upTo }).catch(function () {}); },
    typing: function (ch, thread) { req('POST', 'channels/' + encodeURIComponent(ch) + '/typing', thread ? { thread_id: thread } : {}).catch(function () {}); },
    mute: function (ch, muted) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/mute', { muted: muted }); },
    search: function (q, o) { return req('GET', 'search?q=' + encodeURIComponent(q) + '&filter=' + encodeURIComponent((o && o.filter) || 'all') + '&channel=' + encodeURIComponent((o && o.channel) || '') + (o && o.from ? '&from=' + encodeURIComponent(o.from) : '')); },
    threads: function () { return req('GET', 'threads'); },
    activity: function () { return req('GET', 'activity'); },
    unread: function (ch, from) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/unread', { from: from }); },
    pins: function (ch) { return req('GET', 'channels/' + encodeURIComponent(ch) + '/pins'); },
    pin: function (id, on) { return req('POST', 'messages/' + id + '/pin', { on: on }); },
    addBookmark: function (ch, p) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/bookmarks', p); },
    removeBookmark: function (ch, id) { return req('DELETE', 'channels/' + encodeURIComponent(ch) + '/bookmarks/' + encodeURIComponent(id)); },
    makeRequest: function (ch, p) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/request', p); },
    createChannel: function (p) { return req('POST', 'channels', p).then(function (d) { return d.channel; }); },
    openDm: function (ids) { return req('POST', 'conversations', { members: ids }).then(function (d) { return d.channel; }); },
    browse: function () { return req('GET', 'channels/browse'); },
    join: function (id) { return req('POST', 'channels/' + encodeURIComponent(id) + '/join', {}).then(function (d) { return d.channel; }); },
    leave: function (id) { return req('POST', 'channels/' + encodeURIComponent(id) + '/leave', {}); },
    setTopic: function (id, topic) { return req('PATCH', 'channels/' + encodeURIComponent(id), { topic: topic }); },
    addMembers: function (id, emails) { return req('POST', 'channels/' + encodeURIComponent(id) + '/members', { emails: emails }).then(function (d) { return d.channel; }); },
    driveSearch: function (q) { return req('GET', 'drive?q=' + encodeURIComponent(q)); },
    shareAnswer: function (id, opts) { return req('POST', 'messages/' + id + '/share', opts && opts.summary ? { summary: true } : {}); },
    dismissAnswer: function (id) { return req('POST', 'messages/' + id + '/dismiss', {}); },
    clips: function () { return req('GET', 'clips'); },
    startMeeting: function (ch) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/meeting', {}); },
    huddle: function (ch) { return req('GET', 'channels/' + encodeURIComponent(ch) + '/huddle').then(function (d) { return d.huddle || null; }); },
    upload: function (file) {
      return req('POST', 'upload', null, { body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }).then(function (d) { return { id: d.id, name: d.name, size: d.size, mime: d.mime, url: d.url }; });
    },
    // Chat's smarter side (chat-smart.js): every rule lives in the API, the page only asks and draws.
    setLang: function (lang) { return req('POST', 'prefs', { lang: lang }); },
    translate: function (ids, force) { return req('POST', 'translate', { ids: ids, force: force || undefined }); },
    catchup: function (ch, from, thread) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/catchup', { from: from, thread: thread || undefined }); },
    remind: function (id, when) { return req('POST', 'messages/' + id + '/remind', { when: when }); },
    entities: function (q) { return req('GET', 'entities?q=' + encodeURIComponent(q)); },
    workOwners: function () { return req('GET', 'owners'); },
    onEvent: function (h) { handlers.push(h); }
  };
  // Huddle rings (public/js/ring.js) arrive on this page's socket.
  window.FavorChatLive = { on: api.onEvent };

  /* ------------------------------------------------------------------ start */
  var qs = new URLSearchParams(location.search);
  var app = null;
  function paintUnread(u) {
    var n = (u && u.mentions) || 0;
    document.querySelectorAll('[data-count="chatMentions"]').forEach(function (el) { el.textContent = n.toLocaleString('en-US'); el.hidden = !n; });
    // An answer that lands after the person left Chat must not rename the page they are on now.
    if (document.body.dataset.nav === 'chat') document.title = (n ? '(' + (n > 99 ? '99+' : n) + ') ' : '') + 'Chat - FavorOS';
    window.dispatchEvent(new CustomEvent('favor-chat:unread', { detail: u }));
  }
  // A Favor Brain answer is drawn by the Brain page's own block code and pressed by it too (chat-brain.js ties the two to a message).
  function blocks(list, m) { return window.FavorChatBrain ? window.FavorChatBrain.html(list, m) : ''; }
  window.FavorChat.mount(root, api, {
    initial: qs.get('c') || null,
    renderBlocks: blocks,
    onUnread: paintUnread,
    // A desktop notice for a direct message, a mention or a reply, when Chat is not in front and the person turned notices on.
    onNotify: function (m, ch) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !app || (!document.hidden && document.hasFocus())) return;
      var who = app.user(m.user_id).name, where = ch.kind === 'dm' ? who : ch.kind === 'group' ? 'Group conversation' : '#' + ch.name;
      var text = String(m.body || '').replace(/<@([^>]+)>/g, function (_, id) { return '@' + (id === 'brain' ? 'Favor Brain' : app.user(id).name); }).replace(/<#[^>]+>/g, '').trim() || 'Shared an attachment';
      try {
        var n = new Notification(ch.kind === 'dm' ? who : who + ' in ' + where, { body: text.slice(0, 180), tag: 'chat-' + ch.id, icon: '/images/favor-icon.png' });
        n.onclick = function () { window.focus(); if (m.thread_id) app.threadIn(ch.id, m.thread_id); else app.open(ch.id); n.close(); };
      } catch (e) { /* a phone browser outside the home screen app has no notices */ }
    },
    recordClip: function (channelId) {
      var cam = document.getElementById('clip-cam');
      if (!cam || cam.hidden) { app && app.toast('Recording is not available for your account'); return; }
      pendingClip = channelId; cam.click();
    }
  }).then(function (a) {
    app = a;
    window.favorChat = a;
    if (window.FavorChatBrain) window.FavorChatBrain.attach(a);
    if (window.FavorChatSmart) window.FavorChatSmart.attach(a);
    connect();
    // A copied link opens its conversation, its thread when it has one, and shows the message.
    var t = qs.get('t'), mid = qs.get('m');
    if (t && qs.get('c')) setTimeout(function () { a.thread(Number(t)); if (mid) a.focus(Number(mid), true); }, 400);
    else if (mid) a.focus(Number(mid));
  }).catch(function (e) {
    var gate = e && (e.status === 403 || e.status === 401);
    root.innerHTML = '<div class="ch-gate"><div><h2>' + (gate ? 'Chat is not open to you yet' : 'Chat did not load') + '</h2><p>' + (e && e.message ? String(e.message).replace(/</g, '&lt;') : 'Reload the page to try again.') + '</p></div></div>';
  });
})();
