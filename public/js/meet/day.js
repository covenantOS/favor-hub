// Meetings, Day tab: date bar, live cards, positioned timeline (80 px per hour) and the notes column.
// Classic script so the shell can run it again after an in-place page swap. A second run stops the first.
(function () {
  if (window.__mtDay) { try { window.__mtDay.stop(); } catch (e) { /* old run already gone */ } }
  var root = document.getElementById('mt-day');
  if (!root) return;

  var MV = window.MeetViews;
  var PXH = 80, KEY = 'meet.day.v3', TTL = 20000, VIEW_KEY = 'meet.view.v1';
  var PROV = { favor: 'Favor', zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams', webex: 'Webex' };
  var savedView = (function () { try { var v = localStorage.getItem(VIEW_KEY); return v === 'week' || v === 'month' ? v : 'day'; } catch (e) { return 'day'; } })();
  var state = { day: MV.etKey(Date.now()), view: savedView, winStart: null, sel: null, confirm: null, data: null, people: {}, now: new Date(), open: '', panel: 'detail', pick: '', extra: [], info: {}, prep: {}, move: null, moveWrite: false, moveMail: true, moveBusy: false, moveErr: '', rev: 0, calMap: {}, calInfo: null, covered: [], calBusy: false, ov: {}, pend: {}, draft: null, t0: 0 };
  var memo = { k: '', all: null, by: null };
  var timers = [], stopped = false, nowBtn = null, tt = 0, scrollTop = null, resetScroll = false, pumping = false;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function dayKey(d) { return MV.etKey(new Date(d).getTime()); }
  function keyDate(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(k, n) { return MV.addDays(k, n); }
  var hm = function (d) { return new Date(d).toLocaleTimeString('en-US', { timeZone: MV.TZ, hour: 'numeric', minute: '2-digit' }); };
  var hourLabel = function (h) { return ((h + 11) % 12 + 1) + ' ' + (h >= 12 && h < 24 ? 'PM' : 'AM'); };
  var longDay = function (k) { return MV.dayName(k) + ', ' + MV.monthName(k) + ' ' + MV.dayNum(k); };
  var wk = function (k, w) { return MV.dayName(k, w !== 'short'); };
  var clip = function (t, n) { t = (t || '').trim(); if (t.length <= n) return t; var c = t.slice(0, n), i = c.lastIndexOf(' '); return (i > n * 0.6 ? c.slice(0, i) : c) + '...'; };

  var I = {
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>', x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'
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

  var initials = function (n) { var w = String(n || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (x) { return x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x); }); var p = w.length > 1 ? [w[0], w[w.length - 1]] : w; return p.map(function (x) { return Array.from(x)[0]; }).join('').toUpperCase() || '?'; };
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
      var ov = state.ov[m.id];
      if (ov && ov.start) { start = ov.start; end = ov.end; }
      // Live only while someone is in the room (a heartbeat in the last 20 seconds). A room everyone left is not live, even
      // before the server closes it.
      var live = m.status === 'live' && (m.inRoom || 0) > 0;
      if (live && end < now + 10 * 60000) end = now + 10 * 60000;
      var host = m.hostName || nameOf({ email: m.hostEmail });
      var names = [host].concat((m.invitees || []).map(nameOf)).filter(Boolean);
      var past = !live && (m.status === 'ended' || end <= now);
      out.push({ id: m.id, hub: m, p: 'favor', title: (ov && ov.title != null ? ov.title : String(m.title || '').trim()) || 'Meeting', start: start, end: end, live: live, past: past, who: names, count: names.length || 1,
        rec: m.rec, inRoom: m.inRoom || 0, open: !m.startsAt, noteId: m.notesStatus && m.notesStatus !== 'none' ? m.id : '',
        desc: ov && ov.desc != null ? ov.desc : m.agenda || '', edit: !!(m.mine && m.startsAt && m.status === 'scheduled' && (!m.repeat || m.repeat === 'none') && !live && !past) });
    };
    (d.up || []).forEach(add); (d.recent || []).forEach(add); (state.extra || []).forEach(add);
    var cal = d.cal && d.cal.connected ? d.cal.meetings : [];
    cal.forEach(function (c) {
      var s = Date.parse(c.startsAt), e = Date.parse(c.endsAt) || s + 30 * 60000;
      if (isNaN(s)) return;
      var ov = state.ov['c:' + c.eventId];
      if (ov && ov.start) { s = ov.start; e = ov.end; }
      var names = (c.people || []).map(function (p) { return p.name || p.email; });
      var clive = s <= now && e > now, cpast = e <= now;
      out.push({ id: 'c:' + c.eventId, cal: c, p: c.provider || 'meet', title: (ov && ov.title != null ? ov.title : String(c.title || '').trim()) || '(No title)', start: s, end: e, live: clive, past: cpast, who: names, count: names.length || 1, rec: 'none', inRoom: 0, noteId: '',
        desc: ov && ov.desc != null ? ov.desc : c.description || '', edit: !!(c.canEdit && d.cal && d.cal.canWrite && !clive && !cpast) });
    });
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return out;
  }

  // normalize and bucket run once per data change or clock tick, not on every switch of view.
  function derived() {
    var k = state.rev + ':' + state.now.getTime();
    if (memo.k !== k) { memo.all = normalize(state.data); memo.by = MV.bucket(memo.all); memo.k = k; }
    return memo;
  }

  // Side by side lanes for events that overlap.
  function lanes(evs, noStack) {
    var cluster = [], end = 0;
    evs.forEach(function (e) { e.stack = undefined; });
    // Draw every event at least 45 minutes tall so a short or empty meeting never sits on top of its neighbours.
    evs.forEach(function (e) { e.vend = e.capEnd ? Math.max(e.capEnd, e.start + 30 * 60000) : Math.max(e.end, e.start + 45 * 60000); });
    var flush = function () { var n = 0; cluster.forEach(function (e) { n = Math.max(n, e.lane + 1); }); cluster.forEach(function (e) { e.lanes = n; });
      // Many meetings starting within the same stretch cannot sit side by side. They stack as one-line rows from the first start.
      if (cluster.length > 3 && !noStack) {
        var first = cluster[0].start, last = cluster[cluster.length - 1].start, nxt = Infinity;
        evs.forEach(function (o) { if (o.start > last && o.start < nxt) nxt = o.start; });
        var room = nxt === Infinity ? 32 * cluster.length : (nxt - first) / 3600000 * PXH - 6;
        var pitch = Math.max(22, Math.min(32, Math.floor(room / cluster.length)));
        cluster.forEach(function (e, i) { e.stack = i; e.stackTop = first; e.pitch = pitch; e.lanes = 1; e.lane = 0; });
      }
      cluster = []; };
    evs.forEach(function (e) {
      if (cluster.length && e.start >= end) { flush(); end = 0; }
      var used = {}; cluster.forEach(function (c) { if (c.vend > e.start) used[c.lane] = 1; });
      var l = 0; while (used[l]) l++;
      e.lane = l; cluster.push(e); end = Math.max(end, e.vend);
    });
    flush();
  }

  // The calendar windows already loaded survive a page change (a link out and Back, a reload), so the Google, Zoom, Meet and Teams
  // events are on screen in the first paint and only replaced by a newer successful load.
  var CAL_KEY = 'meet.cal.v1';
  var saveT = 0;
  function saveCal() { clearTimeout(saveT); saveT = setTimeout(saveCalNow, 900); }
  function saveCalNow() { try { var j = JSON.stringify({ at: Date.now(), calMap: state.calMap, covered: state.covered, calInfo: state.calInfo }); if (j.length < 2500000) sessionStorage.setItem(CAL_KEY, j); } catch (e) { /* storage full or off */ } }
  function hydrate() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CAL_KEY) || 'null'), h = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (c && c.calInfo && c.calInfo.connected && Date.now() - c.at < 6 * 3600000) { state.calMap = c.calMap || {}; state.covered = c.covered || []; state.calInfo = c.calInfo; }
      if (h && h.up) {
        state.people = {}; (h.people || []).forEach(function (q) { state.people[String(q.email).toLowerCase()] = q.name; });
        state.data = h; rebuildCal(); state.now = new Date();
      }
    } catch (e) { /* unreadable copy: start empty */ }
  }
  function readCache() { try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return c && Date.now() - c.at < TTL ? c : null; } catch (e) { return null; } }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/meet/' + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Something went wrong. Try again.'); e.code = j.error; throw e; } return j; });
    });
  }
  // Google Calendar events are fetched by date window and kept by event id. A window that fails or is slow leaves what the page already has.
  var DAY = 86400000;
  function calWin(from, to) { return { from: MV.etStart(from), to: MV.etStart(addDays(to, 1)) }; }
  function rebuildCal() {
    if (!state.data) return;
    var info = state.calInfo || {};
    state.data.cal = info.connected === false ? { connected: false, canWrite: false, meetings: [] } : { connected: true, canWrite: !!info.canWrite, meetings: Object.keys(state.calMap).map(function (k) { return state.calMap[k]; }), error: info.error };
    state.rev++;
  }
  function calSig() { return Object.keys(state.calMap).sort().map(function (k) { var m = state.calMap[k]; return m.eventId + m.startsAt + m.endsAt + m.title + (m.people || []).length; }).join('|') + JSON.stringify(state.calInfo); }
  function fetchCal(from, to) {
    var w = calWin(from, to), was = calSig();
    return api('meetings/calendar?from=' + encodeURIComponent(new Date(w.from).toISOString()) + '&to=' + encodeURIComponent(new Date(w.to).toISOString())).then(function (r) {
      if (stopped) return;
      if (!r.connected) { state.calInfo = { connected: false }; state.calMap = {}; }
      else if (r.error) state.calInfo = { connected: true, canWrite: r.canWrite, error: r.error };
      else {
        state.calInfo = { connected: true, canWrite: r.canWrite };
        Object.keys(state.calMap).forEach(function (k) { var st = Date.parse(state.calMap[k].startsAt); if (st >= r.from && st < r.to) delete state.calMap[k]; });
        (r.meetings || []).forEach(function (m) { state.calMap[m.eventId] = m; });
        state.covered.push({ from: r.from, to: r.to, at: Date.now() });
        state.covered = state.covered.filter(function (c) { return !state.covered.some(function (o) { return o !== c && o.at >= c.at && o.from <= c.from && o.to >= c.to; }); }).slice(-12);
      }
      saveCal(); rebuildCal(); if (state.data && calSig() !== was) draw();
    }).catch(function () { if (stopped) return; var was2 = calSig(); state.calInfo = Object.assign({}, state.calInfo || { connected: true }, { error: 'Google Calendar did not answer.' }); rebuildCal(); if (state.data && calSig() !== was2) draw(); });
  }
  // The days on screen, plus a week either side, must sit inside a loaded window. Otherwise that stretch is fetched.
  var STALE = 150000;
  function coverAt(lo, hi) { var best = 0; state.covered.forEach(function (c) { if (c.from <= lo && c.to >= hi && c.at > best) best = c.at; }); return best; }
  function ensureCal() {
    if (!state.data || state.calBusy || (state.calInfo && state.calInfo.connected === false)) return Promise.resolve();
    var ks = MV.range(state.view, state.day), last = ks[ks.length - 1], lo = MV.etStart(addDays(ks[0], -14)), hi = MV.etStart(addDays(last, 15));
    var at = coverAt(lo, hi), idle = function () { state.calBusy = false; };
    if (at && Date.now() - at < STALE) return Promise.resolve();
    state.calBusy = true;
    return (at ? fetchCal(addDays(ks[0], -14), addDays(last, 14)) : fetchCal(addDays(ks[0], -35), addDays(last, 45))).then(idle, idle);
  }
  function load(fresh) {
    var c = fresh ? null : readCache();
    var hub = c ? Promise.resolve(c) : Promise.all([
      api('meetings?scope=upcoming'), api('meetings?scope=recent'), api('meetings?scope=notes'), api('meetings/directory').catch(function () { return { people: [] }; })
    ]).then(function (r) {
      var v = { at: Date.now(), up: r[0].meetings, recent: r[1].meetings, notes: r[2].meetings, people: r[3].people || [] };
      try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage full or off */ }
      return v;
    });
    var today = dayKey(new Date());
    // The calendar goes in parallel and does not hold the page back. The window is every day on screen plus the weeks around today.
    var ks = MV.range(state.view, state.day);
    var calP;
    if (state.covered.length) calP = refetchCal();
    else calP = fetchCal(addDays(ks[0], -3), addDays(ks[ks.length - 1], 3)).then(function () { return fetchCal(addDays(today < ks[0] ? today : ks[0], -35), addDays(today > ks[ks.length - 1] ? today : ks[ks.length - 1], 45)); });
    var shown = hub.then(function (v) {
      if (stopped) return;
      state.people = {}; (v.people || []).forEach(function (q) { state.people[String(q.email).toLowerCase()] = q.name; });
      var changed = !state.data || sig(state.data) !== sig(v);
      state.data = v; rebuildCal(); state.now = new Date();
      if (changed) draw();
      root.removeAttribute('aria-busy');
      pump();
    }).catch(function (e) { if (stopped) return; if (!state.data) { root.innerHTML = '<div class="dv-card dv-err">' + esc(e.message) + '</div>'; } root.removeAttribute('aria-busy'); });
    return Promise.all([shown, calP]);
  }
  // A refresh re-reads the windows already loaded, oldest data first, one call.
  function refetchCal() {
    var ks = MV.range(state.view, state.day);
    return fetchCal(addDays(ks[0], -14), addDays(ks[ks.length - 1], 14));
  }
  function sig(v) { return JSON.stringify([v.up, v.recent, v.notes, (v.people || []).length]); }
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

  // Editable events can be dragged and resized; the others show a not-allowed cursor.
  var edc = function (e) { return e.edit ? ' is-edit' : ' is-lock'; };
  var rsh = function (e) { return e.edit ? '<i class="dv-rs" aria-hidden="true"></i>' : ''; };
  function draftHtml(left, width, top) {
    var d = state.draft; if (!d) return '';
    var h = Math.max(20, (d.end - d.start) / 3600000 * PXH - 3);
    return '<div class="dv-ev dv-new" data-p="favor" data-ev="draft" style="top:' + top + 'px;height:' + h + 'px;left:' + left + ';width:' + width + '"><span class="dv-ev__t">' + hm(d.start) + ' to ' + hm(d.end) + '</span>' +
      (d.editing ? '<input class="dv-new__in" type="text" maxlength="140" placeholder="Add title" aria-label="Title of the new meeting" autocomplete="off"' + (d.busy ? ' disabled' : '') + '>' : '') + '</div>';
  }
  function eventHtml(e, geo) {
    var h = ((e.vend || e.end) - e.start) / 3600000 * PXH - 3, compact = h < 50, tall = h >= 76;
    var top = (e.start - geo.t0) / 3600000 * PXH + 1;
    if (e.stack !== undefined) {
      var rt = (e.stackTop - geo.t0) / 3600000 * PXH + 1 + e.stack * e.pitch;
      var rc = 'dv-ev is-row' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (state.open === e.id ? ' is-sel' : '');
      return '<button type="button" class="' + rc + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" aria-pressed="' + (state.open === e.id) + '" aria-label="' + esc(e.title + ', ' + hm(e.start) + ', ' + (PROV[e.p] || e.p)) + '"' +
        ' style="top:' + rt + 'px;height:' + (e.pitch - 4) + 'px;left:70px;width:calc(100% - 76px)"><span class="dv-ev__t">' + pv(e.p) + (e.live ? '<span class="dv-live"><i></i>Live</span>' : hm(e.start)) + (e.capEnd ? '<span class="dv-cont">continues</span>' : '') + '</span><h4 title="' + esc(e.title) + '">' + esc(e.title) + '</h4></button>';
    }
    var c = 'dv-ev' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (compact ? ' is-compact' : '') + (state.open === e.id ? ' is-sel' : '');
    var chip = (e.live ? '<span class="dv-live"><i></i>Live</span>' : hm(e.start)) + (e.capEnd ? '<span class="dv-cont" title="Ends ' + esc(hm(e.end)) + ' the next day">continues</span>' : '');
    var foot = tall ? '<span class="dv-ev__f"><span>' + (e.live && e.inRoom ? Number(e.inRoom).toLocaleString('en-US') + ' in the room' : people(e.count)) + '</span>' + (e.noteId ? '<span class="dv-chip dv-chip--plain">' + ic('doc') + 'Notes</span>' : '') + '</span>' : '';
    return '<button type="button" class="' + c + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" aria-pressed="' + (state.open === e.id) + '" aria-label="' + esc(e.title + ', ' + hm(e.start) + ' to ' + hm(e.end) + ', ' + (PROV[e.p] || e.p)) + '"' +
      ' style="top:' + top + 'px;height:' + h + 'px;left:calc(70px + (100% - 76px) * ' + (e.lane / e.lanes) + ');width:calc((100% - 76px) / ' + e.lanes + ' - 6px)">' +
      '<span class="dv-ev__t">' + pv(e.p) + chip + (compact ? '' : avs(e.who, e.lanes > 1 ? 2 : 4)) + '</span><h4>' + esc(e.title) + '</h4>' + foot + rsh(e) + '</button>';
  }

  // "1 person", "41 people".
  function people(n) { return Number(n).toLocaleString('en-US') + (Number(n) === 1 ? ' person' : ' people'); }

  function liveCard(e) {
    var ext = !!e.cal, url = ext ? e.cal.joinUrl : '/meet/room/?m=' + e.id;
    var until = e.hub && !e.hub.endsAt ? '' : ', until ' + hm(e.end);
    var room = ext ? people(e.count) : e.inRoom ? Number(e.inRoom).toLocaleString('en-US') + ' in the room' : 'Open now';
    var rec = e.rec === 'video' ? 'Notes and video on' : e.rec === 'notes' ? 'Notes on' : 'Not recorded';
    return '<article class="dv-lv"><div class="dv-lv__top">' + pv(e.p) + '<span class="dv-live"><i></i>Live</span><span>' + esc(PROV[e.p] || e.p) + until + '</span></div>' +
      '<h3>' + esc(e.title) + '</h3><div class="dv-lv__meta">' + avs(e.who, 4) + '<span>' + esc(room) + '</span><span class="dv-lv__chip">' + (e.rec === 'notes' || e.rec === 'video' ? ic('mic') : '') + rec + '</span></div>' +
      '<a class="dv-btn dv-btn--onlive" href="' + esc(url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + ic(ext ? 'arrow' : 'video') + 'Join</a></article>';
  }

  // A note card shows one sentence of the summary. A summary that only says the recording had nothing in it is left off.
  function firstLine(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var one = (t.match(/^.*?[.!?](?=\s|$)/) || [t])[0];
    if (/appears to be|is unclear|unclear due|did not cover|does not seem|no specific|farewell message|was brief/i.test(one)) return '';
    return clip(one, 110);
  }
  function noteHtml(m) {
    var when = m.endedAt || m.startedAt || m.startsAt || m.createdAt, d = new Date(when || NaN), ok = !isNaN(d.getTime()), today = ok && dayKey(d) === dayKey(state.now);
    var label = !ok ? 'No date on file' : today ? 'Today, ' + hm(d) : d.toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, d.getFullYear() === state.now.getFullYear() ? {} : { year: 'numeric' }));
    var names = [m.hostName].concat((m.invitees || []).map(nameOf)).filter(Boolean);
    return '<a class="dv-nt' + (state.sel === m.id ? ' is-sel' : '') + '" href="/meet/notes/?m=' + esc(m.id) + '" data-note="' + esc(m.id) + '"><div class="dv-nt__top">' + pv('favor') + '<span>' + esc(label) + '</span></div>' +
      '<h3>' + esc(String(m.title || '').trim() || 'Meeting') + '</h3>' + (firstLine(m.summary) ? '<p>' + esc(firstLine(m.summary)) + '</p>' : '') +
      '<div class="dv-nt__f"><span class="dv-chip dv-chip--teal">' + ic('doc') + 'Transcript</span>' + (m.actionCount ? '<span class="dv-chip">' + m.actionCount + ' action' + (m.actionCount === 1 ? '' : 's') + '</span>' : '') + avs(names, 3) + '</div></a>';
  }

  // ---------------------------------------------------------------- views: Day, Week, Month
  function legend(evs) {
    return ['favor', 'zoom', 'meet', 'teams'].filter(function (k) { return evs.some(function (e) { return e.p === k; }); }).map(function (k) { return '<span>' + pv(k) + (k === 'favor' ? 'FavorOS' : PROV[k]) + '</span>'; }).join('');
  }
  function mobile() { return !!(window.matchMedia && matchMedia('(max-width: 860px)').matches); }
  var count = function (n) { return n + ' meeting' + (n === 1 ? '' : 's'); };
  var provName = function (p) { return p === 'favor' ? 'FavorOS' : PROV[p] || p; };

  function agendaRow(e) {
    var meta = [e.live ? 'Live now' : '', provName(e.p), people(e.count)].filter(Boolean).join(' · ');
    return '<button type="button" class="ag-row' + (e.past ? ' is-past' : '') + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '"><span class="ag-t">' + hm(e.start) + '</span>' + pv(e.p) + '<span class="ag-m"><b>' + esc(e.title) + '</b><small>' + esc(meta) + '</small></span></button>';
  }
  function agendaHtml(days, byDay, today) {
    return '<div class="ag">' + days.map(function (k) {
      var list = byDay[k] || [];
      return '<section class="ag-day' + (k === today ? ' is-today' : '') + '"><button type="button" class="ag-h" data-goday="' + k + '"><b>' + esc(MV.dayName(k, false) + ', ' + MV.monthName(k, false) + ' ' + MV.dayNum(k)) + '</b>' + (k === today ? '<span class="ag-tag">Today</span>' : '') + '<small>' + (list.length ? count(list.length) : 'No meetings') + '</small></button>' + list.map(agendaRow).join('') + '</section>';
    }).join('') + '</div>';
  }

  function weekEv(e, t0) {
    if (e.stack !== undefined) {
      var rt = (e.stackTop - t0) / 3600000 * PXH + 1 + e.stack * e.pitch;
      return '<button type="button" class="dv-ev is-row is-wk' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (state.open === e.id ? ' is-sel' : '') + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" aria-label="' + esc(e.title + ', ' + hm(e.start) + ', ' + provName(e.p)) + '" style="top:' + rt + 'px;height:' + (e.pitch - 4) + 'px;left:2px;width:calc(100% - 4px)"><span class="dv-ev__t">' + (e.live ? '<span class="dv-live"><i></i>Live</span>' : hm(e.start)) + '</span><h4 title="' + esc(e.title) + '">' + esc(e.title) + '</h4></button>';
    }
    var h = ((e.vend || e.end) - e.start) / 3600000 * PXH - 3, top = (e.start - t0) / 3600000 * PXH + 1;
    var c = 'dv-ev is-wk' + edc(e) + (e.live ? ' is-live' : '') + (e.past ? ' is-past' : '') + (h < 50 ? ' is-compact' : '') + (state.open === e.id ? ' is-sel' : '');
    return '<button type="button" class="' + c + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" aria-label="' + esc(e.title + ', ' + hm(e.start) + ' to ' + hm(e.end) + ', ' + provName(e.p)) + '" style="top:' + top + 'px;height:' + h + 'px;left:calc(100% * ' + (e.lane / e.lanes) + ' + 2px);width:calc(100% / ' + e.lanes + ' - 4px)">' +
      '<span class="dv-ev__t">' + pv(e.p) + (e.live ? '<span class="dv-live"><i></i>Live</span>' : hm(e.start)) + '</span><h4 title="' + esc(e.title) + '">' + esc(e.title) + '</h4>' + rsh(e) + '</button>';
  }
  function weekHtml(byDay, today, all) {
    var days = MV.weekDays(state.day);
    if (mobile()) return '<section class="dv-card dv-tl wk-agenda" aria-label="Week">' + agendaHtml(days, byDay, today) + '</section>';
    var h0 = 8, h1 = 18;
    days.forEach(function (k) {
      var dayEnd = MV.etStart(addDays(k, 1));
      (byDay[k] || []).forEach(function (e) {
        e.capEnd = e.end > dayEnd ? dayEnd : 0;
        h0 = Math.min(h0, MV.etHM(e.start).h);
        var ed = Math.min(dayEnd, Math.max(e.end, e.start + 45 * 60000)), hh = MV.etHM(ed);
        h1 = Math.max(h1, ed >= dayEnd ? 24 : hh.h + (hh.m ? 1 : 0));
      });
    });
    if (h1 <= h0) h1 = h0 + 1;
    state.wkH0 = h0;
    var gridH = (h1 - h0) * PXH + 8, hrs = '', lists = {};
    // Many meetings in the same stretch stack as one-line rows (see lanes), so the grid grows to hold them.
    days.forEach(function (k) {
      var list = (byDay[k] || []).slice(), tk0 = MV.etStart(k) + h0 * 3600000;
      lanes(list); lists[k] = list;
      list.forEach(function (e) { if (e.stack !== undefined) gridH = Math.max(gridH, (e.stackTop - tk0) / 3600000 * PXH + e.stack * e.pitch + e.pitch + 8); });
    });
    for (var h = h0; h <= h1; h++) hrs += '<div class="dv-hr" style="top:' + (h - h0) * PXH + 'px"><span>' + hourLabel(h) + '</span></div>';
    var cols = days.map(function (k) {
      var list = lists[k], tk = MV.etStart(k) + h0 * 3600000;
      var now = k === today && state.now.getTime() >= tk ? '<div class="dv-now" style="top:' + (state.now.getTime() - tk) / 3600000 * PXH + 'px"></div>' : '';
      var dr = state.draft && state.draft.key === k ? draftHtml('2px', 'calc(100% - 4px)', (state.draft.start - tk) / 3600000 * PXH + 1) : '';
      return '<div class="wk-col' + (k === today ? ' is-today' : '') + '" data-col="' + k + '">' + list.map(function (e) { return weekEv(e, tk); }).join('') + dr + now + '</div>';
    }).join('');
    var head = '<div class="wk-head"><span class="wk-gut"></span>' + days.map(function (k) {
      return '<button type="button" class="wk-hd' + (k === today ? ' is-today' : '') + '" data-goday="' + k + '" aria-label="' + esc(longDay(k) + ', ' + count((byDay[k] || []).length)) + '"><small>' + MV.dayName(k, false) + '</small><b>' + MV.dayNum(k) + '</b></button>';
    }).join('') + '</div>';
    return '<section class="dv-card dv-tl wk" aria-label="Week"><div class="dv-tl__head"><h2>Week</h2><div class="dv-legend">' + legend(all) + '</div></div>' + head +
      '<div class="dv-tl__scroll"><div class="dv-tl__grid wk-grid" style="height:' + gridH + 'px">' + hrs + '<div class="wk-cols">' + cols + '</div></div></div></section>';
  }

  function monthHtml(byDay, today, all) {
    var grid = MV.monthGrid(state.day), phone = mobile();
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var head = '<div class="mo-dow">' + names.map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div>';
    var pick = state.pick || state.day, body = '';
    grid.forEach(function (row) {
      body += '<div class="mo-row">' + row.map(function (c) {
        var list = byDay[c.key] || [], cls = 'mo-cell' + (c.inMonth ? '' : ' is-out') + (c.key === today ? ' is-today' : '');
        if (phone) {
          var dots = list.slice(0, 3).map(function (e) { return '<i data-p="' + e.p + '"></i>'; }).join('');
          return '<button type="button" class="' + cls + (c.key === pick ? ' is-pick' : '') + '" data-pick="' + c.key + '" aria-label="' + esc(longDay(c.key) + ', ' + count(list.length)) + '"><b>' + MV.dayNum(c.key) + '</b><span class="mo-dots">' + dots + '</span></button>';
        }
        var ch = MV.chips(list, 3);
        return '<div class="' + cls + '" data-cell="' + c.key + '"><button type="button" class="mo-num" data-goday="' + c.key + '" aria-label="' + esc(longDay(c.key)) + '">' + MV.dayNum(c.key) + '</button>' +
          ch.shown.map(function (e) { return '<button type="button" class="mo-chip' + edc(e) + (e.past ? ' is-past' : '') + '" data-p="' + e.p + '" data-ev="' + esc(e.id) + '" title="' + esc(e.title) + '"><b>' + hm(e.start).replace(' ', '').toLowerCase() + '</b><span>' + esc(e.title) + '</span></button>'; }).join('') +
          (ch.more ? '<button type="button" class="mo-more" data-goday="' + c.key + '">+' + ch.more + ' more</button>' : '') + '</div>';
      }).join('') + '</div>';
    });
    var below = '';
    if (phone) {
      var pl = byDay[pick] || [];
      below = '<div class="mo-pick"><div class="mo-pick__h"><b>' + esc(longDay(pick)) + '</b><small>' + (pl.length ? count(pl.length) : 'No meetings') + '</small><button type="button" class="dv-btn dv-btn--line" data-goday="' + pick + '">Open day</button></div>' + (pl.length ? '<div class="ag"><section class="ag-day">' + pl.map(agendaRow).join('') + '</section></div>' : '') + '</div>';
    }
    return '<section class="dv-card mo" aria-label="Month"><div class="dv-tl__head"><h2>Month</h2><div class="dv-legend">' + legend(all) + '</div></div>' + head + '<div class="mo-grid">' + body + '</div>' + below + '</section>';
  }

  // Keyed patch: nodes that did not change stay as they are, so events, icons and scroll positions never leave the screen.
  var keyOf = function (n) { if (n.nodeType !== 1) return ''; return n.getAttribute('data-ev') ? 'e:' + n.getAttribute('data-ev') : n.getAttribute('data-note') ? 'n:' + n.getAttribute('data-note') : n.hasAttribute('data-day') ? 'd:' + n.getAttribute('data-day') : ''; };
  function patchEl(a, b) {
    var i, at;
    for (i = a.attributes.length - 1; i >= 0; i--) { at = a.attributes[i]; if (!b.hasAttribute(at.name)) a.removeAttribute(at.name); }
    for (i = 0; i < b.attributes.length; i++) { at = b.attributes[i]; if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); }
    patchKids(a, b);
  }
  function patchKids(a, b) {
    var oldK = {}, oldU = [], i, n;
    for (n = a.firstChild; n; n = n.nextSibling) { var k0 = keyOf(n); if (k0) oldK[k0] = n; else oldU.push(n); }
    var nb = Array.prototype.slice.call(b.childNodes), used = [];
    for (i = 0; i < nb.length; i++) {
      var nw = nb[i], k = keyOf(nw), cur = null;
      if (nw.nodeType === 1 && nw.hasAttribute('data-same')) {
        for (var q = 0; q < oldU.length; q++) if (oldU[q].nodeName === nw.nodeName) { cur = oldU.splice(q, 1)[0]; break; }
        if (cur) { used.push(cur); if (a.childNodes[i] !== cur) a.insertBefore(cur, a.childNodes[i] || null); continue; }
      }
      if (k) { cur = oldK[k] || null; if (cur) delete oldK[k]; }
      else { while (oldU.length && !cur) { var c0 = oldU.shift(); if (c0.nodeType === nw.nodeType && c0.nodeName === nw.nodeName) cur = c0; } }
      if (cur && cur.nodeName === nw.nodeName) {
        if (cur.nodeType === 1) patchEl(cur, nw); else if (cur.nodeValue !== nw.nodeValue) cur.nodeValue = nw.nodeValue;
      } else cur = nw;
      used.push(cur);
      if (a.childNodes[i] !== cur) a.insertBefore(cur, a.childNodes[i] || null);
    }
    while (a.childNodes.length > used.length) a.removeChild(a.lastChild);
  }
  var shownView = '', lastNotes = '';
  function paint(html, view) {
    var t = document.createElement('template'); t.innerHTML = html;
    if (!root.firstElementChild || shownView !== view) root.innerHTML = html; else patchKids(root, t.content);
    shownView = view;
  }

  function draw() {
    if (drag && drag.on && drag.kind !== 'create') { drag.redraw = true; return; }
    var keep = root.querySelector('.dv-tl__scroll'); if (keep && !resetScroll) scrollTop = keep.scrollTop;
    var nl = root.querySelector('.dv-notes__list'), nTop = nl && state.noteView === state.view ? nl.scrollTop : 0;
    var d = state.data, now = state.now, today = dayKey(now), all = derived().all, view = state.view;
    var byDay = memo.by;
    var evs = byDay[state.day] || [];
    // The seven day strip starts today and moves only when the chosen day leaves it.
    if (!state.winStart) state.winStart = today;
    if (state.day < state.winStart) state.winStart = state.day;
    if (state.day > addDays(state.winStart, 6)) state.winStart = addDays(state.day, -6);
    var isToday = state.day === today, dayLive = isToday ? all.filter(function (e) { return e.live; }) : [];
    var cal = d.cal, needConnect = cal && !cal.connected;
    var inView = MV.range(view, state.day), total = 0;
    inView.forEach(function (k) { if (view !== 'month' || k.slice(0, 7) === state.day.slice(0, 7)) total += (byDay[k] || []).length; });
    var sub = total ? count(total) + (view === 'day' && dayLive.length ? ', ' + dayLive.length + ' live now' : '') : 'No meetings';
    var unit = view;

    var strip = '';
    if (view === 'day') for (var i = 0; i < 7; i++) {
      var k = addDays(state.winStart, i), n = (byDay[k] || []).length;
      strip += '<button type="button" class="dv-day' + (k === state.day ? ' is-on' : '') + (k === today ? ' is-today' : '') + '" role="tab" aria-selected="' + (k === state.day) + '" aria-label="' + esc(longDay(k) + ', ' + count(n)) + '" data-day="' + k + '"><small>' + wk(k, 'short') + '</small><b>' + MV.dayNum(k) + '</b><span>' + new Array(Math.min(n, 3) + 1).join('<i></i>') + '</span></button>';
    }
    var seg = '<div class="mv-seg" role="tablist" aria-label="View">' + ['day', 'week', 'month'].map(function (v) { return '<button type="button" role="tab" aria-selected="' + (v === view) + '" class="' + (v === view ? 'is-on' : '') + '" data-view="' + v + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>'; }).join('') + '</div>';

    var notesAll = d.notes || [], notes = notesAll;
    if (view !== 'day') {
      var rk = {}; inView.forEach(function (k) { if (view !== 'month' || k.slice(0, 7) === state.day.slice(0, 7)) rk[k] = 1; });
      notes = notesAll.filter(function (m) { var t = Date.parse(m.endedAt || m.startedAt || m.startsAt || m.createdAt || ''); return !isNaN(t) && rk[dayKey(t)]; });
    }
    var notesAside = '<aside class="dv-notes" aria-label="Notes"><div class="dv-notes__in"><div class="dv-notes__h"><h2>Notes</h2><span class="dv-chip">' + notes.length + '</span><span class="dv-grow"></span><a class="dv-link" href="/meet/library/">Ask or search all notes ' + ic('arrow') + '</a></div>' +
      '<div class="dv-notes__list">' + (notes.length ? notes.map(noteHtml).join('') : '<p class="dv-none">No notes yet</p>') + '</div></div></aside>';
    if (shownView === view && notesAside === lastNotes && root.querySelector('.dv-notes')) notesAside = '<aside class="dv-notes" data-same="1"></aside>'; else lastNotes = notesAside;
    var main = '', t0 = 0, listForScroll = evs;
    if (view === 'week') {
      main = '<div class="dv-cols">' + weekHtml(byDay, today, all) + notesAside + '</div>';
      var wd = MV.weekDays(state.day); listForScroll = [];
      wd.forEach(function (k2) { listForScroll = listForScroll.concat(byDay[k2] || []); });
    } else if (view === 'month') main = '<div class="dv-cols">' + monthHtml(byDay, today, all) + notesAside + '</div>';
    else {
      // A phone starts the timeline at the first meeting's hour and ends after the last, so no empty hours sit above the day.
      var phone = mobile();
      var h0 = phone && evs.length ? 23 : 8, h1 = phone && evs.length ? 0 : 18;
      // A meeting that runs past midnight is drawn to the end of its day and marked "continues".
      var dayEnd = MV.etStart(addDays(state.day, 1));
      evs.forEach(function (e) { e.capEnd = e.end > dayEnd ? dayEnd : 0; });
      evs.forEach(function (e) { h0 = Math.min(h0, MV.etHM(e.start).h); if (e.capEnd) { h1 = 24; return; } var ed = Math.min(dayEnd, Math.max(e.end, e.start + 45 * 60000)), hh = MV.etHM(ed); h1 = Math.max(h1, ed >= dayEnd ? 24 : hh.h + (hh.m ? 1 : 0)); });
      if (h1 <= h0) h1 = h0 + 1;
      t0 = MV.etStart(state.day) + h0 * 3600000;
      var geo = { t0: t0 }; state.t0 = t0;
      lanes(evs);
      var gridH = (h1 - h0) * PXH + 8;
      evs.forEach(function (e) { if (e.stack !== undefined) gridH = Math.max(gridH, (e.stackTop - t0) / 3600000 * PXH + e.stack * e.pitch + e.pitch + 8); });
      var hrs = '';
      for (var h = h0; h <= h1; h++) hrs += '<div class="dv-hr" style="top:' + (h - h0) * PXH + 'px"><span>' + hourLabel(h) + '</span></div>';
      var nowLine = isToday && now.getTime() >= t0 ? '<div class="dv-now" style="top:' + (now.getTime() - t0) / 3600000 * PXH + 'px"><span>' + hm(now) + '</span></div>' : '';
      var tlBody = evs.length || !mobile()
        ? '<div class="dv-tl__scroll"><div class="dv-tl__grid" style="height:' + gridH + 'px">' + hrs + evs.map(function (e) { return eventHtml(e, geo); }).join('') + (state.draft && state.draft.key === state.day ? draftHtml('70px', 'calc(100% - 76px)', (state.draft.start - t0) / 3600000 * PXH + 1) : '') + nowLine + '</div></div>'
        : '<div class="dv-empty"><span class="dv-tile">' + ic('cal') + '</span><b>' + (isToday ? 'No meetings today' : 'No meetings on ' + esc(wk(state.day))) + '</b><a class="dv-btn dv-btn--primary" href="/meet/book/">' + ic('plus') + 'Book a meeting</a></div>';
      main = (dayLive.length ? '<div class="dv-livewrap">' + dayLive.map(liveCard).join('') + '</div>' : '') +
        '<div class="dv-cols"><section class="dv-card dv-tl" aria-label="Timeline"><div class="dv-tl__head"><h2>Timeline</h2><div class="dv-legend">' + legend(evs) + '</div></div>' + tlBody + '</section>' +
        notesAside + '</div>';
    }
    var showToday = !(inView.indexOf(today) >= 0);
    var html = '<div class="dv dv--' + view + '">' +
      '<div class="dv-bar"><div class="dv-date"><h2>' + esc(MV.title(view, state.day)) + '</h2><p>' + sub + '</p></div>' +
      '<div class="dv-nav"><button type="button" class="dv-ib" data-step="-1" aria-label="Previous ' + unit + '">' + ic('left') + '</button><button type="button" class="dv-ib" data-step="1" aria-label="Next ' + unit + '">' + ic('right') + '</button>' + (showToday ? '<button type="button" class="dv-btn dv-btn--line" data-today="1">Today</button>' : '') + '</div>' + seg +
      '<div class="dv-grow"></div>' + (view === 'day' ? '<div class="dv-days" role="tablist" aria-label="Day">' + strip + '</div>' : '') + '</div>' +
      (needConnect ? '<div class="dv-conn"><span>Google Calendar meetings are not connected.</span><a class="dv-btn dv-btn--primary" href="/api/google/connect?next=' + encodeURIComponent('/meet/') + '">Connect my Google</a></div>' : '') +
      (cal && cal.error ? '<div class="dv-conn"><span>' + esc(cal.error) + '</span></div>' : '') + main + '</div>';
    paint(html, view);
    resetScroll = false;
    var sc = view === 'month' ? null : root.querySelector('.dv-tl__scroll');
    if (sc) {
      var inRange = inView.indexOf(today) >= 0;
      // Hours from the top of the grid: the day view counts from its first hour, the week view from the week's first hour.
      var off = view === 'week' ? function (ms) { return (ms - MV.etStart(dayKey(ms))) / 3600000 - state.wkH0; } : function (ms) { return (ms - t0) / 3600000; };
      if (scrollTop != null) sc.scrollTop = scrollTop;
      else if (inRange) {
        // Open on the present. Once the last meeting is over, open on that meeting instead of an empty evening.
        var ahead = listForScroll.some(function (e) { return e.end >= now.getTime(); });
        var lastTop = listForScroll.length ? Math.max.apply(null, listForScroll.map(function (e) { return off(e.start) * PXH; })) - 160 : 0;
        var nowTop = off(now.getTime()) * PXH - 240;
        sc.scrollTop = Math.max(0, ahead ? nowTop : Math.min(nowTop, lastTop));
      } else if (listForScroll.length) sc.scrollTop = Math.max(0, Math.min.apply(null, listForScroll.map(function (e) { return off(e.start); })) * PXH - 40);
    }
    scrollTop = null;
    var nl2 = root.querySelector('.dv-notes__list'); if (nl2 && nTop) nl2.scrollTop = nTop;
    state.noteView = view;
    renderPanel();
  }

  function setDay(k) { if (state.draft && !state.draft.busy) state.draft = null; state.day = k; state.sel = null; state.confirm = null; state.pick = ''; scrollTop = null; resetScroll = true; draw(); ensureCal(); }
  function setView(v) {
    if (v === state.view) return;
    if (state.draft && !state.draft.busy) state.draft = null;
    state.view = v; state.pick = ''; scrollTop = null; resetScroll = true;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* private mode */ }
    draw(); ensureCal();
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('is-on'); }, 3000);
  }

  // Join on a Favor room opens the pre-join sheet (who is in the room, microphone, camera) instead of dropping the person in.
  function prejoin(id, title) {
    if (!window.FavorPrejoin) { location.href = '/meet/room/?m=' + encodeURIComponent(id); return; }
    window.FavorPrejoin.open({
      title: title || 'Meeting',
      icon: 'video',
      me: { email: '', name: '', pid: (function () { try { return sessionStorage.getItem('meet.pid.' + id) || ''; } catch (e) { return ''; } })() },
      load: function () { return api('meetings/' + encodeURIComponent(id)).then(function (r) { var ppl = r.people || []; return { live: ppl.length > 0, startedAt: r.meeting && r.meeting.startedAt && ppl.length ? Date.parse(r.meeting.startedAt) : 0, people: ppl }; }); },
      emptyLine: 'Nobody is in the room yet',
      joinLabel: function () { return 'Join'; },
      join: function () { return Promise.resolve({ id: id, url: '/meet/room/?m=' + encodeURIComponent(id) }); }
    });
  }
  // ---------------------------------------------------------------- the meeting panel
  var layer = document.createElement('div');
  layer.id = 'mp'; layer.className = 'mp';
  document.body.appendChild(layer);
  var focusOnce = false;

  var urlId = function (id) { return id.indexOf('c:') === 0 ? 'ext:' + id.slice(2) : id; };
  var fromUrlId = function (u) { return u.indexOf('ext:') === 0 ? 'c:' + u.slice(4) : u; };
  function findEv(id) { var all = state.data ? derived().all : []; for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  // Same wording as the Today sheet: "Tuesday, Oct 13, 2:00 PM to 3:00 PM ET".
  function whenLine(e) {
    return new Date(e.start).toLocaleDateString('en-US', { timeZone: MV.TZ, weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + hm(e.start) + ' to ' + hm(e.end) + ' ET';
  }
  function copy(text, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast(text); });
    else toast(text);
  }

  // The chosen event is marked in place. The grid is not drawn again.
  function syncSel() {
    var on = root.querySelectorAll('[data-ev]');
    for (var i = 0; i < on.length; i++) {
      var is = on[i].getAttribute('data-ev') === state.open;
      if (on[i].classList.contains('is-sel') !== is) on[i].classList.toggle('is-sel', is);
      if (on[i].hasAttribute('aria-pressed') && on[i].getAttribute('aria-pressed') !== String(is)) on[i].setAttribute('aria-pressed', String(is));
    }
  }
  function openEv(id) {
    state.open = id; state.panel = 'detail'; state.confirm = null; state.move = null; state.moveErr = ''; state.moveWrite = false; state.moveMail = true; state.moveBusy = false; focusOnce = true;
    var u = '/meet/?m=' + encodeURIComponent(urlId(id));
    try { history.pushState({ mp: 1 }, '', u); } catch (e) { /* sandboxed frame */ }
    syncSel(); renderPanel(); wantInfo(id);
  }
  function closePanel(fromPop) {
    if (!state.open) return;
    state.open = ''; state.panel = 'detail'; state.move = null;
    if (!fromPop && history.state && history.state.mp) history.back();
    else if (!fromPop && /[?&]m=/.test(location.search)) { try { history.replaceState(null, '', '/meet/'); } catch (e) { /* ignore */ } }
    renderPanel(); syncSel();
  }
  function onPop() {
    var m = new URLSearchParams(location.search).get('m') || '';
    if (!m) { if (state.open) closePanel(true); return; }
    var id = fromUrlId(m);
    if (id !== state.open) {
      state.open = id; state.panel = 'detail'; focusOnce = true;
      var pe = findEv(id);
      if (pe && state.view === 'day' && dayKey(pe.start) !== state.day) { state.day = dayKey(pe.start); resetScroll = true; draw(); } else { syncSel(); renderPanel(); }
      ensureLoaded(id);
    }
  }
  // A shared link can name a meeting that is not on the lists (an older Favor room). Ask for that one.
  function ensureLoaded(id) {
    if (!state.data || findEv(id) || id.indexOf('c:') === 0 || !/^[0-9a-f]{24}$/.test(id)) { wantInfo(id); return; }
    api('meetings/' + id).then(function (r) {
      if (stopped || !r.meeting) return;
      state.extra = [r.meeting]; state.rev++; var e = findEv(id);
      if (e) state.day = dayKey(e.start);
      draw();
    }).catch(function () { state.missing = id; renderPanel(); });
    wantInfo(id);
  }
  // Settings and prep for a Favor room come from the room's own routes, read once per open.
  function wantInfo(id) {
    var e = findEv(id); if (!e || e.cal) return;
    if (!state.info[id]) { state.info[id] = { guests: false }; api('meetings/' + id).then(function (r) { state.info[id] = { guests: !!r.guestsEnabled }; if (state.open === id) renderPanel(); }).catch(function () {}); }
    if (!state.prep[id] && !(e.hub && e.hub.status === 'ended') && e.start > Date.now() - 3600000) {
      state.prep[id] = { loading: true };
      api('meetings/' + id + '/prep').then(function (r) { state.prep[id] = { last: r.last || null, open: (r.openItems || []).length }; if (state.open === id) renderPanel(); }).catch(function () { state.prep[id] = {}; });
    }
  }

  function row(label, body) { return '<div class="mp-row"><dt>' + label + '</dt><dd>' + body + '</dd></div>'; }
  function personRow(p) { return '<li class="mp-pp">' + av(p.name) + '<span><b>' + esc(p.name) + '</b>' + (p.sub ? '<small>' + esc(p.sub) + '</small>' : '') + '</span></li>'; }
  function invited(e) {
    var out = [];
    if (e.cal) (e.cal.people || []).forEach(function (p) { out.push({ name: p.name || p.email, email: p.email, sub: p.name ? p.email : '' }); });
    else {
      var m = e.hub, hostE = String(m.hostEmail || '').toLowerCase();
      (m.invitees || []).forEach(function (i) { if (String(i.email || '').toLowerCase() !== hostE) out.push({ name: nameOf(i), email: i.email || '', sub: i.guest ? 'Guest' : '' }); });
    }
    return out;
  }
  function recLabel(r) { return r === 'video' ? 'Notes and video' : r === 'notes' ? 'Notes' : 'Not recorded'; }

  function closeBtn() { return '<button type="button" class="mp-x" data-mp="close" aria-label="Close">' + ic('x') + '</button>'; }
  function headEdit(e, kicker) {
    return '<header class="mp-h">' + pv(e.p) + '<div class="mp-h__t"><small>' + esc(kicker || provName(e.p)) + '</small><input class="mp-ed mp-ti" type="text" data-f="title" maxlength="140" value="' + esc(e.title) + '" aria-label="Title" autocomplete="off"></div>' + closeBtn() + '</header>';
  }
  function head(e, kicker) {
    if (e.edit) return headEdit(e, kicker);
    return '<header class="mp-h">' + pv(e.p) + '<div class="mp-h__t"><small>' + esc(kicker || provName(e.p)) + (e.live ? ' · Live now' : e.past ? ' · Ended' : '') + '</small><h3>' + esc(e.title) + '</h3><p>' + esc(whenLine(e)) + '</p></div>' + closeBtn() + '</header>';
  }

  function detailPanel(e) {
    var acts = '', foot = '', rows = '';
    if (e.cal) {
      var c = e.cal, over = e.past;
      if (!over) acts += '<a class="dv-btn dv-btn--primary mp-first" href="' + esc(c.joinUrl) + '" target="_blank" rel="noopener">' + ic('arrow') + 'Join on ' + esc(provName(e.p)) + '</a>';
      if (!over) acts += '<button type="button" class="dv-btn dv-btn--line" data-mp="move">Move to FavorOS</button>';
      rows += row('Held on', esc(provName(e.p)) + (over ? ', ended' : ''));
      if (c.organizerName) rows += row('Organizer', esc(c.organizerName));
    } else {
      var m = e.hub, rep = m.repeat && m.repeat !== 'none', scheduled = m.mine && m.startsAt && m.status === 'scheduled';
      if (m.status === 'ended') { if (e.noteId) acts += '<a class="dv-btn dv-btn--primary mp-first" href="/meet/notes/?m=' + esc(m.id) + '">' + ic('doc') + 'Notes</a>'; }
      else acts += '<a class="dv-btn dv-btn--primary mp-first" href="/meet/room/?m=' + esc(m.id) + '">' + ic('video') + (e.live || e.open ? 'Join' : 'Open') + '</a>';
      if (m.status !== 'ended') acts += '<a class="dv-btn dv-btn--line" href="/meet/prep/?m=' + esc(m.id) + '">' + ic('doc') + 'Prep</a>';
      rows += row('Held on', 'FavorOS');
      rows += row('Organizer', esc(m.hostName || nameOf({ email: m.hostEmail })));
      if (m.status !== 'ended') {
        if (m.mine) {
          rows += row('Recording', '<span class="mp-seg" role="group" aria-label="Recording">' + [['off', 'Off'], ['notes', 'Notes'], ['video', 'Notes and video']].map(function (r) { return '<button type="button" class="' + (m.rec === r[0] ? 'is-on' : '') + '" aria-pressed="' + (m.rec === r[0]) + '" data-rec="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</span>');
        } else rows += row('Recording', esc(recLabel(m.rec)));
      } else rows += row('Recording', esc(recLabel(m.rec)));
      foot += '<button type="button" class="dv-btn dv-btn--ghost" data-mp="copy">Copy link</button>';
      if (m.mine && state.info[m.id] && state.info[m.id].guests && m.status !== 'ended') foot += '<button type="button" class="dv-btn dv-btn--ghost" data-mp="guest">Copy guest link</button>';
      if (scheduled && !rep) foot += '<a class="dv-btn dv-btn--ghost" href="/meet/book/?edit=' + esc(m.id) + '">Edit</a>';
      if (scheduled) {
        if (state.confirm === m.id) foot += '<span class="mp-ask">' + (rep ? 'Cancel every meeting in this series?' : 'Cancel this meeting?') + ' Invitees get a cancellation.</span><button type="button" class="dv-btn dv-btn--danger" data-yes="' + esc(m.id) + '">' + (rep ? 'Cancel series' : 'Yes, cancel') + '</button><button type="button" class="dv-btn dv-btn--ghost" data-no="1">Keep it</button>';
        else foot += '<button type="button" class="dv-btn dv-btn--danger" data-cancel="' + esc(m.id) + '">Cancel meeting</button>';
      }
    }
    if (e.edit) {
      rows += row('Date', '<input class="mp-ed" type="date" data-f="date" value="' + dayKey(e.start) + '" aria-label="Date">');
      rows += row('Time', '<span class="mp-time"><input class="mp-ed" type="time" step="300" data-f="start" value="' + hhmm(e.start) + '" aria-label="Start time"><span>to</span><input class="mp-ed" type="time" step="300" data-f="end" value="' + hhmm(e.end) + '" aria-label="End time"><small>ET</small></span>');
    }
    var inv = invited(e);
    rows += row('Invited', inv.length ? '<ul class="mp-pl">' + inv.map(personRow).join('') + '</ul>' : 'Just the organizer');
    if (e.edit) rows += row('Agenda', '<textarea class="mp-ed mp-ed--area" data-f="desc" rows="3" maxlength="2000" placeholder="Add an agenda" aria-label="Agenda">' + esc(e.desc || '') + '</textarea>');
    else if (e.desc) rows += row('Agenda', '<p class="mp-text">' + esc(e.desc) + '</p>');
    if (!e.cal) {
      var m2 = e.hub, pr = state.prep[m2.id], nt = '';
      if (m2.status === 'ended') {
        var line = firstLine(m2.summary);
        nt = (line ? '<p class="mp-text">' + esc(line) + '</p>' : '') + (e.noteId ? '<a class="dv-link" href="/meet/notes/?m=' + esc(m2.id) + '">Notes and transcript' + (m2.actionCount ? ', ' + m2.actionCount + ' action' + (m2.actionCount === 1 ? '' : 's') : '') + ' ' + ic('arrow') + '</a>' : '');
      } else if (pr && pr.last) {
        nt = '<p class="mp-text">Last time: <a href="/meet/notes/?m=' + esc(pr.last.id) + '">' + esc(pr.last.title) + '</a>' + (firstLine(pr.last.summary) ? '. ' + esc(firstLine(pr.last.summary)) : '') + '</p>' + (pr.open ? '<p class="mp-text">' + pr.open + ' open item' + (pr.open === 1 ? '' : 's') + ' from past meetings with these people.</p>' : '');
      } else if (pr && pr.open) nt = '<p class="mp-text">' + pr.open + ' open item' + (pr.open === 1 ? '' : 's') + ' from past meetings with these people.</p>';
      if (nt) rows += row(m2.status === 'ended' ? 'Notes' : 'Prep', nt);
    }
    return head(e) + '<div class="mp-b"><div class="mp-acts">' + acts + '</div><dl class="mp-rows">' + rows + '</dl></div>' + (foot ? '<footer class="mp-f">' + foot + '</footer>' : '');
  }

  // "katharine@favorintl.org" becomes Katharine; an address that does not read as a first name becomes "them". Same rule as Today.
  function firstOf(email) {
    var w = String(email || '').split('@')[0].split(/[._-]/)[0];
    return /^[a-z]{3,}$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : 'them';
  }
  // The Move to FavorOS sheet, word for word as on Today. It posts to the same route with the same fields.
  function movePanel(e) {
    var s = state.move || e, n = invited(s).length, c = s.cal, may = !!(state.data.cal && state.data.cal.canWrite), write = state.moveWrite;
    var held = 'Zoom';
    held = provName(s.p);
    var body = '<ul class="mp-list"><li>Makes a FavorOS meeting on ' + esc(whenLine(s)) + '.</li>' +
      '<li>' + (n ? 'Invites the same ' + n + (n === 1 ? ' person' : ' people') + ' in FavorOS. ' + (state.moveMail ? 'FavorOS emails them the link.' : 'FavorOS sends no email.') : 'Only you are on it.') + '</li>' +
      '<li>It is not recorded. The host can change that in the meeting.</li>' +
      '<li id="mp-stays">' + (c.canEdit ? 'Your calendar event gets the FavorOS link in its location and at the top of its notes, and the ' + esc(held) + ' link comes off.' : 'Your calendar event is not changed.') + '</li></ul>';
    if (!c.canEdit) body += '<p class="mp-note">Someone else organizes this event, so Google does not let you change it. The FavorOS meeting is made, and the calendar event keeps its ' + esc(held) + ' link. The organizer has to add the FavorOS link.</p>';
    else if (!may) body += '<p class="mp-note">To put the FavorOS link on the calendar event, FavorOS needs your permission to edit your calendar events.</p><a class="dv-btn dv-btn--line" href="/api/google/connect?add=meetings&amp;next=%2Fmeet%2F">Allow calendar edits</a>';
    if (n > 0) body += '<label class="mp-check"><input type="checkbox" data-mp="mail"' + (state.moveMail ? ' checked' : '') + '><span>' + (n === 1 ? 'Email ' + esc(firstOf(invited(s)[0].email)) + ' the FavorOS link' : 'Email the ' + n + ' people the FavorOS link') + '</span></label>';
    if (state.moveErr) body += '<p class="mp-err" role="alert">' + esc(state.moveErr) + '</p>';
    return '<header class="mp-h"><div class="mp-h__t"><h3>Move to FavorOS</h3><p>' + esc(s.title) + '</p></div>' + closeBtn() + '</header><div class="mp-b">' + body +
      '<div class="mp-acts mp-acts--end"><button type="button" class="dv-btn dv-btn--primary mp-first" data-mp="domove"' + (state.moveBusy || (s.cal.canEdit && !may) ? ' disabled' : '') + '>' + (state.moveBusy ? 'Moving' : 'Move to FavorOS') + '</button><button type="button" class="dv-btn dv-btn--ghost" data-mp="back">Back</button></div></div>';
  }
  function movedPanel() {
    var s = state.moved;
    return '<header class="mp-h"><div class="mp-h__t"><h3>Moved to FavorOS</h3><p>' + esc(s.title) + '</p></div>' + closeBtn() + '</header><div class="mp-b"><ul class="mp-list"><li>' + esc(s.when) + '.</li><li>' + (s.linked ? 'The FavorOS link is on your calendar event.' : 'Your calendar event is not changed.') + '</li>' +
      (s.emailed ? '<li>Emailed the link to ' + s.emailed + (s.emailed === 1 ? ' person' : ' people') + '.</li>' : '') +
      (s.emailFailed ? '<li>' + s.emailFailed + (s.emailFailed === 1 ? ' email' : ' emails') + ' did not go out. Share the room link with them.</li>' : '') + '</ul>' +
      (s.linkError ? '<p class="mp-note">' + esc(s.linkError) + '</p>' : '') +
      '<div class="mp-acts mp-acts--end"><a class="dv-btn dv-btn--primary mp-first" href="' + esc(s.room) + '">Open the meeting</a><button type="button" class="dv-btn dv-btn--ghost" data-mp="close">Done</button></div></div>';
  }

  function renderPanel() {
    if (!state.open) { if (layer.firstChild) layer.innerHTML = ''; layer.classList.remove('is-open'); document.documentElement.classList.remove('mp-lock'); return; }
    var e = state.data ? findEv(state.open) : null, inner;
    if (state.panel === 'moved' && state.moved) inner = movedPanel();
    else if (!state.data) inner = '<header class="mp-h"><div class="mp-h__t"><h3>Meeting</h3></div>' + closeBtn() + '</header><div class="mp-b"><p class="dv-none">Loading</p></div>';
    else if (!e) inner = '<header class="mp-h"><div class="mp-h__t"><h3>Meeting</h3></div>' + closeBtn() + '</header><div class="mp-b"><p class="dv-none">' + (state.missing === state.open || state.open.indexOf('c:') === 0 ? 'That meeting is not on your list.' : 'Loading') + '</p></div>';
    else inner = state.panel === 'move' && e.cal ? movePanel(e) : detailPanel(e);
    var old = layer.querySelector('.mp-b'), keep = old ? old.scrollTop : 0, was = layer.classList.contains('is-open');
    var sheet = was ? layer.querySelector('.mp-sheet') : null;
    if (sheet) { sheet.setAttribute('aria-label', e ? e.title : 'Meeting'); var tp = document.createElement('template'); tp.innerHTML = inner; patchKids(sheet, tp.content); }
    else layer.innerHTML = '<div class="mp-scrim" data-mp="close"></div><aside class="mp-sheet" role="dialog" aria-modal="true" aria-label="' + esc(e ? e.title : 'Meeting') + '">' + inner + '</aside>';
    layer.classList.add('is-open'); document.documentElement.classList.add('mp-lock');
    var nb = layer.querySelector('.mp-b'); if (nb && was) nb.scrollTop = keep;
    if (e && e.edit) syncFields(e);
    if (focusOnce) { focusOnce = false; var f = layer.querySelector('.mp-first') || layer.querySelector('.mp-x'); if (f) f.focus({ preventScroll: true }); }
  }

  function moveNow() {
    var e = findEv(state.open); if (!e || !e.cal || state.moveBusy) return;
    state.move = e; state.moveBusy = true; state.moveErr = ''; renderPanel();
    // Same route and fields as Today.
    var body = { eventId: e.cal.eventId, emailInvitees: invited(e).length > 0 && state.moveMail };
    api('../hub/day-move', { method: 'POST', body: body }).then(function (r) {
      state.moved = { title: e.title, when: whenLine(e), room: r.room || '/meet/room/?m=' + r.id, linked: !!r.linked, linkError: r.linkError || '', emailed: r.emailed || 0, emailFailed: r.emailFailed || 0 };
      state.panel = 'moved'; state.moveBusy = false; renderPanel(); load(true);
    }).catch(function (x) {
      state.moveBusy = false;
      if (x.code === 'already') { toast('This meeting is already in FavorOS.'); state.panel = 'detail'; closePanel(); load(true); return; }
      if (x.code === 'consent') { state.moveErr = x.message; renderPanel(); return; }
      state.moveErr = x.message || 'Could not move it. Try again.'; renderPanel();
    });
  }

  function onPanelClick(ev) {
    var t = ev.target.closest('[data-mp], [data-rec], [data-yes], [data-no], [data-cancel], a'); if (!t || !layer.contains(t)) return;
    var href = t.tagName === 'A' ? t.getAttribute('href') || '' : '';
    var jm = /^\/meet\/room\/\?m=([0-9a-f]{24})$/.exec(href);
    if (jm && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); return prejoin(jm[1], titleOf(jm[1])); }
    var a = t.dataset.mp, id = state.open, e = findEv(id);
    if (a === 'close') return closePanel();
    if (a === 'move' && e) { state.panel = 'move'; state.move = e; state.moveErr = ''; state.moveWrite = false; state.moveMail = true; focusOnce = true; return renderPanel(); }
    if (a === 'back') { state.panel = 'detail'; state.moveErr = ''; return renderPanel(); }
    if (a === 'domove') return moveNow();
    if (a === 'copy' && e && e.hub) return copy(location.origin + '/meet/room/?m=' + e.hub.id, 'Link copied');
    if (a === 'guest' && e && e.hub) { api('meetings/' + e.hub.id + '/guestlink', { method: 'POST', body: {} }).then(function (r) { copy(r.url, 'Guest link copied'); }).catch(function (x) { toast(x.message); }); return; }
    if (t.dataset.rec && e && e.hub) {
      var prev = e.hub.rec; e.hub.rec = t.dataset.rec; e.rec = t.dataset.rec; renderPanel();
      api('meetings/' + e.hub.id + '/update', { method: 'POST', body: { rec: t.dataset.rec } }).then(function () { toast('Recording set'); load(true); }).catch(function (x) { e.hub.rec = prev; e.rec = prev; renderPanel(); toast(x.message); });
      return;
    }
    if (t.dataset.cancel) { state.confirm = t.dataset.cancel; return renderPanel(); }
    if (t.dataset.no) { state.confirm = null; return renderPanel(); }
    if (t.dataset.yes) {
      t.disabled = true;
      api('meetings/' + t.dataset.yes + '/update', { method: 'POST', body: { status: 'cancelled' } }).then(function () { toast('Cancelled'); state.confirm = null; closePanel(); load(true); }).catch(function (x) { t.disabled = false; toast(x.message); });
    }
  }
  layer.addEventListener('click', onPanelClick);
  layer.addEventListener('change', function (ev) {
    var a = ev.target && ev.target.dataset && ev.target.dataset.mp;
    if (a === 'write') { state.moveWrite = ev.target.checked; renderPanel(); }
    if (a === 'mail') { state.moveMail = ev.target.checked; renderPanel(); }
  });
  function onKey(ev) { if (ev.key === 'Escape' && state.open) { ev.preventDefault(); if (state.panel === 'move') { state.panel = 'detail'; renderPanel(); } else closePanel(); } }
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  // The shell reloads the page on a popstate it does not know. Opening and closing the panel is this page's own history.
  window.__hubPopOwn = function () { return !stopped && location.pathname.replace(/\/?$/, '/') === '/meet/'; };
  window.addEventListener('resize', (function () { var was = mobile(); return function () { var now = mobile(); if (now !== was) { was = now; if (state.data && !stopped) draw(); } }; })());

  // ---------------------------------------------------------------- editing in place: drag, resize, create, save
  // Every change is shown at once (an override on top of the loaded data) and sent to Google Calendar or the meeting route.
  // When the save fails the override is dropped and the event is drawn where it was.
  var SNAP = 15, drag = null, noClickUntil = 0, tipEl = null;
  var shortMsg = function (m) { m = String(m || ''); return m && m.length <= 80 ? m : 'Could not save. Nothing changed.'; };
  var minOfDay = function (ms) { var h = MV.etHM(ms); return h.h * 60 + h.m; };
  function atDay(key, minutes) { var extra = Math.floor(minutes / 1440), m = ((minutes % 1440) + 1440) % 1440; return MV.etStart(addDays(key, extra)) + m * 60000; }
  var snapMin = function (v) { return Math.round(v / SNAP) * SNAP; };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var hhmm = function (ms) { var h = MV.etHM(ms); return pad2(h.h) + ':' + pad2(h.m); };
  var toMin = function (v) { var p = String(v).split(':'); return (+p[0]) * 60 + (+p[1]); };

  function saveHub() {
    try { var v = state.data; sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), up: v.up, recent: v.recent, notes: v.notes, people: v.people })); } catch (e) { /* storage full or off */ }
  }
  // The saved values go into the loaded data, then the override is dropped.
  function commitLocal(e, o) {
    if (e.cal) {
      var c = e.cal;
      if (o.start) { c.startsAt = new Date(o.start).toISOString(); c.endsAt = new Date(o.end).toISOString(); }
      if (o.title != null) c.title = o.title;
      if (o.desc != null) c.description = o.desc;
      saveCal();
    } else {
      var m = e.hub;
      if (o.start) { m.startsAt = new Date(o.start).toISOString(); m.endsAt = new Date(o.end).toISOString(); m.durationMin = Math.round((o.end - o.start) / 60000); }
      if (o.title != null) m.title = o.title;
      if (o.desc != null) m.agenda = o.desc;
      saveHub();
    }
  }
  function applyEdit(e, patch) {
    if (state.pend[e.id]) { toast('Still saving the last change.'); return false; }
    var next = {};
    if (patch.start != null) { next.start = patch.start; next.end = patch.end; }
    if (patch.title != null) next.title = patch.title;
    if (patch.desc != null) next.desc = patch.desc;
    state.ov[e.id] = next; state.pend[e.id] = 1; state.rev++; draw();
    var path, body;
    if (e.cal) {
      path = 'meetings/calendar/update'; body = { eventId: e.cal.eventId };
      if (next.start) { body.startsAt = new Date(next.start).toISOString(); body.endsAt = new Date(next.end).toISOString(); }
      if (next.title != null) body.title = next.title;
      if (next.desc != null) body.description = next.desc;
    } else {
      path = 'meetings/' + e.hub.id + '/update'; body = {};
      if (next.start) { body.startsAt = new Date(next.start).toISOString(); body.endsAt = new Date(next.end).toISOString(); }
      if (next.title != null) body.title = next.title;
      if (next.desc != null) body.agenda = next.desc;
    }
    api(path, { method: 'POST', body: body }).then(function () {
      if (stopped) return;
      commitLocal(e, next);
      delete state.ov[e.id]; delete state.pend[e.id]; state.rev++; draw();
      toast(next.start ? 'Moved' : 'Saved');
    }).catch(function (x) {
      if (stopped) return;
      delete state.ov[e.id]; delete state.pend[e.id]; state.rev++; draw();
      toast(shortMsg(x && x.message));
    });
    return true;
  }

  function colsInfo() {
    var out = [], cs = root.querySelectorAll('.wk-col');
    for (var i = 0; i < cs.length; i++) { var r = cs[i].getBoundingClientRect(); out.push({ key: cs[i].getAttribute('data-col'), left: r.left, right: r.right }); }
    return out;
  }
  function tip(text, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'dv-tip'; tipEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(tipEl); }
    if (tipEl.textContent !== text) tipEl.textContent = text;
    tipEl.style.transform = 'translate(' + Math.round(x + 14) + 'px,' + Math.round(y + 14) + 'px)';
  }
  function dropTip() { if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl); tipEl = null; }

  function onDown(ev) {
    if (drag || stopped || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    var b = ev.target.closest('.dv-ev, .mo-chip');
    if (b && !root.contains(b)) b = null;
    if (b && b.classList.contains('dv-new')) return;
    if (!b) return startCreate(ev);
    var e = findEv(b.getAttribute('data-ev'));
    if (!e || !e.edit || state.pend[e.id] || state.draft) return;
    var month = b.classList.contains('mo-chip'), touch = ev.pointerType !== 'mouse', sc = root.querySelector('.dv-tl__scroll');
    drag = { kind: month ? 'month' : ev.target.closest('.dv-rs') ? 'resize' : 'move', e: e, el: b, x0: ev.clientX, y0: ev.clientY, lx: ev.clientX, ly: ev.clientY, sc: sc, st0: sc ? sc.scrollTop : 0, pid: ev.pointerId, touch: touch, armed: !touch, on: false, s0: e.start, e0: e.end, style0: b.getAttribute('style'), cols: null, idx0: 0, key0: dayKey(e.start), ns: null, ne: null, target: '', vel: 0, raf: 0, timer: 0 };
    if (state.view === 'week' && !month) {
      drag.cols = colsInfo();
      var col = b.closest('.wk-col'), k0 = col ? col.getAttribute('data-col') : drag.key0;
      drag.key0 = k0; for (var i = 0; i < drag.cols.length; i++) if (drag.cols[i].key === k0) drag.idx0 = i;
    }
    if (touch) drag.timer = setTimeout(function () { if (drag && !drag.on) { drag.armed = true; b.classList.add('is-arm'); try { if (navigator.vibrate) navigator.vibrate(8); } catch (x) { /* none */ } } }, 320);
    listen(true);
  }
  function listen(on) {
    var f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointermove', onMove); document[f]('pointerup', onUp); document[f]('pointercancel', onCancel); document[f]('keydown', onDragKey, true);
    document[f]('touchmove', onTouchMove, { passive: false });
  }
  function onTouchMove(ev) { if (drag && (drag.on || drag.armed) && ev.cancelable) ev.preventDefault(); }
  function onDragKey(ev) { if (ev.key === 'Escape' && drag) { ev.preventDefault(); ev.stopPropagation(); endDrag(false); } }
  function onCancel() { endDrag(false); }
  function onUp(ev) { if (drag && ev.pointerId === drag.pid) endDrag(true); }
  function onMove(ev) {
    var d = drag; if (!d || ev.pointerId !== d.pid) return;
    var dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
    d.lx = ev.clientX; d.ly = ev.clientY;
    if (!d.on) {
      if (d.touch && !d.armed) { if (Math.abs(dx) + Math.abs(dy) > 8) endDrag(false); return; }
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      begin(d);
    }
    if (d.kind === 'create') return moveCreate(d);
    updateDrag();
  }
  function begin(d) {
    d.on = true; root.classList.add('is-dragging');
    if (d.kind === 'create') { state.draft = { key: d.key, start: d.a, end: d.a + SNAP * 60000, editing: false }; draw(); d.el = root.querySelector('.dv-new'); d.base = { top: d.el ? parseFloat(d.el.style.top) : 0, s: state.draft.start }; return; }
    d.el.classList.add('is-drag'); d.el.classList.remove('is-arm');
    try { d.el.setPointerCapture(d.pid); } catch (x) { /* none */ }
    if (d.kind === 'month') { d.ghost = d.el.cloneNode(true); d.ghost.className += ' mo-ghost'; d.ghost.style.width = d.el.offsetWidth + 'px'; document.body.appendChild(d.ghost); }
  }
  function updateDrag() {
    var d = drag, e = d.e, el = d.el;
    if (d.kind === 'month') {
      d.ghost.style.transform = 'translate(' + Math.round(d.lx - 20) + 'px,' + Math.round(d.ly - 11) + 'px)';
      var under = document.elementsFromPoint(d.lx, d.ly), cell = null;
      for (var i = 0; i < under.length; i++) { var c = under[i].closest && under[i].closest('.mo-cell[data-cell]'); if (c && root.contains(c)) { cell = c; break; } }
      var key = cell ? cell.getAttribute('data-cell') : '';
      if (key !== d.target) {
        var old = root.querySelector('.mo-cell.is-drop'); if (old) old.classList.remove('is-drop');
        if (cell) cell.classList.add('is-drop');
        d.target = key;
      }
      d.ns = key ? atDay(key, minOfDay(d.s0)) : null; d.ne = key ? d.ns + (d.e0 - d.s0) : null;
      if (d.ns != null) tip(new Date(d.ns).toLocaleDateString('en-US', { timeZone: MV.TZ, weekday: 'short', month: 'short', day: 'numeric' }), d.lx, d.ly); else dropTip();
      return;
    }
    var dyy = d.ly - d.y0 + (d.sc ? d.sc.scrollTop - d.st0 : 0), dMin = snapMin(dyy / PXH * 60), label;
    if (d.kind === 'resize') {
      var end = Math.max(d.e0 + dMin * 60000, d.s0 + SNAP * 60000);
      d.ns = d.s0; d.ne = end;
      el.style.height = Math.max(20, (end - d.s0) / 3600000 * PXH - 3) + 'px';
      label = hm(d.s0) + ' to ' + hm(end);
    } else {
      var k = d.key0, shift = 0;
      if (d.cols && d.cols.length) {
        var idx = d.idx0;
        for (var j = 0; j < d.cols.length; j++) if (d.lx >= d.cols[j].left && d.lx < d.cols[j].right) idx = j;
        if (d.lx < d.cols[0].left) idx = 0; if (d.lx >= d.cols[d.cols.length - 1].right) idx = d.cols.length - 1;
        k = d.cols[idx].key; shift = d.cols[idx].left - d.cols[d.idx0].left;
      }
      d.ns = atDay(k, minOfDay(d.s0) + dMin); d.ne = d.ns + (d.e0 - d.s0);
      el.style.transform = 'translate(' + Math.round(shift) + 'px,' + (dMin / 60 * PXH) + 'px)';
      label = (dayKey(d.ns) !== dayKey(d.s0) ? MV.dayName(dayKey(d.ns), false) + ' ' : '') + hm(d.ns) + ' to ' + hm(d.ne);
    }
    tip(label, d.lx, d.ly);
    // Near the top or bottom of the grid the grid scrolls.
    if (d.sc) {
      var r = d.sc.getBoundingClientRect();
      d.vel = d.ly < r.top + 36 ? -10 : d.ly > r.bottom - 36 ? 10 : 0;
      if (d.vel && !d.raf) d.raf = requestAnimationFrame(autoScroll);
    }
  }
  function autoScroll() {
    var d = drag; if (!d || !d.on || !d.vel) { if (d) d.raf = 0; return; }
    d.sc.scrollTop += d.vel; updateDrag(); d.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(commit) {
    var d = drag; if (!d) return;
    drag = null; listen(false); clearTimeout(d.timer); if (d.raf) cancelAnimationFrame(d.raf);
    dropTip(); root.classList.remove('is-dragging');
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    var hot = root.querySelector('.mo-cell.is-drop'); if (hot) hot.classList.remove('is-drop');
    if (d.kind === 'create') return endCreate(d, commit);
    if (d.el) { d.el.classList.remove('is-drag'); d.el.classList.remove('is-arm'); try { d.el.releasePointerCapture(d.pid); } catch (x) { /* none */ } }
    if (!d.on) return;
    noClickUntil = Date.now() + 400;
    var changed = commit && d.ns != null && (d.ns !== d.s0 || d.ne !== d.e0);
    if (!changed) {
      if (d.style0 == null) d.el.removeAttribute('style'); else d.el.setAttribute('style', d.style0);
      if (d.redraw) draw();
      return;
    }
    applyEdit(d.e, { start: d.ns, end: d.ne });
  }
  // A click right after a drag is the drag ending, not a request to open the meeting.
  root.addEventListener('click', function (ev) { if (Date.now() < noClickUntil) { ev.stopPropagation(); ev.preventDefault(); } }, true);

  // ---- a new meeting: drag over empty space in Day or Week, then type the title
  function startCreate(ev) {
    if (ev.pointerType !== 'mouse' || mobile() || (state.view !== 'day' && state.view !== 'week')) return;
    if (state.draft) { if (state.draft.busy) return; if (ev.target.closest('.dv-new')) return; cancelDraft(); }
    var grid = ev.target.closest('.dv-tl__grid'); if (!grid || !root.contains(grid)) return;
    var key, t0, top;
    if (state.view === 'week') {
      var col = ev.target.closest('.wk-col'); if (!col) return;
      key = col.getAttribute('data-col'); t0 = MV.etStart(key) + state.wkH0 * 3600000; top = col.getBoundingClientRect().top;
    } else { key = state.day; t0 = state.t0; top = grid.getBoundingClientRect().top; }
    var step = SNAP * 60000, at = function (y) { return t0 + (y - top) / PXH * 3600000; };
    drag = { kind: 'create', pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, lx: ev.clientX, ly: ev.clientY, on: false, touch: false, armed: true, key: key, at: at, a: Math.floor(at(ev.clientY) / step) * step, el: null, ns: null, ne: null, timer: 0, raf: 0 };
    listen(true);
  }
  function moveCreate(d) {
    var step = SNAP * 60000, cur = d.at(d.ly), s, e;
    if (cur >= d.a) { s = d.a; e = Math.max(d.a + step, Math.ceil(cur / step) * step); } else { s = Math.floor(cur / step) * step; e = d.a + step; }
    var dr = state.draft; if (!dr) return;
    dr.start = s; dr.end = e;
    var el = root.querySelector('.dv-new');
    if (el) {
      var span = el.querySelector('.dv-ev__t'), base = d.base;
      el.style.top = (base.top + (s - base.s) / 3600000 * PXH) + 'px';
      el.style.height = Math.max(20, (e - s) / 3600000 * PXH - 3) + 'px';
      if (span) span.textContent = hm(s) + ' to ' + hm(e);
    }
    d.ns = s; d.ne = e;
    tip(hm(s) + ' to ' + hm(e), d.lx, d.ly);
  }
  function endCreate(d, commit) {
    if (!d.on) return;
    noClickUntil = Date.now() + 400;
    var dr = state.draft;
    if (!dr) return;
    if (!commit) { state.draft = null; draw(); return; }
    if (dr.start < Date.now() - 4 * 60000) { state.draft = null; draw(); toast('That time has passed. Pick a later time.'); return; }
    dr.editing = true; draw();
    var inp = root.querySelector('.dv-new__in'); if (inp) inp.focus({ preventScroll: true });
  }
  function cancelDraft() { if (!state.draft || state.draft.busy) return; state.draft = null; draw(); }
  function submitDraft() {
    var dr = state.draft; if (!dr || dr.busy) return;
    var inp = root.querySelector('.dv-new__in'), title = (inp && inp.value || '').replace(/\s+/g, ' ').trim();
    if (!title) return cancelDraft();
    dr.busy = true; dr.title = title; draw();
    var inp2 = root.querySelector('.dv-new__in'); if (inp2) inp2.value = title;
    // A new meeting is a FavorOS room with a Google Calendar event. The event has no Meet link and no guests; recording is off until the host changes it.
    api('meetings', { method: 'POST', body: { title: title, startsAt: new Date(dr.start).toISOString(), durationMin: Math.round((dr.end - dr.start) / 60000), rec: 'off', invitees: [] } }).then(function (r) {
      if (stopped) return;
      state.draft = null;
      if (r.meeting && state.data) { state.data.up = (state.data.up || []).filter(function (m) { return m.id !== r.meeting.id; }).concat([r.meeting]); saveHub(); }
      state.rev++; draw(); toast('Meeting added');
    }).catch(function (x) { if (stopped) return; state.draft = null; draw(); toast(shortMsg(x && x.message)); });
  }
  root.addEventListener('keydown', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('dv-new__in')) return;
    if (ev.key === 'Enter') { ev.preventDefault(); submitDraft(); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelDraft(); }
  });
  root.addEventListener('focusout', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('dv-new__in') || !state.draft || state.draft.busy) return;
    if (ev.target.value.trim()) submitDraft(); else cancelDraft();
  });
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('dragstart', function (ev) { ev.preventDefault(); });

  // ---- the panel's own fields: title, date, times, agenda. They save when the field loses focus or on Enter.
  function syncFields(e) {
    if (!e || !e.edit) return;
    var set = function (n, v) { var el = layer.querySelector('[data-f="' + n + '"]'); if (el && el !== document.activeElement && el.value !== v) el.value = v; };
    set('title', e.title); set('date', dayKey(e.start)); set('start', hhmm(e.start)); set('end', hhmm(e.end)); set('desc', e.desc || '');
  }
  function saveField(f) {
    var e = state.open ? findEv(state.open) : null; if (!e || !e.edit) return;
    var q = function (n) { return layer.querySelector('[data-f="' + n + '"]'); }, el = q(f); if (!el) return;
    if (f === 'title') {
      var v = el.value.replace(/\s+/g, ' ').trim();
      if (!v) { el.value = e.title; return; }
      if (v !== e.title) applyEdit(e, { title: v });
      return;
    }
    if (f === 'desc') { var dv = el.value.trim(); if (dv !== String(e.desc || '').trim()) applyEdit(e, { desc: dv }); return; }
    var dur = e.end - e.start, ns = e.start, ne = e.end, day = dayKey(e.start);
    if (!el.value) { syncFields(e); return; }
    if (f === 'date') { ns = atDay(el.value, minOfDay(e.start)); ne = ns + dur; }
    else if (f === 'start') { ns = atDay(day, toMin(el.value)); ne = ns + dur; }
    else if (f === 'end') { ne = atDay(day, toMin(el.value)); if (ne <= ns) { toast('The end must be after the start.'); el.value = hhmm(e.end); return; } }
    if (ns === e.start && ne === e.end) return;
    applyEdit(e, { start: ns, end: ne });
  }
  layer.addEventListener('focusout', function (ev) { var f = ev.target && ev.target.dataset && ev.target.dataset.f; if (f && f !== 'date') saveField(f); });
  layer.addEventListener('change', function (ev) { var f = ev.target && ev.target.dataset && ev.target.dataset.f; if (f === 'date') saveField(f); });
  layer.addEventListener('keydown', function (ev) {
    var t = ev.target; if (!t || !t.dataset || !t.dataset.f) return;
    if (ev.key === 'Enter' && (t.tagName === 'INPUT' || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); t.blur(); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); var e = findEv(state.open); t.blur(); if (e) { var keep = e; t.value = ({ title: keep.title, date: dayKey(keep.start), start: hhmm(keep.start), end: hhmm(keep.end), desc: keep.desc || '' })[t.dataset.f]; } }
  });

  function titleOf(id) {
    var all = state.data ? (state.data.up || []).concat(state.data.recent || []) : [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].title;
    return '';
  }
  function onClick(ev) {
    var t = ev.target.closest('button, a'); if (!t || !root.contains(t)) return;
    var href = t.tagName === 'A' ? t.getAttribute('href') || '' : '';
    var jm = /^\/meet\/room\/\?m=([0-9a-f]{24})$/.exec(href);
    if (jm && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); return prejoin(jm[1], titleOf(jm[1])); }
    if (t.dataset.view) return setView(t.dataset.view);
    if (t.dataset.day) return setDay(t.dataset.day);
    if (t.dataset.goday) { state.view = 'day'; try { localStorage.setItem(VIEW_KEY, 'day'); } catch (e) { /* private mode */ } return setDay(t.dataset.goday); }
    if (t.dataset.pick) { state.pick = t.dataset.pick; return draw(); }
    if (t.dataset.step) { state.pick = ''; return setDay(MV.step(state.view, state.day, +t.dataset.step)); }
    if (t.dataset.today) { state.winStart = dayKey(new Date()); return setDay(state.winStart); }
    if (t.dataset.ev) return openEv(t.dataset.ev);
  }
  root.addEventListener('click', onClick);

  function nowTitle() {
    // "Meeting, Oct 11, 3:40 PM" in Eastern time. The host's name already shows in the room.
    var d = new Date();
    var day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
    var tm = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    return ('Meeting, ' + day + ', ' + tm).replace(/[  ]/g, ' ');
  }

  // Start now opens the same pre-join sheet; the room is made when the person presses Start.
  function startNow() {
    var create = function () { return api('meetings', { method: 'POST', body: { title: nowTitle(), rec: 'notes', access: 'staff' } }).then(function (r) { return { id: r.meeting.id, url: '/meet/room/?m=' + r.meeting.id }; }); };
    if (!window.FavorPrejoin) { create().then(function (r) { location.href = r.url; }).catch(function (err) { toast(err.message); }); return; }
    window.FavorPrejoin.open({
      title: 'New meeting',
      icon: 'video',
      me: { email: '', name: '' },
      load: function () { return Promise.resolve({ live: false, people: [] }); },
      emptyLine: 'Open to all staff, notes on',
      joinLabel: function () { return 'Start'; },
      join: create
    });
  }
  nowBtn = document.getElementById('mt-now');
  if (nowBtn) nowBtn.addEventListener('click', startNow);

  // The now line and the lists refresh on their own.
  timers.push(setInterval(function () { if (!stopped && state.data && !document.hidden && !state.draft && !(drag && drag.on)) { state.now = new Date(); draw(); } }, 30000));
  timers.push(setInterval(function () { if (!stopped && !document.hidden) load(true); }, 60000));
  // While a Favor room shows as live (or open), who is in it is re-read every 10 seconds, so a room everyone left stops reading
  // Live within about 30 seconds.
  function refreshLive() {
    return api('meetings?scope=upcoming').then(function (r) {
      if (stopped || !state.data) return;
      var before = JSON.stringify((state.data.up || []).map(function (m) { return [m.id, m.status, m.inRoom]; }));
      var after = JSON.stringify((r.meetings || []).map(function (m) { return [m.id, m.status, m.inRoom]; }));
      state.data.up = r.meetings || [];
      if (before !== after) { state.rev++; state.now = new Date(); draw(); }
    }).catch(function () {});
  }
  timers.push(setInterval(function () {
    if (stopped || document.hidden || !state.data) return;
    if ((state.data.up || []).some(function (m) { return m.status === 'live'; })) refreshLive();
  }, 10000));
  document.addEventListener('visibilitychange', function () { if (!stopped && !document.hidden && state.data) refreshLive(); });

  window.__mtDay = { root: root, stop: function () {
    stopped = true; timers.forEach(clearInterval); clearTimeout(tt);
    root.removeEventListener('click', onClick); root.removeEventListener('pointerdown', onDown); listen(false); dropTip();
    document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); window.__hubPopOwn = null;
    if (layer.parentNode) layer.parentNode.removeChild(layer); document.documentElement.classList.remove('mp-lock');
    if (nowBtn) nowBtn.removeEventListener('click', startNow);
  } };
  // A page drawn from the 20 second cache checks who is in each room right away.
  var m0 = new URLSearchParams(location.search).get('m');
  if (m0) { state.open = fromUrlId(m0); focusOnce = true; }
  hydrate();
  if (state.data) { draw(); root.removeAttribute('aria-busy'); }
  load().then(function () {
    if (state.data && state.open) { var e0 = findEv(state.open); if (e0) { state.day = dayKey(e0.start); draw(); wantInfo(state.open); } else ensureLoaded(state.open); }
    if (state.data && Date.now() - (state.data.at || 0) > 3000) refreshLive();
  });
})();
