/* Chat's smarter side on the page and in the floating dock. Thin on purpose: every rule (which language, what is translated, what a
   summary says, who may log in Blackbaud) lives in /api/chat (functions/_lib/chat/smart.ts); this file asks and draws.
     translation     the reader's language, messages shown translated with the original a tap away (state in chat-ui.js: S.lang, S.tr)
     Catch me up     a strip above the messages when a channel has five or more unread, and the sparkle button in the channel header
     turn into       task, request, reminder or Blackbaud action from any message (the action is saved only after a review step)
     chips           partners and funds in a message are drawn and opened by the shared entity layer (favor-entity.js)
     voice notes     record, attach, send; the transcript arrives on the message
   FavorChatSmart.attach(app) is called by chat.js after mount. */
(function () {
  'use strict';
  if (window.FavorChatSmart) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var app = null, S = null, root = null;
  var ET = 'America/New_York';

  function req(method, path, body) {
    var h = { 'X-Hub-Request': '1' };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(path, { method: method, credentials: 'same-origin', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = r.status; throw e; } return d; }); });
  }
  var chat = function (m, p, b) { return req(m, '/api/chat/' + p, b); };
  var toast = function (t, link) { if (app) app.toast(t, link); else window.dispatchEvent(new CustomEvent('favor-toast', { detail: t })); };
  var fail = function (e) { toast((e && e.message) || 'That did not work. Try again.'); };

  /* ------------------------------------------------------------------ partner and fund names for the composer's @ list */
  var entCache = {}, entTimer = 0, entDenied = false;
  function find(q, done) {
    q = String(q || '').toLowerCase().trim();
    if (entDenied || q.length < 3 || entCache[q]) return;
    entCache[q] = { items: [], wait: true };
    clearTimeout(entTimer);
    entTimer = setTimeout(function () {
      chat('GET', 'entities?q=' + encodeURIComponent(q)).then(function (d) {
        entCache[q] = { items: d.items || [] };
        if (!(d.items || []).length && Object.keys(entCache).length === 1) { /* a person without the Work Center gets an empty list; keep asking, it is cheap */ }
        done && done();
      }).catch(function () { entCache[q] = { items: [] }; });
    }, 220);
  }
  function hits(q) {
    q = String(q || '').toLowerCase().trim();
    var best = '';
    Object.keys(entCache).forEach(function (k) { if (q.indexOf(k) === 0 && k.length > best.length && !entCache[k].wait) best = k; });
    return best ? (entCache[best].items || []).filter(function (x) { return !q || x.name.toLowerCase().indexOf(q.split(' ')[0]) >= 0; }).map(function (x) { return { ent: true, kind: x.kind, id: x.id, name: x.name, sub: x.sub }; }) : [];
  }

  /* ------------------------------------------------------------------ translation */
  var asked = {}, trT = 0;
  function wantTr() {
    clearTimeout(trT);
    trT = setTimeout(function () {
      if (!S || !S.lang) return;
      var ids = [];
      root.querySelectorAll('.ch-msg[data-mid]').forEach(function (el) {
        var id = el.getAttribute('data-mid'), m = app.find(id);
        if (!m || m.deleted || m.user_id === S.me.id || m.user_id === 'brain' || m.user_id === 'meetings') return;
        var voice = (m.attachments || []).filter(function (a) { return a.voice && a.transcript_status === 'ready' && a.transcript; }).length;
        if (!m.body && !voice) return;
        var key = S.lang + '|' + id + '|' + m.body + '|' + voice;
        if (asked[key] || ids.length >= 24) return;
        asked[key] = 1; ids.push(Number(id));
      });
      if (!ids.length) return;
      chat('POST', 'translate', { ids: ids }).then(function (d) {
        ids.forEach(function (id) {
          var it = d.items && d.items[id]; if (!it) return;
          var m = app.find(id); if (!m) return;
          S.tr[id] = { text: it.text || '', src: it.src || '', body: m.body, voice: it.voice || null };
        });
        app.redraw();
      }).catch(function () { /* the original stays on screen */ });
    }, 250);
  }
  function langMenu(anchor) {
    var rows = '<button type="button" class="ch-pop__i ch-pop__i--line' + (!S.lang ? ' is-on' : '') + '" data-act="sm-setlang" data-lang=""><span>Original, no translation</span></button>' +
      (S.langs || []).map(function (l) { return '<button type="button" class="ch-pop__i ch-pop__i--line' + (S.lang === l.code ? ' is-on' : '') + '" data-act="sm-setlang" data-lang="' + l.code + '"><span>' + esc(l.native) + (l.native !== l.name ? ' <small>' + esc(l.name) + '</small>' : '') + '</span></button>'; }).join('');
    app.pop('<div class="ch-pop__h">I read Chat in</div>' + rows, anchor, 'ch-pop--menu', { below: true });
  }
  function setLang(code) {
    chat('POST', 'prefs', { lang: code }).then(function (d) {
      S.lang = d.lang || ''; S.tr = {}; S.trOrig = {}; asked = {};
      app.closePop(); app.render(); wantTr();
      var l = (S.langs || []).filter(function (x) { return x.code === S.lang; })[0];
      toast(S.lang ? 'Messages in other languages now show in ' + (l ? l.name : S.lang) + '. Tap Show original on any of them.' : 'Messages show as they were written.');
    }).catch(fail);
  }

  /* ------------------------------------------------------------------ Catch me up */
  var cu = {}; // per channel: { st: 'offer' | 'work' | 'done' | 'off', data, from }
  function unreadFrom(c) {
    var lr = Number(S.lastRead[c.id]) || 0, list = S.msgs[c.id] || [];
    var fresh = list.filter(function (m) { return Number(m.id) > lr && m.user_id !== S.me.id && !m.deleted && m.user_id !== 'brain'; });
    return { from: lr, count: lr > 0 ? fresh.length : 0, people: Object.keys(fresh.reduce(function (o, m) { o[m.user_id] = 1; return o; }, {})).length };
  }
  function stripEl() {
    var box = root.querySelector('.ch-msgs'); if (!box) return null;
    var el = root.querySelector('#sm-catch');
    if (!el) { el = document.createElement('div'); el.id = 'sm-catch'; el.className = 'sm-catch'; box.insertBefore(el, box.firstChild); }
    return el;
  }
  function paintCatch() {
    if (!S || S.page !== 'channel' || !S.active) { var o = root.querySelector('#sm-catch'); if (o) o.remove(); return; }
    var c = S.channels[S.active]; if (!c) return;
    var st = cu[c.id] || (cu[c.id] = { st: 'idle' });
    var u = unreadFrom(c);
    if (st.st === 'idle' && u.count >= 5) { st.st = 'offer'; st.from = u.from; st.n = u.count; st.people = u.people; }
    var el = root.querySelector('#sm-catch');
    if (st.st === 'idle' || st.st === 'off') { if (el) el.remove(); return; }
    if (st.st === 'none') { el = stripEl(); if (!el) return; var hn = '<div class="sm-catch__r"><span class="sm-catch__ic">' + icon('spark') + '</span><span>Nothing new since you last read.</span><button type="button" class="ch-iconbtn" data-act="sm-catch-x" aria-label="Dismiss">' + icon('x') + '</button></div>'; if (el._h !== hn) { el._h = hn; el.innerHTML = hn; } return; }
    el = stripEl(); if (!el) return;
    var h;
    if (st.st === 'offer') h = '<div class="sm-catch__r"><span class="sm-catch__ic">' + icon('spark') + '</span><span><b>' + st.n + ' new messages</b> from ' + st.people + (st.people === 1 ? ' person' : ' people') + '</span><button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-act="sm-catch-go">Catch me up</button><button type="button" class="ch-iconbtn" data-act="sm-catch-x" aria-label="Dismiss">' + icon('x') + '</button></div>';
    else if (st.st === 'work') h = '<div class="sm-catch__r"><span class="sm-catch__ic">' + icon('spark') + '</span><span>Reading the new messages</span></div>';
    else {
      var d = st.data;
      var pts = function (list) { return list.map(function (p) { return '<li>' + esc(p.text) + (p.ids && p.ids.length ? ' <button type="button" class="sm-catch__j" data-act="sm-jump" data-id="' + p.ids[0] + '">See it</button>' : '') + '</li>'; }).join(''); };
      h = '<div class="sm-catch__c"><div class="sm-catch__h"><span class="sm-catch__ic">' + icon('spark') + '</span><b>' + esc(d.headline || 'Caught up') + '</b><button type="button" class="ch-iconbtn" data-act="sm-catch-x" aria-label="Close the summary">' + icon('x') + '</button></div>' +
        '<ul>' + pts(d.points) + '</ul>' + (d.for_you.length ? '<div class="sm-catch__f"><b>For you</b><ul>' + pts(d.for_you) + '</ul></div>' : '') +
        '<small>' + d.count + ' messages from ' + d.people + (d.people === 1 ? ' person' : ' people') + '</small></div>';
    }
    if (el._h !== h) { el._h = h; el.innerHTML = h; }
  }
  function icon(n) { return app && app.icon ? app.icon(n) : ''; }
  function catchGo(manual) {
    var c = S.channels[S.active]; if (!c) return;
    var st = cu[c.id] || (cu[c.id] = { st: 'idle' });
    var u = unreadFrom(c), from = st.from != null && st.st !== 'idle' ? st.from : u.from;
    if (manual && !(S.msgs[c.id] || []).some(function (m) { return m.user_id !== S.me.id && !m.deleted && m.user_id !== 'brain'; })) { st.st = 'none'; paintCatch(); return; }
    if (manual && !(u.count >= 3)) {
      // Nothing unread: summarize the last thirty messages from others.
      var list = (S.msgs[c.id] || []).filter(function (m) { return m.user_id !== S.me.id && !m.deleted && m.user_id !== 'brain'; }).slice(-30);
      from = list.length ? Number(list[0].id) - 1 : 0;
    }
    st.st = 'work'; paintCatch();
    chat('POST', 'channels/' + encodeURIComponent(c.id) + '/catchup', { from: from }).then(function (d) {
      if (d.empty) { st.st = 'none'; paintCatch(); return; }
      st.st = 'done'; st.data = d; paintCatch();
    }).catch(function (e) { st.st = manual ? 'off' : 'offer'; paintCatch(); fail(e); });
  }

  /* ------------------------------------------------------------------ turn a message into something */
  function plainOf(m) { return String(m.body || '').replace(/<~[pf]:\d+\|([^>]+)>/g, '$1').replace(/<@([^>]+)>/g, function (_, id) { return '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' ? 'channel' : app.user(id).name); }).replace(/\*\*|~~/g, '').replace(/\s+/g, ' ').trim(); }
  function turnMenu(id) {
    var m = app.find(id); if (!m) return;
    var first = (plainOf(m).split(/(?<=[.!?])\s/)[0] || plainOf(m)).slice(0, 140);
    var row = function (act, ic, t, s) { return '<button type="button" class="sm-turn__i" data-act="' + act + '" data-id="' + id + '">' + icon(ic) + '<span><b>' + t + '</b><small>' + s + '</small></span></button>'; };
    var el = app.modal('Turn this message into', '<div class="ch-quote"><b>' + esc(app.user(m.user_id).name) + '</b><span>' + esc(plainOf(m).slice(0, 220) || 'A message with an attachment') + '</span></div><div class="sm-turn">' +
      (window.PJLinks ? row('sm-t-task', 'task', 'A task', 'Goes on your Projects list, with a link back here') : '') +
      row('sm-t-request', 'task', 'A request', 'A card on the request board') +
      row('sm-t-remind', 'bell', 'A reminder', 'Shows in the bell when it is due') +
      row('sm-t-bb', 'file', 'A Blackbaud action', 'Logged on a partner record after you review it') + '</div>', '');
    el._first = first;
  }
  function remindDialog(id) {
    var m = app.find(id); if (!m) return;
    var opts = [['hour', 'In an hour'], ['afternoon', 'This afternoon'], ['tomorrow', 'Tomorrow morning'], ['nextweek', 'Next Monday']];
    var el = app.modal('Remind me about this message', '<div class="ch-quote"><b>' + esc(app.user(m.user_id).name) + '</b><span>' + esc(plainOf(m).slice(0, 200)) + '</span></div><div class="sm-turn">' +
      opts.map(function (o) { return '<button type="button" class="sm-turn__i sm-turn__i--s" data-act="sm-rem-set" data-code="' + o[0] + '" data-id="' + id + '"><span><b>' + o[1] + '</b></span></button>'; }).join('') + '</div>' +
      '<div class="sm-when"><label class="ch-field"><span>Or pick a day and time</span><span class="sm-when__r"><input class="ch-input" type="date" data-rd /><input class="ch-input" type="time" value="09:00" data-rt /></span></label><button type="button" class="ch-btn ch-btn--primary" data-act="sm-rem-date" data-id="' + id + '">Remind me then</button></div>', '');
    return el;
  }
  function etDay(d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: ET }); }
  function remindSet(id, when) {
    chat('POST', 'messages/' + id + '/remind', { when: when }).then(function (d) {
      app.closeModal();
      toast('Reminder set for ' + new Date(d.due_at).toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET.');
      window.dispatchEvent(new CustomEvent('favor-reminders:changed'));
    }).catch(fail);
  }
  var HOW = [['call', 'Phone call'], ['email', 'Email'], ['meet', 'Meeting'], ['text', 'Text'], ['vm', 'Voicemail'], ['mail', 'Mail']];
  function bbDialog(id) {
    var m = app.find(id); if (!m) return;
    var chip = String(m.body || '').match(/<~p:(\d{1,12})\|([^>]+)>/);
    var pick = chip ? { cid: chip[1], name: chip[2] } : null;
    var summary = plainOf(m).slice(0, 255);
    var el = app.modal('Log in Blackbaud', '<div data-bb-body><p class="sm-note">Loading.</p></div>', '');
    var st = { owners: [], mine: '', how: 'call', date: etDay(Date.now()), owner: '', summary: summary };
    function form(msg) {
      var body = el.querySelector('[data-bb-body]');
      body.innerHTML = (msg ? '<p class="sm-err">' + esc(msg) + '</p>' : '<p class="sm-note">Pick the partner and the contact. Nothing is saved until you review it on the next step.</p>') +
        '<div class="ch-field"><span>Partner</span><div data-bb-partner>' + (pick ? '<span class="sm-pick"><b>' + esc(pick.name) + '</b><button type="button" data-act="sm-bb-clear">Change</button></span>' : '<input class="ch-input" data-bb-q placeholder="Search by name, email or phone" autocomplete="off" /><div class="sm-res" data-bb-res></div>') + '</div></div>' +
        '<label class="ch-field"><span>Whose contact</span><select class="ch-input" data-bb-owner>' + st.owners.map(function (o) { return '<option value="' + esc(o.fid) + '"' + (o.fid === (st.owner || st.mine) ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></label>' +
        '<div class="sm-two"><label class="ch-field"><span>How</span><select class="ch-input" data-bb-how>' + HOW.map(function (h) { return '<option value="' + h[0] + '"' + (st.how === h[0] ? ' selected' : '') + '>' + h[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="ch-field"><span>Date</span><input class="ch-input" type="date" data-bb-date value="' + esc(st.date) + '" /></label></div>' +
        '<label class="ch-field"><span>What happened</span><input class="ch-input" data-bb-sum maxlength="255" value="' + esc(st.summary) + '" /></label>' +
        '<div class="ch-dlg__f sm-foot"><button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="sm-bb-review">Review</button></div>';
    }
    function read() {
      var q = function (s) { return el.querySelector(s); };
      st.owner = q('[data-bb-owner]').value; st.how = q('[data-bb-how]').value; st.date = q('[data-bb-date]').value; st.summary = q('[data-bb-sum]').value.trim();
    }
    function review() {
      read();
      if (!pick) return form('Pick the partner first.');
      if (!st.summary) return form('Say what happened in one line.');
      var owner = st.owners.filter(function (o) { return o.fid === st.owner; })[0], how = HOW.filter(function (h) { return h[0] === st.how; })[0];
      var body = el.querySelector('[data-bb-body]');
      body.innerHTML = '<div class="sm-review"><p><b>This adds a completed ' + esc(how[1].toLowerCase()) + ' to ' + esc(pick.name) + "'s record in Blackbaud.</b></p>" +
        '<dl><div><dt>Partner</dt><dd>' + esc(pick.name) + '</dd></div><div><dt>Whose contact</dt><dd>' + esc(owner ? owner.name : '') + '</dd></div><div><dt>Date</dt><dd>' + esc(new Date(st.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })) + '</dd></div><div><dt>Summary</dt><dd>' + esc(st.summary) + '</dd></div></dl>' +
        '<p class="sm-note">It saves when you press the button. You can undo it from the Work Center afterward.</p></div>' +
        '<div class="ch-dlg__f sm-foot"><button type="button" class="ch-btn" data-act="sm-bb-back">Back</button><button type="button" class="ch-btn ch-btn--primary" data-act="sm-bb-save">Save to Blackbaud</button></div>';
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); var act = b && b.getAttribute('data-act');
      var r = e.target.closest('[data-bb-pick]');
      if (r) { pick = { cid: r.getAttribute('data-bb-pick'), name: r.getAttribute('data-name') }; read(); form(); return; }
      if (act === 'sm-bb-clear') { pick = null; read(); form(); }
      else if (act === 'sm-bb-review') review();
      else if (act === 'sm-bb-back') form();
      else if (act === 'sm-bb-save') {
        b.disabled = true; b.textContent = 'Saving';
        req('POST', '/api/work/entry/many', { owner: st.owner, date: st.date, channel: st.how, summary: st.summary, tags: [], constituent_ids: [pick.cid], req: 'chat-' + id + '-' + pick.cid + '-' + st.date }).then(function (d) {
          app.closeModal();
          toast(d.dups && !d.created ? 'That contact is already on the record.' : 'Saved to ' + pick.name + "'s record in Blackbaud.");
        }).catch(function (er) { b.disabled = false; b.textContent = 'Save to Blackbaud'; toast(er.message); });
      }
    });
    var searchT = 0;
    el.addEventListener('input', function (e) {
      var q = e.target.closest('[data-bb-q]'); if (!q) return;
      clearTimeout(searchT);
      var term = q.value.trim(), host = el.querySelector('[data-bb-res]');
      if (term.length < 2) { host.innerHTML = ''; return; }
      searchT = setTimeout(function () {
        req('GET', '/api/work/partners?q=' + encodeURIComponent(term)).then(function (d) {
          host.innerHTML = (d.rows || []).filter(function (x) { return !x.deceased; }).slice(0, 6).map(function (x) { return '<button type="button" class="sm-res__i" data-bb-pick="' + esc(x.cid) + '" data-name="' + esc(x.name) + '"><b>' + esc(x.name) + '</b><small>' + esc(x.place || '') + '</small></button>'; }).join('') || '<p class="sm-note">No partner found.</p>';
        }).catch(function () { host.innerHTML = '<p class="sm-note">Search is not available right now.</p>'; });
      }, 250);
    });
    chat('GET', 'owners').then(function (d) {
      st.owners = d.owners || []; st.mine = d.mine || (st.owners[0] && st.owners[0].fid) || '';
      if (!st.owners.length) { el.querySelector('[data-bb-body]').innerHTML = '<p class="sm-note">Logging in Blackbaud is for people who use the Work Center. Ask the technology team if you should have it.</p><div class="ch-dlg__f sm-foot"><button type="button" class="ch-btn" data-act="modal-x">Close</button></div>'; return; }
      form();
    }).catch(function (e) { el.querySelector('[data-bb-body]').innerHTML = '<p class="sm-err">' + esc(e.message) + '</p>'; });
  }

  /* ------------------------------------------------------------------ voice notes */
  var rec = null;
  function fmtSecs(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
  function upload(file) {
    return fetch('/api/chat/upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || d.ok === false) throw new Error(d.message || 'The upload did not work.'); return d; }); });
  }
  function micToggle(scope) {
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record a voice note.'); return; }
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0] || '';
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }), chunks = [], t0 = Date.now(), cancelled = false;
      var box = root.querySelector('.ch-comp[data-scope="' + scope + '"] .ch-comp__box') || root.querySelector('.ch-comp__box');
      var bar = document.createElement('div'); bar.className = 'sm-rec';
      bar.innerHTML = '<i class="sm-rec__dot"></i><b data-t>0:00</b><span>Recording a voice note</span><button type="button" class="ch-btn ch-btn--sm" data-act="sm-rec-x">Cancel</button><button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-act="sm-rec-go">Stop and attach</button>';
      box.insertBefore(bar, box.firstChild);
      var tick = setInterval(function () { var sec = (Date.now() - t0) / 1000; bar.querySelector('[data-t]').textContent = fmtSecs(sec); if (sec >= 300) mr.stop(); }, 250);
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        clearInterval(tick); bar.remove(); stream.getTracks().forEach(function (t) { t.stop(); }); rec = null;
        var secs = Math.round((Date.now() - t0) / 1000);
        if (cancelled || secs < 1 || !chunks.length) return;
        var mime = (mr.mimeType || type || 'audio/webm').split(';')[0];
        var file = new File(chunks, 'voice-note.' + (mime.indexOf('mp4') >= 0 ? 'm4a' : 'webm'), { type: mime });
        if (file.size > 5.5 * 1024 * 1024) { toast('That voice note is too long. Keep it under five minutes.'); return; }
        var item = { type: 'file', name: 'Voice note ' + fmtSecs(secs), size: file.size, mime: mime, uploading: true, voice: true, secs: secs };
        app.pend(scope, item);
        upload(file).then(function (r) { item.id = r.id; item.url = r.url; item.uploading = false; app.pend(scope); }).catch(function (e) { item.failed = true; item.uploading = false; fail(e); app.dropPend(scope, item); });
      };
      rec = { stop: function () { if (mr.state !== 'inactive') mr.stop(); }, cancel: function () { cancelled = true; rec.stop(); } };
      mr.start(1000);
    }).catch(function () { toast('Allow the microphone to record a voice note.'); });
  }

  /* ------------------------------------------------------------------ clicks */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act^="sm-"]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')) || 0;
    if (/^sm-(bb-|rec)/.test(act) && act !== 'sm-rec-go' && act !== 'sm-rec-x') return; // the Blackbaud dialog handles its own buttons
    e.preventDefault(); e.stopPropagation();
    if (act === 'sm-orig') { S.trOrig[id] = !S.trOrig[id]; app.closePop(); var x = root.querySelector('[data-act="modal-x"]'); if (x && b.classList.contains('ch-msheet__row')) x.click(); app.redraw(); }
    else if (act === 'sm-lang') langMenu(b);
    else if (act === 'sm-setlang') setLang(b.getAttribute('data-lang'));
    else if (act === 'sm-catch') catchGo(true);
    else if (act === 'sm-catch-go') catchGo(false);
    else if (act === 'sm-catch-x') { var c = S.channels[S.active]; if (c) { cu[c.id].st = 'off'; paintCatch(); } }
    else if (act === 'sm-jump') { var f = app.focus; if (f) f(id); }
    else if (act === 'sm-turn') { app.closePop(); var xx = root.querySelector('.ch-scrim [data-act="modal-x"]'); if (xx) xx.click(); turnMenu(id); }
    else if (act === 'sm-t-task') { app.closeModal(); var mm = app.find(id); window.PJLinks.makeTask({ messageId: id, title: (plainOf(mm).split(/(?<=[.!?])\s/)[0] || '').slice(0, 140) }); }
    else if (act === 'sm-t-request') { app.closeModal(); app.request({ from: id }); }
    else if (act === 'sm-t-remind') remindDialog(id);
    else if (act === 'sm-t-bb') bbDialog(id);
    else if (act === 'sm-rem-set') remindSet(id, { code: b.getAttribute('data-code') });
    else if (act === 'sm-rem-date') { var md = b.closest('.ch-dlg'); var dv = md.querySelector('[data-rd]').value; if (!dv) { toast('Pick a day first.'); return; } remindSet(id, { date: dv, time: md.querySelector('[data-rt]').value || '09:00' }); }
    else if (act === 'sm-ask') { app.closePop(); var xy = root.querySelector('.ch-scrim [data-act="modal-x"]'); if (xy) xy.click(); app.thread(id); setTimeout(function () { app.askBrainIn('thread'); }, 450); }
    else if (act === 'sm-mic') micToggle(b.getAttribute('data-scope') || 'main');
    else if (act === 'sm-rec-x') rec && rec.cancel();
    else if (act === 'sm-rec-go') rec && rec.stop();
  }

  function attach(a) {
    app = a; S = a.state; root = document.getElementById('chat-root');
    if (!root) return;
    // The icons come from chat-ui's own set through a throwaway control so this file never keeps a copy.
    app.icon = app.icon || function (n) { return window.FavorChat && window.FavorChat.util ? window.FavorChat.util.ic(n) : ''; };
    root.addEventListener('click', onClick, true);
    var t = 0;
    new MutationObserver(function () { cancelAnimationFrame(t); t = requestAnimationFrame(function () { wantTr(); paintCatch(); }); }).observe(root, { childList: true, subtree: true });
    wantTr(); paintCatch();
    window.FavorChatSmart.app = a;
  }

  window.FavorChatSmart = { attach: attach, hits: hits, find: find, app: null, _t: { fmtSecs: fmtSecs, etDay: etDay } };
})();
