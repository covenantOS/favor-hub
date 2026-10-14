/* Admin > Projects, Asana sync: the on and off switch, which Asana projects sync, who must connect Asana before Projects opens, the
   queues and the sync log. Everything goes through /api/asana/admin. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc;
  var root = document.getElementById('as-root');
  if (!root) return;
  var S = null;

  function msg(text, bad) {
    var m = root.querySelector('[data-msg]');
    if (m) { m.textContent = text || ''; m.className = 'ad-msg' + (text ? (bad ? ' ad-msg--bad' : ' ad-msg--ok') : ''); }
  }
  function when(iso) { return iso ? A.when(iso) : 'Never'; }

  function draw() {
    var r = S.require || { people: [], extra: [], skip: [] };
    var rows = S.projects.map(function (p) {
      return '<tr><td>' + E(p.name) + (p.team ? '<div class="ad-card__meta">' + E(p.team) + '</div>' : '') + '</td><td>' + E(when(p.modified_at)) + '</td>' +
        '<td>' + (p.enabled ? (p.webhook ? 'Syncing' : 'Syncing, webhook not set') : 'Off') + '</td><td>' + E(p.enabled ? when(p.last_reconcile) : '') + '</td>' +
        '<td><button type="button" class="ad-btn' + (p.enabled ? '' : ' ad-btn--primary') + '" data-act="proj" data-gid="' + E(p.gid) + '" data-on="' + (p.enabled ? '0' : '1') + '">' + (p.enabled ? 'Stop syncing' : 'Sync') + '</button></td></tr>';
    }).join('');
    var ppl = r.people.map(function (p) { return '<li>' + E(p.email) + (p.connected ? ' (connected)' : '') + '</li>'; }).join('');
    var log = (S.log || []).map(function (l) { return '<tr><td>' + E(A.when(l.at)) + '</td><td>' + E(l.dir) + '</td><td>' + E(l.text) + '</td></tr>'; }).join('');
    root.innerHTML = '<section class="ad-card"><h2>Asana sync</h2>' +
      '<p class="ad-card__meta">Sync is ' + (S.sync === 'on' ? 'on' : 'off') + '. Waiting to go to Asana: ' + S.queue.outbox + '. Failed: ' + S.queue.outbox_failed + '. Waiting to come in: ' + S.queue.inbox + '. People connected: ' + S.connected + '.' + (S.waiting_until ? ' Asana asked FavorOS to wait until ' + E(A.when(S.waiting_until)) + '.' : '') + '</p>' +
      '<div class="ad-acts ap-left"><button type="button" class="ad-btn' + (S.sync === 'on' ? '' : ' ad-btn--primary') + '" data-act="sync" data-on="' + (S.sync === 'on' ? 'off' : 'on') + '">' + (S.sync === 'on' ? 'Turn sync off' : 'Turn sync on') + '</button><p class="ad-msg" data-msg role="status"></p></div>' +
      '<div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>Asana project</th><th>Last changed in Asana</th><th>Sync</th><th>Last full read</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="ad-card"><h2>Connect Asana before Projects</h2>' +
      '<p class="ad-card__meta">' + (r.on ? 'On' : 'Off') + '. Applies to everyone in the Asana workspace and on synced projects, and the Marketing team, plus the added list, less the skipped list. ' + r.people.length + ' people.</p>' +
      '<div class="ad-acts ap-left"><button type="button" class="ad-btn' + (r.on ? '' : ' ad-btn--primary') + '" data-act="require" data-on="' + (r.on ? 'off' : 'on') + '">' + (r.on ? 'Turn off' : 'Turn on') + '</button></div>' +
      '<div class="ap-row"><label class="ap-grow"><span class="ap-lab">Also these people</span><input class="ad-field" id="as-extra" value="' + E((r.extra || []).join(', ')) + '"></label></div>' +
      '<div class="ap-row"><label class="ap-grow"><span class="ap-lab">Never these people</span><input class="ad-field" id="as-skip" value="' + E((r.skip || []).join(', ')) + '"></label></div>' +
      '<div class="ad-acts ap-left"><button type="button" class="ad-btn ad-btn--primary" data-act="lists">Save lists</button></div>' +
      (ppl ? '<details><summary>Who this applies to</summary><ul class="ad-list">' + ppl + '</ul></details>' : '') + '</section>' +
      '<section class="ad-card"><h2>Sync log</h2><div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>When</th><th>Way</th><th>What</th></tr></thead><tbody>' + log + '</tbody></table></div></section>';
  }

  function load() {
    return A.api('/api/asana/admin').then(function (d) { S = d; draw(); }).catch(function (e) { root.innerHTML = '<section class="ad-card"><h2>Asana sync</h2><p class="ad-msg ad-msg--bad">' + E(e.message) + '</p></section>'; });
  }
  function post(path, body) {
    msg('Saving');
    return A.api(path, body).then(load).catch(function (e) { msg(e.message, true); });
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'sync') post('/api/asana/admin', { sync: b.getAttribute('data-on') });
    else if (act === 'require') post('/api/asana/admin', { require: b.getAttribute('data-on') });
    else if (act === 'lists') post('/api/asana/admin', { extra: root.querySelector('#as-extra').value, skip: root.querySelector('#as-skip').value });
    else if (act === 'proj') post('/api/asana/admin/project', { gid: b.getAttribute('data-gid'), enabled: b.getAttribute('data-on') === '1' });
  });
  load();
})();
