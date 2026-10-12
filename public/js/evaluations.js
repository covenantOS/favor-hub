/* Evaluations: my evaluation, the feedback I owe, my team. One page, three views (home, a case, a form). */
(function () {
  'use strict';
  var root = document.getElementById('ev-root');
  if (!root) return;

  var S = { forms: null, mine: null, view: null, staff: null, courses: null, tab: '', sec: 0, saving: '', pick: [], reviewerQ: '' };
  var Q = {}; // unsaved answers for the form being written: qid -> answer
  var saveTimer = 0;
  var inflight = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function api(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch('/api/evaluations/' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) { var e = new Error(d.message || d.error || 'That did not work. Try again.'); e.code = d.error || ''; throw e; }
        return d;
      });
    });
  }
  function dateWord(d, long) {
    if (!d) return '';
    var x = new Date(String(d).slice(0, 10) + 'T12:00:00Z');
    return x.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: long ? 'long' : undefined });
  }
  function qs() { var p = new URLSearchParams(location.search); return { c: p.get('c') || '', v: p.get('v') || '', s: Number(p.get('s')) || 0 }; }
  function go(params, replace) {
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k]) p.set(k, params[k]); });
    var url = location.pathname + (p.toString() ? '?' + p.toString() : '');
    (replace ? history.replaceState : history.pushState).call(history, null, '', url);
    route();
  }
  function toast(msg, bad) {
    var t = document.getElementById('ev-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'ev-toast is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = 'ev-toast'; }, bad ? 6000 : 2800);
  }

  /* ------------------------------------------------------------------------------------------------ forms logic */

  function questions(form) { var out = []; form.sections.forEach(function (s) { s.questions.forEach(function (q) { out.push(q); }); }); return out; }
  function byId(list) { var m = {}; (list || []).forEach(function (a) { m[a.qid] = a; }); return m; }
  function merged(saved) { // saved answers with unsaved edits on top
    var m = byId(saved);
    Object.keys(Q).forEach(function (k) { m[k] = Q[k]; });
    return m;
  }
  function has(a, q) { return q.kind === 'rating' ? (a && a.rating !== null && a.rating !== undefined) : !!(a && String(a.text || '').trim()); }
  function secProgress(sec, m) {
    var done = 0, total = 0;
    sec.questions.forEach(function (q) {
      if (q.kind === 'auto') return;
      var req = q.kind === 'rating' || q.kind === 'choice' || q.req;
      var a = m[q.id];
      if (req) { total++; if (has(a, q) && !((q.kind === 'rating') && (a.rating === 1 || a.rating === 2) && !String(a.example || '').trim())) done++; }
    });
    return { done: done, total: total };
  }
  function gaps(form, m) {
    var g = [];
    form.sections.forEach(function (sec, si) {
      sec.questions.forEach(function (q) {
        if (q.kind === 'auto') return;
        var a = m[q.id];
        if (q.kind === 'rating') {
          if (!has(a, q)) g.push({ si: si, q: q, why: 'Rate this' });
          else if ((a.rating === 1 || a.rating === 2) && !String(a.example || '').trim()) g.push({ si: si, q: q, why: 'Add an example' });
        } else if (q.kind === 'choice') { if (!has(a, q)) g.push({ si: si, q: q, why: 'Choose one' }); }
        else if (q.req && !has(a, q)) g.push({ si: si, q: q, why: 'Answer this' });
      });
    });
    return g;
  }
  function totals(form, m) {
    var done = 0, total = 0;
    form.sections.forEach(function (s) { var p = secProgress(s, m); done += p.done; total += p.total; });
    return { done: done, total: total };
  }

  /* ---------------------------------------------------------------------------------------------------- saving */

  function setSave(msg) { S.saving = msg; var el = document.getElementById('ev-save'); if (el) el.textContent = msg; }
  function queue(formId, ans) {
    Q[ans.qid] = ans;
    setSave('Saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { flush(formId); }, 700);
  }
  function flush(formId) {
    if (inflight) { saveTimer = setTimeout(function () { flush(formId); }, 400); return Promise.resolve(); }
    var keys = Object.keys(Q);
    if (!keys.length) return Promise.resolve();
    var batch = keys.map(function (k) { return Q[k]; });
    var snap = {}; keys.forEach(function (k) { snap[k] = JSON.stringify(Q[k]); });
    inflight = true;
    var body = { form: formId, answers: batch };
    return api('PUT', 'case/' + S.view.case.id + '/answers', body).then(function () {
      inflight = false;
      var src = formId === 'A' ? S.view.self : formId === 'B' ? S.view.mineB : S.view.summary;
      var m = byId(src.answers);
      keys.forEach(function (k) { if (JSON.stringify(Q[k]) === snap[k]) { m[k] = Q[k]; delete Q[k]; } });
      src.answers = Object.keys(m).map(function (k) { return m[k]; });
      setSave('Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      if (Object.keys(Q).length) { saveTimer = setTimeout(function () { flush(formId); }, 300); }
    }).catch(function (e) {
      inflight = false;
      setSave('Not saved. ' + e.message);
      saveTimer = setTimeout(function () { flush(formId); }, 5000);
    });
  }
  window.addEventListener('beforeunload', function (e) { if (Object.keys(Q).length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------------------------------------------------------------------------------------------- home */

  function stepper(stage, due) {
    var cur = stage === 'self' ? 1 : (stage === 'feedback' || stage === 'summary') ? 2 : 3;
    var done = stage === 'signed' || stage === 'done';
    var steps = [['Week 1', 'Self-assessment and reviewers', due.w1], ['Week 2', 'Feedback and review', due.w2], ['Week 3', 'Meeting and sign-off', due.w3]];
    return '<ol class="ev-steps" aria-label="Where this evaluation is">' + steps.map(function (s, i) {
      var st = done || i + 1 < cur ? 'is-done' : i + 1 === cur ? 'is-now' : '';
      return '<li class="' + st + '"><span class="ev-steps__n">' + (st === 'is-done' ? '&#10003;' : i + 1) + '</span><span class="ev-steps__t"><b>' + s[0] + '</b>' + esc(s[1]) + '<em>Due ' + esc(dateWord(s[2])) + '</em></span></li>';
    }).join('') + '</ol>';
  }

  function homeHtml() {
    var m = S.mine, out = [];
    var any = m.own.length || m.owe.length || m.team.length || m.needsSign.length;
    out.push('<header class="ev-head"><div><p class="ev-kicker">Work</p><h1>Evaluations</h1></div>' + (m.manage ? '<a class="h-btn h-btn--ghost" href="/evaluations/admin/">Manage terms</a>' : '') + '</header>');
    if (!any) {
      out.push('<section class="ev-empty"><h2>No evaluation is open for you</h2><p>When a term opens, your self-assessment shows up here and on Today. If you are asked for feedback about a colleague, that shows up here too.</p>' + (m.reports.length ? '<p>People who report to you: ' + m.reports.length + '. Their evaluations appear here when a term opens.</p>' : '') + '</section>');
    }
    if (m.own.length) {
      out.push('<section class="ev-sec"><h2>My evaluation</h2>');
      m.own.forEach(function (o) {
        var due = S.dues && S.dues[o.id] || { w1: '', w2: '', w3: '' };
        out.push('<article class="ev-card"><div class="ev-card__top"><div><h3>' + esc(o.period) + '</h3><p class="ev-sub">' + esc(o.term) + '</p></div><span class="ev-chip">' + esc(o.stageWord) + '</span></div>' +
          '<p class="ev-next">' + esc(o.next) + (o.due ? ' <span class="ev-due">Due ' + esc(dateWord(o.due)) + '</span>' : '') + '</p>' +
          (o.stage === 'self' ? '<div class="ev-bar" role="img" aria-label="' + o.self.done + ' of ' + o.self.total + ' required answers"><i style="width:' + Math.round(100 * o.self.done / Math.max(1, o.self.total)) + '%"></i></div><p class="ev-sub">' + o.self.done + ' of ' + o.self.total + ' required answers</p>' : '') +
          '<div class="ev-acts"><a class="h-btn h-btn--primary" href="?c=' + esc(o.id) + '" data-go="' + esc(o.id) + '">' + (o.stage === 'self' ? 'Continue' : 'Open') + '</a></div></article>');
        void due;
      });
      out.push('</section>');
    }
    if (m.owe.length) {
      out.push('<section class="ev-sec"><h2>Feedback I owe</h2><ul class="ev-list">');
      m.owe.forEach(function (o) {
        out.push('<li class="ev-row"><div class="ev-row__main"><b>' + esc(o.employee) + '</b><span class="ev-sub">' + (o.status === 'submitted' ? 'Submitted' : o.progress.done + ' of ' + o.progress.total + ' required answers') + (o.due && o.status !== 'submitted' ? ' · Due ' + esc(dateWord(o.due)) : '') + '</span></div><a class="h-btn ' + (o.status === 'submitted' ? 'h-btn--ghost' : 'h-btn--primary') + ' h-btn--sm" href="?c=' + esc(o.caseId) + '" data-go="' + esc(o.caseId) + '">' + (o.status === 'submitted' ? 'View' : 'Give feedback') + '</a></li>');
      });
      out.push('</ul></section>');
    }
    if (m.team.length) {
      out.push('<section class="ev-sec"><h2>My team</h2><ul class="ev-list">');
      m.team.forEach(function (t) {
        out.push('<li class="ev-row"><div class="ev-row__main"><b>' + esc(t.employee) + '</b><span class="ev-sub">' + esc(t.next) + (t.due ? ' · Due ' + esc(dateWord(t.due)) : '') + '</span></div><span class="ev-chip ev-chip--quiet">' + esc(t.stageWord) + '</span><a class="h-btn h-btn--ghost h-btn--sm" href="?c=' + esc(t.id) + '" data-go="' + esc(t.id) + '">Open</a></li>');
      });
      out.push('</ul></section>');
    }
    if (m.needsSign.length) {
      out.push('<section class="ev-sec"><h2>Waiting for HR to sign</h2><ul class="ev-list">');
      m.needsSign.forEach(function (t) {
        out.push('<li class="ev-row"><div class="ev-row__main"><b>' + esc(t.employee) + '</b><span class="ev-sub">' + esc(t.period) + '</span></div><a class="h-btn h-btn--primary h-btn--sm" href="?c=' + esc(t.id) + '" data-go="' + esc(t.id) + '&v=signoff">Review and sign</a></li>');
      });
      out.push('</ul></section>');
    }
    return out.join('');
  }

  /* ---------------------------------------------------------------------------------------------------- one case */

  function tabsFor(v) {
    var t = [], r = v.role;
    t.push(['overview', 'Overview']);
    if (r.employee) { t.push(['self', 'Self-assessment']); t.push(['reviewers', 'Reviewers']); if (v.summary) t.push(['summary', 'Summary and plan']); }
    else if (r.raw) {
      if (v.self) t.push(['self', 'Self-assessment']);
      t.push(['feedback', 'Feedback']);
      t.push(['compare', 'Compare']);
      t.push(['summary', 'Summary and plan']);
      t.push(['signoff', 'Meeting and sign-off']);
    }
    if (v.mineB) t.push(['mine', 'My feedback form']);
    return t;
  }

  function caseHtml() {
    var v = S.view, c = v.case, r = v.role;
    var tabs = tabsFor(v);
    var tab = S.tab;
    if (!tabs.some(function (t) { return t[0] === tab; })) tab = (!r.employee && !r.raw && v.mineB) ? 'mine' : 'overview';
    S.tab = tab;
    var h = '<a class="ev-back" href="/evaluations/" data-go="">All evaluations</a>' +
      '<header class="ev-head"><div><p class="ev-kicker">' + esc(c.period) + '</p><h1>' + (r.employee ? 'My evaluation' : esc(c.employee.name)) + '</h1>' +
      '<p class="ev-sub">' + (r.employee ? '' : esc(c.employee.title || c.employee.team) + (c.employee.title || c.employee.team ? ' · ' : '') + 'Supervisor: ' + esc(c.supervisor.name || 'not assigned')) + '</p></div><span class="ev-chip">' + esc(c.stageWord) + '</span></header>';
    if (tabs.length > 1) {
      h += '<nav class="ev-tabs" aria-label="Sections of this evaluation">' + tabs.map(function (t) { return '<a href="?c=' + esc(c.id) + '&v=' + t[0] + '" data-go="' + esc(c.id) + '&v=' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '</a>'; }).join('') + '</nav>';
    }
    h += '<div class="ev-body">';
    if (tab === 'overview') h += overviewHtml();
    else if (tab === 'self') h += v.role.employee ? formHtml('A', v.self, !v.self.submitted && c.termOpen) : formReadHtml(S.forms.forms.A, v.self.answers, 'Self-assessment');
    else if (tab === 'mine') h += formHtml('B', v.mineB, !v.mineB.submitted && c.termOpen);
    else if (tab === 'reviewers') h += reviewersHtml();
    else if (tab === 'feedback') h += feedbackHtml();
    else if (tab === 'compare') h += compareHtml();
    else if (tab === 'summary') h += summaryHtml();
    else if (tab === 'signoff') h += signoffHtml();
    h += '</div>';
    return h;
  }

  function checkRow(done, text, extra) { return '<li class="' + (done ? 'is-done' : '') + '"><span class="ev-tick" aria-hidden="true">' + (done ? '&#10003;' : '') + '</span><span>' + text + (extra ? ' <em>' + extra + '</em>' : '') + '</span></li>'; }

  function overviewHtml() {
    var v = S.view, c = v.case, r = v.role, h = '';
    h += '<section class="ev-panel"><p class="ev-next ev-next--big">' + esc(v.next) + '</p>' + stepper(c.stage, c.due);
    if (r.employee) {
      var p = v.self && v.self.progress;
      h += '<ul class="ev-checks">' +
        checkRow(c.selfSubmitted, 'Self-assessment (Form A)', c.selfSubmitted ? '' : p ? p.done + ' of ' + p.total + ' required answers' : '') +
        checkRow((v.reviewers || []).filter(function (x) { return x.status === 'asked' || x.status === 'submitted'; }).length >= S.forms.limits.reviewersMin, 'Name ' + S.forms.limits.reviewersMin + ' to ' + S.forms.limits.reviewersMax + ' people for feedback', (v.reviewers || []).filter(function (x) { return x.status === 'submitted'; }).length + ' of ' + (v.reviewers || []).filter(function (x) { return x.status === 'asked' || x.status === 'submitted'; }).length + ' sent their feedback') +
        checkRow(c.summaryShared, 'Your supervisor shares the summary and your plan') +
        checkRow(!!c.acknowledgedAt, 'You acknowledge after the meeting' + (c.meetingOn ? ' on ' + esc(dateWord(c.meetingOn)) : '')) +
        checkRow(!!c.signedAt, 'HR signs') + '</ul>';
      h += '<div class="ev-acts">' + (c.stage === 'self' && c.termOpen ? '<a class="h-btn h-btn--primary" href="?c=' + esc(c.id) + '&v=' + (c.selfSubmitted ? 'reviewers' : 'self') + '" data-go="' + esc(c.id) + '&v=' + (c.selfSubmitted ? 'reviewers' : 'self') + '">' + (c.selfSubmitted ? 'Choose reviewers' : 'Continue the self-assessment') + '</a>' : '') +
        (c.summaryShared ? '<a class="h-btn h-btn--primary" href="?c=' + esc(c.id) + '&v=summary" data-go="' + esc(c.id) + '&v=summary">Read the summary and plan</a>' : '') + '</div>';
    } else if (r.raw) {
      var rv = v.reviewers || [], act = rv.filter(function (x) { return x.status === 'asked' || x.status === 'submitted'; });
      h += '<ul class="ev-checks">' +
        checkRow(c.selfSubmitted, 'Self-assessment submitted') +
        checkRow(act.length >= S.forms.limits.reviewersMin, 'Reviewers named', act.length + ' named') +
        checkRow(act.length > 0 && act.every(function (x) { return x.status === 'submitted'; }), 'Feedback in', act.filter(function (x) { return x.status === 'submitted'; }).length + ' of ' + act.length) +
        checkRow(c.summaryShared, 'Summary and plan shared') +
        checkRow(!!c.acknowledgedAt, 'Employee acknowledged') +
        checkRow(!!c.signedAt, 'HR signed') + '</ul>';
    }
    h += '</section>';
    if (r.manage && c.termOpen) {
      h += '<section class="ev-panel"><h2>Supervisor</h2><label class="ev-field"><span>Who supervises this evaluation</span><select id="ev-sup"><option value="">Not assigned</option>' + (S.staff || []).filter(function (p) { return p.email !== c.employee.email; }).map(function (p) { return '<option value="' + esc(p.email) + '"' + (p.email === c.supervisor.email ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label></section>';
    }
    if (v.priorGoals && v.priorGoals.length) h += priorHtml(v.priorGoals, r.raw);
    h += '<section class="ev-panel ev-who"><h2>Who can read what</h2>' + whoText(v) + '</section>';
    return h;
  }

  function whoText(v) {
    var F = S.forms.forms;
    if (v.role.employee) return '<p>' + esc(F.A.readers) + '</p><p>' + esc(F.B.readers) + '</p><p>' + esc(F.C.readers) + '</p>';
    if (v.role.raw) return '<p>' + esc(F.B.readers) + '</p><p>' + esc(F.C.readers) + '</p>';
    return '<p>' + esc(F.B.readers) + '</p>';
  }

  function priorHtml(goals, canReview) {
    var word = { met: 'Met', partly: 'Partly met', not_met: 'Not met', '': 'Not recorded' };
    var h = '<section class="ev-panel"><h2>Goals from the last evaluation' + (goals[0] && goals[0].period ? ' (' + esc(goals[0].period) + ')' : '') + '</h2><ul class="ev-goals">';
    goals.forEach(function (g) {
      h += '<li class="ev-goal"><div><b>' + esc(g.goal) + '</b><span class="ev-sub">' + esc(g.area) + (g.target_date ? ' · Target ' + esc(dateWord(g.target_date)) : '') + '</span></div>';
      if (canReview) h += '<div class="ev-goal__rv"><select data-goalrv="' + esc(g.id) + '" aria-label="How this goal went">' + ['', 'met', 'partly', 'not_met'].map(function (k) { return '<option value="' + k + '"' + (g.review_status === k ? ' selected' : '') + '>' + word[k] + '</option>'; }).join('') + '</select><input data-goalnote="' + esc(g.id) + '" value="' + esc(g.review_note) + '" placeholder="Note" maxlength="300" aria-label="Note on this goal"></div>';
      else h += '<span class="ev-chip ev-chip--quiet">' + esc(word[g.review_status] || '') + '</span>';
      h += '</li>';
    });
    return h + '</ul></section>';
  }

  /* ------------------------------------------------------------------------------------------------ the forms */

  function scaleHead() {
    return '<div class="ev-scale" role="presentation"><span></span>' + S.forms.scale.map(function (s) { return '<span title="' + esc(s.label + '. ' + s.text) + '"><b>' + esc(s.short) + '</b>' + esc(s.label) + '</span>'; }).join('') + '</div>';
  }
  function legend() {
    return '<details class="ev-legend"><summary>What the numbers mean</summary><ul>' + S.forms.scale.map(function (s) { return '<li><b>' + esc(s.short) + ' ' + esc(s.label) + '.</b> ' + esc(s.text) + '</li>'; }).join('') + '</ul><p>' + esc(S.forms.exampleNote) + '</p></details>';
  }

  function ratingRow(q, a, edit) {
    var val = a && a.rating !== null && a.rating !== undefined ? a.rating : null;
    var h = '<div class="ev-q ev-q--rate" data-q="' + q.id + '"><div class="ev-q__t" id="l-' + q.id + '"><span class="ev-q__n">' + q.n + '</span>' + esc(q.text) + '</div>' +
      '<div class="ev-dots" role="radiogroup" aria-labelledby="l-' + q.id + '">';
    S.forms.scale.forEach(function (s) {
      h += '<label class="ev-dot' + (val === s.value ? ' is-on' : '') + '" title="' + esc(s.label) + '"><input type="radio" name="r-' + q.id + '" value="' + s.value + '"' + (val === s.value ? ' checked' : '') + (edit ? '' : ' disabled') + '><span>' + esc(s.short) + '</span></label>';
    });
    h += '</div>';
    var sc = S.forms.scale.filter(function (s) { return s.value === val; })[0];
    h += '<div class="ev-picked" aria-live="polite">' + (sc ? esc(sc.short + ' ' + sc.label) : '') + '</div>';
    if (val === 1 || val === 2) h += '<label class="ev-ex"><span>Example <i>(required for a 1 or 2)</i></span><textarea data-ex="' + q.id + '" rows="2" maxlength="8000"' + (edit ? '' : ' readonly') + '>' + esc(a.example || '') + '</textarea></label>';
    return h + '</div>';
  }

  function textRow(q, a, edit) {
    var tag = q.kind === 'choice' ? '<em class="ev-req">Required</em>' : q.req ? '<em class="ev-req">Required</em>' : '<em class="ev-opt">Optional</em>';
    if (q.kind === 'choice') {
      return '<div class="ev-q" data-q="' + q.id + '"><label class="ev-q__t" for="f-' + q.id + '">' + (q.n ? '<span class="ev-q__n">' + q.n + '</span>' : '') + esc(q.text) + tag + '</label><select id="f-' + q.id + '" name="' + q.id + '" data-choice="' + q.id + '"' + (edit ? '' : ' disabled') + '><option value="">Choose</option>' + q.options.map(function (o) { return '<option' + (a && a.text === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
    }
    return '<div class="ev-q" data-q="' + q.id + '"><label class="ev-q__t" for="f-' + q.id + '">' + (q.n ? '<span class="ev-q__n">' + q.n + '</span>' : '') + esc(q.text) + tag + '</label><textarea id="f-' + q.id + '" data-text="' + q.id + '" rows="3" maxlength="8000"' + (edit ? '' : ' readonly') + '>' + esc(a ? a.text : '') + '</textarea></div>';
  }

  function autoRow(q) {
    var c = S.view.case, v = '';
    if (q.auto === 'name') v = c.employee.name; else if (q.auto === 'title') v = c.employee.title; else if (q.auto === 'department') v = c.employee.team;
    else if (q.auto === 'supervisor') v = c.supervisor.name; else if (q.auto === 'period') v = c.period; else if (q.auto === 'date') v = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    else if (q.auto === 'employee') v = c.employee.name; else if (q.auto === 'reviewer') v = S.mine.me.name;
    return '<div class="ev-auto"><span>' + esc(q.text) + '</span><b>' + esc(v || 'Not set') + '</b></div>';
  }

  function sectionHtml(form, sec, m, edit) {
    var rate = sec.questions.some(function (q) { return q.kind === 'rating'; });
    var h = '<section class="ev-section" aria-labelledby="sec-' + sec.id + '"><h2 id="sec-' + sec.id + '">' + esc(sec.title) + '</h2>' + (sec.blurb ? '<p class="ev-sub">' + esc(sec.blurb) + '</p>' : '');
    if (rate) h += scaleHead() + legend();
    var reflect = false;
    sec.questions.forEach(function (q) {
      if (q.kind === 'auto') { h += autoRow(q); return; }
      if (q.kind !== 'rating' && rate && !reflect) { reflect = true; h += '<h3 class="ev-reflect">Reflection</h3>'; }
      h += q.kind === 'rating' ? ratingRow(q, m[q.id], edit) : textRow(q, m[q.id], edit);
    });
    return h + '</section>';
  }

  function formHtml(id, src, edit) {
    var form = S.forms.forms[id], m = merged(src.answers), v = S.view;
    var si = Math.min(Math.max(S.sec, 0), form.sections.length - 1);
    var t = totals(form, m), g = gaps(form, m);
    var h = '<div class="ev-form" data-form="' + id + '">';
    if (si === 0 || !edit) h += '<section class="ev-panel ev-intro"><h2>' + esc(form.title) + '</h2>' + form.intro.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '<p class="ev-readers"><b>Who reads this.</b> ' + esc(form.readers) + '</p></section>';
    if (!edit) {
      h += '<p class="ev-note">' + (id === 'A' ? (v.case.termOpen ? 'Submitted. Your supervisor can reopen it if something needs to change.' : 'This term is closed.') : 'Submitted. Thank you.') + '</p>';
      form.sections.forEach(function (s) { h += sectionHtml(form, s, m, false); });
      return h + '</div>';
    }
    h += '<div class="ev-bar-wrap"><div class="ev-prog"><div class="ev-bar" role="img" aria-label="' + t.done + ' of ' + t.total + ' required"><i style="width:' + Math.round(100 * t.done / Math.max(1, t.total)) + '%"></i></div><span><b id="ev-done">' + t.done + '</b> of ' + t.total + ' required done</span><span id="ev-save" class="ev-save" role="status">' + esc(S.saving) + '</span></div>' +
      '<nav class="ev-secs" aria-label="Sections">' + form.sections.map(function (s, i) {
        var p = secProgress(s, m), ok = p.total > 0 && p.done === p.total;
        return '<button type="button" data-sec="' + i + '"' + (i === si ? ' aria-current="step"' : '') + ' class="' + (ok ? 'is-done' : '') + '">' + (ok ? '<i aria-hidden="true">&#10003;</i>' : '') + esc(s.title) + (p.total ? '<small>' + p.done + '/' + p.total + '</small>' : '') + '</button>';
      }).join('') + '</nav></div>';
    h += sectionHtml(form, form.sections[si], m, true);
    h += '<div class="ev-pager">' + (si > 0 ? '<button type="button" class="h-btn h-btn--ghost" data-sec="' + (si - 1) + '">Back</button>' : '<span></span>') +
      (si < form.sections.length - 1 ? '<button type="button" class="h-btn h-btn--primary" data-sec="' + (si + 1) + '">Next section</button>' : '') + '</div>';
    if (si === form.sections.length - 1) {
      h += '<section class="ev-panel ev-submit"><h2>Before you submit</h2>';
      if (g.length) {
        h += '<p>' + g.length + ' thing' + (g.length === 1 ? '' : 's') + ' left.</p><ul class="ev-gaps">' + g.slice(0, 12).map(function (x) { return '<li><button type="button" class="ev-link" data-jump="' + x.si + ':' + x.q.id + '">' + esc(x.why) + ': ' + esc((x.q.n ? x.q.n + '. ' : '') + x.q.text.slice(0, 70)) + (x.q.text.length > 70 ? '...' : '') + '</button></li>'; }).join('') + (g.length > 12 ? '<li class="ev-sub">and ' + (g.length - 12) + ' more</li>' : '') + '</ul>';
      } else h += '<p>Everything required is answered. After you submit, Form ' + id + ' is locked' + (id === 'A' ? '. Next you name the people who give feedback.' : '.') + '</p>';
      h += '<div class="ev-acts"><button type="button" class="h-btn h-btn--primary" id="ev-submit" data-form="' + id + '"' + (g.length ? ' disabled' : '') + '>Submit Form ' + id + '</button></div></section>';
    }
    return h + '</div>';
  }

  function formReadHtml(form, answers, label) {
    var m = byId(answers), h = '<section class="ev-panel ev-read"><h2>' + esc(label) + '</h2>';
    form.sections.forEach(function (sec) {
      if (sec.questions.every(function (q) { return q.kind === 'auto'; })) return;
      h += '<h3 class="ev-read__h">' + esc(sec.title) + '</h3>';
      sec.questions.forEach(function (q) {
        if (q.kind === 'auto') return;
        var a = m[q.id];
        if (q.kind === 'rating') {
          var sc = S.forms.scale.filter(function (s) { return a && s.value === a.rating; })[0];
          h += '<div class="ev-ro"><p>' + (q.n ? '<span class="ev-q__n">' + q.n + '</span>' : '') + esc(q.text) + '</p><p class="ev-ro__a">' + (sc ? '<span class="ev-pill ev-pill--' + sc.value + '">' + esc(sc.short) + '</span> ' + esc(sc.label) : '<span class="ev-sub">Not rated</span>') + (a && a.example ? '<br><span class="ev-ro__ex">Example: ' + esc(a.example) + '</span>' : '') + '</p></div>';
        } else h += '<div class="ev-ro"><p>' + (q.n ? '<span class="ev-q__n">' + q.n + '</span>' : '') + esc(q.text) + '</p><p class="ev-ro__a">' + (a && a.text ? esc(a.text).replace(/\n/g, '<br>') : '<span class="ev-sub">No answer</span>') + '</p></div>';
      });
    });
    return h + '</section>';
  }

  /* ------------------------------------------------------------------------------------------------ reviewers */

  function reviewersHtml() {
    var v = S.view, c = v.case, lim = S.forms.limits, list = v.reviewers || [];
    var active = list.filter(function (x) { return x.status === 'asked' || x.status === 'submitted'; });
    var editable = c.termOpen && !c.summaryShared;
    var h = '<section class="ev-panel"><h2>People who give you feedback</h2><p>Name ' + lim.reviewersMin + ' to ' + lim.reviewersMax + ' people who work with you: colleagues, people you lead, someone from another department. Each one gets their own feedback form. They are asked as soon as you save.</p>';
    h += '<p class="ev-readers"><b>Who reads their answers.</b> ' + esc(S.forms.forms.B.readers) + '</p>';
    if (list.length) {
      h += '<ul class="ev-list">' + list.filter(function (x) { return x.status !== 'removed'; }).map(function (x) {
        var chip = x.status === 'submitted' ? '<span class="ev-chip">Sent</span>' : x.status === 'declined' ? '<span class="ev-chip ev-chip--warn">Declined</span>' : '<span class="ev-chip ev-chip--quiet">Asked</span>';
        return '<li class="ev-row"><div class="ev-row__main"><b>' + esc(x.name) + '</b></div>' + chip + (editable && x.status !== 'submitted' ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-unpick="' + esc(x.email) + '">Remove</button>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (editable) {
      if (!S.pickInit) { S.pick = active.map(function (x) { return x.email; }); S.pickInit = true; }
      var chosen = S.pick;
      h += '<h3 class="ev-h3">' + (active.length ? 'Change who you ask' : 'Choose people') + '</h3><div class="ev-chosen" aria-live="polite">' + (chosen.length ? chosen.map(function (e) { var p = (S.staff || []).filter(function (x) { return x.email === e; })[0]; return '<span class="ev-tag">' + esc(p ? p.name : e) + '<button type="button" data-unpick="' + esc(e) + '" aria-label="Remove ' + esc(p ? p.name : e) + '">&times;</button></span>'; }).join('') : '<span class="ev-sub">Nobody chosen yet</span>') + '</div>';
      h += '<label class="ev-field"><span>Find a colleague</span><input type="search" id="ev-find" placeholder="Name or team" autocomplete="off" value="' + esc(S.reviewerQ) + '"></label><ul class="ev-hits" id="ev-hits">' + hitsHtml() + '</ul>';
      h += '<div class="ev-acts"><button type="button" class="h-btn h-btn--primary" id="ev-askrev"' + (chosen.length < lim.reviewersMin || chosen.length > lim.reviewersMax ? ' disabled' : '') + '>Ask ' + chosen.length + ' ' + (chosen.length === 1 ? 'person' : 'people') + '</button><span class="ev-sub">' + (chosen.length < lim.reviewersMin ? 'Choose at least ' + lim.reviewersMin + '.' : chosen.length > lim.reviewersMax ? 'No more than ' + lim.reviewersMax + '.' : '') + '</span></div>';
    } else h += '<p class="ev-sub">The feedback round is over.</p>';
    return h + '</section>';
  }
  function hitsHtml() {
    var q = S.reviewerQ.trim().toLowerCase(), me = S.view.case.employee.email;
    var list = (S.staff || []).filter(function (p) { return p.email !== me && S.pick.indexOf(p.email) < 0 && (!q || (p.name + ' ' + p.team + ' ' + p.title).toLowerCase().indexOf(q) >= 0); }).slice(0, 12);
    return list.length ? list.map(function (p) { return '<li><button type="button" data-pick="' + esc(p.email) + '"><b>' + esc(p.name) + '</b><span>' + esc([p.title, p.team].filter(Boolean).join(' · ')) + '</span></button></li>'; }).join('') : '<li class="ev-sub">' + (q ? 'Nobody matches.' : 'Everyone is chosen.') + '</li>';
  }

  /* --------------------------------------------------------------------------------- supervisor: feedback, compare */

  function feedbackHtml() {
    var v = S.view, fb = v.feedback || [], F = S.forms.forms.B, h = '<section class="ev-panel"><h2>Feedback from reviewers</h2><p class="ev-readers">' + esc(F.readers) + ' Do not pass a reviewer\'s words to the employee. The summary is how they hear it.</p>';
    if (!fb.length) return h + '<p class="ev-sub">Nobody has been asked yet.</p></section>';
    h += '</section>';
    fb.forEach(function (r) {
      h += '<details class="ev-acc"' + (r.submitted ? '' : '') + '><summary><b>' + esc(r.reviewer) + '</b><span class="ev-sub">' + esc([r.relationship, r.frequency].filter(Boolean).join(' · ') || 'No relationship given') + '</span><span class="ev-chip ' + (r.submitted ? '' : 'ev-chip--quiet') + '">' + (r.submitted ? 'Submitted' : 'Not yet') + '</span></summary>' +
        (r.submitted ? formReadHtml(F, r.answers, 'Form B from ' + r.reviewer) + (v.role.raw ? '<div class="ev-acts"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-reopenb="' + esc(r.email) + '">Reopen for ' + esc(r.reviewer) + '</button></div>' : '') : '<p class="ev-sub">Waiting on this form.</p>') + '</details>';
    });
    return h;
  }

  function bars(self, others) {
    var w = function (x) { return x === null ? 0 : Math.round(x / 5 * 100); };
    return '<span class="ev-cmp"><span class="ev-cmp__r"><i class="is-self" style="width:' + w(self) + '%"></i></span><span class="ev-cmp__r"><i class="is-others" style="width:' + w(others) + '%"></i></span></span>';
  }
  function num(x) { return x === null || x === undefined ? 'n/a' : x.toFixed(1); }

  function compareHtml() {
    var a = S.view.analysis;
    if (!a) return '<section class="ev-panel"><h2>Compare</h2><p class="ev-sub">The comparison opens once the self-assessment is submitted.</p></section>';
    var h = '<section class="ev-panel"><h2>Self and others, by competency</h2><p class="ev-sub">Averages on the 1 to 5 scale from ' + a.reviewersIn + ' submitted feedback form' + (a.reviewersIn === 1 ? '' : 's') + '. Not Observed is left out. There is no overall score. <span class="ev-key"><i class="is-self"></i> Self <i class="is-others"></i> Others</span></p>';
    h += '<div class="ev-cats">' + a.categories.map(function (c) { return '<div class="ev-cat"><b>' + esc(c.category) + '</b>' + bars(c.self, c.others) + '<span class="ev-sub">Self ' + num(c.self) + ' · Others ' + num(c.others) + '</span></div>'; }).join('') + '</div>';
    var cats = {};
    a.rows.forEach(function (r) { (cats[r.category] = cats[r.category] || []).push(r); });
    Object.keys(cats).forEach(function (k) {
      h += '<h3 class="ev-h3">' + esc(k) + '</h3><div class="ev-table" role="table" aria-label="' + esc(k) + '"><div class="ev-tr ev-tr--h" role="row"><span role="columnheader">Competency</span><span role="columnheader"></span><span role="columnheader">Self</span><span role="columnheader">Others</span><span role="columnheader">Gap</span></div>' +
        cats[k].map(function (r) {
          var big = r.gap !== null && Math.abs(r.gap) >= 1;
          return '<div class="ev-tr' + (big ? ' is-gap' : '') + '" role="row"><span role="cell">' + esc(r.label) + '</span><span role="cell">' + bars(r.self, r.others) + '</span><span role="cell" data-l="Self">' + num(r.self) + '</span><span role="cell" data-l="Others">' + num(r.others) + (r.raters ? ' <small>(' + r.raters + ')</small>' : '') + '</span><span role="cell" data-l="Gap">' + (r.gap === null ? '' : (r.gap > 0 ? '+' : '') + r.gap.toFixed(1)) + '</span></div>';
        }).join('') + '</div>';
    });
    h += '</section>';
    var t = a.themes;
    h += '<section class="ev-panel"><h2>Recurring themes</h2>';
    var li = function (title, rows, f) { return rows.length ? '<h3 class="ev-h3">' + title + '</h3><ul class="ev-bul">' + rows.map(f).join('') + '</ul>' : ''; };
    h += li('Others rate these highest', t.strengths, function (r) { return '<li>' + esc(r.label) + ' <small>(others ' + num(r.others) + ')</small></li>'; });
    h += li('Others rate these lowest', t.growth, function (r) { return '<li>' + esc(r.label) + ' <small>(others ' + num(r.others) + ')</small></li>'; });
    h += li('Self and others differ by a point or more', t.gaps, function (r) { return '<li>' + esc(r.label) + ' <small>(self ' + num(r.self) + ', others ' + num(r.others) + ')</small></li>'; });
    if (t.words.length) h += '<h3 class="ev-h3">Words several reviewers used</h3><p class="ev-words">' + t.words.map(function (w) { return '<span class="ev-tag ev-tag--plain">' + esc(w.word) + ' <small>' + w.people + '</small></span>'; }).join('') + '</p>';
    if (!t.strengths.length && !t.growth.length && !t.gaps.length && !t.words.length) h += '<p class="ev-sub">No themes yet. They appear as feedback comes in.</p>';
    h += '</section>';
    if (S.view.learning && S.view.learning.length) h += '<section class="ev-panel"><h2>Learning completed</h2><ul class="ev-bul">' + S.view.learning.map(function (l) { return '<li>' + esc(l.title) + ' <small>' + esc(dateWord(l.completedAt)) + '</small></li>'; }).join('') + '</ul></section>';
    return h;
  }

  /* ------------------------------------------------------------------------------------ summary, plan, sign-off */

  function planAreaOpts(cur) { return S.forms.planAreas.map(function (a) { return '<option' + (a === cur ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join(''); }

  function goalCard(g, i, edit) {
    if (!edit) {
      return '<li class="ev-goal ev-goal--full"><div><b>' + esc(g.goal) + '</b><span class="ev-sub">' + esc(g.area) + (g.target_date ? ' · Target ' + esc(dateWord(g.target_date, true)) : '') + '</span></div><dl><dt>Action steps</dt><dd>' + esc(g.steps).replace(/\n/g, '<br>') + '</dd><dt>Support needed</dt><dd>' + esc(g.support || 'None listed') + '</dd>' + (g.course_id ? '<dt>Learning</dt><dd><a href="/learn/course/?id=' + encodeURIComponent(g.course_id) + '">Open the course</a></dd>' : '') + '</dl></li>';
    }
    return '<li class="ev-goal ev-goal--edit" data-gi="' + i + '"><div class="ev-goal__h"><b>Goal ' + (i + 1) + '</b><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rmgoal="' + i + '">Remove</button></div>' +
      '<label class="ev-field"><span>Development area</span><select data-g="area">' + planAreaOpts(g.area) + '</select></label>' +
      '<label class="ev-field"><span>Goal</span><textarea data-g="goal" rows="2" maxlength="1000">' + esc(g.goal) + '</textarea></label>' +
      '<label class="ev-field"><span>Action steps</span><textarea data-g="steps" rows="3" maxlength="2000">' + esc(g.steps) + '</textarea></label>' +
      '<label class="ev-field"><span>Support needed</span><textarea data-g="support" rows="2" maxlength="1000">' + esc(g.support) + '</textarea></label>' +
      '<div class="ev-two"><label class="ev-field"><span>Target date</span><input type="date" data-g="target_date" value="' + esc(g.target_date || '') + '"></label>' +
      '<label class="ev-field"><span>Learn course (optional)</span><select data-g="course_id"><option value="">None</option>' + (S.courses || []).map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === g.course_id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</select></label></div></li>';
  }

  var GOALS = null; // goals being edited
  function summaryHtml() {
    var v = S.view, sm = v.summary, F = S.forms.forms.C, c = v.case, r = v.role;
    if (!sm) return '<section class="ev-panel"><h2>Summary and plan</h2><p class="ev-sub">Your supervisor writes this after the feedback is in. You see it when they share it' + (c.dueW3 ? '' : '') + '.</p></section>';
    var edit = sm.editable && r.raw;
    var h = '';
    if (!edit) {
      h += '<section class="ev-panel ev-intro"><h2>' + esc(F.title) + '</h2><p class="ev-readers"><b>Who reads this.</b> ' + esc(F.readers) + '</p>' + (c.meetingOn ? '<p>Meeting: <b>' + esc(dateWord(c.meetingOn, true)) + '</b></p>' : '') + '</section>';
      h += formReadHtml(F, sm.answers, 'Supervisor summary');
      h += '<section class="ev-panel"><h2>Six-month development plan</h2><p class="ev-sub">Revisited at your next evaluation. Each goal is also a task in Projects when Projects is on.</p><ul class="ev-goals">' + (sm.goals.length ? sm.goals.map(function (g, i) { return goalCard(g, i, false); }).join('') : '<li class="ev-sub">No goals yet.</li>') + '</ul></section>';
      if (v.priorGoals && v.priorGoals.length) h += priorHtml(v.priorGoals, r.raw);
      if (r.employee) h += acknowledgeHtml();
      if (r.raw && c.termOpen && !c.acknowledgedAt) h += '<div class="ev-acts"><button type="button" class="h-btn h-btn--ghost" data-reopenc="1">Reopen the summary</button></div>';
      return h;
    }
    if (GOALS === null) GOALS = (sm.goals || []).map(function (g) { return JSON.parse(JSON.stringify(g)); });
    var m = merged(sm.answers), t = totals(F, m);
    h += '<section class="ev-panel ev-intro"><h2>' + esc(F.title) + '</h2>' + F.intro.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '<p class="ev-readers"><b>Who reads this.</b> ' + esc(F.readers) + '</p></section>';
    if (v.priorGoals && v.priorGoals.length) h += priorHtml(v.priorGoals, true);
    h += '<div class="ev-form" data-form="C"><div class="ev-prog"><div class="ev-bar"><i style="width:' + Math.round(100 * t.done / Math.max(1, t.total)) + '%"></i></div><span><b id="ev-done">' + t.done + '</b> of ' + t.total + ' written</span><span id="ev-save" class="ev-save" role="status">' + esc(S.saving) + '</span></div>';
    F.sections.forEach(function (s) { h += sectionHtml(F, s, m, true); });
    h += '</div>';
    h += '<section class="ev-panel"><h2>Six-month development plan</h2><p class="ev-sub">' + S.forms.limits.goalsMin + ' to ' + S.forms.limits.goalsMax + ' priority goals. Revisited at the next evaluation.</p><ul class="ev-goals" id="ev-goals">' + GOALS.map(function (g, i) { return goalCard(g, i, true); }).join('') + '</ul>' +
      '<div class="ev-acts">' + (GOALS.length < S.forms.limits.goalsMax ? '<button type="button" class="h-btn h-btn--ghost" id="ev-addgoal">Add a goal</button>' : '') + '<button type="button" class="h-btn h-btn--ghost" id="ev-savegoals">Save the plan</button><span class="ev-save" id="ev-goalmsg" role="status"></span></div></section>';
    var gp = gaps(F, m), nGoals = GOALS.filter(function (g) { return g.goal && g.steps && g.target_date; }).length;
    var ok = !gp.length && nGoals >= S.forms.limits.goalsMin && nGoals === GOALS.length;
    var rv = (v.reviewers || []).filter(function (x) { return x.status === 'submitted'; }).length;
    h += '<section class="ev-panel ev-submit"><h2>Share with ' + esc(c.employee.name) + '</h2>' + (ok ? '' : '<p>' + (gp.length ? gp.length + ' summary answer' + (gp.length === 1 ? '' : 's') + ' left. ' : '') + (nGoals < S.forms.limits.goalsMin || nGoals !== GOALS.length ? 'The plan needs ' + S.forms.limits.goalsMin + ' to ' + S.forms.limits.goalsMax + ' goals with the goal, action steps and a target date.' : '') + '</p>') +
      '<label class="ev-field"><span>Meeting date</span><input type="date" id="ev-meet" value="' + esc(c.meetingOn || c.due.w3 || '') + '"></label>' +
      (rv < S.forms.limits.reviewersMin ? '<p class="ev-warn">Only ' + rv + ' of ' + S.forms.limits.reviewersMin + ' feedback forms are in. You can go ahead with what you have.</p>' : '') +
      '<div class="ev-acts"><button type="button" class="h-btn h-btn--primary" id="ev-share"' + (ok ? '' : ' disabled') + '>Share summary and plan</button></div><p class="ev-sub">After you share, the employee reads this and the plan. The raw feedback stays with you, HR and the hub administrators.</p></section>';
    return h;
  }

  function acknowledgeHtml() {
    var c = S.view.case;
    if (c.acknowledgedAt) return '<section class="ev-panel"><h2>Acknowledged</h2><p>You acknowledged this on ' + esc(dateWord(c.acknowledgedAt, true)) + '.' + (c.acknowledgedNote ? ' Your note: ' + esc(c.acknowledgedNote) : '') + '</p>' + docLinks() + '</section>';
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    var early = c.meetingOn && today < c.meetingOn;
    return '<section class="ev-panel ev-submit"><h2>Acknowledge</h2><p>After the meeting, acknowledge that you read the summary and the plan. Acknowledging does not mean you agree with every line. Add a note if you want your view recorded.</p><label class="ev-field"><span>Your note (optional)</span><textarea id="ev-acknote" rows="3" maxlength="2000"></textarea></label><div class="ev-acts"><button type="button" class="h-btn h-btn--primary" id="ev-ack"' + (early ? ' disabled' : '') + '>I read this and met with my supervisor</button>' + (early ? '<span class="ev-sub">Opens after the meeting on ' + esc(dateWord(c.meetingOn, true)) + '.</span>' : '') + '</div></section>';
  }

  function docLinks() {
    var c = S.view.case, h = '<div class="ev-acts">';
    if (c.summaryShared) h += '<a class="h-btn h-btn--ghost" target="_blank" rel="noopener" href="/api/evaluations/case/' + esc(c.id) + '/pdf">Download the PDF</a>';
    if (c.docUrl && S.view.role.raw) h += '<a class="h-btn h-btn--ghost" target="_blank" rel="noopener" href="' + esc(c.docUrl) + '">Open the Google Doc</a>';
    return h + '</div>';
  }

  function signoffHtml() {
    var v = S.view, c = v.case, r = v.role;
    var h = '<section class="ev-panel"><h2>Meeting and sign-off</h2><ul class="ev-checks">' +
      checkRow(c.summaryShared, 'Summary and plan shared') +
      checkRow(!!c.meetingOn, 'Meeting date', c.meetingOn ? esc(dateWord(c.meetingOn, true)) : 'not set') +
      checkRow(!!c.acknowledgedAt, 'Employee acknowledged', c.acknowledgedAt ? esc(dateWord(c.acknowledgedAt)) : '') +
      checkRow(!!c.signedAt, 'HR signed', c.signedAt ? esc(c.signedBy) + ', ' + esc(dateWord(c.signedAt)) : '') +
      checkRow(!!c.docUrl, 'Filed in the employee\'s folder', c.docUrl ? '' : c.docError ? esc(c.docError) : '') + '</ul>';
    if (c.summaryShared && c.termOpen && !c.acknowledgedAt) h += '<label class="ev-field"><span>Meeting date</span><input type="date" id="ev-meet2" value="' + esc(c.meetingOn) + '"></label><div class="ev-acts"><button type="button" class="h-btn h-btn--ghost" id="ev-setmeet">Save the date</button></div>';
    h += '<div class="ev-acts">';
    if (r.manage && c.stage === 'acknowledged') h += '<button type="button" class="h-btn h-btn--primary" id="ev-sign">Sign as HR</button>';
    if (r.manage && c.signedAt && !c.docUrl) h += '<button type="button" class="h-btn h-btn--ghost" id="ev-retrydoc">Try the Google Doc again</button>';
    h += '</div>' + (c.stage === 'meeting' ? '<p class="ev-sub">Waiting for the employee to acknowledge.</p>' : '') + (r.manage && c.stage === 'acknowledged' ? '<p class="ev-sub">Signing files the Google Doc and the PDF in the employee\'s folder.</p>' : '') + docLinks() + '</section>';
    return h;
  }

  /* ---------------------------------------------------------------------------------------------------- events */

  root.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a) {
      e.preventDefault();
      var parts = a.getAttribute('data-go').split('&v=');
      S.sec = 0; GOALS = null; Q = {};
      go({ c: parts[0], v: parts[1] || '' });
      window.scrollTo(0, 0);
      return;
    }
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sec !== undefined) { S.sec = Number(b.dataset.sec); render(); window.scrollTo({ top: 0 }); return; }
    if (b.dataset.jump) { var j = b.dataset.jump.split(':'); S.sec = Number(j[0]); render(); var t = document.querySelector('[data-q="' + j[1] + '"]'); if (t) { t.scrollIntoView({ block: 'center' }); var f = t.querySelector('textarea,input,select'); if (f) f.focus(); } return; }
    if (b.id === 'ev-submit') return submitForm(b);
    if (b.dataset.pick) { S.pick.push(b.dataset.pick); S.reviewerQ = ''; render(); var f2 = document.getElementById('ev-find'); if (f2) f2.focus(); return; }
    if (b.dataset.unpick) { S.pick = S.pick.filter(function (x) { return x !== b.dataset.unpick; }); render(); return; }
    if (b.id === 'ev-askrev') return withBusy(b, function () { return api('PUT', 'case/' + S.view.case.id + '/reviewers', { reviewers: S.pick.map(function (x) { return { email: x }; }) }).then(function () { toast('Feedback requested.'); S.pickInit = false; return reload(); }); });
    if (b.dataset.reopenb) return confirmThen('Reopen this feedback form so the reviewer can change it?', function () { return api('POST', 'case/' + S.view.case.id + '/reopen', { form: 'B', reviewer: b.dataset.reopenb }).then(reload); });
    if (b.dataset.reopenc) return confirmThen('Reopen the summary? The employee stops seeing it until you share it again.', function () { return api('POST', 'case/' + S.view.case.id + '/reopen', { form: 'C' }).then(function () { GOALS = null; return reload(); }); });
    if (b.id === 'ev-addgoal') { readGoals(); GOALS.push({ id: '', area: S.forms.planAreas[0], goal: '', steps: '', support: '', target_date: '', course_id: '' }); render(); return; }
    if (b.dataset.rmgoal) { readGoals(); GOALS.splice(Number(b.dataset.rmgoal), 1); render(); return; }
    if (b.id === 'ev-savegoals') return saveGoals(b);
    if (b.id === 'ev-share') return share(b);
    if (b.id === 'ev-ack') return withBusy(b, function () { return api('POST', 'case/' + S.view.case.id + '/acknowledge', { note: $('#ev-acknote').value }).then(function () { toast('Acknowledged.'); return reload(); }); });
    if (b.id === 'ev-sign') return confirmThen('Sign this evaluation as HR? It files the Google Doc and the PDF.', function () { return api('POST', 'case/' + S.view.case.id + '/sign').then(function (d) { toast(d.docError ? 'Signed. The Google Doc was not filed: ' + d.docError : 'Signed and filed.', !!d.docError); return reload(); }); });
    if (b.id === 'ev-retrydoc') return withBusy(b, function () { return api('POST', 'case/' + S.view.case.id + '/doc').then(function (d) { toast(d.docError ? d.docError : 'Filed.', !!d.docError); return reload(); }); });
    if (b.id === 'ev-setmeet') return withBusy(b, function () { return api('POST', 'case/' + S.view.case.id + '/meeting', { date: $('#ev-meet2').value }).then(function () { toast('Saved.'); return reload(); }); });
  });

  root.addEventListener('input', function (e) {
    var t = e.target, form = t.closest('[data-form]'), fid = form ? form.dataset.form : '';
    if (t.dataset.text) { var q = t.dataset.text; var cur = curAns(fid, q); queue(fid, { qid: q, rating: null, text: t.value, example: cur.example || '' }); grow(t); refreshDone(fid); return; }
    if (t.dataset.ex) { var q2 = t.dataset.ex; var c2 = curAns(fid, q2); queue(fid, { qid: q2, rating: c2.rating, text: '', example: t.value }); refreshDone(fid); return; }
    if (t.closest('.ev-goal--edit')) { var sh = document.getElementById('ev-share'); if (sh) sh.disabled = !shareReady(); return; }
    if (t.id === 'ev-find') { S.reviewerQ = t.value; var h = document.getElementById('ev-hits'); if (h) h.innerHTML = hitsHtml(); return; }
  });
  root.addEventListener('change', function (e) {
    var t = e.target, form = t.closest('[data-form]'), fid = form ? form.dataset.form : '';
    if (t.type === 'radio' && t.name.indexOf('r-') === 0) {
      var q = t.name.slice(2), cur = curAns(fid, q);
      queue(fid, { qid: q, rating: Number(t.value), text: '', example: cur.example || '' });
      render(true);
      var row = document.querySelector('[data-q="' + q + '"]'); if (row && (t.value === '1' || t.value === '2')) { var ex = row.querySelector('[data-ex]'); if (ex) ex.focus(); }
      return;
    }
    if (t.dataset.choice) { queue(fid, { qid: t.dataset.choice, rating: null, text: t.value, example: '' }); refreshDone(fid); return; }
    if (t.id === 'ev-sup') { api('POST', 'case/' + S.view.case.id + '/supervisor', { email: t.value }).then(function () { toast('Supervisor saved.'); return reload(); }).catch(function (er) { toast(er.message, true); }); return; }
    if (t.dataset.goalrv) { api('POST', 'case/' + S.view.case.id + '/goal-review', { goalId: t.dataset.goalrv, status: t.value, note: (document.querySelector('[data-goalnote="' + t.dataset.goalrv + '"]') || {}).value || '' }).then(function () { toast('Saved.'); }).catch(function (er) { toast(er.message, true); }); return; }
    if (t.dataset.goalnote) { var sel = document.querySelector('[data-goalrv="' + t.dataset.goalnote + '"]'); api('POST', 'case/' + S.view.case.id + '/goal-review', { goalId: t.dataset.goalnote, status: sel ? sel.value : '', note: t.value }).then(function () { toast('Saved.'); }).catch(function (er) { toast(er.message, true); }); }
  });

  function curAns(fid, q) {
    var src = fid === 'A' ? S.view.self : fid === 'B' ? S.view.mineB : S.view.summary;
    return merged(src ? src.answers : [])[q] || {};
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 520) + 'px'; }
  function refreshDone(fid) {
    var src = fid === 'A' ? S.view.self : fid === 'B' ? S.view.mineB : S.view.summary, form = S.forms.forms[fid];
    var t = totals(form, merged(src.answers)), d = document.getElementById('ev-done'); if (d) d.textContent = t.done;
    var bar = root.querySelector('.ev-prog .ev-bar i'); if (bar) bar.style.width = Math.round(100 * t.done / Math.max(1, t.total)) + '%';
    var btn = document.getElementById('ev-submit'); if (btn) btn.disabled = gaps(form, merged(src.answers)).length > 0;
    var sh = document.getElementById('ev-share'); if (sh && fid === 'C') sh.disabled = !shareReady();
  }
  function shareReady() {
    var F = S.forms.forms.C, m = merged(S.view.summary.answers);
    readGoals();
    var n = GOALS.filter(function (g) { return g.goal && g.steps && g.target_date; }).length;
    return !gaps(F, m).length && n >= S.forms.limits.goalsMin && n === GOALS.length;
  }

  function withBusy(b, fn) {
    b.disabled = true;
    return fn().catch(function (er) { toast(er.message, true); }).then(function () { b.disabled = false; });
  }
  function confirmThen(msg, fn) { if (window.confirm(msg)) fn().catch(function (er) { toast(er.message, true); }); }

  function submitForm(b) {
    var fid = b.dataset.form;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Yes, submit Form ' + fid; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Submit Form ' + fid; }, 6000); return; }
    return withBusy(b, function () {
      return flush(fid).then(function () { return api('POST', 'case/' + S.view.case.id + '/submit', { form: fid }); }).then(function () {
        toast('Submitted.');
        S.sec = 0;
        return reload().then(function () { if (fid === 'A') go({ c: S.view.case.id, v: 'reviewers' }, true); else go({ c: S.view.case.id, v: fid === 'B' ? 'overview' : 'overview' }, true); });
      });
    });
  }

  function readGoals() {
    if (GOALS === null) return;
    var items = root.querySelectorAll('.ev-goal--edit');
    items.forEach(function (li) {
      var i = Number(li.dataset.gi), g = GOALS[i];
      if (!g) return;
      li.querySelectorAll('[data-g]').forEach(function (f) { g[f.dataset.g] = f.value; });
    });
  }
  function saveGoals(b) {
    readGoals();
    var body = { goals: GOALS.map(function (g) { return { id: g.id, area: g.area, goal: g.goal, steps: g.steps, support: g.support, targetDate: g.target_date, courseId: g.course_id }; }) };
    return withBusy(b, function () { return api('PUT', 'case/' + S.view.case.id + '/goals', body).then(function (d) { S.view.summary.goals = d.goals; GOALS = d.goals.map(function (g) { return JSON.parse(JSON.stringify(g)); }); var m = document.getElementById('ev-goalmsg'); if (m) m.textContent = 'Saved'; render(true); }); });
  }
  function share(b) {
    readGoals();
    var meet = $('#ev-meet').value;
    var go1 = function (fewer) {
      return withBusy(b, function () {
        return flush('C').then(function () { return saveGoalsQuiet(); }).then(function () { return api('POST', 'case/' + S.view.case.id + '/submit', { form: 'C', meetingOn: meet, proceedWithFewer: !!fewer }); }).then(function () { toast('Shared with the employee.'); GOALS = null; return reload(); });
      });
    };
    var rv = (S.view.reviewers || []).filter(function (x) { return x.status === 'submitted'; }).length;
    if (rv < S.forms.limits.reviewersMin) { if (!window.confirm('Only ' + rv + ' of ' + S.forms.limits.reviewersMin + ' feedback forms are in. Share the summary with what you have?')) return; return go1(true); }
    if (!window.confirm('Share the summary and plan with the employee now?')) return;
    return go1(false);
  }
  function saveGoalsQuiet() {
    return api('PUT', 'case/' + S.view.case.id + '/goals', { goals: GOALS.map(function (g) { return { id: g.id, area: g.area, goal: g.goal, steps: g.steps, support: g.support, targetDate: g.target_date, courseId: g.course_id }; }) });
  }

  /* ---------------------------------------------------------------------------------------------------- routing */

  function render(keepScroll) {
    var y = window.scrollY, focusId = document.activeElement && document.activeElement.id;
    if (!S.mine) return;
    var p = qs();
    if (!p.c) { root.innerHTML = homeHtml(); document.title = 'Evaluations | FavorOS'; }
    else if (!S.view) { root.innerHTML = '<p class="ev-loading">Opening</p>'; }
    else { root.innerHTML = caseHtml(); document.title = 'Evaluation | FavorOS'; }
    root.querySelectorAll('textarea[data-text]').forEach(grow);
    if (keepScroll) window.scrollTo(0, y);
    if (focusId && keepScroll) { var f = document.getElementById(focusId); if (f && f.focus) f.focus(); }
    root.hidden = false;
    var ld = document.getElementById('ev-loading'); if (ld) ld.remove();
  }
  function reload() {
    if (!S.view) return loadMine().then(render);
    var id = S.view.case.id;
    return Promise.all([api('GET', 'case/' + id), loadMine()]).then(function (r) { S.view = r[0].view; render(true); });
  }
  function loadMine() { return api('GET', 'me').then(function (d) { S.mine = d; }); }
  function route() {
    var p = qs();
    S.tab = p.v;
    if (!p.c) { S.view = null; GOALS = null; return loadMine().then(render).catch(fail); }
    if (S.view && S.view.case.id === p.c) { render(); return Promise.resolve(); }
    S.view = null; render();
    return Promise.all([api('GET', 'case/' + p.c), S.mine ? Promise.resolve() : loadMine()]).then(function (r) {
      S.view = r[0].view;
      var needStaff = S.view.role.employee || S.view.role.manage;
      var needCourses = S.view.role.raw;
      return Promise.all([needStaff && !S.staff ? api('GET', 'people').then(function (d) { S.staff = d.people; }) : null, needCourses && !S.courses ? api('GET', 'courses').then(function (d) { S.courses = d.courses; }) : null]);
    }).then(function () { S.pick = []; S.pickInit = false; render(); }).catch(fail);
  }
  function fail(e) { root.hidden = false; var ld = document.getElementById('ev-loading'); if (ld) ld.remove(); root.innerHTML = '<section class="ev-empty"><h2>This did not open</h2><p>' + esc(e.message) + '</p><p><a href="/evaluations/">Back to Evaluations</a></p></section>'; }

  window.addEventListener('popstate', function () { S.sec = 0; route(); });
  api('GET', 'forms').then(function (d) { S.forms = d; return route(); }).catch(fail);
})();
