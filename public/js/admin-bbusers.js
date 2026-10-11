/* Blackbaud users page: the latest read of the Blackbaud users list, filtered by status or a word, and the requests to add a user, change access or
   deactivate. SKY has no user endpoint, so a request is saved and the desktop automation runs it in Blackbaud; the Requests list shows its status. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var D = null, J = null, status = 'active', panel = null, timer = 0;
  var OTHER = { bbms: 'Merchant Services', apps: 'Blackbaud apps', marketplace: 'Marketplace', paymentsapi: 'Payments API' };
  var KIND = { add: 'Add user', access: 'Change access', deactivate: 'Deactivate' };

  function chip(text, cls) { return '<span class="bu-chip' + (cls ? ' ' + cls : '') + '">' + A.esc(text) + '</span>'; }
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso);
    var h = Math.floor(ms / 3600000);
    return h < 1 ? 'under an hour ago' : h < 48 ? h + (h === 1 ? ' hour ago' : ' hours ago') : Math.floor(h / 24) + ' days ago';
  }
  function draw() {
    if (!D) return;
    var q = $('bu-find').value.trim().toLowerCase();
    var list = D.users.filter(function (u) {
      if (status === 'active' && !u.active) return false;
      if (status === 'inactive' && u.active) return false;
      return !q || (u.name + ' ' + u.email).toLowerCase().indexOf(q) >= 0;
    });
    var open = {};
    ((J && J.jobs) || []).forEach(function (j) { if (j.state === 'queued' || j.state === 'running' || j.state === 'checked') open[j.email + '|' + j.kind] = j.status; });
    $('bu-body').innerHTML = list.length ? list.map(function (u) {
      var re = u.access.renxt ? chip(u.access.renxt, u.access.renxt === 'Admin' ? 'bu-chip--gold' : '') : '<span class="bu-none">None</span>';
      var other = Object.keys(OTHER).filter(function (k) { return u.access[k]; }).map(function (k) { return chip(OTHER[k] + ' ' + u.access[k]); }).join('') + u.admin.filter(function (a) { return a === 'Organization'; }).map(function () { return chip('Organization admin', 'bu-chip--gold'); }).join('');
      var em = u.email.toLowerCase();
      var acts = !u.active ? '' : (open[em + '|access'] ? chip(open[em + '|access']) : '<button type="button" class="ad-btn" data-act="access" data-email="' + A.esc(u.email) + '">Change access</button>') +
        (open[em + '|deactivate'] ? chip(open[em + '|deactivate']) : '<button type="button" class="ad-btn" data-act="deactivate" data-email="' + A.esc(u.email) + '">Deactivate</button>');
      return '<tr><td data-label="User"><b>' + A.esc(u.name) + '</b><br><span class="bu-mail">' + A.esc(u.email) + '</span></td><td data-label="Raiser\'s Edge NXT">' + re + '</td><td data-label="Other products">' + (other || '<span class="bu-none">None</span>') + '</td><td data-label="Status">' + chip(u.active ? 'Active' : 'Inactive', u.active ? 'bu-chip--ok' : '') + '</td><td data-label="Actions" class="bu-acts">' + acts + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="au-empty">' + (D.users.length ? 'No user matches.' : 'The users page has not been read yet.') + '</td></tr>';
  }
  function tiles() {
    var s = D.summary;
    if (!s) { $('bu-tiles').innerHTML = ''; return; }
    $('bu-tiles').innerHTML = [['Users', s.total], ['Active', s.active], ['Inactive', s.inactive], ['Raiser\'s Edge NXT admins', s.renxtAdmins], ['Raiser\'s Edge NXT users', s.renxtUsers]].map(function (t) { return '<div class="bu-tile"><b>' + t[1] + '</b><span>' + A.esc(t[0]) + '</span></div>'; }).join('');
    var stale = Date.now() - Date.parse(D.at) > 36 * 3600000;
    $('bu-asof').innerHTML = D.at ? '<span class="' + (stale ? 'is-late' : '') + '">As of ' + A.esc(A.full(D.at)) + ' (' + A.esc(ago(D.at)) + ')</span>' : '';
  }

  /* ------------------------------------------------------------------ requests */
  function accessLine(a) {
    if (!a) return '';
    var bits = [];
    if (a.solutionAdmin) bits.push('Solution admin');
    Object.keys(a.roles || {}).forEach(function (k) { bits.push(((J.form.roles[k] || {}).label || k) + ' ' + a.roles[k]); });
    if ((a.groups || []).length) bits.push('Groups: ' + a.groups.join(', '));
    return bits.join('; ');
  }
  function drawJobs() {
    var box = $('bu-jobs');
    if (!J) { box.innerHTML = ''; return; }
    if (!J.jobs.length) { box.innerHTML = '<p class="bu-none">No requests yet.</p>'; return; }
    box.innerHTML = '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Request</th><th>Status</th><th>Asked</th><th>Result</th><th></th></tr></thead><tbody>' + J.jobs.map(function (j) {
      var cls = j.state === 'done' ? 'bu-chip--ok' : j.state === 'failed' ? 'bu-chip--bad' : j.state === 'running' ? 'bu-chip--gold' : '';
      var who = A.esc(j.name || j.email);
      return '<tr><td data-label="Request"><b>' + A.esc(KIND[j.kind] || j.kind) + '</b> ' + who + '<br><span class="bu-mail">' + A.esc(j.email) + (j.access ? ' · ' + A.esc(accessLine(j.access)) : '') + '</span></td>' +
        '<td data-label="Status">' + chip(j.status, cls) + '</td>' +
        '<td data-label="Asked">' + A.esc(A.when(j.at)) + '<br><span class="bu-mail">' + A.esc(j.by) + '</span></td>' +
        '<td data-label="Result">' + A.esc(j.result || '') + '</td>' +
        '<td data-label="">' + (j.state === 'queued' || j.state === 'checked' ? '<button type="button" class="ad-btn" data-cancel="' + A.esc(j.id) + '">Cancel</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function loadJobs() {
    return A.api('/api/work/bbusers/jobs').then(function (d) {
      J = d; drawJobs(); draw();
      clearTimeout(timer);
      if (d.open) timer = setTimeout(loadJobs, 15000);
    }).catch(function () { /* the list keeps its last read */ });
  }

  /* ------------------------------------------------------------------ the request form */
  function opt(v, label, sel) { return '<option value="' + A.esc(v) + '"' + (sel ? ' selected' : '') + '>' + A.esc(label) + '</option>'; }
  function accessFields() {
    var f = J.form;
    var roles = Object.keys(f.roles).map(function (k) {
      return '<label class="bu-f"><span>' + A.esc(f.roles[k].label) + '</span><select class="ad-field" data-role="' + A.esc(k) + '">' + opt('', 'No role') + f.roles[k].levels.map(function (l) { return opt(l, l); }).join('') + '</select></label>';
    }).join('');
    var groups = f.groups.map(function (g) { return '<label class="bu-check"><input type="checkbox" data-group="' + A.esc(g) + '"> ' + A.esc(g) + '</label>'; }).join('');
    return '<label class="bu-f"><span>Access</span><select class="ad-field" id="bu-preset">' + opt('normal', 'Normal user') + opt('solution_admin', 'Solution admin') + opt('custom', 'Choose roles and groups') + '</select></label>' +
      '<div id="bu-custom" hidden><div class="bu-grid">' + roles + '</div><fieldset class="bu-groups"><legend>Database view groups</legend>' + groups + '</fieldset></div>';
  }
  function fillPreset(name) {
    var p = J.form.presets[name]; if (!p) return;
    Array.prototype.forEach.call(document.querySelectorAll('#bu-panel [data-role]'), function (s) { s.value = p.roles[s.getAttribute('data-role')] || ''; });
    Array.prototype.forEach.call(document.querySelectorAll('#bu-panel [data-group]'), function (c) { c.checked = p.groups.indexOf(c.getAttribute('data-group')) >= 0; });
  }
  function readAccess() {
    var preset = $('bu-preset').value;
    if (preset !== 'custom') return { preset: preset };
    var roles = {}, groups = [];
    Array.prototype.forEach.call(document.querySelectorAll('#bu-panel [data-role]'), function (s) { if (s.value) roles[s.getAttribute('data-role')] = s.value; });
    Array.prototype.forEach.call(document.querySelectorAll('#bu-panel [data-group]'), function (c) { if (c.checked) groups.push(c.getAttribute('data-group')); });
    return { access: { solutionAdmin: false, roles: roles, groups: groups } };
  }
  function open(kind, email) {
    if (!J) return;
    var u = email && D ? D.users.filter(function (x) { return x.email.toLowerCase() === email.toLowerCase(); })[0] : null;
    panel = { kind: kind, email: email || '' };
    var el = $('bu-panel');
    var head = '<h2>' + A.esc(KIND[kind]) + (u ? ': ' + A.esc(u.name) : '') + '</h2>' + (u ? '<p class="ad-card__meta">' + A.esc(u.email) + '</p>' : '');
    var body = '';
    if (kind === 'add') body = '<div class="bu-grid"><label class="bu-f"><span>First name</span><input class="ad-field" id="bu-first" autocomplete="off"></label><label class="bu-f"><span>Last name</span><input class="ad-field" id="bu-last" autocomplete="off"></label><label class="bu-f"><span>Email</span><input class="ad-field" id="bu-email" type="email" autocomplete="off"></label></div>' + accessFields();
    else if (kind === 'access') body = accessFields();
    else body = '<p>The login becomes inactive in Blackbaud.</p>';
    var go = kind === 'deactivate' ? '<button type="button" class="ad-btn ad-btn--warn" id="bu-go">Deactivate</button>' : '<button type="button" class="ad-btn ad-btn--primary" id="bu-go">' + (kind === 'add' ? 'Add user' : 'Save access') + '</button>';
    el.innerHTML = head + body + '<p class="ad-msg" id="bu-msg" role="status"></p><div class="bu-row">' + go + '<button type="button" class="ad-btn" id="bu-close">Close</button></div>';
    el.hidden = false;
    if (kind !== 'deactivate') { fillPreset('normal'); }
    var f = el.querySelector('input, select'); if (f) f.focus(); else $('bu-go').focus();
    el.scrollIntoView({ block: 'nearest' });
  }
  function close() { panel = null; $('bu-panel').hidden = true; $('bu-panel').innerHTML = ''; }
  function submit() {
    var msg = $('bu-msg'), go = $('bu-go');
    var body = { kind: panel.kind, email: panel.email };
    if (panel.kind === 'add') { body.first = $('bu-first').value; body.last = $('bu-last').value; body.email = $('bu-email').value; }
    if (panel.kind !== 'deactivate') { var a = readAccess(); body.preset = a.preset; body.access = a.access; }
    go.disabled = true; msg.className = 'ad-msg'; msg.textContent = 'Saving';
    A.api('/api/work/bbusers/jobs', body).then(function () { close(); return loadJobs(); }).catch(function (e) { go.disabled = false; msg.className = 'ad-msg ad-msg--bad'; msg.textContent = e.message; });
  }

  $('bu-find').addEventListener('input', draw);
  $('bu-status').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    status = b.getAttribute('data-s');
    Array.prototype.forEach.call($('bu-status').children, function (x) { x.classList.toggle('is-on', x === b); });
    draw();
  });
  $('bu-add').addEventListener('click', function () { open('add'); });
  $('bu-body').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    open(b.getAttribute('data-act'), b.getAttribute('data-email'));
  });
  $('bu-jobs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cancel]'); if (!b) return;
    b.disabled = true;
    A.api('/api/work/bbusers/jobs/cancel', { id: b.getAttribute('data-cancel') }).then(loadJobs).catch(function (er) { b.disabled = false; window.alert(er.message); });
  });
  $('bu-panel').addEventListener('click', function (e) {
    if (e.target.id === 'bu-close') close();
    if (e.target.id === 'bu-go') submit();
  });
  $('bu-panel').addEventListener('change', function (e) {
    if (e.target.id === 'bu-preset') {
      var custom = e.target.value === 'custom';
      $('bu-custom').hidden = !custom;
      if (!custom) fillPreset(e.target.value);
    }
  });
  $('bu-panel').addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  A.api('/api/work/bbusers').then(function (d) { D = d; tiles(); draw(); return loadJobs(); }).catch(function (e) { A.fail($('ad-root'), e); });
})();
