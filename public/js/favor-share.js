/* FavorShare: one "Send to" menu for anything in FavorOS.
   Any entity (colleague, partner, fund, appeal code, task, request, meeting, clip, course) or any page can go to Chat as a card (a direct
   message or a channel, with a note), become a Projects task, be linked in a comment on a request, be asked about in Favor Brain, or have its link copied.
     FavorShare.menu(anchor, ref)      open the menu. ref = { kind, id, title, url?, sub?, lookup? }. kind 'page' is a page of FavorOS: { kind: 'page', id: '/path', title }.
     FavorShare.page(anchor?)          the menu for the page the person is on
     FavorShare.dm(email)              open a direct message with a colleague (creates it when it is new) and go to it
   The Chat card is made on the server from the same entity route the hover card uses (functions/_lib/chat/route.ts, attachment type entity or page),
   so the sender needs access to what they send and each reader's card still applies the reader's own access. Loaded by favor-entity.js on first use. */
(function () {
  'use strict';
  if (window.FavorShare) return;
  var UI = window.FavorUI, E = window.FavorEntity;
  var esc = UI.esc;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var root = document.documentElement;
  var phone = function () { return !matchMedia('(hover: hover)').matches || matchMedia('(max-width: 860px)').matches; };
  var el = null, scrim = null, tok = null, boot = null, openedAt = 0;

  function close() {
    if (el) { el.remove(); el = null; }
    if (scrim) { scrim.remove(); scrim = null; }
    if (tok && window.hubOv) { var t = tok; tok = null; window.hubOv.off(t); }
  }
  function shell(anchor, html) {
    close();
    var sheet = phone();
    openedAt = performance.now();
    el = document.createElement('div');
    el.className = 'fe-card fe-menu' + (sheet ? ' fe-sheet' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Send to');
    el.innerHTML = html;
    if (sheet) {
      scrim = document.createElement('div'); scrim.className = 'fe-scrim'; scrim.addEventListener('click', close); document.body.appendChild(scrim);
      if (window.hubOv) tok = window.hubOv.on(function () { tok = null; close(); });
    }
    document.body.appendChild(el);
    if (!sheet && (!anchor || anchor === document.body)) { el.classList.add('fe-menu--mid'); }
    else if (!sheet && anchor.getBoundingClientRect) {
      var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left)) + 'px';
      el.style.top = Math.max(10, Math.min(innerHeight - h - 10, r.bottom + 8)) + 'px';
    }
    return el;
  }
  var abs = function (ref) { return ref.url ? (/^https?:/.test(ref.url) ? ref.url : location.origin + ref.url) : ''; };
  var title = function (ref) { return ref.title || E.label[ref.kind] || 'This'; };

  function head(ref, back) {
    return '<div class="fe-card__head"><div class="fe-card__who">' + (back ? '<button type="button" class="fe-back" data-s="back" aria-label="Back">' + E.ic('x').replace('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', '<path d="m15 6-6 6 6 6"/>') + '</button>' : '') + '<b>Send ' + esc(title(ref)) + '</b><span>' + esc(E.label[ref.kind] || 'Link') + '</span></div>' +
      '<button type="button" class="fe-x" data-s="close" aria-label="Close">' + E.ic('x') + '</button></div>';
  }
  function menu(anchor, ref) {
    var rows = [];
    if (root.classList.contains('has-chat')) rows.push(['chat', 'message', 'Chat', 'A direct message or a channel, with a note']);
    if (root.classList.contains('has-projects')) rows.push(['task', 'task', 'A Projects task', 'Starts a task you can assign']);
    if (root.classList.contains('has-mail') && window.FavorCompose) rows.push(['email', 'send', 'Email', 'Adds it to the email you are writing, or starts one']);
    if (ref.kind !== 'person') rows.push(['request', 'request', 'A request', 'Links it in a comment on a request']);
    rows.push(['brain', 'brain', 'Ask Favor Brain', 'Opens a new chat about it']);
    if (abs(ref)) rows.push(['copy', 'copy', 'Copy the link', abs(ref).replace(/^https?:\/\//, '')]);
    var m = shell(anchor, head(ref) + '<div class="fe-rows">' + rows.map(function (r) {
      return '<button type="button" class="fe-row" data-s="' + r[0] + '"><span class="fe-row__i">' + E.ic(r[1]) + '</span><span><b>' + esc(r[2]) + '</b><small>' + esc(r[3]) + '</small></span></button>';
    }).join('') + '</div>');
    m.__ref = ref; m.__anchor = anchor;
  }

  /* ------------------------------------------------------------------ Chat */
  function loadBoot() {
    if (boot) return boot;
    boot = UI.api('GET', '/api/chat/boot').then(function (d) {
      var users = d.users || {}, me = (d.me && d.me.id) || '';
      var people = Object.keys(users).filter(function (id) { return id !== me && id !== 'brain' && id !== 'meetings' && users[id].name; }).map(function (id) { return { kind: 'dm', id: id, name: users[id].name, sub: users[id].title || '' }; });
      var channels = (d.channels || []).filter(function (c) { return c.kind === 'public' || c.kind === 'private'; }).map(function (c) { return { kind: 'channel', id: c.id, name: (c.kind === 'public' ? '# ' : '') + c.name, sub: c.kind === 'private' ? 'Private channel' : 'Channel' }; });
      return channels.concat(people);
    });
    boot.catch(function () { boot = null; });
    return boot;
  }
  function chatPick(m, ref) {
    m.innerHTML = head(ref, true) + '<div class="fe-pick"><input class="fe-in" data-s-q placeholder="A colleague or a channel" aria-label="Who to send it to" autocomplete="off" /><div class="fe-list" data-s-list><div class="fe-wait"><i></i><i></i><i></i></div></div></div>';
    var list = $('[data-s-list]', m), q = $('[data-s-q]', m), all = [];
    var draw = function () {
      var t = q.value.trim().toLowerCase();
      var hit = all.filter(function (x) { return !t || x.name.toLowerCase().indexOf(t) >= 0; }).slice(0, 8);
      list.innerHTML = hit.length ? hit.map(function (x, i) { return '<button type="button" class="fe-row" data-s-to="' + all.indexOf(x) + '"><span class="fe-row__i">' + E.ic(x.kind === 'dm' ? 'person' : 'message') + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(x.sub) + '</small></span></button>'; }).join('') : UI.empty('No match');
    };
    loadBoot().then(function (a) { all = a; draw(); q.focus(); }, function (e) { list.innerHTML = UI.empty(e.message || 'Chat did not load'); });
    q.addEventListener('input', draw);
    m.__all = function (i) { return all[i]; };
  }
  function chatNote(m, ref, to) {
    m.innerHTML = head(ref, true) + '<div class="fe-pick"><p class="fe-to">To <b>' + esc(to.name) + '</b></p><div class="fe-pv">' + E.cardHtml(ref.kind === 'page' ? { kind: 'page', id: ref.id, title: title(ref), sub: '', url: '' } : { kind: ref.kind, id: ref.id, title: title(ref), sub: ref.sub || '', url: '' }) + '</div>' +
      '<textarea class="fe-in fe-note" data-s-note rows="2" maxlength="600" placeholder="Add a note (optional)" aria-label="Note"></textarea><p class="fe-err" data-s-err hidden></p>' +
      '<div class="fe-acts"><button type="button" class="fe-btn fe-btn--main" data-s="go">' + E.ic('send') + 'Send</button></div></div>';
    $('[data-s-note]', m).focus();
    m.__to = to;
  }
  function dmTo(email) {
    return UI.api('POST', '/api/chat/conversations', { members: [email] }).then(function (d) { return d.channel.id; });
  }
  function dm(email) {
    dmTo(email).then(function (id) { location.href = '/chat/?c=' + encodeURIComponent(id); }, function (e) { UI.toast(e.message); });
  }
  function sendChat(m) {
    var ref = m.__ref, to = m.__to, note = $('[data-s-note]', m).value.trim(), err = $('[data-s-err]', m), btn = $('[data-s="go"]', m);
    btn.disabled = true;
    var att = ref.kind === 'page' ? { type: 'page', url: ref.id, title: title(ref) } : { type: 'entity', kind: ref.kind, id: ref.id };
    (to.kind === 'dm' ? dmTo(to.id) : Promise.resolve(to.id))
      .then(function (ch) { return UI.api('POST', '/api/chat/channels/' + encodeURIComponent(ch) + '/messages', { body: note, attachments: [att] }).then(function () { return ch; }); })
      .then(function (ch) { close(); UI.toast('Sent to ' + to.name + '.', '/chat/?c=' + encodeURIComponent(ch), 'Open'); },
        function (e) { btn.disabled = false; err.textContent = e.message; err.hidden = false; });
  }

  /* ------------------------------------------------------------------ a request */
  function requestPick(m, ref) {
    m.innerHTML = head(ref, true) + '<div class="fe-pick"><input class="fe-in" data-s-q placeholder="Find a request by title or person" aria-label="Find a request" autocomplete="off" /><div class="fe-list" data-s-list>' + UI.empty('Type two letters') + '</div><p class="fe-err" data-s-err hidden></p></div>';
    var list = $('[data-s-list]', m), q = $('[data-s-q]', m), t = 0, seq = 0, rows = [];
    q.focus();
    q.addEventListener('input', function () {
      clearTimeout(t);
      var text = q.value.trim(), mine = ++seq;
      if (text.length < 2) { list.innerHTML = UI.empty('Type two letters'); return; }
      t = setTimeout(function () {
        UI.api('GET', '/api/requests/search?q=' + encodeURIComponent(text)).then(function (d) {
          if (mine !== seq) return;
          rows = d.results || [];
          list.innerHTML = rows.length ? rows.map(function (r, i) { return '<button type="button" class="fe-row" data-s-req="' + i + '"><span class="fe-row__i">' + E.ic('request') + '</span><span><b>' + esc(r.title) + '</b><small>' + esc(r.status + (r.owner ? ' · ' + r.owner : '')) + '</small></span></button>'; }).join('') : UI.empty('No request matches');
        }, function (e) { list.innerHTML = UI.empty(e.message); });
      }, 220);
    });
    m.__req = function (i) { return rows[i]; };
  }
  function linkInRequest(m, ref, r) {
    var line = title(ref) + (abs(ref) ? ': ' + abs(ref) : '');
    UI.api('POST', '/api/requests/' + encodeURIComponent(r.id) + '/comments', { body: line })
      .then(function () { close(); UI.toast('Linked in ' + r.title + '.', r.url, 'Open'); }, function (e) { var x = $('[data-s-err]', m); x.textContent = e.message; x.hidden = false; });
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener('click', function (e) {
    if (!el || e.timeStamp < openedAt) return;
    var t = e.target.closest && e.target.closest('[data-s], [data-s-to], [data-s-req]');
    if (!t || !el.contains(t)) { if (!el.contains(e.target) && !(el.__anchor && el.__anchor.contains && el.__anchor.contains(e.target))) close(); return; }
    var ref = el.__ref, step = t.getAttribute('data-s');
    if (t.hasAttribute('data-s-to')) { chatNote(el, ref, el.__all(Number(t.getAttribute('data-s-to')))); return; }
    if (t.hasAttribute('data-s-req')) { linkInRequest(el, ref, el.__req(Number(t.getAttribute('data-s-req')))); return; }
    if (step === 'close') { close(); return; }
    if (step === 'back') { var a = el.__anchor; var r2 = ref; menu(a, r2); return; }
    if (step === 'chat') { chatPick(el, ref); return; }
    if (step === 'go') { sendChat(el); return; }
    if (step === 'request') { requestPick(el, ref); return; }
    if (step === 'task') {
      close();
      if (window.PJLinks) window.PJLinks.makeTask({ title: ref.kind === 'page' ? 'Follow up: ' + title(ref) : title(ref) });
      return;
    }
    if (step === 'email') { close(); window.FavorCompose.add({ kind: ref.kind === 'clip' || ref.kind === 'task' || ref.kind === 'meeting' ? ref.kind : 'link', title: title(ref), url: abs(ref), sub: ref.sub || '' }); return; }
    if (step === 'brain') { close(); location.href = '/brain/?ask=' + encodeURIComponent(E.askText({ kind: ref.kind, id: ref.id, title: title(ref), lookup: ref.lookup })); return; }
    if (step === 'copy') {
      var link = abs(ref);
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { close(); UI.toast('Link copied.'); }, function () { close(); UI.toast(link); });
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el) { e.stopPropagation(); close(); } }, true);
  document.addEventListener('hub-swapped', close);

  function page(anchor) {
    var path = location.pathname + location.search;
    menu(anchor || document.body, { kind: 'page', id: path, title: document.title.replace(/\s+-\s+FavorOS$/, '') || 'This page', url: path });
  }
  window.FavorShare = { menu: menu, page: page, dm: dm, close: close };
})();
