/* Audit log page: the newest settings changes first, filtered by area or a word. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var rows = [], last = 0, done = false;

  function draw() {
    var q = $('au-find').value.trim().toLowerCase();
    var list = rows.filter(function (e) { return !q || (e.actor + ' ' + e.label + ' ' + e.key + ' ' + e.before + ' ' + e.after + ' ' + e.note).toLowerCase().indexOf(q) >= 0; });
    $('au-body').innerHTML = list.length ? list.map(function (e) {
      return '<tr><td>' + A.esc(A.full(e.at)) + '</td><td>' + A.esc(e.actor) + '</td><td>' + A.esc(e.label) + '</td><td class="mute">' + A.esc(e.before == null ? '' : e.before) + '</td><td>' + A.esc(e.after == null ? '' : e.after) + '</td><td class="mute">' + A.esc(e.note || '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="mute">No changes match.</td></tr>';
    $('au-more').hidden = done;
  }

  function load(more) {
    var area = $('au-area').value;
    var url = '/api/admin/audit?limit=100' + (area ? '&area=' + encodeURIComponent(area) : '') + (more && last ? '&before=' + last : '');
    return A.api(url).then(function (d) {
      rows = more ? rows.concat(d.entries) : d.entries;
      done = d.entries.length < 100;
      last = rows.length ? rows[rows.length - 1].id : 0;
      draw();
    }).catch(function (e) { A.fail($('ad-root'), e); });
  }

  $('au-area').addEventListener('change', function () { last = 0; load(false); });
  $('au-find').addEventListener('input', draw);
  $('au-more').addEventListener('click', function () { load(true); });
  load(false);
})();
