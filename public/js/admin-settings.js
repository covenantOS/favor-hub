/* Settings tabs. A container with data-ad-area="work|meetings|brain|clips" is filled from /api/admin/settings. Each setting saves on
   its own and asks to confirm when it changes what the hub sends to Blackbaud. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc;
  var root = document.querySelector('[data-ad-area]');
  if (!root) return;
  var area = root.dataset.adArea;
  var S = [];

  function control(s) {
    var id = 'f-' + s.id.replace(/\W/g, '-');
    if (s.kind === 'enum') return '<select class="ad-field" id="' + id + '" data-id="' + E(s.id) + '">' + s.options.map(function (o) { return '<option value="' + E(o.value) + '"' + (o.value === s.value ? ' selected' : '') + '>' + E(o.label) + '</option>'; }).join('') + '</select>';
    if (s.kind === 'int') return '<span style="display:flex;gap:8px;align-items:center"><input class="ad-field ad-field--num" id="' + id + '" data-id="' + E(s.id) + '" type="number" inputmode="numeric" min="' + s.min + '" max="' + s.max + '" value="' + E(s.value) + '"><span class="ad-set__who">' + E(s.unit) + '</span></span>';
    if (s.kind === 'date') return '<input class="ad-field" id="' + id + '" data-id="' + E(s.id) + '" type="date" value="' + E(s.value) + '">';
    return '<input class="ad-field" id="' + id + '" data-id="' + E(s.id) + '" type="text" value="' + E(s.value) + '"' + (s.id === 'clips.list' ? ' placeholder="name@favorintl.org, name@favorintl.org"' : '') + '>';
  }

  function row(s) {
    var id = 'f-' + s.id.replace(/\W/g, '-');
    var who = s.saved && s.by ? 'Saved by ' + s.by + ', ' + A.full(s.at) : s.saved ? 'Saved ' + (s.at ? A.full(s.at) : '') : 'Not changed yet';
    return '<div class="ad-set" data-row="' + E(s.id) + '"><div><label class="ad-set__name" for="' + id + '">' + E(s.label) + (s.bb ? '<span class="ad-bbtag">Blackbaud</span>' : '') + '</label>' +
      (s.hint ? '<div class="ad-set__hint">' + E(s.hint) + '</div>' : '') + '<div class="ad-set__where">' + E(s.where) + '. ' + E(who) + '.</div></div>' +
      '<div>' + control(s) + '</div><div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" data-save="' + E(s.id) + '" disabled>Save</button>' +
      (s.canReset ? '<button type="button" class="ad-btn" data-reset="' + E(s.id) + '">Use ' + (s.id.indexOf('meet.') === 0 || s.id === 'receipts.report' ? 'the Pages value' : 'the default') + '</button>' : '') + '</div>' +
      '<p class="ad-msg" data-msg="' + E(s.id) + '" role="status"></p></div>';
  }

  function groups() {
    var order = [], by = {};
    S.forEach(function (s) { var g = s.group || ''; if (!by[g]) { by[g] = []; order.push(g); } by[g].push(s); });
    return order.map(function (g) { return '<section class="ad-card ad-group">' + (g ? '<h3>' + E(g) + '</h3>' : '') + by[g].map(row).join('') + '</section>'; }).join('');
  }

  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function table(head, rows) {
    return '<div class="ad-scroll"><table class="ad-table"><thead><tr>' + head.map(function (h) { return '<th>' + E(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + head.length + '" class="mute">Nothing yet.</td></tr>') + '</tbody></table></div>';
  }

  function extras(x) {
    if (area === 'work') {
      var cal = x.calls || {};
      return '<section class="ad-card"><h2>Blackbaud calls today</h2><div class="ad-meter" role="img" aria-label="' + cal.used + ' of ' + cal.cap + '"><i style="width:' + Math.min(100, (cal.used / (cal.cap || 1)) * 100) + '%"></i></div>' +
        '<div class="ad-meter__note"><span>' + num(cal.used) + ' of ' + num(cal.cap) + ' upkeep calls</span><span>Work Center lane ' + num(cal.lane) + '</span></div></section>' +
        '<div class="ad-cols"><section class="ad-card"><h2>Cadence rules</h2><p class="ad-card__meta">Read only. These come from the Partner Care manual.</p>' +
        table(['Rule', 'What it asks'], (x.rules || []).map(function (r) { return '<tr><td><b>' + E(r.rule) + '</b></td><td>' + E(r.text) + '</td></tr>'; })) + '</section>' +
        '<section class="ad-card"><h2>Action tags</h2><p class="ad-card__meta">Read only. Blackbaud holds the list' + (x.tagsAt ? ', read ' + E(A.full(x.tagsAt)) : '') + '.</p>' +
        table(['Tag', 'Type', 'Values'], (x.tags || []).map(function (t) { return '<tr><td><b>' + E(t.name) + '</b></td><td>' + E(t.type) + '</td><td class="mute">' + E((t.values || []).join(', ')) + '</td></tr>'; })) + '</section></div>';
    }
    if (area === 'brain') {
      var iw = x.iwave;
      return '<div class="ad-cols"><section class="ad-card"><h2>Access requests</h2><p class="ad-card__meta">' + (x.pending.length ? x.pending.length + ' waiting for a decision.' : 'None waiting.') + '</p>' +
        (x.pending.length ? '<ul class="ad-list">' + x.pending.map(function (r) { return '<li>' + E(r.name || r.email) + ', ' + E(r.package || '') + '</li>'; }).join('') + '</ul>' : '') +
        '<div><a class="ad-btn ad-btn--primary" style="display:inline-block;text-decoration:none" href="/brain/admin/">Decide requests</a></div></section>' +
        '<section class="ad-card"><h2>iWave caps</h2><p class="ad-card__meta">Read only. The sync worker holds these.</p>' +
        (iw ? table(['Cap', 'Value'], iw.map(function (r) { return '<tr><td>' + E(r.label) + '</td><td>' + E(r.value) + '</td></tr>'; })) : '<p class="ad-empty">The sync worker did not answer.</p>') + '</section></div>' +
        '<section class="ad-card"><h2>Question log</h2><p class="ad-card__meta">The last 100 questions people asked.</p>' +
        table(['When', 'Who', 'Question'], (x.questions || []).map(function (q) { return '<tr><td>' + E(A.full(q.at)) + '</td><td>' + E(q.email) + '</td><td>' + E(q.question) + '</td></tr>'; })) + '</section>';
    }
    if (area === 'clips') {
      var cap = Number((S.filter(function (s) { return s.id === 'clips.cap_gb'; })[0] || {}).value || 10) * 1024 * 1024 * 1024;
      return '<section class="ad-card"><h2>Storage by person</h2>' + table(['Person', 'Clips', 'Used', 'Of the cap'], (x.usage || []).map(function (u) {
        var pct = Math.round((u.bytes / cap) * 100);
        return '<tr><td>' + E(u.name) + '<br><span class="mute">' + E(u.email) + '</span></td><td class="num">' + num(u.clips) + '</td><td class="num">' + (u.bytes / 1073741824).toFixed(2) + ' GB</td><td class="num">' + pct + '%</td></tr>';
      })) + '</section>';
    }
    if (area === 'expenses') return '<section class="ad-card" id="ex-subs"></section>';
    return '';
  }

  var subs = [];
  function drawSubs() {
    var box = document.getElementById('ex-subs');
    if (!box) return;
    box.innerHTML = '<h2>Substitute approvers</h2>' + table(['Dates', 'Name', 'Email', ''], subs.map(function (o) {
      return '<tr><td>' + E(o.start) + ' to ' + E(o.end) + '</td><td>' + E(o.name) + '</td><td class="mute">' + E(o.email) + '</td><td><button type="button" class="ad-btn" data-sub-del="' + E(o.id) + '">Remove</button></td></tr>';
    })) +
      '<form class="ad-sub" id="ex-sub-form" autocomplete="off"><label>From<input class="ad-field" name="start" type="date" required></label><label>To<input class="ad-field" name="end" type="date" required></label>' +
      '<label>Name<input class="ad-field" name="name" required></label><label>Email<input class="ad-field" name="email" type="email" required></label>' +
      '<button class="ad-btn ad-btn--primary" type="submit">Add substitute</button></form><p class="ad-msg" id="ex-sub-msg" role="status"></p>';
  }
  function subPost(body) {
    var m = document.getElementById('ex-sub-msg');
    m.className = 'ad-msg'; m.textContent = 'Saving';
    return A.api('/api/admin/expense-subs', body).then(function (d) { subs = d.subs; drawSubs(); var n = document.getElementById('ex-sub-msg'); n.className = 'ad-msg ad-msg--ok'; n.textContent = 'Saved'; })
      .catch(function (e) { m.className = 'ad-msg ad-msg--bad'; m.textContent = e.message; });
  }
  root.addEventListener('submit', function (e) {
    if (e.target.id !== 'ex-sub-form') return;
    e.preventDefault();
    var f = e.target.elements;
    subPost({ start: f.start.value, end: f.end.value, name: f.name.value, email: f.email.value });
  });
  root.addEventListener('click', function (e) {
    var d = e.target.closest('[data-sub-del]');
    if (d) subPost({ remove: d.dataset.subDel });
  });

  function msg(id, text, bad) {
    var m = root.querySelector('[data-msg="' + id + '"]');
    if (m) { m.textContent = text; m.className = 'ad-msg' + (text ? (bad ? ' ad-msg--bad' : ' ad-msg--ok') : ''); }
  }

  function current(id) { return S.filter(function (s) { return s.id === id; })[0]; }
  function valueOf(id) { var el = root.querySelector('[data-id="' + id + '"]'); return el ? el.value : ''; }

  function send(id, body) {
    msg(id, 'Saving');
    return A.api('/api/admin/settings', Object.assign({ id: id }, body)).then(function (d) {
      var i = S.findIndex(function (s) { return s.id === id; });
      S[i] = d.setting;
      var rowEl = root.querySelector('[data-row="' + id + '"]');
      var t = document.createElement('div');
      t.innerHTML = row(d.setting);
      rowEl.replaceWith(t.firstChild);
      msg(id, 'Saved', false);
      return true;
    }).catch(function (e) { msg(id, e.message, true); return false; });
  }

  function confirmBox(s, next) {
    var rowEl = root.querySelector('[data-row="' + s.id + '"]');
    var old = rowEl.querySelector('.ad-confirm');
    if (old) old.remove();
    var shown = function (v) { var o = s.options.filter(function (x) { return x.value === v; })[0]; return o ? o.label : (v === '' ? 'blank' : v + (s.unit ? ' ' + s.unit : '')); };
    var box = document.createElement('div');
    box.className = 'ad-confirm';
    box.innerHTML = '<p>' + E(s.label) + ' changes what the hub sends to Blackbaud. It is <b>' + E(shown(s.value)) + '</b> now. Change it to <b>' + E(shown(next)) + '</b>?</p><div class="ad-acts" style="justify-content:flex-start"><button type="button" class="ad-btn ad-btn--warn" data-yes>Confirm the change</button><button type="button" class="ad-btn" data-no>Keep ' + E(shown(s.value)) + '</button></div>';
    rowEl.appendChild(box);
    box.querySelector('[data-yes]').onclick = function () { send(s.id, { value: next, confirm: true }); };
    box.querySelector('[data-no]').onclick = function () { box.remove(); };
    box.querySelector('[data-yes]').focus();
  }

  root.addEventListener('input', function (e) {
    var id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    var s = current(id), btn = root.querySelector('[data-save="' + id + '"]');
    btn.disabled = valueOf(id) === s.value;
    msg(id, '');
  });
  root.addEventListener('change', function (e) {
    var id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    var s = current(id), btn = root.querySelector('[data-save="' + id + '"]');
    btn.disabled = valueOf(id) === s.value;
  });
  root.addEventListener('click', function (e) {
    var sv = e.target.closest('[data-save]'), rs = e.target.closest('[data-reset]');
    if (sv) {
      var s = current(sv.dataset.save), next = valueOf(s.id);
      if (s.bb) confirmBox(s, next); else send(s.id, { value: next });
    } else if (rs) {
      send(rs.dataset.reset, { reset: true });
    }
  });

  A.api('/api/admin/settings?area=' + area).then(function (d) {
    S = d.settings;
    subs = (d.extras && d.extras.overrides) || [];
    root.innerHTML = groups() + extras(d.extras || {});
    drawSubs();
    root.removeAttribute('aria-busy');
  }).catch(function (e) { A.fail(document.getElementById('ad-root'), e); });
})();
