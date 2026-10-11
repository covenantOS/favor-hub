/* People and roles: the list, the editor panel and the act-as preview. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc, $ = function (id) { return document.getElementById(id); };
  var D = { people: [], teams: [], entryTypes: [] }, me = '';

  function teamLabel(v) { var t = D.teams.filter(function (x) { return x.value === v; })[0]; return t ? t.label : ''; }
  function sees(p) {
    if (p.blocked) return '<span class="ad-chip ad-chip--block">Blocked</span>';
    var s = p.sees, out = [];
    if (s.admin) out.push('Admin');
    if (s.workCenter) out.push('Work Center');
    if (s.meetings) out.push('Meetings');
    if (s.clips) out.push('Clips');
    if (s.reports) out.push(s.reports + ' reports');
    if (s.expenseLog) out.push('Expense log');
    return E(out.join(', ') || 'Today, Reporting, Favor Brain');
  }

  function draw() {
    var q = $('pp-find').value.trim().toLowerCase(), f = $('pp-filter').value;
    var list = D.people.filter(function (p) {
      if (q && (p.name + ' ' + p.email + ' ' + teamLabel(p.team)).toLowerCase().indexOf(q) < 0) return false;
      if (f === 'admin') return p.role === 'admin' && !p.blocked;
      if (f === 'blocked') return p.blocked;
      if (f === 'wc') return p.workCenter;
      if (f === 'nolist') return !p.listed && !p.blocked;
      return true;
    });
    $('pp-count').textContent = list.length + ' of ' + D.people.length;
    $('pp-body').innerHTML = list.length ? list.map(function (p) {
      var role = p.blocked ? '<span class="ad-chip ad-chip--block">Blocked</span>' : '<span class="ad-chip' + (p.role === 'admin' ? ' ad-chip--admin' : '') + '">' + (p.role === 'admin' ? 'Admin' : 'Staff') + '</span>';
      return '<tr data-email="' + E(p.email) + '"><td><b>' + E(p.name) + '</b><br><span class="mute">' + E(p.email) + '</span></td>' +
        '<td>' + role + (p.envAdmin ? '<br><span class="mute">Set in Pages</span>' : '') + '</td>' +
        '<td>' + E(teamLabel(p.team)) + '</td><td class="mute">' + E(p.fundraiser) + '</td>' +
        '<td>' + (p.workCenter ? '<span class="ad-yes">Yes</span>' : '<span class="ad-no">No</span>') + '</td><td>' + sees(p) + '</td>' +
        '<td><div class="ad-acts"><button type="button" class="ad-btn" data-edit="' + E(p.email) + '">Edit</button><button type="button" class="ad-btn" data-as="' + E(p.email) + '">Act as</button></div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="mute">Nobody matches.</td></tr>';
  }

  function load() {
    return A.api('/api/admin/people').then(function (d) { D = d; draw(); }).catch(function (e) { A.fail($('ad-root'), e); });
  }

  function open(html) {
    $('pp-panel').innerHTML = html;
    $('pp-panel').hidden = false;
    $('pp-sheet').hidden = false;
    var f = $('pp-panel').querySelector('input:not([readonly]),select,button');
    if (f) f.focus();
  }
  function close() { $('pp-panel').hidden = true; $('pp-sheet').hidden = true; }

  function opts(list, cur, blank) {
    return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function (o) {
      var v = o.value || o, l = o.label || o;
      return '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(l) + '</option>';
    }).join('');
  }

  function editor(email) {
    var p = D.people.filter(function (x) { return x.email === email; })[0] || { email: '', name: '', role: 'staff', blocked: false, note: '', team: '', fundraiser: '', workCenter: false, entryOwner: false, entryType: '', sheetTab: '', active: true, listed: false };
    var isNew = !email, self = !!email && email === me;
    open('<h2>' + (isNew ? 'Add a person' : E(p.name)) + '</h2><form class="ad-form" id="pp-form" autocomplete="off">' +
      '<label>Email<input class="ad-field" name="email" value="' + E(p.email) + '"' + (isNew ? ' placeholder="name@favorintl.org"' : ' readonly') + ' required></label>' +
      '<label>Name<input class="ad-field" name="name" value="' + E(p.name) + '"></label>' +
      '<label>Role<select class="ad-field" name="role"' + (self ? ' disabled' : '') + '>' + opts([{ value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }], p.role) + '</select></label>' +
      (p.envAdmin ? '<p class="ad-set__hint">This address is also listed in the HUB_ADMINS Pages variable, so it stays an admin.</p>' : '') +
      '<label class="ad-check"><input type="checkbox" name="blocked"' + (p.blocked ? ' checked' : '') + (self ? ' disabled' : '') + '> Blocked from signing in</label>' +
      '<label>Team<select class="ad-field" name="team">' + opts(D.teams, p.team, 'No team') + '</select></label>' +
      '<label>Blackbaud fundraiser id<input class="ad-field" name="fundraiser" inputmode="numeric" value="' + E(p.fundraiser) + '"></label>' +
      '<label class="ad-check"><input type="checkbox" name="workCenter"' + (p.workCenter ? ' checked' : '') + '> Can open the Work Center</label>' +
      '<label class="ad-check"><input type="checkbox" name="entryOwner"' + (p.entryOwner ? ' checked' : '') + '> Has an Entry chip</label>' +
      '<label>Entry action type<select class="ad-field" name="entryType">' + opts(D.entryTypes, p.entryType, 'None') + '</select></label>' +
      '<label>Tracking sheet tab<input class="ad-field" name="sheetTab" value="' + E(p.sheetTab) + '"></label>' +
      '<label>Note<input class="ad-field" name="note" value="' + E(p.note) + '"></label>' +
      '<div class="ad-acts" style="justify-content:flex-start"><button class="ad-btn ad-btn--primary" type="submit">Save</button><button class="ad-btn" type="button" id="pp-cancel">Cancel</button></div><p class="ad-msg" id="pp-msg" role="status"></p></form>');
    $('pp-cancel').onclick = close;
    $('pp-form').onsubmit = function (ev) {
      ev.preventDefault();
      var f = ev.target, v = function (n) { return f.elements[n]; };
      var body = { email: v('email').value.trim(), name: v('name').value, note: v('note').value };
      if (!self) { body.role = v('role').value; body.blocked = v('blocked').checked; }
      if (v('team').value) {
        body.team = v('team').value; body.fundraiser = v('fundraiser').value; body.workCenter = v('workCenter').checked;
        body.entryOwner = v('entryOwner').checked; body.entryType = v('entryType').value; body.sheetTab = v('sheetTab').value;
      }
      var msg = $('pp-msg');
      msg.className = 'ad-msg';
      msg.textContent = 'Saving';
      A.api('/api/admin/people', body).then(function () { close(); return load(); }).catch(function (e) { msg.className = 'ad-msg ad-msg--bad'; msg.textContent = e.message; });
    };
  }

  function preview(email) {
    open('<h2>Reading</h2>');
    A.api('/api/admin/people?preview=' + encodeURIComponent(email)).then(function (d) {
      var by = {};
      d.pages.forEach(function (p) { (by[p.area] = by[p.area] || []).push(p.label); });
      var chip = d.person.blocked ? '<span class="ad-chip ad-chip--block">Blocked</span>' : '<span class="ad-chip' + (d.person.role === 'admin' ? ' ad-chip--admin' : '') + '">' + (d.person.role === 'admin' ? 'Admin' : 'Staff') + '</span>';
      open('<h2>What ' + E(d.person.name) + ' sees</h2><p class="ad-set__hint">Preview only. It does not sign in as them or change anything.</p>' +
        '<p>' + chip + ' ' + E(d.person.team) + '</p>' +
        Object.keys(by).map(function (a) { return '<h3 style="margin:8px 0 2px;font-size:14px">' + E(a) + '</h3><p style="margin:0">' + E(by[a].join(', ')) + '</p>'; }).join('') +
        '<h3 style="margin:8px 0 2px;font-size:14px">Reports (' + d.reports.length + ')</h3><p style="margin:0">' + E(d.reports.join(', ') || 'None') + '</p>' +
        '<h3 style="margin:8px 0 2px;font-size:14px">Can record clips</h3><p style="margin:0">' + (d.clipsRecord ? 'Yes' : 'No') + '</p>' +
        '<p class="ad-set__hint">' + E(d.note) + '</p><div class="ad-acts" style="justify-content:flex-start"><button class="ad-btn" id="pp-done" type="button">Close</button></div>');
      $('pp-done').onclick = close;
    }).catch(function (e) {
      open('<h2>Preview</h2><p class="ad-msg ad-msg--bad">' + E(e.message) + '</p><button class="ad-btn" id="pp-done" type="button">Close</button>');
      $('pp-done').onclick = close;
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-edit],[data-as]');
    if (!b) return;
    if (b.dataset.edit) editor(b.dataset.edit); else preview(b.dataset.as);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('pp-panel').hidden) close(); });
  $('pp-sheet').addEventListener('click', close);
  $('pp-add').addEventListener('click', function () { editor(''); });
  $('pp-find').addEventListener('input', draw);
  $('pp-filter').addEventListener('change', draw);
  fetch('/api/hub/nav', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { me = ((d.user && d.user.email) || '').toLowerCase(); }).catch(function () {});
  load();
})();
