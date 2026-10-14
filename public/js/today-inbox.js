/* Today's Inbox and Waiting on cards (cross-app). Draws into the two slots the Today page holds for them:
     <section data-today-slot="inbox">   mentions, tasks given to you, request notices, hand-offs, approvals, mail that needs you
     <section data-today-slot="waiting"> what you wait on from others (with Nudge) and questions others wait on you to answer
   Each card paints from this tab's last copy at once, then from /api/today/* (this hub's tables first, Gmail when it lands).
   A card holds its last height until its rows arrive, so nothing below it moves. Works on the classic Today and inside the app
   (window.FavorTodayInbox.mount(root) after the app draws the slots). Self-contained: needs no other FavorOS script. */
(function () {
  'use strict';
  if (window.FavorTodayInbox) { window.FavorTodayInbox.mount(document); return; }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ET = 'America/New_York';
  var SHOW = 6;
  var KEY = { inbox: 'favor.today.inbox.v1', waiting: 'favor.today.waiting.v1' };
  var HKEY = 'favor.today.slot.h.v1';
  var ICONS = {
    chat: '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/>',
    request: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    meeting: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    handoff: '<path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 5v14"/>',
    expense: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  var svg = function (n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || ICONS.chat) + '</svg>'; };
  var KIND = {
    mention: ['chat', 'sky'], dm: ['chat', 'sky'], reply: ['chat', 'sky'], task: ['task', 'leaf'], request: ['request', 'sun'], review: ['request', 'sun'],
    meeting: ['meeting', 'teal'], handoff: ['handoff', 'dusk'], pickup: ['handoff', 'dusk'], expense: ['expense', 'terra'], mail: ['mail', 'sky'], flag: ['flag', 'sun'],
  };
  var TABS = {
    inbox: [['all', 'All'], ['chat', 'Chat'], ['work', 'Tasks'], ['mail', 'Mail'], ['handoff', 'Hand-offs'], ['approve', 'Approvals']],
  };
  var tabOf = function (it) {
    if (it.app === 'Chat' || it.app === 'Meetings') return 'chat';
    if (it.app === 'Projects' || it.app === 'Requests' && it.kind !== 'review') return 'work';
    if (it.app === 'Mail') return 'mail';
    if (it.app === 'Hand-off') return 'handoff';
    return 'approve';
  };

  function api(method, path, body) {
    return fetch(path, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } : { 'X-Hub-Request': '1' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = r.status; throw e; } return d; }); });
  }
  function read(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } }
  function heights() { try { return JSON.parse(localStorage.getItem(HKEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveHeight(name, h) { var all = heights(); all[name + (innerWidth < 861 ? ':p' : ':d')] = Math.round(h); try { localStorage.setItem(HKEY, JSON.stringify(all)); } catch (e) { /* full */ } }
  function lastHeight(name) { return heights()[name + (innerWidth < 861 ? ':p' : ':d')]; }

  function when(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h';
    var d = Math.round(h / 24);
    if (d < 7) return d + 'd';
    return new Date(t).toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
  }
  function toast(text, undo) {
    var t = document.querySelector('.fx-toast');
    if (!t) { t = document.createElement('div'); t.className = 'rt-toast fx-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = esc(text) + (undo ? ' <button type="button" class="fx-btn" style="margin-left:10px;min-height:28px;background:transparent;color:#fff;border-color:rgba(255,255,255,.4)" data-fx-undo>Undo</button>' : '');
    t.style.pointerEvents = undo ? 'auto' : 'none';
    t.classList.add('is-on');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.classList.remove('is-on'); t.style.pointerEvents = 'none'; }, undo ? 6000 : 3200);
    var b = t.querySelector('[data-fx-undo]');
    if (b && undo) b.onclick = function () { t.classList.remove('is-on'); undo(); };
  }

  /* ================================================================ one card */
  function Card(slot, name) {
    this.slot = slot; this.name = name; this.fast = null; this.mail = null; this.mailOn = true; this.tab = 'all'; this.open = false; this.err = '';
    var hit = read(KEY[name]);
    if (hit) { this.fast = hit.fast; this.mail = hit.mail; this.mailOn = hit.mailOn !== false; }
    slot.classList.add('fx-card');
    if (!slot.classList.contains('h-card')) slot.classList.add('h-card');
    slot.hidden = false;
    slot.setAttribute('aria-label', name === 'inbox' ? 'Inbox' : 'Waiting on');
    if (!slot.hasAttribute('data-keep-h')) slot.setAttribute('data-keep-h', 'fx-' + name);
    var h = lastHeight(name);
    if (!this.fast && !window.hubMotion && h) slot.style.minHeight = h + 'px';
    this.paint();
  }
  Card.prototype.items = function () {
    var list = (this.fast || []).concat(this.mail || []);
    var seen = {};
    list = list.filter(function (i) { if (seen[i.id]) return false; seen[i.id] = 1; return true; });
    if (this.name === 'inbox') list.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    else list.sort(function (a, b) { return a.dir !== b.dir ? (a.dir === 'in' ? -1 : 1) : a.since < b.since ? -1 : a.since > b.since ? 1 : 0; });
    return list;
  };
  Card.prototype.save = function () { write(KEY[this.name], { fast: this.fast, mail: this.mail, mailOn: this.mailOn }); };
  Card.prototype.paint = function () {
    var s = this.slot, name = this.name;
    var ready = this.fast !== null;
    var all = ready ? this.items() : [];
    var head = '<div class="fx-head"><h2>' + (name === 'inbox' ? 'Inbox' : 'Waiting on') + (ready && all.length ? ' <span class="fx-n">' + all.length + '</span>' : '') + '</h2>';
    if (name === 'inbox' && ready && all.length > 3) {
      var have = {}; all.forEach(function (i) { have[tabOf(i)] = 1; });
      var tabs = TABS.inbox.filter(function (t) { return t[0] === 'all' || have[t[0]]; });
      if (tabs.length > 2) head += '<div class="fx-tabs" role="tablist" aria-label="Show">' + tabs.map(function (t) { return '<button type="button" role="tab" class="fx-tab' + (this.tab === t[0] ? ' is-on' : '') + '" aria-selected="' + (this.tab === t[0]) + '" data-fx-tab="' + t[0] + '">' + esc(t[1]) + '</button>'; }, this).join('') + '</div>';
    }
    head += '</div>';
    if (!ready) {
      var n = Math.max(2, Math.min(5, Math.round(((lastHeight(name) || 240) - 56) / 58)));
      s.setAttribute('aria-busy', 'true');
      s.innerHTML = head + '<div class="fx-list" aria-hidden="true">' + new Array(n + 1).join('<div class="fx-skel"><i></i><i></i></div>') + '</div>';
      return;
    }
    s.removeAttribute('aria-busy');
    var shown = name === 'inbox' && this.tab !== 'all' ? all.filter(function (i) { return tabOf(i) === this.tab; }, this) : all;
    var body;
    if (!all.length) {
      body = '<div class="fx-empty">' + svg('check') + '<span>' + (name === 'inbox' ? 'Nothing new. Mentions, tasks given to you, flagged mail and approvals land here.' : 'Nothing is waiting. Emails, questions and tasks that go unanswered show up here.') + '</span></div>';
    } else if (name === 'inbox') {
      var cut = this.open ? shown : shown.slice(0, SHOW);
      body = '<ul class="fx-list">' + cut.map(inboxRow).join('') + '</ul>' + (shown.length > cut.length ? '<button type="button" class="fx-more" data-fx-more>Show ' + (shown.length - cut.length) + ' more</button>' : '');
    } else {
      var ins = shown.filter(function (i) { return i.dir === 'in'; }), outs = shown.filter(function (i) { return i.dir !== 'in'; });
      var cap = this.open ? 999 : SHOW, used = 0;
      var part = function (list, label) {
        if (!list.length) return '';
        var take = list.slice(0, Math.max(0, cap - used)); used += take.length;
        return take.length ? '<li class="fx-group" role="presentation">' + esc(label) + '</li>' + take.map(waitRow).join('') : '';
      };
      var html = part(ins, 'Waiting on you') + part(outs, 'You are waiting on');
      body = '<ul class="fx-list">' + html + '</ul>' + (shown.length > used ? '<button type="button" class="fx-more" data-fx-more>Show ' + (shown.length - used) + ' more</button>' : '');
    }
    var wasSkel = !!s.querySelector('.fx-skel');
    s.innerHTML = head + body;
    if (wasSkel) s.classList.add('fx-in');
    var self = this;
    requestAnimationFrame(function () { s.style.minHeight = ''; if (self.fast !== null && self.mail !== null) saveHeight(name, s.getBoundingClientRect().height); });
  };

  function inboxRow(it) {
    var k = KIND[it.kind] || ['chat', 'slate'];
    // The row opens the item. One button clears it at its source; a decision (an expense, a new request) has its own button instead.
    var acts = '';
    if (it.clear) acts += '<button type="button" class="fx-btn fx-btn--clear' + (it.kind === 'handoff' ? ' fx-btn--primary' : '') + '" data-fx-clear="' + esc(it.id) + '" aria-label="' + esc(it.clear + ': ' + it.title) + '" title="' + esc(it.clear) + '">' + svg('check') + '<span>' + esc(it.clear) + '</span></button>';
    else acts += '<a class="fx-btn" href="' + esc(it.href) + '">' + esc(it.open || 'Open') + '</a>';
    var open = it.kind === 'handoff' ? '<button type="button" class="fx-row__open" style="border:0;background:none;padding:0" data-fx-handoff="' + esc(it.id.slice(3)) + '" aria-label="' + esc(it.title) + '"></button>' : '<a class="fx-row__open" href="' + esc(it.href) + '" aria-label="' + esc(it.title) + '"></a>';
    return '<li class="fx-row" data-fx-id="' + esc(it.id) + '">' + open + '<span class="fx-ico" data-c="' + k[1] + '">' + svg(k[0]) + '</span><span class="fx-t"><b>' + esc(it.title) + '</b><span><em>' + esc(it.app) + '</em>' + (it.text ? ' · ' + esc(it.text) : '') + '</span></span><span class="fx-when">' + esc(when(it.at)) + '</span><span class="fx-acts">' + acts + '</span></li>';
  }
  function initials(n) { return String(n || '?').replace(/\(.*\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  var COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal'];
  var hash = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  function waitRow(it) {
    var sub = esc(it.app) + ' · ' + (it.days >= 1 ? it.days + (it.days === 1 ? ' day' : ' days') : when(it.since)) + (it.text ? ' · ' + esc(it.text) : '');
    var acts = '';
    if (it.nudge) acts += it.nudged ? '<span class="fx-chip" title="Nudged ' + esc(new Date(it.nudged).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '">Nudged</span>' : '<button type="button" class="fx-btn" data-fx-nudge="' + esc(it.id) + '" title="' + esc(it.nudge.label) + '">Nudge</button>';
    else if (it.dir === 'in') acts += '<a class="fx-btn" href="' + esc(it.href) + '">Reply</a>';
    acts += '<button type="button" class="fx-x" data-fx-stop="' + esc(it.id) + '" aria-label="' + (it.dir === 'in' ? 'Take it off the list' : 'Stop waiting on this') + '" title="' + (it.dir === 'in' ? 'Take it off the list' : 'Stop waiting') + '">' + svg('x') + '</button>';
    return '<li class="fx-row" data-fx-id="' + esc(it.id) + '"><a class="fx-row__open" href="' + esc(it.href) + '" aria-label="' + esc(it.title) + '"></a><span class="fx-ico" data-c="' + COLORS[hash(it.who.email || it.who.name || '') % 6] + '">' + esc(initials(it.who.name)) + '</span><span class="fx-t"><b>' + esc(it.title) + '</b><span>' + sub + '</span></span><span class="fx-acts">' + acts + '</span></li>';
  }

  Card.prototype.load = function () {
    var self = this, path = this.name === 'inbox' ? '/api/today/inbox' : '/api/today/waiting';
    var fast = api('GET', path + '?part=fast').then(function (d) { self.fast = d.items || []; self.save(); self.paint(); }).catch(function (e) {
      if (e.status === 403 || e.status === 401) { self.slot.hidden = true; self.slot.style.minHeight = ''; return; }
      if (self.fast === null) { self.fast = []; self.paint(); }
    });
    var mail = api('GET', path + '?part=mail').then(function (d) {
      if (d.slow && self.mail) return;
      self.mailOn = d.connected !== false; self.mail = d.items || []; self.save(); if (self.fast !== null) self.paint();
    }).catch(function () { if (self.mail === null) self.mail = []; });
    return Promise.all([fast, mail]);
  };
  Card.prototype.drop = function (id) {
    var match = function (i) { return i.id !== id; };
    var gone = (this.fast || []).concat(this.mail || []).filter(function (i) { return i.id === id; })[0];
    if (this.fast) this.fast = this.fast.filter(match);
    if (this.mail) this.mail = this.mail.filter(match);
    this.save();
    return gone;
  };
  Card.prototype.put = function (it) {
    if (!it) return;
    if (it.app === 'Mail') this.mail = (this.mail || []).concat([it]); else this.fast = (this.fast || []).concat([it]);
    this.save(); this.paint();
  };

  /* ================================================================ actions */
  var cards = {};
  function rowGone(id, then) {
    var row = document.querySelector('[data-fx-id="' + CSS_ESC(id) + '"]');
    if (row) { row.classList.add('is-gone'); setTimeout(then, 180); } else then();
  }
  var CSS_ESC = window.CSS && window.CSS.escape ? function (x) { return window.CSS.escape(x); } : function (s) { return String(s).replace(/["\\]/g, '\\$&'); };

  function clear(id, btn) {
    var c = cards.inbox; if (!c) return;
    if (btn) btn.disabled = true;
    api('POST', '/api/today/inbox/clear', { id: id }).then(function () {
      rowGone(id, function () {
        var it = c.drop(id); c.paint();
        var canUndo = /^(chat|tn|mm|hp|mail|star):/.test(id);
        toast(/^ho:/.test(id) ? 'Picked up. ' + (it && it.who ? it.who.split(' ')[0] + ' will see that.' : '') : 'Cleared.', canUndo ? function () {
          api('POST', '/api/today/inbox/clear', { id: id, undo: true }).then(function () { c.put(it); }).catch(function (e) { toast(e.message); });
        } : null);
      });
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message); });
  }
  function stop(id) {
    var c = cards.waiting; if (!c) return;
    api('POST', '/api/today/waiting/stop', { id: id }).then(function () {
      rowGone(id, function () {
        var it = c.drop(id); c.paint();
        toast('Off the list.', function () { api('POST', '/api/today/waiting/stop', { id: id, undo: true }).then(function () { c.put(it); }).catch(function (e) { toast(e.message); }); });
      });
    }).catch(function (e) { toast(e.message); });
  }

  /* The nudge sheet: who, how, and the words (changeable) before it goes. */
  function nudgeSheet(id) {
    var c = cards.waiting; if (!c) return;
    var it = c.items().filter(function (i) { return i.id === id; })[0]; if (!it || !it.nudge) return;
    var first = String(it.who.name || '').split(' ')[0];
    // <@email> shows as @Name while editing and goes back to the token when sent, so the person is still named in Chat and tasks.
    var shownDraft = String(it.draft || '').replace(/<@([^>|]+)(\|[^>]*)?>/g, function (_, e) { return e.toLowerCase() === String(it.who.email).toLowerCase() ? '@' + it.who.name : '@' + e.split('@')[0]; });
    var how = { mail: 'A reply on the email thread', chat: 'A message in the same Chat conversation', email: 'An email from FavorOS', task: 'A comment on the task that names them', request: 'A comment on the request that names them' }[it.nudge.channel] || '';
    var scrim = document.createElement('div'); scrim.className = 'rt-scrim';
    var el = document.createElement('div'); el.className = 'rt-sheet fx-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Nudge ' + first);
    el.innerHTML = '<div class="rt-sheet__head"><h2>Nudge ' + esc(first || 'them') + '</h2><button type="button" class="rt-x" data-x aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.x + '</svg></button></div>' +
      '<div class="fx-item"><span><b>' + esc(it.title) + '</b><small>' + esc(how) + '</small></span></div>' +
      '<label class="rt-label" for="fx-nudge">Message</label><textarea id="fx-nudge" class="rt-note" rows="5" maxlength="2000"></textarea><p class="fx-err" hidden></p>' +
      '<div class="rt-sheet__foot"><button type="button" class="rt-btn" data-x>Cancel</button><button type="button" class="rt-btn rt-btn--primary" data-send>Send nudge</button></div>';
    document.body.append(scrim, el);
    var ta = el.querySelector('textarea'); ta.value = shownDraft; setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
    var close = function () { scrim.remove(); el.remove(); document.removeEventListener('keydown', key, true); };
    var key = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    scrim.onclick = close;
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) { close(); return; }
      var b = e.target.closest('[data-send]'); if (!b) return;
      var text = ta.value.trim(); if (!text) return;
      if (it.nudge.channel === 'chat' || it.nudge.channel === 'task' || it.nudge.channel === 'request') text = text.split('@' + it.who.name).join('<@' + it.who.email + '>');
      b.disabled = true;
      api('POST', '/api/today/waiting/nudge', { id: id, text: text }).then(function (d) {
        close();
        it.nudged = d.at; c.save(); c.paint();
        toast('Nudged ' + first + (d.channel === 'email' ? ' by email.' : d.channel === 'mail' ? ' on the email.' : d.channel === 'chat' ? ' in Chat.' : ' on the ' + d.channel + '.'));
      }).catch(function (e2) { b.disabled = false; var p = el.querySelector('.fx-err'); p.textContent = e2.message; p.hidden = false; });
    });
  }

  function onClick(e) {
    var t = e.target;
    var tab = t.closest('[data-fx-tab]'); if (tab) { var ci = cards.inbox; ci.tab = tab.getAttribute('data-fx-tab'); ci.open = false; ci.paint(); return; }
    var more = t.closest('[data-fx-more]'); if (more) { var cm = more.closest('[data-today-slot]'); var c = cm && cards[cm.getAttribute('data-today-slot')]; if (c) { c.open = true; c.paint(); } return; }
    var cl = t.closest('[data-fx-clear]'); if (cl) { e.preventDefault(); clear(cl.getAttribute('data-fx-clear'), cl); return; }
    var st = t.closest('[data-fx-stop]'); if (st) { e.preventDefault(); stop(st.getAttribute('data-fx-stop')); return; }
    var nd = t.closest('[data-fx-nudge]'); if (nd) { e.preventDefault(); nudgeSheet(nd.getAttribute('data-fx-nudge')); return; }
    var ho = t.closest('[data-fx-handoff]'); if (ho) { e.preventDefault(); openHandoff(ho.getAttribute('data-fx-handoff')); }
  }
  function openHandoff(id) {
    var go = function () { if (window.FavorHandoff) window.FavorHandoff.show(id, function () { if (cards.inbox) { cards.inbox.drop('ho:' + id); cards.inbox.paint(); } }); };
    if (window.FavorHandoff) go();
    else { var s = document.createElement('script'); s.src = '/js/handoff.js?v=1'; s.onload = go; document.head.appendChild(s); }
  }


  /* ================================================================ new gifts (the gifts slot) */
  // A gift that landed in the last three days for one of this person's partners: the thank-you it needs and the partner's history.
  // Receipts are the printed receipts Support sends everyone; they never show here.
  var money = function (n) { var v = Number(n) || 0; return '$' + (Math.round(v) === v ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
  var day = function (iso) { if (!iso) return ''; var plain = /^\d{4}-\d{2}-\d{2}$/.test(iso); var d = new Date(plain ? iso + 'T12:00:00Z' : iso); return d.toLocaleDateString('en-US', { timeZone: plain ? 'UTC' : ET, month: 'short', day: 'numeric' }); };
  var LETTER = { none: 'Handwritten letter not started', printed: 'Handwritten letter printed', signed: 'Handwritten letter signed', mailed: 'Handwritten letter mailed', cannot: 'Handwritten letter cannot go out' };
  function dueWords(g) {
    var t = Date.parse(g.thank.due); if (!t) return 'Thank-you owed';
    var mins = Math.round((t - Date.now()) / 60000);
    if (mins < 0) return 'Thank-you overdue by ' + (mins > -120 ? -mins + ' min' : Math.round(-mins / 60) + 'h');
    return 'Thank-you due in ' + (mins < 120 ? mins + ' min' : Math.round(mins / 60) + 'h');
  }
  function giftRow(g, i) {
    var th = g.thank, act = '', state;
    if (th.state === 'done') state = '<span class="fx-chip">Thanked' + (th.by ? ' by ' + esc(th.by.split(' ')[0]) : '') + (th.on ? ', ' + esc(day(th.on)) : '') + '</span>';
    else if (th.state === 'task') { state = '<span class="fx-chip fx-chip--due">Thank-you task open</span>'; act = '<a class="fx-btn" href="/work/?tab=open&amp;action=' + encodeURIComponent(g.taskIds[0]) + '">Open task</a>'; }
    else {
      state = '<span class="fx-chip ' + (th.late ? 'fx-chip--late' : 'fx-chip--due') + '">' + esc(th.state === 'left' ? 'Left a message ' + day(th.on) : dueWords(g)) + '</span>';
      act = '<button type="button" class="fx-btn fx-btn--primary" data-fx-thank="' + i + '">Thank</button>';
    }
    var letter = g.letter ? '<span class="fx-chip fx-chip--plain">' + esc(LETTER[g.letter.state] || LETTER.none) + '</span>' : '';
    var hist = [g.history.count > 1 ? 'Lifetime ' + money(g.history.lifetime) + ' over ' + g.history.count + ' gifts' : 'First gift', g.history.lastContact ? 'last contact ' + day(g.history.lastContact) : 'no contact on record'].join(' · ');
    var badges = (g.badges || []).slice(0, 2).map(function (b) { return '<em class="fx-badge">' + esc(b) + '</em>'; }).join(' ');
    return '<li class="fx-row fx-gift" data-fx-id="gift:' + esc(g.giftId) + '"><a class="fx-row__open" href="/work/partner/' + encodeURIComponent(g.cid) + '" data-partner-id="' + esc(g.cid) + '" aria-label="' + esc(g.name) + '"></a>' +
      '<span class="fx-amt">' + esc(money(g.amount)) + '<small>' + esc(day(g.date)) + '</small></span>' +
      '<span class="fx-t"><b>' + esc(g.name || 'Partner ' + g.cid) + (badges ? ' ' + badges : '') + '</b><span>' + esc(g.fund || 'No fund on file') + ' · ' + esc(hist) + '</span><span class="fx-gift__st">' + state + letter + '</span></span>' +
      '<span class="fx-acts">' + act + '</span></li>';
  }
  function Gifts(slot) {
    this.slot = slot;
    this.data = read('favor.today.gifts.v1');
    slot.classList.add('fx-card');
    if (!slot.classList.contains('h-card')) slot.classList.add('h-card');
    slot.setAttribute('aria-label', 'New gifts');
    // Shown only when there is a gift: a person whose job has no gifts to thank never sees the card. When this browser saw gifts last
    // time (a count, no names), the card opens with placeholder rows so the page below does not move when they land.
    var lastN = 0;
    try { lastN = Number(localStorage.getItem('favor.today.gifts.n') || 0); } catch (e) { lastN = 0; }
    if (this.data && this.data.gifts && this.data.gifts.length) this.paint();
    else if (lastN > 0) { slot.hidden = false; slot.setAttribute('aria-busy', 'true'); slot.innerHTML = '<div class="fx-head"><h2>New gifts</h2></div><div class="fx-list" aria-hidden="true">' + new Array(Math.min(lastN, 4) + 1).join('<div class="fx-skel" style="min-height:76px"><i></i><i></i></div>') + '</div>'; }
    else slot.hidden = true;
  }
  Gifts.prototype.paint = function () {
    var d = this.data || { gifts: [] };
    if (!d.gifts || !d.gifts.length) { this.slot.hidden = true; this.slot.innerHTML = ''; return; }
    this.slot.hidden = false;
    this.slot.innerHTML = '<div class="fx-head"><h2>New gifts <span class="fx-n">' + d.gifts.length + '</span></h2><a class="fx-link" href="/work/?view=gifts">All gifts to thank' + (d.owed ? ' (' + d.owed + ')' : '') + '</a></div><ul class="fx-list">' + d.gifts.map(giftRow).join('') + '</ul>';
  };
  Gifts.prototype.load = function () {
    var self = this;
    return api('GET', '/api/today/gifts').then(function (d) {
      if (d.slow && self.data) return;
      self.data = { gifts: d.gifts || [], owed: d.owed || 0 };
      write('favor.today.gifts.v1', self.data);
      try { localStorage.setItem('favor.today.gifts.n', String(self.data.gifts.length)); } catch (e) { /* storage refused */ }
      self.slot.removeAttribute('aria-busy');
      self.paint();
    }).catch(function () { self.data = { gifts: [] }; self.paint(); });
  };
  function thank(i, btn) {
    var c = cards.gifts; if (!c || !c.data) return;
    var g = c.data.gifts[+i]; if (!g) return;
    if (!window.FavorWG || !window.FavorWG.pop) { location.href = '/work/?view=gifts'; return; }
    window.FavorWG.pop(btn, { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, left: g.thank.state === 'left' ? { date: g.thank.on, by: g.thank.by, how: g.thank.how } : null, tasks: g.taskIds.length, team: g.team }, { done: function () { setTimeout(function () { c.load(); }, 1500); } });
  }

  /* ================================================================ mount */
  var bound = false, timer = 0;
  function mount(root) {
    root = root || document;
    var slots = { inbox: root.querySelector('[data-today-slot="inbox"]'), waiting: root.querySelector('[data-today-slot="waiting"]'), gifts: root.querySelector('[data-today-slot="gifts"]') };
    if (!slots.inbox && !slots.waiting && !slots.gifts) return;
    // Mounted on these same slots already (the app calls mount after the script mounted itself): nothing to do.
    if ((!slots.inbox || (cards.inbox && cards.inbox.slot === slots.inbox)) && (!slots.waiting || (cards.waiting && cards.waiting.slot === slots.waiting)) && (!slots.gifts || (cards.gifts && cards.gifts.slot === slots.gifts))) return;
    cards = {};
    ['inbox', 'waiting'].forEach(function (n) { if (slots[n]) { cards[n] = new Card(slots[n], n); cards[n].load(); } });
    if (slots.gifts) { cards.gifts = new Gifts(slots.gifts); cards.gifts.load(); }
    if (!bound) {
      bound = true;
      document.addEventListener('click', function (e) {
        if (!e.target.closest) return;
        var th = e.target.closest('[data-fx-thank]');
        if (th) { e.preventDefault(); thank(th.getAttribute('data-fx-thank'), th); return; }
        if (e.target.closest('[data-today-slot="inbox"], [data-today-slot="waiting"]')) onClick(e);
      });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) refresh(); }, 90000);
    var q = new URLSearchParams(location.search).get('handoff');
    if (q && /^ho_[a-z0-9]{6,20}$/.test(q)) {
      try { var u = new URL(location.href); u.searchParams.delete('handoff'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* old browser */ }
      openHandoff(q);
    }
  }
  function refresh() {
    Object.keys(cards).forEach(function (n) { var c = cards[n]; if (c.slot.isConnected) c.load(); });
  }
  window.FavorTodayInbox = { mount: mount, refresh: refresh };
  document.addEventListener('favor-handoff', function () { refresh(); });
  mount(document);
})();
