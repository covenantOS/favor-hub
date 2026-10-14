/* Admin > Adoption: who uses FavorOS and how. Summary, weekly bars, a sortable table by person, a day-by-day log per person, and the feedback feed. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var data = null, sortKey = 'lastActive', sortDir = -1;

  var COLS = [
    ['name', 'Person', 's'], ['team', 'Team', 's'], ['firstSignin', 'First sign-in', 's'], ['lastActive', 'Last active', 's'],
    ['activeDays30', 'Active days in 30', 'n'], ['areas', 'Top areas', 'a'], ['brain', 'Brain questions', 'n'], ['feedback', 'Feedback given', 'n'],
    ['tasks', 'Tasks made', 'n'], ['meetings', 'Meetings joined', 'n'], ['work', 'Work Center actions', 'n'], ['gifts', 'Gift entries', 'n']
  ];
  var AREA = { today: 'Today', work: 'Work Center', brain: 'Favor Brain', meet: 'Meetings', receipts: 'Receipts', tasks: 'Tasks', calendar: 'Calendar', projects: 'Projects', chat: 'Chat', clips: 'Clips', mail: 'Mail', admin: 'Admin', requests: 'Requests', dashboard: 'Dashboard', lists: 'Lists', 'gift-entry': 'Gift entry', learn: 'Learn', expenses: 'Expenses', foundations: 'Foundations', reports: 'Reports', feedback: 'Feedback', help: 'Help', evaluations: 'Evaluations', onboarding: 'Onboarding', statements: 'Statements', 'online-gifts': 'Online gifts', m: 'Phone app' };
  var area = function (a) { return AREA[a] || a.charAt(0).toUpperCase() + a.slice(1).replace(/-/g, ' '); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  function wkLabel(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  }

  function tiles() {
    var s = data.summary;
    function t(n, label) { return '<div class="tu-tile"><b>' + n + '</b><span>' + A.esc(label) + '</span></div>'; }
    $('ao-tiles').innerHTML =
      t(s.withAccount, 'staff with an account') + t(s.signedInEver + ' of ' + s.withAccount, 'have signed in') +
      t(s.active7, 'active in the last 7 days') + t(s.active30, 'active in the last 30 days');
    var max = Math.max.apply(null, data.weekly.map(function (w) { return w.people; }).concat([1]));
    $('ao-weeks').innerHTML = data.weekly.map(function (w) {
      var h = Math.round((w.people / max) * 100);
      return '<div class="ao-wk"><i class="ao-wk__bar" style="height:' + h + '%"></i><b>' + w.people + '</b><span>Week of ' + A.esc(wkLabel(w.week)) + '</span></div>';
    }).join('');
    $('ao-since').textContent = s.trackingSince
      ? 'Pages opened are counted from ' + A.day(s.trackingSince + 'T12:00:00Z').replace(/^Today$/, 'today') + '. Sign-ins, Favor Brain, tasks and meetings go back further. Your own row is shown and left out of the totals. Test accounts and blocked accounts are left out.'
      : 'Pages opened are counted from the first visit after this page went live. Sign-ins, Favor Brain, tasks and meetings go back further. Your own row is shown and left out of the totals. Test accounts and blocked accounts are left out.';
  }

  function val(p, k) {
    if (k === 'areas') return p.areas.length ? p.areas[0].n : 0;
    var v = p[k];
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  function drawTable() {
    var q = $('ao-find').value.trim().toLowerCase(), team = $('ao-team').value;
    var list = data.people.filter(function (p) {
      if (team && p.team !== team) return false;
      return !q || (p.name + ' ' + p.email + ' ' + p.team).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var x = val(a, sortKey), y = val(b, sortKey);
      if (x === y) return a.name < b.name ? -1 : 1;
      if (typeof x === 'string' && !x) return 1;
      if (typeof y === 'string' && !y) return -1;
      return (x < y ? -1 : 1) * sortDir;
    });
    $('ao-head').innerHTML = '<tr>' + COLS.map(function (c) {
      var on = c[0] === sortKey;
      return '<th' + (on ? ' aria-sort="' + (sortDir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" class="ao-sort" data-sort="' + c[0] + '">' + A.esc(c[1]) + (on ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    $('ao-body').innerHTML = list.length ? list.map(function (p) {
      var areas = p.areas.length ? p.areas.map(function (a) { return '<span>' + A.esc(area(a.area)) + ' ' + a.n + '</span>'; }).join('') : '<span class="mute">None counted yet</span>';
      return '<tr><td data-label="Person"><button type="button" class="ao-who" data-person="' + A.esc(p.email) + '">' + A.esc(p.name) + '</button>' + (p.you ? '<span class="ao-you">You, not in totals</span>' : '') + '</td>' +
        '<td data-label="Team">' + A.esc(p.team || '') + '</td>' +
        '<td data-label="First sign-in">' + (p.firstSignin ? A.esc(A.day(p.firstSignin)) : '<span class="mute">Never</span>') + '</td>' +
        '<td data-label="Last active" title="' + A.esc(A.full(p.lastActive)) + '">' + (p.lastActive ? A.esc(A.ago(p.lastActive) || A.day(p.lastActive)) : '<span class="mute">Never</span>') + '</td>' +
        '<td data-label="Active days in 30" class="ao-num">' + p.activeDays30 + '</td>' +
        '<td data-label="Top areas" class="ao-areas">' + areas + '</td>' +
        ['brain', 'feedback', 'tasks', 'meetings', 'work', 'gifts'].map(function (k, i) { return '<td data-label="' + A.esc(COLS[6 + i][1]) + '" class="ao-num">' + p[k] + '</td>'; }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="12" class="mute">Nobody matches.</td></tr>';
    $('ao-count').textContent = plural(list.length, 'person', 'people');
  }

  function drawNever() {
    var list = data.never;
    $('ao-never-note').textContent = list.length ? plural(list.length, 'active staff member has', 'active staff members have') + ' no sign-in on record.' : 'Everyone on the staff directory has signed in.';
    $('ao-never').innerHTML = list.length ? list.map(function (p) { return '<tr><td data-label="Person">' + A.esc(p.name) + '</td><td data-label="Team">' + A.esc(p.team || '') + '</td></tr>'; }).join('') : '<tr><td colspan="2" class="mute">Nobody.</td></tr>';
  }

  function drawFeed() {
    $('ao-fb').innerHTML = data.feedback.length ? data.feedback.map(function (f) {
      return '<tr><td data-label="When">' + A.esc(A.full(f.at)) + '</td><td data-label="Person">' + A.esc(f.name || f.email) + '</td><td data-label="Question" class="ao-quote">' + A.esc(f.question) + '</td>' +
        '<td data-label="Rating">' + A.esc(f.rating) + '</td><td data-label="Comment" class="ao-quote">' + A.esc(f.comment) + '</td><td data-label="Status">' + A.esc(f.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="mute">No feedback yet.</td></tr>';
  }

  function openPerson(email) {
    var box = $('ao-person');
    box.hidden = false;
    $('ao-person-name').textContent = 'Loading';
    $('ao-person-body').innerHTML = '';
    $('ao-person-fb').innerHTML = '';
    box.scrollIntoView({ block: 'start' });
    A.api('/api/admin/adoption?person=' + encodeURIComponent(email)).then(function (d) {
      $('ao-person-name').textContent = d.name + (d.team ? ', ' + d.team : '') + ': the last 90 days';
      $('ao-person-body').innerHTML = d.days.length ? d.days.map(function (r) {
        var areas = r.areas.length ? r.areas.map(function (a) { return '<span>' + A.esc(area(a.area)) + ' ' + a.n + '</span>'; }).join('') : '<span class="mute">Not counted</span>';
        return '<tr><td data-label="Day">' + A.esc(A.day(r.day + 'T16:00:00Z')) + ' <span class="mute">' + A.esc(r.day) + '</span></td><td data-label="Areas opened" class="ao-areas">' + areas + '</td>' +
          '<td data-label="Sign-ins" class="ao-num">' + r.signins + '</td><td data-label="Brain questions" class="ao-num">' + r.brain + '</td><td data-label="Feedback" class="ao-num">' + r.feedback + '</td>' +
          '<td data-label="Tasks made" class="ao-num">' + r.tasks + '</td><td data-label="Meetings" class="ao-num">' + r.meetings + '</td><td data-label="Work Center" class="ao-num">' + r.work + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="mute">Nothing recorded in the last 90 days.</td></tr>';
      $('ao-person-fb').innerHTML = d.feedback.length ? '<h3>Feedback given</h3>' + d.feedback.map(function (f) {
        return '<p class="tu-note"><b>' + A.esc(A.full(f.at)) + '</b> ' + A.esc([f.rating, f.question, f.comment].filter(Boolean).join(' / ')) + ' (' + A.esc(f.status) + ')</p>';
      }).join('') : '';
    }).catch(function (e) { $('ao-person-name').textContent = e.message; });
  }

  document.addEventListener('click', function (e) {
    var s = e.target.closest && e.target.closest('[data-sort]');
    if (s) {
      var k = s.getAttribute('data-sort');
      if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'name' || k === 'team') ? 1 : -1; }
      return drawTable();
    }
    var w = e.target.closest && e.target.closest('[data-person]');
    if (w) openPerson(w.getAttribute('data-person'));
  });
  $('ao-person-close').addEventListener('click', function () { $('ao-person').hidden = true; });
  $('ao-find').addEventListener('input', drawTable);
  $('ao-team').addEventListener('change', drawTable);

  A.api('/api/admin/adoption').then(function (d) {
    data = d;
    $('ao-team').innerHTML = '<option value="">Every team</option>' + d.teams.map(function (t) { return '<option>' + A.esc(t) + '</option>'; }).join('');
    tiles(); drawTable(); drawNever(); drawFeed();
  }).catch(function (e) { A.fail($('ad-root'), e); });
})();
