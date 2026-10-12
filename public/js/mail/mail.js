/* Mail in FavorOS: the signed-in person's own Gmail. Inbox and labels, conversations, reply, reply all, forward, compose with the
   staff picker and Google contacts, files (shown in the FavorOS file viewer), archive, delete, unread, star, labels, snooze,
   search with Gmail's words, drafts that save, Gmail's keyboard keys, and Make a task, Send to Chat, Open partner and Log as an
   action. Desktop: labels, list and the conversation side by side. Phone: list, conversation and compose are full screens with Back.
   The address bar keeps where you are: #/INBOX, #/INBOX/<thread>, #/search/<words>/<thread>. ?mock=1 draws invented mail. */
(function () {
  'use strict';
  var root = document.getElementById('mail-root');
  if (!root) return;
  var MOCK = !!window.__mailMock;

  /* ------------------------------------------------------------------ small helpers */
  var ICON = {
    back: '<path d="m15 5-7 7 7 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    unread: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    read: '<path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="m3 10 9 6 9-6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    reply: '<path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>',
    replyall: '<path d="M11 8 6 12.5l5 4.5"/><path d="M7 8 2 12.5 7 17"/><path d="M6 12.5h8a5 5 0 0 1 5 5V19"/>',
    fwd: '<path d="m14 8 5 4.5-5 4.5"/><path d="M19 12.5h-9a5 5 0 0 0-5 5V19"/>',
    clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10M16 3 10 13M2 13h12"/>',
    rec: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    log: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    dl: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    draft: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h7M9 17h4"/>',
    all: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    spam: '<path d="M12 3 3 19h18z"/><path d="M12 10v4M12 17h.01"/>',
    imp: '<path d="M4 6h11l5 6-5 6H4l4-6z"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    ital: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    chevd: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    key: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'
  };
  function ic(n, cls) { return '<svg class="ml-i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  var isPhone = function () { return matchMedia('(max-width: 860px)').matches; };
  var initials = function (s) { return String(s || '?').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; };
  var hue = function (s) { var n = 0; for (var i = 0; i < String(s).length; i++) n = (n * 31 + String(s).charCodeAt(i)) % 8; return n; };
  var who = function (a) { return a ? (a.name || a.email || '') : ''; };
  var firstName = function (a) { var n = who(a); return a && a.email === S.me ? 'me' : (a && a.name ? n.split(/\s+/)[0] : n); };
  function when(iso, long) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    if (long) return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }
  function size(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function kindOf(mime, name) {
    var t = (mime || '') + ' ' + (name || '');
    if (/^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(name || '')) return 'image';
    if (/pdf/i.test(t)) return 'pdf';
    if (/wordprocessingml|\.docx\b/i.test(t)) return 'docx';
    if (/spreadsheetml|\.xlsx\b|text\/csv|\.csv\b/i.test(t)) return 'xlsx';
    if (/^video\//.test(mime || '')) return 'video';
    if (/^audio\//.test(mime || '')) return 'audio';
    return 'file';
  }
  var ET = function (iso) { return new Date(iso || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); };

  /* ------------------------------------------------------------------ the server */
  function req(method, path, body) {
    return fetch(path.charAt(0) === '/' ? path : '/api/mail/' + path, {
      method: method, credentials: 'same-origin',
      headers: Object.assign({ 'X-Hub-Request': '1' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) { var e = new Error(d.message || 'Something went wrong. Try again.'); e.code = d.error || ''; e.need = d.need || ''; e.status = r.status; throw e; }
        return d;
      });
    }, function () { var e = new Error('No connection. Try again when you are back online.'); e.code = 'offline'; throw e; });
  }
  var api = {
    state: function () { return req('GET', 'state'); },
    labels: function () { return req('GET', 'labels'); },
    threads: function (label, q, page) { return req('GET', 'threads?label=' + encodeURIComponent(label || 'INBOX') + (q ? '&q=' + encodeURIComponent(q) : '') + (page ? '&page=' + encodeURIComponent(page) : '')); },
    thread: function (id) { return req('GET', 'threads/' + encodeURIComponent(id)); },
    modify: function (id, add, remove) { return req('POST', 'threads/' + encodeURIComponent(id) + '/modify', { add: add || [], remove: remove || [] }); },
    trash: function (id) { return req('POST', 'threads/' + encodeURIComponent(id) + '/trash', {}); },
    untrash: function (id) { return req('POST', 'threads/' + encodeURIComponent(id) + '/untrash', {}); },
    snooze: function (id, until) { return req('POST', 'threads/' + encodeURIComponent(id) + '/snooze', { until: until }); },
    unsnooze: function (id) { return req('DELETE', 'threads/' + encodeURIComponent(id) + '/snooze'); },
    newLabel: function (name) { return req('POST', 'labels', { name: name }); },
    send: function (b) { return req('POST', 'send', b); },
    saveDraft: function (b) { return req('PUT', 'drafts', b); },
    dropDraft: function (id) { return req('DELETE', 'drafts/' + encodeURIComponent(id)); },
    contacts: function (q) { return req('GET', 'contacts?q=' + encodeURIComponent(q || '')); },
    drive: function (q) { return req('GET', 'drive?q=' + encodeURIComponent(q || '')); },
    clips: function () { return req('GET', 'clips'); },
    owners: function () { return req('GET', 'log-owners'); },
    task: function (b) { return req('POST', '/api/tasks', b); },
    chatBoot: function () { return req('GET', '/api/chat/boot'); },
    chatSend: function (ch, body) { return req('POST', '/api/chat/channels/' + encodeURIComponent(ch) + '/messages', { body: body }); },
    logAction: function (b) { return req('POST', '/api/work/entry/many', b); },
    fileUrl: function (mid, f, dl) { return '/api/mail/messages/' + encodeURIComponent(mid) + '/attachments/' + encodeURIComponent(f.id) + '?name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.mime) + (dl ? '&dl=1' : ''); }
  };
  if (MOCK && window.FavorMailMock) api = window.FavorMailMock(api);

  /* ------------------------------------------------------------------ state */
  var S = {
    me: '', name: '', level: { read: false, write: false, headers: false, contacts: false }, write: true, connected: false, signature: '',
    label: 'INBOX', q: '', threads: [], next: '', loading: false, labels: [], sel: -1,
    open: '', thread: null, partners: {}, drafts: {}, view: 'list', ro: false, nav: {}, exp: {}
  };
  try { S.ro = localStorage.getItem('favor.mail.ro') === '1'; } catch (e) { /* private mode */ }
  try { var nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); S.nav = (nv && nv.access) || {}; } catch (e) { /* none */ }

  function hubAccess() { try { var nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); return (nv && nv.access) || {}; } catch (e) { return {}; } }
  var SYS_ICON = { INBOX: 'inbox', STARRED: 'star', SNOOZED: 'clock', IMPORTANT: 'imp', SENT: 'send', DRAFT: 'draft', ALL: 'all', SPAM: 'spam', TRASH: 'trash' };
  var labelName = function (id) { var l = S.labels.filter(function (x) { return x.id === id; })[0]; return l ? l.name : ({ INBOX: 'Inbox', STARRED: 'Starred', SNOOZED: 'Snoozed', SENT: 'Sent', DRAFT: 'Drafts', ALL: 'All mail', SPAM: 'Spam', TRASH: 'Trash', IMPORTANT: 'Important' }[id] || id); };
  var canWrite = function () { return S.write && !S.ro; };
  var gmailLink = function (tid) { return 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(S.me) + (tid ? '#all/' + encodeURIComponent(tid) : ''); };

  /* ------------------------------------------------------------------ frame */
  root.innerHTML =
    '<div class="ml-pnav"><button type="button" class="ml-pn" data-act="hub-menu" aria-label="Open the menu">' + ic('menu') + '</button>' +
      '<button type="button" class="ml-pn ml-pn--label" data-act="labels-sheet" aria-haspopup="dialog"><span data-label-name>Inbox</span>' + ic('chevd') + '</button>' +
      '<button type="button" class="ml-pn" data-act="compose" aria-label="New message">' + ic('pen') + '</button></div>' +
    '<aside class="ml-side" aria-label="Mailboxes"><button type="button" class="ml-compose" data-act="compose">' + ic('pen') + '<span>Compose</span></button><nav class="ml-labels" data-labels></nav></aside>' +
    '<section class="ml-list" aria-label="Conversations">' +
      '<form class="ml-search" role="search" data-search><label class="ml-search__box">' + ic('search') + '<input type="search" name="q" placeholder="Search mail" aria-label="Search mail" autocomplete="off" enterkeyhint="search" /><kbd>/</kbd></label></form>' +
      '<div class="ml-list__head"><b data-list-title>Inbox</b><span data-list-note></span><button type="button" class="ml-iconbtn" data-act="refresh" aria-label="Refresh" title="Refresh">' + '<svg class="ml-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>' + '</button></div>' +
      '<div class="ml-allow" data-allow hidden><span>Senders and subjects only. Allow Mail adds the full message, files and search.</span><a class="ml-btn ml-btn--primary" data-allow-link href="#">Allow Mail</a></div>' +
      '<div class="ml-rows" data-rows></div>' +
    '</section>' +
    '<section class="ml-read" aria-label="Conversation" data-read></section>' +
    '<div class="ml-toast" role="status" aria-live="polite" hidden></div>';

  /* ------------------------------------------------------------------ tooltips for icon buttons */
  // Every button that shows only an icon gets a text tooltip (its label, with the key when it has one), shown on hover and on
  // keyboard focus. The tooltip texts live once each in #ml-tips and the buttons point at them.
  var tips = document.createElement('div'); tips.id = 'ml-tips'; document.body.appendChild(tips);
  var bubble = document.createElement('div'); bubble.className = 'ml-tip'; bubble.hidden = true; bubble.setAttribute('aria-hidden', 'true'); document.body.appendChild(bubble);
  var tipIds = {}, tipN = 0, tipT = 0;
  function tipFor(text) {
    if (!tipIds[text]) { var sp = document.createElement('span'); sp.id = 'ml-tip-' + (++tipN); sp.setAttribute('role', 'tooltip'); sp.textContent = text; tips.appendChild(sp); tipIds[text] = sp.id; }
    return tipIds[text];
  }
  function tipScan(scope) {
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('button[aria-label]:not([data-ui-tooltip]), a[aria-label]:not([data-ui-tooltip])').forEach(function (b) {
      if (/[A-Za-z0-9]/.test(b.textContent)) return;
      var text = b.getAttribute('title') || b.getAttribute('aria-label');
      b.removeAttribute('title');
      b.setAttribute('data-ui-tooltip', tipFor(text));
    });
  }
  new MutationObserver(function (list) { list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && n.closest && n.closest('.ml, .ml-sheet, .ml-c')) tipScan(n.parentNode || n); }); }); }).observe(document.body, { childList: true, subtree: true });
  tipScan(root);
  function tipShow(b) {
    var sp = document.getElementById(b.getAttribute('data-ui-tooltip')); if (!sp) return;
    bubble.textContent = sp.textContent; bubble.hidden = false;
    var r = b.getBoundingClientRect(), w = bubble.offsetWidth;
    var top = r.bottom + 6; if (top + 30 > innerHeight) top = r.top - 32;
    bubble.style.top = top + 'px'; bubble.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
  }
  function tipHide() { clearTimeout(tipT); bubble.hidden = true; }
  document.addEventListener('pointerover', function (e) { if (e.pointerType !== 'mouse') return; var b = e.target.closest && e.target.closest('[data-ui-tooltip]'); if (!b || !b.closest('.ml, .ml-sheet, .ml-c')) return; clearTimeout(tipT); tipT = setTimeout(function () { if (b.isConnected) tipShow(b); }, 450); });
  document.addEventListener('pointerout', function (e) { if (e.target.closest && e.target.closest('[data-ui-tooltip]')) tipHide(); });
  document.addEventListener('pointerdown', tipHide, true);
  document.addEventListener('focusin', function (e) { var b = e.target.closest && e.target.closest('[data-ui-tooltip]'); if (b && document.documentElement.classList.contains('kbd') && b.closest('.ml, .ml-sheet, .ml-c')) tipShow(b); else tipHide(); });

  /* ------------------------------------------------------------------ toast */
  var toastT = 0;
  function toast(msg, undo) {
    var t = $('.ml-toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-undo>Undo</button>' : '');
    t.hidden = false; t.classList.remove('is-in'); void t.offsetWidth; t.classList.add('is-in');
    clearTimeout(toastT);
    t.onclick = function (e) { if (e.target.closest('[data-undo]') && undo) { undo(); t.hidden = true; } };
    toastT = setTimeout(function () { t.hidden = true; }, undo ? 6000 : 3200);
  }

  /* ------------------------------------------------------------------ sheets (menus and small forms) */
  var sheetEl = null, sheetPushed = false, skipPop = 0, afterPop = null;
  function openSheet(title, html, opts) {
    opts = opts || {};
    // A sheet that replaces another keeps its place in the Back history.
    var hadPush = false;
    if (sheetEl) { hadPush = sheetPushed; sheetEl.remove(); sheetEl = null; sheetPushed = false; }
    var el = document.createElement('div');
    el.className = 'ml-sheet' + (opts.anchor && !isPhone() ? ' ml-sheet--pop' : '') + (opts.wide ? ' ml-sheet--wide' : '');
    el.innerHTML = '<div class="ml-sheet__scrim" data-close></div><div class="ml-sheet__box" role="dialog" aria-modal="true" tabindex="-1" aria-label="' + esc(title) + '"><div class="ml-sheet__head"><b>' + esc(title) + '</b><button type="button" class="ml-iconbtn" data-close aria-label="Close">' + ic('x') + '</button></div><div class="ml-sheet__body">' + html + '</div></div>';
    document.body.appendChild(el);
    var box = el.querySelector('.ml-sheet__box');
    if (opts.anchor && !isPhone()) {
      var r = opts.anchor.getBoundingClientRect();
      box.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 360)) + 'px';
      box.style.left = Math.max(8, Math.min(r.left, innerWidth - 388)) + 'px';
    }
    el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });
    sheetEl = el;
    requestAnimationFrame(function () {
      el.classList.add('is-in');
      var f = el.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea, button:not([data-close])');
      if (f && !isPhone()) f.focus({ preventScroll: true });
      else box.focus({ preventScroll: true });
    });
    if (hadPush) sheetPushed = true;
    else if (isPhone()) { history.pushState({ mlSheet: 1 }, ''); sheetPushed = true; }
    return el;
  }
  // Closes the sheet. On a phone the sheet holds one step of Back history, so `then` runs after that step is undone.
  function closeSheet(mode, then) {
    if (!sheetEl) { if (then) then(); return false; }
    var el = sheetEl; sheetEl = null;
    el.classList.remove('is-in');
    setTimeout(function () { el.remove(); }, 180);
    if (sheetPushed && mode !== 'pop') {
      sheetPushed = false; skipPop++;
      afterPop = then || null;
      history.back();
    } else { sheetPushed = false; if (then) then(); }
    return true;
  }

  /* ------------------------------------------------------------------ asking for the Google permission */
  function allowUrl(kind) { return '/api/google/connect?add=' + kind + '&next=' + encodeURIComponent('/mail/' + location.hash); }
  function askWrite(what) {
    if (S.level.headers && !S.level.read) {
      openSheet('Allow Mail', '<p class="ml-p">FavorOS can show who wrote and the subject today. Allow Mail adds the full message, its files and search. Google asks once. Replying and archiving ask one more time.</p><div class="ml-sheet__acts"><a class="ml-btn ml-btn--primary" href="' + esc(allowUrl('mail')) + '">Allow Mail</a><a class="ml-btn" href="' + esc(gmailLink(S.open)) + '" target="_blank" rel="noopener">Open in Gmail</a></div>');
      return;
    }
    if (!S.write || S.ro) {
      openSheet('Open in Gmail', '<p class="ml-p">Changing and sending mail from FavorOS is not available yet.</p><div class="ml-sheet__acts"><a class="ml-btn ml-btn--primary" href="' + esc(gmailLink(S.open)) + '" target="_blank" rel="noopener">' + ic('ext') + 'Open in Gmail</a></div>');
      return;
    }
    openSheet('Allow changes and sending', '<p class="ml-p">Google asks once. This lets FavorOS archive, delete, label, star, snooze, save drafts and send from your Gmail, and look up your Google contacts when you address a message.</p>' +
      '<div class="ml-sheet__acts"><a class="ml-btn ml-btn--primary" href="' + esc(allowUrl('mailsend')) + '">Allow changes</a><button type="button" class="ml-btn" data-close>Not now</button></div>');
    void what;
  }
  function failed(e, what) {
    if (e && e.code === 'mail_scope' && e.need === 'write') return askWrite(what);
    if (e && e.code === 'mail_scope') return renderConnect('read');
    if (e && e.code === 'mail_readonly') { S.write = false; return askWrite(what); }
    toast(e && e.message ? e.message : 'That did not work. Try again.');
  }

  /* ------------------------------------------------------------------ labels */
  function renderLabels() {
    var sys = S.labels.filter(function (l) { return l.type === 'system' && l.id !== 'IMPORTANT'; });
    var own = S.labels.filter(function (l) { return l.type === 'user'; });
    var row = function (l) {
      var n = l.id === 'DRAFT' ? l.total : l.unread;
      var dot = l.color ? '<i class="ml-dot" style="background:' + esc(l.color) + '"></i>' : ic(SYS_ICON[l.id] || 'tag');
      return '<a class="ml-lab' + (S.label === l.id && !S.q ? ' is-on' : '') + '" href="#/' + encodeURIComponent(l.id) + '" data-label="' + esc(l.id) + '"' + (S.label === l.id && !S.q ? ' aria-current="page"' : '') + '>' + dot + '<span>' + esc(l.name) + '</span>' + (n ? '<em class="ml-count' + (l.id === 'INBOX' ? ' ml-count--strong' : '') + '">' + n.toLocaleString('en-US') + '</em>' : '') + '</a>';
    };
    var html = sys.map(row).join('') + (own.length ? '<div class="ml-labels__h">Labels</div>' + own.map(row).join('') : '');
    var nav = $('[data-labels]'); if (nav) nav.innerHTML = html;
    var nm = $('[data-label-name]'); if (nm) nm.textContent = S.q ? 'Search' : labelName(S.label);
    var inbox = S.labels.filter(function (l) { return l.id === 'INBOX'; })[0];
    if (inbox) setRailCount(inbox.unread);
    return html;
  }
  function setRailCount(n) {
    document.querySelectorAll('[data-count="mailUnread"]').forEach(function (el) { el.hidden = !n; el.textContent = Number(n || 0).toLocaleString('en-US'); });
    try { var nav = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (nav && nav.counts) { nav.counts.mailUnread = n; localStorage.setItem('favor.hub.nav.v1', JSON.stringify(nav)); } } catch (e) { /* full */ }
    if (window.hubNavLayout) window.hubNavLayout();
    if (document.body.dataset.nav === 'mail') document.title = (n ? '(' + n + ') ' : '') + 'Mail - FavorOS';
  }
  function loadLabels() {
    if (!S.level.headers && !S.level.read) return Promise.resolve();
    return api.labels().then(function (d) { S.labels = d.labels || []; renderLabels(); }).catch(function () { /* the list still works */ });
  }

  /* ------------------------------------------------------------------ the list */
  var listSeq = 0;
  function listTitle() { return S.q ? 'Search' : labelName(S.label); }
  function skeleton(n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="ml-row ml-row--skel" aria-hidden="true"><span class="ml-av"></span><span class="ml-row__t"><i style="width:' + (40 + (i * 17) % 35) + '%"></i><i style="width:' + (60 + (i * 13) % 30) + '%"></i></span></div>'; return s; }
  function loadList(opts) {
    opts = opts || {};
    var seq = ++listSeq;
    var rows = $('[data-rows]');
    $('[data-list-title]').textContent = listTitle();
    $('[data-list-note]').textContent = MOCK ? 'Sample mail' : '';
    var input = $('[data-search] input'); if (input && document.activeElement !== input) input.value = S.q;
    if (!opts.more) { if (!opts.quiet || !S.threads.length) rows.innerHTML = skeleton(8); S.next = ''; }
    S.loading = true;
    return api.threads(S.label, S.q, opts.more ? S.next : '').then(function (d) {
      if (seq !== listSeq) return;
      S.loading = false;
      if (d.level) S.level = Object.assign(S.level, d.level);
      S.threads = opts.more ? S.threads.concat(d.threads || []) : (d.threads || []);
      S.next = d.next || '';
      if (S.sel >= S.threads.length) S.sel = S.threads.length - 1;
      renderList();
    }).catch(function (e) {
      if (seq !== listSeq) return;
      S.loading = false;
      if (e.code === 'mail_scope' || e.code === 'mail_connect') return renderConnect('read');
      rows.innerHTML = '<div class="ml-empty"><b>Mail did not load</b><span>' + esc(e.message) + '</span><button type="button" class="ml-btn" data-act="refresh">Try again</button></div>';
    });
  }
  function rowHtml(t, i) {
    var names = (t.people || []).map(function (p) { return p.name === 'me' ? 'me' : (p.name || p.email).split(/\s+/)[0]; });
    var name = (t.people || []).length === 1 ? who(t.people[0]) : names.join(', ');
    if (t.draft && S.label === 'DRAFT') name = 'Draft';
    var on = S.open === t.id;
    return '<div class="ml-row' + (t.unread ? ' is-unread' : '') + (on ? ' is-open' : '') + (i === S.sel ? ' is-sel' : '') + '" data-i="' + i + '" data-id="' + esc(t.id) + '">' +
      '<a class="ml-row__a" href="#/' + (S.q ? 'search/' + encodeURIComponent(S.q) : encodeURIComponent(S.label)) + '/' + encodeURIComponent(t.id) + '" data-open="' + esc(t.id) + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="ml-av" data-h="' + hue((t.from && t.from.email) || name) + '">' + esc(initials(t.from && t.from.email === S.me ? S.name : who(t.from) || name)) + '</span>' +
        '<span class="ml-row__t"><span class="ml-row__l1"><b class="ml-row__who">' + esc(name || '(no sender)') + (t.count > 1 ? ' <small>' + t.count + '</small>' : '') + (t.draft && S.label !== 'DRAFT' ? ' <em class="ml-draftword">Draft</em>' : '') + '</b><time>' + esc(when(t.date)) + '</time></span>' +
        '<span class="ml-row__s">' + esc(t.subject || '(no subject)') + '</span>' +
        '<span class="ml-row__p">' + (t.snoozed ? '<em class="ml-chip ml-chip--sun">' + ic('clock') + esc(when(t.snoozed)) + '</em>' : '') + (t.files ? ic('clip', 'ml-i--sm') : '') + esc(t.snippet || '') + '</span></span>' +
      '</a>' +
      '<button type="button" class="ml-star' + (t.starred ? ' is-on' : '') + '" data-act="star" data-id="' + esc(t.id) + '" aria-pressed="' + (t.starred ? 'true' : 'false') + '" aria-label="' + (t.starred ? 'Remove star' : 'Star') + '">' + ic('star') + '</button>' +
      '<span class="ml-row__hover" aria-hidden="false">' +
        '<button type="button" class="ml-iconbtn" data-act="archive" data-id="' + esc(t.id) + '" aria-label="Archive" title="Archive (e)">' + ic('archive') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="delete" data-id="' + esc(t.id) + '" aria-label="Delete" title="Delete (#)">' + ic('trash') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="toggle-read" data-id="' + esc(t.id) + '" aria-label="' + (t.unread ? 'Mark as read' : 'Mark as unread') + '" title="' + (t.unread ? 'Mark as read' : 'Mark as unread') + '">' + ic(t.unread ? 'read' : 'unread') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="snooze" data-id="' + esc(t.id) + '" aria-label="Snooze" title="Snooze">' + ic('clock') + '</button>' +
      '</span></div>';
  }
  function renderList() {
    var rows = $('[data-rows]');
    if (!S.threads.length) {
      rows.innerHTML = '<div class="ml-empty"><b>' + (S.q ? 'Nothing matches' : S.label === 'INBOX' ? 'Inbox is empty' : 'No conversations') + '</b>' + (S.q ? '<span>Gmail search words work here, like from:, has:attachment and before:2026/10/01.</span>' : '') + '</div>';
      return;
    }
    rows.innerHTML = S.threads.map(rowHtml).join('') + (S.next ? '<div class="ml-more"><button type="button" class="ml-btn" data-act="more">Show more</button></div>' : '');
  }
  function patchRow(t) {
    var i = S.threads.indexOf(t);
    var el = root.querySelector('.ml-row[data-id="' + CSS.escape(t.id) + '"]');
    if (!el || i < 0) return;
    var tmp = document.createElement('div'); tmp.innerHTML = rowHtml(t, i);
    el.replaceWith(tmp.firstChild);
  }
  function findThread(id) { return S.threads.filter(function (t) { return t.id === id; })[0] || null; }
  function select(i, scroll) {
    S.sel = Math.max(0, Math.min(S.threads.length - 1, i));
    $$('.ml-row.is-sel').forEach(function (r) { r.classList.remove('is-sel'); });
    var el = root.querySelector('.ml-row[data-i="' + S.sel + '"]');
    if (el) { el.classList.add('is-sel'); if (scroll !== false) el.scrollIntoView({ block: 'nearest' }); }
  }

  /* ------------------------------------------------------------------ connect screens */
  function renderConnect(need) {
    var rows = $('[data-rows]');
    var html = '<div class="ml-connect"><span class="ml-connect__ic">' + ic('unread') + '</span><b>Your mail in FavorOS</b><p>' +
      (need === 'read' && S.level.headers ? 'FavorOS can show who wrote and the subject today. Allow Mail adds the full message, its files and search. Google asks once.' : 'Allow Mail shows your Gmail here: messages, files and search. Google asks once.') +
      '</p><a class="ml-btn ml-btn--primary" href="' + esc(allowUrl('mail')) + '">Allow Mail</a><a class="ml-link" href="' + esc(gmailLink('')) + '" target="_blank" rel="noopener">Open Gmail instead</a></div>';
    if (!S.level.headers) { rows.innerHTML = html; $('[data-read]').innerHTML = ''; }
    else if (S.view === 'thread') { var body = $('[data-read] .ml-thread__msgs'); if (body && !body.querySelector('.ml-connect')) body.insertAdjacentHTML('beforeend', html); }
  }

  /* ------------------------------------------------------------------ the conversation */
  var threadSeq = 0;
  function openThread(id, opts) {
    opts = opts || {};
    var seq = ++threadSeq;
    if (S.open !== id) S.exp = {};
    S.open = id;
    var t = findThread(id);
    if (t) S.sel = S.threads.indexOf(t);
    $$('.ml-row.is-open').forEach(function (r) { r.classList.remove('is-open'); r.querySelector('.ml-row__a').removeAttribute('aria-current'); });
    var row = root.querySelector('.ml-row[data-id="' + CSS.escape(id) + '"]');
    if (row) { row.classList.add('is-open'); row.querySelector('.ml-row__a').setAttribute('aria-current', 'true'); select(S.sel, false); }
    setView('thread');
    var read = $('[data-read]');
    // The header paints at once from the list row; the messages fill in under it.
    read.innerHTML = threadFrame(t ? { id: id, subject: t.subject, messages: [] } : { id: id, subject: '', messages: [] }, true);
    read.scrollTop = 0;
    return api.thread(id).then(function (d) {
      if (seq !== threadSeq) return;
      S.thread = d.thread; S.partners = d.partners || {}; S.drafts = d.drafts || {}; S.headersOnly = !!d.headersOnly;
      read.innerHTML = threadFrame(d.thread, false);
      drawBodies();
      if (S.headersOnly) renderConnect('read');
      var focus = read.querySelector('.ml-thread__h'); if (focus && opts.focus) focus.focus({ preventScroll: true });
      // Opening marks it read, as Gmail does (only with the person's permission to change mail).
      var lt = findThread(id);
      var unread = (d.thread.messages || []).some(function (m) { return m.unread; });
      if (unread && S.level.write && canWrite()) {
        api.modify(id, [], ['UNREAD']).then(function () { if (lt) { lt.unread = false; patchRow(lt); } bumpInbox(-1); }).catch(function () { /* stays bold */ });
      }
    }).catch(function (e) {
      if (seq !== threadSeq) return;
      if (e.code === 'mail_scope' || e.code === 'mail_connect') { read.innerHTML = threadFrame({ id: id, subject: t ? t.subject : '', messages: [] }, false); renderConnect('read'); return; }
      read.querySelector('.ml-thread__msgs').innerHTML = '<div class="ml-empty"><b>This conversation did not open</b><span>' + esc(e.message) + '</span></div>';
    });
  }
  function bumpInbox(d) {
    var inbox = S.labels.filter(function (l) { return l.id === 'INBOX'; })[0];
    if (inbox) { inbox.unread = Math.max(0, inbox.unread + d); renderLabels(); }
  }
  function threadTools() {
    var t = S.thread || {};
    var msgs = t.messages || [];
    var labels = {}; msgs.forEach(function (m) { (m.labelIds || []).forEach(function (l) { labels[l] = 1; }); });
    var inInbox = !!labels.INBOX, unread = msgs.some(function (m) { return m.unread; }), starred = msgs.some(function (m) { return m.starred; }), inTrash = !!labels.TRASH;
    return { inInbox: inInbox, unread: unread, starred: starred, inTrash: inTrash, labels: labels };
  }
  function threadFrame(t, loading) {
    var msgs = t.messages || [];
    var st = threadTools();
    var own = Object.keys(st.labels).filter(function (l) { return S.labels.some(function (x) { return x.id === l && x.type === 'user'; }); });
    var partner = partnerOf(t);
    var bar =
      '<button type="button" class="ml-iconbtn ml-back" data-act="back" aria-label="Back to ' + esc(listTitle()) + '">' + ic('back') + '<span>' + esc(listTitle()) + '</span></button>' +
      '<span class="ml-tools">' +
        (st.inTrash ? '<button type="button" class="ml-iconbtn" data-act="untrash" aria-label="Move to Inbox" title="Move to Inbox">' + ic('inbox') + '</button>' :
          (st.inInbox ? '<button type="button" class="ml-iconbtn" data-act="archive" aria-label="Archive" title="Archive (e)">' + ic('archive') + '</button>' : '<button type="button" class="ml-iconbtn" data-act="to-inbox" aria-label="Move to Inbox" title="Move to Inbox">' + ic('inbox') + '</button>')) +
        '<button type="button" class="ml-iconbtn" data-act="delete" aria-label="Delete" title="Delete (#)">' + ic('trash') + '</button>' +
        '<button type="button" class="ml-iconbtn ml-dt" data-act="toggle-read" aria-label="Mark as unread" title="Mark as unread (Shift U)">' + ic('unread') + '</button>' +
        '<button type="button" class="ml-iconbtn ml-dt" data-act="snooze" aria-label="Snooze" title="Snooze">' + ic('clock') + '</button>' +
        '<button type="button" class="ml-iconbtn ml-dt" data-act="labels" aria-label="Labels" title="Labels">' + ic('tag') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="thread-more" aria-label="More" title="More" aria-haspopup="dialog">' + ic('more') + '</button>' +
      '</span>' +
      '<span class="ml-nav"><button type="button" class="ml-iconbtn ml-dt" data-act="prev" aria-label="Newer conversation" title="Newer (k)">' + ic('up') + '</button><button type="button" class="ml-iconbtn ml-dt" data-act="next" aria-label="Older conversation" title="Older (j)">' + ic('down') + '</button></span>';
    var head = '<div class="ml-thread__top"><h2 class="ml-thread__h" tabindex="-1">' + esc(t.subject || (loading ? '' : '(no subject)')) + '</h2>' +
      '<div class="ml-thread__chips">' + own.map(function (l) { return '<span class="ml-chip">' + esc(labelName(l)) + '</span>'; }).join('') +
      (t.snoozed ? '<span class="ml-chip ml-chip--sun">' + ic('clock') + 'Snoozed until ' + esc(when(t.snoozed, true)) + '</span>' : '') +
      (partner ? '<a class="ml-chip ml-chip--leaf" href="/work/partner/' + encodeURIComponent(partner.id) + '">' + ic('person') + esc(partner.name || 'Partner') + '</a>' : '') +
      '<button type="button" class="ml-star ml-star--h' + (st.starred ? ' is-on' : '') + '" data-act="star" aria-pressed="' + (st.starred ? 'true' : 'false') + '" aria-label="' + (st.starred ? 'Remove star' : 'Star') + '">' + ic('star') + '</button></div></div>';
    var body = loading ? '<div class="ml-msg ml-msg--skel"><span class="ml-av"></span><span class="ml-row__t"><i style="width:40%"></i><i style="width:85%"></i><i style="width:70%"></i></span></div>' : msgs.map(msgHtml).join('');
    var last = msgs.filter(function (m) { return !m.draft; }).slice(-1)[0];
    var foot = !loading && last ? '<div class="ml-thread__foot">' +
      '<button type="button" class="ml-btn" data-act="reply">' + ic('reply') + 'Reply</button>' +
      (replyAllList(last).length > 1 ? '<button type="button" class="ml-btn" data-act="replyall">' + ic('replyall') + 'Reply all</button>' : '') +
      '<button type="button" class="ml-btn" data-act="forward">' + ic('fwd') + 'Forward</button></div>' : '';
    var pbar = '<div class="ml-pbar">' +
      (st.inInbox ? '<button type="button" data-act="archive" aria-label="Archive">' + ic('archive') + '</button>' : '<button type="button" data-act="to-inbox" aria-label="Move to Inbox">' + ic('inbox') + '</button>') +
      '<button type="button" data-act="delete" aria-label="Delete">' + ic('trash') + '</button>' +
      '<button type="button" data-act="labels" aria-label="Labels">' + ic('tag') + '</button>' +
      '<button type="button" data-act="reply-menu" aria-label="Reply, reply all or forward">' + ic('reply') + '</button>' +
      '<button type="button" data-act="compose" aria-label="New message">' + ic('pen') + '</button></div>';
    return '<div class="ml-thread" data-thread="' + esc(t.id) + '"><div class="ml-thread__bar">' + bar + '</div><div class="ml-thread__scroll">' + head + '<div class="ml-thread__msgs">' + body + '</div>' + foot + '</div>' + pbar + '</div>';
  }
  function partnerOf(t) {
    var msgs = (t && t.messages) || [];
    for (var i = 0; i < msgs.length; i++) { var p = S.partners[(msgs[i].from || {}).email]; if (p) return Object.assign({ email: msgs[i].from.email }, p); }
    for (var k in S.partners) return Object.assign({ email: k }, S.partners[k]);
    return null;
  }
  function recipLine(m) {
    var to = (m.to || []).concat(m.cc || []);
    return 'to ' + (to.length ? to.slice(0, 3).map(firstName).join(', ') + (to.length > 3 ? ' and ' + (to.length - 3) + ' more' : '') : 'undisclosed recipients');
  }
  function msgHtml(m, i, all) {
    var lastReal = all.filter(function (x) { return !x.draft; }).slice(-1)[0];
    var open = S.exp[m.id] != null ? S.exp[m.id] : (m.unread || m === lastReal || m.draft || all.length === 1);
    var p = S.partners[(m.from || {}).email];
    var files = (m.attachments || []).filter(function (f) { return !f.inline || !/^image\//.test(f.mime); });
    return '<article class="ml-msg' + (open ? ' is-open' : '') + (m.draft ? ' is-draft' : '') + '" data-mid="' + esc(m.id) + '">' +
      '<button type="button" class="ml-msg__head" data-act="toggle-msg" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="ml-av" data-h="' + hue((m.from || {}).email || '') + '">' + esc(initials(m.from && m.from.email === S.me ? S.name : who(m.from))) + '</span>' +
        '<span class="ml-msg__who"><span class="ml-msg__l1"><b>' + esc(m.draft ? 'Draft' : who(m.from) || '(no sender)') + '</b>' + (open && m.from && m.from.name ? '<small>' + esc(m.from.email) + '</small>' : '') + '</span>' +
          '<span class="ml-msg__l2">' + (open ? esc(recipLine(m)) : esc(m.snippet || '')) + '</span></span>' +
        '<time datetime="' + esc(m.date) + '" title="' + esc(when(m.date, true)) + '">' + esc(when(m.date)) + '</time>' +
      '</button>' +
      (open ? '<div class="ml-msg__body">' +
        (p ? '<a class="ml-partner" href="/work/partner/' + encodeURIComponent(p.id) + '">' + ic('person') + '<span>' + esc(p.name || 'Partner') + '</span><em>Partner in Blackbaud</em></a>' : '') +
        (S.headersOnly ? '<div class="ml-hdronly">' + esc(m.snippet || '') + '</div>' : '<div class="ml-frame" data-frame></div>') +
        (files.length ? '<div class="ml-files">' + files.map(function (f, k) { return fileCard(m, f, k); }).join('') + '</div>' : '') +
        '<div class="ml-msg__acts">' + (m.draft ? '<button type="button" class="ml-btn ml-btn--primary" data-act="edit-draft">' + ic('pen') + 'Edit draft</button><button type="button" class="ml-btn" data-act="drop-draft">' + ic('trash') + 'Discard</button>' :
          '<button type="button" class="ml-iconbtn" data-act="reply-one" aria-label="Reply" title="Reply">' + ic('reply') + '</button><button type="button" class="ml-iconbtn" data-act="fwd-one" aria-label="Forward" title="Forward">' + ic('fwd') + '</button>') + '</div>' +
      '</div>' : '') +
    '</article>';
  }
  function fileCard(m, f, k) {
    var kind = kindOf(f.mime, f.name);
    var url = api.fileUrl(m.id, f);
    var pic = kind === 'image' ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async" />' : '<span class="ml-fic" data-k="' + kind + '">' + esc((String(f.name).split('.').pop() || 'file').slice(0, 4).toUpperCase()) + '</span>';
    return '<div class="ml-file"><button type="button" class="ml-file__open" data-act="view-file" data-k="' + k + '">' + pic + '<span class="ml-file__t"><b>' + esc(f.name) + '</b><small>' + esc(size(f.size)) + '</small></span></button>' +
      '<a class="ml-iconbtn" href="' + esc(api.fileUrl(m.id, f, true)) + '" download="' + esc(f.name) + '" aria-label="Download ' + esc(f.name) + '" title="Download">' + ic('dl') + '</a></div>';
  }

  /* The message body: drawn in a sandboxed frame (no scripts) sized to its content, with quoted text folded away as in Gmail. */
  function frameDoc(html) {
    var o = location.origin;
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http: data: ' + o + '; style-src \'unsafe-inline\' https:; font-src https: data:; media-src https: ' + o + '">' +
      '<base target="_blank"><style>html,body{margin:0;padding:0;background:transparent}body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:#1d211b;overflow-wrap:anywhere;word-break:break-word}' +
      'img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#235578}blockquote{margin:6px 0 6px 2px;padding-left:12px;border-left:3px solid #e4e0d4;color:#464c42}' +
      'html.fos-fold .fos-q{display:none!important}table{max-width:100%}</style></head><body>' + html + '</body></html>';
  }
  function drawBodies() {
    var t = S.thread; if (!t) return;
    $$('.ml-msg.is-open [data-frame]').forEach(function (box) {
      if (box.firstChild) return;
      var mid = box.closest('.ml-msg').dataset.mid;
      var m = t.messages.filter(function (x) { return x.id === mid; })[0];
      if (!m) return;
      var f = document.createElement('iframe');
      f.className = 'ml-iframe';
      f.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      f.setAttribute('title', 'Message from ' + who(m.from));
      f.setAttribute('scrolling', 'no');
      f.srcdoc = frameDoc(m.html || '<p style="color:#666b60">(no text)</p>');
      box.appendChild(f);
      f.addEventListener('load', function () { fitFrame(f, box, t.messages.indexOf(m) > 0); });
    });
  }
  function fitFrame(f, box, fold) {
    var d; try { d = f.contentDocument; } catch (e) { return; }
    if (!d || !d.body) return;
    var w = box.clientWidth;
    var fit = function () {
      d.body.style.zoom = '';
      var sw = d.documentElement.scrollWidth;
      if (sw > w + 4 && w > 0) d.body.style.zoom = String(Math.max(0.4, w / sw));
      f.style.height = Math.ceil(d.documentElement.scrollHeight * 1) + 'px';
    };
    // Quoted earlier messages fold away (the "..." button shows them), as in Gmail.
    if (fold && !box._q) {
      var q = d.querySelector('.gmail_quote, blockquote[type="cite"], #appendonsend, .yahoo_quoted, #divRplyFwdMsg');
      if (q) {
        var top = q; while (top.parentElement && top.parentElement !== d.body && top.parentElement.children.length === 1) top = top.parentElement;
        top.classList.add('fos-q');
        if (top.id === 'divRplyFwdMsg' || top.id === 'appendonsend') { var n = top.nextElementSibling; while (n) { n.classList.add('fos-q'); n = n.nextElementSibling; } }
        d.documentElement.classList.add('fos-fold');
        box._q = 1;
        box.insertAdjacentHTML('afterend', '<button type="button" class="ml-fold" data-act="unfold" aria-label="Show quoted text" title="Show quoted text">' + ic('more') + '</button>');
      }
    }
    fit();
    d.querySelectorAll('img').forEach(function (im) { if (!im.complete) im.addEventListener('load', fit); });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { f.style.height = d.documentElement.scrollHeight + 'px'; }); ro.observe(d.body); }
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' || (!e.metaKey && !e.ctrlKey && /^[jkeuarf#/c]$/.test(e.key))) document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey })); });
  }

  /* ------------------------------------------------------------------ views (phone: list, thread as full screens) */
  function setView(v) {
    S.view = v; root.dataset.view = v;
    document.body.classList.toggle('ml-deep', v !== 'list');
    measure();
  }
  function measure() {
    if (!isPhone()) { root.style.removeProperty('--ml-bot'); return; }
    var bar = document.querySelector('.h-navbar');
    var b = 0;
    if (bar && getComputedStyle(bar).display !== 'none') b = Math.round(window.innerHeight - bar.getBoundingClientRect().top);
    root.style.setProperty('--ml-bot', Math.max(0, b) + 'px');
  }
  addEventListener('resize', function () { requestAnimationFrame(measure); });

  /* ------------------------------------------------------------------ routing (#/LABEL[/thread], #/search/words[/thread]) */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (parts[0] === 'search') return { label: 'ALL', q: parts[1] || '', thread: parts[2] || '' };
    return { label: parts[0] || 'INBOX', q: '', thread: parts[1] || '' };
  }
  function hashFor(label, q, tid) { return '#/' + (q ? 'search/' + encodeURIComponent(q) : encodeURIComponent(label || 'INBOX')) + (tid ? '/' + encodeURIComponent(tid) : ''); }
  function go(label, q, tid, replace) {
    var h = hashFor(label, q, tid);
    if (location.hash === h) return route();
    if (replace) { history.replaceState(history.state, '', h); route(); }
    else location.hash = h;
  }
  function route() {
    var r = parseHash();
    var listChanged = r.label !== S.label || r.q !== S.q || (!S.threads.length && !S.loading);
    S.label = r.label; S.q = r.q;
    if (listChanged) { S.sel = -1; renderLabels(); loadList(); }
    if (r.thread) { if (r.thread !== S.open || S.view !== 'thread') openThread(r.thread); }
    else { S.open = ''; S.thread = null; setView('list'); $$('.ml-row.is-open').forEach(function (x) { x.classList.remove('is-open'); }); if (!isPhone()) $('[data-read]').innerHTML = emptyRead(); }
  }
  function emptyRead() { return '<div class="ml-read__empty">' + ic('unread') + '<span>' + (S.threads.length ? 'Pick a conversation' : '') + '</span></div>'; }
  addEventListener('hashchange', function () { route(); });
  // The hub reloads the page on any Back step it does not own. Mail owns every step on this page (a conversation, a sheet, the
  // message window), so this listener runs first and keeps the hub out of it, unless one of the hub's own panels is open.
  window.addEventListener('popstate', function (e) {
    if (!root.isConnected || window.__hubOvHandled || (window.hubOv && window.hubOv.depth && window.hubOv.depth())) return;
    e.stopImmediatePropagation();
    if (skipPop) { skipPop--; var f = afterPop; afterPop = null; if (f) f(); return; }
    if (sheetEl && sheetPushed) closeSheet('pop');
    else if (C && C.pushed) { C.pushed = false; closeCompose(true); }
  }, true);

  /* ------------------------------------------------------------------ changes to a conversation */
  function curIds(id) { return id || S.open || (S.threads[S.sel] && S.threads[S.sel].id) || ''; }
  function removeFromList(id) {
    var i = S.threads.findIndex(function (t) { return t.id === id; });
    if (i < 0) return null;
    var t = S.threads.splice(i, 1)[0];
    var el = root.querySelector('.ml-row[data-id="' + CSS.escape(id) + '"]');
    if (el) { el.classList.add('is-leaving'); setTimeout(function () { renderList(); }, 160); } else renderList();
    return { t: t, i: i };
  }
  function putBack(gone) { if (!gone) return; S.threads.splice(gone.i, 0, gone.t); renderList(); }
  // After archive or delete from the open conversation, the next one opens (Gmail's default: the older one).
  function afterLeave(id) {
    if (S.open !== id) return;
    var nxt = S.threads[Math.min(S.sel, S.threads.length - 1)];
    if (nxt && !isPhone()) go(S.label, S.q, nxt.id, true);
    else go(S.label, S.q, '', isPhone() ? false : true);
  }
  function act(kind, id) {
    id = curIds(id);
    if (!id) return;
    if (!S.level.write || !canWrite()) return askWrite(kind);
    var t = findThread(id);
    if (kind === 'archive' || kind === 'delete') {
      var wasUnread = t && t.unread && S.label === 'INBOX';
      var gone = (S.label === 'INBOX' || kind === 'delete' || S.label === 'SNOOZED') ? removeFromList(id) : null;
      afterLeave(id);
      if (wasUnread) bumpInbox(-1);
      var p = kind === 'archive' ? api.modify(id, [], ['INBOX']) : api.trash(id);
      p.then(function () {
        toast(kind === 'archive' ? 'Archived' : 'Moved to Trash', function () {
          (kind === 'archive' ? api.modify(id, ['INBOX'], []) : api.untrash(id)).then(function () { putBack(gone); if (wasUnread) bumpInbox(1); toast(kind === 'archive' ? 'Back in Inbox' : 'Back from Trash'); }).catch(function (e) { failed(e); });
        });
      }).catch(function (e) { putBack(gone); if (wasUnread) bumpInbox(1); failed(e, kind); });
      return;
    }
    if (kind === 'to-inbox' || kind === 'untrash') {
      (kind === 'untrash' ? api.untrash(id) : api.modify(id, ['INBOX'], [])).then(function () { toast('Moved to Inbox'); if (S.label === 'TRASH' || S.label === 'SPAM') { removeFromList(id); afterLeave(id); } else if (S.open === id) openThread(id); }).catch(function (e) { failed(e); });
      return;
    }
    if (kind === 'star') {
      var on = t ? !t.starred : !threadTools().starred;
      if (t) { t.starred = on; patchRow(t); }
      if (S.thread && S.thread.id === id) { S.thread.messages.forEach(function (m) { m.starred = on; m.labelIds = on ? m.labelIds.concat(['STARRED']) : m.labelIds.filter(function (l) { return l !== 'STARRED'; }); }); var hs = $('.ml-star--h'); if (hs) { hs.classList.toggle('is-on', on); hs.setAttribute('aria-pressed', on ? 'true' : 'false'); hs.setAttribute('aria-label', on ? 'Remove star' : 'Star'); } }
      api.modify(id, on ? ['STARRED'] : [], on ? [] : ['STARRED']).catch(function (e) { if (t) { t.starred = !on; patchRow(t); } failed(e); });
      return;
    }
    if (kind === 'unread' || kind === 'read' || kind === 'toggle-read') {
      var makeUnread = kind === 'unread' || (kind === 'toggle-read' && (S.open === id || !(t && t.unread)));
      if (t) { t.unread = makeUnread; patchRow(t); }
      api.modify(id, makeUnread ? ['UNREAD'] : [], makeUnread ? [] : ['UNREAD']).then(function () {
        if (S.label === 'INBOX' || (t && (t.labelIds || []).indexOf('INBOX') >= 0)) bumpInbox(makeUnread ? 1 : -1);
        if (makeUnread && S.open === id) go(S.label, S.q, '', false);
        toast(makeUnread ? 'Marked as unread' : 'Marked as read');
      }).catch(function (e) { if (t) { t.unread = !makeUnread; patchRow(t); } failed(e); });
    }
  }

  /* ------------------------------------------------------------------ snooze */
  function snoozeTimes() {
    var now = new Date(), at = function (d, h) { var x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
    var later = new Date(now.getTime() + 3 * 36e5); later.setMinutes(0, 0, 0);
    if (now.getHours() < 15) later = at(now, 18);
    var tom = at(new Date(now.getTime() + 864e5), 8);
    var sat = new Date(now); sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7)); sat = at(sat, 8);
    var mon = new Date(now); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); mon = at(mon, 8);
    var list = [['Later today', later], ['Tomorrow', tom], ['This weekend', sat], ['Next week', mon]];
    if (later.toDateString() !== now.toDateString()) list.shift();
    return list;
  }
  function snoozeMenu(id, anchor) {
    id = curIds(id);
    if (!S.level.write || !canWrite()) return askWrite('snooze');
    var opts = snoozeTimes();
    var el = openSheet('Snooze until', '<div class="ml-menu">' + opts.map(function (o, k) { return '<button type="button" class="ml-menu__i" data-snz="' + k + '">' + ic('clock') + '<span>' + esc(o[0]) + '</span><small>' + esc(o[1].toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small></button>'; }).join('') +
      '<div class="ml-menu__pick"><label for="ml-snz-at">Pick a date and time</label><input id="ml-snz-at" type="datetime-local" class="ml-input" /><button type="button" class="ml-btn ml-btn--primary" data-snz="pick">Snooze</button></div></div>', { anchor: anchor });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-snz]'); if (!b) return;
      var until = b.dataset.snz === 'pick' ? new Date(el.querySelector('#ml-snz-at').value) : opts[+b.dataset.snz][1];
      if (!until || !isFinite(until.getTime()) || until < new Date()) { toast('Pick a time later than now'); return; }
      closeSheet();
      var t = findThread(id), wasUnread = t && t.unread && S.label === 'INBOX';
      var gone = S.label === 'INBOX' ? removeFromList(id) : null;
      afterLeave(id);
      if (wasUnread) bumpInbox(-1);
      api.snooze(id, until.toISOString()).then(function () {
        toast('Snoozed until ' + until.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), function () { api.unsnooze(id).then(function () { putBack(gone); if (wasUnread) bumpInbox(1); }).catch(failed); });
      }).catch(function (e2) { putBack(gone); if (wasUnread) bumpInbox(1); failed(e2); });
    });
  }

  /* ------------------------------------------------------------------ labels menu */
  function labelsMenu(id, anchor) {
    id = curIds(id);
    if (!S.level.write || !canWrite()) return askWrite('labels');
    var have = {};
    if (S.thread && S.thread.id === id) S.thread.messages.forEach(function (m) { (m.labelIds || []).forEach(function (l) { have[l] = 1; }); });
    else { var t = findThread(id); ((t && t.labelIds) || []).forEach(function (l) { have[l] = 1; }); }
    var own = S.labels.filter(function (l) { return l.type === 'user'; });
    var el = openSheet('Labels', '<div class="ml-menu">' + (own.length ? own.map(function (l) { return '<label class="ml-menu__i ml-check"><input type="checkbox" data-lab="' + esc(l.id) + '"' + (have[l.id] ? ' checked' : '') + ' /><span>' + esc(l.name) + '</span></label>'; }).join('') : '<p class="ml-p">No labels yet.</p>') +
      '<div class="ml-menu__pick"><label for="ml-newlab">New label</label><input id="ml-newlab" class="ml-input" maxlength="100" autocomplete="off" /><button type="button" class="ml-btn" data-newlab>Add</button></div>' +
      '<div class="ml-sheet__acts"><button type="button" class="ml-btn ml-btn--primary" data-applylab>Apply</button></div></div>', { anchor: anchor });
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-newlab]')) {
        var name = el.querySelector('#ml-newlab').value.trim(); if (!name) return;
        api.newLabel(name).then(function (d) { S.labels.push(d.label); renderLabels(); labelsMenu(id, anchor); var cb = document.querySelector('.ml-sheet [data-lab="' + CSS.escape(d.label.id) + '"]'); if (cb) cb.checked = true; }).catch(failed);
        return;
      }
      if (!e.target.closest('[data-applylab]')) return;
      var add = [], remove = [];
      el.querySelectorAll('[data-lab]').forEach(function (cb) { if (cb.checked && !have[cb.dataset.lab]) add.push(cb.dataset.lab); if (!cb.checked && have[cb.dataset.lab]) remove.push(cb.dataset.lab); });
      closeSheet();
      if (!add.length && !remove.length) return;
      api.modify(id, add, remove).then(function () {
        toast('Labels saved');
        var t2 = findThread(id); if (t2) { t2.labelIds = (t2.labelIds || []).filter(function (l) { return remove.indexOf(l) < 0; }).concat(add); }
        if (remove.indexOf(S.label) >= 0) { removeFromList(id); afterLeave(id); }
        else if (S.open === id) openThread(id);
        loadLabels();
      }).catch(failed);
    });
  }

  /* ------------------------------------------------------------------ More: task, chat, partner, Blackbaud, Gmail */
  function threadMore(anchor) {
    var t = S.thread; if (!t) return;
    var p = partnerOf(t);
    var st = threadTools();
    var items = [
      ['task', 'task', 'Make a task', 'Projects'],
      ['to-chat', 'chat', 'Send to Chat', 'A channel or a person']
    ];
    if (p) items.push(['open-partner', 'person', 'Open partner', p.name || '']);
    if (p && hubAccess().workCenter) items.push(['log-action', 'log', 'Log as an action in Blackbaud', '']);
    if (isPhone()) {
      items.push(['toggle-read', 'unread', 'Mark as unread', '']);
      items.push(['snooze', 'clock', 'Snooze', '']);
      items.push(['star', 'star', st.starred ? 'Remove star' : 'Star', '']);
    }
    items.push(['gmail', 'ext', 'Open in Gmail', '']);
    var el = openSheet('More', '<div class="ml-menu">' + items.map(function (x) { return '<button type="button" class="ml-menu__i" data-more="' + x[0] + '">' + ic(x[1]) + '<span>' + esc(x[2]) + '</span>' + (x[3] ? '<small>' + esc(x[3]) + '</small>' : '') + '</button>'; }).join('') + '</div>', { anchor: anchor });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-more]'); if (!b) return;
      var k = b.dataset.more;
      if (k === 'gmail') window.open(gmailLink(t.id), '_blank', 'noopener');
      if (k === 'task') return makeTask();
      if (k === 'to-chat') return toChat();
      if (k === 'log-action') return logAction(p);
      if (k === 'snooze') return snoozeMenu();
      closeSheet(null, function () {
        if (k === 'open-partner') location.href = '/work/partner/' + encodeURIComponent(p.id);
        else if (k !== 'gmail') act(k);
      });
    });
  }
  function lastMsg() { var t = S.thread; return t ? t.messages.filter(function (m) { return !m.draft; }).slice(-1)[0] : null; }
  function plainOf(m) { var d = document.createElement('div'); d.innerHTML = m && m.html ? m.html : ''; d.querySelectorAll('style,script,.gmail_quote,blockquote').forEach(function (x) { x.remove(); }); return (d.textContent || (m && m.snippet) || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
  function makeTask() {
    var m = lastMsg(); var t = S.thread;
    var el = openSheet('Make a task', '<form class="ml-form" data-taskf><label>Task<input class="ml-input" name="title" maxlength="200" required value="' + esc(t.subject || 'Email') + '" /></label>' +
      '<label>Due<input class="ml-input" type="date" name="due" /></label>' +
      '<label>Note<textarea class="ml-input" name="note" rows="3">' + esc('From ' + who(m && m.from) + ', ' + when(m && m.date, true)) + '</textarea></label>' +
      '<div class="ml-sheet__acts"><button type="submit" class="ml-btn ml-btn--primary">Make task</button></div></form>');
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var b = { title: f.title.value.trim(), description: f.note.value.trim() + '\n\n' + location.origin + '/mail/' + hashFor(S.label, S.q, t.id), owner_email: S.me };
      if (f.due.value) b.due_date = f.due.value;
      api.task(b).then(function (d) { closeSheet(); toast('Task made' + (d.task && d.task.code ? ' ' + d.task.code : '')); }).catch(function (er) { toast(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message); });
    });
  }
  function toChat() {
    var t = S.thread, m = lastMsg();
    var el = openSheet('Send to Chat', '<div class="ml-pick" data-chans><div class="ml-empty"><span>Loading conversations</span></div></div><label class="ml-form"><span>Note</span><textarea class="ml-input" data-chatnote rows="2" placeholder="Add a note"></textarea></label>');
    api.chatBoot().then(function (d) {
      var users = d.users || {};
      var nm = function (c) { if (c.kind === 'public' || c.kind === 'private') return '#' + c.name; var o = (c.members || []).filter(function (e2) { return e2 !== S.me; }); return o.map(function (e2) { return (users[e2] && users[e2].name) || e2; }).join(', ') || 'You'; };
      var list = (d.channels || []).slice().sort(function (a, b) { return String(b.last_at || '').localeCompare(String(a.last_at || '')); });
      el.querySelector('[data-chans]').innerHTML = list.length ? list.map(function (c) { return '<button type="button" class="ml-menu__i" data-chan="' + esc(c.id) + '">' + ic('chat') + '<span>' + esc(nm(c)) + '</span></button>'; }).join('') : '<div class="ml-empty"><span>No conversations</span></div>';
    }).catch(function (e) { el.querySelector('[data-chans]').innerHTML = '<div class="ml-empty"><span>' + esc(e.status === 403 ? 'Chat is not open to you yet' : e.message) + '</span></div>'; });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-chan]'); if (!b) return;
      var note = el.querySelector('[data-chatnote]').value.trim();
      var text = plainOf(m).slice(0, 1200);
      var body = (note ? note + '\n\n' : '') + '**' + (t.subject || '(no subject)') + '**\nFrom ' + who(m.from) + ', ' + when(m.date, true) + '\n\n' + text;
      api.chatSend(b.dataset.chan, body.slice(0, 3800)).then(function () { closeSheet(); toast('Sent to Chat'); }).catch(failed);
    });
  }
  function logAction(p) {
    var t = S.thread, m = lastMsg();
    var el = openSheet('Log as an action', '<form class="ml-form" data-logf><p class="ml-p"><b>' + esc(p.name || p.email) + '</b></p><div data-owner></div>' +
      '<label>Date<input class="ml-input" type="date" name="date" value="' + esc(ET(m && m.date)) + '" required /></label>' +
      '<label>How<select class="ml-input" name="how"><option value="email">Email</option><option value="call">Call</option><option value="meet">Meeting</option><option value="mail">Mail</option></select></label>' +
      '<label>What happened<input class="ml-input" name="summary" maxlength="255" required value="' + esc(('Email: ' + (t.subject || '')).slice(0, 255)) + '" /></label>' +
      '<div class="ml-sheet__acts"><button type="submit" class="ml-btn ml-btn--primary">Log in Blackbaud</button></div></form>');
    var owners = [];
    api.owners().then(function (d) {
      owners = d.owners || [];
      var box = el.querySelector('[data-owner]');
      if (!owners.length) { box.innerHTML = '<p class="ml-p">Action entry is not open to you.</p>'; el.querySelector('[type=submit]').disabled = true; return; }
      if (owners.length > 1) box.innerHTML = '<label>Whose contact<select class="ml-input" name="owner">' + owners.map(function (o) { return '<option value="' + esc(o.fid) + '"' + (o.fid === d.mine ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></label>';
      else box.innerHTML = '<input type="hidden" name="owner" value="' + esc(owners[0].fid) + '" />';
    }).catch(failed);
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('[type=submit]');
      if (!f.owner) return;
      btn.disabled = true; btn.textContent = 'Logging';
      api.logAction({ owner: f.owner.value, date: f.date.value, channel: f.how.value, summary: f.summary.value.trim(), tags: [], constituent_ids: [String(p.id)], req: 'mail-' + t.id + '-' + p.id + '-' + f.date.value })
        .then(function (d) { closeSheet(); toast(d.dups && !d.created ? 'Already logged' : 'Logged on ' + (p.name || 'the partner')); })
        .catch(function (er) { btn.disabled = false; btn.textContent = 'Log in Blackbaud'; toast(er.message); });
    });
  }

  /* ------------------------------------------------------------------ files */
  function viewFile(mid, k) {
    var m = S.thread && S.thread.messages.filter(function (x) { return x.id === mid; })[0];
    if (!m) return;
    var files = (m.attachments || []).filter(function (f) { return !f.inline || !/^image\//.test(f.mime); });
    var f = files[k]; if (!f) return;
    var kind = kindOf(f.mime, f.name);
    var V = window.FavorChatView;
    var item = { kind: kind, url: api.fileUrl(m.id, f), name: f.name, sub: size(f.size), download: api.fileUrl(m.id, f, true) };
    if (kind === 'video' || kind === 'audio') {
      openSheet(f.name, '<' + (kind === 'video' ? 'video playsinline' : 'audio') + ' controls autoplay src="' + esc(item.url) + '" class="ml-media"></' + kind + '><div class="ml-sheet__acts"><a class="ml-btn" href="' + esc(item.download) + '" download>' + ic('dl') + 'Download</a></div>', { wide: true });
      return;
    }
    if (!V || kind === 'file') { location.href = item.download; return; }
    if (kind === 'image') {
      var pics = files.filter(function (x) { return kindOf(x.mime, x.name) === 'image'; }).map(function (x) { return { kind: 'image', url: api.fileUrl(m.id, x), name: x.name, download: api.fileUrl(m.id, x, true) }; });
      var at = pics.filter(function (x) { return x.name === f.name; })[0];
      V.open(at || item, pics);
      return;
    }
    V.open(item);
  }

  /* ------------------------------------------------------------------ compose */
  var C = null;
  function composeOpen() { return !!C; }
  function replyAllList(m) {
    if (!m) return [];
    var out = [], seen = {};
    var add = function (a) { if (a && a.email && !seen[a.email] && a.email !== S.me) { seen[a.email] = 1; out.push(a); } };
    (m.replyTo && m.replyTo.length ? m.replyTo : [m.from]).forEach(add);
    (m.to || []).forEach(add); (m.cc || []).forEach(add);
    if (!out.length && m.from && m.from.email === S.me) (m.to || []).forEach(function (a) { if (!seen[a.email]) { seen[a.email] = 1; out.push(a); } });
    return out;
  }
  function quoteHtml(m) {
    return '<br><div class="gmail_quote"><div>On ' + esc(when(m.date, true)) + ', ' + esc(who(m.from)) + ' &lt;' + esc(m.from.email) + '&gt; wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + (m.html || esc(m.text || '')) + '</blockquote></div>';
  }
  function fwdHtml(m) {
    var line = function (k, v) { return v ? '<div>' + k + ': ' + v + '</div>' : ''; };
    var list = function (l) { return (l || []).map(function (a) { return esc(who(a)) + ' &lt;' + esc(a.email) + '&gt;'; }).join(', '); };
    return '<br><div class="gmail_quote"><div>---------- Forwarded message ---------</div>' + line('From', esc(who(m.from)) + ' &lt;' + esc(m.from.email) + '&gt;') + line('Date', esc(when(m.date, true))) + line('Subject', esc(m.subject)) + line('To', list(m.to)) + line('Cc', list(m.cc)) + '<br>' + (m.html || esc(m.text || '')) + '</div>';
  }
  function reSubject(s, pre) { s = String(s || ''); var re = new RegExp('^' + pre + ':', 'i'); return re.test(s) ? s : pre + ': ' + s; }
  function startReply(kind, m) {
    if (!S.level.write || !canWrite()) return askWrite('reply');
    m = m || lastMsg(); if (!m) return;
    var t = S.thread;
    if (kind === 'forward') {
      return openCompose({ subject: reSubject(m.subject || t.subject, 'Fwd'), quote: fwdHtml(m), forward: (m.attachments || []).filter(function (f) { return !f.inline; }).map(function (f) { return { messageId: m.id, attachmentId: f.id, name: f.name, mime: f.mime, size: f.size }; }), title: 'Forward' });
    }
    var all = replyAllList(m);
    var to = kind === 'replyall' ? all : [(m.replyTo && m.replyTo[0]) || (m.from.email === S.me ? (m.to || [])[0] : m.from)];
    var cc = [];
    if (kind === 'replyall' && all.length > 1) { to = [all[0]]; cc = all.slice(1); }
    openCompose({ to: to.filter(Boolean), cc: cc, subject: reSubject(m.subject || t.subject, 'Re'), quote: quoteHtml(m), threadId: t.id, replyTo: m.id, title: kind === 'replyall' ? 'Reply all' : 'Reply' });
  }
  function editDraft(mid) {
    if (!S.level.write || !canWrite()) return askWrite('draft');
    var m = S.thread.messages.filter(function (x) { return x.id === mid; })[0]; if (!m) return;
    var real = S.thread.messages.filter(function (x) { return !x.draft; });
    openCompose({ to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, body: m.html || '', draftId: S.drafts[m.id] || '', threadId: real.length ? S.thread.id : '', replyTo: real.length ? real[real.length - 1].id : '', title: 'Draft', noSig: true });
  }
  function chipHtml(a) { return '<span class="ml-to" data-email="' + esc(a.email) + '" data-name="' + esc(a.name || '') + '" title="' + esc(a.email) + '">' + esc(a.name || a.email) + '<button type="button" data-unchip aria-label="Remove ' + esc(a.name || a.email) + '">' + ic('x') + '</button></span>'; }
  function addrRow(k, label, list) {
    return '<div class="ml-c__row" data-field="' + k + '"><label for="ml-c-' + k + '">' + label + '</label><div class="ml-c__chips">' + (list || []).map(chipHtml).join('') + '<input id="ml-c-' + k + '" class="ml-c__in" type="email" multiple autocomplete="off" autocapitalize="off" spellcheck="false" data-addr="' + k + '" /></div>' + (k === 'to' ? '<button type="button" class="ml-c__ccb" data-act="show-cc">Cc Bcc</button>' : '') + '<div class="ml-sug" data-sug hidden role="listbox"></div></div>';
  }
  function openCompose(o) {
    o = o || {};
    if (C) closeCompose(true);
    var el = document.createElement('div');
    el.className = 'ml-c';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'New message');
    var sig = !o.noSig && S.signature ? '<br><br><div class="gmail_signature">' + S.signature + '</div>' : '';
    el.innerHTML = '<div class="ml-c__box"><div class="ml-c__bar"><button type="button" class="ml-c__cancel" data-c="close">Cancel</button><b>' + esc(o.title || 'New message') + '</b><span class="ml-c__save" data-c-saved></span><button type="button" class="ml-iconbtn ml-dt" data-c="close" aria-label="Close and keep the draft" title="Close (the draft is kept)">' + ic('x') + '</button><button type="button" class="ml-btn ml-btn--primary ml-c__send" data-c="send">' + ic('send') + '<span>Send</span></button></div>' +
      '<div class="ml-c__scroll">' + addrRow('to', 'To', o.to) +
      '<div class="ml-c__cc"' + ((o.cc && o.cc.length) || (o.bcc && o.bcc.length) ? '' : ' hidden') + '>' + addrRow('cc', 'Cc', o.cc) + addrRow('bcc', 'Bcc', o.bcc) + '</div>' +
      '<div class="ml-c__row"><label for="ml-c-subj">Subject</label><input id="ml-c-subj" class="ml-c__in ml-c__subj" maxlength="900" value="' + esc(o.subject || '') + '" /></div>' +
      '<div class="ml-c__ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-ed>' + (o.body || '<div><br></div>' + sig) + '</div>' +
      (o.quote ? '<button type="button" class="ml-fold ml-fold--c" data-c="quote" aria-label="Show the earlier message" title="Show the earlier message">' + ic('more') + '</button><div class="ml-c__q" hidden data-q contenteditable="true">' + o.quote + '</div>' : '') +
      '<div class="ml-c__files" data-files></div></div>' +
      '<div class="ml-c__tools">' +
        '<button type="button" class="ml-iconbtn" data-c="attach" aria-label="Attach a file" title="Attach a file">' + ic('clip') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-c="drive" aria-label="Link a Drive file" title="Link a Drive file">' + ic('drive') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-c="clip" aria-label="Link a clip" title="Link a clip">' + ic('rec') + '</button>' +
        '<span class="ml-c__sep"></span>' +
        '<button type="button" class="ml-iconbtn" data-fmt="bold" aria-label="Bold" title="Bold (Ctrl B)">' + ic('bold') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-fmt="italic" aria-label="Italic" title="Italic (Ctrl I)">' + ic('ital') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-fmt="link" aria-label="Link" title="Link (Ctrl K)">' + ic('link') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-fmt="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">' + ic('list') + '</button>' +
        '<span class="ml-c__grow"></span>' +
        '<button type="button" class="ml-iconbtn" data-c="discard" aria-label="Discard" title="Discard">' + ic('trash') + '</button>' +
        '<input type="file" multiple hidden data-file />' +
      '</div></div>';
    document.body.appendChild(el);
    C = { el: el, o: o, files: [], forward: (o.forward || []).slice(), draftId: o.draftId || '', dirty: false, saving: null, saveT: 0, pushed: false, sent: false };
    renderFiles();
    requestAnimationFrame(function () {
      el.classList.add('is-in');
      var first = (o.to && o.to.length) ? $('[data-ed]', el) : $('#ml-c-to', el);
      if (first) { first.focus({ preventScroll: true }); if (first.hasAttribute('contenteditable')) { var r = document.createRange(); r.setStart(first, 0); r.collapse(true); var s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    });
    document.body.classList.add('ml-composing');
    if (isPhone()) { history.pushState({ mlCompose: 1 }, ''); C.pushed = true; }
    wireCompose(el);
  }
  function chips(k) { return $$('[data-field="' + k + '"] .ml-to', C.el).map(function (x) { return { email: x.dataset.email, name: x.dataset.name }; }); }
  function collect() {
    var ed = $('[data-ed]', C.el), q = $('[data-q]', C.el);
    // Typed addresses not yet turned into chips still count.
    ['to', 'cc', 'bcc'].forEach(function (k) { var inp = $('[data-addr="' + k + '"]', C.el); if (inp && inp.value.trim()) commitTyped(inp); });
    var html = ed.innerHTML + (q ? q.innerHTML : '');
    return { to: chips('to'), cc: chips('cc'), bcc: chips('bcc'), subject: $('#ml-c-subj', C.el).value, html: html, threadId: C.o.threadId || '', replyTo: C.o.replyTo || '', draftId: C.draftId };
  }
  function renderFiles() {
    var box = $('[data-files]', C.el);
    var all = C.forward.map(function (f, i) { return { f: f, k: 'w' + i }; }).concat(C.files.map(function (f, i) { return { f: f, k: 'u' + i }; }));
    box.innerHTML = all.map(function (x) { return '<span class="ml-cf">' + ic('file') + '<span>' + esc(x.f.name) + '</span><small>' + esc(size(x.f.size)) + '</small><button type="button" data-unfile="' + x.k + '" aria-label="Remove ' + esc(x.f.name) + '">' + ic('x') + '</button></span>'; }).join('');
  }
  function commitTyped(inp) {
    var parts = inp.value.split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var left = [];
    parts.forEach(function (p) { if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p)) inp.insertAdjacentHTML('beforebegin', chipHtml({ email: p.toLowerCase(), name: '' })); else left.push(p); });
    inp.value = left.join(' ');
  }
  var sugT = 0;
  function suggest(inp) {
    var row = inp.closest('.ml-c__row'), box = $('[data-sug]', row);
    var q = inp.value.trim();
    clearTimeout(sugT);
    if (q.length < 1) { box.hidden = true; return; }
    sugT = setTimeout(function () {
      api.contacts(q).then(function (d) {
        if (inp.value.trim() !== q) return;
        var have = chips(inp.dataset.addr).map(function (a) { return a.email; });
        var list = (d.people || []).filter(function (p) { return have.indexOf(p.email) < 0; }).slice(0, 8);
        box._list = list;
        box.innerHTML = list.map(function (p, i) { return '<button type="button" role="option" class="ml-sug__i' + (i === 0 ? ' is-on' : '') + '" data-sugi="' + i + '"><span class="ml-av ml-av--sm" data-h="' + hue(p.email) + '">' + (p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(p.name || p.email))) + '</span><span><b>' + esc(p.name || p.email) + '</b><small>' + esc(p.email) + (p.title ? ' · ' + esc(p.title) : '') + '</small></span>' + (p.kind === 'staff' ? '<em class="ml-chip">Staff</em>' : '') + '</button>'; }).join('');
        box.hidden = !list.length;
      }).catch(function () { box.hidden = true; });
    }, 140);
  }
  function pickSug(row, i) {
    var box = $('[data-sug]', row), p = box._list && box._list[i]; if (!p) return;
    var inp = $('.ml-c__in', row);
    inp.insertAdjacentHTML('beforebegin', chipHtml({ email: p.email, name: p.name }));
    inp.value = ''; box.hidden = true; inp.focus(); changed();
  }
  function changed() {
    if (!C) return;
    C.dirty = true;
    clearTimeout(C.saveT);
    if (S.level.write && canWrite()) C.saveT = setTimeout(saveDraft, 2500);
  }
  function saveDraft() {
    if (!C || C.sent || !C.dirty) return Promise.resolve();
    var b = collect();
    if (!b.to.length && !b.cc.length && !b.subject.trim() && !$('[data-ed]', C.el).textContent.trim()) return Promise.resolve();
    C.dirty = false;
    var mark = $('[data-c-saved]', C.el); if (mark) mark.textContent = 'Saving';
    var mine = C;
    C.saving = api.saveDraft(b).then(function (d) { mine.draftId = d.draftId; if (mark) mark.textContent = 'Draft saved'; }).catch(function (e) { mine.dirty = true; if (mark) mark.textContent = ''; if (e.code === 'mail_scope') askWrite('draft'); });
    return C.saving;
  }
  function closeCompose(quiet, discard) {
    if (!C) return;
    var c = C; C = null;
    clearTimeout(c.saveT);
    document.body.classList.remove('ml-composing');
    if (c.pushed && !quiet) { c.pushed = false; skipPop++; history.back(); }
    if (!c.sent) {
      if (discard) { if (c.draftId) api.dropDraft(c.draftId).catch(function () {}); else if (c.saving) c.saving.then(function () { if (c.draftId) api.dropDraft(c.draftId).catch(function () {}); }); toast('Draft discarded'); }
      else if (c.dirty) { var keep = C; C = c; saveDraft().then(function () { toast('Draft saved'); }); C = keep; }
    }
    c.el.classList.remove('is-in'); c.el.classList.add('is-out');
    setTimeout(function () { c.el.remove(); }, 200);
  }
  function sendNow() {
    var b = collect();
    if (!b.to.length && !b.cc.length && !b.bcc.length) { toast('Add who it goes to'); var t = $('#ml-c-to', C.el); if (t) t.focus(); return; }
    if (!b.subject.trim() && !confirm('Send without a subject?')) return;
    var big = C.files.reduce(function (n, f) { return n + f.size; }, 0);
    if (big > 24 * 1048576) { toast('Files can add up to 24 MB. Link a big file from Drive instead.'); return; }
    var c = C;
    c.sent = true; clearTimeout(c.saveT);
    b.files = c.files.map(function (f) { return { name: f.name, mime: f.mime, data: f.data }; });
    b.forward = c.forward;
    closeCompose(false);
    // Five seconds to take it back, as Gmail's Undo send.
    var undone = false;
    toast('Sending', function () { undone = true; c.sent = false; openCompose(Object.assign({}, c.o, { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, body: $('[data-ed]', c.el) ? $('[data-ed]', c.el).innerHTML : '', quote: '', draftId: c.draftId, noSig: true })); if (C) { C.files = c.files; C.forward = c.forward; renderFiles(); if (c.o.quote) { var qd = document.createElement('div'); qd.className = 'ml-c__q'; qd.setAttribute('data-q', ''); qd.setAttribute('contenteditable', 'true'); qd.innerHTML = $('[data-q]', c.el) ? $('[data-q]', c.el).innerHTML : ''; $('[data-ed]', C.el).after(qd); } } });
    setTimeout(function () {
      if (undone) return;
      api.send(b).then(function (d) {
        toast('Sent');
        if (S.open && d.threadId === S.open) openThread(S.open);
        else if (S.label === 'SENT') loadList({ quiet: true });
      }).catch(function (e) { toast(e.message || 'Not sent. Your draft is kept.'); c.sent = false; if (e.code === 'mail_scope') askWrite('send'); });
    }, 5000);
  }
  function readFile(file) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: String(r.result).split(',')[1] || '' }); };
      r.onerror = no;
      r.readAsDataURL(file);
    });
  }
  function insertHtml(html) {
    var ed = $('[data-ed]', C.el);
    ed.focus();
    // Back to where the person was typing before the picker took the focus.
    if (C.range && ed.contains(C.range.startContainer)) { var s = getSelection(); s.removeAllRanges(); s.addRange(C.range); }
    if (!document.execCommand('insertHTML', false, html)) ed.insertAdjacentHTML('afterbegin', html);
    changed();
  }
  function drivePick() {
    var el = openSheet('Link a Drive file', '<input class="ml-input" data-dq placeholder="Search the Drive library" aria-label="Search the Drive library" autocomplete="off" /><div class="ml-pick" data-dres><div class="ml-empty"><span>Type to search</span></div></div>');
    var t = 0, q = el.querySelector('[data-dq]'), res = el.querySelector('[data-dres]'), items = [];
    q.addEventListener('input', function () {
      clearTimeout(t);
      var v = q.value.trim();
      if (v.length < 2) { res.innerHTML = '<div class="ml-empty"><span>Type to search</span></div>'; return; }
      t = setTimeout(function () {
        api.drive(v).then(function (d) {
          if (q.value.trim() !== v) return;
          items = d.files || [];
          res.innerHTML = items.length ? items.map(function (f, i) { return '<button type="button" class="ml-menu__i" data-dpick="' + i + '">' + ic('drive') + '<span>' + esc(f.name) + '</span><small>' + esc(f.path || '') + '</small></button>'; }).join('') : '<div class="ml-empty"><span>Nothing found</span></div>';
        }).catch(function (e) { res.innerHTML = '<div class="ml-empty"><span>' + esc(e.message) + '</span></div>'; });
      }, 220);
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dpick]'); if (!b) return;
      var f = items[+b.dataset.dpick]; closeSheet();
      insertHtml('<a href="' + esc(f.url) + '">' + esc(f.name) + '</a>&nbsp;');
    });
  }
  function clipPick() {
    var el = openSheet('Link a clip', '<div class="ml-pick" data-cres><div class="ml-empty"><span>Loading your clips</span></div></div>');
    var items = [];
    api.clips().then(function (d) {
      items = d.clips || [];
      el.querySelector('[data-cres]').innerHTML = items.length ? items.map(function (c, i) { return '<button type="button" class="ml-menu__i" data-cpick="' + i + '">' + ic('rec') + '<span>' + esc(c.title) + '</span><small>' + esc([c.duration, c.when].filter(Boolean).join(' · ')) + '</small></button>'; }).join('') : '<div class="ml-empty"><span>No clips yet</span></div>';
    }).catch(failed);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cpick]'); if (!b) return;
      var c = items[+b.dataset.cpick]; closeSheet();
      insertHtml('<a href="' + esc(c.url) + '">' + esc(c.title) + '</a>&nbsp;');
    });
  }
  function wireCompose(el) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c],[data-fmt],[data-unchip],[data-unfile],[data-act="show-cc"],[data-sugi]');
      if (!b) { var chipsBox = e.target.closest('.ml-c__chips'); if (chipsBox) $('.ml-c__in', chipsBox).focus(); return; }
      if (b.dataset.sugi != null) return pickSug(b.closest('.ml-c__row'), +b.dataset.sugi);
      if (b.hasAttribute('data-unchip')) { b.closest('.ml-to').remove(); changed(); return; }
      if (b.dataset.unfile) { var k = b.dataset.unfile; if (k[0] === 'w') C.forward.splice(+k.slice(1), 1); else C.files.splice(+k.slice(1), 1); renderFiles(); changed(); return; }
      if (b.dataset.act === 'show-cc') { $('.ml-c__cc', el).hidden = false; $('#ml-c-cc', el).focus(); b.hidden = true; return; }
      if (b.dataset.fmt) {
        e.preventDefault();
        if (b.dataset.fmt === 'link') { var u = prompt('Link address'); if (u) document.execCommand('createLink', false, /^(https?:|mailto:)/i.test(u) ? u : 'https://' + u); }
        else document.execCommand(b.dataset.fmt);
        changed(); return;
      }
      var c = b.dataset.c;
      if (c === 'close') closeCompose(false);
      else if (c === 'discard') closeCompose(false, true);
      else if (c === 'send') sendNow();
      else if (c === 'attach') $('[data-file]', el).click();
      else if (c === 'drive') drivePick();
      else if (c === 'clip') clipPick();
      else if (c === 'quote') { $('[data-q]', el).hidden = false; b.remove(); }
    });
    el.addEventListener('mousedown', function (e) { if (e.target.closest('[data-fmt]')) e.preventDefault(); });
    var keepRange = function () { if (!C || C.el !== el) return document.removeEventListener('selectionchange', keepRange); var s = getSelection(), ed = $('[data-ed]', el); if (s.rangeCount && ed && ed.contains(s.anchorNode)) C.range = s.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', keepRange);
    $('[data-file]', el).addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      Promise.all(files.map(readFile)).then(function (list) { if (!C) return; C.files = C.files.concat(list); renderFiles(); changed(); });
    });
    el.addEventListener('input', function (e) {
      if (e.target.matches('[data-addr]')) { if (/[,;]\s*$/.test(e.target.value)) commitTyped(e.target); suggest(e.target); }
      changed();
    });
    el.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendNow(); return; }
      if (e.key === 'Escape') { var s = e.target.closest('.ml-c__row') && $('[data-sug]', e.target.closest('.ml-c__row')); if (s && !s.hidden) { s.hidden = true; e.stopPropagation(); return; } e.stopPropagation(); closeCompose(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && e.target.closest('[data-ed]')) { e.preventDefault(); e.stopPropagation(); var u = prompt('Link address'); if (u) document.execCommand('createLink', false, /^(https?:|mailto:)/i.test(u) ? u : 'https://' + u); return; }
      if (!e.target.matches('[data-addr]')) return;
      var row = e.target.closest('.ml-c__row'), box = $('[data-sug]', row);
      var items = $$('.ml-sug__i', box), on = items.findIndex(function (x) { return x.classList.contains('is-on'); });
      if (!box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); var n = Math.max(0, Math.min(items.length - 1, on + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach(function (x, i) { x.classList.toggle('is-on', i === n); }); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !box.hidden && on >= 0 && e.target.value.trim()) { e.preventDefault(); pickSug(row, on); return; }
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') { if (e.target.value.trim()) { e.preventDefault(); commitTyped(e.target); box.hidden = true; changed(); } return; }
      if (e.key === 'Backspace' && !e.target.value) { var last = $$('.ml-to', row).pop(); if (last) { last.remove(); changed(); } }
    });
    el.addEventListener('focusout', function (e) {
      if (e.target.matches('[data-addr]')) setTimeout(function () { if (!C || !document.body.contains(e.target)) return; var row = e.target.closest('.ml-c__row'); if (row && !row.contains(document.activeElement)) { commitTyped(e.target); $('[data-sug]', row).hidden = true; } }, 150);
    });
    el.addEventListener('paste', function (e) {
      if (!e.target.closest('[data-ed]')) return;
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); Promise.all(Array.prototype.slice.call(files).map(readFile)).then(function (list) { if (!C) return; C.files = C.files.concat(list); renderFiles(); changed(); }); }
    });
  }

  /* ------------------------------------------------------------------ clicks */
  root.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    var open = e.target.closest('[data-open]');
    if (open && !a) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(S.label, S.q, open.dataset.open);
      return;
    }
    var lab = e.target.closest('[data-label]');
    if (lab && !a) { e.preventDefault(); go(lab.dataset.label, '', ''); return; }
    if (!a) return;
    var k = a.dataset.act, id = a.dataset.id || '';
    if (a.closest('.ml-row')) e.preventDefault();
    if (k === 'hub-menu') { var m = document.getElementById('h-menu') || document.getElementById('h-bar-more'); if (m) m.click(); }
    else if (k === 'labels-sheet') { var el = openSheet('Mailboxes', '<nav class="ml-labels ml-labels--sheet">' + renderLabels() + '</nav>'); el.addEventListener('click', function (ev) { var l = ev.target.closest('[data-label]'); if (l) { ev.preventDefault(); ev.stopPropagation(); closeSheet(null, function () { go(l.dataset.label, '', '', true); }); } }); }
    else if (k === 'compose') { if (!S.level.write || !canWrite()) askWrite('compose'); else openCompose(); }
    else if (k === 'refresh') { loadLabels(); loadList({ quiet: true }); }
    else if (k === 'more') loadList({ more: true });
    else if (k === 'back') go(S.label, S.q, '', false);
    else if (k === 'archive' || k === 'delete' || k === 'toggle-read' || k === 'star' || k === 'to-inbox' || k === 'untrash') act(k, id);
    else if (k === 'snooze') snoozeMenu(id, a);
    else if (k === 'labels') labelsMenu(id, a);
    else if (k === 'thread-more') threadMore(a);
    else if (k === 'reply' || k === 'replyall' || k === 'forward') startReply(k);
    else if (k === 'reply-one' || k === 'fwd-one') { var mm = msgById(a.closest('.ml-msg').dataset.mid); startReply(k === 'fwd-one' ? 'forward' : 'reply', mm); }
    else if (k === 'reply-menu') {
      var last = lastMsg();
      var sh = openSheet('Reply', '<div class="ml-menu"><button type="button" class="ml-menu__i" data-r="reply">' + ic('reply') + '<span>Reply</span></button>' + (replyAllList(last).length > 1 ? '<button type="button" class="ml-menu__i" data-r="replyall">' + ic('replyall') + '<span>Reply all</span></button>' : '') + '<button type="button" class="ml-menu__i" data-r="forward">' + ic('fwd') + '<span>Forward</span></button></div>');
      sh.addEventListener('click', function (ev) { var r = ev.target.closest('[data-r]'); if (!r) return; closeSheet(null, function () { startReply(r.dataset.r); }); });
    }
    else if (k === 'toggle-msg') {
      var art = a.closest('.ml-msg');
      var m2 = msgById(art.dataset.mid);
      if (!m2) return;
      S.exp[m2.id] = !art.classList.contains('is-open');
      var fold0 = art.nextElementSibling; if (fold0 && fold0.classList.contains('ml-fold')) fold0.remove();
      var tmp = document.createElement('div');
      tmp.innerHTML = msgHtml(m2, S.thread.messages.indexOf(m2), S.thread.messages);
      art.replaceWith(tmp.firstChild);
      drawBodies();
    }
    else if (k === 'unfold') { var box = a.previousElementSibling; var f = box && box.querySelector('iframe'); if (f && f.contentDocument) { f.contentDocument.documentElement.classList.remove('fos-fold'); f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } a.remove(); }
    else if (k === 'view-file') viewFile(a.closest('.ml-msg').dataset.mid, +a.dataset.k);
    else if (k === 'edit-draft') editDraft(a.closest('.ml-msg').dataset.mid);
    else if (k === 'drop-draft') { var dmid = a.closest('.ml-msg').dataset.mid; var did = S.drafts[dmid]; if (!did) return; if (!S.level.write || !canWrite()) return askWrite('draft'); api.dropDraft(did).then(function () { toast('Draft discarded'); openThread(S.open); }).catch(failed); }
    else if (k === 'prev' || k === 'next') stepThread(k === 'next' ? 1 : -1);
  });
  function msgById(id) { return S.thread && S.thread.messages.filter(function (m) { return m.id === id; })[0]; }
  function stepThread(d) {
    if (!S.threads.length) return;
    var i = S.open ? S.threads.findIndex(function (t) { return t.id === S.open; }) : S.sel;
    var n = Math.max(0, Math.min(S.threads.length - 1, (i < 0 ? -1 : i) + d));
    if (S.open) go(S.label, S.q, S.threads[n].id, true); else select(n);
  }
  root.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-search]'); if (!f) return;
    e.preventDefault();
    var q = f.q.value.trim();
    if (q && !S.level.read) { askWrite('search'); return; }
    f.q.blur();
    go(S.label, q, '');
  });
  root.addEventListener('search', function (e) { if (e.target.name === 'q' && !e.target.value && S.q) go('INBOX', '', ''); }, true);

  /* ------------------------------------------------------------------ keys, as in Gmail */
  function typing(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target) || C || (window.FavorChatView && window.FavorChatView.isOpen())) return;
    if (sheetEl) { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } return; }
    if (document.querySelector('.cmdk[open], .cmdk.is-open, dialog[open]')) return;
    var k = e.key;
    var map = {
      j: function () { stepThread(1); }, k: function () { stepThread(-1); },
      o: function () { var t = S.threads[S.sel]; if (t) go(S.label, S.q, t.id); }, Enter: function () { if (!S.open) { var t = S.threads[S.sel]; if (t) go(S.label, S.q, t.id); } },
      u: function () { if (S.open) go(S.label, S.q, ''); }, Escape: function () { if (S.open) go(S.label, S.q, ''); },
      e: function () { act('archive'); }, '#': function () { act('delete'); }, s: function () { act('star'); },
      U: function () { act('unread'); }, I: function () { act('read'); },
      r: function () { if (S.thread) startReply('reply'); }, a: function () { if (S.thread) startReply('replyall'); }, f: function () { if (S.thread) startReply('forward'); },
      c: function () { if (!S.level.write || !canWrite()) askWrite('compose'); else openCompose(); },
      '/': function () { var i = $('[data-search] input'); if (i) { if (isPhone() && S.view !== 'list') go(S.label, S.q, ''); i.focus(); i.select(); } },
      b: function () { if (S.open) snoozeMenu(); }, l: function () { if (S.open) labelsMenu(); },
      '?': function () { keysHelp(); }
    };
    var fn = map[k];
    if (!fn) return;
    if (k === 'Enter' && e.target.closest && e.target.closest('a,button')) return;
    e.preventDefault();
    fn();
  });
  function keysHelp() {
    var rows = [['j / k', 'Older / newer conversation'], ['o or Enter', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['s', 'Star'], ['Shift U / Shift I', 'Mark unread / read'], ['b', 'Snooze'], ['l', 'Labels'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['c', 'Compose'], ['/', 'Search'], ['Ctrl Enter', 'Send']];
    openSheet('Keyboard shortcuts', '<dl class="ml-keys">' + rows.map(function (r) { return '<dt><kbd>' + esc(r[0]) + '</kbd></dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>');
  }

  /* ------------------------------------------------------------------ start */
  function notes() {
    var p = new URLSearchParams(location.search), g = p.get('google');
    if (!g) return;
    if (g === 'mail') toast('Your mail is ready');
    else if (g === 'mailsend') { toast('Changes and sending are ready'); try { localStorage.removeItem('favor.mail.ro'); } catch (e) { /* none */ } S.ro = false; }
    else if (g === 'mailsend-declined') { toast('Google did not allow it. Mail stays read only.'); try { localStorage.setItem('favor.mail.ro', '1'); } catch (e) { /* none */ } S.ro = true; }
    else if (g === 'mail-declined') toast('Google did not allow it.');
    p.delete('google');
    history.replaceState(history.state, '', location.pathname + (p.toString() ? '?' + p : '') + location.hash);
  }
  function boot() {
    notes();
    setView(parseHash().thread ? 'thread' : 'list');
    var r = parseHash(); S.label = r.label; S.q = r.q;
    $('[data-list-title]').textContent = listTitle();
    $('[data-rows]').innerHTML = skeleton(8);
    if (!isPhone() && !r.thread) $('[data-read]').innerHTML = emptyRead();
    api.state().then(function (d) {
      S.me = d.email; S.name = d.name; S.level = d.level || S.level; S.write = d.write !== false; S.connected = d.connected; S.signature = d.signature || '';
      if (S.level.write) { S.ro = false; try { localStorage.removeItem('favor.mail.ro'); } catch (e) { /* none */ } }
      root.classList.toggle('is-ro', !canWrite() || !S.level.write);
      var bar = $('[data-allow]'); bar.hidden = !(S.level.headers && !S.level.read); $('[data-allow-link]').href = allowUrl('mail');
      if (!d.connected || (!S.level.headers && !S.level.read)) { renderConnect('read'); return; }
      loadLabels();
      route();
    }).catch(function (e) {
      $('[data-rows]').innerHTML = '<div class="ml-empty"><b>' + esc(e.status === 403 ? 'Mail is not open to you yet' : 'Mail did not load') + '</b><span>' + esc(e.message) + '</span></div>';
    });
    // The rail count and the list stay fresh while the page is open (every two minutes, only when visible).
    setInterval(function () { if (document.hidden || !S.connected) return; loadLabels(); if (S.view === 'list' && !S.q && !C && !sheetEl) loadList({ quiet: true }); }, 120000);
  }
  boot();
})();
