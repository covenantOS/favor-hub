/* Favor Chat page: the real transport behind chat-ui.js. REST for everything that changes data, one WebSocket (through the
   favor-chat Worker's ChatRoom) for everything that arrives, a poll as the fallback when the socket cannot open. */
(function () {
  'use strict';
  var root = document.getElementById('chat-root');
  if (!root || !window.FavorChat) return;
  var handlers = [];
  var emit = function (ev) { handlers.forEach(function (h) { try { h(ev); } catch (e) { console.error(e); } }); };

  function req(method, path, body, raw) {
    var headers = { 'X-Hub-Request': '1' };
    if (body && !raw) headers['Content-Type'] = 'application/json';
    return fetch('/api/chat/' + path, { method: method, credentials: 'same-origin', headers: Object.assign(headers, raw ? raw.headers : {}), body: raw ? raw.body : body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = res.status; throw e; } return d; }); });
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
    ws.onmessage = function (e) { if (e.data === 'pong') return; try { lastSeen = Date.now(); emit(JSON.parse(e.data)); } catch (_) { /* not ours */ } };
    ws.onclose = function () {
      clearInterval(pingT);
      if (closedByUs) return;
      emit({ type: 'conn', ok: false });
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, Math.min(30000, 800 * Math.pow(2, retry)));
      fallback();
    };
    ws.onerror = function () { /* onclose follows */ };
  }
  function fallback() {
    if (pollT) return;
    pollT = setInterval(function () { if (!document.hidden) emit({ type: 'resync' }); }, 20000);
  }
  document.addEventListener('visibilitychange', function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', s: document.hidden ? 'away' : 'online' }));
    if (!document.hidden && (!ws || ws.readyState !== 1)) connect();
  });

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
    typing: function (ch) { req('POST', 'channels/' + encodeURIComponent(ch) + '/typing', {}).catch(function () {}); },
    mute: function (ch, muted) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/mute', { muted: muted }); },
    search: function (q, o) { return req('GET', 'search?q=' + encodeURIComponent(q) + '&filter=' + encodeURIComponent((o && o.filter) || 'all') + '&channel=' + encodeURIComponent((o && o.channel) || '')); },
    createChannel: function (p) { return req('POST', 'channels', p).then(function (d) { return d.channel; }); },
    openDm: function (ids) { return req('POST', 'conversations', { members: ids }).then(function (d) { return d.channel; }); },
    browse: function () { return req('GET', 'channels/browse'); },
    join: function (id) { return req('POST', 'channels/' + encodeURIComponent(id) + '/join', {}).then(function (d) { return d.channel; }); },
    leave: function (id) { return req('POST', 'channels/' + encodeURIComponent(id) + '/leave', {}); },
    setTopic: function (id, topic) { return req('PATCH', 'channels/' + encodeURIComponent(id), { topic: topic }); },
    addMembers: function (id, emails) { return req('POST', 'channels/' + encodeURIComponent(id) + '/members', { emails: emails }).then(function (d) { return d.channel; }); },
    driveSearch: function (q) { return req('GET', 'drive?q=' + encodeURIComponent(q)); },
    clips: function () { return req('GET', 'clips'); },
    startMeeting: function (ch) { return req('POST', 'channels/' + encodeURIComponent(ch) + '/meeting', {}); },
    upload: function (file) {
      return req('POST', 'upload', null, { body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }).then(function (d) { return { id: d.id, name: d.name, size: d.size, mime: d.mime, url: d.url }; });
    },
    onEvent: function (h) { handlers.push(h); }
  };

  /* ------------------------------------------------------------------ start */
  var qs = new URLSearchParams(location.search);
  var app = null;
  function paintUnread(u) {
    var n = (u && u.mentions) || 0;
    document.querySelectorAll('[data-count="chatMentions"]').forEach(function (el) { el.textContent = String(n); el.hidden = !n; });
    document.title = (n ? '(' + n + ') ' : '') + 'Chat - Favor Hub';
    window.dispatchEvent(new CustomEvent('favor-chat:unread', { detail: u }));
  }
  function blocks(list, m) {
    var B = window.BrainBlocks;
    if (!B || !B.render) return '';
    var h = list.map(function (b, i) { try { return B.render(b, { ti: 0, bi: i, canSheets: false }); } catch (e) { return ''; } }).join('');
    var follow = (m && m.brain && m.brain.follow) || [];
    if (follow.length) h += '<div class="ch-ans__chips">' + follow.map(function (q) { return '<button type="button" class="ch-chip" data-act="chip" data-q="' + String(q).replace(/"/g, '&quot;') + '">' + String(q).replace(/</g, '&lt;') + '</button>'; }).join('') + '</div>';
    return '<div class="bc-root">' + h + '</div>';
  }
  window.FavorChat.mount(root, api, {
    initial: qs.get('c') || null,
    renderBlocks: blocks,
    onUnread: paintUnread,
    onNotify: function (m, ch) { /* the rail badge and tab title carry it */ },
    recordClip: function (channelId) {
      var cam = document.getElementById('clip-cam');
      if (!cam || cam.hidden) { app && app.toast('Recording is not available for your account'); return; }
      pendingClip = channelId; cam.click();
    }
  }).then(function (a) {
    app = a;
    window.favorChat = a;
    connect();
    var t = qs.get('t');
    if (t && qs.get('c')) setTimeout(function () { a.thread(Number(t)); }, 400);
    else if (qs.get('m')) a.focus(Number(qs.get('m')));
  }).catch(function (e) {
    var gate = e && (e.status === 403 || e.status === 401);
    root.innerHTML = '<div class="ch-gate"><div><h2>' + (gate ? 'Chat is not open to you yet' : 'Chat did not load') + '</h2><p>' + (e && e.message ? String(e.message).replace(/</g, '&lt;') : 'Reload the page to try again.') + '</p></div></div>';
  });
})();
