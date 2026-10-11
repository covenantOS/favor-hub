/* Reports tab: which roles see each report. Admins see every report whatever is saved here. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc, box = document.getElementById('rp-box');
  var D = null;

  function draw() {
    var rows = D.groups.map(function (g) {
      var list = D.reports.filter(function (r) { return r.group === g.id; });
      return '<section class="ad-card"><h2>' + E(g.label) + '</h2>' + list.map(function (r) {
        return '<div class="ad-set ad-set--rep" data-rep="' + E(r.id) + '"><div><div class="ad-set__name">' + E(r.name) + '</div><div class="ad-set__where">' + (r.ready ? 'Live' : 'Coming soon') + (r.saved ? '. Changed from the catalog.' : '.') + '</div></div>' +
          '<div class="ad-roles" role="group" aria-label="Roles that see ' + E(r.name) + '">' + D.audiences.map(function (a) {
            return '<label><input type="checkbox" value="' + E(a.value) + '"' + (r.roles.indexOf(a.value) >= 0 ? ' checked' : '') + '>' + E(a.label) + '</label>';
          }).join('') + '</div><div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" data-save disabled>Save</button>' + (r.saved ? '<button type="button" class="ad-btn" data-reset>Use the catalog</button>' : '') + '</div><p class="ad-msg" data-msg role="status" style="grid-column:1/-1"></p></div>';
      }).join('') + '</section>';
    }).join('');
    box.innerHTML = rows;
    box.removeAttribute('aria-busy');
  }

  function picked(row) { return [].slice.call(row.querySelectorAll('input:checked')).map(function (i) { return i.value; }); }
  function same(a, b) { return a.slice().sort().join() === b.slice().sort().join(); }

  box.addEventListener('change', function (e) {
    var row = e.target.closest('[data-rep]');
    if (!row) return;
    var r = D.reports.filter(function (x) { return x.id === row.dataset.rep; })[0];
    row.querySelector('[data-save]').disabled = same(picked(row), r.roles);
  });

  function post(row, body) {
    var m = row.querySelector('[data-msg]');
    m.className = 'ad-msg';
    m.textContent = 'Saving';
    return A.api('/api/admin/reports', Object.assign({ id: row.dataset.rep }, body)).then(function (d) {
      var id = row.dataset.rep;
      D.reports = d.reports;
      draw();
      var again = box.querySelector('[data-rep="' + id + '"] [data-msg]');
      if (again) { again.className = 'ad-msg ad-msg--ok'; again.textContent = 'Saved'; }
    }).catch(function (e) { m.className = 'ad-msg ad-msg--bad'; m.textContent = e.message; });
  }

  box.addEventListener('click', function (e) {
    var row = e.target.closest('[data-rep]');
    if (!row) return;
    if (e.target.closest('[data-save]')) post(row, { roles: picked(row) });
    else if (e.target.closest('[data-reset]')) post(row, { reset: true });
  });

  A.api('/api/admin/reports').then(function (d) { D = d; draw(); }).catch(function (e) { A.fail(document.getElementById('ad-root'), e); });
})();
