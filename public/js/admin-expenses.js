/* Expenses tab: the approver schedule as it stands. The schedule itself is edited on the expense log. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc, box = document.getElementById('ex-box');
  A.api('/api/admin/settings?area=expenses').then(function (d) {
    var x = d.extras || {}, a = x.approver;
    var over = (x.overrides || []).map(function (o) { return '<tr><td>' + E(o.start) + ' to ' + E(o.end) + '</td><td>' + E(o.name) + '</td><td class="mute">' + E(o.email) + '</td></tr>'; });
    box.innerHTML = '<div class="ad-cols"><section class="ad-card"><h2>Approvers now</h2>' +
      (a ? '<p style="margin:0"><b>' + E(a.name) + '</b></p><ul class="ad-list">' + a.emails.map(function (m) { return '<li>' + E(m) + '</li>'; }).join('') + '</ul>' : '<p class="ad-empty">Not set.</p>') +
      '<h3 style="margin:6px 0 0;font-size:14px">Who else can open the log</h3>' + ((x.viewers || []).length ? '<ul class="ad-list">' + x.viewers.map(function (m) { return '<li>' + E(m) + '</li>'; }).join('') + '</ul>' : '<p class="ad-empty">Nobody besides the approvers and admins.</p>') +
      '<div><a class="ad-btn ad-btn--primary" style="display:inline-block;text-decoration:none" href="/expenses/">Change the approvers in the expense log</a></div></section>' +
      '<section class="ad-card"><h2>Substitute approvers</h2><div class="ad-scroll"><table class="ad-table"><thead><tr><th>Dates</th><th>Name</th><th>Email</th></tr></thead><tbody>' + (over.length ? over.join('') : '<tr><td colspan="3" class="mute">No substitutes scheduled.</td></tr>') + '</tbody></table></div></section></div>';
    box.removeAttribute('aria-busy');
  }).catch(function (e) { A.fail(document.getElementById('ad-root'), e); });
})();
