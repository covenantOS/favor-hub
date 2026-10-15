/* Evaluation terms: open a term, who is behind, supervisors by drop-down, the folder signed documents go to. */
(function () {
  'use strict';
  var root = document.getElementById('eva-root');
  if (!root) return;
  var S = { terms: null, folder: '', pick: null, term: null, detail: null, staff: [], sel: {}, q: '', setup: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } };
    if (body !== undefined) o.body = JSON.stringify(body);
    return fetch('/api/evaluations/' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) throw new Error(d.message || 'That did not work. Try again.'); return d; });
    });
  }
  function dateWord(d) { return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''; }
  function toast(msg, bad) {
    if (window.hubToast) { window.hubToast(msg, { tone: bad ? 'bad' : '' }); return; }
    var t = document.getElementById('ev-toast'); if (!t) return;
    t.textContent = msg; t.className = 'ev-toast is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'ev-toast'; }, bad ? 6000 : 2800);
  }
  function qs() { return new URLSearchParams(location.search).get('t') || ''; }
  function go(t) { history.pushState(null, '', location.pathname + (t ? '?t=' + encodeURIComponent(t) : '')); route(); window.scrollTo(0, 0); }

  function group(p) {
    var m = Number((p.startDate || '').slice(5, 7));
    return !m ? 'unknown' : m <= 6 ? 'first' : 'second';
  }
  var GROUPS = [['first', 'Started January to June'], ['second', 'Started July to December'], ['unknown', 'No start date recorded']];

  function gapHtml() {
    var g = S.gaps;
    if (!g || !g.missing.length) return '';
    var names = g.missing.slice(0, 6).map(function (p) { return esc(p.name); }).join(', ');
    return '<section class="ev-gap" role="alert"><b>' + g.missing.length + ' of ' + g.total + ' people have no supervisor set</b><span>' + names + (g.missing.length > 6 ? ' and ' + (g.missing.length - 6) + ' more' : '') + '</span><a class="h-btn h-btn--primary h-btn--sm" href="/admin/people/?filter=nosup">Set Reports to</a></section>';
  }

  function termsHtml() {
    var h = '<header class="ev-head"><div><p class="ev-kicker">Evaluations</p><h1>Terms</h1></div><div class="ev-acts" style="margin:0"><a class="h-btn h-btn--ghost" href="/evaluations/">My evaluations</a><button type="button" class="h-btn h-btn--primary" id="eva-new">Open a term</button></div></header>';
    h += gapHtml();
    if (S.setup) h += setupHtml();
    if (!S.terms.length && !S.setup) h += '<section class="ev-empty"><h2>No term yet</h2><p>A term is one semiannual round. Pick the people, set the date week 1 starts, and everyone is asked to complete their self-assessment. People who started January to June go first.</p><p><button type="button" class="h-btn h-btn--primary" id="eva-new2">Open the first term</button></p></section>';
    if (S.terms.length) {
      h += '<ul class="ev-list">' + S.terms.map(function (t) {
        return '<li class="ev-row"><div class="ev-row__main"><b>' + esc(t.name) + '</b><span class="ev-sub">Week 1 starts ' + esc(dateWord(t.startsOn)) + ' · ' + t.people + ' ' + (t.people === 1 ? 'person' : 'people') + ' · ' + t.done + ' done</span></div><span class="ev-chip ' + (t.status === 'open' ? '' : 'ev-chip--quiet') + '">' + (t.status === 'open' ? 'Open' : 'Closed') + '</span><a class="h-btn h-btn--ghost h-btn--sm" href="?t=' + esc(t.id) + '" data-term="' + esc(t.id) + '">Open</a></li>';
      }).join('') + '</ul>';
    }
    h += '<section class="ev-panel" style="margin-top:18px"><h2>Where signed evaluations are filed</h2><p class="ev-sub">A folder for each employee is made inside it, holding the Google Doc and the PDF. Use the Operations, US Talent folder in the US Executive Drive. FavorOS signs in as the Favor service account, so that account needs Contributor access to the folder.</p>' +
      '<label class="ev-field"><span>Folder link or id</span><input id="eva-folder" value="' + esc(S.folder) + '" placeholder="https://drive.google.com/drive/folders/..." autocomplete="off"></label><div class="ev-acts"><button type="button" class="h-btn h-btn--ghost" id="eva-savefolder">Save the folder</button><span class="ev-sub">' + (S.folder ? 'Set.' : 'Not named yet. Signed evaluations still download as a PDF.') + '</span></div></section>';
    h += '<section class="ev-panel"><h2>Reminders</h2><p class="ev-sub">Reminders go out two days before each due date and the day after, once each, to the person who owes the step. They follow the same switch as every other notice.</p><div class="ev-acts"><button type="button" class="h-btn h-btn--ghost" id="eva-nudge">Send today\'s reminders now</button></div></section>';
    return h;
  }

  function setupHtml() {
    var P = S.pick || [], q = S.q.trim().toLowerCase();
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    var h = '<section class="ev-panel"><h2>Open a term</h2><div class="ev-two"><label class="ev-field"><span>Week 1 starts</span><input type="date" id="eva-start" value="' + esc(S.start || today) + '"></label><label class="ev-field"><span>Term name</span><input id="eva-name" maxlength="80" value="' + esc(S.name || '') + '" placeholder="January to June 2027 evaluations"></label></div>' +
      '<p class="ev-sub">Week 1: self-assessment and naming reviewers. Week 2: feedback and the supervisor\'s review. Week 3: the meeting, acknowledgment and HR\'s signature.</p>' +
      '<label class="ev-field"><span>Find a person</span><input type="search" id="eva-q" value="' + esc(S.q) + '" placeholder="Name or team" autocomplete="off"></label>';
    var groups = GROUPS.map(function (g) {
      var list = P.filter(function (p) { return group(p) === g[0] && (!q || (p.name + ' ' + p.team).toLowerCase().indexOf(q) >= 0); });
      if (!list.length) return '';
      var all = list.every(function (p) { return S.sel[p.email]; });
      return '<div class="ev-pg"><span>' + g[1] + ' (' + list.length + ')</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-all="' + g[0] + '">' + (all ? 'Clear these' : 'Pick all') + '</button></div>' + list.map(function (p) {
        return '<label class="ev-pp' + (p.open ? ' is-off' : '') + '"><input type="checkbox" data-pick="' + esc(p.email) + '"' + (S.sel[p.email] ? ' checked' : '') + (p.open ? ' disabled' : '') + '><span class="ev-pp__t"><b>' + esc(p.name) + '</b><span>' + esc([p.title, p.team].filter(Boolean).join(' · ')) + (p.startDate ? ' · Started ' + esc(dateWord(p.startDate)) : '') + (p.hasSupervisor ? '' : ' · No supervisor set') + (p.open ? ' · Evaluation already open' : '') + '</span></span></label>';
      }).join('');
    }).join('');
    var n = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).length;
    var nosup = P.filter(function (p) { return S.sel[p.email] && !p.hasSupervisor; }).length;
    h += '<div class="ev-people">' + (groups || '<p class="ev-sub" style="padding:14px">Nobody matches.</p>') + '</div>';
    if (nosup) h += '<p class="ev-warn">' + nosup + ' picked ' + (nosup === 1 ? 'person has' : 'people have') + ' no supervisor. Set Reports to under Admin, People and roles first, or choose one by drop-down after the term opens.</p>';
    h += '<div class="ev-acts"><button type="button" class="h-btn h-btn--primary" id="eva-open"' + (n ? '' : ' disabled') + '>Open the term for ' + n + ' ' + (n === 1 ? 'person' : 'people') + '</button><button type="button" class="h-btn h-btn--ghost" id="eva-cancel">Cancel</button></div></section>';
    return h;
  }

  function termHtml() {
    var d = S.detail, t = d.term, h = '<a class="ev-back" href="?" data-term="">All terms</a><header class="ev-head"><div><p class="ev-kicker">' + esc(t.periodLabel) + '</p><h1>' + esc(t.name) + '</h1><p class="ev-sub">Week 1 starts ' + esc(dateWord(t.startsOn)) + '</p></div>' + (t.status === 'open' ? '<button type="button" class="h-btn h-btn--ghost" id="eva-close">Close the term</button>' : '<span class="ev-chip ev-chip--quiet">Closed</span>') + '</header>';
    var behind = [];
    d.cases.forEach(function (c) { c.behind.forEach(function (b) { behind.push(b); }); });
    h += '<section class="ev-panel"><h2>Who is behind</h2>' + (behind.length ? '<ul class="ev-behind">' + behind.map(function (b) { return '<li><b>' + esc(b.who) + '</b><span>' + esc(b.what) + (b.due ? ' <span class="ev-sub">due ' + esc(dateWord(b.due)) + '</span>' : '') + '</span></li>'; }).join('') + '</ul>' : '<p class="ev-sub">Nobody is past a due date.</p>') + '</section>';
    h += '<section class="ev-panel ev-cases"><h2>Everyone in this term</h2><table><thead><tr><th>Employee</th><th>Supervisor</th><th>Where</th><th>Self</th><th>Feedback</th><th>Summary</th><th>Signed</th><th></th></tr></thead><tbody>' + d.cases.map(function (c) {
      var opts = '<option value="">Not assigned</option>' + S.staff.filter(function (p) { return p.email !== c.employee.email; }).map(function (p) { return '<option value="' + esc(p.email) + '"' + (p.email === c.supervisor.email ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
      return '<tr><td data-l="Employee"><b>' + esc(c.employee.name) + '</b></td><td data-l="Supervisor"><select data-sup="' + esc(c.id) + '" aria-label="Supervisor for ' + esc(c.employee.name) + '"' + (t.status === 'open' ? '' : ' disabled') + '>' + opts + '</select></td><td data-l="Where">' + esc(c.stageWord) + '</td><td data-l="Self">' + (c.self ? '<span class="ev-ok">&#10003;</span>' : '<span class="ev-no">&ndash;</span>') + '</td><td data-l="Feedback">' + c.reviewersDone + ' of ' + c.reviewers + '</td><td data-l="Summary">' + (c.summary ? '<span class="ev-ok">&#10003;</span>' : '<span class="ev-no">&ndash;</span>') + '</td><td data-l="Signed">' + (c.signed ? '<span class="ev-ok">&#10003;</span>' : '<span class="ev-no">&ndash;</span>') + '</td><td><a class="h-btn h-btn--ghost h-btn--sm" href="/evaluations/?c=' + esc(c.id) + '">Open</a></td></tr>';
    }).join('') + '</tbody></table></section>';
    h += '<section class="ev-panel"><h2>Reviewers</h2><p class="ev-sub">Open a person\'s evaluation, then Reviewers, to set a reviewer aside or add one. Employees choose their own 3 to 5 reviewers in week 1. The supervisor and HR can change them.</p></section>';
    return h;
  }

  function render() {
    var id = qs();
    root.innerHTML = id ? (S.detail ? termHtml() : '<p class="ev-loading">Opening</p>') : (S.terms ? termsHtml() : '');
    root.hidden = false;
    var ld = document.getElementById('ev-loading'); if (ld) ld.remove();
  }

  function route() {
    var id = qs();
    if (!id) { S.detail = null; return Promise.all([api('GET', 'admin/terms'), api('GET', 'admin/gaps').catch(function () { return null; })]).then(function (r) { S.terms = r[0].terms; S.folder = r[0].folder; S.gaps = r[1]; render(); }).catch(fail); }
    S.detail = null; render();
    return Promise.all([api('GET', 'admin/term/' + id), S.staff.length ? null : api('GET', 'people')]).then(function (r) { S.detail = r[0]; if (r[1]) S.staff = r[1].people; render(); }).catch(fail);
  }
  function fail(e) { root.hidden = false; var ld = document.getElementById('ev-loading'); if (ld) ld.remove(); root.innerHTML = '<section class="ev-empty"><h2>This did not open</h2><p>' + esc(e.message) + '</p><p><a href="/evaluations/">Back to Evaluations</a></p></section>'; }

  function openSetup() {
    S.setup = true; S.sel = {};
    (S.pick ? Promise.resolve() : api('GET', 'admin/pick').then(function (d) { S.pick = d.people; })).then(function () {
      // The first group (January to June starters) is picked to start with, the way Rachel described the first term.
      S.pick.forEach(function (p) { if (group(p) === 'first' && !p.open) S.sel[p.email] = true; });
      render();
    }).catch(function (e) { toast(e.message, true); });
  }

  root.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-term]');
    if (a) { e.preventDefault(); go(a.dataset.term); return; }
    var b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'eva-new' || b.id === 'eva-new2') return openSetup();
    if (b.id === 'eva-cancel') { S.setup = false; render(); return; }
    if (b.dataset.all) { var g = b.dataset.all, list = S.pick.filter(function (p) { return group(p) === g && !p.open; }), all = list.every(function (p) { return S.sel[p.email]; }); list.forEach(function (p) { S.sel[p.email] = !all; }); render(); return; }
    if (b.id === 'eva-open') {
      b.disabled = true;
      var emails = Object.keys(S.sel).filter(function (k) { return S.sel[k]; });
      api('POST', 'admin/terms', { startsOn: document.getElementById('eva-start').value, name: document.getElementById('eva-name').value, emails: emails }).then(function (d) {
        var msg = 'Opened for ' + d.opened + ' ' + (d.opened === 1 ? 'person' : 'people') + '.' + (d.noSupervisor.length ? ' ' + d.noSupervisor.length + ' have no supervisor yet.' : '');
        toast(msg); S.setup = false; S.pick = null; S.sel = {}; go(d.termId);
      }).catch(function (er) { b.disabled = false; toast(er.message, true); });
      return;
    }
    if (b.id === 'eva-savefolder') { api('PUT', 'admin/folder', { folder: document.getElementById('eva-folder').value }).then(function (d) { S.folder = d.folder; toast(d.folder ? 'Folder saved.' : 'Folder cleared.'); render(); }).catch(function (er) { toast(er.message, true); }); return; }
    if (b.id === 'eva-nudge') { b.disabled = true; api('POST', 'admin/nudge', {}).then(function (d) { toast(d.sent + ' reminder' + (d.sent === 1 ? '' : 's') + ' sent.'); b.disabled = false; }).catch(function (er) { b.disabled = false; toast(er.message, true); }); return; }
    if (b.id === 'eva-close') { if (!window.confirm('Close this term? Nobody can change answers after it closes.')) return; api('POST', 'admin/term/' + S.detail.term.id + '/close', {}).then(function () { toast('Closed.'); return route(); }).catch(function (er) { toast(er.message, true); }); }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.pick) { S.sel[t.dataset.pick] = t.checked; var o = document.getElementById('eva-open'); render(); return; }
    if (t.dataset.sup) { api('POST', 'case/' + t.dataset.sup + '/supervisor', { email: t.value }).then(function () { toast('Supervisor saved.'); return route(); }).catch(function (er) { toast(er.message, true); route(); }); }
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'eva-q') { S.q = e.target.value; S.start = document.getElementById('eva-start').value; S.name = document.getElementById('eva-name').value; var pos = e.target.selectionStart; render(); var f = document.getElementById('eva-q'); if (f) { f.focus(); f.setSelectionRange(pos, pos); } }
  });
  window.addEventListener('popstate', route);
  route();
})();
