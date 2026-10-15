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
    key: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    boxon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    sort: '<path d="M7 5v14"/><path d="m3.5 15.5 3.5 3.5 3.5-3.5"/><path d="M17 19V5"/><path d="m13.5 8.5 3.5-3.5 3.5 3.5"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    hourglass: '<path d="M7 3h10M7 21h10"/><path d="M8 3c0 5 8 5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 5-8 9s8 4 8 9"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3 3-2.5 4 3.5"/>',
    wand: '<path d="m5 19 10-10"/><path d="m14 5 1-2 1 2 2 1-2 1-1 2-1-2-2-1z"/><path d="M19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    broom: '<path d="M14 4l6 6"/><path d="m12.5 7.5 4 4L9 19H4v-5z"/><path d="M8 15l3 3"/>'
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
  // Every call for a conversation names the mailbox it lives in (?mb=); the person's own mailbox is the one with none.
  function pathMb(path, mb) { return mb ? path + (path.indexOf('?') < 0 ? '?' : '&') + 'mb=' + encodeURIComponent(mb) : path; }
  function boxOf(id) { return (S.mbOf && S.mbOf[id]) || ''; }
  /* The conversations opened or read ahead are kept on this device (IndexedDB 'favor-mail'), never on the server: a thread opens from here
     at once while a check against Gmail runs behind it. Cleared at sign-out, when another person signs in, and after seven days. */
  var DEV = (function () {
    var open = null, TTL = 7 * 864e5;
    function db() {
      if (open) return open;
      open = new Promise(function (ok) {
        if (!window.indexedDB) return ok(null);
        var r = indexedDB.open('favor-mail', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('threads', { keyPath: 'k' }); };
        r.onsuccess = function () { ok(r.result); };
        r.onerror = function () { ok(null); };
      });
      return open;
    }
    function run(mode, fn) {
      return db().then(function (d) {
        if (!d) return null;
        return new Promise(function (ok) {
          try { var tx = d.transaction('threads', mode), st = tx.objectStore('threads'), req = fn(st); tx.oncomplete = function () { ok(req && req.result !== undefined ? req.result : null); }; tx.onerror = tx.onabort = function () { ok(null); }; } catch (e) { ok(null); }
        });
      });
    }
    var key = function (id) { return S.me + '|' + boxOf(id) + '|' + id; };
    return {
      get: function (id) { return run('readonly', function (st) { return st.get(key(id)); }).then(function (r) { return r && Date.now() - r.at < TTL ? r : null; }); },
      put: function (id, data) { return run('readwrite', function (st) { return st.put({ k: key(id), at: Date.now(), data: data }); }); },
      drop: function (id) { return run('readwrite', function (st) { return st.delete(key(id)); }); },
      sweep: function () {
        try { var who = localStorage.getItem('favor.mail.owner'); if (who && who !== S.me && window.indexedDB) { indexedDB.deleteDatabase('favor-mail'); open = null; } localStorage.setItem('favor.mail.owner', S.me); } catch (e) { /* private mode */ }
        run('readwrite', function (st) { var c = st.openCursor(); c.onsuccess = function () { var cur = c.result; if (!cur) return; if (Date.now() - cur.value.at > TTL) cur.delete(); cur.continue(); }; return c; });
      }
    };
  })();
  var sigOf = function (d) { return (d && d.thread ? d.thread.messages || [] : []).map(function (m) { return m.id + ':' + (m.labelIds || []).join(','); }).join('|'); };
  // The first conversations of a list are read ahead, so opening one shows it at once. Any change to a conversation drops its copy.
  var PRE = {};
  var api = {
    state: function () { return req('GET', 'state'); },
    signature: function () { return req('GET', 'signature'); },
    boxes: function () { return req('GET', 'boxes'); },
    from: function () { return req('GET', 'from'); },
    removeBox: function (email) { return req('DELETE', 'boxes/' + encodeURIComponent(email)); },
    labels: function (mb) { return req('GET', pathMb('labels', mb)); },
    threads: function (label, q, page, o) {
      o = o || {};
      return req('GET', 'threads?label=' + encodeURIComponent(label || 'INBOX') + (q ? '&q=' + encodeURIComponent(q) : '') + (page ? '&page=' + encodeURIComponent(page) : '') +
        (o.view ? '&view=' + encodeURIComponent(o.view) : '') + (o.flags && o.flags.length ? '&f=' + o.flags.join(',') : '') + (o.sort ? '&sort=' + o.sort : '') + (o.mb ? '&mb=' + encodeURIComponent(o.mb) : ''));
    },
    sender: function (email, name, mb) { return req('GET', pathMb('smart/sender?email=' + encodeURIComponent(email) + '&name=' + encodeURIComponent(name || ''), mb)); },
    briefing: function (fresh, mb) { return req('GET', pathMb('smart/briefing' + (fresh ? '?fresh=1' : ''), mb)); },
    briefClose: function (key, mb) { return req('POST', pathMb('smart/briefing/close', mb), { key: key || '' }); },
    categories: function () { return req('GET', 'smart/categories'); },
    newCategory: function (name, description) { return req('POST', 'smart/categories', { name: name, description: description }); },
    dropCategory: function (id) { return req('DELETE', 'smart/categories/' + encodeURIComponent(id)); },
    logged: function (threadId, partnerId) { return req('POST', pathMb('smart/logged', boxOf(threadId)), { threadId: threadId, partnerId: partnerId || '' }); },
    smartSearch: function (q, mb) { return req('POST', pathMb('smart/search', mb), { q: q }); },
    hold: function (b) { return req('POST', pathMb('hold', b.mb), b); },
    release: function (id, mb) { return req('POST', pathMb('hold/' + encodeURIComponent(id) + '/release', mb), {}); },
    cancelHold: function (id, mb) { return req('DELETE', pathMb('hold/' + encodeURIComponent(id), mb)); },
    check: function (b) { return req('POST', pathMb('check', b.mb), b); },
    templates: function () { return req('GET', 'templates'); },
    saveTemplate: function (name, body) { return req('POST', 'templates', { name: name, body: body }); },
    dropTemplate: function (id) { return req('DELETE', 'templates/' + encodeURIComponent(id)); },
    fillTemplate: function (body, to) { return req('POST', 'templates/fill', { body: body, to: to }); },
    later: function () { return req('GET', 'later'); },
    makeLater: function (b) { return req('POST', pathMb('later', b.mb), b); },
    dropLater: function (id) { return req('DELETE', 'later/' + encodeURIComponent(id)); },
    snoozeWait: function (id, kind, partnerId) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id)), { until: kind, partnerId: partnerId || '' }); },
    timeline: function (pid, email, id) { return req('GET', pathMb('partner/' + encodeURIComponent(pid) + '/timeline?email=' + encodeURIComponent(email || ''), boxOf(id))); },
    readFile: function (mid, f, subject, id) { return req('GET', pathMb('messages/' + encodeURIComponent(mid) + '/attachments/' + encodeURIComponent(f.id) + '/read?name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.mime) + '&size=' + (f.size || 0) + '&subject=' + encodeURIComponent(subject || ''), boxOf(id))); },
    ask: function (id, q) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/ask', boxOf(id)), { q: q }); },
    times: function (b) { return req('POST', 'smart/times', b); },
    entity: function (kind, q) { return req('GET', 'entity?kind=' + encodeURIComponent(kind) + '&q=' + encodeURIComponent(q)); },
    entityNames: function () { return req('GET', 'entity/names'); },
    assign: function (id, to, note) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/assign', boxOf(id)), { to: to, note: note }); },
    mention: function (id, to, note) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/mention', boxOf(id)), { to: to, note: note }); },
    makeRequest: function (id, note, surface) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/request', boxOf(id)), { note: note, surface: surface }); },
    assigned: function () { return req('GET', 'assigned'); },
    assignedDone: function (id) { return req('POST', 'assigned/' + encodeURIComponent(id) + '/done', {}); },
    meetCreate: function (b) { return req('POST', '/api/meet/meetings', b); },
    overview: function (mb) { return req('GET', pathMb('smart/overview', mb)); },
    assist: function (id) { return req('GET', pathMb('threads/' + encodeURIComponent(id) + '/assist', boxOf(id))); },
    partner: function (id) { return req('GET', 'partner/' + encodeURIComponent(id)); },
    bulk: function (b, mb) { (b.ids || []).forEach(function (i) { delete PRE[i]; DEV.drop(i); }); return req('POST', pathMb('bulk', mb), b); },
    moveCat: function (senders, cat, mb) { return req('POST', pathMb('smart/move', mb), { senders: senders, cat: cat }); },
    thread: function (id) { var h = PRE[id]; if (h && Date.now() - h.at < 90000) return h.p; var p = req('GET', pathMb('threads/' + encodeURIComponent(id), boxOf(id))); p.then(function (d) { if (!d.headersOnly) DEV.put(id, d); }).catch(function () {}); return p; },
    batch: function (ids, mb) { return req('POST', pathMb('threads/batch', mb), { ids: ids }); },
    modify: function (id, add, remove) { delete PRE[id]; DEV.drop(id); return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/modify', boxOf(id)), { add: add || [], remove: remove || [] }); },
    trash: function (id) { delete PRE[id]; DEV.drop(id); return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/trash', boxOf(id)), {}); },
    untrash: function (id) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/untrash', boxOf(id)), {}); },
    snooze: function (id, until) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id)), { until: until }); },
    unsnooze: function (id) { return req('DELETE', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id))); },
    newLabel: function (name, mb) { return req('POST', pathMb('labels', mb), { name: name }); },
    send: function (b) { return req('POST', pathMb('send', b.mb), b); },
    saveDraft: function (b) { return req('PUT', pathMb('drafts', b.mb), b); },
    dropDraft: function (id, mb) { return req('DELETE', pathMb('drafts/' + encodeURIComponent(id), mb)); },
    contacts: function (q) { return req('GET', 'contacts?q=' + encodeURIComponent(q || '')); },
    drive: function (q) { return req('GET', 'drive?q=' + encodeURIComponent(q || '')); },
    clips: function () { return req('GET', 'clips'); },
    owners: function () { return req('GET', 'log-owners'); },
    task: function (b) { return req('POST', '/api/tasks', b); },
    chatBoot: function () { return req('GET', '/api/chat/boot'); },
    moveToChat: function (id, note) { delete PRE[id]; DEV.drop(id); return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/to-chat', boxOf(id)), { note: !!note }); },
    chatNote: function (id) { return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/to-chat/note', boxOf(id)), {}); },
    chatDismiss: function (id) { delete PRE[id]; DEV.drop(id); return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/to-chat/dismiss', boxOf(id)), {}); },
    chatSend: function (ch, body) { return req('POST', '/api/chat/channels/' + encodeURIComponent(ch) + '/messages', { body: body }); },
    logAction: function (b) { return req('POST', '/api/work/entry/many', b); },
    fileUrl: function (mid, f, dl) { return '/api/mail/messages/' + encodeURIComponent(mid) + '/attachments/' + encodeURIComponent(f.id) + '?name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.mime) + (dl ? '&dl=1' : '') + (S.threadBox ? '&mb=' + encodeURIComponent(S.threadBox) : ''); }
  };
  if (MOCK && window.FavorMailMock) {
    var realThread = api.thread;
    api = window.FavorMailMock(api);
    // The sample mailbox goes through the same read-ahead and device copy as a real one.
    var mockThread = api.thread;
    api.thread = function (id) { var h = PRE[id]; if (h && Date.now() - h.at < 90000) return h.p; var p = mockThread(id); p.then(function (d) { if (!d.headersOnly) DEV.put(id, d); }).catch(function () {}); return p; };
    void realThread;
  }

  /* ------------------------------------------------------------------ state */
  var S = {
    me: '', name: '', level: { read: false, write: false, headers: false, contacts: false }, write: true, connected: false, signature: '',
    label: 'INBOX', q: '', threads: [], next: '', loading: false, labels: [], sel: -1,
    open: '', thread: null, partners: {}, drafts: {}, view: 'list', ro: false, nav: {}, exp: {},
    v: '', flags: {}, sort: '', picked: {}, anchor: '', ov: null, ovTry: 0,
    boxes: [], box: '', counts: {}, mbOf: {}, nexts: {}, threadBox: '', fromOpts: null,
    brief: null, customs: [], names: null, assist: null, profile: null, later: [], team: null
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
    '<aside class="ml-side" aria-label="Mailboxes"><button type="button" class="ml-compose" data-act="compose">' + ic('pen') + '<span>Compose</span></button><div class="ml-boxes" data-boxes></div><nav class="ml-labels" data-labels></nav></aside>' +
    '<section class="ml-list" aria-label="Conversations">' +
      '<form class="ml-search" role="search" data-search><label class="ml-search__box">' + ic('search') + '<input type="search" name="q" placeholder="Search mail, or start with ? to ask" aria-label="Search mail" autocomplete="off" enterkeyhint="search" /><kbd>/</kbd></label></form>' +
      '<div class="ml-tabs" data-tabs data-keep-h="tabs" role="navigation" aria-label="Views" hidden></div>' +
      '<div class="ml-list__head"><button type="button" class="ml-iconbtn ml-pickall" data-act="pick-all" aria-label="Select all">' + ic('box') + '</button><b data-list-title>Inbox</b><span data-list-note></span><button type="button" class="ml-fon" data-act="flags-clear" data-fstate hidden></button><button type="button" class="ml-iconbtn" data-act="filter-menu" data-filterbtn aria-label="Filter" aria-haspopup="dialog">' + ic('filter') + '</button><button type="button" class="ml-iconbtn" data-act="sort-menu" aria-label="Sort" aria-haspopup="dialog">' + ic('sort') + '</button><button type="button" class="ml-iconbtn" data-act="refresh" aria-label="Refresh" title="Refresh">' + '<svg class="ml-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>' + '</button></div>' +
      '<div class="ml-selbar" data-selbar hidden></div><div class="ml-allow" data-allow hidden><span>Senders and subjects only. Allow Mail adds the full message, files and search.</span><a class="ml-btn ml-btn--primary" data-allow-link href="#">Allow Mail</a></div>' +
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
  var toastT = 0, lastUndo = null;
  function toast(msg, undo, ms) {
    var t = $('.ml-toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-undo>Undo</button>' : '');
    t.hidden = false; t.classList.remove('is-in'); void t.offsetWidth; t.classList.add('is-in');
    lastUndo = undo ? { fn: undo, at: Date.now(), ms: ms || 6000 } : lastUndo;
    clearTimeout(toastT);
    t.onclick = function (e) { if (e.target.closest('[data-undo]') && undo) { undo(); t.hidden = true; } };
    toastT = setTimeout(function () { t.hidden = true; }, ms || (undo ? 6000 : 3200));
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

  /* ------------------------------------------------------------------ mailboxes */
  var PRIMARY_DOT = '#7b8a76';
  // The mailboxes the list reads: every one when "All mailboxes" is chosen, else the one chosen ('' is the person's own).
  function accts() {
    if (!S.boxes.length) return [''];
    if (S.box === '') return [''].concat(S.boxes.map(function (b) { return b.email; }));
    return [S.box === S.me ? '' : S.box];
  }
  function labelsAcct() { return S.box === '' || S.box === S.me ? '' : S.box; }
  function boxColor(a) { var b = a && S.boxes.filter(function (x) { return x.email === a; })[0]; return b && b.color ? b.color : PRIMARY_DOT; }
  function boxTotal() { return Object.keys(S.counts).reduce(function (n, k) { return n + Math.max(0, S.counts[k]); }, 0); }
  function boxLabel(email) { var b = S.boxes.filter(function (x) { return x.email === email; })[0]; return b && b.name ? b.name : email.split('@')[0]; }
  function boxesHtml() {
    if (!S.boxes.length) return '<button type="button" class="ml-addbox" data-act="box-add">' + ic('plus') + 'Add a mailbox</button>';
    var one = function (key, name, color, n, tip) { return '<button type="button" class="ml-bx' + (S.box === key ? ' is-on' : '') + '" data-box="' + esc(key) + '" title="' + esc(tip || name) + '"><i class="ml-mb" style="background:' + esc(color) + '"></i><span>' + esc(name) + '</span>' + (n > 0 ? '<em class="ml-count' + '">' + n + '</em>' : '') + '</button>'; };
    return '<div class="ml-labels__h">Mailboxes</div>' + one('', 'All mailboxes', '#c9cfc2', boxTotal()) + one(S.me, S.me.split('@')[0], PRIMARY_DOT, S.counts[S.me] || 0, S.me) +
      S.boxes.map(function (b) { return one(b.email, boxLabel(b.email), b.color || PRIMARY_DOT, S.counts[b.email] || 0, b.email); }).join('') +
      '<button type="button" class="ml-addbox" data-act="box-manage">' + ic('plus') + 'Manage mailboxes</button>';
  }
  function renderBoxes() { var el = $('[data-boxes]'); if (el) el.innerHTML = boxesHtml(); }
  function loadBoxes() {
    if (!S.boxes.length) return Promise.resolve();
    return api.boxes().then(function (d) {
      S.counts = {};
      (d.boxes || []).forEach(function (b) { S.counts[b.email] = b.unread; });
      renderBoxes();
      setRailCount(boxTotal());
    }).catch(function () { /* the counts stay as they were */ });
  }
  function setBox(key) {
    if (S.box === key) return;
    S.box = key; S.ov = null; S.labels = []; S.threads = []; S.nexts = {}; S.v = '';
    renderBoxes(); renderLabels();
    history.replaceState(history.state, '', '#/INBOX');
    loadLabels(); route();
  }
  function bulkAll(body) {
    // Conversations in different mailboxes go out as one change for each mailbox.
    var groups = {};
    body.ids.forEach(function (id) { var a = boxOf(id); (groups[a] = groups[a] || []).push(id); });
    var keys = Object.keys(groups);
    return Promise.all(keys.map(function (a) { return api.bulk(Object.assign({}, body, { ids: groups[a] }), a); })).then(function (rs) {
      return rs.reduce(function (m, r) { return { ok: true, done: (m.done || 0) + (r.done || 0), failed: (m.failed || 0) + (r.failed || 0), unread: r.unread, all: r.all }; }, {});
    });
  }
  function manageBoxes() {
    var rows = S.boxes.map(function (b) { return '<div class="ml-menu__i ml-mrow"><i class="ml-mb" style="background:' + esc(b.color || PRIMARY_DOT) + '"></i><span>' + esc(b.email) + '</span><button type="button" class="ml-btn" data-rmbox="' + esc(b.email) + '">Remove</button></div>'; }).join('');
    var el = openSheet('Mailboxes', '<p class="ml-p">Only you can see a mailbox you add here. Add a Favor account (an accounting or admin inbox, or a second account of yours) and reply from it, or remove it and FavorOS forgets the connection.</p><div class="ml-menu"><div class="ml-menu__i ml-mrow"><i class="ml-mb" style="background:' + PRIMARY_DOT + '"></i><span>' + esc(S.me) + '</span><small>Signed in</small></div>' + rows + '</div>' +
      '<div class="ml-sheet__acts"><a class="ml-btn ml-btn--primary" href="' + esc(addBoxUrl()) + '">Add a mailbox</a></div>');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rmbox]'); if (!b) return;
      var email = b.dataset.rmbox;
      if (!window.confirm('Remove ' + email + ' from FavorOS Mail? Nothing is deleted in Gmail.')) return;
      b.disabled = true;
      api.removeBox(email).then(function () {
        S.boxes = S.boxes.filter(function (x) { return x.email !== email; });
        delete S.counts[email];
        if (S.box === email) S.box = '';
        closeSheet(); renderBoxes(); loadBoxes(); S.threads = []; S.labels = []; loadLabels(); route();
        toast('Mailbox removed');
      }).catch(failed);
    });
  }
  function addBoxUrl() { return '/api/google/connect?add=mailbox&next=' + encodeURIComponent('/mail/'); }
  // The From picker: every connected mailbox and the addresses Gmail lets it send as.
  function loadFrom() { if (!S.boxes.length) return Promise.resolve(); return api.from().then(function (d) { S.fromOpts = d.from || []; }).catch(function () { S.fromOpts = null; }); }

  /* ------------------------------------------------------------------ labels */
  function renderLabels() {
    var sys = S.labels.filter(function (l) { return l.type === 'system' && l.id !== 'IMPORTANT'; });
    var own = S.labels.filter(function (l) { return l.type === 'user'; });
    var row = function (l) {
      var n = l.id === 'DRAFT' ? l.total : l.unread;
      var dot = l.color ? '<i class="ml-dot" style="background:' + esc(l.color) + '"></i>' : ic(SYS_ICON[l.id] || 'tag');
      var tip = l.id === 'INBOX' && l.unreadPrimary != null && l.unread ? ' title="' + l.unread + ' unread: ' + l.unreadPrimary + ' in Primary, ' + Math.max(0, l.unread - l.unreadPrimary) + ' in the other tabs."' : '';
      return '<a class="ml-lab' + (S.label === l.id && !S.q && !(l.id === 'INBOX' && S.v) ? ' is-on' : '') + '" href="#/' + encodeURIComponent(l.id) + '" data-label="' + esc(l.id) + '"' + tip + (S.label === l.id && !S.q && !(l.id === 'INBOX' && S.v) ? ' aria-current="page"' : '') + '>' + dot + '<span>' + esc(l.name) + '</span>' + (n ? '<em class="ml-count' + (l.id === 'INBOX' ? ' ml-count--strong' : '') + '">' + n.toLocaleString('en-US') + '</em>' : '') + '</a>';
    };
    var html = sys.map(function (l) { return row(l) + (l.id === 'INBOX' ? viewsHtml() : '') + (l.id === 'DRAFT' ? '<button type="button" class="ml-lab ml-lab--btn" data-act="later-list">' + ic('clock') + '<span>Scheduled</span></button><button type="button" class="ml-lab ml-lab--btn" data-act="assigned-list">' + ic('person') + '<span>Assigned</span></button>' : ''); }).join('') + (own.length ? '<div class="ml-labels__h">Labels</div>' + own.map(row).join('') : '');
    var nav = $('[data-labels]'); if (nav) nav.innerHTML = html;
    var nm = $('[data-label-name]'); if (nm) nm.textContent = S.q ? 'Search' : labelName(S.label);
    var inbox = S.labels.filter(function (l) { return l.id === 'INBOX'; })[0];
    if (inbox) setRailCount(S.boxes.length ? boxTotal() : inbox.unread);
    return (isPhone() && S.boxes.length ? boxesHtml() : '') + html;
  }
  function renderLabelsOnly() { if (S.labels.length) renderLabels(); }
  function setRailCount(n) {
    document.querySelectorAll('[data-count="mailUnread"]').forEach(function (el) { el.hidden = !n; el.textContent = Number(n || 0).toLocaleString('en-US'); });
    try { var nav = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (nav && nav.counts) { nav.counts.mailUnread = n; localStorage.setItem('favor.hub.nav.v1', JSON.stringify(nav)); } } catch (e) { /* full */ }
    if (window.hubNavLayout) window.hubNavLayout();
    if (document.body.dataset.nav === 'mail') document.title = (n ? '(' + n + ') ' : '') + 'Mail - FavorOS';
  }
  function loadNames() { if (S.names || !S.level.read) return; S.names = []; api.entityNames().then(function (d) { S.names = d.funds || []; }).catch(function () { /* funds are not marked */ }); }
  function loadLabels() {
    if (!S.level.headers && !S.level.read) return Promise.resolve();
    return api.labels(labelsAcct()).then(function (d) { S.labels = d.labels || []; renderLabels(); renderFilters(); }).catch(function () { /* the list still works */ });
  }
  // The rail number follows what Gmail says: a change made here moves it at once, and the real number is read a moment later.
  var syncT = 0;
  function syncSoon(ms) { clearTimeout(syncT); syncT = setTimeout(function () { loadLabels(); loadBoxes(); if (S.label === 'INBOX') loadOverview(); }, ms || 1500); }
  function sync(d) {
    if (d && d.unread != null) {
      var inbox = S.labels.filter(function (l) { return l.id === 'INBOX'; })[0];
      if (inbox) { inbox.unread = d.unread; inbox.unreadAll = d.unread; renderLabels(); renderFilters(); }
    }
    loadBoxes();
    syncSoon();
  }
  // A conversation counts toward the Inbox number when it is in the Inbox's Primary tab.
  function isPrimary(labelIds) {
    var l = labelIds || [];
    return l.indexOf('INBOX') >= 0;
  }

  /* ------------------------------------------------------------------ views, filters and sorting */
  var BASE_VIEWS = [['', 'Inbox'], ['needs', 'Needs you'], ['cat:partners', 'Partners'], ['cat:staff', 'Staff'], ['cat:people', 'People'], ['cat:receipts', 'Receipts and gifts'], ['cat:newsletters', 'Newsletters'], ['cat:notifications', 'Notifications'], ['cat:calendar', 'Calendar']];
  // The views: the built-in ones, then each category the person described in words, then the two lists that need no model.
  function allViews() { return BASE_VIEWS.concat(S.customs.map(function (c) { return ['cat:' + c.id, c.name]; }), [['waiting', 'Waiting on reply'], ['unlogged', 'Not logged']]); }
  var CAT_NAMES = { partners: 'Partners', staff: 'Staff', people: 'People', receipts: 'Receipts and gifts', newsletters: 'Newsletters', notifications: 'Notifications', calendar: 'Calendar' };
  function slugOf(v) { return v === 'needs' || v === 'waiting' || v === 'unlogged' ? v : v ? v.slice(4) : ''; }
  function unslug(x) { if (x === 'needs' || x === 'waiting' || x === 'unlogged') return x; if (CAT_NAMES[x] || S.customs.some(function (c) { return c.id === x; }) || /^c_[a-z0-9]{4,12}$/.test(x)) return 'cat:' + x; return null; }
  function viewName(v) { var r = allViews().filter(function (x) { return x[0] === v; })[0]; return r ? r[1] : 'Inbox'; }
  function viewCount(v) {
    if (!S.ov) return null;
    if (v === 'needs') return S.ov.needs;
    if (v === 'waiting') return S.ov.waiting;
    if (v === 'unlogged') return S.ov.unlogged || 0;
    if (v.indexOf('cat:') === 0) return (S.ov.counts[v.slice(4)] || {}).n || 0;
    return null;
  }
  function activeFlags() { return ['unread', 'starred', 'files', 'partner'].filter(function (f) { return S.flags[f]; }); }
  function inboxPlain() { return S.label === 'INBOX' && !S.q; }
  function effSort() { return S.sort || ((S.v === 'needs' || S.v === 'waiting') && inboxPlain() ? 'old' : 'new'); }
  function listOpts() { return { view: inboxPlain() ? S.v : '', flags: activeFlags().filter(function (f) { return f !== 'partner' || inboxPlain(); }), sort: S.sort }; }
  var FLAG_NAMES = { unread: 'Unread', starred: 'Starred', files: 'Has attachments', partner: 'From a partner' };
  // Views with something in them (the one you are in always shows). The sidebar lists them under Inbox; a phone gets one scrolling row.
  function liveViews() {
    return allViews().filter(function (x) { if (x[0] === '') return true; var n = viewCount(x[0]); return S.v === x[0] || (n != null && n > 0); });
  }
  function viewsHtml() {
    if (!S.ov || !(S.level.read || MOCK)) return '';
    return liveViews().filter(function (x) { return x[0] !== ''; }).map(function (x) {
      var n = viewCount(x[0]), unread = x[0] === 'needs' || x[0] === 'unlogged' ? n : x[0] === 'waiting' ? 0 : (S.ov.counts[x[0].slice(4)] || {}).unread;
      var on = inboxPlain() && S.v === x[0];
      return '<a class="ml-lab ml-lab--sub' + (on ? ' is-on' : '') + '" href="#/' + slugOf(x[0]) + '" data-label="INBOX" data-v="' + esc(x[0]) + '"' + (on ? ' aria-current="page"' : '') + '><span>' + esc(x[1]) + '</span>' + (n ? '<em class="ml-count ml-count--sub' + (unread ? ' is-bold' : '') + '">' + n + '</em>' : '') + '</a>';
    }).join('') + '<button type="button" class="ml-addbox ml-addbox--sub" data-act="cats">' + ic('wand') + 'New category</button>';
  }
  function renderTabs() {
    var box = $('[data-tabs]'); if (!box) return;
    var show = inboxPlain() && !!S.ov && (S.level.read || MOCK);
    box.hidden = !show;
    if (!show) { box.innerHTML = ''; return; }
    box.innerHTML = liveViews().map(function (x) {
      var n = viewCount(x[0]), on = S.v === x[0];
      return '<a class="ml-tab' + (on ? ' is-on' : '') + (x[0] === 'needs' && n ? ' is-hot' : '') + '" href="#/' + (slugOf(x[0]) || 'INBOX') + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(x[1]) + (n ? '<em>' + n + '</em>' : '') + '</a>';
    }).join('');
    renderLabelsOnly();
  }
  function renderFilters() {
    var chip = $('[data-fstate]'), btn = $('[data-filterbtn]'); if (!chip || !btn) return;
    var act = activeFlags().filter(function (f) { return f !== 'partner' || inboxPlain(); });
    btn.hidden = S.label === 'SNOOZED' || !(S.level.read || S.level.headers);
    btn.classList.toggle('is-on', act.length > 0);
    chip.hidden = !act.length;
    chip.innerHTML = act.length ? esc(act.map(function (f) { return FLAG_NAMES[f]; }).join(', ')) + ic('x') : '';
    chip.setAttribute('aria-label', act.length ? 'Remove filters: ' + act.map(function (f) { return FLAG_NAMES[f]; }).join(', ') : '');
  }
  function filterMenu(anchor) {
    var items = ['unread', 'starred', 'files'].concat(inboxPlain() && S.v !== 'waiting' ? ['partner'] : []);
    var el = openSheet('Filter', '<div class="ml-menu">' + items.map(function (f) { return '<label class="ml-menu__i ml-check"><input type="checkbox" data-fl="' + f + '"' + (S.flags[f] ? ' checked' : '') + ' /><span>' + FLAG_NAMES[f] + '</span></label>'; }).join('') + '</div>', { anchor: anchor });
    el.addEventListener('change', function (e) {
      var c = e.target.closest('[data-fl]'); if (!c) return;
      S.flags[c.dataset.fl] = c.checked; renderFilters(); loadList();
    });
  }
  function sortMenu(anchor) {
    var cur = effSort();
    var el = openSheet('Sort', '<div class="ml-menu">' + [['new', 'Newest first'], ['old', 'Oldest first'], ['prio', 'Most important first']].map(function (x) { return '<button type="button" class="ml-menu__i" data-sort="' + x[0] + '"><span>' + x[1] + '</span>' + (cur === x[0] ? ic('check') : '') + '</button>'; }).join('') + '</div>', { anchor: anchor });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sort]'); if (!b) return;
      S.sort = b.dataset.sort; closeSheet(); loadList();
    });
  }
  function applyMarks() {
    if (!S.ov || !S.ov.marks) return;
    S.threads.forEach(function (t) {
      var m = S.ov.marks[t.id]; if (!m) return;
      if (t.cat !== m.cat || !!t.ask !== !!m.ask) { t.cat = m.cat; t.ask = m.ask; patchRow(t); }
    });
  }
  function loadOverview() {
    if (!S.level.read || !S.connected) return;
    var seq = ++ovSeq, list = accts();
    Promise.all(list.map(function (a) { return api.overview(a).catch(function () { return null; }); })).then(function (rs) {
      if (seq !== ovSeq) return;
      rs = rs.filter(Boolean);
      if (!rs.length) return;
      var d = rs[0];
      if (rs.length > 1) {
        d = { counts: {}, customs: rs[0].customs, unlogged: 0, major: 0, needs: 0, unread: 0, waiting: 0, marks: {}, cleanup: { total: 0, senders: [], ids: [] }, scanned: 0, pending: 0 };
        rs.forEach(function (r) {
          Object.keys(r.counts).forEach(function (c) { var x = d.counts[c] || (d.counts[c] = { n: 0, unread: 0 }); x.n += r.counts[c].n; x.unread += r.counts[c].unread; });
          d.unlogged += r.unlogged || 0; d.major += r.major || 0;
          d.needs += r.needs; d.unread += r.unread; d.waiting += r.waiting; d.scanned += r.scanned; d.pending += r.pending;
          Object.assign(d.marks, r.marks);
        });
      }
      S.ov = d; S.ovTry = d.pending ? S.ovTry + 1 : 0;
      S.customs = d.customs || S.customs;
      applyMarks(); renderTabs(); renderCleanup();
      if (d.pending && S.ovTry < 3) setTimeout(function () { if (S.label === 'INBOX') loadOverview(); }, 2500);
    });
  }
  var ovSeq = 0;
  // Closing the briefing keeps the date of the newest important message (people, partners, staff) in this browser and, through the
  // server, for the person on every device. The card comes back only when something newer and important arrives.
  function briefClosedKey() { try { return localStorage.getItem('favor.mail.briefoff:' + (S.me || '')); } catch (e) { return null; } }
  function briefHtml() {
    var b = S.brief;
    if (!inboxPlain() || S.v || !S.threads.length || S.briefFailed || !S.level.read) return '';
    var closed = briefClosedKey();
    // While the briefing loads its place is held open, so the list below does not jump when it arrives. A closed card holds nothing.
    if (!b) return closed !== null ? '' : '<div class="ml-brief ml-brief--wait" aria-hidden="true"><i></i><i></i><i></i></div>';
    if (b.off || (closed !== null && String(b.key || '') <= closed)) return '';
    var items = (b.items || []).map(function (i) { return '<button type="button" class="ml-brief__i" data-act="brief-open" data-id="' + esc(i.id) + '"><b>' + esc(i.from) + '</b><span>' + esc(i.subject) + '</span><em>' + esc(i.why) + '</em></button>'; }).join('');
    return '<div class="ml-brief"><div class="ml-brief__h">' + ic('bolt') + '<b>This morning</b><button type="button" class="ml-iconbtn" data-act="brief-fresh" aria-label="Refresh the briefing">' + ic('refresh') + '</button><button type="button" class="ml-iconbtn" data-act="brief-hide" aria-label="Close the briefing">' + ic('x') + '</button></div><p>' + esc(b.text) + '</p>' + (items ? '<div class="ml-brief__l">' + items + '</div>' : '') + '</div>';
  }
  function nudgeHtml() {
    var n = S.ov && S.ov.unlogged;
    if (!n || !inboxPlain() || S.v) return '';
    var wk = ET().slice(0, 8) + Math.floor(Number(ET().slice(8, 10)) / 7);
    try { if (localStorage.getItem('favor.mail.nudge') === wk) return ''; } catch (e) { /* private mode */ }
    return '<div class="ml-clean ml-clean--nudge">' + ic('log') + '<div class="ml-clean__t"><b>' + n + ' partner email' + (n === 1 ? '' : 's') + ' not logged in Blackbaud</b><span>This week</span></div><a class="ml-btn" href="#/unlogged">Review</a><button type="button" class="ml-iconbtn" data-act="nudge-hide" aria-label="Not this week">' + ic('x') + '</button></div>';
  }
  function loadBrief(fresh) {
    if (!S.level.read || !inboxPlain() || S.v) return;
    var a = accts()[0] || '';
    api.briefing(!!fresh, a).then(function (d) { S.brief = d.briefing; renderCleanup(); }).catch(function () { S.briefFailed = true; renderCleanup(); });
  }
  function cleanHtml() {
    var c = S.ov && S.ov.cleanup;
    if (!c || !c.total || !inboxPlain() || S.v) return '';
    try { if (sessionStorage.getItem('favor.mail.clean') === ET()) return ''; } catch (e) { /* private mode */ }
    var names = c.senders.slice(0, 3).map(function (x) { return x.name; }).join(', ');
    return '<div class="ml-clean">' + ic('broom') + '<div class="ml-clean__t"><b>' + c.total + ' unread from ' + c.senders.length + ' senders you never open</b><span>Newsletters and notices, including ' + esc(names) + '.</span></div>' +
      '<button type="button" class="ml-btn" data-act="clean-review">Archive all</button><button type="button" class="ml-iconbtn" data-act="clean-dismiss" aria-label="Not now">' + ic('x') + '</button></div>';
  }
  // The briefing and the notices sit in one box at the top of the inbox. The box opens at the height it had last time and says it
  // is busy until the overview and the briefing have answered (public/js/hub-motion.js holds it), so the rows below it do not
  // drop when a notice arrives.
  function notesWait() { return inboxPlain() && !S.v && S.threads.length > 0 && (!S.ov || briefHtml().indexOf('ml-brief--wait') >= 0); }
  function notesHtml() {
    var h = briefHtml() + nudgeHtml() + cleanHtml();
    var wait = notesWait();
    if (!h && !wait) return '';
    return '<div class="ml-notes" data-keep-h="notes"' + (wait ? ' aria-busy="true"' : '') + '>' + h + '</div>';
  }
  function renderCleanup() {
    var rows = $('[data-rows]'); if (!rows) return;
    var box = rows.querySelector('.ml-notes');
    var h = S.threads.length ? briefHtml() + nudgeHtml() + cleanHtml() : '';
    var wait = notesWait();
    if (!h && !wait) { if (box) box.remove(); return; }
    if (!box) { rows.insertAdjacentHTML('afterbegin', '<div class="ml-notes" data-keep-h="notes"></div>'); box = rows.firstElementChild; }
    box.innerHTML = h;
    if (wait) box.setAttribute('aria-busy', 'true'); else box.removeAttribute('aria-busy');
  }
  function cleanReview() {
    var c = S.ov && S.ov.cleanup; if (!c || !c.total) return;
    if (!S.level.write || !canWrite()) return askWrite('archive');
    var el = openSheet('Archive unread newsletters and notices', '<p class="ml-p">' + c.total + ' conversations from senders where nothing has been opened. They stay in All mail.</p><div class="ml-menu">' +
      c.senders.map(function (x) { return '<div class="ml-menu__i"><span>' + esc(x.name) + '</span><small>' + x.n + '</small></div>'; }).join('') + '</div>' +
      '<div class="ml-sheet__acts"><button type="button" class="ml-btn ml-btn--primary" data-clean-go>Archive ' + c.total + '</button><button type="button" class="ml-btn" data-close>Not now</button></div>');
    el.addEventListener('click', function (e) {
      if (!e.target.closest('[data-clean-go]')) return;
      var ids = c.ids.slice();
      closeSheet();
      var gone = removeMany(ids);
      bulkAll({ ids: ids, action: 'archive' }).then(function (d) {
        sync(d);
        toast('Archived ' + ids.length + ' conversations', function () { bulkAll({ ids: ids, action: 'inbox' }).then(function (d2) { putBackMany(gone); sync(d2); loadOverview(); }).catch(failed); });
        loadOverview();
      }).catch(function (er) { putBackMany(gone); failed(er, 'archive'); });
    });
  }

  /* ------------------------------------------------------------------ choosing several (the avatar circle turns into a check) */
  function pickedIds() { return Object.keys(S.picked); }
  function pickedRows() { return pickedIds().map(findThread).filter(Boolean); }
  function setPick(id, on) { if (on) S.picked[id] = 1; else delete S.picked[id]; var t = findThread(id); if (t) patchRow(t); }
  function pick(id, range) {
    var i = S.threads.findIndex(function (t) { return t.id === id; });
    var a = S.anchor ? S.threads.findIndex(function (t) { return t.id === S.anchor; }) : -1;
    if (range && a >= 0 && i >= 0) { for (var k = Math.min(a, i); k <= Math.max(a, i); k++) setPick(S.threads[k].id, true); }
    else setPick(id, !S.picked[id]);
    S.anchor = id;
    renderSelBar();
  }
  function clearPicks() { var ids = pickedIds(); S.picked = {}; S.anchor = ''; ids.forEach(function (id) { var t = findThread(id); if (t) patchRow(t); }); renderSelBar(); }
  function pickAll() {
    var all = S.threads.length && S.threads.every(function (t) { return S.picked[t.id]; });
    if (all) return clearPicks();
    S.threads.forEach(function (t) { if (!S.picked[t.id]) setPick(t.id, true); });
    renderSelBar();
  }
  function renderSelBar() {
    var bar = $('[data-selbar]'), head = $('.ml-list__head'); if (!bar || !head) return;
    var n = pickedIds().length;
    bar.hidden = !n; head.hidden = !!n;
    var pa = $('.ml-pickall'); if (pa) pa.innerHTML = ic(S.threads.length && n === S.threads.length ? 'boxon' : 'box');
    root.classList.toggle('is-picking', n > 0);
    if (!n) { bar.innerHTML = ''; return; }
    var rows = pickedRows(), anyUnread = rows.some(function (r) { return r.unread; });
    var b = function (k, icon, label) { return '<button type="button" class="ml-iconbtn" data-sel="' + k + '" aria-label="' + label + '">' + ic(icon) + '</button>'; };
    var gone = S.label === 'TRASH' || S.label === 'SPAM';
    bar.innerHTML = '<button type="button" class="ml-iconbtn" data-act="pick-clear" aria-label="Clear selection">' + ic('x') + '</button><b>' + n + ' selected</b>' +
      (n < S.threads.length ? '<button type="button" class="ml-iconbtn" data-act="pick-all" aria-label="Select all ' + S.threads.length + '">' + ic('box') + '</button>' : '') +
      '<span class="ml-selbar__acts">' + (gone ? '' : b('archive', 'archive', 'Archive')) + b('trash', 'trash', 'Delete') + b(anyUnread ? 'read' : 'unread', anyUnread ? 'read' : 'unread', anyUnread ? 'Mark as read' : 'Mark as unread') +
      b('label', 'tag', 'Label') + b('snooze', 'clock', 'Snooze') + b('move', 'folder', 'Move to category') + '</span>';
  }
  function removeMany(ids) {
    var gone = [];
    ids.forEach(function (id) { var i = S.threads.findIndex(function (t) { return t.id === id; }); if (i >= 0) gone.push({ t: S.threads[i], i: i }); });
    S.threads = S.threads.filter(function (t) { return ids.indexOf(t.id) < 0; });
    ids.forEach(function (id) { delete S.picked[id]; });
    if (S.open && ids.indexOf(S.open) >= 0) go(S.label, S.q, '', true);
    renderList(); renderSelBar();
    return gone;
  }
  function putBackMany(gone) {
    gone.sort(function (a, b) { return a.i - b.i; }).forEach(function (g) { S.threads.splice(Math.min(g.i, S.threads.length), 0, g.t); });
    renderList();
  }
  function selAct(kind) {
    var ids = pickedIds(); if (!ids.length) return;
    if (!S.level.write || !canWrite()) return askWrite(kind);
    var rows = pickedRows(), n = ids.length;
    var plural = n === 1 ? '1 conversation' : n + ' conversations';
    var unreadPrimary = rows.filter(function (t) { return t.unread && isPrimary(t.labelIds); }).length;
    if (kind === 'archive' || kind === 'trash') {
      var leaves = kind === 'trash' || S.label === 'INBOX' || S.label === 'SNOOZED';
      var gone = leaves ? removeMany(ids) : [];
      if (!leaves) { rows.forEach(function (t) { t.labelIds = (t.labelIds || []).filter(function (l) { return l !== 'INBOX'; }); }); clearPicks(); }
      bumpInbox(-unreadPrimary);
      bulkAll({ ids: ids, action: kind }).then(function (d) {
        sync(d);
        if (d.failed) { toast(d.failed + ' did not change. Try those again.'); loadList({ quiet: true }); return; }
        toast((kind === 'archive' ? 'Archived ' : 'Moved to Trash: ') + plural, function () {
          bulkAll({ ids: ids, action: kind === 'archive' ? 'inbox' : 'untrash' }).then(function (d2) { putBackMany(gone); bumpInbox(unreadPrimary); sync(d2); toast('Back where they were'); }).catch(failed);
        });
      }).catch(function (e) { putBackMany(gone); bumpInbox(unreadPrimary); failed(e, kind); });
      return;
    }
    if (kind === 'read' || kind === 'unread') {
      var on = kind === 'unread', delta = 0;
      rows.forEach(function (t) { if (!!t.unread !== on) { if (isPrimary(t.labelIds)) delta += on ? 1 : -1; t.unread = on; patchRow(t); } });
      renderSelBar();
      bumpInbox(delta);
      bulkAll({ ids: ids, action: kind }).then(function (d) { sync(d); toast(on ? 'Marked as unread' : 'Marked as read'); }).catch(function (e) { rows.forEach(function (t) { t.unread = !on; patchRow(t); }); bumpInbox(-delta); failed(e, kind); });
      return;
    }
    if (kind === 'star') {
      var all = rows.every(function (t) { return t.starred; });
      rows.forEach(function (t) { t.starred = !all; patchRow(t); });
      bulkAll({ ids: ids, action: all ? 'unstar' : 'star' }).catch(function (e) { rows.forEach(function (t) { t.starred = all; patchRow(t); }); failed(e, kind); });
      return;
    }
    if (kind === 'label') return labelsMany(ids, rows);
    if (kind === 'snooze') return snoozeMany(ids, rows);
    if (kind === 'move') return moveMany(rows);
  }
  function labelsMany(ids, rows) {
    var own = S.labels.filter(function (l) { return l.type === 'user'; });
    var has = function (l) { var c = rows.filter(function (t) { return (t.labelIds || []).indexOf(l) >= 0; }).length; return c === 0 ? 0 : c === rows.length ? 2 : 1; };
    var el = openSheet('Labels for ' + ids.length + ' conversations', '<div class="ml-menu">' + (own.length ? own.map(function (l) { return '<label class="ml-menu__i ml-check"><input type="checkbox" data-lab="' + esc(l.id) + '" data-was="' + has(l.id) + '"' + (has(l.id) === 2 ? ' checked' : '') + ' /><span>' + esc(l.name) + '</span></label>'; }).join('') : '<p class="ml-p">No labels yet.</p>') +
      '<div class="ml-sheet__acts"><button type="button" class="ml-btn ml-btn--primary" data-applylab>Apply</button></div></div>');
    el.querySelectorAll('[data-was="1"]').forEach(function (cb) { cb.indeterminate = true; });
    el.addEventListener('click', function (e) {
      if (!e.target.closest('[data-applylab]')) return;
      var add = [], remove = [];
      el.querySelectorAll('[data-lab]').forEach(function (cb) {
        var was = +cb.dataset.was;
        if (cb.checked && was !== 2 && !(was === 1 && cb.indeterminate)) add.push(cb.dataset.lab);
        if (!cb.checked && !cb.indeterminate && was > 0) remove.push(cb.dataset.lab);
      });
      closeSheet();
      if (!add.length && !remove.length) return;
      bulkAll({ ids: ids, action: 'label', add: add, remove: remove }).then(function (d) {
        rows.forEach(function (t) { t.labelIds = (t.labelIds || []).filter(function (l) { return remove.indexOf(l) < 0; }); add.forEach(function (l) { if (t.labelIds.indexOf(l) < 0) t.labelIds.push(l); }); });
        toast('Labels saved'); sync(d);
        if (remove.indexOf(S.label) >= 0) loadList({ quiet: true });
      }).catch(failed);
    });
  }
  function snoozeMany(ids, rows) {
    var opts = snoozeTimes();
    var el = openSheet('Snooze ' + ids.length + ' conversations until', '<div class="ml-menu">' + opts.map(function (o, k) { return '<button type="button" class="ml-menu__i" data-snz="' + k + '">' + ic('clock') + '<span>' + esc(o[0]) + '</span><small>' + esc(o[1].toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small></button>'; }).join('') +
      '<div class="ml-menu__pick"><label for="ml-snz-at">Pick a date and time</label><input id="ml-snz-at" type="datetime-local" class="ml-input" /><button type="button" class="ml-btn ml-btn--primary" data-snz="pick">Snooze</button></div></div>');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-snz]'); if (!b) return;
      var until = b.dataset.snz === 'pick' ? new Date(el.querySelector('#ml-snz-at').value) : opts[+b.dataset.snz][1];
      if (!until || !isFinite(until.getTime()) || until < new Date()) { toast('Pick a time later than now'); return; }
      closeSheet();
      var unreadPrimary = rows.filter(function (t) { return t.unread && isPrimary(t.labelIds); }).length;
      var gone = S.label === 'INBOX' ? removeMany(ids) : [];
      bumpInbox(-unreadPrimary);
      bulkAll({ ids: ids, action: 'snooze', until: until.toISOString() }).then(function (d) {
        sync(d);
        toast('Snoozed until ' + until.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), function () { bulkAll({ ids: ids, action: 'inbox' }).then(function (d2) { putBackMany(gone); bumpInbox(unreadPrimary); sync(d2); }).catch(failed); });
      }).catch(function (er) { putBackMany(gone); bumpInbox(unreadPrimary); failed(er, 'snooze'); });
    });
  }
  function moveMany(rows) {
    var senders = []; rows.forEach(function (t) { var e = t.from && t.from.email; if (e && e !== S.me && senders.indexOf(e) < 0) senders.push(e); });
    if (!senders.length) { toast('These are your own messages'); return; }
    var cats = ['partners', 'staff', 'people', 'receipts', 'newsletters', 'notifications', 'calendar'].concat(S.customs.map(function (c) { return c.id; }));
    var el = openSheet('Move to category', '<p class="ml-p">All mail from ' + (senders.length === 1 ? esc(senders[0]) : senders.length + ' senders') + ' goes there from now on.</p><div class="ml-menu">' +
      cats.map(function (c) { return '<button type="button" class="ml-menu__i" data-mv="' + c + '">' + ic('folder') + '<span>' + esc(CAT_NAMES[c] || (S.customs.filter(function (x) { return x.id === c; })[0] || {}).name || c) + '</span></button>'; }).join('') + '</div>');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mv]'); if (!b) return;
      var c = b.dataset.mv;
      closeSheet();
      var perBox = {};
      rows.forEach(function (t) { var e = t.from && t.from.email; if (e && senders.indexOf(e) >= 0) (perBox[t.mb || ''] = perBox[t.mb || ''] || []).push(e); });
      Promise.all(Object.keys(perBox).map(function (a) { return api.moveCat(perBox[a], c, a); })).then(function () {
        S.threads.forEach(function (t) { if (t.from && senders.indexOf(t.from.email) >= 0) { t.cat = c; patchRow(t); } });
        clearPicks();
        toast('Moved to ' + (CAT_NAMES[c] || (S.customs.filter(function (x) { return x.id === c; })[0] || {}).name || 'the category'));
        loadOverview();
        if (S.v) loadList({ quiet: true });
      }).catch(failed);
    });
  }
  function followUp(id) {
    var t = findThread(id), p = t && t.people && t.people[0];
    var first = ((p && p.name) || '').replace(/^To: /, '').split(/\s+/)[0] || 'there';
    S.pendingReply = { id: id, text: 'Hi ' + first + ',\n\nI am following up on my last note. Where does this stand on your side?' };
    go(S.label, S.q, id);
  }

  /* ------------------------------------------------------------------ the list */
  var listSeq = 0;
  function listTitle() { return S.q ? 'Search' : inboxPlain() && S.v ? viewName(S.v) : labelName(S.label); }
  function skeleton(n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="ml-row ml-row--skel" aria-hidden="true"><span class="ml-av"></span><span class="ml-row__t"><i style="width:' + (40 + (i * 17) % 35) + '%"></i><i style="width:' + (60 + (i * 13) % 30) + '%"></i></span></div>'; return s; }
  // The last list shown for each view is kept in this browser (subject, sender and preview, never a body) and drawn the moment Mail opens,
  // while the fresh list loads. A change in the fresh list is drawn over it without a loading screen.
  function listKey() { return [S.me, accts().join('+'), S.label, S.v, activeFlags().join(','), S.sort].join('|'); }
  function readSaved() { try { var all = JSON.parse(localStorage.getItem('favor.mail.rows.v1') || '{}'); var h = all[listKey()]; return h && Date.now() - h.at < 3 * 864e5 ? h.rows : null; } catch (e) { return null; } }
  function writeSaved(rows) {
    try {
      var all = JSON.parse(localStorage.getItem('favor.mail.rows.v1') || '{}'), keys = Object.keys(all);
      if (keys.length > 12) delete all[keys.sort(function (a, b) { return all[a].at - all[b].at; })[0]];
      all[listKey()] = { at: Date.now(), rows: rows.slice(0, 30) };
      localStorage.setItem('favor.mail.rows.v1', JSON.stringify(all));
    } catch (e) { /* full or private mode */ }
  }
  function loadList(opts) {
    opts = opts || {};
    var seq = ++listSeq;
    var rows = $('[data-rows]');
    $('[data-list-title]').textContent = listTitle();
    $('[data-list-note]').textContent = MOCK ? 'Sample mail' : '';
    var input = $('[data-search] input'); if (input && document.activeElement !== input) input.value = S.q;
    var asked = S.q && S.q.charAt(0) === '?' ? S.q.slice(1).trim() : '';
    var saved = !opts.more && !opts.quiet && !S.q && !S.threads.length ? readSaved() : null;
    if (saved && saved.length) { S.threads = saved; saved.forEach(function (t) { S.mbOf[t.id] = t.mb || ''; }); renderList(); }
    if (!opts.more) { if ((!opts.quiet || !S.threads.length) && !(saved && saved.length)) rows.innerHTML = skeleton(8); S.next = ''; if (!opts.quiet) { S.picked = {}; S.anchor = ''; } }
    S.loading = true;
    renderTabs(); renderFilters(); renderSelBar();
    var list = accts();
    if (asked) {
      return api.smartSearch(asked, list[0] || '').then(function (d) {
        if (seq !== listSeq) return;
        S.loading = false; (d.threads || []).forEach(function (t) { t.mb = list[0] || ''; S.mbOf[t.id] = t.mb; });
        S.threads = d.threads || []; S.next = ''; S.nexts = {};
        var note = $('[data-list-note]'); if (note) note.textContent = d.understood ? 'Searched ' + d.q + (d.major ? ', major partners' : d.partners ? ', partners' : '') : 'Could not read that question';
        renderList();
      }).catch(function (e) { if (seq !== listSeq) return; S.loading = false; rows.innerHTML = '<div class="ml-empty"><b>Search did not run</b><span>' + esc(e.message) + '</span></div>'; });
    }
    var jobs = list.filter(function (a) { return !opts.more || S.nexts[a]; }).map(function (a) {
      var o = listOpts(); o.mb = a;
      var p = api.threads(S.label, S.q, opts.more ? S.nexts[a] : '', o).then(function (d) { return { a: a, d: d }; });
      // A mailbox that fails never takes the others with it.
      return a ? p.catch(function () { return { a: a, d: { threads: [], next: '' } }; }) : p;
    });
    return Promise.all(jobs).then(function (rs) {
      var d = rs[0].d, merged = [], scanned = 0;
      if (!opts.more) S.nexts = {};
      rs.forEach(function (r) {
        (r.d.threads || []).forEach(function (t) { t.mb = r.a; S.mbOf[t.id] = r.a; });
        merged = merged.concat(r.d.threads || []);
        if (r.d.next) S.nexts[r.a] = r.d.next; else delete S.nexts[r.a];
        scanned += r.d.scanned || 0;
      });
      if (seq !== listSeq) return;
      S.loading = false;
      if (d.level) S.level = Object.assign(S.level, d.level);
      var all = opts.more ? S.threads.concat(merged) : merged;
      if (list.length > 1 && S.sort !== 'prio') { var asc = effSort() === 'old'; all.sort(function (x, y) { return asc ? String(x.date).localeCompare(String(y.date)) : String(y.date).localeCompare(String(x.date)); }); }
      if (S.sort === 'prio') all.sort(function (x, y) { return (y.prio || 0) - (x.prio || 0) || String(y.date).localeCompare(String(x.date)); });
      S.threads = all;
      if (!opts.more && !S.q) writeSaved(all);
      if (rs.some(function (r) { return r.d.stale; }) && !opts.noStale) setTimeout(function () { if (seq === listSeq) loadList({ quiet: true, noStale: true }); }, 1500);
      S.next = Object.keys(S.nexts).length ? 'more' : '';
      S.scanned = scanned;
      Object.keys(S.picked).forEach(function (id) { if (!findThread(id)) delete S.picked[id]; });
      renderSelBar();
      var note = $('[data-list-note]'); if (note && !MOCK) note.textContent = S.v && inboxPlain() && S.v !== 'waiting' && S.scanned ? 'From your newest ' + S.scanned : '';
      if (inboxPlain() && !opts.more) { loadOverview(); setTimeout(loadBrief, 1200); }
      if (S.sel >= S.threads.length) S.sel = S.threads.length - 1;
      renderList();
      if (!opts.more && S.level.read && !S.q) prefetch();
    }).catch(function (e) {
      if (seq !== listSeq) return;
      S.loading = false;
      if (e.code === 'mail_scope' || e.code === 'mail_connect') return renderConnect('read');
      rows.innerHTML = '<div class="ml-empty"><b>Mail did not load</b><span>' + esc(e.message) + '</span><button type="button" class="ml-btn" data-act="refresh">Try again</button></div>';
    });
  }
  // Read-ahead: the first 20 rows when the browser is idle (in batches of five, one request to Gmail each), a row as the pointer or focus
  // reaches it, and the conversations either side of the open one. Everything lands in PRE (this tab) and on the device.
  var batching = false;
  function warm(ids) {
    var want = ids.filter(function (id) { return id && !(PRE[id] && Date.now() - PRE[id].at < 90000); });
    if (!want.length || !S.level.read || batching) return;
    batching = true;
    var groups = {}; want.forEach(function (id) { var a = boxOf(id); (groups[a] = groups[a] || []).push(id); });
    var jobs = Object.keys(groups).map(function (a) {
      return api.batch(groups[a].slice(0, 5), a).then(function (d) {
        (d.threads || []).forEach(function (t) { var data = { thread: t.thread, partners: t.partners, drafts: t.drafts, teamChat: t.teamChat }; PRE[t.id] = { at: Date.now(), p: Promise.resolve(data) }; DEV.put(t.id, data); });
      }).catch(function () { /* opened the ordinary way */ });
    });
    Promise.all(jobs).then(function () { batching = false; });
  }
  function neighbors(id) {
    var i = S.threads.findIndex(function (t) { return t.id === id; });
    if (i < 0) return;
    setTimeout(function () { warm([S.threads[i + 1], S.threads[i - 1], S.threads[i + 2]].filter(Boolean).map(function (t) { return t.id; })); }, 120);
  }
  var hoverT = 0;
  root.addEventListener('pointerover', function (e) { var r = e.target.closest && e.target.closest('.ml-row[data-id]'); if (!r) return; clearTimeout(hoverT); hoverT = setTimeout(function () { warm([r.dataset.id]); }, 90); });
  root.addEventListener('focusin', function (e) { var r = e.target.closest && e.target.closest('.ml-row[data-id]'); if (r) warm([r.dataset.id]); });
  function idleFirst() {
    var ids = S.threads.slice(0, 20).map(function (t) { return t.id; }), at = 0, seq = listSeq;
    var next = function () {
      if (seq !== listSeq || document.hidden || at >= ids.length) return;
      batching = false; warm(ids.slice(at, at + 5)); at += 5;
      setTimeout(next, 700);
    };
    (window.requestIdleCallback || function (f) { return setTimeout(f, 400); })(next);
  }
  function prefetch() {
    if (S.level.read && S.threads.length) { idleFirst(); return; }
    var ids = [];
    var seq = listSeq;
    ids.forEach(function (id, k) {
      setTimeout(function () {
        if (seq !== listSeq || document.hidden) return;
        var p = req('GET', pathMb('threads/' + encodeURIComponent(id), boxOf(id)));
        PRE[id] = { at: Date.now(), p: p };
        p.catch(function () { delete PRE[id]; });
      }, 250 * k);
    });
  }
  function rowHtml(t, i) {
    var names = (t.people || []).map(function (p) { return p.name === 'me' ? 'me' : (p.name || p.email).split(/\s+/)[0]; });
    var name = (t.people || []).length === 1 ? who(t.people[0]) : names.join(', ');
    if (t.draft && S.label === 'DRAFT') name = 'Draft';
    var on = S.open === t.id;
    var picked = !!S.picked[t.id];
    return '<div class="ml-row' + (t.unread ? ' is-unread' : '') + (on ? ' is-open' : '') + (i === S.sel ? ' is-sel' : '') + (picked ? ' is-picked' : '') + '" data-i="' + i + '" data-id="' + esc(t.id) + '">' +
      '<a class="ml-row__a" href="#/' + (S.q ? 'search/' + encodeURIComponent(S.q) : encodeURIComponent(S.label)) + '/' + encodeURIComponent(t.id) + '" data-open="' + esc(t.id) + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="ml-av' + (picked ? ' is-picked' : '') + '" data-h="' + hue((t.from && t.from.email) || name) + '" data-pick>' + (picked ? ic('check') + '<span class="ml-sr">Selected</span>' : esc(initials(t.from && t.from.email === S.me ? S.name : who(t.from) || name))) + '</span>' +
        '<span class="ml-row__t"><span class="ml-row__l1"><b class="ml-row__who">' + (S.boxes.length ? '<i class="ml-mb" style="background:' + esc(boxColor(t.mb)) + '" title="' + esc(t.mb || S.me) + '"></i>' : '') + esc(name || '(no sender)') + (t.count > 1 ? ' <small>' + t.count + '</small>' : '') + (t.draft && S.label !== 'DRAFT' ? ' <em class="ml-draftword">Draft</em>' : '') + '</b><time>' + esc(when(t.date)) + '</time></span>' +
        '<span class="ml-row__s">' + esc(t.subject || '(no subject)') + '</span>' +
        '<span class="ml-row__p">' + (t.ask ? '<em class="ml-chip ml-chip--sun">Needs you</em> ' : '') + (t.partner && !(S.v === 'cat:partners') ? '<em class="ml-chip ml-chip--leaf">Partner</em> ' : '') + (t.waitDays != null ? '<em class="ml-chip ml-chip--sun">' + ic('clock') + 'Sent ' + (t.waitDays === 1 ? 'yesterday' : t.waitDays + ' days ago') + '</em>' : '') + (t.snoozed ? '<em class="ml-chip ml-chip--sun">' + ic('clock') + esc(when(t.snoozed)) + '</em>' : '') + (t.files ? ic('clip', 'ml-i--sm') : '') + esc(t.snippet || '') + '</span></span>' +
      '</a>' +
      '<button type="button" class="ml-star' + (t.starred ? ' is-on' : '') + '" data-act="star" data-id="' + esc(t.id) + '" aria-pressed="' + (t.starred ? 'true' : 'false') + '" aria-label="' + (t.starred ? 'Remove star' : 'Star') + '">' + ic('star') + '</button>' +
      '<span class="ml-row__hover" aria-hidden="false">' +
        (t.waitDays != null ? '<button type="button" class="ml-iconbtn" data-act="followup" data-id="' + esc(t.id) + '" aria-label="Follow up" title="Follow up">' + ic('reply') + '</button>' : '') +
        '<button type="button" class="ml-iconbtn" data-act="archive" data-id="' + esc(t.id) + '" aria-label="Archive" title="Archive (e)">' + ic('archive') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="delete" data-id="' + esc(t.id) + '" aria-label="Delete" title="Delete (#)">' + ic('trash') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="toggle-read" data-id="' + esc(t.id) + '" aria-label="' + (t.unread ? 'Mark as read' : 'Mark as unread') + '" title="' + (t.unread ? 'Mark as read' : 'Mark as unread') + '">' + ic(t.unread ? 'read' : 'unread') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="snooze" data-id="' + esc(t.id) + '" aria-label="Snooze" title="Snooze">' + ic('clock') + '</button>' +
      '</span></div>';
  }
  function renderList() {
    var rows = $('[data-rows]');
    if (!S.threads.length) {
      var none = S.q ? 'Nothing matches' : activeFlags().length ? 'Nothing matches the filters' : inboxPlain() && S.v === 'needs' ? 'Nothing is waiting on you' : inboxPlain() && S.v === 'waiting' ? 'No sent mail is waiting on a reply' : inboxPlain() && S.v ? 'Nothing in ' + viewName(S.v) : S.label === 'INBOX' ? 'Inbox is empty' : 'No conversations';
      rows.innerHTML = '<div class="ml-empty"><b>' + none + '</b>' + (S.q ? '<span>Gmail search words work here, like from:, has:attachment and before:2026/10/01.</span>' : activeFlags().length ? '<button type="button" class="ml-btn" data-act="flags-clear">Clear filters</button>' : '') + '</div>';
      return;
    }
    rows.innerHTML = notesHtml() + S.threads.map(rowHtml).join('') + (S.next ? '<div class="ml-more"><button type="button" class="ml-btn" data-act="more">Show more</button></div>' : '');
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
    S.threadBox = boxOf(id);
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
    var shown = '';
    // From this device first: the conversation draws in a few milliseconds while Gmail is asked whether anything changed.
    if (!(PRE[id] && Date.now() - PRE[id].at < 90000)) DEV.get(id).then(function (c) {
      if (!c || seq !== threadSeq || shown) return;
      var d0 = c.data; shown = sigOf(d0);
      S.thread = d0.thread; S.partners = d0.partners || {}; S.drafts = d0.drafts || {}; S.headersOnly = false; S.team = null;
      read.innerHTML = threadFrame(d0.thread, false);
      drawBodies();
    });
    neighbors(id);
    return api.thread(id).then(function (d) {
      if (seq !== threadSeq) return;
      S.thread = d.thread; S.partners = d.partners || {}; S.drafts = d.drafts || {}; S.headersOnly = !!d.headersOnly; S.team = d.teamChat && d.teamChat.ok ? d.teamChat : null;
      // Nothing changed since the device copy: leave what is on screen alone.
      if (!shown || shown !== sigOf(d) || S.headersOnly) { read.innerHTML = threadFrame(d.thread, false); drawBodies(); }
      if (S.headersOnly) renderConnect('read');
      var focus = read.querySelector('.ml-thread__h'); if (focus && opts.focus) focus.focus({ preventScroll: true });
      // Opening marks it read, as Gmail does (only with the person's permission to change mail).
      var lt = findThread(id);
      var unread = (d.thread.messages || []).some(function (m) { return m.unread; });
      var counted = (d.thread.messages || []).some(function (m) { return m.unread && isPrimary(m.labelIds); });
      if (unread && S.level.write && canWrite()) {
        api.modify(id, [], ['UNREAD']).then(function () { if (lt) { lt.unread = false; patchRow(lt); } bumpInbox(counted ? -1 : 0); syncSoon(1200); }).catch(function () { /* stays bold */ });
      }
      if (!S.headersOnly && S.level.read) loadAssist(id, seq);
      if (S.pendingReply && S.pendingReply.id === id) { var pr = S.pendingReply; S.pendingReply = null; startReply('reply', null, pr.text); }
    }).catch(function (e) {
      if (seq !== threadSeq) return;
      if (e.code === 'mail_scope' || e.code === 'mail_connect') { read.innerHTML = threadFrame({ id: id, subject: t ? t.subject : '', messages: [] }, false); renderConnect('read'); return; }
      read.querySelector('.ml-thread__msgs').innerHTML = '<div class="ml-empty"><b>This conversation did not open</b><span>' + esc(e.message) + '</span></div>';
    });
  }
  function bumpInbox(d) {
    if (!d) return;
    var inbox = S.labels.filter(function (l) { return l.id === 'INBOX'; })[0];
    if (inbox) { inbox.unread = Math.max(0, inbox.unread + d); renderLabels(); }
    syncSoon(2500);
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
        (window.FavorHandoff ? '<button type="button" class="ml-iconbtn ml-dt" data-act="handoff" aria-label="Hand off" title="Hand this to someone">' + ic('person') + '</button>' : '') +
        '<span class="ml-ext" data-mail-ext></span>' +
        '<button type="button" class="ml-iconbtn" data-act="thread-more" aria-label="More" title="More" aria-haspopup="dialog">' + ic('more') + '</button>' +
      '</span>' +
      '<span class="ml-nav"><button type="button" class="ml-iconbtn ml-dt" data-act="prev" aria-label="Newer conversation" title="Newer (k)">' + ic('up') + '</button><button type="button" class="ml-iconbtn ml-dt" data-act="next" aria-label="Older conversation" title="Older (j)">' + ic('down') + '</button></span>';
    var head = '<div class="ml-thread__top"><h2 class="ml-thread__h" tabindex="-1">' + esc(t.subject || (loading ? '' : '(no subject)')) + '</h2>' +
      '<div class="ml-thread__chips">' + own.map(function (l) { return '<span class="ml-chip">' + esc(labelName(l)) + '</span>'; }).join('') +
      (t.snoozed ? '<span class="ml-chip ml-chip--sun">' + ic('clock') + 'Snoozed until ' + esc(when(t.snoozed, true)) + '</span>' : '') +
      (partner ? '<a class="ml-chip ml-chip--leaf" href="/work/partner/' + encodeURIComponent(partner.id) + '">' + ic('person') + esc(partner.name || 'Partner') + '</a>' : '') +
      '</div></div><div class="ml-assist" data-assist hidden></div>';
    // A draft being written in the composer shows there, not twice.
    var editing = {}; if (window.FavorCompose) window.FavorCompose.list().forEach(function (x) { if (x.draftId) editing[x.draftId] = 1; });
    var shownMsgs = msgs.filter(function (m) { return !(m.draft && editing[S.drafts[m.id]]); });
    var body = loading ? '<div class="ml-msg ml-msg--skel"><span class="ml-av"></span><span class="ml-row__t"><i style="width:40%"></i><i style="width:85%"></i><i style="width:70%"></i></span></div>' : shownMsgs.map(function (m, i) { return msgHtml(m, msgs.indexOf(m), msgs); }).join('');
    var last = msgs.filter(function (m) { return !m.draft; }).slice(-1)[0];
    var foot = !loading && last ? '<div class="ml-sugg" data-sugg hidden></div><div class="ml-inline" data-inline-host></div><div class="ml-thread__foot">' +
      '<button type="button" class="ml-btn" data-act="reply">' + ic('reply') + 'Reply</button>' +
      (replyAllList(last).length > 1 ? '<button type="button" class="ml-btn" data-act="replyall">' + ic('replyall') + 'Reply all</button>' : '') +
      '<button type="button" class="ml-btn" data-act="forward">' + ic('fwd') + 'Forward</button></div>' : '';
    var pbar = '<div class="ml-pbar">' +
      (st.inInbox ? '<button type="button" data-act="archive" aria-label="Archive">' + ic('archive') + '</button>' : '<button type="button" data-act="to-inbox" aria-label="Move to Inbox">' + ic('inbox') + '</button>') +
      '<button type="button" data-act="delete" aria-label="Delete">' + ic('trash') + '</button>' +
      '<button type="button" data-act="labels" aria-label="Labels">' + ic('tag') + '</button>' +
      '<button type="button" data-act="reply-menu" aria-label="Reply, reply all or forward">' + ic('reply') + '</button>' +
      '<button type="button" data-act="compose" aria-label="New message">' + ic('pen') + '</button></div>';
    return '<div class="ml-thread" data-thread="' + esc(t.id) + '"><div class="ml-thread__bar">' + bar + '</div><div class="ml-thread__scroll">' + head + '<div class="ml-thread__msgs" data-brain-context="mail">' + body + '</div>' + foot + '</div>' + pbar + '</div>';
  }
  var money = function (n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); };
  var shortDay = function (iso) { return iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  function loadAssist(id, seq) {
    S.assist = { id: id, summary: '', replies: [], ask: false, card: null, loading: true, gift: null, commitments: [], profile: null, files: {}, answer: '', times: null, major: !!(findThread(id) && findThread(id).major) };
    drawAssist();
    api.assist(id).then(function (a) {
      if (seq !== threadSeq || !S.assist) return;
      S.assist.summary = a.summary || ''; S.assist.replies = a.replies || []; S.assist.ask = !!a.ask; S.assist.loading = false;
      S.assist.gift = a.gift || null; S.assist.commitments = a.commitments || [];
      drawAssist();
    }).catch(function () { if (seq === threadSeq && S.assist) { S.assist.loading = false; drawAssist(); } });
    var p = partnerOf(S.thread);
    if (p && hubAccess().workCenter) api.partner(p.id).then(function (d) { if (seq === threadSeq && S.assist) { S.assist.card = d.partner; drawAssist(); } }).catch(function () { /* the chip above still opens the partner */ });
    var m = (S.thread.messages || []).filter(function (x) { return !x.draft && x.from && x.from.email !== S.me; }).slice(-1)[0];
    if (m) api.sender(m.from.email, m.from.name, boxOf(id)).then(function (d) { if (seq === threadSeq && S.assist) { S.assist.profile = d.profile; drawAssist(); } }).catch(function () { /* no profile line */ });
    // What each file is (Clef reads a picture; a name and the email decide the rest), at most three, quietly.
    var files = []; (S.thread.messages || []).forEach(function (x) { (x.attachments || []).forEach(function (f) { if (!f.inline || !/^image\//.test(f.mime)) files.push({ m: x, f: f }); }); });
    files.slice(0, 3).forEach(function (x) { api.readFile(x.m.id, x.f, S.thread.subject, id).then(function (r) { if (seq === threadSeq && S.assist) { S.assist.files[x.m.id + '|' + x.f.id] = r; drawFileKinds(); } }).catch(function () { /* none */ }); });
  }
  var KIND_NAME = { check: 'Check', receipt: 'Receipt', w9: 'W-9', grant_letter: 'Grant letter', photo: 'Photo', other: '' };
  function drawFileKinds() {
    var a = S.assist; if (!a || !S.thread) return;
    $$('.ml-file').forEach(function (el) {
      var btn = el.querySelector('[data-act="view-file"]'); if (!btn) return;
      var art = el.closest('.ml-msg'); var mid = art && art.dataset.mid;
      var m = msgById(mid); if (!m) return;
      var files = (m.attachments || []).filter(function (f) { return !f.inline || !/^image\//.test(f.mime); });
      var f = files[+btn.dataset.k]; if (!f) return;
      var r = a.files[mid + '|' + f.id]; if (!r || !KIND_NAME[r.kind]) return;
      var old = el.querySelector('.ml-fk'); if (old) old.remove();
      el.insertAdjacentHTML('beforeend', '<span class="ml-fk"><em class="ml-chip">' + esc(KIND_NAME[r.kind]) + '</em>' + (r.next ? (r.next.href ? '<a class="ml-linkbtn" href="' + esc(r.next.href) + '">' + esc(r.next.text) + '</a>' : '<span>' + esc(r.next.text) + '</span>') : '') + '</span>');
    });
  }
  function profileHtml(p, hasCard) {
    if (!p || (hasCard && p.kind === 'partner')) return '';
    var facts = (p.facts || []).map(esc).join('. ');
    return '<div class="ml-prof"><span class="ml-prof__t"><b>' + esc(p.name || p.email) + '</b><span>' + esc(p.role) + '</span>' + (facts ? '<span>' + facts + '.</span>' : '') + '</span>' +
      (p.partner ? '<a class="ml-btn" href="/work/partner/' + encodeURIComponent(p.partner.id) + '">Open partner</a>' : '') +
      (p.canProspect ? '<button type="button" class="ml-btn" data-act="prospect">Add as prospect</button>' : '') + '</div>';
  }
  function giftHtml(a, p) {
    if (!a.gift || !p) return '';
    return '<div class="ml-gift"><b>' + esc(p.name || 'The partner') + ' mentions a ' + money(a.gift.amount) + ' gift</b><span>Nothing is saved until you confirm each step.</span><div class="ml-gift__b"><button type="button" class="ml-btn" data-act="gift-note">Note the expected gift in Blackbaud</button><button type="button" class="ml-btn" data-act="gift-chat">Tell Partner Care in Chat</button></div></div>';
  }
  function commitHtml(a) {
    if (!a.commitments || !a.commitments.length) return '';
    return '<div class="ml-commit"><b>You promised</b>' + a.commitments.map(function (c, i) { return '<div class="ml-commit__i"><span>' + esc(c.text) + (c.due ? ' <em>' + esc(shortDay(c.due)) + '</em>' : '') + '</span><button type="button" class="ml-btn" data-act="commit-task" data-i="' + i + '">Make a task</button></div>'; }).join('') + '</div>';
  }
  function partnerCardHtml(c, p) {
    var holders = (c.holders || []).map(function (h) { return esc(h.name) + (h.type ? ' (' + esc(h.type) + ')' : ''); }).join(', ');
    var cell = function (k, v) { return v ? '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>' : ''; };
    return '<div class="ml-pcard"><div class="ml-pcard__h"><span class="ml-pcard__ic">' + ic('person') + '</span><a href="/work/partner/' + encodeURIComponent(c.id) + '"><b>' + esc(c.name || p.name || 'Partner') + '</b></a>' +
      (c.doNotEmail ? '<em class="ml-chip ml-chip--sun">Do not email</em>' : '') + (S.assist && S.assist.major ? '<em class="ml-chip ml-chip--leaf">Major partner</em>' : '') + '</div><dl class="ml-pcard__g">' +
      cell('Lifetime giving', c.count ? money(c.total) + ' in ' + c.count + (c.count === 1 ? ' gift' : ' gifts') : 'No gifts yet') +
      cell('Last gift', c.last ? money(c.last.amount) + ' on ' + esc(shortDay(c.last.date)) + (c.last.fund ? ', ' + esc(c.last.fund) : '') : '') +
      cell('This year', c.count ? money(c.ytd) : '') + cell('Held by', holders || 'No one assigned') +
      cell('Last contact', c.lastContact ? esc(shortDay(c.lastContact.date)) + (c.lastContact.category ? ', ' + esc(c.lastContact.category) : '') : 'None on record') +
      cell('Open actions', c.openActions ? String(c.openActions) : '') + '</dl>' +
      '<div class="ml-pcard__acts"><a class="ml-btn" href="/work/partner/' + encodeURIComponent(c.id) + '">Open partner</a><button type="button" class="ml-btn" data-act="log-one">' + ic('log') + (S.assist && S.assist.logged ? 'Logged' : 'Log as an action') + '</button><button type="button" class="ml-btn" data-act="timeline">Timeline</button></div><div class="ml-tl" data-tl hidden></div></div>';
  }
  // Move to Chat: a quiet line when every person on the conversation is FavorOS staff with Chat (the server decides, GET threads/:id teamChat).
  function teamHtml() {
    var t = S.team; if (!t || !t.ok || t.state === 'dismissed') return '';
    if (t.state === 'moved') return '<div class="ml-team"><span class="ml-team__t">' + ic('chat') + '<span>This conversation moved to Chat.</span></span><a class="ml-btn" href="' + esc(t.link) + '">Open in Chat</a></div>';
    return '<div class="ml-team"><span class="ml-team__t">' + ic('chat') + '<span>This is a team conversation. Continue in Chat?</span></span><button type="button" class="ml-btn" data-act="team-move">Move to Chat</button><button type="button" class="ml-iconbtn" data-act="team-dismiss" aria-label="Hide this suggestion" title="Hide this suggestion">' + ic('x') + '</button></div>';
  }
  function teamMove(btn) {
    var t = S.thread, tm = S.team; if (!t || !tm || btn.disabled) return;
    var id = t.id; btn.disabled = true; btn.textContent = 'Moving';
    api.moveToChat(id, false).then(function (d) {
      if (S.team) { S.team.state = 'moved'; S.team.link = d.link; S.team.channel = d.channel; }
      if (S.thread && S.thread.id === id) drawAssist();
      var others = (tm.people || []).filter(function (x) { return x.email !== S.me; }).map(function (x) { return x.name || x.email; });
      var el = openSheet('Moved to Chat', '<p class="ml-p">The email history is posted and pinned in Chat with ' + esc(others.join(', ')) + '.</p>' +
        '<label class="ml-menu__i ml-check ml-check--wrap"><input type="checkbox" data-team-note /><span>Post a note in the email thread that this moved to Chat</span></label>' +
        '<div class="ml-sheet__acts"><button type="button" class="ml-btn" data-team-done>Done</button><a class="ml-btn ml-btn--primary" data-team-open href="' + esc(d.link) + '">Open in Chat</a></div>');
      var sent = false;
      var finish = function (then) {
        var want = el.querySelector('[data-team-note]').checked;
        if (!want || sent) return then();
        sent = true;
        api.chatNote(id).then(function () { toast('Note posted in the email thread'); then(); }).catch(function (er) { sent = false; failed(er, 'send'); then(); });
      };
      el.querySelector('[data-team-done]').addEventListener('click', function () { finish(function () { closeSheet(); }); });
      el.querySelector('[data-team-open]').addEventListener('click', function (e) { e.preventDefault(); var href = this.getAttribute('href'); finish(function () { location.href = href; }); });
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Move to Chat';
      if (e && e.code === 'not_team') { S.team = null; drawAssist(); }
      toast(e && e.message ? e.message : 'That did not work. Try again.');
    });
  }
  function teamDismiss() {
    var t = S.thread; if (!t || !S.team) return;
    S.team.state = 'dismissed'; drawAssist();
    api.chatDismiss(t.id).catch(function () { /* hidden for now */ });
  }
  function drawAssist() {
    var a = S.assist, box = $('[data-assist]'), sg = $('[data-sugg]');
    if (!a || !box) return;
    var p = partnerOf(S.thread);
    var html = teamHtml();
    if (a.ask || a.summary) html += '<div class="ml-sum">' + (a.ask ? '<em class="ml-chip ml-chip--sun">' + ic('bolt') + 'Waiting on you</em>' : '') + (a.summary ? '<p><b>In short</b> ' + esc(a.summary) + '</p>' : '') + '</div>';
    if (a.card && p) html += partnerCardHtml(a.card, p);
    html += profileHtml(a.profile, !!(a.card && p)) + giftHtml(a, p) + commitHtml(a);
    html += '<div class="ml-askrow"><label class="ml-askbox">' + ic('q') + '<input data-ask placeholder="Ask about this email" aria-label="Ask about this email" autocomplete="off" maxlength="300" /></label><button type="button" class="ml-btn" data-act="ask-go">Ask</button><button type="button" class="ml-btn" data-act="find-time">' + ic('cal') + 'Find a time</button><button type="button" class="ml-btn" data-act="ask-brain">' + ic('q') + 'Ask Favor Brain</button></div><p class="ml-askcap">Answered by Favor Brain from this email</p>' + (a.answer ? '<div class="ml-answer">' + esc(a.answer) + '</div>' : '');
    var keep = box.querySelector('[data-ask]') ? box.querySelector('[data-ask]').value : '';
    box.innerHTML = html; box.hidden = !html;
    var ai2 = box.querySelector('[data-ask]'); if (ai2 && keep) ai2.value = keep;
    if (sg) {
      sg.hidden = !a.replies.length;
      sg.innerHTML = a.replies.length ? '<b>Suggested replies</b><div class="ml-sugg__l">' + a.replies.map(function (r, i) { return '<button type="button" class="ml-sugg__b" data-act="sugg" data-i="' + i + '">' + esc(r).replace(/\n/g, '<br>') + '</button>'; }).join('') + '</div>' : '';
    }
  }
  function logOne() {
    var p = partnerOf(S.thread), t = S.thread; if (!p || !t || (S.assist && S.assist.logged)) return;
    api.owners().then(function (d) {
      var mine = (d.owners || []).filter(function (o) { return o.fid === d.mine; })[0];
      if (!mine) return logAction(p);
      var m = lastMsg(), date = ET(m && m.date);
      return api.logAction({ owner: mine.fid, date: date, channel: 'email', summary: ('Email: ' + (t.subject || '')).slice(0, 255), tags: [], constituent_ids: [String(p.id)], req: 'mail-' + t.id + '-' + p.id + '-' + date }).then(function (r) {
        api.logged(t.id, p.id).catch(function () { /* the log is in Blackbaud already */ });
        if (S.assist) S.assist.logged = true;
        drawAssist(); toast(r.dups && !r.created ? 'Already logged' : 'Logged on ' + (p.name || 'the partner')); loadOverview();
      });
    }).catch(function (e) { toast(e.message || 'That did not log. Try again.'); });
  }
  function showTimeline() {
    var p = partnerOf(S.thread), box = $('[data-tl]'); if (!p || !box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = '<div class="ml-empty"><span>Loading the timeline</span></div>';
    api.timeline(p.id, p.email, S.open).then(function (d) {
      box.innerHTML = (d.items || []).length ? d.items.map(function (x) { return '<div class="ml-tl__i" data-k="' + esc(x.kind) + '"><time>' + esc(shortDay(x.at)) + '</time><em>' + esc(x.kind) + '</em><span>' + esc(x.text) + '</span></div>'; }).join('') : '<div class="ml-empty"><span>Nothing on record</span></div>';
    }).catch(function (e) { box.innerHTML = '<div class="ml-empty"><span>' + esc(e.message) + '</span></div>'; });
  }
  function giftNote() {
    var p = partnerOf(S.thread), a = S.assist; if (!p || !a || !a.gift) return;
    if (!confirm('Add an action to ' + (p.name || 'the partner') + ' in Blackbaud: expected gift of ' + money(a.gift.amount) + '?')) return;
    api.owners().then(function (d) {
      var mine = (d.owners || []).filter(function (o) { return o.fid === d.mine; })[0] || (d.owners || [])[0];
      if (!mine) throw new Error('Action entry is not open to you.');
      var date = ET();
      return api.logAction({ owner: mine.fid, date: date, channel: 'email', summary: ('Expected gift ' + money(a.gift.amount) + ' (email)').slice(0, 255), tags: [], constituent_ids: [String(p.id)], req: 'mail-gift-' + S.thread.id + '-' + p.id + '-' + date });
    }).then(function () { toast('Expected gift noted on ' + (p.name || 'the partner')); }).catch(function (e) { toast(e.message || 'That did not save.'); });
  }
  function giftChat() {
    var p = partnerOf(S.thread), a = S.assist; if (!p || !a || !a.gift) return;
    api.chatBoot().then(function (d) {
      var chans = (d.channels || []).filter(function (c) { return /partner.?care/i.test(c.name || ''); });
      if (!chans.length) { toast('No Partner Care channel to post in. Use Send to Chat.'); return; }
      var ch = chans[0];
      if (!confirm('Post in #' + ch.name + ': ' + (p.name || 'A partner') + ' mentions a ' + money(a.gift.amount) + ' gift?')) return;
      return api.chatSend(ch.id, (p.name || 'A partner') + ' emailed about a ' + money(a.gift.amount) + ' gift. Expect it. I have it from here.').then(function () { toast('Partner Care told'); });
    }).catch(function (e) { toast(e.message || 'That did not post.'); });
  }
  function commitTask(i) {
    var a = S.assist, c = a && a.commitments[i], t = S.thread; if (!c) return;
    var b = { title: c.text.slice(0, 200), description: 'From my email "' + (t.subject || '') + '"\n\n' + location.origin + '/mail/' + hashFor(S.label, S.q, t.id), owner_email: S.me };
    if (c.due) b.due_date = c.due;
    api.task(b).then(function (d) { toast('Task made' + (d.task && d.task.code ? ' ' + d.task.code : '')); a.commitments.splice(i, 1); drawAssist(); }).catch(function (er) { toast(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message); });
  }
  function askAbout() {
    var inp = $('[data-ask]'), a = S.assist; if (!inp || !a || inp.value.trim().length < 3) return;
    a.answer = 'Reading the conversation'; drawAssist();
    api.ask(S.open, inp.value.trim()).then(function (d) { a.answer = d.answer; drawAssist(); }).catch(function (e) { a.answer = e.message; drawAssist(); });
  }
  function addProspect() {
    var pr = S.assist && S.assist.profile, t = S.thread; if (!pr) return;
    if (!confirm('Make a task for Support to add ' + (pr.name || pr.email) + ' as a prospect in Blackbaud?')) return;
    api.task({ title: 'Add ' + (pr.name || pr.email) + ' as a prospect in Blackbaud', description: 'Email ' + pr.email + '. From my email "' + (t.subject || '') + '"\n\n' + location.origin + '/mail/' + hashFor(S.label, S.q, t.id), owner_email: S.me }).then(function () { toast('Task made'); }).catch(function (er) { toast(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message); });
  }
  function categoriesSheet() {
    var body = function () { return '<p class="ml-p">Describe what belongs in a category. Mail reads each new email against your words, and Move to category teaches it by sender.</p><div class="ml-menu">' + (S.customs.length ? S.customs.map(function (c) { return '<div class="ml-menu__i ml-mrow"><span><b>' + esc(c.name) + '</b><br><small>' + esc(c.description) + '</small></span><button type="button" class="ml-btn" data-delcat="' + esc(c.id) + '">Remove</button></div>'; }).join('') : '<p class="ml-p">None yet.</p>') + '</div><form class="ml-form" data-catf><label>Name<input class="ml-input" name="name" maxlength="40" required placeholder="Trips" /></label><label>What belongs in it<textarea class="ml-input" name="description" rows="3" maxlength="300" required placeholder="Anything about a mission trip, a visit or travel plans"></textarea></label><div class="ml-sheet__acts"><button type="submit" class="ml-btn ml-btn--primary">Add category</button></div></form>'; };
    var el = openSheet('Categories in your words', body());
    var redraw = function () { el.querySelector('.ml-sheet__body').innerHTML = body(); };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-delcat]'); if (!b) return;
      api.dropCategory(b.dataset.delcat).then(function () { S.customs = S.customs.filter(function (c) { return c.id !== b.dataset.delcat; }); redraw(); renderTabs(); loadOverview(); if (S.v === 'cat:' + b.dataset.delcat) go('INBOX', '', ''); }).catch(failed);
    });
    el.addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target;
      api.newCategory(f.name.value.trim(), f.description.value.trim()).then(function (d) { S.customs.push(d.category); redraw(); renderTabs(); toast('Category added. Mail reads your inbox against it now.'); loadOverview(); }).catch(function (er) { toast(er.message); });
    });
  }
  function slotLabel(iso) { return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'; }
  function findTime() {
    var t = S.thread; if (!t) return;
    var guests = []; (t.messages || []).forEach(function (m) { [m.from].concat(m.to || [], m.cc || []).forEach(function (x) { if (x && /@favorintl\.org$/.test(x.email) && x.email !== S.me && guests.indexOf(x.email) < 0) guests.push(x.email); }); });
    var el = openSheet('Find a time', '<div class="ml-empty"><span>Reading calendars</span></div>');
    var draw = function (d) {
      var slots = d.slots || [];
      el.querySelector('.ml-sheet__body').innerHTML = (slots.length ? '<p class="ml-p">Free for you' + (d.guests.length ? ' and ' + d.guests.length + ' on staff' : '') + ', weekdays 9 to 5 Eastern.' + (d.note ? ' ' + esc(d.note) + '.' : '') + '</p><div class="ml-menu">' + slots.map(function (x, i) { return '<label class="ml-menu__i ml-check"><input type="checkbox" data-slot="' + i + '" /><span>' + esc(slotLabel(x)) + '</span></label>'; }).join('') + '</div><div class="ml-sheet__acts"><button type="button" class="ml-btn" data-slots-reply>Put in my reply</button>' + (guests.length === 0 || true ? '<button type="button" class="ml-btn ml-btn--primary" data-slots-book>Book the first one checked</button>' : '') + '</div>' : '<p class="ml-p">No free time in the next week.</p>');
      el._slots = slots;
    };
    api.times({ guests: guests, minutes: 30, days: 10 }).then(draw).catch(function (e) { el.querySelector('.ml-sheet__body').innerHTML = '<p class="ml-p">' + esc(e.message) + '</p>'; });
    el.addEventListener('click', function (e) {
      var picked = $$('[data-slot]', el).filter(function (c) { return c.checked; }).map(function (c) { return el._slots[+c.dataset.slot]; });
      if (e.target.closest('[data-slots-reply]')) {
        if (!picked.length) return toast('Check at least one time');
        var text = 'Here are times that work for me (Eastern):\n' + picked.map(function (x) { return slotLabel(x).replace(' ET', ''); }).join('\n') + '\n\nTell me which one suits you.';
        closeSheet(null, function () { startReply('reply', null, text); });
      }
      if (e.target.closest('[data-slots-book]')) {
        if (!picked.length) return toast('Check a time');
        if (!guests.length) return toast('Book needs staff on the email. Put the times in your reply.');
        if (!confirm('Book a FavorOS meeting "' + (t.subject || 'Meeting') + '" at ' + slotLabel(picked[0]) + ' and invite ' + guests.join(', ') + '?')) return;
        api.meetCreate({ title: (t.subject || 'Meeting').slice(0, 140), startsAt: picked[0], durationMin: 30, invitees: guests.map(function (g) { return { email: g }; }), access: 'invited' }).then(function () { closeSheet(); toast('Meeting booked and invited'); }).catch(function (er) { toast(er.message); });
      }
    });
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
      // One row per message: who and when on the left, then the same four actions on every open message (star, reply, reply all
      // or forward, more), aligned on the right as in Gmail.
      '<div class="ml-msg__head">' +
      '<button type="button" class="ml-msg__tog" data-act="toggle-msg" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="ml-av" data-h="' + hue((m.from || {}).email || '') + '">' + esc(initials(m.from && m.from.email === S.me ? S.name : who(m.from))) + '</span>' +
        '<span class="ml-msg__who"><span class="ml-msg__l1"><b>' + esc(m.draft ? 'Draft' : who(m.from) || '(no sender)') + '</b>' + (open && m.from && m.from.name ? '<small>' + esc(m.from.email) + '</small>' : '') + '</span>' +
          '<span class="ml-msg__l2">' + (open ? esc(recipLine(m)) : esc(m.snippet || '')) + '</span></span>' +
        '<time datetime="' + esc(m.date) + '" title="' + esc(when(m.date, true)) + '">' + esc(when(m.date)) + '</time>' +
      '</button>' +
      (open && !m.draft ? '<span class="ml-msg__tools">' +
        '<button type="button" class="ml-iconbtn ml-star' + (threadTools().starred ? ' is-on' : '') + '" data-act="star" aria-pressed="' + (threadTools().starred ? 'true' : 'false') + '" aria-label="' + (threadTools().starred ? 'Remove star' : 'Star') + '" title="Star (s)">' + ic('star') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="reply-one" aria-label="Reply" title="Reply (r)">' + ic('reply') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="msg-more" aria-label="More for this message" title="Reply all, forward" aria-haspopup="dialog">' + ic('more') + '</button>' +
      '</span>' : '') +
      '</div>' +
      (open ? '<div class="ml-msg__body">' +
        (p ? '<a class="ml-partner" href="/work/partner/' + encodeURIComponent(p.id) + '">' + ic('person') + '<span>' + esc(p.name || 'Partner') + '</span><em>Partner in Blackbaud</em></a>' : '') +
        (S.headersOnly ? '<div class="ml-hdronly">' + esc(m.snippet || '') + '</div>' : '<div class="ml-frame" data-frame></div>') +
        (files.length ? '<div class="ml-files">' + files.map(function (f, k) { return fileCard(m, f, k); }).join('') + '</div>' : '') +
        (m.draft ? '<div class="ml-msg__acts"><button type="button" class="ml-btn ml-btn--primary" data-act="edit-draft">' + ic('pen') + 'Edit draft</button><button type="button" class="ml-btn" data-act="drop-draft">' + ic('trash') + 'Discard</button></div>' : '') +
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
      '<base target="_blank"><style>html,body{margin:0;padding:0;background:transparent}body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:#1d211b;overflow-wrap:anywhere;word-break:break-word;display:flow-root}' +
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
    threadHooks(t);
  }
  /* Once per drawn conversation: the composer learns where this conversation's inline reply goes (a reply being written comes
     back into place), and other FavorOS parts get the toolbar slot (event favor-mail:thread). */
  function threadHooks(t) {
    var th = root.querySelector('.ml-thread[data-thread]');
    if (!th || th.dataset.hooked === t.id) return;
    th.dataset.hooked = t.id;
    var host = th.querySelector('[data-inline-host]');
    if (host && window.FavorCompose) window.FavorCompose.host(t.id, host);
    var people = {}; (t.messages || []).forEach(function (m) { [m.from].concat(m.to || [], m.cc || []).forEach(function (a) { if (a && a.email) people[a.email] = a.name || people[a.email] || ''; }); });
    var slot = th.querySelector('[data-mail-ext]');
    try { window.dispatchEvent(new CustomEvent('favor-mail:thread', { detail: { threadId: t.id, subject: t.subject || '', mb: S.threadBox || '', participants: Object.keys(people).map(function (e) { return { email: e, name: people[e] }; }), el: slot } })); } catch (e) { /* old browser */ }
  }
  /* Hover cards for what a message mentions: appeal codes, Lookup IDs and fund names. A shared module (window.FavorEntity) takes
     over when the app has one; until then this adapter asks /api/mail/entity. */
  var ENT_RE = /\b[A-Z]\d{2}[0-9A-C]-[A-Z0-9]{1,14}\b|\b(?:Lookup ID|lookup id|Constituent ID|ID)\s*[:#]?\s*(\d{3,7})\b/g;
  var entCache = {};
  var Entity = {
    card: function (kind, key) {
      var k = kind + '|' + key;
      if (entCache[k]) return entCache[k];
      // Appeal codes, and partners by system id, come from the shared FavorEntity module (/api/hub/entity). Lookup IDs and fund names
      // are still looked up by Mail, because the shared module takes system ids.
      if (kind === 'appeal' && !MOCK && window.FavorEntity && window.FavorEntity.load) {
        entCache[k] = window.FavorEntity.load('appeal', key).then(function (it) {
          if (!it || it.restricted) return null;
          return { kind: kind, key: key, title: it.title, sub: it.sub, lines: (it.facts || []).map(function (f) { return { k: f.k, v: f.v }; }), href: it.url || '' };
        }).catch(function () { return null; });
        return entCache[k];
      }
      entCache[k] = api.entity(kind, key).then(function (d) { return d.card; }).catch(function () { return null; });
      return entCache[k];
    }
  };
  function markEntities(d) {
    if (!d || !d.body || d.body.dataset.fosEnt) return;
    d.body.dataset.fosEnt = '1';
    var fundRe = S.names && S.names.length ? new RegExp('\\b(' + S.names.slice(0, 200).map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'g') : null;
    var walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentElement && !n.parentElement.closest('a,script,style,.fos-ent') && /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.slice(0, 400).forEach(function (n) {
      var text = n.nodeValue, hits = [], m;
      ENT_RE.lastIndex = 0;
      while ((m = ENT_RE.exec(text))) hits.push({ i: m.index, t: m[0], k: m[1] ? 'lookup' : 'appeal', q: m[1] || m[0] });
      if (fundRe) { fundRe.lastIndex = 0; while ((m = fundRe.exec(text))) hits.push({ i: m.index, t: m[0], k: 'fund', q: m[0] }); }
      if (!hits.length) return;
      hits.sort(function (a, b) { return a.i - b.i; });
      var frag = d.createDocumentFragment(), at = 0;
      hits.forEach(function (h) {
        if (h.i < at) return;
        frag.appendChild(d.createTextNode(text.slice(at, h.i)));
        var sp = d.createElement('span'); sp.className = 'fos-ent'; sp.dataset.k = h.k; sp.dataset.q = h.q; sp.textContent = h.t; frag.appendChild(sp);
        at = h.i + h.t.length;
      });
      frag.appendChild(d.createTextNode(text.slice(at)));
      n.parentNode.replaceChild(frag, n);
    });
    var st = d.createElement('style'); st.textContent = '.fos-ent{border-bottom:1px dotted #235578;cursor:help}'; d.head.appendChild(st);
  }
  var tipCard = null, tipT = 0;
  function entCardHtml(c) { return '<b>' + esc(c.title) + '</b><span>' + esc(c.sub || '') + '</span>' + (c.lines || []).map(function (l) { return '<div><small>' + esc(l.k) + '</small> ' + esc(l.v) + '</div>'; }).join(''); }
  function bindEntities(f, d) {
    d.addEventListener('mouseover', function (e) {
      var el = e.target.closest && e.target.closest('.fos-ent'); if (!el) return;
      clearTimeout(tipT);
      tipT = setTimeout(function () {
        Entity.card(el.dataset.k, el.dataset.q).then(function (c) {
          if (!c) return;
          if (!tipCard) { tipCard = document.createElement('div'); tipCard.className = 'ml-ent'; document.body.appendChild(tipCard); }
          tipCard.innerHTML = entCardHtml(c) + '<small class="ml-ent__more">Press for details</small>';
          var fr = f.getBoundingClientRect(), r = el.getBoundingClientRect();
          tipCard.hidden = false;
          tipCard.style.left = Math.max(8, Math.min(innerWidth - 300, fr.left + r.left)) + 'px';
          tipCard.style.top = Math.min(innerHeight - 170, fr.top + r.bottom + 6) + 'px';
        });
      }, 250);
    });
    d.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.fos-ent')) { clearTimeout(tipT); if (tipCard) tipCard.hidden = true; } });
    d.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('.fos-ent'); if (!el) return;
      e.preventDefault();
      Entity.card(el.dataset.k, el.dataset.q).then(function (c) {
        if (!c) return;
        if (tipCard) tipCard.hidden = true;
        openSheet(c.title, '<div class="ml-ent-side">' + entCardHtml(c) + (c.href ? '<div class="ml-sheet__acts"><a class="ml-btn ml-btn--primary" href="' + esc(c.href) + '">Open</a></div>' : '') + '</div>', { wide: false });
      });
    });
  }
  /* Sizes a message frame to its content. The frame never scrolls on its own, so its height must always cover the message:
     it is measured again when the reading pane changes width, when images and fonts arrive, and when quoted text opens.
     A very long message stops at 2,400 px with "Show the whole message", as Gmail clips long mail. */
  var LONG_PX = 3200;
  function fitFrame(f, box, fold) {
    var d; try { d = f.contentDocument; } catch (e) { return; }
    if (!d || !d.body) return;
    var lastW = -1, useScroll = false;
    var fit = function () {
      var w = box.clientWidth;
      if (!w) return;
      if (w !== lastW) {
        lastW = w;
        d.body.style.zoom = '';
        var sw = d.documentElement.scrollWidth;
        if (sw > w + 4) { d.body.style.zoom = String(Math.max(0.4, w / sw)); useScroll = true; }
      }
      // The body's own box gives the height (so the frame can also shrink when quoted text folds). Content that sits outside
      // the body box, or a zoomed body, switches this frame to the document's scroll height for good, so the two never flip.
      var cur = f.clientHeight, over = d.documentElement.scrollHeight, rectH = Math.ceil(d.body.getBoundingClientRect().height);
      if (!useScroll && over > Math.max(cur, rectH) + 1) useScroll = true;
      var h = useScroll ? over : rectH;
      if (Math.abs(h - cur) > 1) f.style.height = h + 'px';
      if (h > LONG_PX && !box._full && !box._long) {
        box._long = 1;
        box.classList.add('is-long');
        box.insertAdjacentHTML('beforeend', '<button type="button" class="ml-longbtn" data-act="show-long">Show the whole message</button>');
      }
    };
    box._fit = fit;
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
    if (S.level.read && !S.headersOnly) { markEntities(d); bindEntities(f, d); }
    d.querySelectorAll('img').forEach(function (im) { if (!im.complete) { im.addEventListener('load', fit); im.addEventListener('error', fit); } });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(fit).catch(function () {});
    setTimeout(fit, 400); setTimeout(fit, 1500);
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { requestAnimationFrame(fit); }); ro.observe(d.body); ro.observe(box); }
    // A selection inside the message reaches the page (Ask Favor Brain about the selected words).
    var selT = 0;
    d.addEventListener('selectionchange', function () {
      clearTimeout(selT);
      selT = setTimeout(function () {
        var sel = d.getSelection(), text = sel && sel.rangeCount ? String(sel).trim() : '', rect = null;
        if (text) { var fr = f.getBoundingClientRect(), r = sel.getRangeAt(0).getBoundingClientRect(), z = parseFloat(d.body.style.zoom) || 1; rect = { left: fr.left + r.left * z, top: fr.top + r.top * z, right: fr.left + r.right * z, bottom: fr.top + r.bottom * z, width: r.width * z, height: r.height * z }; }
        try { window.dispatchEvent(new CustomEvent('favor-mail-selection', { detail: { text: text.slice(0, 4000), rect: rect } })); } catch (e) { /* old browser */ }
      }, 120);
    });
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
  // A conversation that changed (a draft saved, discarded or sent) is read again from Gmail, never from the copies kept here.
  function forgetThread(id) { if (!id) return; delete PRE[id]; DEV.drop(id); }
  // The shared composer sent or scheduled something: the conversation or the Sent list shows it.
  addEventListener('favor-compose:sent', function (e) {
    if (!root.isConnected) return;
    var d = e.detail || {};
    forgetThread(d.threadId);
    setTimeout(function () {
      if (S.open && d.threadId === S.open) openThread(S.open);
      else if (S.label === 'SENT' || S.label === 'DRAFT') loadList({ quiet: true });
    }, 600);
  });
  addEventListener('favor-compose:draft', function (e) { forgetThread((e.detail || {}).threadId); if (root.isConnected && S.label === 'DRAFT' && !S.open) loadList({ quiet: true }); });
  // A discarded draft leaves the conversation and the Drafts list at once.
  addEventListener('favor-compose:discarded', function (e) {
    if (!root.isConnected) return;
    var d = e.detail || {};
    forgetThread(d.threadId);
    if (S.open && d.threadId === S.open) openThread(S.open);
    else if (S.label === 'DRAFT') loadList({ quiet: true });
  });
  // Another part of FavorOS asks for a reply in this conversation with something in it (a clip, a Brain answer).
  addEventListener('favor-mail:reply', function (e) {
    var d = e.detail || {};
    if (!root.isConnected || !S.thread || (d.threadId && d.threadId !== S.thread.id)) return;
    startReply(d.kind || 'reply', null, null, false, d.items || []);
  });

  /* ------------------------------------------------------------------ routing (#/LABEL[/thread], #/search/words[/thread]) */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    var tk = function (x) { var i = String(x || '').indexOf('~'); return i < 0 ? { id: x || '', box: '' } : { id: x.slice(0, i), box: x.slice(i + 1) }; };
    if (parts[0] === 'search') { var t0 = tk(parts[2]); return { label: 'ALL', q: parts[1] || '', thread: t0.id, box: t0.box, v: '' }; }
    var v = unslug(parts[0]);
    var t1 = tk(parts[1]);
    if (v) return { label: 'INBOX', q: '', thread: t1.id, box: t1.box, v: v };
    return { label: parts[0] || 'INBOX', q: '', thread: t1.id, box: t1.box, v: '' };
  }
  function hashFor(label, q, tid, v) {
    if (v === undefined) v = label === 'INBOX' && S.label === 'INBOX' && !q ? S.v : '';
    return '#/' + (q ? 'search/' + encodeURIComponent(q) : label === 'INBOX' && v ? slugOf(v) : encodeURIComponent(label || 'INBOX')) + (tid ? '/' + encodeURIComponent(tid) : '');
  }
  function go(label, q, tid, replace) {
    if (tid && String(tid).indexOf('~') < 0 && S.mbOf[tid]) tid = tid + '~' + S.mbOf[tid];
    var h = hashFor(label, q, tid);
    if (location.hash === h) return route();
    if (replace) { history.replaceState(history.state, '', h); route(); }
    else location.hash = h;
  }
  function route() {
    var r = parseHash();
    var listChanged = r.label !== S.label || r.q !== S.q || r.v !== S.v || (!S.threads.length && !S.loading);
    S.label = r.label; S.q = r.q; S.v = r.v;
    if (listChanged) { S.sel = -1; renderLabels(); loadList(); }
    if (r.thread && (r.box || S.mbOf[r.thread] == null)) S.mbOf[r.thread] = r.box || '';
    if (r.thread) { if (r.thread !== S.open || S.view !== 'thread') openThread(r.thread); }
    else { S.open = ''; S.thread = null; setView('list'); $$('.ml-row.is-open').forEach(function (x) { x.classList.remove('is-open'); }); if (!isPhone()) $('[data-read]').innerHTML = emptyRead(); }
  }
  function emptyRead() { return '<div class="ml-read__empty">' + ic('unread') + '<span>' + (S.threads.length ? 'Pick a conversation' : '') + '</span></div>'; }
  addEventListener('hashchange', function () { route(); });
  // The hub reloads the page on any Back step it does not own. Mail owns every step on this page (a conversation, a sheet, the
  // message window), so this listener runs first and keeps the hub out of it, unless one of the hub's own panels is open.
  window.addEventListener('popstate', function (e) {
    if (!root.isConnected || window.__hubOvHandled || (window.hubOv && ((window.hubOv.depth && window.hubOv.depth()) || (window.hubOv.busy && window.hubOv.busy())))) return;
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
      var wasUnread = t && t.unread && isPrimary(t.labelIds);
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
      if (S.thread && S.thread.id === id) { S.thread.messages.forEach(function (m) { m.starred = on; m.labelIds = on ? m.labelIds.concat(['STARRED']) : m.labelIds.filter(function (l) { return l !== 'STARRED'; }); }); $$('.ml-thread .ml-star').forEach(function (hs) { hs.classList.toggle('is-on', on); hs.setAttribute('aria-pressed', on ? 'true' : 'false'); hs.setAttribute('aria-label', on ? 'Remove star' : 'Star'); }); }
      api.modify(id, on ? ['STARRED'] : [], on ? [] : ['STARRED']).catch(function (e) { if (t) { t.starred = !on; patchRow(t); } failed(e); });
      return;
    }
    if (kind === 'unread' || kind === 'read' || kind === 'toggle-read') {
      var makeUnread = kind === 'unread' || (kind === 'toggle-read' && (S.open === id || !(t && t.unread)));
      if (t) { t.unread = makeUnread; patchRow(t); }
      api.modify(id, makeUnread ? ['UNREAD'] : [], makeUnread ? [] : ['UNREAD']).then(function () {
        if (t ? isPrimary(t.labelIds) : threadTools().inInbox) bumpInbox(makeUnread ? 1 : -1);
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
    var pp = partnerOf(S.thread);
    var waits = '<button type="button" class="ml-menu__i" data-snzw="reply">' + ic('reply') + '<span>Until they reply</span></button>' + (pp ? '<button type="button" class="ml-menu__i" data-snzw="gift">' + ic('person') + '<span>Until their next gift</span><small>' + esc(pp.name) + '</small></button>' : '');
    var el = openSheet('Snooze until', waits + '<div class="ml-menu">' + opts.map(function (o, k) { return '<button type="button" class="ml-menu__i" data-snz="' + k + '">' + ic('clock') + '<span>' + esc(o[0]) + '</span><small>' + esc(o[1].toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small></button>'; }).join('') +
      '<div class="ml-menu__pick"><label for="ml-snz-at">Pick a date and time</label><input id="ml-snz-at" type="datetime-local" class="ml-input" /><button type="button" class="ml-btn ml-btn--primary" data-snz="pick">Snooze</button></div></div>', { anchor: anchor });
    el.addEventListener('click', function (e) {
      var w = e.target.closest('[data-snzw]');
      if (w) {
        closeSheet();
        var tw = findThread(id), wu = tw && tw.unread && isPrimary(tw.labelIds);
        var goneW = S.label === 'INBOX' ? removeFromList(id) : null;
        afterLeave(id);
        if (wu) bumpInbox(-1);
        api.snoozeWait(id, w.dataset.snzw, pp ? pp.id : '').then(function () { toast(w.dataset.snzw === 'reply' ? 'Back in your inbox when they reply' : 'Back in your inbox at their next gift', function () { api.unsnooze(id).then(function () { putBack(goneW); if (wu) bumpInbox(1); }).catch(failed); }); }).catch(function (er) { putBack(goneW); if (wu) bumpInbox(1); failed(er, 'snooze'); });
        return;
      }
      var b = e.target.closest('[data-snz]'); if (!b) return;
      var until = b.dataset.snz === 'pick' ? new Date(el.querySelector('#ml-snz-at').value) : opts[+b.dataset.snz][1];
      if (!until || !isFinite(until.getTime()) || until < new Date()) { toast('Pick a time later than now'); return; }
      closeSheet();
      var t = findThread(id), wasUnread = t && t.unread && isPrimary(t.labelIds);
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
        api.newLabel(name, S.threadBox).then(function (d) { S.labels.push(d.label); renderLabels(); labelsMenu(id, anchor); var cb = document.querySelector('.ml-sheet [data-lab="' + CSS.escape(d.label.id) + '"]'); if (cb) cb.checked = true; }).catch(failed);
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
    var us = ((t.messages || []).filter(function (m) { return m.unsubscribe && (m.unsubscribe.url || m.unsubscribe.mailto); }).slice(-1)[0] || {}).unsubscribe;
    if (us) items.push(['unsub', 'x', 'Unsubscribe', us.url ? 'Opens the sender\'s page' : 'Sends the sender an email']);
    items.push(['find-time', 'cal', 'Find a time', 'From your calendar']);
    items.push(['assign', 'person', 'Assign to a teammate', 'Chat notice with a note']);
    items.push(['mention', 'chat', 'Mention a coworker', 'Chat notice with a note']);
    items.push(['request', 'task', 'Make a request', 'On the request board']);
    items.push(['ask-brain', 'q', 'Ask Favor Brain', 'About this email']);
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
      if (k === 'unsub') return closeSheet(null, unsubscribe);
      if (k === 'find-time') return closeSheet(null, findTime);
      if (k === 'assign' || k === 'mention' || k === 'request') return closeSheet(null, function () { handOff(k); });
      if (k === 'ask-brain') return askBrain();
      closeSheet(null, function () {
        if (k === 'open-partner') location.href = '/work/partner/' + encodeURIComponent(p.id);
        else if (k !== 'gmail') act(k);
      });
    });
  }
  // Assign, mention and request: pick a person (assign, mention) and write a note; nothing goes until the button is pressed.
  function handOff(kind) {
    var t = S.thread; if (!t) return;
    var title = kind === 'assign' ? 'Assign to a teammate' : kind === 'mention' ? 'Mention a coworker' : 'Make a request';
    var who = '';
    var pickBox = kind === 'request' ? '<label>Where it lands<select class="ml-input" name="surface"><option value="dashboard">FavorOS</option><option value="website">Website</option><option value="portal">Portal</option><option value="app">App</option></select></label>' : '<label>Who<input class="ml-input" name="who" autocomplete="off" placeholder="Start typing a name" /></label><div class="ml-pick" data-who-res></div><p class="ml-p" data-who-sel></p>';
    var go2 = kind === 'assign' ? 'Assign' : kind === 'mention' ? 'Tell them' : 'Make the request';
    var el = openSheet(title, '<form class="ml-form" data-hof>' + pickBox + '<label>Note<textarea class="ml-input" name="note" rows="3" maxlength="600" placeholder="' + (kind === 'request' ? 'What needs to change' : 'What you need from them') + '"></textarea></label><p class="ml-p">' + (kind === 'request' ? 'The request goes on the board as you, with the email\'s subject, sender and preview.' : 'They get a Chat message with the subject, sender, a one line preview and your note. They cannot open your mailbox.') + '</p><div class="ml-sheet__acts"><button type="submit" class="ml-btn ml-btn--primary">' + go2 + '</button></div></form>');
    var res = el.querySelector('[data-who-res]'), sel = el.querySelector('[data-who-sel]'), inp = el.querySelector('[name="who"]'), tt = 0;
    var chosen = [];
    if (inp) inp.addEventListener('input', function () {
      clearTimeout(tt); var q = inp.value.trim(); if (q.length < 2) { res.innerHTML = ''; return; }
      tt = setTimeout(function () {
        api.contacts(q).then(function (d) {
          var list = (d.people || []).filter(function (x) { return x.kind === 'staff' && x.email !== S.me; }).slice(0, 6);
          res.innerHTML = list.map(function (x, i) { return '<button type="button" class="ml-menu__i" data-staff="' + esc(x.email) + '"><span>' + esc(x.name || x.email) + '</span><small>' + esc(x.title || '') + '</small></button>'; }).join('') || '<div class="ml-empty"><span>No one on staff by that name</span></div>';
        }).catch(function () { res.innerHTML = ''; });
      }, 160);
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-staff]'); if (!b) return;
      if (kind === 'assign') chosen = [b.dataset.staff]; else if (chosen.indexOf(b.dataset.staff) < 0) chosen.push(b.dataset.staff);
      sel.textContent = (kind === 'assign' ? 'To ' : 'Telling ') + chosen.join(', ');
      inp.value = ''; res.innerHTML = '';
    });
    el.addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target, note = f.note.value.trim(), btn = f.querySelector('[type=submit]');
      if (kind !== 'request' && !chosen.length) return toast('Pick someone first');
      btn.disabled = true;
      var job = kind === 'assign' ? api.assign(t.id, chosen[0], note) : kind === 'mention' ? api.mention(t.id, chosen, note) : api.makeRequest(t.id, note, f.surface.value);
      job.then(function (d) {
        closeSheet();
        toast(kind === 'assign' ? 'Assigned to ' + (d.name || chosen[0]) : kind === 'mention' ? 'Told ' + (d.told || []).length + (((d.told || []).length === 1) ? ' person' : ' people') : 'Request made', kind === 'request' ? null : null);
        if (kind === 'request' && d.url) setTimeout(function () { toast('Request on the board: ' + d.url); }, 0);
      }).catch(function (er) { btn.disabled = false; toast(er.message); });
    });
  }
  function assignedList() {
    var el = openSheet('Assigned to teammates', '<div class="ml-empty"><span>Loading</span></div>');
    api.assigned().then(function (d) {
      var l = d.assigned || [];
      el.querySelector('.ml-sheet__body').innerHTML = l.length ? '<div class="ml-menu">' + l.map(function (x) { return '<div class="ml-menu__i ml-mrow"><span><b>' + esc(x.subject || '(no subject)') + '</b><br><small>' + esc(x.name) + (x.note ? ': ' + esc(x.note) : '') + ', ' + esc(shortDay(x.at)) + '</small></span>' + (x.state === 'open' ? '<button type="button" class="ml-btn" data-adone="' + esc(x.id) + '">Done</button>' : '<small>Done</small>') + '</div>'; }).join('') + '</div>' : '<p class="ml-p">Nothing assigned yet.</p>';
    }).catch(failed);
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-adone]'); if (!b) return; api.assignedDone(b.dataset.adone).then(function () { b.replaceWith(document.createTextNode('Done')); }).catch(failed); });
  }
  // Favor Brain with this email as the question's background, opened as a new chat.
  function askBrain(q) {
    var t = S.thread, m = lastMsg(); if (!t) return;
    var inp = $('[data-ask]');
    var text = (q || (inp && inp.value.trim()) || 'What should I do about this email?') + '\n\nThe email: "' + (t.subject || '') + '" from ' + who(m && m.from) + ' on ' + when(m && m.date, true) + '. ' + String((m && m.snippet) || '').slice(0, 300);
    window.open('/brain/?ask=' + encodeURIComponent(text.slice(0, 590)), '_blank', 'noopener');
  }
  function unsubscribe() {
    var t = S.thread; if (!t) return;
    var m = (t.messages || []).filter(function (x) { return x.unsubscribe && (x.unsubscribe.url || x.unsubscribe.mailto); }).slice(-1)[0];
    if (!m) return toast('This sender gave no unsubscribe address');
    var u = m.unsubscribe;
    if (u.url) { window.open(u.url, '_blank', 'noopener'); }
    else {
      var addr = u.mailto.replace(/^mailto:/i, '').split('?')[0];
      if (!confirm('Send an unsubscribe email to ' + addr + '?')) return;
      api.send({ to: [{ email: addr, name: '' }], subject: 'unsubscribe', html: '<p>unsubscribe</p>', mb: S.threadBox }).then(function () { toast('Unsubscribe sent'); }).catch(failed);
    }
    act('archive');
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
        .then(function (d) { closeSheet(); api.logged(t.id, p.id).catch(function () {}); if (S.assist) { S.assist.logged = true; drawAssist(); } loadOverview(); toast(d.dups && !d.created ? 'Already logged' : 'Logged on ' + (p.name || 'the partner')); })
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
  function replyBody(text) {
    return '<div>' + esc(text).replace(/\n/g, '<br>') + '</div><div><br></div>' + (S.signature ? '<br><div class="gmail_signature">' + S.signature + '</div>' : '');
  }
  // Replies open inline under the conversation (Shift or "Reply in a new window" pops them out); the shared composer
  // (public/js/compose/compose.js) runs them. Without it, the older window below still works.
  function startReply(kind, m, text, pop, items) {
    if (!S.level.write || !canWrite()) return askWrite('reply');
    m = m || lastMsg(); if (!m) return;
    var t = S.thread;
    var where = { inline: !pop, kind: kind === 'forward' ? 'fwd' : 'reply', items: items };
    if (kind === 'forward') {
      return openCompose({ subject: reSubject(m.subject || t.subject, 'Fwd'), quote: fwdHtml(m), forward: (m.attachments || []).filter(function (f) { return !f.inline; }).map(function (f) { return { messageId: m.id, attachmentId: f.id, name: f.name, mime: f.mime, size: f.size }; }), title: 'Forward', threadId: t.id, mb: S.threadBox }, where);
    }
    var all = replyAllList(m);
    var to = kind === 'replyall' ? all : [(m.replyTo && m.replyTo[0]) || (m.from.email === S.me ? (m.to || [])[0] : m.from)];
    var cc = [];
    if (kind === 'replyall' && all.length > 1) { to = [all[0]]; cc = all.slice(1); }
    openCompose({ to: to.filter(Boolean), cc: cc, subject: reSubject(m.subject || t.subject, 'Re'), quote: quoteHtml(m), threadId: t.id, replyTo: m.id, mb: S.threadBox, title: kind === 'replyall' ? 'Reply all' : 'Reply', body: text ? replyBody(text) : undefined }, where);
  }
  function editDraft(mid) {
    if (!S.level.write || !canWrite()) return askWrite('draft');
    var m = S.thread.messages.filter(function (x) { return x.id === mid; })[0]; if (!m) return;
    var real = S.thread.messages.filter(function (x) { return !x.draft; });
    openCompose({ to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, body: m.html || '', draftId: S.drafts[m.id] || '', threadId: real.length ? S.thread.id : '', replyTo: real.length ? real[real.length - 1].id : '', title: real.length ? 'Reply' : 'Draft', mb: S.threadBox, noSig: true }, { inline: !!real.length, kind: 'reply' });
  }
  function chipHtml(a) { return '<span class="ml-to" data-email="' + esc(a.email) + '" data-name="' + esc(a.name || '') + '" title="' + esc(a.email) + '">' + esc(a.name || a.email) + '<button type="button" data-unchip aria-label="Remove ' + esc(a.name || a.email) + '">' + ic('x') + '</button></span>'; }
  function addrRow(k, label, list) {
    return '<div class="ml-c__row" data-field="' + k + '"><label for="ml-c-' + k + '">' + label + '</label><div class="ml-c__chips">' + (list || []).map(chipHtml).join('') + '<input id="ml-c-' + k + '" class="ml-c__in" type="email" multiple autocomplete="off" autocapitalize="off" spellcheck="false" data-addr="' + k + '" /></div>' + (k === 'to' ? '<button type="button" class="ml-c__ccb" data-act="show-cc">Cc Bcc</button>' : '') + '<div class="ml-sug" data-sug hidden role="listbox"></div></div>';
  }
  function fromRow(o) {
    var opts = S.fromOpts;
    if (!opts || opts.length < 2) return '';
    var mb = o.mb != null ? o.mb : (S.box && S.box !== S.me ? S.box : '');
    var want = mb || S.me;
    var pick = opts.filter(function (x) { return x.mailbox === want && x.default; })[0] || opts.filter(function (x) { return x.mailbox === want; })[0] || opts[0];
    return '<div class="ml-c__row"><label for="ml-c-from">From</label><select id="ml-c-from" class="ml-c__in ml-c__from" data-from>' + opts.map(function (x) {
      var v = x.mailbox + '|' + x.email;
      return '<option value="' + esc(v) + '"' + (x === pick ? ' selected' : '') + '>' + esc((x.name ? x.name + ' ' : '') + '<' + x.email + '>') + '</option>';
    }).join('') + '</select></div>';
  }
  function composeCtx() { return { me: S.me, name: S.name, signature: S.signature, fromOpts: S.fromOpts, write: !!(S.level.write && canWrite()), read: !!S.level.read, box: S.box }; }
  function openCompose(o, where) {
    o = o || {};
    where = where || {};
    if (window.FavorCompose) {
      var host = where.inline && S.thread && o.threadId === S.thread.id ? root.querySelector('[data-inline-host]') : null;
      window.FavorCompose.open(Object.assign({}, o, { mode: host ? 'inline' : 'float', host: host, kind: where.kind || '', items: where.items, ctx: composeCtx() }));
      return;
    }
    if (C) closeCompose(true);
    var el = document.createElement('div');
    el.className = 'ml-c';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'New message');
    var sig = !o.noSig && S.signature ? '<div class="gmail_signature">' + S.signature + '</div>' : '';
    el.innerHTML = '<div class="ml-c__box"><div class="ml-c__bar"><button type="button" class="ml-c__cancel" data-c="close">Cancel</button><b>' + esc(o.title || 'New message') + '</b><span class="ml-c__save" data-c-saved></span><button type="button" class="ml-iconbtn ml-dt" data-c="close" aria-label="Close and keep the draft" title="Close (the draft is kept)">' + ic('x') + '</button><button type="button" class="ml-iconbtn ml-c__later" data-act="later-menu" aria-label="Send later" title="Send later">' + ic('clock') + '</button><button type="button" class="ml-btn ml-btn--primary ml-c__send" data-c="send">' + ic('send') + '<span>Send</span></button></div>' +
      '<div class="ml-c__scroll">' + fromRow(o) + addrRow('to', 'To', o.to) +
      '<div class="ml-c__cc"' + ((o.cc && o.cc.length) || (o.bcc && o.bcc.length) ? '' : ' hidden') + '>' + addrRow('cc', 'Cc', o.cc) + addrRow('bcc', 'Bcc', o.bcc) + '</div>' +
      '<div class="ml-c__row"><label for="ml-c-subj">Subject</label><input id="ml-c-subj" class="ml-c__in ml-c__subj" maxlength="900" value="' + esc(o.subject || '') + '" /></div>' +
      '<div class="ml-c__ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-ed>' + (o.body || '<div><br></div>' + (sig ? '<div><br></div>' + sig : '')) + '</div>' +
      (o.quote ? '<button type="button" class="ml-fold ml-fold--c" data-c="quote" aria-label="Show the earlier message" title="Show the earlier message">' + ic('more') + '</button><div class="ml-c__q" hidden data-q contenteditable="true">' + o.quote + '</div>' : '') +
      '<div class="ml-c__files" data-files></div></div>' +
      '<div class="ml-c__tools">' +
        '<button type="button" class="ml-iconbtn" data-c="attach" aria-label="Attach a file" title="Attach a file">' + ic('clip') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-c="drive" aria-label="Link a Drive file" title="Link a Drive file">' + ic('drive') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-c="clip" aria-label="Link a clip" title="Link a clip">' + ic('rec') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-c="photos" aria-label="Photos from Drive" title="Photos from the Drive library">' + ic('image') + '</button>' +
        '<button type="button" class="ml-iconbtn" data-act="templates" aria-label="Templates" title="Templates with the partner\'s details">' + ic('draft') + '</button>' +
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
    C = { el: el, o: o, files: [], forward: (o.forward || []).slice(), draftId: o.draftId || '', mb: o.mb != null ? o.mb : (S.box && S.box !== S.me ? S.box : ''), dirty: false, saving: null, saveT: 0, pushed: false, sent: false };
    renderFiles();
    requestAnimationFrame(function () {
      el.classList.add('is-in');
      var first = (o.to && o.to.length) ? $('[data-ed]', el) : $('#ml-c-to', el);
      if (first) { first.focus({ preventScroll: true }); if (first.hasAttribute('contenteditable')) { var r = document.createRange(); r.setStart(first.firstElementChild || first, 0); r.collapse(true); var s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
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
    var out = { to: chips('to'), cc: chips('cc'), bcc: chips('bcc'), subject: $('#ml-c-subj', C.el).value, html: html, threadId: C.o.threadId || '', replyTo: C.o.replyTo || '', draftId: C.draftId, mb: C.mb || '' };
    var fr = $('[data-from]', C.el);
    if (fr && fr.value) { var parts = fr.value.split('|'); out.mb = parts[0] === S.me ? '' : parts[0]; out.from = parts[1]; }
    return out;
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
      if (discard) { if (c.draftId) api.dropDraft(c.draftId, c.mb).catch(function () {}); else if (c.saving) c.saving.then(function () { if (c.draftId) api.dropDraft(c.draftId, c.mb).catch(function () {}); }); toast('Draft discarded'); }
      else if (c.dirty) { var keep = C; C = c; saveDraft().then(function () { toast('Draft saved'); }); C = keep; }
    }
    c.el.classList.remove('is-in'); c.el.classList.add('is-out');
    setTimeout(function () { c.el.remove(); }, 200);
  }
  /* Send. First the writing check; with findings it asks "Send anyway?" and counts 5 seconds before it sends by itself (a setting turns the
     count off). Then the message is held 15 seconds with an Undo bar. Without files the hold is kept on the server, so leaving the page
     never loses the message and never sends it twice. With files the page holds it (files are too big to keep), and a draft is kept. */
  var HOLD_MS = 15000;
  function countdownOn() { try { return localStorage.getItem('favor.mail.countdown') !== 'off'; } catch (e) { return true; } }
  function sendNow(skipCheck) {
    var b = collect();
    if (!b.to.length && !b.cc.length && !b.bcc.length) { toast('Add who it goes to'); var t = $('#ml-c-to', C.el); if (t) t.focus(); return; }
    var big = C.files.reduce(function (n, f) { return n + f.size; }, 0);
    if (big > 24 * 1048576) { toast('Files can add up to 24 MB. Link a big file from Drive instead.'); return; }
    if (!skipCheck) {
      var c0 = C;
      api.check({ to: b.to.map(function (x) { return x.email; }), cc: b.cc.map(function (x) { return x.email; }), bcc: b.bcc.map(function (x) { return x.email; }), subject: b.subject, html: b.html, files: C.files.length + C.forward.length, threadId: b.threadId, mb: b.mb }).then(function (d) {
        if (C !== c0) return;
        if (!(d.warnings || []).length) return sendNow(true);
        confirmSend(d.warnings, function () { sendNow(true); });
      }).catch(function () { sendNow(true); });
      return;
    }
    var c = C;
    c.sent = true; clearTimeout(c.saveT);
    b.files = c.files.map(function (f) { return { name: f.name, mime: f.mime, data: f.data }; });
    b.forward = c.forward;
    var restore = function () {
      c.sent = false;
      openCompose(Object.assign({}, c.o, { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, body: $('[data-ed]', c.el) ? $('[data-ed]', c.el).innerHTML : '', quote: '', draftId: c.draftId, mb: c.mb, noSig: true }));
      C.files = c.files; C.forward = c.forward; renderFiles();
    };
    closeCompose(false);
    var hasFiles = b.files.length || b.forward.length;
    var held = hasFiles ? Promise.resolve(null) : api.hold(b).then(function (d) { return d.id; }).catch(function () { return null; });
    var undone = false, released = false;
    var finish = function (d) {
      toast('Sent');
      if (S.open && d && d.threadId === S.open) openThread(S.open);
      else if (S.label === 'SENT') loadList({ quiet: true });
    };
    var fail = function (e) { toast(e.message || 'Not sent. Your draft is kept.'); c.sent = false; if (e.code === 'mail_scope') askWrite('send'); };
    var release = function () {
      if (undone || released) return;
      released = true;
      held.then(function (id) { return id ? api.release(id, b.mb) : api.send(b); }).then(finish).catch(fail);
    };
    toast('Sending', function () {
      if (released) return;
      undone = true;
      held.then(function (id) { return id ? api.cancelHold(id, b.mb) : null; }).then(function (r) { if (r && r.undone === false) { toast('It already went'); return; } restore(); }).catch(restore);
    }, HOLD_MS);
    setTimeout(release, HOLD_MS);
    // Leaving the page ends the undo window: the server sends the held message now.
    window.addEventListener('pagehide', function onHide() {
      window.removeEventListener('pagehide', onHide);
      if (undone || released) return;
      held.then(function (id) { if (id && navigator.sendBeacon) navigator.sendBeacon(pathMb('/api/mail/hold/' + encodeURIComponent(id) + '/release', b.mb), new Blob(['{}'], { type: 'application/json' })); });
    });
  }
  // "Send anyway?": the findings, a 5 second count that sends by itself, Fix it and Send now.
  function confirmSend(warnings, go) {
    var left = 5, auto = countdownOn(), timer = 0, done = false;
    var el = openSheet('Send anyway?', '<ul class="ml-warn">' + warnings.map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('') + '</ul>' +
      '<label class="ml-menu__i ml-check"><input type="checkbox" data-nocount' + (auto ? '' : ' checked') + ' /><span>Wait for me to press Send</span></label>' +
      '<div class="ml-sheet__acts"><button type="button" class="ml-btn ml-btn--primary" data-fix>Fix it</button><button type="button" class="ml-btn" data-now>' + (auto ? 'Send now (<span data-left>' + left + '</span>)' : 'Send now') + '</button></div>');
    var tick = function () {
      if (done || !auto) return;
      left--; var n = el.querySelector('[data-left]'); if (n) n.textContent = left;
      if (left <= 0) { done = true; clearInterval(timer); closeSheet(null, go); }
    };
    if (auto) timer = setInterval(tick, 1000);
    var stop = function () { done = true; clearInterval(timer); };
    el.addEventListener('change', function (e) {
      var c = e.target.closest('[data-nocount]'); if (!c) return;
      try { localStorage.setItem('favor.mail.countdown', c.checked ? 'off' : 'on'); } catch (e2) { /* private mode */ }
      auto = !c.checked; if (!auto) { clearInterval(timer); var b2 = el.querySelector('[data-now]'); if (b2) b2.textContent = 'Send now'; }
    });
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-fix]') || e.target.closest('[data-close]')) { stop(); closeSheet(); return; }
      if (e.target.closest('[data-now]')) { stop(); closeSheet(null, go); }
    });
  }
  function laterMenu() {
    if (!C) return;
    var opts = snoozeTimes();
    var el = openSheet('Send later', '<div class="ml-menu">' + opts.map(function (o, k) { return '<button type="button" class="ml-menu__i" data-lt="' + k + '">' + ic('clock') + '<span>' + esc(o[0]) + '</span><small>' + esc(o[1].toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small></button>'; }).join('') +
      '<div class="ml-menu__pick"><label for="ml-lt-at">Pick a date and time</label><input id="ml-lt-at" type="datetime-local" class="ml-input" /><button type="button" class="ml-btn ml-btn--primary" data-lt="pick">Schedule</button></div>' +
      '<label class="ml-menu__i ml-check"><input type="checkbox" data-remind checked /><span>Remind me if there is no reply in 3 days</span></label></div>');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lt]'); if (!b || !C) return;
      var at = b.dataset.lt === 'pick' ? new Date(el.querySelector('#ml-lt-at').value) : opts[+b.dataset.lt][1];
      if (!at || !isFinite(at.getTime()) || at < new Date()) { toast('Pick a time later than now'); return; }
      var body = collect();
      if (C.files.length || C.forward.length) { toast('A message with files cannot wait. Send it now.'); return; }
      body.sendAt = at.toISOString(); body.remindDays = el.querySelector('[data-remind]').checked ? 3 : 0;
      closeSheet();
      api.makeLater(body).then(function () { var c = C; if (c) { c.sent = true; closeCompose(false, true); } toast('Scheduled for ' + at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })); S.later = []; }).catch(failed);
    });
  }
  function laterList() {
    var el = openSheet('Scheduled messages', '<div class="ml-empty"><span>Loading</span></div>');
    api.later().then(function (d) {
      var l = d.later || [];
      el.querySelector('.ml-sheet__body').innerHTML = l.length ? '<div class="ml-menu">' + l.map(function (x) { return '<div class="ml-menu__i ml-mrow"><span><b>' + esc(x.subject || '(no subject)') + '</b><br><small>To ' + esc((x.to || []).map(function (a2) { return a2.email || a2; }).join(', ')) + ', ' + esc(new Date(x.sendAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</small></span><button type="button" class="ml-btn" data-dellater="' + esc(x.id) + '">Cancel</button></div>'; }).join('') + '</div>' : '<p class="ml-p">Nothing is waiting to send.</p>';
    }).catch(failed);
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-dellater]'); if (!b) return; api.dropLater(b.dataset.dellater).then(function () { b.closest('.ml-menu__i').remove(); toast('Cancelled'); }).catch(failed); });
  }
  function templatesMenu() {
    var el = openSheet('Templates', '<div class="ml-empty"><span>Loading</span></div>');
    var draw = function (list) {
      el.querySelector('.ml-sheet__body').innerHTML = '<p class="ml-p">Fields fill from the partner on the To line: {first_name}, {name}, {last_gift}, {last_gift_date}, {total_giving}, {my_name}.</p><div class="ml-menu">' + (list.length ? list.map(function (t) { return '<div class="ml-menu__i ml-mrow"><button type="button" class="ml-linkbtn" data-tpl="' + esc(t.id) + '">' + esc(t.name) + '</button><button type="button" class="ml-btn" data-deltpl="' + esc(t.id) + '">Remove</button></div>'; }).join('') : '<p class="ml-p">No templates yet.</p>') + '</div>' + (C ? '<form class="ml-form" data-tplf><label>Save this message as a template<input class="ml-input" name="name" maxlength="60" placeholder="Thank you for your gift" required /></label><div class="ml-sheet__acts"><button type="submit" class="ml-btn">Save template</button></div></form>' : '');
      el._list = list;
    };
    api.templates().then(function (d) { draw(d.templates || []); }).catch(failed);
    el.addEventListener('click', function (e) {
      var d1 = e.target.closest('[data-deltpl]');
      if (d1) { api.dropTemplate(d1.dataset.deltpl).then(function () { el._list = el._list.filter(function (t) { return t.id !== d1.dataset.deltpl; }); draw(el._list); }).catch(failed); return; }
      var u = e.target.closest('[data-tpl]'); if (!u || !C) return;
      var t = el._list.filter(function (x) { return x.id === u.dataset.tpl; })[0]; if (!t) return;
      var to = chips('to').map(function (x) { return x.email; });
      api.fillTemplate(t.body, to).then(function (r) { closeSheet(null, function () { insertHtml('<div>' + esc(r.text).replace(/\n/g, '<br>') + '</div>'); }); }).catch(failed);
    });
    el.addEventListener('submit', function (e) {
      e.preventDefault(); if (!C) return;
      var ed = $('[data-ed]', C.el), text = (ed.innerText || '').trim();
      api.saveTemplate(e.target.name.value.trim(), text).then(function () { toast('Template saved'); closeSheet(); }).catch(function (er) { toast(er.message); });
    });
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
  function drivePick(first) {
    var el = openSheet(first ? 'Photos from the Drive library' : 'Link a Drive file', '<input class="ml-input" data-dq placeholder="Search the Drive library" aria-label="Search the Drive library" autocomplete="off" /><div class="ml-pick" data-dres><div class="ml-empty"><span>Type to search</span></div></div>');
    var t = 0, q = el.querySelector('[data-dq]'), res = el.querySelector('[data-dres]'), items = [];
    if (first) { q.value = first; q.dispatchEvent(new Event('input')); }
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
  // Photos for a reply: the Drive library searched with the words of the subject, so a reply about a trip finds the trip's pictures.
  function photoPick() {
    var subj = C ? ($('#ml-c-subj', C.el).value || '') : '';
    var words = subj.replace(/^(re|fwd?):\s*/ig, '').replace(/[^\w\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 3; }).slice(0, 4).join(' ');
    drivePick((words || 'photos') + ' photo');
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
      var ta = e.target.closest('[data-act="templates"],[data-act="later-menu"]');
      if (ta) { if (ta.dataset.act === 'templates') templatesMenu(); else laterMenu(); return; }
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
      else if (c === 'send') sendNow(false);
      else if (c === 'attach') $('[data-file]', el).click();
      else if (c === 'drive') drivePick();
      else if (c === 'clip') clipPick();
      else if (c === 'photos') photoPick();
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendNow(false); return; }
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
    var bx = e.target.closest('[data-box]');
    if (bx) { setBox(bx.dataset.box); return; }
    var sel = e.target.closest('[data-sel]');
    if (sel) { selAct(sel.dataset.sel); return; }
    // The avatar circle chooses a row (a check shows); once any row is chosen, a press on a row chooses it too. Shift takes a range.
    var rowEl = e.target.closest('.ml-row[data-id]');
    if (rowEl && !a && !e.metaKey && !e.ctrlKey && (e.target.closest('[data-pick]') || (pickedIds().length && e.target.closest('.ml-row__a')) || (e.shiftKey && pickedIds().length))) {
      e.preventDefault(); pick(rowEl.dataset.id, e.shiftKey); return;
    }
    var open = e.target.closest('[data-open]');
    if (open && !a) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(S.label, S.q, open.dataset.open);
      return;
    }
    var lab = e.target.closest('[data-label]');
    if (lab && !a) { e.preventDefault(); location.hash = hashFor(lab.dataset.label, '', '', lab.dataset.v || ''); if (location.hash === hashFor(lab.dataset.label, '', '', lab.dataset.v || '') && S.v) route(); return; }
    if (!a) return;
    var k = a.dataset.act, id = a.dataset.id || '';
    if (a.closest('.ml-row')) e.preventDefault();
    if (k === 'hub-menu') { var m = document.getElementById('h-menu') || document.getElementById('h-bar-more'); if (m) m.click(); }
    else if (k === 'labels-sheet') { var el = openSheet('Mailboxes', '<nav class="ml-labels ml-labels--sheet">' + renderLabels() + '</nav>'); el.addEventListener('click', function (ev) { var bxx = ev.target.closest('[data-box]'); if (bxx) { closeSheet(null, function () { setBox(bxx.dataset.box); }); return; } var ba = ev.target.closest('[data-act="box-add"],[data-act="box-manage"]'); if (ba) { ev.preventDefault(); closeSheet(null, function () { if (ba.dataset.act === 'box-add') location.href = addBoxUrl(); else manageBoxes(); }); return; } var l = ev.target.closest('[data-label]'); if (l) { ev.preventDefault(); ev.stopPropagation(); closeSheet(null, function () { var h = hashFor(l.dataset.label, '', '', l.dataset.v || ''); if (location.hash === h) route(); else { history.replaceState(history.state, '', h); route(); } }); } }); }
    else if (k === 'compose') { if (!S.level.write || !canWrite()) askWrite('compose'); else openCompose(); }
    else if (k === 'refresh') { loadLabels(); loadBoxes(); loadList({ quiet: true }); }
    else if (k === 'box-add') { location.href = addBoxUrl(); }
    else if (k === 'box-manage') manageBoxes();
    else if (k === 'pick-all') pickAll();
    else if (k === 'pick-clear') clearPicks();
    else if (k === 'filter-menu') filterMenu(a);
    else if (k === 'sort-menu') sortMenu(a);
    else if (k === 'flags-clear') { S.flags = {}; renderFilters(); loadList(); }
    else if (k === 'clean-review') cleanReview();
    else if (k === 'brief-open') go('INBOX', '', id);
    else if (k === 'brief-fresh') loadBrief(true);
    else if (k === 'brief-hide') {
      var bk = (S.brief && S.brief.key) || '';
      try { localStorage.setItem('favor.mail.briefoff:' + (S.me || ''), bk); } catch (e2) { /* private mode */ }
      if (S.brief) S.brief.off = true;
      api.briefClose(bk, accts()[0] || '').catch(function () { /* this browser still remembers */ });
      var bh = $('.ml-brief'); if (bh) bh.remove();
    }
    else if (k === 'nudge-hide') { try { localStorage.setItem('favor.mail.nudge', ET().slice(0, 8) + Math.floor(Number(ET().slice(8, 10)) / 7)); } catch (e3) { /* private mode */ } var nh = $('.ml-clean--nudge'); if (nh) nh.remove(); }
    else if (k === 'cats') categoriesSheet();
    else if (k === 'prospect') addProspect();
    else if (k === 'find-time') findTime();
    else if (k === 'log-one') logOne();
    else if (k === 'timeline') showTimeline();
    else if (k === 'gift-note') giftNote();
    else if (k === 'gift-chat') giftChat();
    else if (k === 'ask-go') askAbout();
    else if (k === 'team-move') teamMove(a);
    else if (k === 'team-dismiss') teamDismiss();
    else if (k === 'commit-task') commitTask(+a.dataset.i);
    else if (k === 'read-file') readFileKind(a);
    else if (k === 'later-list') laterList();
    else if (k === 'assigned-list') assignedList();
    else if (k === 'ask-brain') askBrain();
    else if (k === 'photos') photoPick();
    else if (k === 'templates') templatesMenu();
    else if (k === 'later-menu') laterMenu();
    else if (k === 'unsub') unsubscribe();
    else if (k === 'clean-dismiss') { try { sessionStorage.setItem('favor.mail.clean', ET()); } catch (e2) { /* private mode */ } var cl = $('.ml-clean'); if (cl) cl.remove(); }
    else if (k === 'followup') followUp(id);
    else if (k === 'sugg') { var sg = S.assist && S.assist.replies[+a.dataset.i]; if (sg) startReply('reply', null, sg); }
    else if (k === 'log-partner') { var pp = partnerOf(S.thread); if (pp) logAction(pp); }
    else if (k === 'more') loadList({ more: true });
    else if (k === 'back') go(S.label, S.q, '', false);
    else if (k === 'archive' || k === 'delete' || k === 'toggle-read' || k === 'star' || k === 'to-inbox' || k === 'untrash') act(k, id);
    else if (k === 'snooze') snoozeMenu(id, a);
    else if (k === 'labels') labelsMenu(id, a);
    else if (k === 'thread-more') threadMore(a);
    else if (k === 'handoff') { if (window.FavorHandoff && S.thread) window.FavorHandoff.open({ kind: 'mail', id: S.thread.id, title: S.thread.subject || '' }); }
    else if (k === 'reply' || k === 'replyall' || k === 'forward') startReply(k);
    else if (k === 'reply-one' || k === 'fwd-one') { var mm = msgById(a.closest('.ml-msg').dataset.mid); startReply(k === 'fwd-one' ? 'forward' : 'reply', mm, null, e.shiftKey); }
    else if (k === 'msg-more') {
      var mo = msgById(a.closest('.ml-msg').dataset.mid);
      var shm = openSheet('This message', '<div class="ml-menu"><button type="button" class="ml-menu__i" data-r="reply">' + ic('reply') + '<span>Reply</span></button>' + (replyAllList(mo).length > 1 ? '<button type="button" class="ml-menu__i" data-r="replyall">' + ic('replyall') + '<span>Reply all</span></button>' : '') + '<button type="button" class="ml-menu__i" data-r="forward">' + ic('fwd') + '<span>Forward</span></button><button type="button" class="ml-menu__i" data-r="popout">' + ic('ext') + '<span>Reply in a new window</span></button></div>', { anchor: a });
      shm.addEventListener('click', function (ev) { var r = ev.target.closest('[data-r]'); if (!r) return; closeSheet(null, function () { if (r.dataset.r === 'popout') startReply('reply', mo, null, true); else startReply(r.dataset.r, mo); }); });
    }
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
    else if (k === 'unfold') { var box = a.previousElementSibling; var f = box && box.querySelector('iframe'); if (f && f.contentDocument) { f.contentDocument.documentElement.classList.remove('fos-fold'); if (box._fit) box._fit(); else f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } a.remove(); }
    else if (k === 'show-long') { var lb = a.closest('.ml-frame'); if (lb) { lb._full = 1; lb.classList.remove('is-long'); a.remove(); if (lb._fit) lb._fit(); } }
    else if (k === 'view-file') viewFile(a.closest('.ml-msg').dataset.mid, +a.dataset.k);
    else if (k === 'edit-draft') editDraft(a.closest('.ml-msg').dataset.mid);
    else if (k === 'drop-draft') { var dmid = a.closest('.ml-msg').dataset.mid; var did = S.drafts[dmid]; if (!did) { toast('FavorOS could not find this draft in Gmail. Open it in Gmail to delete it.'); return; } if (!S.level.write || !canWrite()) return askWrite('draft'); api.dropDraft(did, S.threadBox).then(function () { toast('Draft discarded'); forgetThread(S.open); openThread(S.open); }).catch(failed); }
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
    if (sheetEl && e.key === 'Escape' && sheetEl.contains(e.target)) { e.preventDefault(); closeSheet(); return; }
    if (typing(e.target) || C || (window.FavorChatView && window.FavorChatView.isOpen())) return;
    if (sheetEl) { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } return; }
    if (document.querySelector('.cmdk[open], .cmdk.is-open, dialog[open]')) return;
    var k = e.key;
    var map = {
      j: function () { stepThread(1); }, k: function () { stepThread(-1); },
      o: function () { var t = S.threads[S.sel]; if (t) go(S.label, S.q, t.id); }, Enter: function () { if (!S.open) { var t = S.threads[S.sel]; if (t) go(S.label, S.q, t.id); } },
      u: function () { if (S.open) go(S.label, S.q, ''); }, Escape: function () { if (pickedIds().length) clearPicks(); else if (S.open) go(S.label, S.q, ''); },
      z: function () { if (lastUndo && Date.now() - lastUndo.at < (lastUndo.ms || 6000) + 1000) { var u = lastUndo.fn; lastUndo = null; u(); } },
      x: function () { if (S.open && !isPhone()) return; var t = S.threads[S.sel < 0 ? 0 : S.sel]; if (t) { if (S.sel < 0) select(0); pick(t.id, false); } },
      e: function () { if (pickedIds().length) selAct('archive'); else act('archive'); }, '#': function () { if (pickedIds().length) selAct('trash'); else act('delete'); },
      s: function () { if (pickedIds().length) selAct('star'); else act('star'); },
      U: function () { if (pickedIds().length) selAct('unread'); else act('unread'); }, I: function () { if (pickedIds().length) selAct('read'); else act('read'); },
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
    var rows = [['j / k', 'Older / newer conversation'], ['o or Enter', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['s', 'Star'], ['x', 'Select the highlighted conversation'], ['z', 'Undo the last archive, delete or snooze'], ['Shift click', 'Select a range'], ['Shift U / Shift I', 'Mark unread / read'], ['b', 'Snooze'], ['l', 'Labels'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['c', 'Compose'], ['/', 'Search'], ['Ctrl Enter', 'Send']];
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
    else if (g === 'mailbox') toast('Mailbox added');
    else if (g === 'mailbox-domain') toast('Only favorintl.org accounts can be added');
    else if (g === 'mailbox-same') toast('That is the account you sign in with');
    else if (g === 'mailbox-limit') toast('Five mailboxes is the most you can add');
    else if (g === 'mailbox-declined' || g === 'mailbox-failed') toast('The mailbox was not added. Try again.');
    p.delete('google');
    history.replaceState(history.state, '', location.pathname + (p.toString() ? '?' + p : '') + location.hash);
  }
  function boot() {
    notes();
    setView(parseHash().thread ? 'thread' : 'list');
    var r = parseHash(); S.label = r.label; S.q = r.q; S.v = r.v;
    $('[data-list-title]').textContent = listTitle();
    var routed = false;
    // The last visit is remembered on this device: who, what the grant allowed and the mailboxes. With that the saved list draws at once and
    // the list is asked for in the same moment as the state, instead of after it.
    try {
      var known = JSON.parse(localStorage.getItem('favor.mail.boot.v1') || 'null');
      if (known && known.me && known.level && known.level.read) { S.me = known.me; S.name = known.name || ''; S.level = known.level; S.boxes = known.boxes || []; S.write = known.write !== false; S.connected = true; renderBoxes(); routed = true; if (!isPhone() && !r.thread) $('[data-read]').innerHTML = emptyRead(); route(); }
    } catch (e) { /* first visit */ }
    if (!routed) { $('[data-rows]').innerHTML = skeleton(8); if (!isPhone() && !r.thread) $('[data-read]').innerHTML = emptyRead(); }
    api.state().then(function (d) {
      S.me = d.email; S.name = d.name; S.boxes = d.mailboxes || []; S.level = d.level || S.level; S.write = d.write !== false; S.connected = d.connected;
      try { localStorage.setItem('favor.mail.boot.v1', JSON.stringify({ me: d.email, name: d.name, level: d.level, boxes: S.boxes, write: d.write !== false })); } catch (e) { /* private mode */ }
      if (S.level.write) { S.ro = false; try { localStorage.removeItem('favor.mail.ro'); } catch (e) { /* none */ } }
      root.classList.toggle('is-ro', !canWrite() || !S.level.write);
      var bar = $('[data-allow]'); bar.hidden = !(S.level.headers && !S.level.read); $('[data-allow-link]').href = allowUrl('mail');
      if (!d.connected || (!S.level.headers && !S.level.read)) { try { localStorage.removeItem('favor.mail.boot.v1'); } catch (e) { /* none */ } renderConnect('read'); return; }
      DEV.sweep(); renderBoxes();
      if (!routed) route();
      // The rest waits for the list: counts, mailboxes, the From list, fund names and the signature are not on the way to the first rows.
      setTimeout(function () { loadLabels(); loadBoxes(); }, 350);
      setTimeout(function () { loadFrom(); loadNames(); }, 1500);
      try { var sg = localStorage.getItem('favor.mail.sig.' + S.me); if (sg != null) S.signature = sg; } catch (e) { /* none */ }
      setTimeout(function () { api.signature().then(function (x) { S.signature = x.signature || ''; try { localStorage.setItem('favor.mail.sig.' + S.me, S.signature); } catch (e) { /* none */ } }).catch(function () { /* the message window opens without it */ }); }, 900);
    }).catch(function (e) {
      $('[data-rows]').innerHTML = '<div class="ml-empty"><b>' + esc(e.status === 403 ? 'Mail is not open to you yet' : 'Mail did not load') + '</b><span>' + esc(e.message) + '</span></div>';
    });
    // The rail count and the list stay fresh while the page is open (every two minutes, only when visible).
    var refresh = function () { if (document.hidden || !S.connected) return; loadLabels(); if (S.view === 'list' && !S.q && !C && !sheetEl && !pickedIds().length) loadList({ quiet: true }); };
    setInterval(refresh, 60000);
    // Mail read in Gmail or on a phone shows here the moment this tab is looked at again.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }
  boot();
})();
