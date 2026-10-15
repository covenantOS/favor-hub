/* Hand off: "Hand this to <person>" on an email conversation, a task, a request or a partner.
     FavorHandoff.open({ kind: 'mail' | 'task' | 'request' | 'partner', id, title })   pick a teammate, write a note, hand it off
     FavorHandoff.show(id, onPicked)                                                    a hand-off with its note and context (Today, /h/<id>)
   The server moves it at its source and tells the teammate (Chat when they are in the Chat group, email when not); the giver sees
   "picked up" on Today when the teammate opens it. Fires document 'favor-handoff' after a hand-off or a pick-up.
   Self-contained: works on every FavorOS page and inside the app. Sheets use the shared .rt-sheet look. */
(function () {
  'use strict';
  if (window.FavorHandoff) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var I = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>', back: '<path d="m15 5-7 7 7 7"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    go: '<path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 5v14"/>',
  };
  var ic = function (n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[n] + '</svg>'; };
  var WHAT = { mail: 'email', task: 'task', request: 'request', partner: 'partner' };
  var HINT = {
    mail: 'They get your note and the email. Mail lists it under Assigned for you.',
    task: 'They become the task owner and your note goes on the task.',
    request: 'They become the owner of the request and your note opens its conversation.',
    partner: 'They get the partner page, your note and the last gift. Blackbaud assignments and fundraiser credit stay as they are.',
  };
  function api(method, path, body) {
    return fetch(path, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } : { 'X-Hub-Request': '1' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) throw new Error(d.message || 'That did not work. Try again.'); return d; }); });
  }
  function toast(text) {
    if (window.hubToast) { window.hubToast(text); return; }
    var t = document.querySelector('.fx-toast');
    if (!t) { t = document.createElement('div'); t.className = 'rt-toast fx-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.classList.add('is-on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('is-on'); }, 3600);
  }
  var COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  var hash = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  var initials = function (n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); };
  var av = function (p) { return '<span class="rq-av rq-av--sm" data-c="' + COLORS[hash(p.email) % 7] + '">' + (p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer">' : esc(initials(p.name))) + '</span>'; };

  /* ---------------------------------------------------------------- the sheet */
  var cur = null;
  function sheet(label) {
    close();
    var scrim = document.createElement('div'); scrim.className = 'rt-scrim';
    var el = document.createElement('div'); el.className = 'rt-sheet fx-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label);
    document.body.append(scrim, el);
    document.documentElement.classList.add('rt-sheet-open');
    var key = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    scrim.onclick = close;
    cur = { el: el, scrim: scrim, key: key, ret: document.activeElement };
    return el;
  }
  function close() {
    if (!cur) return;
    var c = cur; cur = null;
    c.el.remove(); c.scrim.remove();
    document.removeEventListener('keydown', c.key, true);
    document.documentElement.classList.remove('rt-sheet-open');
    if (c.ret && c.ret.focus) { try { c.ret.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  var peopleP = null;
  function people() {
    if (!peopleP) peopleP = api('GET', '/api/today/people').then(function (d) { return d.people || []; }).catch(function (e) { peopleP = null; throw e; });
    return peopleP;
  }

  /* ---------------------------------------------------------------- hand something off */
  function open(o) {
    o = o || {};
    if (!o.kind || !o.id) return;
    var title = String(o.title || '').trim() || 'This ' + (WHAT[o.kind] || 'item');
    var el = sheet('Hand this to');
    var query = '', hi = 0, shown = [];
    var item = '<div class="fx-item"><span><b>' + esc(title) + '</b><small>' + esc(WHAT[o.kind] ? WHAT[o.kind][0].toUpperCase() + WHAT[o.kind].slice(1) : '') + '</small></span></div>';
    function list(all) {
      el.innerHTML = '<div class="rt-sheet__head"><h2>Hand this to</h2><button type="button" class="rt-x" data-x aria-label="Close">' + ic('x') + '</button></div>' + item +
        '<div class="rt-search">' + ic('search') + '<input type="search" placeholder="Search by name or team" aria-label="Search by name or team" autocomplete="off" enterkeyhint="search"></div>' +
        '<div class="rt-people" role="listbox" aria-label="Staff"></div>';
      var q = el.querySelector('input'), box = el.querySelector('.rt-people');
      q.value = query;
      var draw = function () {
        var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
        shown = all.filter(function (p) { var hay = (p.name + ' ' + p.email + ' ' + (p.team || '') + ' ' + (p.title || '')).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); });
        hi = Math.min(hi, Math.max(0, shown.length - 1));
        box.innerHTML = shown.length ? shown.slice(0, 80).map(function (p, i) { return '<button type="button" class="rt-person' + (i === hi && !matchMedia('(hover: none)').matches ? ' is-hi' : '') + '" role="option" data-email="' + esc(p.email) + '">' + av(p) + '<span class="rt-person__t"><b>' + esc(p.name) + '</b>' + ((p.team || p.title) ? '<small>' + esc([p.team, p.title].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></button>'; }).join('') : '<p class="rt-none">Nobody on the staff list matches.</p>';
      };
      draw();
      if (!matchMedia('(hover: none)').matches) setTimeout(function () { q.focus(); }, 0);
      q.addEventListener('input', function () { query = q.value; hi = 0; draw(); });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); draw(); var h = box.querySelector('.is-hi'); if (h) h.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); note(shown[hi], all); }
      });
      box.addEventListener('click', function (e) { var b = e.target.closest('[data-email]'); if (!b) return; var p = shown.filter(function (x) { return x.email === b.getAttribute('data-email'); })[0]; if (p) note(p, all); });
    }
    function note(p, all) {
      var first = p.name.split(' ')[0];
      el.classList.add('rt-sheet--note');
      el.innerHTML = '<div class="rt-sheet__head"><button type="button" class="rt-x" data-back aria-label="Back to the list">' + ic('back') + '</button><h2>Hand this to ' + esc(first) + '</h2><button type="button" class="rt-x" data-x aria-label="Close">' + ic('x') + '</button></div>' +
        '<div class="fx-scroll">' + item + '<div class="rt-to">' + av(p).replace('rq-av--sm', '') + '<span class="rt-person__t"><b>' + esc(p.name) + '</b>' + ((p.team || p.title) ? '<small>' + esc([p.team, p.title].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></div>' +
        '<label class="rt-label" for="fx-ho-note">Note</label><textarea id="fx-ho-note" class="rt-note" rows="4" maxlength="1500" placeholder="What ' + esc(first) + ' needs to know"></textarea>' +
        (o.kind === 'mail' ? '<label class="fx-check"><input type="checkbox" data-fwd checked> Forward the email so ' + esc(first) + ' can answer it from their own inbox</label>' : '') +
        '<p class="fx-hint">' + esc(HINT[o.kind] || '') + '</p><p class="fx-err" hidden></p></div>' +
        '<div class="rt-sheet__foot"><button type="button" class="rt-btn" data-back>Back</button><button type="button" class="rt-btn rt-btn--primary" data-send>' + ic('go') + 'Hand off</button></div>';
      var ta = el.querySelector('textarea');
      setTimeout(function () { ta.focus(); }, 30);
      el.querySelector('[data-send]').onclick = function () { send(p); };
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(p); } });
      el.querySelectorAll('[data-back]').forEach(function (b) { b.onclick = function () { el.classList.remove('rt-sheet--note'); list(all); }; });
    }
    function send(p) {
      var b = el.querySelector('[data-send]'); if (!b || b.disabled) return;
      b.disabled = true;
      var fwd = el.querySelector('[data-fwd]');
      api('POST', '/api/today/handoff', { kind: o.kind, id: String(o.id), to: p.email, note: el.querySelector('textarea').value.trim(), title: title, forward: fwd ? fwd.checked : undefined }).then(function (d) {
        close();
        var h = d.handoff || {};
        toast('Handed to ' + p.name.split(' ')[0] + (h.channel === 'chat' ? '. They heard in Chat.' : h.channel === 'email' ? '. They got an email.' : '.') + ' Today shows you when they pick it up.');
        document.dispatchEvent(new CustomEvent('favor-handoff', { detail: { kind: o.kind, id: o.id, to: p.email, handoff: h } }));
        if (typeof o.done === 'function') o.done(h);
      }).catch(function (e) { b.disabled = false; var er = el.querySelector('.fx-err'); er.textContent = e.message; er.hidden = false; });
    }
    el.innerHTML = '<div class="rt-sheet__head"><h2>Hand this to</h2><button type="button" class="rt-x" data-x aria-label="Close">' + ic('x') + '</button></div>' + item + '<div class="rt-people"><div class="fx-skel"><i></i><i></i></div><div class="fx-skel"><i></i><i></i></div><div class="fx-skel"><i></i><i></i></div></div>';
    el.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) close(); });
    people().then(list).catch(function (e) { el.querySelector('.rt-people').innerHTML = '<p class="rt-none">' + esc(e.message) + '</p>'; });
  }

  /* ---------------------------------------------------------------- one hand-off, as its receiver (or giver) sees it */
  function show(id, onPicked) {
    var el = sheet('Hand-off');
    el.innerHTML = '<div class="rt-sheet__head"><h2>Hand-off</h2><button type="button" class="rt-x" data-x aria-label="Close">' + ic('x') + '</button></div><div class="fx-scroll"><div class="fx-skel"><i></i><i></i></div><div class="fx-skel"><i></i><i></i></div></div>';
    el.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) close(); });
    api('GET', '/api/today/handoff/' + encodeURIComponent(id)).then(function (d) {
      var h = d.handoff, mine = d.mine;
      var day = new Date(h.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var who = mine ? (h.from_name || h.from_email) + ' handed you this ' + (WHAT[h.kind] || 'item') : 'You handed this to ' + (h.to_name || h.to_email);
      var stand = h.picked_at ? (mine ? 'You picked it up' : (h.to_name || 'They').split(' ')[0] + ' picked it up') + ' ' + new Date(h.picked_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : mine ? '' : 'Not picked up yet';
      var openLabel = { mail: h.moved && h.moved.indexOf('forwarded') >= 0 && mine ? 'Open Mail' : 'Open the email', task: 'Open the task', request: 'Open the request', partner: 'Open the partner' }[h.kind] || 'Open it';
      // The receiver cannot open the giver's Gmail: their copy is the forward in their own inbox.
      var href = h.kind === 'mail' && mine ? '/mail/' : h.href;
      el.innerHTML = '<div class="rt-sheet__head"><h2>' + esc(h.title) + '</h2><button type="button" class="rt-x" data-x aria-label="Close">' + ic('x') + '</button></div>' +
        '<div class="fx-scroll"><p class="fx-meta">' + esc(who) + ', ' + esc(day) + (stand ? '. ' + esc(stand) : '') + '</p>' +
        (h.note ? '<div class="fx-quote">' + esc(h.note) + '</div>' : '') +
        (h.context ? '<label class="rt-label">' + (h.kind === 'mail' ? 'The email' : h.kind === 'partner' ? 'Where it stands' : 'Details') + '</label><div class="fx-ctx">' + esc(h.context) + '</div>' : '') +
        (h.kind === 'mail' && mine && h.moved && h.moved.indexOf('forwarded') < 0 ? '<p class="fx-hint">The email stayed in ' + esc((h.from_name || 'their').split(' ')[0]) + '\'s inbox. Ask them to forward it if you need to answer it.</p>' : '') +
        '</div><div class="rt-sheet__foot">' + (mine && !h.picked_at ? '<button type="button" class="rt-btn" data-got>Got it</button>' : '') + '<a class="rt-btn rt-btn--primary" data-open href="' + esc(href) + '">' + esc(openLabel) + '</a></div>';
      var pick = function () { return mine && !h.picked_at ? api('POST', '/api/today/handoff/' + encodeURIComponent(id) + '/pick').then(function () { h.picked_at = new Date().toISOString(); if (onPicked) onPicked(); document.dispatchEvent(new CustomEvent('favor-handoff', { detail: { picked: id } })); }) : Promise.resolve(); };
      var got = el.querySelector('[data-got]');
      if (got) got.onclick = function () { got.disabled = true; pick().then(function () { close(); toast('Picked up. ' + (h.from_name || 'They').split(' ')[0] + ' will see that.'); }).catch(function (e) { got.disabled = false; toast(e.message); }); };
      el.querySelector('[data-open]').addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { pick(); return; }
        e.preventDefault();
        pick().catch(function () { /* the link still opens */ }).then(function () { close(); if (h.kind === 'partner' && window.FavorPartner && window.FavorPartner.open) window.FavorPartner.open(h.ref_id); else location.href = href; });
      });
    }).catch(function (e) { var s = el.querySelector('.fx-scroll'); if (s) s.innerHTML = '<p class="rt-none">' + esc(e.message) + '</p>'; });
  }

  window.FavorHandoff = { open: open, show: show, close: close };
  // Any element with data-handoff-kind and data-handoff-id is a Hand off button (pages without their own script use it).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-handoff-kind][data-handoff-id]');
    if (!b) return;
    e.preventDefault();
    open({ kind: b.getAttribute('data-handoff-kind'), id: b.getAttribute('data-handoff-id'), title: b.getAttribute('data-handoff-title') || '' });
  });
})();
