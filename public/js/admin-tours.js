/* Admin > Tours: who has finished the tour of FavorOS and each release's walkthroughs, and Send again. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var data = null, armed = '';

  var ROLES = [['', 'Me'], ['staff', 'Any staff member'], ['rdd', 'RDD team'], ['pc', 'Partner Care'], ['ce', 'Church Engagement'], ['grants', 'Grants'], ['marketing', 'Marketing'], ['leader', 'Leadership']];

  function coreCell(c) {
    if (c.state === 'done') return '<span class="tu-pill tu-pill--done">Finished</span><small>' + A.esc(A.day(c.at)) + '</small>';
    if (c.state === 'queued') return '<span class="tu-pill tu-pill--sent">Sent again</span><small>' + A.esc(A.day(c.at)) + '</small>';
    if (c.state === 'snoozed') return '<span class="tu-pill tu-pill--wait">Skipped ' + c.skips + (c.skips === 1 ? ' time' : ' times') + '</span><small>' + A.esc(A.day(c.at)) + '</small>';
    if (c.state === 'offered') return '<span class="tu-pill tu-pill--wait">Shown, not started</span>';
    return '<span class="mute">Not shown yet</span>';
  }
  function relCell(r) {
    if (!r || !r.shown) return '<span class="mute">Not shown yet</span>';
    var all = r.done === r.shown;
    return '<span class="tu-pill ' + (all ? 'tu-pill--done' : 'tu-pill--wait') + '">' + r.done + ' of ' + r.shown + '</span>' + (r.skips && !all ? '<small>Skipped ' + r.skips + (r.skips === 1 ? ' time' : ' times') + '</small>' : r.at ? '<small>' + A.esc(A.day(r.at)) + '</small>' : '');
  }
  function finished(p) {
    return p.core.state === 'done' && data.releases.every(function (r) { var x = p.releases[r.id]; return x && x.shown && x.done === x.shown; });
  }
  function never(p) {
    return !p.core.state && data.releases.every(function (r) { var x = p.releases[r.id]; return !x || !x.shown; });
  }

  function draw() {
    var q = $('tu-find').value.trim().toLowerCase(), team = $('tu-team').value, show = $('tu-show').value;
    var list = data.people.filter(function (p) {
      if (q && (p.name + ' ' + p.email + ' ' + p.team).toLowerCase().indexOf(q) < 0) return false;
      if (team && p.team !== team) return false;
      if (show === 'done') return finished(p);
      if (show === 'open') return !finished(p);
      if (show === 'never') return never(p);
      return true;
    });
    $('tu-head').innerHTML = '<tr><th>Person</th><th>Team</th><th>Tour of FavorOS</th>' + data.releases.map(function (r) { return '<th>' + A.esc(r.title) + '</th>'; }).join('') + '<th>Last in FavorOS</th><th></th></tr>';
    var cols = 5 + data.releases.length;
    $('tu-body').innerHTML = list.length ? list.map(function (p) {
      return '<tr><td data-label="Person"><b>' + A.esc(p.name) + '</b></td><td data-label="Team">' + A.esc(p.team || '') + '</td><td data-label="Tour of FavorOS" class="tu-cell">' + coreCell(p.core) + '</td>' +
        data.releases.map(function (r) { return '<td data-label="' + A.esc(r.title) + '" class="tu-cell">' + relCell(p.releases[r.id]) + '</td>'; }).join('') +
        '<td data-label="Last in FavorOS">' + (p.lastSeen ? A.esc(A.day(p.lastSeen)) : '<span class="mute">Never</span>') + '</td>' +
        '<td class="tu-act"><button type="button" class="ad-btn" data-send="' + A.esc(p.email) + '">' + (armed === p.email ? 'Press again to send' : 'Send again') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="' + cols + '" class="mute">' + (data.ready ? 'Nobody matches.' : 'This list fills in once the tours table is added to the database. Until then each browser keeps its own progress.') + '</td></tr>';
    $('tu-count').textContent = data.ready ? list.length + (list.length === 1 ? ' person' : ' people') : '';
    var t = $('tu-send-team');
    t.disabled = !team || !data.ready;
    t.textContent = armed === 'team:' + team ? 'Press again to send to ' + team : team ? 'Send to ' + team : 'Send to the team';
  }

  function tiles() {
    var n = data.people.length;
    var core = data.people.filter(function (p) { return p.core.state === 'done'; }).length;
    var html = '<div class="tu-tile"><b>' + core + ' of ' + n + '</b><span>finished the tour of FavorOS</span></div>';
    data.releases.forEach(function (r) {
      var all = data.people.filter(function (p) { var x = p.releases[r.id]; return x && x.shown && x.done === x.shown; }).length;
      var some = data.people.filter(function (p) { var x = p.releases[r.id]; return x && x.shown; }).length;
      html += '<div class="tu-tile"><b>' + all + ' of ' + some + '</b><span>shown ' + A.esc(r.title) + ' have finished it</span></div>';
    });
    $('tu-tiles').innerHTML = data.ready ? html : '';
  }

  function send(body, label) {
    $('tu-msg').textContent = 'Sending';
    A.api('/api/admin/tours', body).then(function (d) {
      $('tu-msg').textContent = 'Sent again to ' + (label || d.sent + (d.sent === 1 ? ' person' : ' people')) + '. It opens on their next page.';
      return load();
    }).catch(function (e) { $('tu-msg').textContent = e.message; });
  }

  function load() {
    return A.api('/api/admin/tours').then(function (d) {
      data = d;
      var team = $('tu-team'), keep = team.value;
      team.innerHTML = '<option value="">Every team</option>' + d.teams.map(function (t) { return '<option>' + A.esc(t) + '</option>'; }).join('');
      team.value = keep;
      $('tu-what').innerHTML = '<option value="core">Tour of FavorOS</option>' + d.releases.map(function (r) { return '<option value="r:' + A.esc(r.id) + '">' + A.esc(r.title) + '</option>'; }).join('');
      $('tu-as').innerHTML = ROLES.map(function (r) {
        return '<div class="tu-as__row"><b>' + r[1] + '</b><a class="ad-btn" href="/?tour=core' + (r[0] ? '&as=' + r[0] : '') + '">Tour of FavorOS</a>' +
          d.releases.map(function (x) { return '<a class="ad-btn" href="/?tour=new' + (r[0] ? '&as=' + r[0] : '') + '">' + A.esc(x.title) + '</a>'; }).join('') + '</div>';
      }).join('');
      tiles();
      draw();
    }).catch(function (e) { A.fail($('ad-root'), e); });
  }

  ['tu-find', 'tu-team', 'tu-show'].forEach(function (id) { $(id).addEventListener(id === 'tu-find' ? 'input' : 'change', function () { armed = ''; draw(); }); });
  $('tu-body').addEventListener('click', function (e) {
    var b = e.target.closest('[data-send]');
    if (!b || !data || !data.ready) { if (b) $('tu-msg').textContent = 'Send again works once the tours table is added to the database.'; return; }
    var who = b.getAttribute('data-send');
    if (armed !== who) { armed = who; return draw(); }
    armed = '';
    send({ what: $('tu-what').value, emails: [who] }, (data.people.filter(function (p) { return p.email === who; })[0] || {}).name);
  });
  $('tu-send-team').addEventListener('click', function () {
    var team = $('tu-team').value;
    if (!team) return;
    if (armed !== 'team:' + team) { armed = 'team:' + team; return draw(); }
    armed = '';
    send({ what: $('tu-what').value, team: team }, team);
  });
  load();
})();
