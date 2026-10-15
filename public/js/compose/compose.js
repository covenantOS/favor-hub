/* FavorOS composer (window.FavorCompose). One email composer for every page, classic and React alike.
   Loaded by the classic layout (src/layouts/App.astro) and the React frame (app/src/lib/legacy.ts), and called by Mail and by any
   page with something to email (Brain answers, clips, tasks, meeting notes, Drive files).

   Where a message is written:
     inline  under the conversation in Mail, in the page's flow, so the conversation and the reply scroll together;
     float   a window over any page: docked at the bottom right (Gmail style), dragged anywhere and resized, minimized to a
             tab, or full screen. Floating windows stay open while the person moves between pages: they sit outside the page
             (hub-swap.js swaps only #h-content), and a full page load puts them back from this browser's copy.
     phone   always a full-screen sheet; minimized, a pill above the tab bar.
   Drafts save to Gmail 2.5 s after a change and to this browser at once (localStorage, files in IndexedDB). Sending runs the
   writing check, then holds the message on the server for 15 s with Undo (the hold survives a page change), then releases it.
   Send later uses the Scheduled list (/api/mail/later).

   Drop onto a window: files from the computer attach; FavorOS items (dataTransfer 'application/x-favoros-item', JSON
   {kind, title, url, text, html, rows:{columns, rows, title}, csv:{name, url}, headline:{value, label}, asOf, partner, mayShare})
   go in as clean email HTML. Dropped onto any other text box in FavorOS, an item goes in as plain text.
   FavorCompose.add(item, {anchor, from}) does the same for a "Send to email" button: with no draft open it starts a new email;
   with drafts open it asks which one, New email first. A new email from a page on a wide screen opens side by side with the page.

   Where the signature lives: under the message, folded to one small line, and added to the HTML only when the draft is saved or
   sent (collect). The editor holds only what the person writes. */
