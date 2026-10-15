/* Admin > Settings > Gifts: who opens Gift entry and who sends deposits to Blackbaud, the amount that needs a second approver, and
   whether Online gifts writes approved designations to Blackbaud. These switches used to sit on the pages staff work in. */
(function () {
  'use strict';
  var A = window.Admin;
  var root = document.querySelector('[data-ad-gifts]');
  if (!A || !root || root.dataset.on) return;
  root.dataset.on = '1';
  var esc = A.esc;
  function call(method, path, body) {
    return fetch(path, { method: method, credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not save.'); e.status = r.status; throw e; } return d; }); });
  }
  var S = { ge: null, og: null, ot: null, msg: '' };
  function money(c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function draw() {
    var ge = S.ge, og = S.og;
    var people = ge ? ge.people.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + (p.role === 'admin' ? 'Admin' : 'Access given') + '</td>' +
        '<td>' + (p.role === 'admin' ? '<span class="ad-muted">Always</span>' : '<label class="ad-chk"><input type="checkbox" data-pp="access" data-email="' + esc(p.email) + '"' + (p.access ? ' checked' : '') + '> Opens Gift entry</label>') + '</td>' +
        '<td><label class="ad-chk"><input type="checkbox" data-pp="posting" data-email="' + esc(p.email) + '"' + (p.posting ? ' checked' : '') + '> Sends to Blackbaud</label></td></tr>';
    }).join('') : '';
    root.innerHTML =
      '<section class="ad-card"><h2>Gift entry</h2><p class="ad-note">Who opens Gift entry, Online gifts and Receipts, and who may send a deposit to Blackbaud. Sending is never implied by a role.</p>' +
      (ge ? '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Person</th><th>Role</th><th>Gift entry</th><th>Blackbaud</th></tr></thead><tbody>' + (people || '<tr><td colspan="4">No one yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="ad-sub"><select class="ad-field" id="ag-add"><option value="">Add a person</option>' + ge.candidates.map(function (c) { return '<option value="' + esc(c.email) + '">' + esc(c.name) + '</option>'; }).join('') + '</select><button type="button" class="ad-btn" data-add>Give access</button></div>' +
        '<div class="ad-sub"><label class="ad-lbl">Second approval from, in dollars (0 is off) <input class="ad-field" id="ag-sec" inputmode="decimal" value="' + (ge.second ? (ge.second / 100).toFixed(2) : '0') + '"></label><button type="button" class="ad-btn" data-sec>Save</button><span class="ad-muted">' + (ge.second ? 'Now ' + money(ge.second) : 'Now off') + '</span></div>'
        : '<p class="ad-msg ad-msg--bad">Gift entry settings did not load.</p>') + '</section>' +
      '<section class="ad-card"><h2>Online gifts</h2><p class="ad-note">When writes are on, an approved change of designation goes to Blackbaud. Off records the approval in FavorOS only.</p>' +
      (og ? '<div class="ad-sub"><span>Writes to Blackbaud: <b>' + (og.apply ? 'On' : 'Off') + '</b> · ' + esc(og.testLimit ? 'only record ' + og.testLimit : 'every record') + '</span><button type="button" class="ad-btn" data-og>Turn ' + (og.apply ? 'off' : 'on') + '</button></div>'
        : '<p class="ad-msg ad-msg--bad">The Online gifts setting did not load.</p>') + '</section>' +
      '<section class="ad-card"><h2>Other gifts</h2><p class="ad-note">DAF, foundation, wire, stock and phone gifts entered in FavorOS with the soft credit, in a batch a second person approves. Approving posts the gifts to Blackbaud. Off hides the page from staff. Will and the test accounts always see it.</p>' +
      (S.ot ? '<div class="ad-sub"><label class="ad-lbl">Who sees it <select class="ad-field" id="ot-mode">' + [['off', 'Off (staff do not see it)'], ['admins', 'Admins only'], ['on', 'Everyone who opens Gift entry']].map(function (o) { return '<option value="' + o[0] + '"' + (S.ot.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label><button type="button" class="ad-btn" data-ot>Save</button><span class="ad-muted">Now ' + esc(S.ot.mode) + '</span></div>'
        : '<p class="ad-msg ad-msg--bad">The Other gifts setting did not load.</p>') + '</section>' +
      (S.msg ? '<p class="ad-msg" role="status">' + esc(S.msg) + '</p>' : '');
  }
  function load() {
    // Through Admin.api, so the page waits behind its skeleton until both answer (admin.js settle).
    return Promise.all([
      A.api('/api/gift-entry/settings').catch(function (e) { if (e.status === 403) throw e; return null; }),
      A.api('/api/online-gifts/setting', {}).catch(function () { return null; }),
      A.api('/api/other-gifts/settings').catch(function () { return null; }),
    ]).then(function (r) { S.ge = r[0]; S.og = r[1]; S.ot = r[2]; draw(); }).catch(function (e) { A.fail(root, e); });
  }
  root.addEventListener('change', function (e) {
    var t = e.target; if (!t.matches('[data-pp]')) return;
    var body = { email: t.dataset.email }; body[t.dataset.pp] = t.checked;
    call('PUT', '/api/gift-entry/settings', body).then(function () { S.msg = 'Saved.'; return load(); }).catch(function (er) { S.msg = er.message; load(); });
  });
  root.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-add]')) { var v = document.getElementById('ag-add').value; if (!v) return; call('PUT', '/api/gift-entry/settings', { email: v, access: true }).then(function () { S.msg = 'Access given.'; return load(); }).catch(function (er) { S.msg = er.message; draw(); }); }
    else if (t.matches('[data-sec]')) { var d = Number(String(document.getElementById('ag-sec').value || '0').replace(/[$,\s]/g, '')); call('PUT', '/api/gift-entry/settings', { secondDollars: d }).then(function (r) { S.msg = r.second ? 'Second approval from ' + money(r.second) + '.' : 'Second approval is off.'; return load(); }).catch(function (er) { S.msg = er.message; draw(); }); }
    else if (t.matches('[data-ot]')) {
      var mode = document.getElementById('ot-mode').value;
      if (mode !== 'off' && !confirm('Staff will see Other gifts and a second person can approve batches that post gifts to Blackbaud. Michael has to agree to the new entry first. Turn it on?')) return;
      call('PUT', '/api/other-gifts/settings', { mode: mode }).then(function (r) { S.ot = r; S.msg = 'Other gifts is ' + r.mode + '.'; draw(); }).catch(function (er) { S.msg = er.message; draw(); });
    }
    else if (t.matches('[data-og]')) {
      var on = S.og && S.og.apply;
      if (!on && !confirm('Approved changes of designation will go to Blackbaud' + (S.og && S.og.testLimit ? ' for record ' + S.og.testLimit + ' only' : ' for every record') + '. Turn writes on?')) return;
      call('POST', '/api/online-gifts/setting', { apply: on ? 'off' : 'on' }).then(function (r) { S.og = r; S.msg = 'Writes are ' + (r.apply ? 'on' : 'off') + '.'; draw(); }).catch(function (er) { S.msg = er.message; draw(); });
    }
  });
  load();
})();
