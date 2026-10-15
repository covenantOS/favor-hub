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
  var brain = { convs: null, cur: null, busy: null, view: 'chat', loading: null, ready: null, ctx: null }; // ctx: selected text Ask Favor Brain brought (ask-brain.js)
  var bodyHost = null;
  // Translation, voice transcripts and Catch me up (chat-smart.css styles them; every rule is in /api/chat).
  var TR = {}, trOrig = {}, trAsked = {}, trT = 0;
  function langName(code) { var l = (D.langs || []).filter(function (x) { return x.code === code; })[0]; return l ? l.name : code; }
  function trOf(m) { var t = D.lang && TR[m.id]; return t && t.text && t.body === m.body && m.user_id !== D.me ? t : null; }
  function trSeen() {
    clearTimeout(trT);
    trT = setTimeout(function () {
      if (!D.lang) return;
      var list = thread ? [thread.root].concat(thread.replies) : msgs[S.ch] || [], ids = [];
      list.forEach(function (m) {
        if (m.deleted || m.user_id === D.me || m.user_id === 'brain' || m.user_id === 'meetings') return;
        var voice = (m.attachments || []).filter(function (a) { return a.voice && a.transcript_status === 'ready' && a.transcript; }).length;
        if (!m.body && !voice) return;
        var key = D.lang + '|' + m.id + '|' + m.body + '|' + voice;
        if (trAsked[key] || ids.length >= 24) return;
        trAsked[key] = 1; ids.push(m.id);
      });
      if (!ids.length) return;
      D.req('POST', 'translate', { ids: ids }).then(function (d) {
        ids.forEach(function (id) { var it = d.items && d.items[id], m = find(id); if (it && m) TR[id] = { text: it.text || '', src: it.src || '', body: m.body, voice: it.voice || null }; });
        if (S.tab === 'chat' && $('[data-msgs]', body)) { var keep = nearEnd(); if (S.th) drawThread(); else drawMsgs(); if (keep) scrollEnd(); }
      }).catch(function () { /* the original stays */ });
    }, 250);
  }
  function langSelect() {
    return '<select class="fp-lang" data-langsel aria-label="Language I read Chat in" title="Language I read Chat in"><option value="">Original</option>' + (D.langs || []).map(function (l) { return '<option value="' + l.code + '"' + (D.lang === l.code ? ' selected' : '') + '>' + esc(l.native) + '</option>'; }).join('') + '</select>';
  }
  function moreMenu() {
    return '<span class="fp-more-w"><button type="button" class="fp-ext" data-more aria-haspopup="menu" aria-expanded="false" aria-label="More" title="More">' + ic('more') + '</button>' +
      '<div class="fp-menu" data-menu role="menu" hidden><button type="button" role="menuitem" data-catch-go>Catch me up</button><label>Read in<select data-langsel aria-label="Language I read Chat in"><option value="">Original</option>' +
      (D.langs || []).map(function (l) { return '<option value="' + l.code + '"' + (D.lang === l.code ? ' selected' : '') + '>' + esc(l.native) + '</option>'; }).join('') + '</select></label></div></span>';
  }
  function cardLink(href, kick, title, meta, ext) {
    return '<a class="fp-card" href="' + esc(href || '#') + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '><span class="fp-card__k">' + esc(kick) + '</span><span class="fp-card__t">' + esc(title || kick) + '</span>' + (meta ? '<span class="fp-card__m">' + esc(meta) + '</span>' : '') + '</a>';
  }
  /* Every attachment type draws as something readable. The full cards live on the Chat page; the link on each opens there. */
  function cardHtml(x, m) {
    var href = '/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id;
    var t = x.type;
    if (t === 'meeting') {
      var live = x.status !== 'ended';
      var meta = x.private ? (live ? 'Live now' : 'Ended') : live ? 'Live now' + (x.count ? ', ' + x.count + (x.count === 1 ? ' person' : ' people') + ' in the room' : '') : 'Ended' + (x.duration ? ', ' + x.duration : '') + (x.notes ? ', notes ready' : '');
      return cardLink(x.private ? href : live ? x.url : (x.notes_url || x.url), 'Meeting', x.private ? 'Private meeting' : x.title, meta, false);
    }
    if (t === 'task') return cardLink(x.url || href, x.kind === 'mention' ? 'Named on a request' : x.kind === 'made' ? 'Made a request' : 'Request', x.private ? 'Private task' : x.title, [x.status_label, x.owner ? 'Owner ' + x.owner : '', x.due_date ? 'Due ' + x.due_date : ''].filter(Boolean).join(', '), false);
    if (t === 'ptask') return cardLink(x.url || href, x.kick || 'Task', x.private ? 'Private task' : x.title, [x.code, x.status_label, x.owner ? 'Owner ' + x.owner : '', x.due ? 'Due ' + x.due : ''].filter(Boolean).join(', '), false);
    if (t === 'clip') return cardLink(x.url || href, 'Clip', x.title, [x.by, x.when].filter(Boolean).join(', '), true);
    if (t === 'drive') return cardLink(x.url, 'Drive', x.name, x.path, true);
    if (t === 'entity') return cardLink(x.url || href, x.kind || 'Record', x.title || x.name, '', false);
    if (t === 'checklist') return cardLink(href, 'Checklist', x.title || 'Checklist', (x.done || 0) + ' of ' + (x.total || 0) + ' done', false);
    if (t === 'poll') return cardLink(href, 'Poll', x.q, (x.voters || 0) + (x.voters === 1 ? ' person' : ' people') + ' voted' + (x.closed ? ', closed' : ''), false);
    if (t === 'note') return cardLink(href, x.kind === 'list' ? 'Scheduled messages' : 'Note for you', x.text || x.title || (x.kind === 'list' ? 'Messages waiting to post' : 'Only you see this'), '', false);
    if (t === 'link' && x.url) return cardLink(x.url, x.site || 'Link', x.title || x.url, '', true);
    return cardLink(href, String(t || 'Attachment').replace(/^./, function (c) { return c.toUpperCase(); }), x.title || x.name || x.text || 'Attachment', 'Open in Chat to see it all', false);
  }
  function catchUp() {
    var host = $('[data-msgs]', body); if (!host || S.th) return;
    var list = (msgs[S.ch] || []).filter(function (m) { return m.user_id !== D.me && !m.deleted && m.user_id !== 'brain'; }).slice(-30);
    if (list.length < 3) { toast('Nothing to catch up on here.'); return; }
    var box = $('[data-catch]', host);
    if (!box) { box = document.createElement('div'); box.setAttribute('data-catch', ''); box.className = 'sm-catch'; host.insertBefore(box, host.firstChild); }
    box.innerHTML = '<div class="sm-catch__r"><span>Reading the new messages</span></div>';
    D.req('POST', 'channels/' + encodeURIComponent(S.ch) + '/catchup', { from: Number(list[0].id) - 1 }).then(function (d) {
      if (d.empty) { box.remove(); toast('Nothing to catch up on here.'); return; }
      var pts = function (l) { return l.map(function (p) { return '<li>' + esc(p.text) + '</li>'; }).join(''); };
      box.innerHTML = '<div class="sm-catch__c"><div class="sm-catch__h"><b>' + esc(d.headline || 'Caught up') + '</b><button type="button" class="fp-mact" data-catchx aria-label="Close the summary">&times;</button></div><ul>' + pts(d.points) + '</ul>' +
        (d.for_you.length ? '<div class="sm-catch__f"><b>For you</b><ul>' + pts(d.for_you) + '</ul></div>' : '') + '<small>' + d.count + ' messages from ' + d.people + (d.people === 1 ? ' person' : ' people') + '</small></div>';
    }).catch(function (e) { box.remove(); toast(e.message); });
  }

  function ic(n) {
    var p = { back: 'M15 5l-7 7 7 7', more: 'M5 12h.01M12 12h.01M19 12h.01', list: 'M4 6h16M4 12h16M4 18h10', newchat: 'M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z', send: 'M4 12l16-8-6 16-2-7z', lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', plus: 'M12 5v14M5 12h14', thread: 'M5 6h14v9H9l-4 4z', hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16' };
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
    if (window.hubToast) { window.hubToast(msg); return; }
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
    // In the app the Chat tab is drawn by native Chat (window.FavorDockNative); this file keeps the Favor Brain tab.
    if (S.tab === 'brain') brainShow(); else if (window.FavorDockNative) body.innerHTML = ''; else chatShow();
  }
  function wire() {
    body.addEventListener('click', onClick);
    body.addEventListener('submit', onSubmit);
    body.addEventListener('change', function (e) {
      if (!e.target.matches('[data-langsel]')) return;
      var code = e.target.value;
      D.req('POST', 'prefs', { lang: code }).then(function (d) { D.lang = d.lang || ''; TR = {}; trOrig = {}; trAsked = {}; if (S.th) drawThread(); else drawMsgs(); }).catch(function (er) { toast(er.message); });
    });
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
      '<b class="fp-head__t">' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</b>' + ((c.kind === 'dm' || c.kind === 'group') && o !== D.me && window.FavorRing ? '<button type="button" class="fp-ext" data-huddle="' + esc(c.id) + '" title="Huddle: ring ' + esc(chName(c)) + '" aria-label="Huddle: ring ' + esc(chName(c)) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg></button>' : '') + moreMenu() + '<a class="fp-ext" href="/chat/?c=' + encodeURIComponent(c.id) + '" title="Open in Chat" aria-label="Open in Chat">' + ic('ext') + '</a></header>' +
      '<div class="fp-scroll fp-msgs" data-msgs><div class="fp-wait"><i></i><i></i><i></i></div></div><div class="fp-comp" data-comp></div></div>';
    mountBox();
  }
  function bodyHtml(m) {
    if (m.deleted) return '<span class="fp-del">This message was deleted</span>';
    var tr = trOf(m), shown = tr && !trOrig[m.id] ? tr.text : m.body;
    var t = window.FavorMention ? window.FavorMention.render(shown, D.mentions(), D.me) : esc(shown);
    var trLine = tr ? '<div class="ch-tr"><span>' + (trOrig[m.id] ? 'Original, ' : 'Translated from ') + esc(langName(tr.src)) + '</span><button type="button" data-orig="' + m.id + '">' + (trOrig[m.id] ? 'Show translation' : 'Show original') + '</button></div>' : '';
    var a = (m.attachments || []).map(function (x) {
      var href = '/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id;
      if (x.type === 'file' && x.voice) {
        var vt = TR[m.id] && TR[m.id].voice && TR[m.id].voice[x.id];
        var words = x.transcript_status === 'ready' ? (x.transcript ? '<div class="ch-voice__w">' + esc(vt && D.lang && !trOrig[m.id] ? vt.text : x.transcript) + '</div>' : '<div class="ch-voice__s">No speech heard</div>') : x.transcript_status === 'failed' ? '<div class="ch-voice__s">Transcript not available</div>' : '<div class="ch-voice__s">Writing the transcript</div>';
        return '<div class="ch-card ch-voice"><div class="ch-voice__row"><audio controls preload="none" src="' + esc(x.url) + '"></audio></div>' + words + '</div>';
      }
      if (x.type === 'file') return /^image\//.test(x.mime || '') ? '<a class="fp-img" href="' + esc(x.url) + '" target="_blank" rel="noopener"><img alt="' + esc(x.name) + '" src="' + esc(x.url) + '" loading="lazy"></a>' : '<a class="fp-att" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name || 'File') + '</a>';
      return cardHtml(x, m);
    }).join('');
    if (m.brain) a += '<a class="fp-att fp-att--brain" href="/chat/?c=' + encodeURIComponent(m.channel_id) + '&m=' + m.id + (m.thread_id ? '&t=' + m.thread_id : '') + '">Favor Brain answer. Open in Chat</a>';
    return (t ? '<div class="fp-txt">' + t + '</div>' + trLine : '') + a + (m.edited_at ? ' <span class="fp-ed">edited</span>' : '');
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
    trSeen();
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
    trSeen();
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
    if (t.hasAttribute('data-orig')) { var oid = Number(t.getAttribute('data-orig')); trOrig[oid] = !trOrig[oid]; var kp = nearEnd(); if (S.th) drawThread(); else drawMsgs(); if (kp) scrollEnd(); return; }
    if (t.hasAttribute('data-more')) { var mn = $('[data-menu]', body); if (mn) { mn.hidden = !mn.hidden; t.setAttribute('aria-expanded', String(!mn.hidden)); } return; }
    if (t.hasAttribute('data-catch-go')) { var mn2 = $('[data-menu]', body); if (mn2) mn2.hidden = true; catchUp(); return; }
    if (t.hasAttribute('data-catchx')) { var cb = t.closest('[data-catch]'); if (cb) cb.remove(); return; }
    if (t.hasAttribute('data-huddle')) { if (window.FavorRing) window.FavorRing.call({ channel: t.getAttribute('data-huddle') }); return; }
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
    else if (e.target.matches('[data-bask]')) {
      e.preventDefault(); var inp = $('textarea', e.target); var q = inp.value.trim();
      // A question typed about selected text carries the selection with it (ask-brain.js), once.
      if (brain.ctx && window.FavorAskBrain && (q || brain.ctx.text)) { q = window.FavorAskBrain.compose(q, brain.ctx); brain.ctx = null; }
      if (q) { inp.value = ''; inp.style.height = ''; brainAsk(q); }
    }
  }

  /* ================================================================ Favor Brain */
  function bapi(path, opt) {
    opt = opt || {};
    return fetch('/api/brain/' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: opt.body ? { 'Content-Type': 'application/json' } : undefined, body: opt.body ? JSON.stringify(opt.body) : undefined, signal: opt.signal, keepalive: !!opt.keepalive })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) { var err = new Error(d.message || d.error || 'The Brain did not answer (' + res.status + ').'); err.ref = d.ref; err.status = res.status; throw err; } return d; }); });
  }
  function loadBrainCode() {
    if (brain.ready) return brain.ready;
    var code = new Promise(function (ok, bad) {
      // brain-blocks.js draws answers; brain-trace.js the steps; brain-convs.js the chat list; /brain/sprite.js the icons.
      var more = function () { var need = ['/js/brain-trace.js?v=2', '/js/brain-convs.js?v=2', '/brain/sprite.js?v=2'].filter(function (u) { return u.indexOf('trace') >= 0 ? !window.BrainTrace : u.indexOf('convs') >= 0 ? !window.BrainConvs : !document.querySelector('symbol[id^="bci-"]'); }); if (!need.length) return ok(); var n = 0, one = function () { if (++n === need.length) ok(); }; need.forEach(function (u) { var x = document.createElement('script'); x.src = u; x.onload = one; x.onerror = one; document.head.appendChild(x); }); };
      if (window.BrainBlocks) { more(); return; }
      var s = document.createElement('script'); s.src = '/js/brain-blocks.js?v=17'; s.onload = more; s.onerror = function () { brain.ready = null; bad(new Error('Favor Brain did not load.')); }; document.head.appendChild(s);
    });
    // The Brain tab draws once its stylesheet is in, so its answers never show unstyled for a moment.
    var css = new Promise(function (ok) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/dock-brain.css?v=4';
      l.onload = ok; l.onerror = ok; setTimeout(ok, 4000); document.head.appendChild(l);
    });
    brain.ready = Promise.all([code, css]);
    return brain.ready;
  }
  var DAY = 864e5;
  var newId = function () { return 'c_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), function (b) { return b.toString(36).padStart(2, '0'); }).join('').slice(0, 8); };
  function fromReply(q, d) { return { q: q, ref: d.ref, at: new Date().toISOString(), blocks: d.blocks || [], reading: Array.isArray(d.reading) ? d.reading : [], follow: d.follow || [], markdown: d.markdown || d.text || '', steps: d.steps || [], intent: d.intent, outcome: d.outcome, asked_as: d.asked_as || q, extras: [] }; }
  function fromStored(t) {
    var a = t.answer || {};
    if (a.pending) return { q: t.question, at: t.at, blocks: null, pending: true, extras: [], reading: [], follow: [], stored: true };
    if (a.error) return { q: t.question, ref: t.ref, at: t.at, blocks: null, error: a.error, extras: [], reading: [], follow: [], stored: true };
    return { q: t.question, ref: t.ref, at: t.at, blocks: a.blocks || [], reading: Array.isArray(a.reading) ? a.reading : [], follow: a.follow || [], steps: a.steps || [], intent: a.intent, outcome: a.outcome, asked_as: a.asked_as || t.question, extras: [], stored: true };
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
      body.innerHTML = '<div class="fp-conv" data-brain><header class="fp-head"><button type="button" class="fp-back" data-bback aria-label="Back">' + ic('back') + '</button><b class="fp-head__t">Your chats</b><button type="button" class="fp-new fp-new--strong" data-bnew>' + ic('plus') + 'New chat</button></header><div class="fp-cfind"><input type="search" data-bfind placeholder="Search your chats" aria-label="Search your chats" autocomplete="off" value="' + esc(brain.find || '') + '" /></div><div class="fp-scroll bc-root" data-bconvs role="list"><div class="fp-wait"><i></i><i></i><i></i></div></div></div>';
      var fi = $('[data-bfind]', body); if (fi) fi.addEventListener('input', function () { brain.find = fi.value; paintConvs(); });
      if (brain.convs) paintConvs(); loadConvs(); return;
    }
    body.innerHTML = '<div class="fp-conv" data-brain><header class="fp-head fp-head--brain"><button type="button" class="fp-all" data-blist aria-label="All chats" title="All chats">' + ic('list') + '<span>All chats</span></button><b class="fp-head__t">' + esc(cur ? cur.title : 'New chat') + '</b><button type="button" class="fp-back" data-bnew aria-label="New chat" title="New chat"' + (cur && cur.turns.length ? '' : ' disabled') + '>' + ic('newchat') + '</button></header>' +
      '<div class="fp-scroll fp-bthread" data-bthread></div>' +
      '<form class="fp-comp" data-bask>' + (brain.ctx && window.FavorAskBrain ? window.FavorAskBrain.card(brain.ctx) : '') + '<div class="fp-comp__in"><textarea rows="1" maxlength="600" placeholder="' + (brain.ctx ? 'Ask about this' : 'Ask Favor Brain') + '" aria-label="Ask Favor Brain"></textarea><button type="submit" class="fp-send" aria-label="Ask" disabled>' + ic('send') + '</button></div></form></div>';
    var ta = $('textarea', body), sb = $('.fp-send', body);
    if (brain.ctx && brain.ctx.fill) { ta.value = brain.ctx.fill; brain.ctx.fill = ''; sb.disabled = false; setTimeout(function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }, 0); }
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; sb.disabled = !ta.value.trim() || !!brain.busy; });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('[data-bask]', body).requestSubmit(); } });
    brainThread();
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(function () { ta.focus(); }, 60);
  }
  function paintConvs() {
    var host = $('[data-bconvs]', body); if (!host) return;
    var l = brain.convs || [];
    // Drawn by brain-convs.js, the same list as the Brain page's rail.
    if (!window.BrainConvs) { loadBrainCode().then(paintConvs).catch(function () {}); return; }
    host.innerHTML = window.BrainConvs.html(l, { cur: brain.cur && brain.cur.id, working: brain.busy && brain.busy.conv ? brain.busy.conv.id : null, q: brain.find || '', renaming: brain.renaming });
    var rn = $('[data-rename]', host);
    if (rn) {
      rn.focus(); rn.select();
      var done = function (save) { if (brain.renaming !== rn.dataset.rename) return; var c = l.filter(function (x) { return x.id === rn.dataset.rename; })[0]; brain.renaming = null; var v = rn.value.trim().slice(0, 80); if (save && c && v && v !== c.title) { c.title = v; bapi('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { title: v } }).catch(function (e) { toast(e.message); }); } paintConvs(); };
      rn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      rn.addEventListener('blur', function () { done(true); });
    }
  }
  var STARTERS = [['How is Favor doing this year?', 'Raised, goal and the same date last year'], ['How do I enter a check gift?', 'Steps from the Operations Manual'], ['What can you do?', 'Everything you can ask about']];
  function brainThread() {
    var host = $('[data-bthread]', body); if (!host) return;
    var cur = brain.cur;
    if (!cur || !cur.turns.length) {
      var n = (window.FAVOR_HUB && window.FAVOR_HUB.user && window.FAVOR_HUB.user.name || '').split(/\s+/)[0];
      if (brain.ctx && !brain.busy) { host.innerHTML = '<div class="fp-bempty"><span class="fbr" data-state="idle" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span><h3>Ask about what you selected</h3><p class="fp-none">Your question goes to Favor Brain with the selected text.</p></div>'; return; }
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
  // The answer's steps fill in while it is made (brain-trace.js, loaded with brain-blocks.js).
  function thinking() { return '<div class="fp-think fp-think--trace" id="fp-think"><span class="fbr" data-state="thinking" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span>' + '<div class="bc-root">' + (window.BrainTrace ? window.BrainTrace.live(brain.busy && brain.busy.steps) : '') + '</div></div>'; }
  function answerHtml(t, ti, last) {
    var B = window.BrainBlocks, expired = t.stored && Date.now() - new Date(t.at).getTime() >= DAY, h = '';
    if (t.error) h += '<div class="blk-text"><p class="bc-err">' + esc(t.error) + '</p></div>';
    else if (t.stopped) h += '<div class="blk-text"><p>Stopped. Ask again when you are ready.</p></div>';
    else if (!t.blocks || !t.blocks.length) h += B.fallback(t.markdown || 'No answer was kept for this one. Ask again.');
    else h += (t.steps && t.steps.length && window.BrainTrace ? window.BrainTrace.done(t.steps, B.reading(t.reading, ti)) : '') + B.renderAll(t.blocks, { ti: ti, steps: !!(t.steps && t.steps.length), canSheets: false, canRequest: function () { return false; }, expired: expired });
    (t.extras || []).forEach(function (x) { h += B.render(x, { ti: ti, bi: -1, canSheets: false }); });
    if (!(t.steps && t.steps.length && t.blocks && t.blocks.length)) h += B.reading(t.reading, ti);
    if (last && t.follow && t.follow.length && !t.error) h += '<div class="blk-follow" aria-label="Follow-up questions">' + t.follow.map(function (q) { return '<button type="button" class="fu" data-act="ask" data-q="' + esc(q) + '">' + B.ic('arrow') + esc(q) + '</button>'; }).join('') + '</div>';
    // Drag the answer into what you are writing, or send it to an email (ask-brain.js).
    if (!t.error && !t.stopped && window.FavorAskBrain && ((t.blocks && t.blocks.length) || t.markdown)) h += window.FavorAskBrain.footer();
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
    if (t.dataset && t.dataset.act === 'conv' && brain.view === 'list') { brainOpen(t.dataset.id); return; }
    if (t.dataset && t.dataset.act === 'cvact') { convAct(t); return; }
    if (B && t.dataset && t.dataset.act && B.handle(e, t, host)) return;
  }
  // Pin, rename and delete on a chat row (brain-convs.js). Delete asks once, on the row; a row standing for the same question
  // asked several times deletes them all.
  function convAct(el) {
    var l = brain.convs || [], c = l.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!c) return;
    var v = el.dataset.v;
    if (v === 'pin') { c.pinned = c.pinned ? 0 : 1; paintConvs(); toast(c.pinned ? 'Pinned' : 'Unpinned'); bapi('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { pinned: !!c.pinned } }).catch(function (e) { c.pinned = c.pinned ? 0 : 1; paintConvs(); toast(e.message); }); return; }
    if (v === 'rename') { brain.renaming = c.id; paintConvs(); return; }
    if (v === 'del') {
      if (el.getAttribute('data-sure') !== '1') { el.setAttribute('data-sure', '1'); el.classList.add('is-sure'); el.setAttribute('aria-label', 'Press again to delete'); el.title = 'Press again to delete'; setTimeout(function () { el.removeAttribute('data-sure'); el.classList.remove('is-sure'); }, 3000); return; }
      var row = el.closest('.cvr'); if (row) row.classList.add('is-gone');
      var ids = [c.id].concat(c.same || []);
      Promise.all(ids.map(function (id) { return bapi('thread/' + encodeURIComponent(id), { method: 'DELETE' }); })).then(function () {
        brain.convs = l.filter(function (x) { return x !== c; });
        if (brain.cur && ids.indexOf(brain.cur.id) >= 0) { brain.cur = null; D.save({ bc: null }); }
        setTimeout(paintConvs, 200); toast('Chat deleted');
      }).catch(function (e) { toast(e.message); paintConvs(); });
    }
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
    brain.ctx = null; // a starter or a follow-up leaves the selection behind
    var req = { question: q, v: 2, conv: conv.id };
    var prev = ''; for (var i = (replacing ? opt.at : conv.turns.length - 1) - 1; i >= 0; i--) { var x = conv.turns[i]; if (x.blocks && x.outcome === 'ok') { prev = x.asked_as || x.q; break; } }
    if (prev) req.previous = prev;
    if (opt.intent) req.intent = opt.intent;
    (window.BrainTrace ? window.BrainTrace.ask(req, { signal: mine.ctl.signal, onSteps: function (st) { mine.steps = st; if (brain.busy === mine) window.BrainTrace.update($('#fp-think'), st); } }) : bapi('ask', { body: req, signal: mine.ctl.signal, keepalive: true })).then(function (d) {
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
  // Ask Favor Brain from a selection: a new chat with the selection as its context and, for a short selection, its words in the box.
  P.askWith = function (ctx) {
    if (!ctx || !ctx.text) return;
    D.save({ tab: 'brain', bc: null });
    brain.cur = null; brain.view = 'chat';
    brain.ctx = { text: String(ctx.text), source: ctx.source || 'this page', fill: window.FavorAskBrain ? window.FavorAskBrain.suggestion(ctx.text) : '' };
    if (S.tab === 'brain') brainRender(); else { S.tab = 'brain'; show(); }
  };
  P.brainTurn = function (i) { return brain.cur ? brain.cur.turns[i] || null : null; };
})();