(function () {
  'use strict';
  if (window.FavorCompose) return;

  var CSS_HREF = '/js/compose/compose.css?v=3';
  var SIDE_MIN = 1280;
  var HOLD_MS = 15000;
  var MAX_FILES = 24 * 1048576;
  var MAX_OPEN = 3;
  var TABLE_ROWS = 40;
  var ITEM_TYPE = 'application/x-favoros-item';

  /* ------------------------------------------------------------------ small helpers */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isPhone = function () { return window.innerWidth < 861; };
  var uid = function () { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // An address as {email, name}, from either that or a header form like '"Grace Lin" <grace@favorintl.org>'.
  function addr(a) {
    if (!a) return null;
    var raw = typeof a === 'string' ? a : String(a.email || '');
    // The first address found wins, so a mangled header ('x" <a@b.org> <"x" <a@b.org>>') still gives a@b.org.
    var found = raw.match(/[^\s<>"',;()]+@[^\s<>"',;()]+\.[^\s<>"',;()]+/);
    var email = (found ? found[0] : raw).trim().toLowerCase();
    var given = typeof a === 'object' && a.name ? String(a.name) : raw.indexOf('<') > 0 ? raw.slice(0, raw.indexOf('<')) : '';
    var name = given.replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
    if (name.indexOf('@') >= 0 || name.toLowerCase() === email) name = '';
    return email ? { email: email, name: name } : null;
  }
  var ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    min: '<path d="M6 12h12"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    pop: '<path d="M14 4h6v6"/><path d="M20 4 12 12"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    dock: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M12 14h6v4h-6z"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10M16 3 10 13M2 13h12"/>',
    rec: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3 3-2.5 4 3.5"/>',
    draft: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h7M9 17h4"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    ital: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    under: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    olist: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M4 9h3M4 14.5c0-1 2.8-1 2.8.4 0 1-2.8 2-2.8 3.1h3"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    reply: '<path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>',
    fwd: '<path d="m14 8 5 4.5-5 4.5"/><path d="M19 12.5h-9a5 5 0 0 0-5 5V19"/>',
    side: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M13 4v16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  };
  var ic = function (n) { return '<svg class="fc-i" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; };
  var size = function (n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
  var nav = function () { try { return JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null') || {}; } catch (e) { return {}; } };
  var meEmail = function () { var n = nav(); return (n.user && n.user.email) || ''; };
  var mayMail = function () { var n = nav(); return !!(n.access && n.access.mail); };

  /* ------------------------------------------------------------------ server */
  function req(method, path, body) {
    return fetch(path.charAt(0) === '/' ? path : '/api/mail/' + path, {
      method: method, credentials: 'same-origin',
      headers: Object.assign({ 'X-Hub-Request': '1' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).catch(function () { var e = new Error('No connection. Try again when you are back online.'); e.code = 'offline'; throw e; })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || d.ok === false) { var e = new Error(d.message || 'Something went wrong. Try again.'); e.code = d.error || ''; e.need = d.need || ''; e.status = r.status; throw e; }
          return d;
        });
      });
  }
  var pathMb = function (p, mb) { return mb ? p + (p.indexOf('?') < 0 ? '?' : '&') + 'mb=' + encodeURIComponent(mb) : p; };
  var api = {
    state: function () { return req('GET', 'state'); },
    signature: function () { return req('GET', 'signature'); },
    from: function () { return req('GET', 'from'); },
    contacts: function (q) { return req('GET', 'contacts?q=' + encodeURIComponent(q)); },
    saveDraft: function (b) { return req('PUT', pathMb('drafts', b.mb), b); },
    dropDraft: function (id, mb) { return req('DELETE', pathMb('drafts/' + encodeURIComponent(id), mb)); },
    check: function (b) { return req('POST', pathMb('check', b.mb), b); },
    hold: function (b) { return req('POST', pathMb('hold', b.mb), b); },
    release: function (id, mb) { return req('POST', pathMb('hold/' + encodeURIComponent(id) + '/release', mb), {}); },
    cancelHold: function (id, mb) { return req('DELETE', pathMb('hold/' + encodeURIComponent(id), mb)); },
    send: function (b) { return req('POST', pathMb('send', b.mb), b); },
    later: function (b) { return req('POST', pathMb('later', b.mb), b); },
    drive: function (q) { return req('GET', 'drive?q=' + encodeURIComponent(q)); },
    clips: function () { return req('GET', 'clips'); },
    templates: function () { return req('GET', 'templates'); },
    saveTemplate: function (name, body) { return req('POST', 'templates', { name: name, body: body }); },
    fillTemplate: function (body, to) { return req('POST', 'templates/fill', { body: body, to: to }); },
  };

  /* The sender's Mail facts (address, signature, From choices, permission to send). Mail passes its own; other pages ask once. */
  var CTX = null, ctxP = null, sigP = null;
  // A page that passes its own facts may not have the signature yet (it is read apart); it is asked for once.
  function ensureSig() {
    if (!CTX || CTX.signature || CTX.sigTried) return Promise.resolve();
    if (!sigP) sigP = api.signature().then(function (g) { CTX.signature = g.signature || ''; }).catch(function () {}).then(function () { CTX.sigTried = true; sigP = null; });
    return sigP;
  }
  function ensureCtx() {
    if (CTX && CTX.me) return ensureSig().then(function () { return CTX; });
    if (ctxP) return ctxP;
    ctxP = api.state().then(function (s) {
      var c = { me: s.email || meEmail(), name: s.name || '', write: !!(s.write && s.level && s.level.write), read: !!(s.level && s.level.read), signature: '', fromOpts: null, sigTried: true };
      var jobs = [api.signature().then(function (g) { c.signature = g.signature || ''; }).catch(function () {})];
      if (s.mailboxes && s.mailboxes.length) jobs.push(api.from().then(function (f) { c.fromOpts = f.from || []; }).catch(function () {}));
      return Promise.all(jobs).then(function () { CTX = c; return c; });
    }).catch(function (e) { ctxP = null; throw e; });
    return ctxP;
  }

  /* ------------------------------------------------------------------ this browser's copy */
  var KEY = function () { return 'favor.compose.v1|' + (meEmail() || '_'); };
  function readStore() { try { return JSON.parse(localStorage.getItem(KEY()) || 'null') || { wins: [], pending: [] }; } catch (e) { return { wins: [], pending: [] }; } }
  var storeT = 0;
  function writeStore() {
    clearTimeout(storeT);
    storeT = setTimeout(writeNow, 250);
  }
  function writeNow() {
    clearTimeout(storeT);
    var out = { wins: [], pending: PENDING.map(function (p) { return { id: p.id, mb: p.mb, until: p.until, snap: p.snap }; }) };
    WINS.forEach(function (w) { if (!w.gone) out.wins.push(snapOf(w)); });
    try { localStorage.setItem(KEY(), JSON.stringify(out)); } catch (e) {
      // Full: keep the windows without their quoted text.
      out.wins.forEach(function (s) { s.quote = ''; });
      try { localStorage.setItem(KEY(), JSON.stringify(out)); } catch (e2) { /* nothing more to do */ }
    }
  }
  var idb = null;
  function db() {
    if (idb) return idb;
    idb = new Promise(function (ok) {
      if (!window.indexedDB) return ok(null);
      var r = indexedDB.open('favor-compose', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ok(null); };
    });
    return idb;
  }
  function filesPut(id, files) {
    return db().then(function (d) {
      if (!d) return;
      try { var tx = d.transaction('files', 'readwrite'); if (files && files.length) tx.objectStore('files').put(files, id); else tx.objectStore('files').delete(id); } catch (e) { /* storage refused */ }
    });
  }
  function filesGet(id) {
    return db().then(function (d) {
      if (!d) return [];
      return new Promise(function (ok) {
        try { var r = d.transaction('files').objectStore('files').get(id); r.onsuccess = function () { ok(r.result || []); }; r.onerror = function () { ok([]); }; } catch (e) { ok([]); }
      });
    });
  }

  /* ------------------------------------------------------------------ styles and the layer the windows live in */
  var cssP = null;
  function css() {
    if (cssP) return cssP;
    cssP = new Promise(function (ok) {
      if ($('link[data-fc-css]')) return ok();
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = CSS_HREF; l.setAttribute('data-fc-css', '');
      l.onload = function () { ok(); }; l.onerror = function () { ok(); };
      document.head.appendChild(l);
      setTimeout(ok, 1500);
    });
    return cssP;
  }
  var layer = null, dockRow = null, tabsEl = null, toastEl = null, dropEl = null;
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    if (layer && document.body) { document.body.appendChild(layer); return layer; }
    layer = document.createElement('div');
    layer.className = 'fc-layer';
    // The dock row runs right to left: the minimized drafts' stack sits in the corner, open windows to its left.
    layer.innerHTML = '<div class="fc-dockrow" data-fc-dock><div class="fc-tabs" data-fc-tabs></div></div><div class="fc-toast" role="status" aria-live="polite" hidden></div><div class="fc-dropstart" hidden>' + ic('mail') + '<span>Drop here to start an email</span></div>';
    document.body.appendChild(layer);
    dockRow = $('[data-fc-dock]', layer);
    tabsEl = $('[data-fc-tabs]', layer);
    toastEl = $('.fc-toast', layer);
    dropEl = $('.fc-dropstart', layer);
    wireDropStart();
    return layer;
  }

  /* ------------------------------------------------------------------ toast with Undo */
  var toastT = 0, toastTick = 0;
  function toast(msg, opts) {
    ensureLayer();
    opts = opts || {};
    clearTimeout(toastT); clearInterval(toastTick);
    toastEl.innerHTML = '<span data-fc-msg>' + esc(msg) + '</span>' + (opts.undo ? '<button type="button" data-fc-undo>Undo</button>' : '') + (opts.action ? '<button type="button" data-fc-act>' + esc(opts.action[0]) + '</button>' : '') + '<button type="button" class="fc-toast__x" data-fc-x aria-label="Dismiss">' + ic('x') + '</button>';
    toastEl.hidden = false;
    toastEl.classList.remove('is-in'); void toastEl.offsetWidth; toastEl.classList.add('is-in');
    toastEl.onclick = function (e) {
      if (e.target.closest('[data-fc-undo]') && opts.undo) { hideToast(); opts.undo(); }
      else if (e.target.closest('[data-fc-act]') && opts.action) { hideToast(); opts.action[1](); }
      else if (e.target.closest('[data-fc-x]')) { hideToast(); if (opts.onX) opts.onX(); }
    };
    if (opts.count) {
      var end = Date.now() + opts.count, m = $('[data-fc-msg]', toastEl);
      var draw = function () { var s = Math.max(0, Math.ceil((end - Date.now()) / 1000)); m.textContent = msg + (s ? ' (' + s + ')' : ''); };
      draw(); toastTick = setInterval(draw, 250);
    }
    var ms = opts.ms || (opts.undo ? 8000 : 3200);
    if (ms > 0) toastT = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(toastT); clearInterval(toastTick);
    if (!toastEl || toastEl.hidden) return;
    toastEl.classList.remove('is-in');
    setTimeout(function () { if (!toastEl.classList.contains('is-in')) toastEl.hidden = true; }, 160);
  }

  /* ------------------------------------------------------------------ windows */
  var WINS = [];
  var PENDING = [];
  var lastFocus = null;
  function emit(name, detail) { try { window.dispatchEvent(new CustomEvent('favor-compose:' + name, { detail: detail })); } catch (e) { /* old browser */ } }

  function snapOf(w) {
    var ed = w.el && $('[data-fc-ed]', w.el), q = w.el && $('[data-fc-q]', w.el);
    return {
      id: w.id, mode: w.mode === 'inline' ? 'min' : w.mode, wasInline: w.mode === 'inline' || !!w.wasInline, preMin: w.mode === 'inline' ? 'inline' : w.preMin || '', free: w.free || null, prevMode: w.prevMode || '',
      title: w.o.title || '', to: chips(w, 'to'), cc: chips(w, 'cc'), bcc: chips(w, 'bcc'), showCc: !!w.showCc,
      subject: w.el ? $('[data-fc-subj]', w.el).value : w.o.subject || '',
      body: ed ? ed.innerHTML : w.o.body || '', quote: (q ? q.innerHTML : w.o.quote || '').slice(0, 200000), quoteOpen: !!w.quoteOpen,
      threadId: w.o.threadId || '', replyTo: w.o.replyTo || '', draftId: w.draftId || '', mb: w.mb || '', from: w.from || '',
      dirty: !!w.dirty, forward: w.forward || [], fileMeta: (w.files || []).map(function (f) { return { name: f.name, size: f.size }; }), at: Date.now(),
      sig: w.sig || '', sigOn: w.sigOn !== false, side: !!w.side, sideHome: !!w.sideHome, kind: w.o.kind || '',
    };
  }
  function chips(w, k) {
    if (!w.el) return (w.o[k] || []).slice();
    return $$('[data-fc-field="' + k + '"] .fc-chip', w.el).map(function (x) { return { email: x.dataset.email, name: x.dataset.name || '' }; });
  }
  function byId(id) { for (var i = 0; i < WINS.length; i++) if (WINS[i].id === id) return WINS[i]; return null; }
  // The subject without its Re: or Fwd:, for the window's title.
  function titleOf(w) {
    var s = w.el ? $('[data-fc-subj]', w.el).value.trim() : String(w.o.subject || '').trim();
    s = s.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '');
    return s || (isReply(w.o) || isFwd(w.o) ? 'No subject' : 'New email');
  }
  function isFwd(o) { return o.kind === 'fwd' || o.title === 'Forward' || /^fwd?:/i.test(o.subject || ''); }
  function isReply(o) { return !!o.threadId && !isFwd(o); }
  // What the window is, said before its subject: "Reply", "Forward", "Draft" or "New email".
  function kindOf(w) {
    var o = w.o;
    if (isFwd(o)) return 'Forward';
    if (isReply(o)) return o.title === 'Reply all' ? 'Reply all' : 'Reply';
    if (o.title === 'Draft') return 'Draft';
    return 'New email';
  }
  function sigHtml(w) { return w.sig && w.sigOn !== false ? '<div><br></div><div class="gmail_signature" data-sig>' + w.sig + '</div>' : ''; }
  // A body that already carries a signature (a Gmail draft, an older copy in this browser): the signature comes out of the text
  // and goes under it, folded.
  function splitSig(html) {
    if (!html || !/gmail_signature|data-sig/.test(html)) return { body: html, sig: '' };
    var box = document.createElement('div');
    box.innerHTML = html;
    var s = box.querySelector('.gmail_signature, [data-sig]');
    if (!s || s.closest('.gmail_quote, blockquote')) return { body: html, sig: '' };
    var sig = s.innerHTML;
    // The blank lines Gmail and Mail put above a signature go with it.
    var prev = s.previousSibling;
    s.remove();
    while (prev && ((prev.nodeType === 3 && !prev.textContent.trim()) || (prev.nodeType === 1 && /^(BR|DIV|P)$/.test(prev.nodeName) && !prev.textContent.trim() && !prev.querySelector('img,table,a')))) {
      var p = prev.previousSibling; prev.remove(); prev = p;
    }
    return { body: box.innerHTML, sig: sig };
  }

  function chipHtml(a) { return '<span class="fc-chip" data-email="' + esc(a.email) + '" data-name="' + esc(a.name || '') + '" title="' + esc(a.email) + '">' + esc(a.name || a.email) + '<button type="button" data-fc-unchip aria-label="Remove ' + esc(a.name || a.email) + '">' + ic('x') + '</button></span>'; }
  function addrRow(k, label, list, extra) {
    return '<div class="fc-row" data-fc-field="' + k + '"><label for="fc-' + k + '-%ID%">' + label + '</label><div class="fc-chips">' + (list || []).map(chipHtml).join('') +
      '<input id="fc-' + k + '-%ID%" class="fc-in" type="email" multiple autocomplete="off" autocapitalize="off" spellcheck="false" data-fc-addr="' + k + '" /></div>' + (extra || '') + '<div class="fc-sug" data-fc-sug role="listbox" hidden></div></div>';
  }
  function fromRow(w) {
    var opts = CTX && CTX.fromOpts;
    if (!opts || opts.length < 2) return '';
    var want = w.mb || CTX.me;
    var pick = w.from ? opts.filter(function (x) { return x.mailbox + '|' + x.email === w.from; })[0] : null;
    pick = pick || opts.filter(function (x) { return x.mailbox === want && x.default; })[0] || opts.filter(function (x) { return x.mailbox === want; })[0] || opts[0];
    w.from = pick.mailbox + '|' + pick.email;
    return '<div class="fc-row"><label for="fc-from-%ID%">From</label><select id="fc-from-%ID%" class="fc-in fc-from" data-fc-from>' + opts.map(function (x) {
      var v = x.mailbox + '|' + x.email;
      return '<option value="' + esc(v) + '"' + (v === w.from ? ' selected' : '') + '>' + esc((x.name ? x.name + ' ' : '') + '<' + x.email + '>') + '</option>';
    }).join('') + '</select></div>';
  }

  function build(w) {
    var o = w.o;
    var reply = isReply(o) || isFwd(o);
    var el = document.createElement('section');
    el.className = 'fc-win';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', kindOf(w) + ': ' + titleOf(w));
    el.setAttribute('data-brain-context', 'mail');
    el.dataset.id = w.id;
    var body = o.body != null && o.body !== '' ? o.body : '<div><br></div>';
    var sigOff = w.sigOn === false;
    el.innerHTML = (
      '<header class="fc-head" data-fc-drag>' +
        '<button type="button" class="fc-head__t" data-fc-c="toggle-min" aria-label="Minimize or restore"><span class="fc-kind" data-fc-kind>' + esc(kindOf(w)) + '</span><b data-fc-title>' + esc(titleOf(w)) + '</b><span class="fc-saved" data-fc-saved></span></button>' +
        '<span class="fc-head__acts">' +
          '<button type="button" class="fc-ib fc-only-float fc-wide" data-fc-c="side" aria-label="Side by side" title="Side by side with the page">' + ic('side') + '</button>' +
          '<button type="button" class="fc-ib fc-only-float" data-fc-c="min" aria-label="Minimize" title="Minimize">' + ic('min') + '</button>' +
          '<button type="button" class="fc-ib fc-only-inline" data-fc-c="pop" aria-label="Pop out" title="Pop out (Shift click Reply opens popped out)">' + ic('pop') + '</button>' +
          '<button type="button" class="fc-ib fc-only-free" data-fc-c="dock" aria-label="Dock at the bottom" title="Dock at the bottom">' + ic('dock') + '</button>' +
          '<button type="button" class="fc-ib fc-only-float fc-dt" data-fc-c="full" aria-label="Full screen" title="Full screen">' + ic('full') + '</button>' +
          '<button type="button" class="fc-ib" data-fc-c="close" aria-label="Close and keep the draft" title="Close (the draft is kept)">' + ic('x') + '</button>' +
        '</span>' +
        '<button type="button" class="fc-ph-cancel" data-fc-c="close">Close</button>' +
        '<button type="button" class="fc-ph-send" data-fc-c="send" aria-label="Send">' + ic('send') + '</button>' +
      '</header>' +
      '<div class="fc-scroll" data-fc-scroll>' +
        '<div class="fc-fields' + (reply ? ' is-reply' : '') + '">' +
          (reply ? '<button type="button" class="fc-sum" data-fc-c="fields">' + ic(isFwd(o) ? 'fwd' : 'reply') + '<span class="fc-sum__t" data-fc-sum></span></button>' : '') +
          '<div class="fc-fields__all">' +
            fromRow(w) +
            addrRow('to', 'To', o.to, '<button type="button" class="fc-ccb" data-fc-c="cc" title="Add Cc and Bcc"' + (w.showCc ? ' hidden' : '') + '>Cc Bcc</button>') +
            '<div class="fc-cc"' + (w.showCc ? '' : ' hidden') + '>' + addrRow('cc', 'Cc', o.cc) + addrRow('bcc', 'Bcc', o.bcc) + '</div>' +
            '<div class="fc-row fc-row--subj"><label for="fc-subj-%ID%">Subject</label><input id="fc-subj-%ID%" class="fc-in fc-subj" maxlength="900" data-fc-subj value="' + esc(o.subject || '') + '" /></div>' +
          '</div>' +
        '</div>' +
        '<div class="fc-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-fc-ed data-brain-context="mail">' + body + '</div>' +
        '<div class="fc-sig' + (sigOff ? ' is-off' : '') + '" data-fc-sigbox' + (w.sig ? '' : ' hidden') + '>' +
          '<button type="button" class="fc-sig__t" data-fc-c="sig" aria-expanded="false" title="Show the signature">' + ic('more') + '<span data-fc-sigt>' + (sigOff ? 'Signature off' : 'Signature') + '</span></button>' +
          '<div class="fc-sig__body" data-fc-sigbody hidden><div class="fc-sig__view" data-fc-sigview>' + (w.sig || '') + '</div><button type="button" class="fc-sig__off" data-fc-c="sigoff">' + (sigOff ? 'Put it back' : 'Leave it off') + '</button></div>' +
        '</div>' +
        (o.quote ? '<button type="button" class="fc-trim" data-fc-c="quote" aria-expanded="' + (w.quoteOpen ? 'true' : 'false') + '" aria-label="Show the earlier message" title="Show the earlier message">' + ic('more') + '</button><div class="fc-q" data-fc-q contenteditable="true"' + (w.quoteOpen ? '' : ' hidden') + '>' + o.quote + '</div>' : '') +
        '<div class="fc-files" data-fc-files></div>' +
      '</div>' +
      '<footer class="fc-tools">' +
        '<span class="fc-sendgrp"><button type="button" class="fc-send" data-fc-c="send" title="Send (Ctrl Enter)">Send</button><button type="button" class="fc-send fc-send__more" data-fc-c="later" aria-label="Send later" title="Send later">' + ic('chev') + '</button></span>' +
        '<span class="fc-tgrp fc-fmt" role="group" aria-label="Formatting">' +
          '<button type="button" class="fc-ib" data-fc-fmt="bold" aria-label="Bold" title="Bold (Ctrl B)">' + ic('bold') + '</button>' +
          '<button type="button" class="fc-ib" data-fc-fmt="italic" aria-label="Italic" title="Italic (Ctrl I)">' + ic('ital') + '</button>' +
          '<button type="button" class="fc-ib" data-fc-fmt="underline" aria-label="Underline" title="Underline (Ctrl U)">' + ic('under') + '</button>' +
          '<button type="button" class="fc-ib" data-fc-fmt="link" aria-label="Link" title="Link (Ctrl K)">' + ic('link') + '</button>' +
          '<button type="button" class="fc-ib" data-fc-fmt="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list (Ctrl Shift 8)">' + ic('list') + '</button>' +
          '<button type="button" class="fc-ib fc-dt" data-fc-fmt="insertOrderedList" aria-label="Numbered list" title="Numbered list (Ctrl Shift 7)">' + ic('olist') + '</button>' +
        '</span>' +
        '<span class="fc-tgrp" role="group" aria-label="Add to the email">' +
          '<button type="button" class="fc-ib" data-fc-c="attach" aria-label="Attach files" title="Attach files (or drop them here)">' + ic('clip') + '</button>' +
          '<button type="button" class="fc-ib fc-ib--txt" data-fc-c="insert" aria-label="Insert a Drive file, photo, clip or template" title="Insert a Drive file, photo, clip or template" aria-haspopup="menu">' + ic('plus') + '<span>Insert</span></button>' +
        '</span>' +
        '<span class="fc-grow"></span>' +
        '<button type="button" class="fc-ib" data-fc-c="discard" aria-label="Discard draft" title="Discard draft">' + ic('trash') + '</button>' +
        '<input type="file" multiple hidden data-fc-file />' +
      '</footer>' +
      '<div class="fc-drop" hidden><span>' + ic('clip') + '<b data-fc-droptxt>Drop to attach</b></span></div>' +
      '<span class="fc-rz fc-rz--n" data-fc-rz="n"></span><span class="fc-rz fc-rz--w" data-fc-rz="w"></span><span class="fc-rz fc-rz--nw" data-fc-rz="nw"></span>' +
      '<span class="fc-rz fc-rz--e" data-fc-rz="e"></span><span class="fc-rz fc-rz--s" data-fc-rz="s"></span><span class="fc-rz fc-rz--se" data-fc-rz="se"></span>'
    ).replace(/%ID%/g, w.id);
    w.el = el;
    renderFiles(w);
    sumLine(w);
    wire(w);
    return el;
  }
  function sumLine(w) {
    var s = w.el && $('[data-fc-sum]', w.el); if (!s) return;
    var all = chips(w, 'to').concat(chips(w, 'cc'));
    s.textContent = all.length ? all.map(function (a) { return a.name || a.email; }).join(', ') : 'Add who it goes to';
  }

  /* Places a window where its mode says: inline in its host, in the dock row, side by side with the page, free on the page, in the
     stack of minimized drafts, or full screen. */
  // A panel the page keeps at the right edge (a task or request drawer): the composer docks to its left instead of covering it.
  var RP = null;
  // Mail has its own three panes: there a window docks at the bottom right as before.
  var inMail = function () { return (document.body && document.body.dataset.nav === 'mail') || /^\/mail(\/|$)/.test(location.pathname); };
  var sideOk = function () { return !isPhone() && innerWidth >= SIDE_MIN && !RP && !inMail(); };
  function fixedOf(el) {
    for (var n = el, k = 0; n && n.nodeType === 1 && n !== document.body && k < 10; n = n.parentElement, k++) if (getComputedStyle(n).position === 'fixed') return n;
    return null;
  }
  function rightPanel() {
    if (isPhone() || !document.elementsFromPoint) return null;
    var vw = document.documentElement.clientWidth || innerWidth;
    var els = document.elementsFromPoint(vw - 40, Math.round(innerHeight * 0.55));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (layer && layer.contains(el)) continue;
      if (el === document.body || el === document.documentElement) break;
      if (!fixedOf(el)) continue;
      // The drawer is the first box up from here shaped like one (it may sit inside a full-screen fixed frame).
      for (var a = el, k = 0; a && a.nodeType === 1 && a !== document.body && k < 12; a = a.parentElement, k++) {
        var r = a.getBoundingClientRect();
        if (r.right >= vw - 40 && r.width > 200 && r.width < vw * 0.7 && r.height > innerHeight * 0.5) return r;
      }
    }
    return null;
  }
  function place(w) {
    var el = w.el;
    el.dataset.mode = w.mode;
    var tt = $('[data-fc-title]', el); if (tt) tt.textContent = titleOf(w);
    var kk = $('[data-fc-kind]', el); if (kk) kk.textContent = kindOf(w);
    var side = w.mode === 'float' && !!w.side && !w.free && sideOk();
    el.classList.toggle('is-side', side);
    el.classList.toggle('is-free', w.mode === 'float' && !!w.free);
    el.classList.toggle('is-docked', w.mode === 'float' && !w.free && !side);
    var sb = $('[data-fc-c="side"]', el);
    if (sb) { sb.innerHTML = ic(side ? 'dock' : 'side'); sb.setAttribute('aria-label', side ? 'Dock at the bottom' : 'Side by side'); sb.title = side ? 'Dock at the bottom' : 'Side by side with the page'; }
    if (w.mode === 'inline') {
      if (el.parentNode !== w.host) w.host.appendChild(el);
      w.host.classList.add('has-c');
      el.style.left = el.style.top = el.style.width = el.style.height = '';
    } else {
      ensureLayer();
      var after = tabsEl.nextSibling;
      // Full screen and free windows are position: fixed, so they stay where they are in the layer: moving a node that holds the
      // caret while the pointer drags it crashed Edge's renderer.
      if (w.mode === 'full') { if (!layer.contains(el) || el.parentNode === tabsEl) dockRow.insertBefore(el, after); el.style.left = el.style.top = el.style.width = el.style.height = ''; }
      else if (w.mode === 'float' && w.free && !isPhone()) {
        if (!layer.contains(el) || el.parentNode === tabsEl) dockRow.insertBefore(el, after);
        var f = w.free;
        f.w = clamp(f.w, 360, innerWidth - 16); f.h = clamp(f.h, 260, innerHeight - 16);
        f.x = clamp(f.x, 8, innerWidth - f.w - 8); f.y = clamp(f.y, 8, innerHeight - f.h - 8);
        el.style.left = f.x + 'px'; el.style.top = f.y + 'px'; el.style.width = f.w + 'px'; el.style.height = f.h + 'px';
      } else if (w.mode === 'min') {
        if (el.parentNode !== tabsEl) tabsEl.appendChild(el);
        el.style.left = el.style.top = el.style.width = el.style.height = '';
      } else {
        if (el.parentNode !== dockRow) dockRow.insertBefore(el, after);
        el.style.left = el.style.top = '';
        el.style.width = !side && w.dockW ? w.dockW + 'px' : '';
        el.style.height = !side && w.dockH && w.mode === 'float' ? w.dockH + 'px' : '';
      }
      if (w.oldHost) { w.oldHost.classList.remove('has-c'); w.oldHost = null; }
    }
    var sc = layer && layer.querySelector('.fc-win[data-mode="full"]');
    document.documentElement.classList.toggle('fc-has-full', !!sc);
    sideLayout();
    tidyDock();
    cover();
    lift();
  }
  // One window at a time sits side by side with the page; the page gives it room (html.fc-side, compose.css).
  function sideLayout() {
    var on = sideOk() && WINS.some(function (x) { return !x.gone && x.mode === 'float' && x.side && !x.free; });
    var root = document.documentElement;
    if (on) root.style.setProperty('--fc-side-w', Math.round(clamp(innerWidth * 0.38, 460, 640)) + 'px');
    root.classList.toggle('fc-side', on);
  }
  // Too many open windows for the width: the oldest open ones fold to tabs, as in Gmail.
  function tidyDock() {
    if (!dockRow || isPhone()) return;
    var shown = WINS.filter(function (w) { return w.mode === 'float' && !w.free && !w.gone && !(w.side && sideOk()); });
    var room = Math.max(1, Math.floor((innerWidth - 120 - (document.documentElement.classList.contains('fc-side') ? innerWidth * 0.38 : 0)) / 560));
    // With a window beside the page, other open windows wait as tabs under it, so nothing sits over the page.
    var keep = document.documentElement.classList.contains('fc-side') ? 0 : Math.min(MAX_OPEN, room);
    shown.sort(function (a, b) { return (b.touched || 0) - (a.touched || 0); });
    shown.slice(keep).forEach(function (w) { w.mode = 'min'; w.el.dataset.mode = 'min'; if (w.el.parentNode !== tabsEl) tabsEl.appendChild(w.el); w.el.classList.remove('is-docked'); });
  }
  // On a phone, what sits at the bottom of the screen (the tab bar, Mail's action bar), so the pill and the toast sit above it.
  function phoneBottom() {
    if (!layer || !isPhone()) return;
    var b = 0;
    $$('.h-navbar, #h-bar, .h-bar, .ml-pbar').forEach(function (el) {
      if (layer.contains(el) || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return;
      var r = el.getBoundingClientRect();
      if (r.height && r.bottom >= innerHeight - 4 && r.width > innerWidth / 2) b = Math.max(b, innerHeight - r.top);
    });
    layer.style.setProperty('--fc-pill-b', Math.round(b) + 'px');
  }
  // How much of the bottom right the docked windows cover, so Mail's reading pane can scroll its last line above them.
  function cover() {
    phoneBottom();
    var h = 0;
    if (!isPhone() && dockRow) {
      WINS.forEach(function (w) { if (!w.gone && w.el && w.mode === 'float' && !w.free && !w.side && w.el.isConnected) h = Math.max(h, w.el.getBoundingClientRect().height); });
      if (tabsEl && tabsEl.childNodes.length) h = Math.max(h, tabsEl.getBoundingClientRect().height);
    }
    document.documentElement.style.setProperty('--fc-cover', Math.round(h) + 'px');
    document.documentElement.style.setProperty('--fc-tabs-h', tabsEl && tabsEl.childNodes.length ? Math.round(tabsEl.getBoundingClientRect().height) + 'px' : '0px');
  }
  /* The dock row never sits on a text box at the bottom of the page (the Brain's ask bar, Chat's message box): it rises above it.
     An open Favor Brain dock panel keeps its place: the row moves to its left. */
  var liftF = 0, liftPx = -1, rightPx = -1;
  function lift() { cancelAnimationFrame(liftF); liftF = requestAnimationFrame(liftNow); }
  function fixedUp(el) {
    for (var n = el, k = 0; n && n !== document.body && k < 12; n = n.parentElement, k++) { var p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; }
    return false;
  }
  function liftNow() {
    if (!layer || !dockRow) return;
    var need = 0, right = 0;
    var any = WINS.some(function (w) { return !w.gone && w.mode !== 'inline' && w.mode !== 'full' && !w.free; });
    var phone = isPhone();
    // On a phone the minimized draft is a pill across the screen: it rises above a text box at the bottom the same way.
    if (phone && WINS.some(function (w) { return !w.gone && w.mode === 'min'; })) {
      $$('textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), [contenteditable="true"]').forEach(function (el) {
        if (layer.contains(el)) return;
        var box = el.closest('form, .bc-compose, [data-fc-avoid]') || el;
        var r = box.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < innerHeight - 200 || r.top > innerHeight || !fixedUp(box) && (document.scrollingElement || document.documentElement).scrollHeight > innerHeight + 2) return;
        need = Math.max(need, innerHeight - r.top + 4);
      });
      need = Math.round(Math.min(need, innerHeight * 0.45));
    }
    if (any && !phone) {
      var dp = document.querySelector('.fd-open .fd-p:not([hidden]), #fd-p:not([hidden])');
      if (dp && dp.offsetWidth && getComputedStyle(dp).display !== 'none') { var dr = dp.getBoundingClientRect(); if (dr.left > innerWidth / 2) right = Math.round(innerWidth - dr.left + 12); }
      var rp = rightPanel();
      if (rp) right = Math.max(right, Math.round(innerWidth - rp.left + 12));
      // A drawer opened or closed at the right edge: the window beside the page docks to its left, or goes back beside the page.
      if (!!rp !== !!RP) { RP = rp; WINS.forEach(function (w) { if (!w.gone && w.el && w.mode === 'float') place(w); }); return; }
      RP = rp;
      var rr = dockRow.getBoundingClientRect();
      var left = rr.width ? rr.left : innerWidth - 400, rightEdge = rr.width ? rr.right : innerWidth;
      var still = (document.scrollingElement || document.documentElement).scrollHeight <= innerHeight + 2;
      $$('textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), [contenteditable="true"]').forEach(function (el) {
        if (layer.contains(el) || (dp && dp.contains(el))) return;
        var box = el.closest('form, .bc-compose, [data-fc-avoid]') || el;
        var r = box.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < innerHeight - 200 || r.top > innerHeight) return;
        if (r.right <= left || r.left >= rightEdge) return;
        if (!still && !fixedUp(box)) return;
        need = Math.max(need, innerHeight - r.top + 10);
      });
      need = Math.round(Math.min(need, innerHeight * 0.45));
    }
    // Not enough width for an open window beside the stack of tabs (a drawer is open): the window sits on top of the stack.
    var tabsW = tabsEl && tabsEl.childNodes.length ? tabsEl.offsetWidth + 12 : 0;
    dockRow.classList.toggle('is-stack', !phone && !!tabsW && innerWidth - (right || 88) - 104 < 580 + tabsW);
    if (need !== liftPx) { liftPx = need; document.documentElement.style.setProperty('--fc-lift', need + 'px'); }
    if (right !== rightPx) { rightPx = right; document.documentElement.style.setProperty('--fc-right', right ? right + 'px' : ''); }
  }

  function setMode(w, mode, opts) {
    opts = opts || {};
    if (w.mode === mode && !opts.force) return;
    var from = w.mode;
    if (from === 'inline' && mode !== 'inline') { w.oldHost = w.host; w.wasInline = true; }
    if (mode === 'min' && from !== 'min') w.preMin = opts.auto ? 'inline' : from === 'inline' ? 'inline' : from === 'full' ? 'full' : 'float';
    if (mode !== 'full' && from !== 'full') w.prevMode = '';
    if (mode === 'full') w.prevMode = from === 'full' ? w.prevMode : from === 'inline' ? 'float' : from;
    // A tab opened while another window sits beside the page takes its place there; the other folds to a tab.
    // A window that opened beside the page goes back there when its tab opens.
    if (mode === 'float' && !w.free && !w.side && sideOk()) {
      var sider = WINS.filter(function (x) { return x !== w && !x.gone && x.side && x.mode === 'float' && !x.free; })[0];
      if (sider) { sider.side = false; sider.preMin = 'float'; sider.mode = 'min'; w.side = true; place(sider); }
      else if (from === 'min' && w.sideHome) w.side = true;
    }
    w.mode = mode;
    w.touched = Date.now();
    var keepSel = saveSel(w);
    // A window moving between places fades over the move instead of jumping.
    var el = w.el;
    el.classList.add('is-moving');
    place(w);
    if (isPhone() && mode !== 'min') phoneOverlay(w, true);
    if (mode === 'min') phoneOverlay(w, false);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove('is-moving'); }); });
    if (mode !== 'min' && opts.focus !== false) restoreSel(w, keepSel);
    if (mode === 'inline' && opts.focus !== false) el.scrollIntoView({ block: 'nearest' });
    if (mode === 'float' || mode === 'full') { el.classList.remove('is-arrive'); void el.offsetWidth; el.classList.add('is-arrive'); }
    var fb = $('[data-fc-c="full"]', el); if (fb) { fb.innerHTML = ic(mode === 'full' ? 'unfull' : 'full'); fb.setAttribute('aria-label', mode === 'full' ? 'Exit full screen' : 'Full screen'); }
    writeStore();
    emit('change', { id: w.id, mode: mode, threadId: w.o.threadId || '' });
  }

  // On a phone an open window is a full-screen sheet with a Back step (window.hubOv, shared with every overlay).
  function phoneOverlay(w, on) {
    if (on && isPhone() && !w.ov && window.hubOv) w.ov = window.hubOv.on(function () { w.ov = null; closeWin(w, { quiet: true }); });
    else if (!on && w.ov && window.hubOv) { var t = w.ov; w.ov = null; window.hubOv.off(t); }
    document.documentElement.classList.toggle('fc-sheet-open', WINS.some(function (x) { return !x.gone && x.mode !== 'min' && isPhone(); }));
  }

  function saveSel(w) {
    var s = getSelection();
    if (s && s.rangeCount && w.el.contains(s.anchorNode)) return s.getRangeAt(0).cloneRange();
    return w.range || null;
  }
  function restoreSel(w, r) {
    var ed = $('[data-fc-ed]', w.el);
    requestAnimationFrame(function () {
      if (!w.el.isConnected) return;
      var target = r && w.el.contains(r.startContainer) ? r : null;
      var first = target ? null : (chips(w, 'to').length ? ed : $('[data-fc-addr="to"]', w.el));
      if (target) {
        var el = target.startContainer.nodeType === 1 ? target.startContainer : target.startContainer.parentElement;
        var f = el && el.closest('[contenteditable="true"], input');
        if (f) f.focus({ preventScroll: true });
        var s = getSelection(); s.removeAllRanges(); s.addRange(target);
      } else if (first) {
        first.focus({ preventScroll: true });
        if (first === ed) caretStart(ed);
      }
    });
  }
  function caretStart(ed) {
    var r = document.createRange();
    var n = ed.firstChild;
    while (n && n.nodeType === 1 && n.firstChild && n.firstChild.nodeName !== 'BR') n = n.firstChild;
    r.setStart(n && n.nodeType === 1 ? n : ed, 0);
    r.collapse(true);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /* ------------------------------------------------------------------ opening */
  function open(o) {
    o = Object.assign({}, o || {});
    if (o.ctx) { var keepSig = CTX && CTX.signature; CTX = Object.assign({}, CTX || {}, o.ctx); if (!CTX.signature && keepSig) CTX.signature = keepSig; }
    if (!o.ctx && !mayMail() && !CTX) { toast('Mail is not open for you yet.'); return Promise.resolve(null); }
    // A reply to a conversation that already has a window goes to that window.
    if (o.threadId && !o.draftId) {
      var have = WINS.filter(function (x) { return !x.gone && x.o.threadId === o.threadId && x.o.kind === o.kind; })[0];
      if (have) {
        if (o.mode === 'inline' && o.host && have.mode !== 'inline' && !isPhone()) { have.host = o.host; setMode(have, 'inline'); }
        else if (have.mode === 'min') { if (o.host) have.host = o.host; setMode(have, restoreMode(have)); }
        focusWin(have);
        return Promise.resolve(have.id);
      }
    }
    return Promise.all([css(), ensureCtx().catch(function (e) { return e; })]).then(function (r) {
      var c = r[1];
      if (c instanceof Error) { toast(c.message || 'Mail did not answer. Try again.'); return null; }
      if (!c.write && !o.force) { toast('Allow Mail to send from FavorOS first. Open Mail to allow it.', { action: ['Open Mail', function () { location.href = '/mail/'; }] }); return null; }
      return make(o);
    });
  }
  function make(o, restoreSnap) {
    ['to', 'cc', 'bcc'].forEach(function (k) { if (o[k]) o[k] = o[k].map(addr).filter(Boolean); });
    var w = {
      id: o.id || uid(), o: o, mode: 'float', host: null, free: o.free || null, files: [], forward: (o.forward || []).slice(),
      draftId: o.draftId || '', mb: o.mb != null ? o.mb : (CTX && CTX.box && CTX.box !== CTX.me ? CTX.box : ''), from: o.from || '',
      showCc: !!(o.showCc || (o.cc && o.cc.length) || (o.bcc && o.bcc.length)), quoteOpen: !!o.quoteOpen, dirty: false, saveT: 0, saving: null, touched: Date.now(),
      wasInline: !!o.wasInline, side: !!o.side && !o.free, sideHome: !!(o.side || o.sideHome),
    };
    if (o.files) w.files = o.files.slice();
    // The signature goes under the message, folded; the editor holds only what is written.
    var sp = splitSig(o.body);
    w.sig = o.sig ? o.sig : sp.sig || (!o.noSig && CTX && CTX.signature ? CTX.signature : '');
    w.sigOn = o.sigOn !== false;
    o.body = sp.body || '';
    // Items (a Brain answer, a clip, a task) go under one empty line, where the caret waits for the person's own note.
    var parts = (o.items || []).map(function (it) { return { it: it, p: itemParts(it || {}) }; });
    parts.filter(function (x) { return x.p.refused; }).forEach(function (x) { toast(x.p.refused, { ms: 6000 }); });
    parts = parts.filter(function (x) { return !x.p.refused; });
    if (parts.length) {
      var lead = o.body && o.body.replace(/<[^>]*>/g, '').trim() ? o.body : '<div><br></div>';
      o.body = lead + parts.map(function (x) { return x.p.html; }).join('<div><br></div>') + '<div><br></div>';
    }
    // One window at a time sits beside the page: an earlier one goes back to the dock.
    if (w.side) WINS.forEach(function (x) { if (x.side && !x.gone) { x.side = false; if (x.el) place(x); } });
    WINS.push(w);
    build(w);
    var want = o.mode || 'float';
    if (want === 'inline' && (!o.host || isPhone())) want = 'float';
    if (want === 'inline') w.host = o.host;
    w.mode = want === 'min' ? 'min' : want === 'full' ? 'full' : want;
    w.el.classList.add('is-entering');
    place(w);
    if (isPhone() && w.mode !== 'min') phoneOverlay(w, true);
    requestAnimationFrame(function () { requestAnimationFrame(function () { w.el.classList.remove('is-entering'); }); });
    parts.forEach(function (x) { attachParts(w, x.p, x.it); });
    if (w.mode !== 'min' && !restoreSnap) {
      if (parts.length) { var ed = $('[data-fc-ed]', w.el); requestAnimationFrame(function () { if (!w.el.isConnected) return; ed.focus({ preventScroll: true }); caretStart(ed); keepRange(w); var sc = $('[data-fc-scroll]', w.el); if (sc) sc.scrollTop = 0; }); }
      else restoreSel(w, null);
      if (w.mode === 'inline') w.el.scrollIntoView({ block: 'nearest' });
    }
    if (o.body.replace(/<[^>]*>/g, '').trim() || parts.length) { w.dirty = true; changed(w); }
    writeStore();
    emit('open', { id: w.id, threadId: o.threadId || '', mode: w.mode });
    return w.id;
  }
  // A tab opens back where it was: a window stays a window; a reply folded away by leaving its conversation goes back inline.
  function restoreMode(w) {
    if (w.preMin === 'inline' && w.host && w.host.isConnected && !isPhone()) return 'inline';
    return w.preMin === 'full' ? 'full' : 'float';
  }
  function focusWin(w) {
    w.touched = Date.now();
    lastFocus = w;
    var ed = $('[data-fc-ed]', w.el);
    if (w.mode === 'inline') w.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (ed) { ed.focus({ preventScroll: w.mode !== 'inline' }); }
  }

  /* ------------------------------------------------------------------ wiring one window */
  function wire(w) {
    var el = w.el;
    el.addEventListener('click', function (e) {
      var unc = e.target.closest('[data-fc-unchip]');
      if (unc) { unc.parentNode.remove(); changed(w); sumLine(w); return; }
      var sg = e.target.closest('[data-fc-sugi]');
      if (sg) { pickSug(w, sg.closest('.fc-row'), +sg.dataset.fcSugi); return; }
      var ch = e.target.closest('.fc-chips');
      if (ch && e.target === ch) { $('input', ch).focus(); return; }
      var f = e.target.closest('[data-fc-fmt]');
      if (f) { fmt(w, f.dataset.fcFmt); return; }
      var b = e.target.closest('[data-fc-c]'); if (!b) return;
      var c = b.dataset.fcC;
      if (c !== 'min' && c !== 'toggle-min') w.touched = Date.now();
      if (c === 'send') send(w);
      else if (c === 'close') closeWin(w);
      else if (c === 'discard') discard(w);
      else if (c === 'min') setMode(w, 'min');
      else if (c === 'toggle-min') {
        if (w.dragged) { w.dragged = false; return; }
        if (w.mode === 'min') setMode(w, restoreMode(w));
        else if (w.mode === 'float' && !isPhone()) setMode(w, 'min');
      }
      else if (c === 'pop') { w.free = null; w.side = sideOk(); setMode(w, 'float'); }
      else if (c === 'dock') { w.free = null; w.side = false; w.sideHome = false; setMode(w, 'float', { force: true }); }
      else if (c === 'side') { var to = !(w.side && sideOk()); WINS.forEach(function (x) { if (x !== w) x.side = false; }); w.side = to; w.sideHome = to; w.free = null; setMode(w, 'float', { force: true }); WINS.forEach(function (x) { if (x !== w && !x.gone && x.el) place(x); }); }
      else if (c === 'sig') { var sb = $('[data-fc-sigbody]', el), unfold = sb.hidden; sb.hidden = !unfold; b.setAttribute('aria-expanded', unfold ? 'true' : 'false'); b.title = unfold ? 'Fold the signature' : 'Show the signature'; }
      else if (c === 'sigoff') { w.sigOn = w.sigOn === false; var box = $('[data-fc-sigbox]', el); box.classList.toggle('is-off', !w.sigOn); $('[data-fc-sigt]', el).textContent = w.sigOn ? 'Signature' : 'Signature off'; b.textContent = w.sigOn ? 'Leave it off' : 'Put it back'; changed(w); }
      else if (c === 'insert') insertMenu(w, b);
      else if (c === 'full') setMode(w, w.mode === 'full' ? (w.prevMode || 'float') : 'full');
      else if (c === 'cc') { w.showCc = true; $('.fc-cc', el).hidden = false; b.hidden = true; $('[data-fc-addr="cc"]', el).focus(); }
      else if (c === 'fields') { el.querySelector('.fc-fields').classList.add('is-open'); var inp = $('[data-fc-addr="to"]', el); inp.focus(); }
      else if (c === 'quote') { w.quoteOpen = !w.quoteOpen; $('[data-fc-q]', el).hidden = !w.quoteOpen; b.setAttribute('aria-expanded', w.quoteOpen ? 'true' : 'false'); b.setAttribute('aria-label', w.quoteOpen ? 'Hide the earlier message' : 'Show the earlier message'); writeStore(); }
      else if (c === 'attach') $('[data-fc-file]', el).click();
      else if (c === 'later') laterMenu(w, b);
      else if (c === 'drive') drivePick(w, b, '');
      else if (c === 'photos') drivePick(w, b, photoWords(w));
      else if (c === 'clips') clipPick(w, b);
      else if (c === 'templates') templatesMenu(w, b);
    });
    el.addEventListener('mousedown', function (e) { if (e.target.closest('[data-fc-fmt]')) e.preventDefault(); });
    el.addEventListener('focusin', function (e) {
      if (w.mode === 'min') return;
      w.touched = Date.now(); lastFocus = w;
      if (!e.target.closest('[data-fc-addr], .fc-sum') && el.querySelector('.fc-fields.is-open')) {
        if (!e.target.closest('.fc-fields')) { el.querySelector('.fc-fields').classList.remove('is-open'); sumLine(w); }
      }
    });
    el.addEventListener('input', function (e) {
      var inp = e.target.closest('[data-fc-addr]');
      if (inp) { if (/[,;\s]$/.test(inp.value)) commitTyped(w, inp); else suggest(w, inp); return; }
      if (e.target.closest('[data-fc-subj]')) { var t = $('[data-fc-title]', el); if (t) t.textContent = titleOf(w); }
      changed(w);
    });
    el.addEventListener('change', function (e) {
      if (e.target.matches('[data-fc-file]')) { addFiles(w, e.target.files); e.target.value = ''; }
      else if (e.target.matches('[data-fc-from]')) { w.from = e.target.value; changed(w); }
    });
    el.addEventListener('focusout', function (e) {
      var inp = e.target.closest && e.target.closest('[data-fc-addr]');
      if (inp) setTimeout(function () { if (document.activeElement !== inp && inp.value.trim()) commitTyped(w, inp); var box = $('[data-fc-sug]', inp.closest('.fc-row')); if (box && document.activeElement !== inp) box.hidden = true; }, 160);
    });
    el.addEventListener('keydown', function (e) { onKey(w, e); });
    el.addEventListener('keyup', function () { keepRange(w); });
    el.addEventListener('mouseup', function () { keepRange(w); });
    el.addEventListener('paste', function (e) { onPaste(w, e); });
    wireDrag(w);
    wireResize(w);
    wireDrop(w);
  }
  function keepRange(w) {
    var s = getSelection(), ed = $('[data-fc-ed]', w.el);
    if (s && s.rangeCount && ed.contains(s.anchorNode)) w.range = s.getRangeAt(0).cloneRange();
  }

  function onKey(w, e) {
    var k = e.key, mod = e.metaKey || e.ctrlKey;
    var inp = e.target.closest && e.target.closest('[data-fc-addr]');
    if (inp) {
      var row = inp.closest('.fc-row'), box = $('[data-fc-sug]', row), list = box._list || [];
      if (!box.hidden && list.length && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); box._hi = ((box._hi || 0) + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length; drawSug(box); return; }
      if (!box.hidden && list.length && (k === 'Enter' || k === 'Tab') && !mod) { e.preventDefault(); pickSug(w, row, box._hi || 0); return; }
      if ((k === 'Enter' || k === ',' || k === ';') && inp.value.trim() && !mod) { e.preventDefault(); commitTyped(w, inp); return; }
      if (k === 'Backspace' && !inp.value) { var last = $$('.fc-chip', row).pop(); if (last) { last.remove(); changed(w); sumLine(w); } return; }
      if (k === 'Escape' && !box.hidden) { e.preventDefault(); e.stopPropagation(); box.hidden = true; return; }
    }
    if (mod && k === 'Enter') { e.preventDefault(); e.stopPropagation(); send(w); return; }
    if (k === 'Escape') {
      e.stopPropagation();
      var pop = $('.fc-pop', w.el);
      if (pop) { e.preventDefault(); closePop(w); return; }
      e.preventDefault();
      closeWin(w);
      return;
    }
    if (mod && !e.shiftKey && /^[biuk]$/i.test(k) && e.target.closest('[contenteditable="true"]')) {
      e.preventDefault();
      fmt(w, { b: 'bold', i: 'italic', u: 'underline', k: 'link' }[k.toLowerCase()]);
      return;
    }
    if (mod && e.shiftKey && (k === '7' || k === '8') && e.target.closest('[contenteditable="true"]')) { e.preventDefault(); fmt(w, k === '7' ? 'insertOrderedList' : 'insertUnorderedList'); return; }
    // Keys typed here never reach Mail's shortcuts (r, a, f, e, #).
    e.stopPropagation();
  }

  function fmt(w, cmd) {
    var ed = $('[data-fc-ed]', w.el);
    if (!w.el.contains(document.activeElement) || !document.activeElement.isContentEditable) { ed.focus(); if (w.range) { var s = getSelection(); s.removeAllRanges(); s.addRange(w.range); } }
    if (cmd === 'link') {
      var sel = getSelection(), keep = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      var u = window.prompt('Link address');
      if (!u) return;
      u = /^(https?:|mailto:)/i.test(u) ? u : 'https://' + u;
      ed.focus(); if (keep) { sel.removeAllRanges(); sel.addRange(keep); }
      if (keep && keep.collapsed) document.execCommand('insertHTML', false, '<a href="' + esc(u) + '">' + esc(u) + '</a>');
      else document.execCommand('createLink', false, u);
    } else document.execCommand(cmd);
    changed(w);
  }

  // Pasted rich text keeps its words, links, lists and tables, without the page's colors, fonts and classes.
  function onPaste(w, e) {
    var t = e.target.closest && e.target.closest('[contenteditable="true"]');
    if (!t || !e.clipboardData) return;
    var files = e.clipboardData.files;
    if (files && files.length) { e.preventDefault(); addFiles(w, files); return; }
    var html = e.clipboardData.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, cleanHtml(html));
    changed(w);
  }
  var ALLOWED = { A: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, P: 1, DIV: 1, BR: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, H1: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, SPAN: 1, IMG: 1, CODE: 1, PRE: 1, HR: 1, SMALL: 1, CAPTION: 1 };
  function cleanHtml(html) {
    var d = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var walk = function (n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 8) { c.remove(); return; }
        if (c.nodeType !== 1) return;
        if (/^(SCRIPT|STYLE|META|LINK|TITLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|SVG|NOSCRIPT)$/.test(c.nodeName)) { c.remove(); return; }
        walk(c);
        if (!ALLOWED[c.nodeName]) { while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c); c.remove(); return; }
        Array.prototype.slice.call(c.attributes).forEach(function (a) {
          var keep = (c.nodeName === 'A' && a.name === 'href' && /^(https?:|mailto:)/i.test(a.value)) || (c.nodeName === 'IMG' && (a.name === 'alt' || (a.name === 'src' && /^https:/i.test(a.value)))) || ((c.nodeName === 'TD' || c.nodeName === 'TH') && (a.name === 'colspan' || a.name === 'rowspan'));
          if (!keep) c.removeAttribute(a.name);
        });
        if (c.nodeName === 'TABLE') c.setAttribute('style', TABLE_STYLE);
        if (c.nodeName === 'TD' || c.nodeName === 'TH') c.setAttribute('style', c.nodeName === 'TH' ? TH_STYLE : TD_STYLE);
      });
    };
    walk(d.body);
    return d.body.innerHTML;
  }

  /* ------------------------------------------------------------------ recipients */
  function commitTyped(w, inp) {
    var parts = inp.value.split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean), left = [];
    var have = chips(w, inp.dataset.fcAddr).map(function (a) { return a.email; });
    parts.forEach(function (p) { if (EMAIL.test(p)) { if (have.indexOf(p.toLowerCase()) < 0) inp.insertAdjacentHTML('beforebegin', chipHtml({ email: p.toLowerCase(), name: '' })); } else left.push(p); });
    inp.value = left.join(' ');
    var box = $('[data-fc-sug]', inp.closest('.fc-row')); if (box) { box.hidden = true; box._seq = (box._seq || 0) + 1; }
    changed(w); sumLine(w);
  }
  var sugT = 0;
  function suggest(w, inp) {
    var row = inp.closest('.fc-row'), box = $('[data-fc-sug]', row), q = inp.value.trim();
    clearTimeout(sugT);
    var mine = box._seq = (box._seq || 0) + 1;
    if (!q) { box.hidden = true; return; }
    sugT = setTimeout(function () {
      api.contacts(q).then(function (d) {
        if (mine !== box._seq || inp.value.trim() !== q) return;
        var have = chips(w, inp.dataset.fcAddr).map(function (a) { return a.email; });
        box._list = (d.people || []).filter(function (p) { return have.indexOf(p.email) < 0; }).slice(0, 8);
        box._hi = 0;
        drawSug(box);
      }).catch(function () { box.hidden = true; });
    }, 140);
  }
  function drawSug(box) {
    var list = box._list || [];
    box.innerHTML = list.map(function (p, i) {
      return '<button type="button" role="option" aria-selected="' + (i === box._hi) + '" class="fc-sug__i' + (i === box._hi ? ' is-on' : '') + '" data-fc-sugi="' + i + '"><span class="fc-av">' + (p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(((p.name || p.email).match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase())) + '</span><span class="fc-sug__t"><b>' + esc(p.name || p.email) + '</b><small>' + esc(p.email) + (p.title ? ', ' + esc(p.title) : '') + '</small></span>' + (p.kind === 'staff' ? '<em>Staff</em>' : '') + '</button>';
    }).join('');
    box.hidden = !list.length;
  }
  function pickSug(w, row, i) {
    var box = $('[data-fc-sug]', row), p = box._list && box._list[i]; if (!p) return;
    var inp = $('[data-fc-addr]', row);
    inp.insertAdjacentHTML('beforebegin', chipHtml({ email: p.email, name: p.name }));
    inp.value = ''; box.hidden = true; box._seq = (box._seq || 0) + 1; inp.focus();
    changed(w); sumLine(w);
  }

  /* ------------------------------------------------------------------ drafts */
  function collect(w) {
    ['to', 'cc', 'bcc'].forEach(function (k) { var inp = $('[data-fc-addr="' + k + '"]', w.el); if (inp && inp.value.trim()) commitTyped(w, inp); });
    var ed = $('[data-fc-ed]', w.el), q = $('[data-fc-q]', w.el);
    var out = { to: chips(w, 'to'), cc: chips(w, 'cc'), bcc: chips(w, 'bcc'), subject: $('[data-fc-subj]', w.el).value, html: ed.innerHTML + sigHtml(w) + (q ? q.innerHTML : ''), threadId: w.o.threadId || '', replyTo: w.o.replyTo || '', draftId: w.draftId, mb: w.mb || '' };
    if (w.from) { var p = w.from.split('|'); out.mb = CTX && p[0] === CTX.me ? '' : p[0]; out.from = p[1]; }
    return out;
  }
  function changed(w) {
    w.dirty = true;
    clearTimeout(w.saveT);
    writeStore();
    var mark = $('[data-fc-saved]', w.el); if (mark && mark.textContent === 'Saved') mark.textContent = '';
    if (CTX && CTX.write) w.saveT = setTimeout(function () { saveDraft(w); }, 2500);
  }
  function saveDraft(w) {
    if (w.sent || w.gone || !w.dirty) return Promise.resolve();
    var b = collect(w);
    var ed = $('[data-fc-ed]', w.el), clone = ed.cloneNode(true);
    $$('[data-sig], .gmail_signature', clone).forEach(function (s) { s.remove(); });
    if (!b.to.length && !b.cc.length && !b.subject.trim() && !clone.textContent.trim()) return Promise.resolve();
    w.dirty = false;
    var mark = $('[data-fc-saved]', w.el); if (mark) mark.textContent = 'Saving';
    w.saving = api.saveDraft({ to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html, threadId: b.threadId, replyTo: b.replyTo, draftId: b.draftId, mb: b.mb, from: b.from })
      .then(function (d) { w.draftId = d.draftId; if (mark) mark.textContent = 'Saved'; writeStore(); emit('draft', { id: w.id, draftId: d.draftId, threadId: b.threadId }); })
      .catch(function () { w.dirty = true; if (mark) mark.textContent = 'Not saved'; });
    return w.saving;
  }

  function closeWin(w, opts) {
    opts = opts || {};
    if (w.gone) return;
    clearTimeout(w.saveT);
    var empty = isBlank(w);
    var after = w.dirty && !empty ? saveDraft(w) : Promise.resolve();
    var snap = snapOf(w), files = w.files.slice();
    if (empty && w.draftId) api.dropDraft(w.draftId, w.mb).catch(function () {});
    finish(w);
    if (!empty && !opts.silent) after.then(function () { snap.draftId = w.draftId; toast('Draft saved', { action: ['Open', function () { reopen(snap, files); }] }); });
  }
  function isBlank(w) {
    var ed = $('[data-fc-ed]', w.el), clone = ed.cloneNode(true);
    $$('[data-sig], .gmail_signature', clone).forEach(function (s) { s.remove(); });
    var subj = $('[data-fc-subj]', w.el).value.trim();
    var reply = !!w.o.threadId;
    return !clone.textContent.trim() && !clone.querySelector('img,table,a') && !w.files.length && (reply || (!subj && !chips(w, 'to').length));
  }
  function finish(w) {
    w.gone = true;
    clearTimeout(w.saveT);
    phoneOverlay(w, false);
    var el = w.el, host = w.mode === 'inline' ? w.host : null;
    el.classList.add('is-leaving');
    var done = function () { el.remove(); if (host) host.classList.remove('has-c'); cover(); };
    if (host) { done(); } else setTimeout(done, 170);
    WINS = WINS.filter(function (x) { return x !== w; });
    sideLayout(); lift();
    filesPut(w.id, null);
    phoneOverlay({}, false);
    writeStore();
    emit('close', { id: w.id, threadId: w.o.threadId || '' });
  }
  // Discard deletes the Gmail draft at once (waiting for a save still on its way), clears this browser's copy and closes the
  // window. Undo writes it back as a new draft.
  function discard(w) {
    var snap = snapOf(w), mb = w.mb, pend = w.saving, files = w.files.slice(), threadId = w.o.threadId || '';
    w.sent = true;
    clearTimeout(w.saveT);
    finish(w);
    var gone = (pend || Promise.resolve()).catch(function () {}).then(function () {
      var id = w.draftId || snap.draftId;
      return id ? api.dropDraft(id, mb).catch(function (e) { if (e.status !== 404) throw e; }) : null;
    });
    gone.then(function () { emit('discarded', { threadId: threadId }); }).catch(function (e) { toast(e.message || 'The draft was not deleted. Try again.'); });
    toast('Draft discarded', { undo: function () { gone.then(function () { snap.draftId = ''; snap.dirty = true; reopen(snap, files).then(function (id) { var x = byId(id); if (x) changed(x); }); }); }, ms: 8000 });
  }
  function reopen(snap, files) {
    var o = Object.assign({}, snap, { id: uid(), mode: 'float', files: files || [], noSig: true, title: snap.title, kind: snap.kind, side: !!snap.side });
    if (snap.wasInline && snap.threadId) {
      var host = findHost(snap.threadId);
      if (host && !isPhone()) { o.mode = 'inline'; o.host = host; }
    }
    return css().then(function () { return make(o); });
  }
  // Mail tells the composer where a conversation's inline reply goes.
  var HOSTS = {};
  function findHost(threadId) { var h = HOSTS[threadId]; return h && h.isConnected ? h : null; }

  /* ------------------------------------------------------------------ files */
  function readFile(file) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: String(r.result).split(',')[1] || '' }); };
      r.onerror = no;
      r.readAsDataURL(file);
    });
  }
  function addFiles(w, list) {
    var arr = Array.prototype.slice.call(list || []);
    if (!arr.length) return;
    var total = w.files.reduce(function (n, f) { return n + f.size; }, 0) + arr.reduce(function (n, f) { return n + f.size; }, 0);
    if (total > MAX_FILES) { toast('Files can add up to 24 MB. Link a big file from Drive instead.'); return; }
    Promise.all(arr.map(readFile)).then(function (add) {
      w.files = w.files.concat(add);
      renderFiles(w);
      filesPut(w.id, w.files);
      changed(w);
    }).catch(function () { toast('That file did not open.'); });
  }
  function renderFiles(w) {
    var box = $('[data-fc-files]', w.el);
    var all = (w.forward || []).map(function (f, i) { return { f: f, k: 'w' + i }; }).concat(w.files.map(function (f, i) { return { f: f, k: 'u' + i }; }));
    box.innerHTML = all.map(function (x) { return '<span class="fc-file">' + ic('file') + '<span>' + esc(x.f.name) + '</span><small>' + esc(size(x.f.size)) + '</small><button type="button" data-fc-unfile="' + x.k + '" aria-label="Remove ' + esc(x.f.name) + '">' + ic('x') + '</button></span>'; }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('[data-fc-unfile]'); if (!b) return;
      var k = b.dataset.fcUnfile, i = +k.slice(1);
      if (k[0] === 'w') w.forward.splice(i, 1); else w.files.splice(i, 1);
      renderFiles(w); filesPut(w.id, w.files); changed(w);
    };
  }

  /* ------------------------------------------------------------------ moving and sizing a floating window */
  function wireDrag(w) {
    var head = $('[data-fc-drag]', w.el);
    head.addEventListener('pointerdown', function (e) {
      if (isPhone() || w.mode === 'inline' || w.mode === 'full' || w.mode === 'min' || e.button !== 0) return;
      if (e.target.closest('.fc-head__acts')) return;
      // No text selection while dragging, and the caret stays where it was. (user-select: none on a window that holds the
      // focused editor crashed Edge's renderer, so the pointer is captured instead.)
      e.preventDefault();
      try { head.setPointerCapture(e.pointerId); } catch (er) { /* old browser */ }
      var r = w.el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, moved = false;
      var mv = function (ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        if (!moved) {
          moved = true;
          w.free = { x: r.left, y: r.top, w: r.width, h: r.height };
          w.el.classList.add('is-dragging');
          place(w);
        }
        w.free.x = clamp(r.left + dx, 8 - r.width + 120, innerWidth - 120);
        w.free.y = clamp(r.top + dy, 8, innerHeight - 48);
        w.el.style.left = w.free.x + 'px'; w.el.style.top = w.free.y + 'px';
      };
      var up = function () {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up); head.removeEventListener('lostpointercapture', up);
        if (moved) { w.dragged = true; w.el.classList.remove('is-dragging'); place(w); writeStore(); setTimeout(function () { w.dragged = false; }, 50); }
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); head.addEventListener('lostpointercapture', up);
    });
  }
  function wireResize(w) {
    $$('[data-fc-rz]', w.el).forEach(function (h) {
      h.addEventListener('pointerdown', function (e) {
        if (isPhone() || w.mode !== 'float' || e.button !== 0) return;
        e.preventDefault();
        // The pointer is captured: without it, moving over a message (a frame with its own document) took the moves and the
        // release away from the page and the window kept resizing.
        try { h.setPointerCapture(e.pointerId); } catch (er) { /* old browser */ }
        var r = w.el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, dir = h.dataset.fcRz;
        var docked = !w.free;
        w.el.classList.add('is-sizing');
        var mv = function (ev) {
          var dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (docked) {
            // Docked windows grow up and to the left; their bottom right corner stays on the dock.
            if (dir.indexOf('w') >= 0) w.dockW = clamp(r.width - dx, 380, innerWidth - 40);
            if (dir.indexOf('n') >= 0) w.dockH = clamp(r.height - dy, 280, innerHeight - 24);
            w.el.style.width = (w.dockW || r.width) + 'px';
            w.el.style.height = (w.dockH || r.height) + 'px';
          } else {
            var f = w.free;
            if (dir.indexOf('e') >= 0) f.w = clamp(r.width + dx, 360, innerWidth - r.left - 8);
            if (dir.indexOf('s') >= 0) f.h = clamp(r.height + dy, 260, innerHeight - r.top - 8);
            if (dir.indexOf('w') >= 0) { f.w = clamp(r.width - dx, 360, r.right - 8); f.x = r.right - f.w; }
            if (dir.indexOf('n') >= 0) { f.h = clamp(r.height - dy, 260, r.bottom - 8); f.y = r.bottom - f.h; }
            w.el.style.left = f.x + 'px'; w.el.style.top = f.y + 'px'; w.el.style.width = f.w + 'px'; w.el.style.height = f.h + 'px';
          }
        };
        var up = function () { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); h.removeEventListener('lostpointercapture', up); w.el.classList.remove('is-sizing'); writeStore(); cover(); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); h.addEventListener('lostpointercapture', up);
      });
    });
  }

  /* ------------------------------------------------------------------ drag and drop in */
  var dragDepth = 0;
  function dtKind(dt) {
    if (!dt) return '';
    var t = Array.prototype.slice.call(dt.types || []);
    if (t.indexOf(ITEM_TYPE) >= 0) return 'item';
    if (t.indexOf('Files') >= 0) return 'files';
    if (t.indexOf('text/uri-list') >= 0) return 'link';
    return '';
  }
  function wireDrop(w) {
    var el = w.el, ov = $('.fc-drop', el), depth = 0;
    el.addEventListener('dragenter', function (e) {
      var k = dtKind(e.dataTransfer); if (!k) return;
      e.preventDefault(); depth++;
      $('[data-fc-droptxt]', ov).textContent = k === 'files' ? 'Drop to attach' : 'Drop to add to this email';
      ov.hidden = false;
      if (w.mode === 'min') setMode(w, restoreMode(w), { focus: false });
    });
    el.addEventListener('dragover', function (e) { if (dtKind(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    el.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; });
    el.addEventListener('drop', function (e) {
      var k = dtKind(e.dataTransfer); if (!k) return;
      e.preventDefault(); e.stopPropagation();
      depth = 0; ov.hidden = true; hideDropStart();
      takeDrop(w, e.dataTransfer, k, e);
    });
  }
  // Where a dropped item goes in the text: between paragraphs (before the one under the pointer when it is on its upper half,
  // after it otherwise), never in the middle of a line. Below everything written: at the end.
  function dropRange(ed, x, y) {
    var n = document.elementFromPoint(x, y);
    if (!n || !ed.contains(n)) return null;
    while (n && n.parentNode !== ed) n = n.parentNode;
    var r = document.createRange();
    if (!n || n === ed) { r.selectNodeContents(ed); r.collapse(false); return r; }
    var b = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    if (b && y < b.top + b.height / 2) r.setStartBefore(n); else r.setStartAfter(n);
    r.collapse(true);
    return r;
  }
  function takeDrop(w, dt, k, e) {
    if (k === 'files') return addFiles(w, dt.files);
    if (k === 'item') {
      var it = null;
      try { it = JSON.parse(dt.getData(ITEM_TYPE)); } catch (er) { it = null; }
      if (it) {
        // Dropped onto the text: it goes where the pointer is.
        var ed = $('[data-fc-ed]', w.el);
        if (e && ed.contains(e.target)) { var r = dropRange(ed, e.clientX, e.clientY); if (r) w.range = r; }
        insertItem(w, it);
      }
      return;
    }
    var url = (dt.getData('text/uri-list') || '').split('\n').filter(function (x) { return x && x[0] !== '#'; })[0];
    if (url) insertItem(w, { kind: 'link', title: dt.getData('text/plain') && dt.getData('text/plain') !== url ? dt.getData('text/plain') : url, url: url });
  }
  // A FavorOS item dragged with no window open: a target at the bottom right starts a new email.
  function wireDropStart() {
    document.addEventListener('dragenter', function (e) {
      if (dtKind(e.dataTransfer) !== 'item') return;
      dragDepth++;
      if (!WINS.some(function (w) { return !w.gone && w.mode !== 'min'; }) && mayMail()) { dropEl.hidden = false; dropEl.classList.add('is-big'); requestAnimationFrame(function () { dropEl.classList.add('is-in'); }); }
    });
    document.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDropStart(); });
    document.addEventListener('dragend', function () { dragDepth = 0; hideDropStart(); });
    document.addEventListener('drop', function () { dragDepth = 0; setTimeout(hideDropStart, 0); });
    dropEl.addEventListener('dragover', function (e) { if (dtKind(e.dataTransfer) === 'item') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropEl.classList.add('is-hot'); } });
    dropEl.addEventListener('dragleave', function () { dropEl.classList.remove('is-hot'); });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault();
      var it = null; try { it = JSON.parse(e.dataTransfer.getData(ITEM_TYPE)); } catch (er) { it = null; }
      hideDropStart();
      if (it) add(it, { fresh: true });
    });
  }
  function hideDropStart() { if (!dropEl) return; dropEl.classList.remove('is-in', 'is-hot'); setTimeout(function () { if (!dropEl.classList.contains('is-in')) { dropEl.hidden = true; dropEl.classList.remove('is-big'); } }, 160); }

  /* ------------------------------------------------------------------ FavorOS items as email HTML */
  var TABLE_STYLE = 'border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;margin:6px 0 10px';
  var TH_STYLE = 'border:1px solid #d9d5c7;background:#f4f1e8;padding:6px 10px;text-align:left;font-weight:bold';
  var TD_STYLE = 'border:1px solid #d9d5c7;padding:6px 10px;text-align:left;vertical-align:top';
  function cell(v) { return v == null ? '' : typeof v === 'object' ? (v.text != null ? v.text : v.label != null ? v.label : JSON.stringify(v)) : String(v); }
  function tableHtml(rows) {
    var cols = (rows.columns || []).map(function (c) { return typeof c === 'object' ? (c.label || c.key || '') : c; });
    var keys = (rows.columns || []).map(function (c) { return typeof c === 'object' ? c.key : null; });
    var al = function (i) { return rows.align && rows.align[i] === 'right' ? ';text-align:right' : ''; };
    var body = (rows.rows || []).map(function (r) {
      var vals = Array.isArray(r) ? r : keys.map(function (k, i) { return k != null ? r[k] : r[cols[i]]; });
      return '<tr>' + vals.map(function (v, i) { return '<td style="' + TD_STYLE + al(i) + '">' + esc(cell(v)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table style="' + TABLE_STYLE + '" cellpadding="0" cellspacing="0"><thead><tr>' + cols.map(function (c, i) { return '<th style="' + TH_STYLE + al(i) + '">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
  }
  function csvOf(rows) {
    var q = function (v) { v = cell(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var cols = (rows.columns || []).map(function (c) { return typeof c === 'object' ? (c.label || c.key || '') : c; });
    var keys = (rows.columns || []).map(function (c) { return typeof c === 'object' ? c.key : null; });
    var lines = [cols.map(q).join(',')].concat((rows.rows || []).map(function (r) { var vals = Array.isArray(r) ? r : keys.map(function (k, i) { return k != null ? r[k] : r[cols[i]]; }); return vals.map(q).join(','); }));
    return lines.join('\r\n');
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  var slug = function (s) { return String(s || 'list').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'list'; };
  function textHtml(t) { return String(t || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join(''); }
  var abs = function (u) { try { return new URL(u, location.origin).href; } catch (e) { return u; } };

  /* When an item's numbers were true: the Blackbaud copy's sync time when the answer showed one, else when it was given. */
  function asOfText(it) {
    var d = new Date(it.asOf || Date.now());
    if (!isFinite(d.getTime())) d = new Date();
    var o = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
    try { return d.toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o)) + ' ET'; } catch (e) { return d.toLocaleString('en-US', o); }
  }
  var SRC_STYLE = 'margin:10px 0 0;color:#666b60;font-size:12px';
  function rowsCount(it) { return it.rows && it.rows.rows ? it.rows.rows.length : 0; }

  /** The HTML an item becomes, plus files it brings along. Returns {refused} when it may not go by email. */
  function itemParts(it) {
    if (it.partner && !it.mayShare) return { refused: 'This has partner details you are not cleared to share. Ask Favor Brain for a summary without partner details.' };
    var title = it.title ? '<p style="margin:0 0 6px"><b>' + esc(it.title) + '</b></p>' : '';
    var link = it.url ? abs(it.url) : '';
    var files = [], html = '';
    if (it.kind === 'brain') {
      // A short title line, the headline number, the table (a CSV file past 40 rows), and where it came from.
      html = title;
      if (it.headline && it.headline.value) html += '<p style="margin:0 0 10px"><span style="font-size:20px;font-weight:bold">' + esc(it.headline.value) + '</span>' + (it.headline.label ? ' ' + esc(it.headline.label) : '') + '</p>';
      var n = rowsCount(it);
      if (n) {
        if (it.rows.title) html += '<p style="margin:8px 0 2px;font-weight:bold">' + esc(it.rows.title) + '</p>';
        if (n > TABLE_ROWS) {
          var name = slug(it.rows.title || it.title) + '.csv', data = csvOf(it.rows);
          files.push({ name: name, mime: 'text/csv', size: data.length, data: b64(data) });
          html += '<p style="margin:0 0 8px">The full list (' + n.toLocaleString('en-US') + ' rows) is attached as ' + esc(name) + '.</p>';
        } else html += tableHtml(it.rows);
      }
      if (!n && !(it.headline && it.headline.value)) html += it.html ? cleanHtml(it.html) : textHtml(it.text);
      html += '<p style="' + SRC_STYLE + '">Source: Favor Brain, as of ' + esc(asOfText(it)) + '</p>';
      return { html: '<div>' + html + '</div>', files: files, csv: n > TABLE_ROWS ? null : it.csv || null };
    }
    if (it.kind === 'clip') return { html: '<p><a href="' + esc(link) + '">' + esc(it.title || 'Clip') + '</a>' + (it.sub ? ' (' + esc(it.sub) + ')' : '') + '</p>' + (it.text ? textHtml(it.text) : ''), files: [] };
    if (it.kind === 'task') return { html: '<p><a href="' + esc(link) + '">' + esc(it.title || 'Task') + '</a>' + (it.sub ? '<br><span style="color:#5d6357">' + esc(it.sub) + '</span>' : '') + '</p>' + (it.text ? textHtml(it.text) : ''), files: [] };
    if (it.kind === 'meeting') return { html: title + (it.html ? cleanHtml(it.html) : textHtml(it.text)) + (link ? '<p><a href="' + esc(link) + '">Open the meeting notes</a></p>' : ''), files: [] };
    if (it.kind === 'drive' || it.kind === 'link') return { html: '<p><a href="' + esc(link) + '">' + esc(it.title || link) + '</a>' + (it.sub ? ' (' + esc(it.sub) + ')' : '') + '</p>', files: [] };
    return { html: title + (it.html ? cleanHtml(it.html) : textHtml(it.text)) + (link ? '<p><a href="' + esc(link) + '">' + esc(link) + '</a></p>' : ''), files: [] };
  }
  /** The same item as plain text, for a text box that is not an email (a Chat message, a task note, the Brain's own ask bar). */
  function itemText(it) {
    it = it || {};
    if (it.partner && !it.mayShare) return '';
    var out = [];
    var link = it.url ? abs(it.url) : '';
    if (it.kind === 'brain') {
      if (it.title) out.push(it.title);
      if (it.headline && it.headline.value) out.push(it.headline.value + (it.headline.label ? ' ' + it.headline.label : ''));
      var n = rowsCount(it);
      if (n) {
        var cols = (it.rows.columns || []).map(function (c) { return typeof c === 'object' ? (c.label || c.key || '') : c; });
        var keys = (it.rows.columns || []).map(function (c) { return typeof c === 'object' ? c.key : null; });
        out.push('');
        if (it.rows.title) out.push(it.rows.title);
        out.push(cols.join(' | '));
        it.rows.rows.slice(0, TABLE_ROWS).forEach(function (r) { var vals = Array.isArray(r) ? r : keys.map(function (k, i) { return k != null ? r[k] : r[cols[i]]; }); out.push(vals.map(cell).join(' | ')); });
        if (n > TABLE_ROWS) out.push('and ' + (n - TABLE_ROWS).toLocaleString('en-US') + ' more rows in Favor Brain');
      }
      if (!n && !(it.headline && it.headline.value) && it.text) out.push(String(it.text));
      out.push('Source: Favor Brain, as of ' + asOfText(it));
      return out.join('\n');
    }
    // A clip, task, meeting or link: its name and its address (the text only when there is no address).
    if (it.title) out.push(it.title + (it.sub ? ' (' + it.sub + ')' : ''));
    if (link) out.push(link);
    else if (it.text) out.push(String(it.text));
    return out.join('\n');
  }
  // Files an item brings, and a Brain list's file (its link opens only for the person who asked, so the file goes along).
  function attachParts(w, p, it) {
    if (p.files && p.files.length) { w.files = w.files.concat(p.files); renderFiles(w); filesPut(w.id, w.files); }
    if (p.csv && p.csv.url && /^\/api\/brain\/csv\//.test(new URL(p.csv.url, location.origin).pathname)) {
      fetch(p.csv.url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('csv'); return r.text(); }).then(function (t) {
        var name = p.csv.name || slug(it.title) + '.csv';
        w.files = w.files.concat([{ name: /\.csv$/i.test(name) ? name : name + '.csv', mime: 'text/csv', size: t.length, data: b64(t) }]);
        renderFiles(w); filesPut(w.id, w.files); changed(w);
      }).catch(function () { toast('The list file did not come along. Download it from Brain and attach it.'); });
    }
  }
  function insertItem(w, it) {
    var p = itemParts(it || {});
    if (p.refused) { toast(p.refused, { ms: 6000 }); return false; }
    insertHtml(w, p.html + '<div><br></div>');
    attachParts(w, p, it);
    return true;
  }
  function insertHtml(w, html) {
    var ed = $('[data-fc-ed]', w.el);
    var r = w.range && ed.contains(w.range.startContainer) ? w.range : null;
    ed.focus({ preventScroll: true });
    if (!r) {
      // No caret yet: before the signature, after what is written.
      r = document.createRange();
      var sig = $('[data-sig], .gmail_signature', ed);
      var anchor = sig ? sig.previousElementSibling && sig.previousElementSibling.textContent.trim() === '' ? sig.previousElementSibling : sig : null;
      if (anchor) r.setStartBefore(anchor); else { r.selectNodeContents(ed); r.collapse(false); }
      r.collapse(true);
    }
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    if (!document.execCommand('insertHTML', false, html)) {
      var frag = r.createContextualFragment(html); r.insertNode(frag);
    }
    keepRange(w);
    changed(w);
  }

  /* ------------------------------------------------------------------ popovers inside a window (pickers, Send later, Send anyway) */
  function pop(w, title, html, anchor) {
    closePop(w);
    var el = document.createElement('div');
    el.className = 'fc-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = '<div class="fc-pop__head"><b>' + esc(title) + '</b><button type="button" class="fc-ib" data-fc-popx aria-label="Close">' + ic('x') + '</button></div><div class="fc-pop__body">' + html + '</div>';
    w.el.appendChild(el);
    if (anchor && !isPhone()) {
      var wr = w.el.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      el.style.left = clamp(ar.left - wr.left - 8, 8, Math.max(8, wr.width - 348)) + 'px';
    }
    el.addEventListener('click', function (e) { if (e.target.closest('[data-fc-popx]')) closePop(w); });
    requestAnimationFrame(function () { el.classList.add('is-in'); var f = el.querySelector('input:not([type=checkbox]), button:not([data-fc-popx])'); if (f) f.focus({ preventScroll: true }); });
    return el;
  }
  function closePop(w) {
    var p = $('.fc-pop', w.el); if (!p) return;
    if (p._stop) p._stop();
    p.remove();
    var ed = $('[data-fc-ed]', w.el); if (ed && w.el.isConnected) { ed.focus({ preventScroll: true }); if (w.range) { var s = getSelection(); s.removeAllRanges(); s.addRange(w.range); } }
  }
  function laterTimes() {
    var now = new Date(), at = function (d, h) { var x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
    var out = [];
    if (now.getHours() < 16) out.push(['This afternoon', at(0, 16)]);
    out.push(['Tomorrow morning', at(1, 8)], ['Tomorrow afternoon', at(1, 13)]);
    var mon = (8 - now.getDay()) % 7 || 7; out.push(['Monday morning', at(mon, 8)]);
    return out;
  }
  function laterMenu(w, anchor) {
    keepRange(w);
    var opts = laterTimes();
    var el = pop(w, 'Send later', '<div class="fc-menu">' + opts.map(function (o, k) { return '<button type="button" class="fc-menu__i" data-fc-lt="' + k + '">' + ic('clock') + '<span>' + esc(o[0]) + '</span><small>' + esc(o[1].toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</small></button>'; }).join('') +
      '<div class="fc-menu__pick"><label for="fc-lt-' + w.id + '">Pick a date and time</label><span><input id="fc-lt-' + w.id + '" type="datetime-local" class="fc-input" /><button type="button" class="fc-btn" data-fc-lt="pick">Schedule</button></span></div>' +
      '<label class="fc-check"><input type="checkbox" data-fc-remind checked /><span>Remind me if there is no reply in 3 days</span></label></div>', anchor);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fc-lt]'); if (!b) return;
      var at = b.dataset.fcLt === 'pick' ? new Date($('input[type=datetime-local]', el).value) : opts[+b.dataset.fcLt][1];
      if (!at || !isFinite(at.getTime()) || at < new Date(Date.now() + 60000)) { toast('Pick a time later than now'); return; }
      if (w.files.length || (w.forward && w.forward.length)) { toast('A message with files cannot wait. Send it now.'); return; }
      var body = collect(w);
      if (!body.to.length && !body.cc.length && !body.bcc.length) { closePop(w); toast('Add who it goes to'); $('[data-fc-addr="to"]', w.el).focus(); return; }
      body.sendAt = at.toISOString(); body.remindDays = $('[data-fc-remind]', el).checked ? 3 : 0;
      b.disabled = true;
      api.later(body).then(function () {
        w.sent = true;
        if (w.draftId) api.dropDraft(w.draftId, body.mb).catch(function () {});
        finish(w);
        toast('Scheduled for ' + at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }), { action: ['See scheduled', function () { location.href = '/mail/#/SCHEDULED'; }] });
        emit('scheduled', { threadId: body.threadId });
      }).catch(function (er) { b.disabled = false; toast(er.message); });
    });
  }
  function photoWords(w) {
    var s = $('[data-fc-subj]', w.el).value;
    return (s.replace(/^(re|fwd?):\s*/gi, '').replace(/[^\w\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 3; }).slice(0, 4).join(' ') || 'photos') + ' photo';
  }
  function drivePick(w, anchor, first) {
    keepRange(w);
    var el = pop(w, first ? 'Photos from the Drive library' : 'Link a Drive file', '<input class="fc-input" data-fc-dq placeholder="Search the Drive library" aria-label="Search the Drive library" autocomplete="off" /><div class="fc-pick" data-fc-dres><p class="fc-empty">Type to search</p></div>', anchor);
    var t = 0, q = $('[data-fc-dq]', el), res = $('[data-fc-dres]', el), items = [];
    var go = function () {
      clearTimeout(t);
      var v = q.value.trim();
      if (v.length < 2) { res.innerHTML = '<p class="fc-empty">Type to search</p>'; return; }
      t = setTimeout(function () {
        res.innerHTML = '<p class="fc-empty">Searching</p>';
        api.drive(v).then(function (d) {
          if (q.value.trim() !== v) return;
          items = d.files || [];
          res.innerHTML = items.length ? items.map(function (f, i) { return '<button type="button" class="fc-menu__i" data-fc-dpick="' + i + '">' + ic('drive') + '<span>' + esc(f.name) + '</span><small>' + esc(f.path || '') + '</small></button>'; }).join('') : '<p class="fc-empty">Nothing found</p>';
        }).catch(function (e) { res.innerHTML = '<p class="fc-empty">' + esc(e.message) + '</p>'; });
      }, 220);
    };
    q.addEventListener('input', go);
    if (first) { q.value = first; go(); }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fc-dpick]'); if (!b) return;
      var f = items[+b.dataset.fcDpick]; closePop(w);
      insertHtml(w, '<a href="' + esc(f.url) + '">' + esc(f.name) + '</a>&nbsp;');
    });
  }
  function clipPick(w, anchor) {
    keepRange(w);
    var el = pop(w, 'Link a clip', '<div class="fc-pick" data-fc-cres><p class="fc-empty">Loading</p></div>', anchor);
    var res = $('[data-fc-cres]', el), items = [];
    api.clips().then(function (d) {
      items = d.clips || [];
      res.innerHTML = items.length ? items.map(function (c, i) { return '<button type="button" class="fc-menu__i" data-fc-cpick="' + i + '">' + ic('rec') + '<span>' + esc(c.title) + '</span><small>' + esc([c.duration, c.when].filter(Boolean).join(', ')) + '</small></button>'; }).join('') : '<p class="fc-empty">No clips yet. Record one with the camera button at the top.</p>';
    }).catch(function (e) { res.innerHTML = '<p class="fc-empty">' + esc(e.message) + '</p>'; });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fc-cpick]'); if (!b) return;
      var c = items[+b.dataset.fcCpick]; closePop(w);
      insertItem(w, { kind: 'clip', title: c.title, url: c.url, sub: c.duration });
    });
  }
  // One Insert menu for what comes from elsewhere in FavorOS; Attach stays its own button.
  function insertMenu(w, anchor) {
    keepRange(w);
    var rows = [['drive', 'drive', 'A Drive file', 'Links it'], ['photos', 'image', 'Photos from Drive', 'From the photo library'], ['clips', 'rec', 'A clip', 'Your recorded clips'], ['templates', 'draft', 'A template', 'Saved messages']];
    var el = pop(w, 'Insert', '<div class="fc-menu" role="menu">' + rows.map(function (r) { return '<button type="button" role="menuitem" class="fc-menu__i" data-fc-ins="' + r[0] + '">' + ic(r[1]) + '<span>' + esc(r[2]) + '</span><small>' + esc(r[3]) + '</small></button>'; }).join('') + '</div>', anchor);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fc-ins]'); if (!b) return;
      var k = b.dataset.fcIns;
      if (k === 'drive') drivePick(w, anchor, '');
      else if (k === 'photos') drivePick(w, anchor, photoWords(w));
      else if (k === 'clips') clipPick(w, anchor);
      else templatesMenu(w, anchor);
    });
    el.addEventListener('keydown', function (e) { menuKeys(e, el); });
  }
  // Arrow keys move through a menu's items.
  function menuKeys(e, box) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var items = $$('.fc-menu__i, [data-fc-pick]', box); if (!items.length) return;
    e.preventDefault();
    var i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  function templatesMenu(w, anchor) {
    keepRange(w);
    var el = pop(w, 'Templates', '<p class="fc-empty">Loading</p>', anchor);
    var body = $('.fc-pop__body', el), list = [];
    var draw = function () {
      body.innerHTML = '<div class="fc-menu">' + (list.length ? list.map(function (t) { return '<div class="fc-menu__row"><button type="button" class="fc-menu__i" data-fc-tpl="' + esc(t.id) + '">' + ic('draft') + '<span>' + esc(t.name) + '</span></button></div>'; }).join('') : '<p class="fc-empty">No templates yet.</p>') + '</div>' +
        '<p class="fc-note">Fields fill from the person on the To line: {first_name}, {name}, {last_gift}, {last_gift_date}, {total_giving}, {my_name}.</p>' +
        '<form class="fc-form" data-fc-tplf><label for="fc-tn-' + w.id + '">Save this message as a template</label><span><input id="fc-tn-' + w.id + '" class="fc-input" name="name" maxlength="60" placeholder="Thank you for your gift" required /><button type="submit" class="fc-btn">Save</button></span></form>';
    };
    api.templates().then(function (d) { list = d.templates || []; draw(); }).catch(function (e) { body.innerHTML = '<p class="fc-empty">' + esc(e.message) + '</p>'; });
    el.addEventListener('click', function (e) {
      var u = e.target.closest('[data-fc-tpl]'); if (!u) return;
      var t = list.filter(function (x) { return x.id === u.dataset.fcTpl; })[0]; if (!t) return;
      api.fillTemplate(t.body, chips(w, 'to').map(function (x) { return x.email; })).then(function (r) { closePop(w); insertHtml(w, textHtml(r.text)); }).catch(function (er) { toast(er.message); });
    });
    el.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ($('[data-fc-ed]', w.el).innerText || '').trim();
      api.saveTemplate(e.target.name.value.trim(), text).then(function () { toast('Template saved'); closePop(w); }).catch(function (er) { toast(er.message); });
    });
  }
  function countdownOn() { try { return localStorage.getItem('favor.mail.countdown') !== 'off'; } catch (e) { return true; } }
  function warnSheet(w, warnings, go) {
    var left = 5, auto = countdownOn(), timer = 0, done = false;
    var el = pop(w, 'Send anyway?', '<ul class="fc-warn">' + warnings.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul>' +
      '<label class="fc-check"><input type="checkbox" data-fc-nocount' + (auto ? '' : ' checked') + ' /><span>Wait for me to press Send</span></label>' +
      '<div class="fc-acts"><button type="button" class="fc-btn fc-btn--primary" data-fc-fix>Fix it</button><button type="button" class="fc-btn" data-fc-now>' + (auto ? 'Send now (<span data-fc-left>' + left + '</span>)' : 'Send now') + '</button></div>', null);
    el.classList.add('fc-pop--warn');
    var stop = function () { done = true; clearInterval(timer); };
    el._stop = stop;
    if (auto) timer = setInterval(function () {
      if (done) return;
      left--; var n = $('[data-fc-left]', el); if (n) n.textContent = left;
      if (left <= 0) { stop(); el._stop = null; closePop(w); go(); }
    }, 1000);
    el.addEventListener('change', function (e) {
      if (!e.target.matches('[data-fc-nocount]')) return;
      try { localStorage.setItem('favor.mail.countdown', e.target.checked ? 'off' : 'on'); } catch (er) { /* private mode */ }
      auto = !e.target.checked;
      if (!auto) { clearInterval(timer); $('[data-fc-now]', el).textContent = 'Send now'; }
    });
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-fc-fix]')) { closePop(w); return; }
      if (e.target.closest('[data-fc-now]')) { stop(); el._stop = null; closePop(w); go(); }
    });
  }

  /* ------------------------------------------------------------------ sending */
  function send(w) {
    if (w.sending) return;
    var b = collect(w);
    if (!b.to.length && !b.cc.length && !b.bcc.length) { toast('Add who it goes to'); var fl = w.el.querySelector('.fc-fields'); if (fl) fl.classList.add('is-open'); $('[data-fc-addr="to"]', w.el).focus(); return; }
    var bad = b.to.concat(b.cc, b.bcc).filter(function (a) { return !EMAIL.test(a.email); })[0];
    if (bad) { toast(bad.email + ' is not an email address.'); return; }
    var big = w.files.reduce(function (n, f) { return n + f.size; }, 0);
    if (big > MAX_FILES) { toast('Files can add up to 24 MB. Link a big file from Drive instead.'); return; }
    w.sending = true;
    var btn = $('.fc-send', w.el); if (btn) btn.setAttribute('aria-busy', 'true');
    api.check({ to: b.to.map(function (x) { return x.email; }), cc: b.cc.map(function (x) { return x.email; }), bcc: b.bcc.map(function (x) { return x.email; }), subject: b.subject, html: b.html, files: w.files.length + (w.forward || []).length, threadId: b.threadId, mb: b.mb })
      .then(function (d) { return d.warnings || []; }).catch(function () { return []; })
      .then(function (list) {
        w.sending = false;
        if (btn) btn.removeAttribute('aria-busy');
        if (w.gone) return;
        if (!list.length) return hold(w);
        warnSheet(w, list, function () { hold(w); });
      });
  }
  function hold(w) {
    var b = collect(w);
    b.files = w.files.map(function (f) { return { name: f.name, mime: f.mime, data: f.data }; });
    b.forward = w.forward || [];
    var snap = snapOf(w), files = w.files.slice();
    w.sent = true;
    clearTimeout(w.saveT);
    finish(w);
    filesPut('p_' + w.id, files);
    var p = { id: '', mb: b.mb, until: Date.now() + HOLD_MS, snap: snap, body: b, wid: w.id, state: 'holding' };
    PENDING.push(p);
    showSending(p);
    api.hold(b).then(function (d) { p.id = d.id; p.state = 'held'; delete p.body; writeNow(); if (p.undone) undoHeld(p); })
      .catch(function () { p.state = 'local'; writeNow(); });
    writeNow();
    setTimeout(function () { releaseP(p); }, HOLD_MS);
  }
  function showSending(p) {
    toast('Sending', { undo: function () { p.undone = true; undoHeld(p); }, count: Math.max(0, p.until - Date.now()), ms: Math.max(1500, p.until - Date.now()) });
  }
  function undoHeld(p) {
    if (p.released) return;
    if (p.state === 'holding') return; // the hold answer arrives and calls back here
    var restore = function () {
      dropPending(p);
      filesGet('p_' + p.snap.id).then(function (files) { filesPut('p_' + p.snap.id, null); reopen(p.snap, files); });
    };
    if (p.state === 'local') { restore(); return; }
    api.cancelHold(p.id, p.mb).then(function (r) { if (r && r.undone === false) { dropPending(p); toast('It already went'); return; } restore(); }).catch(restore);
  }
  function releaseP(p) {
    if (p.undone || p.released || PENDING.indexOf(p) < 0) return;
    if (p.state === 'holding') { setTimeout(function () { releaseP(p); }, 400); return; }
    p.released = true;
    var go = p.state === 'local' && p.body ? api.send(p.body) : api.release(p.id, p.mb);
    go.then(function (d) {
      dropPending(p);
      filesPut('p_' + p.snap.id, null);
      toast('Sent', p.snap.threadId ? {} : { action: ['View', function () { location.href = '/mail/#/SENT'; }] });
      emit('sent', { threadId: (d && d.threadId) || p.snap.threadId, mb: p.mb });
    }).catch(function (e) {
      dropPending(p);
      toast(e.message || 'Not sent. Your draft is kept.', { action: ['Open draft', function () { filesGet('p_' + p.snap.id).then(function (files) { reopen(p.snap, files); }); }], ms: 10000 });
    });
  }
  function dropPending(p) { PENDING = PENDING.filter(function (x) { return x !== p; }); writeNow(); }

  /* ------------------------------------------------------------------ the public face */
  /* Send to email: with no draft open, a new email; with drafts open, a short list asks which one, New email first. Never a silent
     guess. opts: {anchor: the button pressed (the list opens beside it), from: where the item came from (a new email on a wide
     screen opens side by side with it), fresh: always a new email, target: a window id}. */
  function add(item, opts) {
    opts = opts || {};
    item = item || {};
    var parts = itemParts(item);
    if (parts.refused) { toast(parts.refused, { ms: 6000 }); return Promise.resolve(null); }
    if (!mayMail() && !CTX) { toast('Mail is not open for you yet.'); return Promise.resolve(null); }
    var target = opts.target ? byId(opts.target) : null;
    if (target && !target.gone) return Promise.resolve(addTo(target, item));
    var drafts = WINS.filter(function (w) { return !w.gone; }).sort(function (a, b) { return (b.touched || 0) - (a.touched || 0); });
    if (opts.fresh || !drafts.length) return startWith(item, opts);
    return choose(drafts, opts.anchor).then(function (pick) {
      if (!pick) return null;
      if (pick === 'new') return startWith(item, opts);
      var w = byId(pick);
      return w && !w.gone ? addTo(w, item) : startWith(item, opts);
    });
  }
  function addTo(w, item) {
    if (w.mode === 'min') setMode(w, restoreMode(w));
    if (insertItem(w, item)) toast('Added to email');
    return w.id;
  }
  function startWith(item, opts) {
    var mine = meEmail().toLowerCase();
    var inDock = !!(opts.from && opts.from.closest && opts.from.closest('#fd-p, .fd-p'));
    return open({ mode: 'float', side: sideOk() && !inDock, subject: item.subject || item.title || '', to: (item.to || []).filter(function (a) { return a && String(a.email || a).toLowerCase() !== mine; }), items: [item] })
      .then(function (id) { if (id) toast('Added to email'); return id; });
  }
  /* "Add to which email?": New email first, then the open drafts, newest first. Resolves 'new', a window id, or null. */
  var chooser = null;
  function choose(drafts, anchor) {
    if (chooser) chooser.done(null);
    ensureLayer();
    return css().then(function () {
      return new Promise(function (ok) {
        var el = document.createElement('div');
        el.className = 'fc-choose';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Add to which email?');
        el.innerHTML = '<p class="fc-choose__h">Add to which email?</p><div class="fc-choose__list" role="menu">' +
          '<button type="button" role="menuitem" class="fc-choose__i is-new" data-fc-pick="new">' + ic('pen') + '<span><b>New email</b><small>Starts a fresh draft</small></span></button>' +
          drafts.map(function (w) {
            var who = chips(w, 'to').map(function (a) { return a.name || a.email; }).join(', ');
            return '<button type="button" role="menuitem" class="fc-choose__i" data-fc-pick="' + esc(w.id) + '">' + ic(isFwd(w.o) ? 'fwd' : isReply(w.o) ? 'reply' : 'mail') + '<span><b>' + esc(titleOf(w)) + '</b><small>' + esc(kindOf(w) + (who ? ', to ' + who : '')) + '</small></span></button>';
          }).join('') + '</div>';
        layer.appendChild(el);
        // Beside the button pressed, kept on screen; without one, at the bottom right.
        var W = Math.min(340, innerWidth - 24), h = el.offsetHeight;
        if (anchor && anchor.getBoundingClientRect && !isPhone()) {
          var r = anchor.getBoundingClientRect();
          var top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8);
          el.style.left = clamp(r.left, 12, innerWidth - W - 12) + 'px'; el.style.top = Math.max(8, top) + 'px';
        } else { el.style.right = '24px'; el.style.bottom = '24px'; }
        el.style.width = W + 'px';
        requestAnimationFrame(function () { el.classList.add('is-in'); var f = $('[data-fc-pick]', el); if (f) f.focus({ preventScroll: true }); });
        var back = document.activeElement;
        var finish = function (v) {
          if (!chooser || chooser.el !== el) return;
          chooser = null;
          document.removeEventListener('pointerdown', outside, true);
          el.classList.remove('is-in');
          setTimeout(function () { el.remove(); }, 140);
          if (!v && back && back.focus && back.isConnected) back.focus({ preventScroll: true });
          ok(v);
        };
        var outside = function (e) { if (!el.contains(e.target)) finish(null); };
        chooser = { el: el, done: finish };
        setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
        el.addEventListener('click', function (e) { var b = e.target.closest('[data-fc-pick]'); if (b) finish(b.dataset.fcPick); });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
          menuKeys(e, el);
        });
      });
    });
  }

  /* ------------------------------------------------------------------ dragging items out of pages, and dropping them on any text box */
  /** Starts dragging an item: the item for FavorOS targets, HTML for other apps, plain text for the rest, and a preview card. */
  function dragStart(e, it) {
    var dt = e && e.dataTransfer; if (!dt || !it) return;
    var p = itemParts(it);
    dt.effectAllowed = 'copy';
    dt.setData('text/plain', itemText(it));
    try { dt.setData(ITEM_TYPE, JSON.stringify(it)); } catch (er) { /* older browsers: text only */ }
    if (!p.refused) { try { dt.setData('text/html', p.html); } catch (er2) { /* text only */ } }
    var n = rowsCount(it);
    var sub = it.kind === 'brain' ? (n ? 'Table, ' + n.toLocaleString('en-US') + (n === 1 ? ' row' : ' rows') : 'Favor Brain answer') : it.kind === 'clip' ? 'Clip' : it.kind === 'task' ? 'Task' : it.kind === 'meeting' ? 'Meeting notes' : 'Link';
    var g = document.createElement('div');
    g.setAttribute('aria-hidden', 'true');
    g.style.cssText = 'position:fixed;top:-600px;left:0;z-index:-1;width:280px;padding:12px 14px;background:#fff;border:1px solid #d3cdbd;border-left:4px solid #2f6f9f;border-radius:12px;font:500 13px/1.35 Inter,system-ui,sans-serif;color:#1d211b;display:flex;flex-direction:column;gap:3px';
    g.innerHTML = '<b style="font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.title || 'FavorOS item') + '</b>' +
      (it.headline && it.headline.value ? '<span style="font-size:18px;font-weight:700">' + esc(it.headline.value) + '</span>' : '') +
      '<small style="color:#666b60;font-size:12px">' + esc(sub) + '. Drop it into an email or any text box.</small>';
    document.body.appendChild(g);
    try { dt.setDragImage(g, 18, 18); } catch (er3) { /* no preview */ }
    setTimeout(function () { g.remove(); }, 0);
  }
  /* Dragging with the pointer (mouse, pen or finger) instead of the browser's drag and drop: a card follows the pointer, every place
     the item can land shows, and letting go over one puts the item there. Used by Favor Brain answers' Drag handle.
     getItem() returns the item, or null when it may not leave the page. */
  var pd = null;
  function pointerDrag(e, getItem) {
    if (pd || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var src = e.currentTarget && e.currentTarget.nodeType === 1 ? e.currentTarget : e.target;
    var sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    if (e.pointerType === 'mouse') e.preventDefault();
    var s = { it: null, ghost: null, on: false, hot: null };
    pd = s;
    var start = function () {
      s.it = getItem();
      if (!s.it) { end(); return false; }
      ensureLayer(); css();
      s.on = true;
      var n = rowsCount(s.it);
      var g = document.createElement('div');
      g.className = 'fc-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.innerHTML = '<b>' + esc(s.it.title || 'FavorOS item') + '</b>' + (s.it.headline && s.it.headline.value ? '<span>' + esc(s.it.headline.value) + '</span>' : '') +
        '<small>' + esc(s.it.kind === 'brain' ? (n ? 'Table, ' + n.toLocaleString('en-US') + (n === 1 ? ' row' : ' rows') : 'Favor Brain answer') : 'FavorOS item') + '</small>';
      layer.appendChild(g);
      s.ghost = g;
      document.documentElement.classList.add('fc-dragging', 'fc-pdrag');
      // The box that starts a new email shows big and well above the bottom edge (a Mac's Dock can cover the last inch).
      dropEl.hidden = false; dropEl.classList.add('is-big');
      $('span', dropEl).textContent = WINS.some(function (w) { return !w.gone; }) ? 'Drop here for a new email' : 'Drop here to start an email';
      requestAnimationFrame(function () { dropEl.classList.add('is-in'); });
      try { src.setPointerCapture(pid); } catch (er) { /* the window listeners still see the moves */ }
      return true;
    };
    var targetAt = function (x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) return null;
      if (dropEl.contains(el)) return { kind: 'start', el: dropEl };
      var win = el.closest('.fc-win');
      if (win && layer.contains(win)) { var w = byId(win.dataset.id); if (w && !w.gone) return { kind: 'win', w: w, el: win }; }
      var ed = editableAt(el);
      if (ed && !src.contains(ed)) return { kind: 'text', el: ed };
      return null;
    };
    var light = function (t) {
      var prev = s.hot;
      if (prev && t && prev.el === t.el) return;
      if (prev) { if (prev.kind === 'start') dropEl.classList.remove('is-hot'); else if (prev.kind === 'win') $('.fc-drop', prev.el).hidden = true; else setHot(null); }
      s.hot = t;
      if (!t) return;
      if (t.kind === 'start') dropEl.classList.add('is-hot');
      else if (t.kind === 'win') { var ov = $('.fc-drop', t.el); $('[data-fc-droptxt]', ov).textContent = 'Drop to add to this email'; ov.hidden = false; }
      else setHot(t.el);
    };
    var move = function (ev) {
      if (ev.pointerId !== pid) return;
      if (!s.on) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
        if (!start()) return;
      }
      if (ev.cancelable) ev.preventDefault();
      s.ghost.style.transform = 'translate(' + Math.round(ev.clientX + 14) + 'px,' + Math.round(ev.clientY + 14) + 'px)';
      light(targetAt(ev.clientX, ev.clientY));
    };
    var up = function (ev) {
      if (ev.pointerId !== pid) return;
      var was = s.on, t = was ? targetAt(ev.clientX, ev.clientY) : null, it = s.it;
      end();
      if (!was) { if (src.matches && src.matches('[data-brain-drag]')) toast('Hold and drag it onto an email or a text box, or press Send to email.'); return; }
      if (!t) return;
      if (t.kind === 'start') { add(it, { fresh: true, from: src }); return; }
      if (t.kind === 'win') {
        var w = t.w, ed = $('[data-fc-ed]', w.el);
        if (w.mode === 'min') setMode(w, restoreMode(w));
        var r = dropRange(ed, ev.clientX, ev.clientY);
        if (r) w.range = r;
        if (insertItem(w, it)) toast('Added to email');
        return;
      }
      dropText(t.el, it, ev);
    };
    var key = function (ev) { if (ev.key === 'Escape') { ev.preventDefault(); end(); } };
    var end = function () {
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', end, true); removeEventListener('keydown', key, true);
      try { src.releasePointerCapture(pid); } catch (er) { /* already released */ }
      light(null);
      if (s.ghost) s.ghost.remove();
      if (s.on) { document.documentElement.classList.remove('fc-dragging', 'fc-pdrag'); dropEl.classList.remove('is-big'); hideDropStart(); }
      if (pd === s) pd = null;
    };
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', end, true); addEventListener('keydown', key, true);
  }

  /** Copies an item as formatted text (HTML and plain text), for pasting into an email or a document. Resolves true when copied. */
  function copyItem(it) {
    var p = itemParts(it || {});
    if (p.refused) { toast(p.refused, { ms: 6000 }); return Promise.resolve(false); }
    var txt = itemText(it);
    var done = function () { toast('Copied. Paste it into an email or a document.'); return true; };
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        return navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([p.html], { type: 'text/html' }), 'text/plain': new Blob([txt], { type: 'text/plain' }) })]).then(done).catch(function () { return navigator.clipboard.writeText(txt).then(done); }).catch(function () { toast('Copy did not work in this browser.'); return false; });
      }
      return navigator.clipboard.writeText(txt).then(done).catch(function () { toast('Copy did not work in this browser.'); return false; });
    } catch (e) { toast('Copy did not work in this browser.'); return Promise.resolve(false); }
  }
  // A text box an item can drop into: any text field or editable area outside the composer (the composer takes its own drops).
  function editableAt(t) {
    var el = t && t.closest && t.closest('textarea, input, [contenteditable="true"], [contenteditable=""]');
    if (!el || (layer && layer.contains(el))) return null;
    if (el.tagName === 'INPUT' && !/^(text|search|)$/i.test(el.getAttribute('type') || '')) return null;
    if (el.disabled || el.readOnly) return null;
    return el;
  }
  var hotEl = null;
  function setHot(el) {
    if (hotEl === el) return;
    if (hotEl) hotEl.classList.remove('fc-drop-hot');
    hotEl = el;
    if (el) el.classList.add('fc-drop-hot');
  }
  function dropText(el, it, e) {
    var txt = itemText(it);
    if (!txt) { toast(itemParts(it).refused || 'That did not drop in.', { ms: 6000 }); return; }
    var was = document.activeElement === el;
    el.focus({ preventScroll: true });
    if (el.isContentEditable) {
      var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (r && el.contains(r.startContainer)) { var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      document.execCommand('insertText', false, txt);
    } else {
      if (el.tagName === 'INPUT') txt = txt.split('\n').filter(Boolean).join(' / ');
      var at = was && typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      var end = was && typeof el.selectionEnd === 'number' ? el.selectionEnd : at;
      var lead = at > 0 && el.tagName === 'TEXTAREA' && el.value.charAt(at - 1) !== '\n' ? '\n' : '';
      el.setRangeText(lead + txt, at, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    toast('Added');
  }
  function wireTextDrops() {
    // After the page's own dragstart handler has set the data: mark the drag so drop targets show.
    addEventListener('dragstart', function (e) { if (dtKind(e.dataTransfer) === 'item') { css(); document.documentElement.classList.add('fc-dragging'); } });
    var stop = function () { document.documentElement.classList.remove('fc-dragging'); setHot(null); };
    addEventListener('dragend', stop);
    addEventListener('dragover', function (e) {
      if (dtKind(e.dataTransfer) !== 'item') return;
      var el = editableAt(e.target);
      setHot(el);
      if (el) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    }, true);
    addEventListener('dragleave', function (e) { if (hotEl && !hotEl.contains(e.relatedTarget)) setHot(null); }, true);
    addEventListener('drop', function (e) {
      if (dtKind(e.dataTransfer) !== 'item') return;
      var el = editableAt(e.target);
      if (!el) { stop(); return; }
      var it = null; try { it = JSON.parse(e.dataTransfer.getData(ITEM_TYPE)); } catch (er) { it = null; }
      stop();
      if (!it) return;
      e.preventDefault(); e.stopPropagation();
      dropText(el, it, e);
    }, true);
  }

  /** Mail: where this conversation's inline reply goes. Called each time Mail draws the conversation. */
  function host(threadId, el) {
    if (!threadId || !el) return;
    HOSTS[threadId] = el;
    WINS.forEach(function (w) {
      if (w.gone || w.o.threadId !== threadId) return;
      if (w.mode === 'inline' && w.host !== el) { var keep = saveSel(w); w.host = el; place(w); restoreSel(w, keep); }
      else if (w.mode === 'min' && w.preMin === 'inline' && !isPhone()) { w.host = el; setMode(w, 'inline', { focus: false }); }
    });
  }
  // An inline window whose conversation was closed folds to a tab, or goes away if nothing was written.
  var watchT = 0;
  function watchHosts() {
    clearTimeout(watchT);
    watchT = setTimeout(function () {
      WINS.slice().forEach(function (w) {
        if (w.gone || w.mode !== 'inline' || (w.host && w.host.isConnected && w.el.isConnected)) return;
        if (isBlank(w)) { finish(w); return; }
        if (w.dirty) saveDraft(w);
        setMode(w, 'min', { focus: false, auto: true });
      });
    }, 120);
  }
  // A page change that replaces the body's children (hub-swap.js on some pages) takes the windows' layer with it: put it back.
  function keepLayer() { if (layer && !layer.isConnected && document.body) { document.body.appendChild(layer); cover(); } }
  var lastPath = location.pathname;
  var mo = new MutationObserver(function () {
    keepLayer();
    if (WINS.some(function (w) { return w.mode === 'inline'; })) watchHosts();
    // The app's own routes change the address without a page swap event.
    if (location.pathname !== lastPath) { lastPath = location.pathname; WINS.forEach(function (w) { if (!w.gone && w.el && w.mode === 'float') place(w); }); sideLayout(); }
    if (WINS.length) lift();
  });
  // A new page may allow or refuse the side-by-side place (Mail refuses it): windows take the place the page allows.
  document.addEventListener('hub-swapped', function () { keepLayer(); WINS.forEach(function (w) { if (!w.gone && w.el && w.mode === 'float') place(w); }); sideLayout(); lift(); });
  addEventListener('scroll', function () { if (WINS.length) lift(); }, { capture: true, passive: true });
  var bodyT = 0;
  var bo = new MutationObserver(function () { cancelAnimationFrame(bodyT); bodyT = requestAnimationFrame(function () { phoneBottom(); }); });
  function startWatch() { mo.observe(document.body, { childList: true, subtree: true }); bo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); }

  // Back from another page: the windows come back as they were (inline ones as tabs until their conversation opens).
  function restore() {
    var st = readStore();
    if ((!st.wins || !st.wins.length) && (!st.pending || !st.pending.length)) return;
    css().then(function () {
      $$('.ml-thread[data-thread] [data-inline-host]').forEach(function (h) { HOSTS[h.closest('.ml-thread').dataset.thread] = h; });
      (st.wins || []).forEach(function (s) {
        if (byId(s.id)) return;
        var o = Object.assign({}, s, { mode: s.mode === 'inline' ? 'min' : s.mode, noSig: true, files: [] });
        make(o, true);
        var w = byId(s.id);
        if (w) {
          w.draftId = s.draftId || ''; w.dirty = false;
          if (s.dirty) ensureCtx().then(function () { if (!w.gone) changed(w); }).catch(function () {});
          if (s.fileMeta && s.fileMeta.length) filesGet(s.id).then(function (f) { w.files = f || []; renderFiles(w); });
          w.preMin = s.preMin || (s.wasInline && s.mode === 'min' ? 'inline' : w.preMin);
          if (w.preMin === 'inline' && s.threadId && findHost(s.threadId) && !isPhone()) { w.host = findHost(s.threadId); setMode(w, 'inline', { focus: false }); }
        }
      });
      (st.pending || []).forEach(function (s) {
        var p = { id: s.id, mb: s.mb, until: s.until, snap: s.snap, state: s.id ? 'held' : 'lost' };
        if (p.state === 'lost') return;
        PENDING.push(p);
        var left = p.until - Date.now();
        if (left > 800) { showSending(p); setTimeout(function () { releaseP(p); }, left); } else releaseP(p);
      });
      writeNow();
    });
  }

  addEventListener('hashchange', function () { setTimeout(phoneBottom, 350); });
  addEventListener('resize', function () { WINS.forEach(function (w) { if (!w.gone && w.el.isConnected && w.mode !== 'inline') place(w); }); sideLayout(); lift(); });
  // Before the page goes, everything written is kept in this browser; the next page saves it to Gmail.
  addEventListener('pagehide', writeNow);

  window.FavorCompose = {
    /** Opens a window. o: {mode:'inline'|'float'|'full', side, host, title, to, cc, bcc, subject, body, quote, threadId, replyTo, draftId, mb, noSig, forward, items, ctx, kind}. */
    open: open,
    /** Sends a FavorOS item to email: a new draft, or the draft the person picks. opts: {anchor, from, fresh, target}. */
    add: add,
    host: host,
    /** Windows open now, for Mail (which conversation already has a reply). */
    list: function () { return WINS.filter(function (w) { return !w.gone; }).map(function (w) { return { id: w.id, mode: w.mode, threadId: w.o.threadId || '', kind: w.o.kind || '', draftId: w.draftId || w.o.draftId || '', title: titleOf(w), side: !!w.side }; }); },
    focus: function (id) { var w = byId(id); if (w) { if (w.mode === 'min') setMode(w, restoreMode(w)); focusWin(w); } },
    close: function (id) { var w = byId(id); if (w) closeWin(w); },
    toast: toast,
    /** An item as email HTML ({html, files} or {refused}) and as plain text. */
    itemHtml: itemParts,
    itemText: itemText,
    /** Call from a dragstart handler: sets the item, its HTML and text, and the preview card. */
    dragStart: dragStart,
    /** Call from a pointerdown handler: drags with the pointer (works where the browser's drag and drop does not). */
    pointerDrag: pointerDrag,
    /** Copy as formatted (the keyboard way to move an item). */
    copy: copyItem,
    ITEM_TYPE: ITEM_TYPE,
  };

  var boot = function () { ensureLayer(); startWatch(); wireTextDrops(); if (meEmail()) restore(); };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
