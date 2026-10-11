/* Blackbaud users page: the latest read of the Blackbaud users list, filtered by status or a word. Read only. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var D = null, status = 'active';
  var OTHER = { bbms: 'Merchant Services', apps: 'Blackbaud apps', marketplace: 'Marketplace', paymentsapi: 'Payments API' };

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
    $('bu-body').innerHTML = list.length ? list.map(function (u) {
      var re = u.access.renxt ? chip(u.access.renxt, u.access.renxt === 'Admin' ? 'bu-chip--gold' : '') : '<span class="bu-none">None</span>';
      var other = Object.keys(OTHER).filter(function (k) { return u.access[k]; }).map(function (k) { return chip(OTHER[k] + ' ' + u.access[k]); }).join('') + u.admin.filter(function (a) { return a === 'Organization'; }).map(function (a) { return chip('Organization admin', 'bu-chip--gold'); }).join('');
      return '<tr><td data-label="User"><b>' + A.esc(u.name) + '</b><br><span class="bu-mail">' + A.esc(u.email) + '</span></td><td data-label="Raiser\'s Edge NXT">' + re + '</td><td data-label="Other products">' + (other || '<span class="bu-none">None</span>') + '</td><td data-label="Status">' + chip(u.active ? 'Active' : 'Inactive', u.active ? 'bu-chip--ok' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="au-empty">' + (D.users.length ? 'No user matches.' : 'The users page has not been read yet.') + '</td></tr>';
  }
  function tiles() {
    var s = D.summary;
    if (!s) { $('bu-tiles').innerHTML = ''; return; }
    $('bu-tiles').innerHTML = [['Users', s.total], ['Active', s.active], ['Inactive', s.inactive], ['Raiser\'s Edge NXT admins', s.renxtAdmins], ['Raiser\'s Edge NXT users', s.renxtUsers]].map(function (t) { return '<div class="bu-tile"><b>' + t[1] + '</b><span>' + A.esc(t[0]) + '</span></div>'; }).join('');
    var stale = Date.now() - Date.parse(D.at) > 36 * 3600000;
    $('bu-asof').innerHTML = D.at ? '<span class="' + (stale ? 'is-late' : '') + '">As of ' + A.esc(A.full(D.at)) + ' (' + A.esc(ago(D.at)) + ')</span>' : '';
  }
  $('bu-find').addEventListener('input', draw);
  $('bu-status').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    status = b.getAttribute('data-s');
    Array.prototype.forEach.call($('bu-status').children, function (x) { x.classList.toggle('is-on', x === b); });
    draw();
  });
  A.api('/api/work/bbusers').then(function (d) { D = d; tiles(); draw(); }).catch(function (e) { A.fail($('ad-root'), e); });
})();
