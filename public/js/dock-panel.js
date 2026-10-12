/* The floating dock's panel, loaded the first time it opens (dock.js is the always-on part and owns the socket and the numbers).
   Chat tab: the person's conversations, one conversation or thread with a composer, over the same /api/chat the Chat page uses.
   Favor Brain tab: the ask box and answers, drawn by the Brain page's own block code (brain-blocks.js) over /api/brain, so the chat
   list is the Brain page's list. Where the panel is on screen and what it shows live in sessionStorage through FavorDock.save. */
(function () {
  'use strict';
  var D = window.FavorDock;
  if (!D || window.FavorDockPanel) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var S = D.state();
  var panel = null, body = null, msgs = {}, hasMore = {}, thread = null, box = null, threadsList = null, listQ = '';
  var brain = { convs: null, cur: null, busy: null, view: 'chat', loading: null, ready: null };
  var bodyHost = null;

  function ic(n) {
    var p = { back: 'M15 5l-7 7 7 7', send: 'M4 12l16-8-6 16-2-7z', lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', plus: 'M12 5v14M5 12h14', thread: 'M5 6h14v9H9l-4 4z', hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16' };
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + p[n] + '"/></svg>';
  }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var n = new Date(), same = d.toDateString() === n.toDateString();
    if (same) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var y = new Date(n - 864e5);
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (d.getFullYear() !== n.getFullYear() ? ', ' + d.getFullYear() : '');
  }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase(); }
  function avatar(id) {
    var u = D.users[id] || {};
    if (id === 'brain') return '<span class="fp-av fp-av--brain" aria-hidden="true"></span>';
    return '<span class="fp-av">' + (u.picture ? '<img alt="" src="' + esc(u.picture) + '" referrerpolicy="no-referrer" loading="lazy">' : esc(initials(D.name(id)))) + '</span>';
  }
  function chName(c) {
    if (c.kind === 'public' || c.kind === 'private') return c.name;
    var others = (c.members || []).filter(function (m) { return m !== D.me; });
    if (c.kind === 'dm') return others.length ? D.name(others[0]) : D.name(D.me) + ' (you)';
    return others.map(function (m) { return D.name(m).split(' ')[0]; }).join(', ') || 'Group';
  }
  function toast(msg) {
    var t = $('.fp-toast', panel);
    if (!t) { t = document.createElement('div'); t.className = 'fp-toast'; t.setAttribute('role', 'status'); panel.appendChild(t); }
    t.textContent = msg; t.classList.add('is-on'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('is-on'); }, 2800);
  }
  function focused() { return !document.hidden && document.hasFocus() && panel && !panel.hidden; }

  /* ================================================================ show */
  function show() {
    panel = $('#fd-p'); body = $('[data-body]', panel);
    if (!P.wired) { P.wired = true; D.on(onEvent); wire(); }
    route();
  }
  function route() {
    P.last = S.tab; destroyBox();
    if (S.tab === 'brain') brainShow(); else chatShow();
  }
  function wire() {
    body.addEventListener('click', onClick);
    body.addEventListener('submit', onSubmit);
    body.addEventListener('input', function (e) { if (e.target.matches('[data-q]')) { listQ = e.target.value; paintList(); } });
  }

  /* ================================================================ chat: the list */
  function chatShow() {
    body.innerHTML = '<div class="fp-wait"><i></i><i></i><i></i></div>';
    D.ready().then(function () {
      if (S.tab !== 'chat') return;
      if (S.ch && D.ch[S.ch]) { if (S.th) openThread(S.th, true); else openConv(S.ch, true); } else { S.ch = null; D.save({ ch: null, th: null }); renderList(); }
      refreshBadge();
    });
  }
  function refreshBadge() {
    var n = 0; Object.keys(D.ch).forEach(function (k) { n += D.ch[k].mentions || 0; }); n += D.threads || 0;
    var b = $('.fd-p__n', panel); if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  }
  function sorted() {
    var all = Object.keys(D.ch).map(function (k) { return D.ch[k]; }).filter(function (c) { return c.joined !== false; });
    var q = listQ.trim().toLowerCase();
    if (q) all = all.filter(function (c) { return chName(c).toLowerCase().indexOf(q) >= 0; });
    var by = function (a, b) { var ua = (a.unread > 0 && !a.muted) || a.mentions > 0 ? 1 : 0, ub = (b.unread > 0 && !b.muted) || b.mentions > 0 ? 1 : 0; return ub - ua || String(b.last_at || '').localeCompare(String(a.last_at || '')) || chName(a).localeCompare(chName(b)); };
    return { dms: all.filter(function (c) { return c.kind === 'dm' || c.kind === 'group'; }).sort(by), chans: all.filter(function (c) { return c.kind === 'public' || c.kind === 'private'; }).sort(by) };
  }
  function rowHtml(c) {
    var icon;
    if (c.kind === 'dm') { var o = (c.members || []).filter(function (m) { return m !== D.me; })[0] || D.me; icon = avatar(o); }
    else if (c.kind === 'group') icon = '<span class="fp-av fp-av--g">' + esc(String((c.members || []).length)) + '</span>';
    else icon = '<span class="fp-av fp-av--c">' + (c.kind === 'private' ? ic('lock') : '#') + '</span>';
    var un = c.unread > 0 && !c.muted;
    return '<button type="button" class="fp-row' + (un || c.mentions > 0 ? ' is-unread' : '') + (c.muted ? ' is-muted' : '') + '" data-open="' + esc(c.id) + '">' + icon + '<span class="fp-row__n">' + esc(chName(c)) + '</span>' +
      (c.mentions > 0 ? '<span class="fp-badge" aria-label="' + c.mentions + ' to read">' + (c.mentions > 99 ? '99+' : c.mentions) + '</span>' : un ? '<span class="fp-dot" aria-label="Unread"></span>' : '') + '</button>';
  }
  function renderList() {
    S.ch = null;
    body.innerHTML = '<div class="fp-list"><div class="fp-search"><input type="search" data-q placeholder="Find a conversation" aria-label="Find a conversation" autocomplete="off" value="' + esc(listQ) + '"></div><div class="fp-scroll" data-list></div>' +
      '<footer class="fp-foot"><a href="/chat/">Open Chat</a></footer></div>';
    paintList();
  }
  function paintList() {
    var host = $('[data-list]', body); if (!host) return;
    var s = sorted(), tu = D.threads || 0;
    var h = '<button type="button" class="fp-row fp-row--thr' + (tu ? ' is-unread' : '') + '" data-threads><span class="fp-av fp-av--c">' + ic('thread') + '</span><span class="fp-row__n">Threads</span>' + (tu ? '<span class="fp-badge">' + (tu > 99 ? '99+' : tu) + '</span>' : '') + '</button>';
    h += '<div class="fp-sec">Direct messages</div>' + (s.dms.length ? s.dms.map(rowHtml).join('') : '<div class="fp-none">' + (listQ ? 'No match.' : 'No conversations yet.') + '</div>');
    h += '<div class="fp-sec">Channels</div>' + (s.chans.length ? s.chans.map(rowHtml).join('') : '<div class="fp-none">' + (listQ ? 'No match.' : 'No channels yet.') + '</div>');
    host.innerHTML = h;
  }
  function openThreadsList() {
    S.ch = null; destroyBox();
    body.innerHTML = '<div class="fp-conv"><header class="fp-head"><button type="button" class="fp-back" data-back aria-label="Back to conversations">' + ic('back') + '</button><b>Threads</b></header><div class="fp-scroll" data-tlist><div class="fp-wait"><i></i><i></i><i></i></div></div></div>';
    D.req('GET', 'threads').then(function (d) {
      D.threads = d.unread || 0; D.paint(); var host = $('[data-tlist]', body); if (!host) return;
      var list = d.threads || [];
      host.innerHTML = list.length ? list.map(function (t) {
        var c = D.ch[t.channel_id] || {}, last = (t.latest && t.latest[t.latest.length - 1]) || t.root;
        return '<button type="button" class="fp-row fp-row--t' + (t.unread ? ' is-unread' : '') + '" data-thread="' + t.root.id + '" data-in="' + esc(t.channel_id) + '"><span class="fp-row__c"><span class="fp-row__n">' + esc(c.id ? chName(c) : 'Conversation') + '</span><span class="fp-row__s">' + esc(D.name(last.user_id).split(' ')[0] + ': ' + D.plain(last.body).slice(0, 90)) + '</span></span>' + (t.unread ? '<span class="fp-badge">' + t.unread + '</span>' : '') + '</button>';
      }).join('') : '<div class="fp-none">No threads you are in.</div>';
    }).catch(function (e) { var host = $('[data-tlist]', body); if (host) host.innerHTML = '<div class="fp-none">' + esc(e.message) + '</div>'; });
  }

  /* ================================================================ chat: a conversation */
  function openConv(id, keep) {
    var c = D.ch[id]; if (!c) return renderList();
    thread = null; destroyBox();
    D.save({ ch: id, th: null });
    paintConv(c);
    var go = function () { scrollEnd(); markRead(); };
    if (msgs[id]) { drawMsgs(); go(); }
    D.req('GET', 'channels/' + encodeURIComponent(id) + '/messages').then(function (d) {
      var old = msgs[id], fresh = d.messages || [];
      // Anything that arrived live between the two stays.
      if (old) old.forEach(function (m) { if (!fresh.some(function (x) { return x.id === m.id; }) && m.id > ((fresh[fresh.length - 1] || {}).id || 0)) fresh.push(m); });
      msgs[id] = fresh; hasMore[id] = !!d.more;
      if (S.ch === id && !S.th) { drawMsgs(); go(); }
    }).catch(function (e) { if (S.ch === id) { var m = $('[data-msgs]', body); if (m) m.innerHTML = '<div class="fp-none">' + esc(e.message) + '</div>'; if (e.status === 403 || e.status === 404) { D.save({ ch: null }); } } });
  }
  function paintConv(c) {
    var o = c.kind === 'dm' ? (c.members || []).filter(function (m) { return m !== D.me; })[0] : null;
    body.innerHTML = '<div class="fp-conv"><header class="fp-head"><button type="button" class="fp-back" data-back aria-label="Back to conversations">' + ic('back') + '</button>' + (o ? avatar(o) : '') +
      '<b class="fp-head__t">' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</b><a class="fp-ext" href="/chat/?c=' + encodeURIComponent(c.id) + '" title="Open in Chat" aria-label="Open in Chat">' + ic('ext') + '</a></header>' +
      '<div class="fp-scroll fp-msgs" data-msgs><div class="fp-wait"><i></i><i></i><i></i></div></div><div class="fp-comp" data-comp></div></div>';
    mountBox();
  }
  function bodyHtml(m) {
    if (m.deleted) return '<span class="fp-del">This message was deleted</span>';
    var t = window.FavorMention ? window.FavorMention.render(m.body, D.mentions(), D.me) : esc(m.body);
    var a = (m.attachments || []).map(function (x) {
      var href = '/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id;
      if (x.type === 'file') return /^image\//.test(x.mime || '') ? '<a class="fp-img" href="' + esc(x.url) + '" target="_blank" rel="noopener"><img alt="' + esc(x.name) + '" src="' + esc(x.url) + '" loading="lazy"></a>' : '<a class="fp-att" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name || 'File') + '</a>';
      if (x.type === 'clip') return '<a class="fp-att" href="' + href + '">Clip</a>';
      if (x.type === 'meeting') return '<a class="fp-att" href="' + href + '">Meeting</a>';
      if (x.type === 'drive') return '<a class="fp-att" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name || 'Drive file') + '</a>';
      if (x.type === 'link' && x.url) return '<a class="fp-att" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title || x.url) + '</a>';
      return '<a class="fp-att" href="' + href + '">Open in Chat</a>';
    }).join('');
    if (m.brain) a += '<a class="fp-att fp-att--brain" href="/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id + (m.thread_id ? '&t=' + m.thread_id : '') + '">Favor Brain answer. Open in Chat</a>';
    return (t ? '<div class="fp-txt">' + t + '</div>' : '') + a + (m.edited_at ? ' <span class="fp-ed">edited</span>' : '');
  }
  function msgHtml(m, prev, inThread) {
    var same = prev && prev.user_id === m.user_id && !prev.deleted && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000;
    var re = (m.reactions || []).filter(function (r) { return r.users && r.users.length; }).map(function (r) { return '<button type="button" class="fp-re' + (r.users.indexOf(D.me) >= 0 ? ' is-me' : '') + '" data-react="' + m.id + '" data-emoji="' + esc(r.emoji) + '">' + esc(r.emoji) + ' ' + r.users.length + '</button>'; }).join('');
    var rep = !inThread && m.reply_count ? '<button type="button" class="fp-rep' + (m.thread_unread ? ' is-unread' : '') + '" data-thread="' + m.id + '">' + ic('thread') + m.reply_count + (m.reply_count === 1 ? ' reply' : ' replies') + (m.thread_unread ? ' <b>' + m.thread_unread + ' new</b>' : '') + '</button>' : '';
    var act = !inThread && !m.deleted && !m.visible_to ? '<button type="button" class="fp-mact" data-thread="' + m.id + '" aria-label="Reply in thread" title="Reply in thread">' + ic('thread') + '</button>' : '';
    return '<div class="fp-m' + (same ? ' is-cont' : '') + (m.visible_to ? ' is-private' : '') + '" data-id="' + m.id + '">' + (same ? '<span class="fp-gap"></span>' : avatar(m.user_id)) +
      '<div class="fp-m__b">' + (same ? '' : '<div class="fp-m__h"><b>' + esc(D.name(m.user_id)) + '</b><time datetime="' + esc(m.created_at) + '">' + esc(when(m.created_at)) + '</time></div>') + bodyHtml(m) + (re ? '<div class="fp-res">' + re + '</div>' : '') + rep + '</div>' + act + '</div>';
  }
  function drawMsgs() {
    var host = $('[data-msgs]', body); if (!host) return;
    var list = msgs[S.ch] || [], h = '', prev = null;
    if (hasMore[S.ch]) h += '<button type="button" class="fp-more" data-older>Show older messages</button>';
    list.forEach(function (m) { h += msgHtml(m, prev); prev = m; });
    host.innerHTML = h || '<div class="fp-none">No messages yet. Say hello.</div>';
  }
  function scrollEnd() { var h = $('[data-msgs]', body); if (h) h.scrollTop = h.scrollHeight; }
  function nearEnd() { var h = $('[data-msgs]', body); return !h || h.scrollHeight - h.scrollTop - h.clientHeight < 140; }
  function markRead() {
    var id = S.ch, list = msgs[id] || [], last = list.length ? list[list.length - 1].id : 0, c = D.ch[id];
    if (!c || !focused()) return;
    if (c.unread || c.mentions) { c.unread = 0; c.mentions = 0; D.paint(); if (last) D.req('POST', 'channels/' + encodeURIComponent(id) + '/read', { upTo: last }).catch(function () {}); }
  }
  function olderMessages() {
    var id = S.ch, list = msgs[id] || []; if (!list.length) return;
    D.req('GET', 'channels/' + encodeURIComponent(id) + '/messages?before=' + list[0].id).then(function (d) {
      var host = $('[data-msgs]', body), h0 = host ? host.scrollHeight : 0;
      msgs[id] = (d.messages || []).concat(msgs[id] || []); hasMore[id] = !!d.more;
      if (S.ch === id && !S.th) { drawMsgs(); if (host) host.scrollTop = host.scrollHeight - h0; }
    }).catch(function (e) { toast(e.message); });
  }

  /* ================================================================ chat: a thread */
  function openThread(rootId, keep) {
    var cid = S.ch; if (!cid && D.ch) return renderList();
    D.save({ th: rootId });
    destroyBox();
    var c = D.ch[cid] || {};
    body.innerHTML = '<div class="fp-conv"><header class="fp-head"><button type="button" class="fp-back" data-back aria-label="Back">' + ic('back') + '</button><b class="fp-head__t">Thread' + (c.id ? ' in ' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) : '') + '</b><a class="fp-ext" href="/chat/?c=' + encodeURIComponent(cid) + '&t=' + rootId + '" title="Open in Chat" aria-label="Open in Chat">' + ic('ext') + '</a></header>' +
      '<div class="fp-scroll fp-msgs" data-msgs><div class="fp-wait"><i></i><i></i><i></i></div></div><div class="fp-comp" data-comp></div></div>';
    mountBox();
    D.req('GET', 'threads/' + rootId).then(function (d) {
      if (S.th !== rootId) return;
      thread = { root: d.root, replies: d.replies || [] };
      D.threads = d.threads_unread != null ? d.threads_unread : D.threads; D.paint();
      drawThread(); scrollEnd();
    }).catch(function (e) { var h = $('[data-msgs]', body); if (h) h.innerHTML = '<div class="fp-none">' + esc(e.message) + '</div>'; D.save({ th: null }); });
  }
  function drawThread() {
    var host = $('[data-msgs]', body); if (!host || !thread) return;
    var all = [thread.root].concat(thread.replies), prev = null, h = '';
    all.forEach(function (m, i) { h += msgHtml(m, prev, true); if (i === 0) h += '<div class="fp-sep">' + thread.replies.length + (thread.replies.length === 1 ? ' reply' : ' replies') + '</div>'; prev = i === 0 ? null : m; });
    host.innerHTML = h;
  }

  /* ================================================================ the composer */
  function mountBox() {
    var host = $('[data-comp]', body); if (!host) return;
    host.innerHTML = '<div class="fp-comp__in"><div data-mi></div><button type="button" class="fp-send" data-send aria-label="Send" disabled>' + ic('send') + '</button></div>';
    if (!window.FavorMention) { host.innerHTML = '<form class="fp-comp__in" data-plain><input type="text" maxlength="4000" placeholder="Message" aria-label="Message"><button type="submit" class="fp-send">' + ic('send') + '</button></form>'; return; }
    var c = D.ch[S.ch] || {}, label = S.th ? 'Reply in thread' : c.kind === 'public' || c.kind === 'private' ? 'Message #' + c.name : 'Message ' + chName(c);
    box = window.FavorMention.attach($('[data-mi]', host), {
      me: D.me, placeholder: label, label: label, max: 4000,
      people: function () { return Object.keys(D.users).map(function (k) { return { id: k, name: D.users[k].name, sub: D.users[k].title, picture: D.users[k].picture }; }); },
      enterSends: function () { return true; },
      onInput: function (b) { var s = $('[data-send]', host); if (s) s.disabled = b.isEmpty(); draftSave(b.value()); },
      onSubmit: function () { send(); }
    });
    var d = draftGet(); if (d) { box.setValue(d, D.mentions()); var s = $('[data-send]', host); if (s) s.disabled = box.isEmpty(); }
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(function () { if (box) box.focus(); }, 60);
  }
  function destroyBox() { if (box && box.destroy) { try { box.destroy(); } catch (e) { /* gone */ } } box = null; }
  function dkey() { return 'favor.dock.draft.' + (S.th || S.ch); }
  function draftSave(v) { try { if (v && v.trim()) sessionStorage.setItem(dkey(), v); else sessionStorage.removeItem(dkey()); } catch (e) { /* full */ } }
  function draftGet() { try { return sessionStorage.getItem(dkey()) || ''; } catch (e) { return ''; } }
  function send(plain) {
    var text = plain != null ? plain : box ? box.value().trim() : ''; if (!text || !S.ch) return;
    var cid = S.ch, tid = S.th, btn = $('[data-send]', body); if (btn) btn.disabled = true;
    var key = dkey();
    D.req('POST', 'channels/' + encodeURIComponent(cid) + '/messages', Object.assign({ body: text }, tid ? { thread_id: tid } : {})).then(function (d) {
      try { sessionStorage.removeItem(key); } catch (e) { /* ok */ }
      if (box && S.ch === cid && S.th === tid) { box.clear(); }
      addMsg(d.message, true);
      var c = D.ch[cid]; if (c) { c.unread = 0; c.mentions = 0; c.last_at = d.message.created_at; D.paint(); D.req('POST', 'channels/' + encodeURIComponent(cid) + '/read', { upTo: d.message.id }).catch(function () {}); }
    }).catch(function (e) { toast(e.message); if (btn) btn.disabled = false; });
  }
  function addMsg(m, mine) {
    if (m.thread_id) {
      if (S.th && thread && thread.root.id === m.thread_id && S.ch === m.channel_id) {
        if (!thread.replies.some(function (x) { return x.id === m.id; })) { var stick = nearEnd() || mine; thread.replies.push(m); drawThread(); if (stick) scrollEnd(); if (!mine && focused()) D.req('GET', 'threads/' + thread.root.id).catch(function () {}); }
      }
      var list = msgs[m.channel_id], par = list && list.filter(function (x) { return x.id === m.thread_id; })[0];
      if (par) { par.reply_count = (par.reply_count || 0) + 1; par.last_reply_at = m.created_at; }
      return;
    }
    var l = msgs[m.channel_id];
    if (l) { if (l.some(function (x) { return x.id === m.id; })) return; l.push(m); }
    if (S.ch === m.channel_id && !S.th && S.tab === 'chat' && $('[data-msgs]', body)) { var stick2 = nearEnd() || mine; drawMsgs(); if (stick2) scrollEnd(); if (!mine) markRead(); }
  }

  /* ================================================================ live events for the panel */
  function onEvent(ev) {
    if (!panel || panel.hidden) { if (ev.type === 'message' && ev.message) addMsgQuiet(ev.message); return; }
    if (ev.type === 'dock:paint') { refreshBadge(); if (S.tab === 'chat' && !S.ch && $('[data-list]', body)) paintList(); }
    else if (ev.type === 'dock:tab') { if (P.last !== S.tab) { P.last = S.tab; route(); } }
    else if (ev.type === 'message' && ev.message) addMsg(ev.message, ev.message.user_id === D.me);
    else if (ev.type === 'edit' && ev.message) patch(ev.message);
    else if (ev.type === 'delete') { var f = find(ev.id); if (f) patch(Object.assign({}, f, { deleted: true, body: '', attachments: [] })); }
    else if (ev.type === 'reaction') { var g = find(ev.id); if (g) { g.reactions = ev.reactions; patch(g); } }
    else if (ev.type === 'resync') { if (S.tab === 'chat' && S.ch && !S.th) { delete msgs[S.ch]; openConv(S.ch, true); } }
  }
  function addMsgQuiet(m) { var l = msgs[m.channel_id]; if (l && !m.thread_id && !l.some(function (x) { return x.id === m.id; })) l.push(m); }
  function find(id) {
    var out = null;
    Object.keys(msgs).forEach(function (k) { (msgs[k] || []).forEach(function (m) { if (m.id === id) out = m; }); });
    if (!out && thread) [thread.root].concat(thread.replies).forEach(function (m) { if (m.id === id) out = m; });
    return out;
  }
  function patch(m) {
    Object.keys(msgs).forEach(function (k) { msgs[k] = (msgs[k] || []).map(function (x) { return x.id === m.id ? Object.assign({}, x, m) : x; }); });
    if (thread) { if (thread.root.id === m.id) thread.root = Object.assign({}, thread.root, m); thread.replies = thread.replies.map(function (x) { return x.id === m.id ? Object.assign({}, x, m) : x; }); }
    if (S.tab === 'chat' && S.ch && $('[data-msgs]', body)) { var keep = nearEnd(); if (S.th) drawThread(); else drawMsgs(); if (keep) scrollEnd(); }
  }

  /* ================================================================ clicks */
  function onClick(e) {
    var t = e.target.closest('button, a'); if (!t || !body.contains(t)) return;
    if (t.hasAttribute('data-open')) { listQ = ''; openConv(t.getAttribute('data-open')); }
    else if (t.hasAttribute('data-back')) {
      if (S.th) { var cid = S.ch; D.save({ th: null }); thread = null; if (S.from === 'threads') { D.save({ ch: null }); S.from = null; openThreadsList(); } else openConv(cid); }
      else { D.save({ ch: null, th: null }); destroyBox(); if (S.tab === 'brain') { brain.view = 'chat'; brainRender(); } else renderList(); }
    }
    else if (t.hasAttribute('data-threads')) { S.from = 'threads'; openThreadsList(); }
    else if (t.hasAttribute('data-thread')) { if (t.hasAttribute('data-in')) { D.save({ ch: t.getAttribute('data-in') }); S.from = 'threads'; } else S.from = null; destroyBox(); openThread(Number(t.getAttribute('data-thread'))); }
    else if (t.hasAttribute('data-older')) olderMessages();
    else if (t.hasAttribute('data-send')) send();
    else if (t.hasAttribute('data-react')) { D.req('POST', 'messages/' + t.getAttribute('data-react') + '/reactions', { emoji: t.getAttribute('data-emoji') }).catch(function (er) { toast(er.message); }); }
    else if (t.closest('[data-brain]')) brainClick(e, t);
  }
  function onSubmit(e) {
    if (e.target.matches('[data-plain]')) { e.preventDefault(); var i = $('input', e.target); send(i.value.trim()); i.value = ''; }
    else if (e.target.matches('[data-bask]')) { e.preventDefault(); var inp = $('textarea', e.target); var q = inp.value.trim(); if (q) { inp.value = ''; inp.style.height = ''; brainAsk(q); } }
  }

  /* ================================================================ Favor Brain */
  function bapi(path, opt) {
    opt = opt || {};
    return fetch('/api/brain/' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: opt.body ? { 'Content-Type': 'application/json' } : undefined, body: opt.body ? JSON.stringify(opt.body) : undefined, signal: opt.signal, keepalive: !!opt.keepalive })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) { var err = new Error(d.message || d.error || 'The Brain did not answer (' + res.status + ').'); err.ref = d.ref; err.status = res.status; throw err; } return d; }); });
  }
  function loadBrainCode() {
    if (brain.ready) return brain.ready;
    brain.ready = new Promise(function (ok, bad) {
      if (window.BrainBlocks) { ok(); return; }
      var s = document.createElement('script'); s.src = '/js/brain-blocks.js?v=13'; s.onload = ok; s.onerror = function () { brain.ready = null; bad(new Error('Favor Brain did not load.')); }; document.head.appendChild(s);
    });
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/dock-brain.css?v=1'; document.head.appendChild(l);
    return brain.ready;
  }
  var DAY = 864e5;
  var newId = function () { return 'c_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), function (b) { return b.toString(36).padStart(2, '0'); }).join('').slice(0, 8); };
  function fromReply(q, d) { return { q: q, ref: d.ref, at: new Date().toISOString(), blocks: d.blocks || [], reading: Array.isArray(d.reading) ? d.reading : [], follow: d.follow || [], markdown: d.markdown || d.text || '', intent: d.intent, outcome: d.outcome, asked_as: d.asked_as || q, extras: [] }; }
  function fromStored(t) {
    var a = t.answer || {};
    if (a.pending) return { q: t.question, at: t.at, blocks: null, pending: true, extras: [], reading: [], follow: [], stored: true };
    if (a.error) return { q: t.question, ref: t.ref, at: t.at, blocks: null, error: a.error, extras: [], reading: [], follow: [], stored: true };
    return { q: t.question, ref: t.ref, at: t.at, blocks: a.blocks || [], reading: Array.isArray(a.reading) ? a.reading : [], follow: a.follow || [], intent: a.intent, outcome: a.outcome, asked_as: a.asked_as || t.question, extras: [], stored: true };
  }
  function brainShow() {
    P.last = 'brain';
    body.innerHTML = '<div class="fp-wait"><i></i><i></i><i></i></div>';
    loadBrainCode().then(function () {
      if (S.tab !== 'brain') return;
      var id = S.bc;
      if (!brain.cur && id) return brainOpen(id, true);
      brainRender();
    }).catch(function (e) { body.innerHTML = '<div class="fp-none">' + esc(e.message) + '</div>'; });
  }
  function loadConvs() {
    return bapi('history').then(function (d) { brain.convs = d.threads || []; var l = $('[data-bconvs]', body); if (l) paintConvs(); if (brain.convs.some(function (c) { return c.pending; })) { clearTimeout(loadConvs.t); loadConvs.t = setTimeout(function () { if (S.tab === 'brain') loadConvs(); }, 3500); } }).catch(function () {});
  }
  function brainRender() {
    if (S.tab !== 'brain') return;
    var cur = brain.cur;
    if (brain.view === 'list') {
      body.innerHTML = '<div class="fp-conv" data-brain><header class="fp-head"><button type="button" class="fp-back" data-bback aria-label="Back">' + ic('back') + '</button><b class="fp-head__t">Your chats</b><button type="button" class="fp-new" data-bnew>' + ic('plus') + 'New chat</button></header><div class="fp-scroll" data-bconvs><div class="fp-wait"><i></i><i></i><i></i></div></div></div>';
      if (brain.convs) paintConvs(); loadConvs(); return;
    }
    body.innerHTML = '<div class="fp-conv" data-brain><header class="fp-head"><button type="button" class="fp-new fp-new--ghost" data-blist>Chats</button><b class="fp-head__t fp-head__t--c">' + esc(cur ? cur.title : 'New chat') + '</b>' + (cur && cur.turns.length ? '<button type="button" class="fp-new" data-bnew>' + ic('plus') + 'New</button><a class="fp-ext" href="/brain/?c=' + encodeURIComponent(cur.id) + '" title="Open on the Brain page" aria-label="Open on the Brain page">' + ic('ext') + '</a>' : '') + '</header>' +
      '<div class="fp-scroll fp-bthread" data-bthread></div>' +
      '<form class="fp-comp" data-bask><div class="fp-comp__in"><textarea rows="1" maxlength="600" placeholder="Ask Favor Brain" aria-label="Ask Favor Brain"></textarea><button type="submit" class="fp-send" aria-label="Ask" disabled>' + ic('send') + '</button></div></form></div>';
    var ta = $('textarea', body), sb = $('.fp-send', body);
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; sb.disabled = !ta.value.trim() || !!brain.busy; });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('[data-bask]', body).requestSubmit(); } });
    brainThread();
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(function () { ta.focus(); }, 60);
  }
  function paintConvs() {
    var host = $('[data-bconvs]', body); if (!host) return;
    var l = brain.convs || [];
    host.innerHTML = l.length ? l.map(function (c) { return '<button type="button" class="fp-row" data-bopen="' + esc(c.id) + '">' + (c.pending ? '<i class="fp-work" role="img" aria-label="Answering"></i>' : '') + '<span class="fp-row__n">' + esc(c.title) + '</span></button>'; }).join('') : '<div class="fp-none">Your chats show here for 30 days.</div>';
  }
  var STARTERS = [['How is Favor doing this year?', 'Raised, goal and the same date last year'], ['How do I enter a check gift?', 'Steps from the Operations Manual'], ['What can you do?', 'Everything you can ask about']];
  function brainThread() {
    var host = $('[data-bthread]', body); if (!host) return;
    var cur = brain.cur;
    if (!cur || !cur.turns.length) {
      var n = (window.FAVOR_HUB && window.FAVOR_HUB.user && window.FAVOR_HUB.user.name || '').split(/\s+/)[0];
      host.innerHTML = '<div class="fp-bempty"><span class="fbr" data-state="idle" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span><h3>' + (n ? 'Hello, ' + esc(n) : 'Hello') + '</h3>' +
        STARTERS.map(function (s) { return '<button type="button" class="fp-start" data-bq="' + esc(s[0]) + '"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></button>'; }).join('') + '</div>';
      if (brain.busy) host.innerHTML = thinking(brain.busy.status);
      return;
    }
    var h = cur.turns.map(function (t, ti) {
      var last = ti === cur.turns.length - 1, waiting = (t.pending || (brain.busy && brain.busy.conv === cur)) && last && !t.blocks && !t.error && !t.stopped;
      return '<div class="fp-q"><div class="fp-q__b">' + esc(t.q) + '</div></div>' + (waiting ? thinking(brain.busy ? brain.busy.status : 'Looking at the records') : '<div class="fp-a bc-root" data-abody="' + ti + '">' + answerHtml(t, ti, last) + '</div>');
    }).join('');
    host.innerHTML = h;
    var B = window.BrainBlocks; if (B) { try { B.drawCharts(host); B.countUp(host, true); } catch (e) { /* a chart that will not draw */ } }
  }
  function thinking(st) { return '<div class="fp-think"><span class="fbr" data-state="thinking" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span><span id="fp-think-st">' + esc(st) + '</span></div>'; }
  function answerHtml(t, ti, last) {
    var B = window.BrainBlocks, expired = t.stored && Date.now() - new Date(t.at).getTime() >= DAY, h = '';
    if (t.error) h += '<div class="blk-text"><p class="bc-err">' + esc(t.error) + '</p></div>';
    else if (t.stopped) h += '<div class="blk-text"><p>Stopped. Ask again when you are ready.</p></div>';
    else if (!t.blocks || !t.blocks.length) h += B.fallback(t.markdown || 'No answer was kept for this one. Ask again.');
    else h += t.blocks.map(function (b, bi) { return B.render(b, { ti: ti, bi: bi, canSheets: false, canRequest: function () { return false; }, expired: expired }); }).join('');
    (t.extras || []).forEach(function (x) { h += B.render(x, { ti: ti, bi: -1, canSheets: false }); });
    h += B.reading(t.reading, ti);
    if (last && t.follow && t.follow.length && !t.error) h += '<div class="blk-follow" aria-label="Follow-up questions">' + t.follow.map(function (q) { return '<button type="button" class="fu" data-act="ask" data-q="' + esc(q) + '">' + B.ic('arrow') + esc(q) + '</button>'; }).join('') + '</div>';
    return h;
  }
  var host = {
    page: '/brain/',
    toast: function (m) { toast(m); },
    api: bapi,
    cue: function () {},
    ask: function (q, o) { o = o || {}; if (o.again) { return brainAsk(q, { at: Number(o.el.dataset.turn) }); } return brainAsk(q, { intent: o.intent }); },
    turn: function (el) { var cur = brain.cur; if (!cur) return null; if (el && el.dataset.turn != null) return cur.turns[+el.dataset.turn]; var w = el && el.closest('[data-abody]'); return w ? cur.turns[+w.dataset.abody] : cur.turns[cur.turns.length - 1]; },
    rerender: function (t) { var cur = brain.cur, i = cur ? cur.turns.indexOf(t) : -1, el = $('[data-abody="' + i + '"]', body); if (el) { el.innerHTML = answerHtml(t, i, i === cur.turns.length - 1); try { window.BrainBlocks.drawCharts(el); window.BrainBlocks.countUp(el, true); } catch (e) { /* ok */ } } },
    focusInput: function () { var ta = $('[data-bask] textarea', body); if (ta) ta.focus(); },
    openTable: function () { location.href = '/brain/' + (brain.cur ? '?c=' + encodeURIComponent(brain.cur.id) : ''); },
    closeTable: function () {}, sheetMade: function () {}, consentShown: function () {}, accessAsked: function () {}
  };
  function brainClick(e, t) {
    var B = window.BrainBlocks;
    if (t.hasAttribute('data-bq')) { brainAsk(t.getAttribute('data-bq')); return; }
    if (t.hasAttribute('data-bnew')) { brain.cur = null; brain.view = 'chat'; D.save({ bc: null }); brainRender(); return; }
    if (t.hasAttribute('data-blist')) { brain.view = 'list'; brainRender(); return; }
    if (t.hasAttribute('data-bback')) { brain.view = 'chat'; brainRender(); return; }
    if (t.hasAttribute('data-bopen')) { brainOpen(t.getAttribute('data-bopen')); return; }
    if (B && t.dataset && t.dataset.act && B.handle(e, t, host)) return;
  }
  function brainOpen(id, quiet) {
    brain.view = 'chat'; brain.busy = null;
    bapi('thread/' + encodeURIComponent(id)).then(function (d) {
      brain.cur = { id: d.thread.id, title: d.thread.title, turns: (d.turns || []).map(fromStored) };
      D.save({ bc: id }); try { localStorage.setItem('favor.brain.last', JSON.stringify({ id: id, at: Date.now() })); } catch (e) { /* not kept */ }
      if (S.tab !== 'brain') return;
      brainRender();
      if (brain.cur.turns.some(function (t) { return t.pending; })) pollPending(brain.cur);
    }).catch(function (e) { if (e.status === 404) { D.save({ bc: null }); brain.cur = null; } if (S.tab === 'brain') { brainRender(); if (!quiet) toast(e.status === 404 ? 'That chat is gone.' : e.message); } });
  }
  function pollPending(c) {
    var mine = (brain.busy = { conv: c, ctl: new AbortController(), status: 'Looking at the records' });
    (function loop(i) {
      if (i > 150) { brain.busy = null; return; }
      setTimeout(function () {
        if (brain.cur !== c || brain.busy !== mine) return;
        bapi('thread/' + encodeURIComponent(c.id)).then(function (d) {
          if (brain.cur !== c || brain.busy !== mine) return;
          var turns = (d.turns || []).map(fromStored);
          if (turns.length && !turns[turns.length - 1].pending) { c.turns = turns; c.title = d.thread.title; brain.busy = null; if (S.tab === 'brain') { brainRender(); } } else loop(i + 1);
        }).catch(function () { loop(i + 1); });
      }, i < 3 ? 1200 : 2500);
    })(0);
  }
  function brainAsk(q, opt) {
    opt = opt || {}; q = String(q || '').trim();
    if (q.length < 2 || brain.busy) return;
    if (!brain.cur) brain.cur = { id: newId(), title: 'New chat', turns: [] };
    var conv = brain.cur, replacing = opt.at != null, turn;
    if (replacing) { turn = conv.turns[opt.at]; turn.blocks = null; turn.error = null; turn.stopped = false; turn.extras = []; }
    else { turn = { q: q, blocks: null, extras: [], reading: [], follow: [] }; conv.turns.push(turn); if (conv.turns.length === 1) conv.title = q.length > 40 ? q.slice(0, 38).trim() + '...' : q; }
    var mine = (brain.busy = { conv: conv, ctl: new AbortController(), status: 'Reading your question' });
    D.save({ bc: conv.id }); try { localStorage.setItem('favor.brain.last', JSON.stringify({ id: conv.id, at: Date.now() })); } catch (e) { /* not kept */ }
    brainRender();
    var t1 = setTimeout(function () { mine.status = 'Looking at the records'; var s = $('#fp-think-st'); if (s && brain.busy === mine) s.textContent = mine.status; }, 1800);
    var t2 = setTimeout(function () { mine.status = 'Putting the answer together'; var s = $('#fp-think-st'); if (s && brain.busy === mine) s.textContent = mine.status; }, 5000);
    var scroll = function () { var h = $('[data-bthread]', body); if (h) { var qs = h.querySelectorAll('.fp-q'), l = qs[qs.length - 1]; if (l) h.scrollTop += l.getBoundingClientRect().top - h.getBoundingClientRect().top - 8; } };
    scroll();
    var req = { question: q, v: 2, conv: conv.id };
    var prev = ''; for (var i = (replacing ? opt.at : conv.turns.length - 1) - 1; i >= 0; i--) { var x = conv.turns[i]; if (x.blocks && x.outcome === 'ok') { prev = x.asked_as || x.q; break; } }
    if (prev) req.previous = prev;
    if (opt.intent) req.intent = opt.intent;
    bapi('ask', { body: req, signal: mine.ctl.signal, keepalive: true }).then(function (d) {
      if (!d.ref) d.ref = '';
      Object.assign(turn, fromReply(turn.q || q, d), { q: turn.q || q });
    }).catch(function (err) { if (err.name === 'AbortError') turn.stopped = true; else { turn.error = err.message; turn.ref = err.ref; } }).then(function () {
      clearTimeout(t1); clearTimeout(t2);
      if (brain.busy === mine) brain.busy = null;
      if (brain.cur === conv && S.tab === 'brain' && brain.view === 'chat' && $('[data-bthread]', body)) { var sb = $('.fp-send', body); brainThread(); if (sb) sb.disabled = true; scroll(); }
      else if (S.tab !== 'brain' || brain.cur !== conv) toast('Your answer is ready in "' + conv.title + '"');
      brain.convs = null;
    });
  }

  var P = window.FavorDockPanel = { show: show, wired: false, last: null };
})();
