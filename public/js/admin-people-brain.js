/* Admin > People: Favor Brain access. Which roles, teams and people get which Brain packages (partner records, contact details,
   iWave, every team's numbers, Sheets, Brain admin). The Brain reads these rules within 30 seconds. Saved through /api/admin/brain-access. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc, root = document.getElementById('pp-brain');
  if (!root) return;
  var D = null;
  var KIND = { everyone: 'Everyone', role: 'Role', team: 'Team', lead: 'Team leads', person: 'Person' };

  function label(k) {
    var p = (D.packages || []).filter(function (x) { return x.key === k; })[0];
    return p ? p.label : k;
  }
  function who(r) {
    if (r.kind === 'everyone') return 'Everyone';
    if (r.kind === 'lead') return r.key ? 'Leads of ' + r.key : 'Every team lead';
    if (r.kind === 'role') return 'Role: ' + r.key;
    return r.key;
  }

  function draw() {
    if (!D) { root.innerHTML = ''; return; }
    var rules = D.rules || [];
    var rows = rules.map(function (r) {
      return '<tr><td>' + E(KIND[r.kind] || r.kind) + '</td><td>' + E(who(r)) + '</td><td>' + E(label(r.package)) + '</td>' +
        '<td class="ad-acts"><button type="button" class="ad-btn" data-rm="' + E(JSON.stringify({ kind: r.kind, key: r.key, package: r.package })) + '">Remove</button></td></tr>';
    }).join('');
    var people = (D.people || []).map(function (p) {
      var grant = p.fromGrants.length ? ' <span class="mute">(' + E(p.fromGrants.map(label).join(', ')) + ' by grant)</span>' : '';
      var gone = p.removedByGrant.length ? ' <span class="mute">(' + E(p.removedByGrant.map(label).join(', ')) + ' taken away by grant)</span>' : '';
      return '<tr><td>' + E(p.name) + '<div class="mute">' + E(p.email) + '</div></td><td>' + E(p.team || '') + '</td><td>' + (p.packages.length ? E(p.packages.map(label).join(', ')) : '<span class="mute">Basics only</span>') + grant + gone + '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="ad-sub"><div><div class="ad-set__name">Favor Brain access</div><div class="ad-set__hint">Each rule gives one Brain package to everyone, a FavorOS role, a team in the staff directory, team leads or one person. Grants on the Brain page still add or take away a package for one person. Contact details cover phone numbers, email and street addresses.</div></div></div>' +
      '<div class="ad-scroll"><table class="ad-table sc-table"><thead><tr><th>Applies to</th><th>Who</th><th>Package</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="4" class="mute">No rules. The Brain uses its built-in list until a rule is added.</td></tr>') + '</tbody></table></div>' +
      '<div class="ad-set ad-set--rep"><div><div class="ad-set__name">Add a rule</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<select class="ad-field" id="pb-kind" aria-label="Applies to" style="width:auto">' + Object.keys(KIND).map(function (k) { return '<option value="' + k + '">' + KIND[k] + '</option>'; }).join('') + '</select>' +
      '<select class="ad-field" id="pb-team" aria-label="Team" style="width:auto">' + (D.teams || []).map(function (t) { return '<option>' + E(t) + '</option>'; }).join('') + '</select>' +
      '<select class="ad-field" id="pb-role" aria-label="Role" style="width:auto" hidden><option value="staff">staff</option><option value="admin">admin</option></select>' +
      '<input class="ad-field" id="pb-person" placeholder="name@favorintl.org" aria-label="Person" autocomplete="off" spellcheck="false" hidden style="width:220px">' +
      '<select class="ad-field" id="pb-pkg" aria-label="Package" style="width:auto">' + (D.packages || []).map(function (p) { return '<option value="' + E(p.key) + '">' + E(p.label) + '</option>'; }).join('') + '</select>' +
      '</div><div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" id="pb-add">Add</button></div></div>' +
      '<p class="ad-msg" id="pb-msg" role="status"></p>' +
      '<details><summary>What each person has now (' + (D.people || []).length + ')</summary><div class="ad-scroll"><table class="ad-table sc-table"><thead><tr><th>Person</th><th>Team</th><th>Brain packages</th></tr></thead><tbody>' + people + '</tbody></table></div></details>';
    var kind = document.getElementById('pb-kind');
    var sync = function () {
      var k = kind.value;
      document.getElementById('pb-team').hidden = !(k === 'team' || k === 'lead');
      document.getElementById('pb-role').hidden = k !== 'role';
      document.getElementById('pb-person').hidden = k !== 'person';
    };
    kind.onchange = sync;
    sync();
    document.getElementById('pb-add').onclick = function () {
      var k = kind.value;
      var key = k === 'team' || k === 'lead' ? document.getElementById('pb-team').value : k === 'role' ? document.getElementById('pb-role').value : k === 'person' ? document.getElementById('pb-person').value : '';
      change({ op: 'add', kind: k, key: key, package: document.getElementById('pb-pkg').value }, this);
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-rm]'), function (b) {
      b.onclick = function () { var r = JSON.parse(b.getAttribute('data-rm')); r.op = 'remove'; change(r, b); };
    });
  }

  function say(text, bad) {
    var m = document.getElementById('pb-msg');
    if (!m) return;
    m.className = 'ad-msg' + (bad ? ' ad-msg--bad' : '');
    m.textContent = text;
  }

  function change(body, btn) {
    btn.disabled = true;
    say('Saving');
    A.api('/api/admin/brain-access', body).then(function () { return load(); }).then(function () { say('Saved. The Brain uses it within 30 seconds.'); }).catch(function (e) { btn.disabled = false; say(e.message, true); });
  }

  function load() {
    return A.api('/api/admin/brain-access').then(function (d) { D = d; draw(); });
  }
  load().catch(function () { root.innerHTML = ''; });
})();
