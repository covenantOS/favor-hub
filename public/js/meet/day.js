// Meetings, Day tab: date bar, live cards, positioned timeline (80 px per hour) and the notes column.
// Classic script so the shell can run it again after an in-place page swap. A second run stops the first.
(function () {
  if (window.__mtDay) { try { window.__mtDay.stop(); } catch (e) { /* old run already gone */ } }
  var root = document.getElementById('mt-day');
  if (!root) return;

  var PXH = 80, KEY = 'meet.day.v1', TTL = 20000;
  var PROV = { favor: 'Favor', zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams', webex: 'Webex' };
  var state = { day: dayKey(new Date()), winStart: null, sel: null, confirm: null, data: null, people: {}, now: new Date() };
  var timers = [], stopped = false, nowBtn = null, tt = 0, scrollTop = null, pumping = false;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function keyDate(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(k, n) { var d = keyDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
  var hm = function (d) { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  var hourLabel = function (h) { return ((h + 11) % 12 + 1) + ' ' + (h >= 12 && h < 24 ? 'PM' : 'AM'); };
  var longDay = function (k) { return keyDate(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };
  var wk = function (k, w) { return keyDate(k).toLocaleDateString('en-US', { weekday: w || 'long' }); };
  var clip = function (t, n) { t = (t || '').trim(); if (t.length <= n) return t; var c = t.slice(0, n); return c.slice(0, c.lastIndexOf(' ')) + '...'; };

  var I = {
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'
  };
  var ic = function (n) { return '<svg class="dv-i" viewBox="0 0 24 24" aria-hidden="true">' + (I[n] || '') + '</svg>'; };

  // Provider marks, drawn. Favor uses the hub icon.
  var MARK = {
    favor: '<img src="/images/favor-icon.png" alt="">',
    zoom: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="5" fill="#2d8cff"/><rect x="3.5" y="6.5" width="8" height="7" rx="1.8" fill="#fff"/><path d="m12.5 9 4-2.3v6.6l-4-2.3z" fill="#fff"/></svg>',
    meet: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="5" fill="#1b9a5a"/><rect x="3.5" y="6.5" width="8" height="7" rx="1.8" fill="none" stroke="#fff" stroke-width="1.6"/><path d="m12.5 9 4-2.3v6.6l-4-2.3z" fill="#fff"/></svg>',
    teams: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="5" fill="#5059c9"/><path d="M5.5 6.8h9M10 6.8v7.4" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>'
  };
  MARK.webex = MARK.meet;
  var pv = function (k) { return '<span class="dv-pv dv-pv--' + (k === 'favor' ? 'favor' : 'x') + '" title="' + esc(PROV[k] || k) + '">' + (MARK[k] || MARK.favor) + '</span>'; };

  var initials = function (n) { return String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join('') || '?'; };
  var hue = function (n) { var h = 0; String(n).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return h % 6; };
  var av = function (n) { return '<span class="dv-av" data-h="' + hue(n) + '" title="' + esc(n) + '">' + esc(initials(n)) + '</span>'; };
  var avs = function (names, max) { names = names.filter(Boolean); max = max || 4; return '<span class="dv-avs">' + names.slice(0, max).map(av).join('') + (names.length > max ? '<span class="dv-av" data-h="x">+' + (names.length - max) + '</span>' : '') + '</span>'; };
  var nameOf = function (i) { var e = String(i && i.email || '').toLowerCase(); return (e && state.people[e]) || (i && (i.name || i.email)) || ''; };

  // The API has no provider, start, end or live flag per Favor room, so they are derived here from status, startsAt, endsAt and durationMin.
  function normalize(d) {
    var out = [], seen = {}, now = state.now.getTime();
    var add = function (m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      var start = Date.parse(m.startsAt || m.startedAt || m.createdAt);
      if (isNaN(start)) return;
      var end = Date.parse(m.endsAt || m.endedAt || '') || start + (m.durationMin || 30) * 60000;
      var live = m.status === 'live';
      if (live && end < now + 10 * 60000) end = now + 10 * 60000;
      var host = m.hostName || nameOf({ email: m.hostEmail });
      var names = [host].concat((m.invitees || []).map(nameOf)).filter(Boolean);
      out.push({ id: m.id, hub: m, p: 'favor', title: m.title, start: start, end: end, live: live, past: !live && (m.status === 'ended' || end <= now), who: names, count: names.length || 1,
        rec: m.rec, inRoom: m.inRoom || 0, open: !m.startsAt, noteId: m.notesStatus && m.notesStatus !== 'none' ? m.id : '' });
    };
    (d.up || []).forEach(add); (d.recent || []).forEach(add);
    var cal = d.cal && d.cal.connected ? d.cal.meetings : [];
    cal.forEach(function (c) {
      var s = Date.parse(c.startsAt), e = Date.parse(c.endsAt) || s + 30 * 60000;
      if (isNaN(s)) return;
      var names = (c.people || []).map(function (p) { return p.name || p.email; });
      out.push({ id: 'c:' + c.eventId, cal: c, p: c.provider || 'meet', title: c.title, start: s, end: e, live: s <= now && e > now, past: e <= now, who: names, count: names.length || 1, rec: 'none', inRoom: 0, noteId: '' });
    });
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return out;
  }

  // Side by side lanes for events that overlap.
  function lanes(evs) {
    var cluster = [], end = 0;
    var flush = function () { var n = 0; cluster.forEach(function (e) { n = Math.max(n, e.lane + 1); }); cluster.forEach(function (e) { e.lanes = n; }); cluster = []; };
    evs.forEach(function (e) {
      if (cluster.length && e.start >= end) { flush(); end = 0; }
      var used = {}; cluster.forEach(function (c) { if (c.end > e.start) used[c.lane] = 1; });
      var l = 0; while (used[l]) l++;
      e.lane = l; cluster.push(e); end = Math.max(end, e.end);
    });
    flush();
  }

  function readCache() { try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return c && Date.now() - c.at < TTL ? c : null; } catch (e) { return null; } }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/meet/' + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Something went wrong. Try again.'); e.code = j.error; throw e; } return j; });
    });
  }
  function load(fresh) {
    var c = fresh ? null : readCache();
    var p = c ? Promise.resolve(c) : Promise.all([
      api('meetings?scope=upcoming'), api('meetings?scope=recent'), api('meetings?scope=notes'),
      api('meetings/calendar').catch(function () { return null; }), api('meetings/directory').catch(function () { return { people: [] }; })
    ]).then(function (r) {
      var v = { at: Date.now(), up: r[0].meetings, recent: r[1].meetings, notes: r[2].meetings, cal: r[3], people: r[4].people || [] };
      try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage full or off */ }
      return v;
    });
    return p.then(function (v) {
      if (stopped) return;
      state.people = {}; (v.people || []).forEach(function (q) { state.people[String(q.email).toLowerCase()] = q.name; });
      state.data = v; state.now = new Date(); draw(); root.removeAttribute('aria-busy');
      pump();
    }).catch(function (e) { if (stopped) return; root.innerHTML = '<div class="dv-card dv-err">' + esc(e.message) + '</div>'; root.removeAttribute('aria-busy'); });
  }
  // Finished meetings need work (recording to Drive, transcript, notes). This drives whichever is next.
  function pump() {
    if (pumping) return; pumping = true;
    var n = 0;
    (function step() {
      if (stopped || n++ > 25) { pumping = false; return; }
      api('meetings/pump', { method: 'POST', body: {} }).then(function (r) {
        if (r.done && r.state === 'idle') { pumping = false; return; }
        if (r.done) { step(); return; }
        setTimeout(step, r.ok ? 0 : 4000);
      }).catch(function () { pumping = false; });
    })();
  }

  function eventHtml(e, geo) {
    var h = (e.end - e.start) / 3600000 * PXH - 3, compact = h < 50, tall = h >= 76;
    var top = (e.start - geo.t0) / 3600000 * PXH + 1;
    var c = 'dv-ev' + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (compact ? ' is-compact' : '') + (state.sel === e.id ? ' is-sel' : '');
    var chip = e.live ? '<span class="dv-live"><i></i>Live</span>' : hm(e.start);
    var foot = tall ? '<span class="dv-ev__f"><span>' + (e.live && e.inRoom ? e.inRoom + ' in the room' : e.count + ' people') + '</span>' + (e.noteId ? '<span class="dv-chip dv-chip--plain">' + ic('doc') + 'Notes</span>' : '') + '</span>' : '';
    return '<button type="button" class="' + c + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" aria-pressed="' + (state.sel === e.id) + '" aria-label="' + esc(e.title + ', ' + hm(e.start) + ' to ' + hm(e.end) + ', ' + (PROV[e.p] || e.p)) + '"' +
      ' style="top:' + top + 'px;height:' + h + 'px;left:calc(70px + (100% - 76px) * ' + (e.lane / e.lanes) + ');width:calc((100% - 76px) / ' + e.lanes + ' - 6px)">' +
      '<span class="dv-ev__t">' + pv(e.p) + chip + (compact ? '' : avs(e.who, e.lanes > 1 ? 2 : 4)) + '</span><h4>' + esc(e.title) + '</h4>' + foot + '</button>';
  }

  function liveCard(e) {
    var ext = !!e.cal, url = ext ? e.cal.joinUrl : '/meet/room/?m=' + e.id;
    var until = e.hub && !e.hub.endsAt ? '' : ', until ' + hm(e.end);
    var room = ext ? e.count + ' people' : e.inRoom ? e.inRoom + ' in the room' : 'Open now';
    var rec = e.rec === 'video' ? 'Notes and video on' : e.rec === 'notes' ? 'Notes on' : 'Not recorded';
    return '<article class="dv-lv"><div class="dv-lv__top">' + pv(e.p) + '<span class="dv-live"><i></i>Live</span><span>' + esc(PROV[e.p] || e.p) + until + '</span></div>' +
      '<h3>' + esc(e.title) + '</h3><div class="dv-lv__meta">' + avs(e.who, 4) + '<span>' + esc(room) + '</span><span class="dv-lv__chip">' + (e.rec === 'notes' || e.rec === 'video' ? ic('mic') : '') + rec + '</span></div>' +
      '<a class="dv-btn dv-btn--onlive" href="' + esc(url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + ic(ext ? 'arrow' : 'video') + 'Join</a></article>';
  }

  function detailHtml(e) {
    var acts = '';
    if (e.cal) {
      var c = e.cal;
      acts += '<a class="dv-btn dv-btn--line" href="' + esc(c.joinUrl) + '" target="_blank" rel="noopener">' + ic('arrow') + 'Join</a>';
      if (c.canSwitch) acts += '<button type="button" class="dv-btn dv-btn--ghost" data-switch="' + esc(c.eventId) + '">Move to Favor Meetings</button>';
      else if (c.needsConsent) acts += '<a class="dv-btn dv-btn--ghost" href="/api/google/connect?add=meetings&amp;next=' + encodeURIComponent('/meet/') + '">Move to Favor Meetings</a>';
    } else {
      var m = e.hub, rep = m.repeat && m.repeat !== 'none';
      if (m.status === 'ended') { if (e.noteId) acts += '<a class="dv-btn dv-btn--line" href="/meet/notes/?m=' + esc(m.id) + '">' + ic('doc') + 'Notes</a>'; }
      else acts += '<a class="dv-btn dv-btn--line" href="/meet/room/?m=' + esc(m.id) + '">' + ic('video') + (e.live || e.open ? 'Join' : 'Open') + '</a>';
      if (m.mine && m.startsAt && m.status === 'scheduled') {
        if (state.confirm === m.id) {
          acts += '<span class="dv-ask">' + (rep ? 'Cancel every meeting in this series?' : 'Cancel this meeting?') + ' Invitees get a cancellation.</span><button type="button" class="dv-btn dv-btn--line" data-yes="' + esc(m.id) + '">' + (rep ? 'Cancel series' : 'Yes, cancel') + '</button><button type="button" class="dv-btn dv-btn--ghost" data-no="1">Keep it</button>';
        } else {
          if (!rep) acts += '<a class="dv-btn dv-btn--ghost" href="/meet/book/?edit=' + esc(m.id) + '">Move</a>';
          acts += '<button type="button" class="dv-btn dv-btn--ghost" data-cancel="' + esc(m.id) + '">Cancel</button>';
        }
      }
    }
    return '<div class="dv-sel">' + pv(e.p) + '<span class="dv-sel__t"><b>' + esc(e.title) + '</b><span>' + hm(e.start) + ' to ' + hm(e.end) + ', ' + esc(PROV[e.p] || e.p) + '</span></span><span class="dv-sel__a">' + acts + '</span></div>';
  }

  function noteHtml(m) {
    var when = m.endedAt || m.startedAt || m.startsAt, d = new Date(when), today = dayKey(d) === dayKey(state.now);
    var label = today ? 'Today, ' + hm(d) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    var names = [m.hostName].concat((m.invitees || []).map(nameOf)).filter(Boolean);
    return '<a class="dv-nt' + (state.sel === m.id ? ' is-sel' : '') + '" href="/meet/notes/?m=' + esc(m.id) + '" data-note="' + esc(m.id) + '"><div class="dv-nt__top">' + pv('favor') + '<span>' + esc(label) + '</span></div>' +
      '<h3>' + esc(m.title) + '</h3>' + (m.summary ? '<p>' + esc(clip(m.summary, 150)) + '</p>' : '') +
      '<div class="dv-nt__f"><span class="dv-chip dv-chip--teal">' + ic('doc') + 'Transcript</span>' + (m.actionCount ? '<span class="dv-chip">' + m.actionCount + ' action' + (m.actionCount === 1 ? '' : 's') + '</span>' : '') + avs(names, 3) + '</div></a>';
  }

  function draw() {
    var keep = root.querySelector('.dv-tl__scroll'); if (keep) scrollTop = keep.scrollTop;
    var d = state.data, now = state.now, today = dayKey(now), all = normalize(d);
    var byDay = {}; all.forEach(function (e) { var k = dayKey(new Date(e.start)); (byDay[k] = byDay[k] || []).push(e); });
    var evs = byDay[state.day] || [];
    // The seven day strip starts today and moves only when the chosen day leaves it.
    if (!state.winStart) state.winStart = today;
    if (state.day < state.winStart) state.winStart = state.day;
    if (state.day > addDays(state.winStart, 6)) state.winStart = addDays(state.day, -6);
    var isToday = state.day === today, dayLive = isToday ? all.filter(function (e) { return e.live; }) : [];
    var cal = d.cal, needConnect = cal && !cal.connected;
    var sub = evs.length ? evs.length + ' meeting' + (evs.length === 1 ? '' : 's') + (dayLive.length ? ', ' + dayLive.length + ' live now' : '') : 'No meetings';

    var strip = '';
    for (var i = 0; i < 7; i++) {
      var k = addDays(state.winStart, i), n = (byDay[k] || []).length;
      strip += '<button type="button" class="dv-day' + (k === state.day ? ' is-on' : '') + (k === today ? ' is-today' : '') + '" role="tab" aria-selected="' + (k === state.day) + '" aria-label="' + esc(longDay(k) + ', ' + n + ' meeting' + (n === 1 ? '' : 's')) + '" data-day="' + k + '"><small>' + wk(k, 'short') + '</small><b>' + keyDate(k).getDate() + '</b><span>' + new Array(Math.min(n, 3) + 1).join('<i></i>') + '</span></button>';
    }

    var h0 = 8, h1 = 18;
    evs.forEach(function (e) { h0 = Math.min(h0, new Date(e.start).getHours()); var ed = new Date(e.end); h1 = Math.max(h1, ed.getHours() + (ed.getMinutes() ? 1 : 0)); });
    var t0 = keyDate(state.day).getTime() + h0 * 3600000, geo = { t0: t0 };
    lanes(evs);
    var hrs = '';
    for (var h = h0; h <= h1; h++) hrs += '<div class="dv-hr" style="top:' + (h - h0) * PXH + 'px"><span>' + hourLabel(h) + '</span></div>';
    var selEv = evs.filter(function (e) { return e.id === state.sel; })[0];
    var nowLine = isToday && now.getTime() >= t0 ? '<div class="dv-now" style="top:' + (now.getTime() - t0) / 3600000 * PXH + 'px"><span>' + hm(now) + '</span></div>' : '';
    var tlBody = evs.length
      ? '<div class="dv-tl__scroll"><div class="dv-tl__grid" style="height:' + ((h1 - h0) * PXH + 8) + 'px">' + hrs + evs.map(function (e) { return eventHtml(e, geo); }).join('') + nowLine + '</div></div>'
      : '<div class="dv-empty"><span class="dv-tile">' + ic('cal') + '</span><b>' + (isToday ? 'No meetings today' : 'No meetings on ' + esc(wk(state.day))) + '</b><a class="dv-btn dv-btn--primary" href="/meet/book/">' + ic('plus') + 'Book a meeting</a></div>';
    var notes = d.notes || [];
    root.innerHTML = '<div class="dv">' +
      '<div class="dv-bar"><div class="dv-date"><h2>' + esc(longDay(state.day)) + '</h2><p>' + sub + '</p></div>' +
      '<div class="dv-nav"><button type="button" class="dv-ib" data-step="-1" aria-label="Previous day">' + ic('left') + '</button><button type="button" class="dv-ib" data-step="1" aria-label="Next day">' + ic('right') + '</button>' + (isToday ? '' : '<button type="button" class="dv-btn dv-btn--line" data-today="1">Today</button>') + '</div>' +
      '<div class="dv-grow"></div><div class="dv-days" role="tablist" aria-label="Day">' + strip + '</div></div>' +
      (needConnect ? '<div class="dv-conn"><span>Google Calendar meetings are not connected.</span><a class="dv-btn dv-btn--primary" href="/api/google/connect?next=' + encodeURIComponent('/meet/') + '">Connect my Google</a></div>' : '') +
      (cal && cal.error ? '<div class="dv-conn"><span>' + esc(cal.error) + '</span></div>' : '') +
      (dayLive.length ? '<div class="dv-livewrap">' + dayLive.map(liveCard).join('') + '</div>' : '') +
      '<div class="dv-cols"><section class="dv-card dv-tl" aria-label="Timeline"><div class="dv-tl__head"><h2>Timeline</h2><div class="dv-legend">' +
      ['favor', 'zoom', 'meet', 'teams'].map(function (k) { return '<span>' + pv(k) + PROV[k] + '</span>'; }).join('') + '</div></div>' + (selEv ? detailHtml(selEv) : '') + tlBody + '</section>' +
      '<aside class="dv-notes" aria-label="Notes"><div class="dv-notes__in"><div class="dv-notes__h"><h2>Notes</h2><span class="dv-chip">' + notes.length + '</span><span class="dv-grow"></span><a class="dv-link" href="/meet/library/">All notes ' + ic('arrow') + '</a></div>' +
      '<div class="dv-notes__list">' + (notes.length ? notes.map(noteHtml).join('') : '<p class="dv-none">No notes yet</p>') + '</div></div></aside></div></div>';
    var sc = root.querySelector('.dv-tl__scroll');
    if (sc) {
      if (scrollTop != null) sc.scrollTop = scrollTop;
      else if (isToday) sc.scrollTop = Math.max(0, (now.getTime() - t0) / 3600000 * PXH - 240);
      else sc.scrollTop = Math.max(0, (evs[0].start - t0) / 3600000 * PXH - 40);
    }
    scrollTop = null;
  }

  function setDay(k) { state.day = k; state.sel = null; state.confirm = null; scrollTop = null; draw(); }
  function select(id) {
    state.sel = state.sel === id ? null : id; state.confirm = null; draw();
    var n = root.querySelector('.dv-nt.is-sel'), l = root.querySelector('.dv-notes__list');
    if (n && l && l.scrollTo) l.scrollTo({ top: Math.max(0, n.offsetTop - l.offsetTop - 8), behavior: 'smooth' });
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }

  function onClick(ev) {
    var t = ev.target.closest('button, a'); if (!t || !root.contains(t)) return;
    if (t.dataset.day) return setDay(t.dataset.day);
    if (t.dataset.step) return setDay(addDays(state.day, +t.dataset.step));
    if (t.dataset.today) { state.winStart = dayKey(new Date()); return setDay(state.winStart); }
    if (t.dataset.ev) return select(t.dataset.ev);
    if (t.dataset.cancel) { state.confirm = t.dataset.cancel; return draw(); }
    if (t.dataset.no) { state.confirm = null; return draw(); }
    if (t.dataset.yes) {
      t.disabled = true;
      api('meetings/' + t.dataset.yes + '/update', { method: 'POST', body: { status: 'cancelled' } }).then(function () { toast('Cancelled'); state.sel = null; state.confirm = null; load(true); }).catch(function (e) { t.disabled = false; toast(e.message); });
      return;
    }
    if (t.dataset.switch) {
      if (!confirm('Move this meeting to Favor Meetings? The Zoom or Google Meet link on the invite is replaced with a Favor room, and Google sends everyone invited an updated invite.')) return;
      t.disabled = true;
      api('meetings/calendar/switch', { method: 'POST', body: { eventId: t.dataset.switch } }).then(function () { toast('Moved to Favor Meetings'); state.sel = null; load(true); })
        .catch(function (e) { t.disabled = false; if (e.code === 'consent') location.href = '/api/google/connect?add=meetings&next=' + encodeURIComponent('/meet/'); else toast(e.message); });
    }
  }
  root.addEventListener('click', onClick);

  function startNow(e) {
    var btn = e.currentTarget; btn.disabled = true;
    var name = '';
    try { name = String(JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null').user.name || '').split(' ')[0]; } catch (x) { /* no saved name */ }
    api('meetings', { method: 'POST', body: { title: name ? name + "'s meeting" : 'Meeting', rec: 'notes', access: 'staff' } })
      .then(function (r) { location.href = '/meet/room/?m=' + r.meeting.id; }).catch(function (err) { btn.disabled = false; toast(err.message); });
  }
  nowBtn = document.getElementById('mt-now');
  if (nowBtn) nowBtn.addEventListener('click', startNow);

  // The now line and the lists refresh on their own.
  timers.push(setInterval(function () { if (!stopped && state.data && !document.hidden) { state.now = new Date(); draw(); } }, 30000));
  timers.push(setInterval(function () { if (!stopped && !document.hidden) load(true); }, 60000));

  window.__mtDay = { root: root, stop: function () {
    stopped = true; timers.forEach(clearInterval); clearTimeout(tt);
    root.removeEventListener('click', onClick);
    if (nowBtn) nowBtn.removeEventListener('click', startNow);
  } };
  load();
})();
