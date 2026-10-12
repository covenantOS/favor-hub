/* Admin > Projects. Who can use Projects, the Asana token, the Asana import (dry run, then import, with progress and a log), and the
   hub's own projects with archive and restore. Everything goes through /api/admin/projects. The token is typed here once and never
   comes back to the page. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc;
  var root = document.getElementById('ap-root');
  if (!root) return;
  var API = '/api/admin/projects';
  var S = { settings: null, projects: [], runs: [], source: 'api', asana: [], archived: false, picked: {}, upload: '', exportName: '', run: null, logAfter: 0, busy: false, lastDry: null, loop: 0 };

  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function msg(id, text, bad) {
    var m = root.querySelector('[data-msg="' + id + '"]');
    if (m) { m.textContent = text || ''; m.className = 'ad-msg' + (text ? (bad ? ' ad-msg--bad' : ' ad-msg--ok') : ''); }
  }
  function api(path, body) {
    var m = String(path).match(/^\/?([^?]*)\??(.*)$/);
    return A.api(API + (m[1] ? '?p=' + m[1] + (m[2] ? '&' + m[2] : '') : (m[2] ? '?' + m[2] : '')), body);
  }
  function opt(v, label, cur) { return '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(label) + '</option>'; }

  /* ---------------------------------------------------------------------------------------------- who and requests */
  function drawAccess() {
    var s = S.settings;
    var live = S.projects.filter(function (p) { return p.status !== 'archived'; });
    return '<section class="ad-card ad-group"><h3>Who can use Projects</h3>' +
      '<div class="ad-set"><div><label class="ad-set__name" for="ap-enabled">Who can open Projects</label><div class="ad-set__hint">Admins only, every signed-in staff member, or nobody.</div></div>' +
      '<div><select class="ad-field" id="ap-enabled">' + opt('admins', 'Admins only', s.enabled) + opt('staff', 'Every staff member', s.enabled) + opt('off', 'Nobody', s.enabled) + '</select></div>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" data-act="save-enabled">Save</button><p class="ad-msg" data-msg="enabled" role="status"></p></div></div>' +
      '<div class="ad-set"><div><label class="ad-set__name" for="ap-mkt">Marketing requests</label><div class="ad-set__hint">Where a Marketing request from Make a request goes. The Asana form is the default.</div></div>' +
      '<div><select class="ad-field" id="ap-mkt">' + opt('', 'The Asana form', (s.marketing_project || '').toUpperCase()) + live.map(function (p) { return opt(p.key, p.name + ' (' + p.key + ')', (s.marketing_project || '').toUpperCase()); }).join('') + '</select></div>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" data-act="save-mkt">Save</button><p class="ad-msg" data-msg="mkt" role="status"></p></div></div></section>';
  }

  /* ----------------------------------------------------------------------------------------------------- the token */
  function drawToken() {
    var t = S.settings.token, w = t.who;
    var state = !t.saved ? 'No token saved.' : (w ? 'Connected as ' + E(w.name) + ' (' + E(w.email) + '), ' + (w.workspaces || []).map(function (x) { return E(x.name); }).join(', ') + '. Tested ' + E(A.ago(w.at)) + '.' : 'A token is saved and has not been tested.');
    return '<section class="ad-card"><h2>Asana</h2><p class="ad-card__meta">' + state + (t.saved && t.by ? ' Saved by ' + E(t.by) + '.' : '') + '</p>' +
      (S.settings.sealing ? '' : '<p class="ad-msg ad-msg--bad">This copy of FavorOS has no key to seal a token with, so it cannot keep one.</p>') +
      '<div class="ap-row"><label class="ap-grow"><span class="ap-lab">Personal access token</span><input class="ad-field" id="ap-token" type="password" autocomplete="off" spellcheck="false" placeholder="' + (t.saved ? 'Saved. Paste a new one to replace it.' : 'Paste the token') + '"></label></div>' +
      '<div class="ad-acts ap-left"><button type="button" class="ad-btn ad-btn--primary" data-act="save-token">Save token</button>' +
      '<button type="button" class="ad-btn" data-act="test"' + (t.saved ? '' : ' disabled') + '>Connect and test</button>' +
      (t.saved ? '<button type="button" class="ad-btn" data-act="remove-token">Remove token</button>' : '') + '<p class="ad-msg" data-msg="token" role="status"></p></div>' +
      '<p class="ad-card__meta">FavorOS only reads from Asana. It never creates, changes or comments on anything there.</p></section>';
  }

  /* ----------------------------------------------------------------------------------------------------- the picker */
  function pickedList() { return Object.keys(S.picked).map(function (k) { return { ref: k, name: S.picked[k] }; }); }
  function pickedKey() { return pickedList().map(function (p) { return p.ref; }).sort().join('|') + '|' + S.source + '|' + S.upload; }

  function drawPicker() {
    var tab = function (id, label) { return '<button type="button" class="ap-tab' + (S.source === id ? ' is-on' : '') + '" data-act="source" data-id="' + id + '" aria-pressed="' + (S.source === id) + '">' + label + '</button>'; };
    var list = S.source === 'api' ? S.asana : S.asana;
    var body;
    if (S.source === 'api') {
      body = '<div class="ad-acts ap-left"><button type="button" class="ad-btn" data-act="load"' + (S.settings.token.saved ? '' : ' disabled') + '>Load projects from Asana</button>' +
        '<label class="ap-check"><input type="checkbox" id="ap-arch"' + (S.archived ? ' checked' : '') + '> Include archived projects</label><p class="ad-msg" data-msg="load" role="status"></p></div>';
    } else {
      body = '<div class="ap-row"><label class="ap-grow"><span class="ap-lab">Asana export file (CSV or JSON)</span><input class="ad-field" id="ap-file" type="file" accept=".csv,.json,text/csv,application/json"></label></div>' +
        '<p class="ad-msg" data-msg="file" role="status">' + (S.exportName ? E(S.exportName) + ' is uploaded.' : '') + '</p>' +
        '<p class="ad-card__meta">An export carries tasks, sections, assignees, dates, tags and custom fields. A CSV export has no comments or files; the API import has both.</p>';
    }
    var rows = list.map(function (p) {
      var on = !!S.picked[p.gid];
      return '<label class="ap-item"><input type="checkbox" data-pick="' + E(p.gid) + '" data-name="' + E(p.name) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="ap-item__main"><b>' + E(p.name) + '</b><span class="mute">' + [p.team, p.owner, p.tasks != null ? num(p.tasks) + ' tasks' : ''].filter(Boolean).map(E).join(', ') + '</span></span>' +
        (p.archived ? '<span class="ad-chip">Archived</span>' : '') + (p.imported ? '<span class="ad-chip ad-chip--admin">Imported before</span>' : '') + '</label>';
    }).join('');
    return '<section class="ad-card"><h2>Import projects</h2><div class="ap-tabs" role="group" aria-label="Where to import from">' + tab('api', 'From Asana') + tab('export', 'From an export file') + '</div>' + body +
      (list.length ? '<div class="ap-list">' + rows + '</div><div class="ad-acts ap-left"><button type="button" class="ad-btn" data-act="all">Select all</button><button type="button" class="ad-btn" data-act="none">Select none</button><span class="ad-card__meta" id="ap-count"></span></div>' : '') +
      '<details class="ap-more"><summary>Options</summary><div class="ad-form">' +
      '<label>Team label on each project<input class="ad-field" id="ap-team" value="' + E(S.opt.team) + '" placeholder="Marketing" maxlength="60"></label>' +
      '<label>Who can see the projects<select class="ad-field" id="ap-vis">' + opt('staff', 'Every staff member', S.opt.visibility) + opt('members', 'Members only', S.opt.visibility) + '</select></label>' +
      '<label class="ad-check"><input type="checkbox" id="ap-copy"' + (S.opt.copyFiles ? ' checked' : '') + '> Copy Asana files into FavorOS</label>' +
      '<label class="ad-check"><input type="checkbox" id="ap-over"' + (S.opt.overwrite ? ' checked' : '') + '> Replace tasks edited in FavorOS since the last import</label>' +
      '<label>Asana address = hub address, one per line<textarea class="ad-field" id="ap-map" rows="3" placeholder="name@gmail.com = name@favorintl.org">' + E(S.opt.map) + '</textarea></label>' +
      '</div></details>' +
      '<div class="ad-acts ap-left"><button type="button" class="ad-btn ad-btn--primary" data-act="dry" id="ap-dry">Dry run</button>' +
      '<button type="button" class="ad-btn ad-btn--warn" data-act="import" id="ap-import">Import</button><p class="ad-msg" data-msg="run" role="status"></p></div>' +
      '<div id="ap-confirm"></div></section>';
  }

  S.opt = { team: '', visibility: 'staff', copyFiles: true, overwrite: false, map: '' };
  function readOpts() {
    var g = function (id) { return root.querySelector('#' + id); };
    if (g('ap-team')) {
      S.opt.team = g('ap-team').value; S.opt.visibility = g('ap-vis').value; S.opt.copyFiles = g('ap-copy').checked; S.opt.overwrite = g('ap-over').checked; S.opt.map = g('ap-map').value;
    }
    var map = {};
    String(S.opt.map || '').split(/\n/).forEach(function (line) {
      var m = line.split(/=|,|\t/).map(function (x) { return x.trim(); });
      if (m.length === 2 && m[0] && m[1]) map[m[0].toLowerCase()] = m[1].toLowerCase();
    });
    return { team: S.opt.team, visibility: S.opt.visibility, copyFiles: S.opt.copyFiles, overwrite: S.opt.overwrite, emailMap: map };
  }

  /* ------------------------------------------------------------------------------------------ progress and report */
  function drawRun() {
    var r = S.run;
    if (!r) return '<section class="ad-card" id="ap-run" hidden></section>';
    var run = r.run, p = r.progress || {};
    var pct = p.total ? Math.min(100, Math.round((p.read / p.total) * 100)) : (run.status === 'done' ? 100 : 0);
    var label = { running: 'Running', waiting: 'Paused by Asana', done: 'Finished', failed: 'Stopped', cancelled: 'Cancelled' }[run.status] || run.status;
    var what = run.mode === 'dry' ? 'Dry run' : 'Import';
    var wait = run.status === 'waiting' && run.resume_at ? ' Carries on at ' + E(A.when(run.resume_at)) + '.' : '';
    return '<section class="ad-card" id="ap-run"><h2>' + what + ': ' + E(label) + '</h2>' +
      '<div class="ad-meter" role="img" aria-label="' + pct + ' percent"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ad-meter__note"><span>' + num(p.read) + ' of about ' + num(p.total) + ' tasks read</span><span>' + num(run.calls) + ' calls to Asana</span></div>' +
      (run.error ? '<p class="ad-msg ad-msg--bad">' + E(run.error) + '</p>' : '') + (wait ? '<p class="ad-card__meta">' + wait + '</p>' : '') +
      ((run.status === 'running' || run.status === 'waiting') ? '<div class="ad-acts ap-left"><button type="button" class="ad-btn" data-act="cancel">Cancel</button>' + (S.loop ? '' : '<button type="button" class="ad-btn ad-btn--primary" data-act="continue">Continue</button>') + '</div>' : '') +
      drawReport(r.report, run) + '<h3 class="ap-h3">Log</h3><ol class="ap-log" id="ap-log" aria-label="Run log">' + (S.logHtml || '') + '</ol></section>';
  }

  function drawReport(rep, run) {
    if (!rep) return '';
    var ps = Object.keys(rep.projects).map(function (k) { return rep.projects[k]; });
    if (!ps.length) return '';
    var un = Object.keys(rep.people.unmatched).map(function (k) { return rep.people.unmatched[k]; });
    var dry = run.mode === 'dry';
    var cells = function (p) {
      var t = p.tasks;
      return '<td>' + E(p.name) + (p.key ? '<br><span class="mute">' + E(p.key) + '</span>' : '') + '</td><td class="num">' + num(t.create) + '</td><td class="num">' + num(t.update) + '</td><td class="num">' + num(t.same + t.kept) + '</td><td class="num">' + num(t.subtasks) + '</td>' +
        '<td class="num">' + num(p.sections.create + p.sections.update + p.sections.same) + '</td><td class="num">' + num(p.comments.create + p.comments.update + p.comments.same) + '</td><td class="num">' + num(p.files.copy + p.files.link + p.files.same) + '</td>' +
        '<td class="num">' + (p.expected != null ? num(p.expected) : '') + (!dry && p.hubCount != null ? ' / ' + num(p.hubCount) : '') + '</td>';
    };
    var html = '<h3 class="ap-h3">' + (dry ? 'What an import would do' : 'What the import did') + '</h3><div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>Project</th><th class="num">' + (dry ? 'New' : 'Made') + '</th><th class="num">Updated</th><th class="num">Unchanged</th><th class="num">Subtasks</th><th class="num">Sections</th><th class="num">Comments</th><th class="num">Files</th><th class="num">' + (dry ? 'Asana says' : 'Asana says / hub has') + '</th></tr></thead><tbody>' + ps.map(function (p) { return '<tr>' + cells(p) + '</tr>'; }).join('') + '</tbody></table></div>';
    var tot = ps.reduce(function (o, p) { o.kept += p.tasks.kept; o.also += p.tasks.alsoIn; o.err += p.tasks.errors; o.tags += p.tags; o.fields += p.fields; o.deps += p.deps; return o; }, { kept: 0, also: 0, err: 0, tags: 0, fields: 0, deps: 0 });
    html += '<p class="ad-card__meta">Tags ' + num(tot.tags) + ', custom fields ' + num(tot.fields) + ', dependencies seen ' + num(tot.deps) + (rep.deps.linked ? ', linked ' + num(rep.deps.linked) : '') + (rep.deps.cycles ? ', skipped as loops ' + num(rep.deps.cycles) : '') + (rep.deps.outside ? ', pointing outside the import ' + num(rep.deps.outside) : '') +
      (tot.kept ? '. ' + num(tot.kept) + ' tasks kept because they were edited in FavorOS' : '') + (tot.also ? '. ' + num(tot.also) + ' tasks sit in more than one Asana project and were made once' : '') + (tot.err ? '. ' + num(tot.err) + ' tasks could not be read (see the log)' : '') + '.</p>';
    html += '<h3 class="ap-h3">People not matched (' + un.length + ')</h3>';
    html += un.length ? '<div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>Person in Asana</th><th>Why</th><th class="num">Tasks</th><th class="num">Comments</th></tr></thead><tbody>' + un.map(function (u) {
      return '<tr><td>' + E(u.name || u.email) + (u.name && u.email ? '<br><span class="mute">' + E(u.email) + '</span>' : '') + '</td><td>' + E(u.reason) + '</td><td class="num">' + num(u.assigned + u.asked) + '</td><td class="num">' + num(u.comments) + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="ad-card__meta">Their tasks come in unassigned with their name in the description. Their comments keep their name in the words.</p>' : '<p class="ad-empty">Everyone matched a hub person.</p>';
    var fp = rep.files.problems;
    html += '<h3 class="ap-h3">Files not copied (' + fp.length + ')</h3>';
    html += fp.length ? '<div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>File</th><th>Task</th><th>Why</th></tr></thead><tbody>' + fp.map(function (f) {
      return '<tr><td>' + E(f.name) + (f.size ? '<br><span class="mute">' + num(Math.round(f.size / 1024)) + ' KB</span>' : '') + '</td><td>' + E(f.task) + '</td><td>' + E(f.reason) + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="ad-card__meta">These stay as links to Asana. They stop working when the Asana workspace closes, so download them first.</p>' : '<p class="ad-empty">Every file was copied or is a link to another service.</p>';
    if (rep.warnings && rep.warnings.length) html += '<ul class="ad-list">' + rep.warnings.slice(0, 20).map(function (w) { return '<li>' + E(w) + '</li>'; }).join('') + '</ul>';
    return html;
  }

  function addLog(lines) {
    var ol = root.querySelector('#ap-log');
    lines.forEach(function (l) {
      S.logAfter = Math.max(S.logAfter, l.id);
      var li = '<li class="ap-log--' + E(l.level) + '"><span class="mute">' + E(A.when(l.at)) + '</span> ' + E(l.text) + '</li>';
      S.logHtml = (S.logHtml || '') + li;
      if (ol) ol.insertAdjacentHTML('beforeend', li);
    });
    if (ol) ol.scrollTop = ol.scrollHeight;
  }

  function refreshRun(view) {
    S.run = view;
    var el = root.querySelector('#ap-run');
    var t = document.createElement('div');
    t.innerHTML = drawRun();
    var fresh = t.firstChild;
    if (el) el.replaceWith(fresh); else root.querySelector('#ap-slot-run').appendChild(fresh);
    var ol = root.querySelector('#ap-log');
    if (ol) { ol.innerHTML = S.logHtml || ''; ol.scrollTop = ol.scrollHeight; }
    fresh.hidden = false;
    updateButtons();
  }

  function updateButtons() {
    var n = pickedList().length;
    var cnt = root.querySelector('#ap-count');
    if (cnt) cnt.textContent = n + ' selected';
    var live = S.run && (S.run.run.status === 'running' || S.run.run.status === 'waiting');
    var dry = root.querySelector('#ap-dry'), imp = root.querySelector('#ap-import');
    if (dry) dry.disabled = !n || !!live;
    if (imp) {
      var ok = S.lastDry && S.lastDry.key === pickedKey() && !live;
      imp.disabled = !ok;
      imp.title = ok ? '' : 'Run a dry run on these projects first';
    }
  }

  /* ----------------------------------------------------------------------------------------------- hub projects */
  function drawHub() {
    var q = (S.q || '').toLowerCase();
    var list = S.projects.filter(function (p) { return !q || (p.name + ' ' + p.key + ' ' + p.team).toLowerCase().indexOf(q) >= 0; });
    return '<section class="ad-card"><h2>Projects in FavorOS</h2><div class="ap-row"><label class="ap-grow"><span class="ap-lab">Find</span><input class="ad-field ad-find" id="ap-find" type="search" value="' + E(S.q || '') + '" placeholder="Name, key or team"></label></div>' +
      (list.length ? '<div class="ap-list">' + list.map(function (p) {
        return '<div class="ap-item ap-item--hub"><span class="ap-item__main"><b>' + E(p.name) + '</b><span class="mute">' + E(p.key) + (p.team ? ', ' + E(p.team) : '') + ', lead ' + E(p.lead_email) + ', ' + num(p.open) + ' open, ' + num(p.done) + ' done</span></span>' +
          (p.from_asana ? '<span class="ad-chip">From Asana</span>' : '') + (p.status !== 'active' ? '<span class="ad-chip">' + E(p.status) + '</span>' : '') +
          '<button type="button" class="ad-btn" data-act="' + (p.status === 'archived' ? 'restore' : 'archive') + '" data-id="' + E(p.id) + '">' + (p.status === 'archived' ? 'Restore' : 'Archive') + '</button></div>';
      }).join('') + '</div>' : '<p class="ad-empty">' + (S.projects.length ? 'No project matches.' : 'No projects yet.') + '</p>') + '<p class="ad-msg" data-msg="hub" role="status"></p></section>';
  }

  function drawRuns() {
    if (!S.runs.length) return '';
    return '<section class="ad-card"><h2>Recent runs</h2><div class="ad-scroll"><table class="ad-table ap-table"><thead><tr><th>When</th><th>Kind</th><th>Projects</th><th>Status</th><th class="num">Calls</th><th></th></tr></thead><tbody>' + S.runs.map(function (r) {
      return '<tr><td class="ad-nw">' + E(A.full(r.created_at)) + '</td><td>' + (r.mode === 'dry' ? 'Dry run' : 'Import') + '</td><td>' + E(r.selection.join(', ')) + '</td><td>' + E(r.status) + '</td><td class="num">' + num(r.calls) + '</td><td><button type="button" class="ad-btn" data-act="open-run" data-id="' + E(r.id) + '">Open</button></td></tr>';
    }).join('') + '</tbody></table></div></section>';
  }

  function draw() {
    root.innerHTML = drawAccess() + drawToken() + drawPicker() + '<div id="ap-slot-run"></div>' + drawHub() + '<div id="ap-slot-runs">' + drawRuns() + '</div>';
    root.removeAttribute('aria-busy');
    if (S.run) refreshRun(S.run);
    updateButtons();
  }

  /* --------------------------------------------------------------------------------------------------- the run loop */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function loop() {
    if (S.loop) return;
    S.loop = 1;
    (function tick() {
      var r = S.run && S.run.run;
      if (!r || (r.status !== 'running' && r.status !== 'waiting')) { S.loop = 0; finished(); return; }
      var wait = 0;
      if (r.status === 'waiting' && r.resume_at) wait = Math.max(0, Date.parse(r.resume_at) - Date.now()) + 300;
      sleep(Math.min(wait, 60000)).then(function () {
        if (!S.loop) return;
        return api('/runs/' + r.id + '/step', { after: S.logAfter }).then(function (v) { addLog(v.log); refreshRun(v); tick(); });
      }).catch(function (e) { S.loop = 0; msg('run', e.message, true); refreshRun(S.run); });
    })();
  }

  function finished() {
    var r = S.run && S.run.run;
    if (!r) return;
    if (r.mode === 'dry' && r.status === 'done') S.lastDry = { id: r.id, key: pickedKey() };
    updateButtons();
    api('').then(function (d) { S.projects = d.projects; S.runs = d.runs; var h = root.querySelector('#ap-slot-runs'); if (h) h.innerHTML = drawRuns(); }).catch(function () {});
  }

  function start(body) {
    S.logHtml = ''; S.logAfter = 0;
    msg('run', 'Starting');
    return api('/runs', body).then(function (v) { msg('run', ''); addLog(v.log); refreshRun(v); loop(); }).catch(function (e) { msg('run', e.message, true); });
  }

  function runBody(mode) {
    var b = { source: S.source, mode: mode, projects: pickedList(), options: readOpts() };
    if (S.source === 'export') b.upload = S.upload;
    return b;
  }

  /* ------------------------------------------------------------------------------------------------------ events */
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'save-enabled') {
      msg('enabled', 'Saving');
      api('/settings', { enabled: root.querySelector('#ap-enabled').value }).then(function (d) { S.settings = d.settings; msg('enabled', 'Saved'); }).catch(function (x) { msg('enabled', x.message, true); });
    } else if (act === 'save-mkt') {
      msg('mkt', 'Saving');
      api('/settings', { marketing_project: root.querySelector('#ap-mkt').value }).then(function (d) { S.settings = d.settings; msg('mkt', 'Saved'); }).catch(function (x) { msg('mkt', x.message, true); });
    } else if (act === 'save-token') {
      var inp = root.querySelector('#ap-token');
      msg('token', 'Saving');
      api('/token', { token: inp.value }).then(function (d) { S.settings = d.settings; inp.value = ''; return api('/test', {}); }).then(function (d) { S.settings = d.settings; draw(); msg('token', 'Saved. Connected as ' + d.who.name + '.'); })
        .catch(function (x) { msg('token', x.message, true); });
    } else if (act === 'test') {
      msg('token', 'Testing');
      api('/test', {}).then(function (d) { S.settings = d.settings; draw(); msg('token', 'Connected as ' + d.who.name + '.'); }).catch(function (x) { msg('token', x.message, true); });
    } else if (act === 'remove-token') {
      api('/token', { remove: true }).then(function (d) { S.settings = d.settings; S.asana = []; draw(); }).catch(function (x) { msg('token', x.message, true); });
    } else if (act === 'source') {
      readOpts(); S.source = b.dataset.id; S.asana = []; S.picked = {}; S.upload = ''; S.exportName = ''; draw();
    } else if (act === 'load') {
      readOpts(); S.archived = root.querySelector('#ap-arch').checked;
      msg('load', 'Loading');
      api('/asana?archived=' + (S.archived ? '1' : '0')).then(function (d) { S.asana = d.projects; S.picked = {}; draw(); }).catch(function (x) { msg('load', x.message, true); });
    } else if (act === 'all' || act === 'none') {
      S.picked = {};
      if (act === 'all') S.asana.forEach(function (p) { S.picked[p.gid] = p.name; });
      root.querySelectorAll('[data-pick]').forEach(function (c) { c.checked = act === 'all'; });
      updateButtons();
    } else if (act === 'dry') {
      start(runBody('dry'));
    } else if (act === 'import') {
      var box = root.querySelector('#ap-confirm');
      var rep = S.run && S.run.report;
      var tasks = rep ? Object.keys(rep.projects).reduce(function (n, k) { var t = rep.projects[k].tasks; return n + t.create + t.update; }, 0) : 0;
      box.innerHTML = '<div class="ad-confirm"><p>Import ' + pickedList().length + ' project' + (pickedList().length === 1 ? '' : 's') + ' into FavorOS? The dry run found ' + num(tasks) + ' tasks to make or update. Nobody is notified. Running it again later updates and never duplicates.</p><div class="ad-acts" style="justify-content:flex-start"><button type="button" class="ad-btn ad-btn--primary" data-act="import-yes">Yes, import</button><button type="button" class="ad-btn" data-act="import-no">Not yet</button></div></div>';
      box.querySelector('[data-act="import-yes"]').focus();
    } else if (act === 'import-no') {
      root.querySelector('#ap-confirm').innerHTML = '';
    } else if (act === 'import-yes') {
      root.querySelector('#ap-confirm').innerHTML = '';
      var body = runBody('import'); body.confirm = true; body.from_dry_run = S.lastDry && S.lastDry.id;
      start(body);
    } else if (act === 'cancel') {
      S.loop = 0;
      api('/runs/' + S.run.run.id + '/cancel', { after: S.logAfter }).then(function (v) { addLog(v.log); refreshRun(v); finished(); }).catch(function (x) { msg('run', x.message, true); });
    } else if (act === 'continue') {
      loop();
    } else if (act === 'archive' || act === 'restore') {
      api('/hub/' + b.dataset.id, { action: act }).then(function () { return api(''); }).then(function (d) { S.projects = d.projects; S.settings = d.settings; var q = S.q; draw(); S.q = q; }).catch(function (x) { msg('hub', x.message, true); });
    } else if (act === 'open-run') {
      S.logHtml = ''; S.logAfter = 0;
      api('/runs/' + b.dataset.id).then(function (v) { addLog(v.log); refreshRun(v); if (v.run.status === 'running' || v.run.status === 'waiting') loop(); root.querySelector('#ap-run').scrollIntoView({ block: 'start' }); }).catch(function (x) { msg('hub', x.message, true); });
    }
  });

  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.pick) {
      if (t.checked) S.picked[t.dataset.pick] = t.dataset.name; else delete S.picked[t.dataset.pick];
      updateButtons();
    } else if (t.id === 'ap-file' && t.files && t.files[0]) {
      var f = t.files[0];
      msg('file', 'Reading ' + f.name);
      f.text().then(function (text) { return api('/export', { name: f.name, text: text }); }).then(function (d) {
        S.upload = d.upload; S.exportName = f.name; S.picked = {};
        S.asana = d.projects.map(function (p) { return { gid: p.ref, name: p.name, archived: p.archived, tasks: p.tasks, team: '', owner: '' }; });
        d.projects.forEach(function (p) { S.picked[p.ref] = p.name; });
        draw();
      }).catch(function (x) { msg('file', x.message, true); });
    }
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'ap-find') {
      S.q = e.target.value;
      var sec = e.target.closest('section');
      var pos = e.target.selectionStart;
      var t = document.createElement('div');
      t.innerHTML = drawHub();
      sec.replaceWith(t.firstChild);
      var again = root.querySelector('#ap-find');
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  });

  /* ------------------------------------------------------------------------------------------------------- start */
  api('').then(function (d) {
    S.settings = d.settings; S.projects = d.projects; S.runs = d.runs;
    draw();
    var live = d.runs.filter(function (r) { return r.status === 'running' || r.status === 'waiting'; })[0];
    if (live) api('/runs/' + live.id).then(function (v) { addLog(v.log); refreshRun(v); loop(); });
  }).catch(function (e) { A.fail(document.getElementById('ad-root'), e); });
})();
