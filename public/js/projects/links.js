/* Projects links (lane LINKS): the pieces that tie projects and tasks into the rest of the hub, loaded on every hub page.
   - PJLinks.openTask(ref)            opens a task in place: the Projects drawer when the page has one (window.PJDrawer.open), else a
                                       quick sheet with the task, its comments and a box to reply. Used by the task card in Chat.
   - PJLinks.makeTask(opts)           the Make a task dialog (from a Chat message, or empty)
   - PJLinks.prefs()                  project email and calendar choices
   - [data-pj-links data-task=REF]    the Links panel of a task (Chat, Drive, Clips, expense request, calendar, meeting). The task
                                       drawer puts one empty element with those two attributes where the panel goes.
   - [data-pj-project-links data-project=KEY]  Open the project's channel and folder
   - the meeting notes page gets a Make a task / Task KEY-1 link on each action item
   Every call goes to /api/tasks/links/* or the Projects routes; a person without Projects access sees nothing. */
(function () {
  'use strict';
  if (window.PJLinks) return;

  var L = '/api/tasks/links/';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';

  /* ------------------------------------------------------------------ plumbing */
  function ensureCss() {
    if (document.querySelector('link[href^="/css/projects-links.css"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/projects-links.css?v=1';
    document.head.appendChild(l);
  }

  function call(method, path, body) {
    var init = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined && method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok || !data || data.ok === false) {
          var e = new Error((data && data.message) || 'Something went wrong. Try again.');
          e.code = (data && data.error) || 'error';
          e.status = res.status;
          throw e;
        }
        return data;
      });
    }, function () { var e = new Error('You look to be offline. Try again when the connection is back.'); e.code = 'network'; throw e; });
  }

  function toast(msg, href) {
    var t = document.createElement('div');
    t.className = 'h-toast';
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2a2722;color:#fff;padding:10px 18px;border-radius:999px;font:500 14px Inter,system-ui,sans-serif;z-index:3200;max-width:calc(100vw - 24px);display:flex;gap:12px;align-items:center';
    t.textContent = msg;
    if (href) { var a = document.createElement('a'); a.href = href; a.textContent = 'Open'; a.style.cssText = 'color:#cfe3c4;font-weight:700'; t.appendChild(a); }
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 5200);
  }

  /** A sheet (side panel on a desktop, bottom sheet on a phone) or a dialog. Back, Escape and a tap outside close it. */
  function overlay(opts) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'pjl-ov' + (opts.dialog ? ' pjl-ov--dlg' : '') + (opts.full ? ' pjl-ov--full' : '');
    el.innerHTML = '<div class="pjl-ov__bg" data-x></div><div class="pjl-sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '"><div class="pjl-sheet__h"><h3>' + esc(opts.title) + '</h3><button type="button" class="pjl-x" data-x aria-label="Close">' + X + '</button></div><div class="pjl-sheet__b"></div>' + (opts.foot ? '<div class="pjl-sheet__f"></div>' : '') + '</div>';
    document.body.appendChild(el);
    var tok = null, done = false, prevFocus = document.activeElement;
    function close(fromBack) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', key, true);
      if (tok && window.hubOv && !fromBack) window.hubOv.off(tok);
      el.remove();
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* gone */ } }
      if (opts.onClose) opts.onClose();
    }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
    document.addEventListener('keydown', key, true);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) close(); });
    if (window.hubOv) tok = window.hubOv.on(function () { close(true); });
    var first = el.querySelector('.pjl-x'); if (first) first.focus();
    return { el: el, body: $('.pjl-sheet__b', el), foot: $('.pjl-sheet__f', el), close: close };
  }

  function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '?'; }
  function av(p) { return '<span class="pjl-av">' + (p && p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(p && p.name))) + '</span>'; }
  function plain(t) { return String(t || '').replace(/<@([^>\s]+)>/g, function (_a, id) { return '@' + (id === 'brain' ? 'Favor Brain' : String(id).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })); }); }
  function dayLabel(d) { return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''; }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  var STATUS = { open: 'Open', doing: 'In progress', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' };
  var todayEt = function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); };

  /* ------------------------------------------------------------------ open a task in place */
  function openTask(ref, opts) {
    ref = String(ref || '');
    if (!ref) return;
    if (window.PJ && typeof window.PJ.openTask === 'function' && (window.PJ.ctx || window.PJ.homeCtx)) { window.PJ.openTask(ref); return; }
    if (window.PJDrawer && typeof window.PJDrawer.open === 'function') { window.PJDrawer.open(ref, opts || {}); return; }
    sharedDrawer(ref).catch(function () { quickSheet(ref); });
  }

  /* Every other page opens the Projects drawer itself: its stylesheets (listed in /_app/projects-assets.json at build) and drawer.js load on the first press. */
  var drawerP = null;
  function sharedDrawer(ref) {
    if (!drawerP) {
      drawerP = fetch('/_app/projects-assets.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { css: [] }; }).catch(function () { return { css: [] }; }).then(function (a) {
        (a.css || []).forEach(function (href) {
          if (document.querySelector('link[href="' + href + '"]')) return;
          var l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = href;
          document.head.appendChild(l);
        });
        return import('/js/projects/drawer.js');
      });
      drawerP.catch(function () { drawerP = null; });
    }
    return drawerP.then(function (m) { return m.openDrawer(null, ref); });
  }

  function quickSheet(ref) {
    var ov = overlay({ title: 'Task', foot: true, full: true });
    ov.body.innerHTML = '<p class="pjl-muted">Loading the task.</p>';
    var data = null;
    function draw() {
      var t = data.task, done = t.status === 'done';
      var late = t.due_date && t.due_date < todayEt() && !done;
      var url = t.project && t.code ? '/projects/p/?p=' + encodeURIComponent(t.project.key) + '&t=' + encodeURIComponent(t.code) : '/projects/?t=' + encodeURIComponent(t.id);
      $('h3', ov.el).textContent = (t.code ? t.code + ' ' : '') + t.title;
      ov.body.innerHTML =
        '<div class="pjl-task__meta"><span class="pjl-chip ' + (done ? 'pjl-chip--ok' : '') + '">' + esc(STATUS[t.status] || t.status) + '</span>' +
        (t.project ? '<span class="pjl-chip">' + esc(t.project.name) + '</span>' : '') +
        (t.owner ? '<span class="pjl-chip">Owner ' + esc(t.owner.name) + '</span>' : '<span class="pjl-chip">No owner</span>') +
        (t.due_date ? '<span class="pjl-chip ' + (late ? 'pjl-chip--bad' : '') + '">Due ' + esc(dayLabel(t.due_date)) + '</span>' : '') + '</div>' +
        (t.description ? '<div class="pjl-task__desc">' + esc(plain(t.description)) + '</div>' : '') +
        '<div class="pjl-list">' + (data.comments || []).map(function (c) {
          return '<div class="pjl-cm">' + av(c.author) + '<div><div class="pjl-cm__h">' + esc(c.author ? c.author.name : c.author_email) + '<small>' + esc(ago(c.created_at)) + '</small></div><div class="pjl-cm__b">' + esc(plain(c.body)) + '</div></div></div>';
        }).join('') + '</div>' +
        '<label class="pjl-field"><span>Reply</span><textarea class="pjl-text" data-reply rows="3" placeholder="Write a comment"></textarea></label><p class="pjl-err" data-err hidden></p>';
      ov.foot.innerHTML = '<a class="pjl-btn pjl-btn--quiet" href="' + esc(url) + '">Open the full task</a>' +
        '<button type="button" class="pjl-btn" data-done>' + (done ? 'Reopen' : 'Mark done') + '</button><button type="button" class="pjl-btn pjl-btn--primary" data-send>Comment</button>';
    }
    function load() {
      return call('GET', '/api/tasks/' + encodeURIComponent(ref)).then(function (d) { data = d; draw(); }, function (e) {
        ov.body.innerHTML = '<p class="pjl-err">' + esc(e.status === 404 ? 'That task is gone or not shared with you.' : e.message) + '</p>';
      });
    }
    ov.el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !data) return;
      var err = $('[data-err]', ov.el);
      if (b.hasAttribute('data-done')) {
        b.disabled = true;
        call('PATCH', '/api/tasks/' + encodeURIComponent(data.task.id), { done: data.task.status !== 'done' }).then(load, function (er) { b.disabled = false; err.textContent = er.message; err.hidden = false; });
      } else if (b.hasAttribute('data-send')) {
        var box = $('[data-reply]', ov.el), v = box.value.trim();
        if (!v) { err.textContent = 'Write a comment first.'; err.hidden = false; return; }
        b.disabled = true;
        call('POST', '/api/tasks/' + encodeURIComponent(data.task.id) + '/comments', { body: v }).then(load, function (er) { b.disabled = false; err.textContent = er.message; err.hidden = false; });
      }
    });
    load();
  }

  /* ------------------------------------------------------------------ Make a task */
  var peopleP = null, projectsP = null;
  function people() { return peopleP || (peopleP = call('GET', '/api/requests/people').then(function (d) { return d; })); }
  function projectsList() { return projectsP || (projectsP = call('GET', '/api/projects').then(function (d) { return d.projects || []; }).catch(function () { return []; })); }

  /** opts: { messageId, title, project (key), owner (email) } */
  function makeTask(opts) {
    opts = opts || {};
    var ov = overlay({ title: opts.messageId ? 'Make a task from this message' : 'Make a task', dialog: true, foot: true });
    ov.body.innerHTML = '<p class="pjl-muted">Loading.</p>';
    Promise.all([people(), projectsList()]).then(function (r) {
      var me = r[0].me, list = r[0].people || [], pr = r[1];
      ov.body.innerHTML =
        '<label class="pjl-field"><span>Title</span><input class="pjl-input" data-title maxlength="140" value="' + esc(opts.title || '') + '" placeholder="What needs doing" /></label>' +
        '<div class="pjl-two"><label class="pjl-field"><span>Project</span><select class="pjl-select" data-project><option value="">My tasks (no project)</option>' +
        pr.filter(function (p) { return p.status !== 'archived'; }).map(function (p) { return '<option value="' + esc(p.key) + '"' + (opts.project === p.key ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="pjl-field"><span>Owner</span><select class="pjl-select" data-owner>' + list.map(function (p) { return '<option value="' + esc(p.email) + '"' + (p.email === (opts.owner || me) ? ' selected' : '') + '>' + esc(p.name) + (p.email === me ? ' (you)' : '') + '</option>'; }).join('') + '</select></label></div>' +
        '<label class="pjl-field"><span>Due date</span><input class="pjl-input" type="date" data-due /></label><p class="pjl-err" data-err hidden></p>';
      ov.foot.innerHTML = '<button type="button" class="pjl-btn" data-x>Cancel</button><button type="button" class="pjl-btn pjl-btn--primary" data-go>Make the task</button>';
      var t = $('[data-title]', ov.el); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    }, function (e) { ov.body.innerHTML = '<p class="pjl-err">' + esc(e.message) + '</p>'; });
    ov.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]'); if (!b) return;
      var err = $('[data-err]', ov.el), title = $('[data-title]', ov.el).value.trim();
      if (!title) { err.textContent = 'Give the task a title.'; err.hidden = false; return; }
      var body = { title: title, project: $('[data-project]', ov.el).value || null, owner: $('[data-owner]', ov.el).value, due: $('[data-due]', ov.el).value || null };
      b.disabled = true;
      var req = opts.messageId
        ? call('POST', L + 'chat/make-task', Object.assign({ message_id: opts.messageId }, body))
        : call('POST', '/api/tasks', { title: body.title, project_id: body.project || undefined, owner_email: body.owner, due_date: body.due || undefined }).then(function (d) { return { task: { code: d.task.code, url: d.task.code && d.task.project ? '/projects/p/?p=' + d.task.project.key + '&t=' + d.task.code : '/projects/?t=' + d.task.id }, existing: false }; });
      req.then(function (d) {
        ov.close();
        toast(d.existing ? 'That message already has a task' + (d.task.code ? ', ' + d.task.code : '') + '.' : 'Task made' + (d.task.code ? ': ' + d.task.code : '') + '.', d.task.url);
        if (opts.onMade) opts.onMade(d);
      }, function (er) { b.disabled = false; err.textContent = er.message; err.hidden = false; });
    });
  }

  /* ------------------------------------------------------------------ project email and calendar */
  function prefs() {
    var ov = overlay({ title: 'Project notices', dialog: true, foot: true });
    ov.body.innerHTML = '<p class="pjl-muted">Loading.</p>';
    function draw(p) {
      var cal = p.google;
      ov.body.innerHTML =
        '<div class="pjl-seg" role="radiogroup" aria-label="Project email">' +
        [['now', 'Each notice', 'One email when a task is given to you, you are mentioned or someone comments.'], ['daily', 'Daily summary', 'One email each weekday morning with what is new.'], ['off', 'No email', 'Notices stay in the bell and on Today.']].map(function (o) {
          return '<label class="pjl-opt"><input type="radio" name="pjl-mail" value="' + o[0] + '"' + (p.mail_mode === o[0] ? ' checked' : '') + ' /><span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>';
        }).join('') + '</div>' +
        '<label class="pjl-opt"><input type="checkbox" data-cal' + (p.calendar ? ' checked' : '') + ' /><span><b>Due dates on my Google Calendar</b><small>' +
        (!cal.connected ? 'Connect Google first, from the sign-in step.' : !cal.calendar ? 'Google needs your permission once to add events to your calendar.' : 'Tasks you own appear on your calendar on their due date.') + '</small></span></label>' +
        (cal.connected && !cal.calendar && p.calendar ? '<a class="pjl-btn" href="' + esc(p.connect_url) + '">Allow calendar events</a>' : '') + '<p class="pjl-err" data-err hidden></p>';
      ov.foot.innerHTML = '<button type="button" class="pjl-btn" data-x>Close</button>';
    }
    call('GET', L + 'prefs').then(draw, function (e) { ov.body.innerHTML = '<p class="pjl-err">' + esc(e.message) + '</p>'; });
    ov.el.addEventListener('change', function (e) {
      var body = e.target.name === 'pjl-mail' ? { mail_mode: e.target.value } : e.target.hasAttribute('data-cal') ? { calendar: e.target.checked } : null;
      if (!body) return;
      call('PUT', L + 'prefs', body).then(draw, function (er) { var x = $('[data-err]', ov.el); x.textContent = er.message; x.hidden = false; });
    });
  }

  /* ------------------------------------------------------------------ the Links panel on a task */
  var INTENT = 'pjl.clipIntent';

  function mountLinks(el) {
    if (el.__pjl) return;
    el.__pjl = true;
    ensureCss();
    var ref = el.getAttribute('data-task');
    var state = { d: null, pick: null, q: '', items: [], busy: false, msg: '' };
    el.classList.add('pjl-links');

    function section(title, inner, extra) { return '<div class="pjl-sec"><div class="pjl-sec__h"><span>' + title + '</span>' + (extra || '') + '</div>' + inner + '</div>'; }
    function render() {
      var d = state.d;
      if (!d) { el.innerHTML = '<p class="pjl-muted">Loading links.</p>'; return; }
      var can = d.can && d.can.edit;
      var html = '';
      // Chat
      html += section('Chat',
        (d.chat.shared_in.length ? d.chat.shared_in.map(function (c) { return '<div class="pjl-item"><span class="t">Shared in ' + esc(c.name) + '</span><a class="pjl-btn pjl-btn--quiet" href="' + esc(c.url) + '">Open</a></div>'; }).join('') : '<p class="pjl-muted">Not shared in Chat yet.</p>') +
        '<div class="pjl-row">' + (d.project ? '<button type="button" class="pjl-btn" data-a="share">Share in ' + esc(d.project.name) + ' channel</button>' : '') + '</div>');
      // Meeting
      if (d.meeting) html += section('Meeting', '<div class="pjl-item"><span class="t">' + esc(d.meeting.title) + (d.meeting.stamp ? ' <small>at ' + esc(d.meeting.stamp) + ' in the transcript</small>' : '') + '</span><a class="pjl-btn pjl-btn--quiet" href="' + esc(d.meeting.url) + '">Open notes</a></div>');
      // Files: clips and Drive
      html += section('Clips', (d.clips.length ? d.clips.map(function (c) { return '<div class="pjl-item"><span class="t">' + esc(c.name) + '</span><a class="pjl-btn pjl-btn--quiet" href="' + esc(c.url) + '">Watch</a></div>'; }).join('') : '<p class="pjl-muted">No clip on this task.</p>') +
        (can ? '<div class="pjl-row"><button type="button" class="pjl-btn" data-a="rec" data-as="brief">Record the brief</button><button type="button" class="pjl-btn" data-a="rec" data-as="proof">Record proof</button><button type="button" class="pjl-btn pjl-btn--quiet" data-a="clips">Attach a clip</button></div>' : ''));
      html += section('Drive',
        '<div class="pjl-row"><button type="button" class="pjl-btn" data-a="drive">Attach from Drive</button>' + (d.project ? (d.project.drive_folder_id ? '<button type="button" class="pjl-btn pjl-btn--quiet" data-a="folder-files">Project folder files</button><a class="pjl-btn pjl-btn--quiet" target="_blank" rel="noopener" href="' + esc(d.project.drive_url) + '">Open folder</a>' : (can ? '<button type="button" class="pjl-btn pjl-btn--quiet" data-a="folder-make">Make the project folder</button>' : '')) : '') + '</div>' +
        (state.pick && (state.pick === 'drive' || state.pick === 'folder') ? drivePicker() : ''));
      // Expense request
      html += section('Expense request', d.expense ? expenseCard(d.expense, can) : '<p class="pjl-muted">No expense request on this task.</p>' + (can ? '<div class="pjl-row"><button type="button" class="pjl-btn" data-a="exp-pick">Link one of mine</button><a class="pjl-btn pjl-btn--quiet" target="_blank" rel="noopener" href="/expenses/new">Start a new one</a></div>' : '') + (state.pick === 'expense' ? expensePicker() : ''));
      // Calendar
      html += section('Calendar', '<p class="pjl-muted">' + esc(d.calendar.label) + '</p>' + '<div class="pjl-row"><button type="button" class="pjl-btn pjl-btn--quiet" data-a="prefs">My notice choices</button></div>');
      if (state.pick === 'clips') html += section('Pick a clip', clipPicker());
      html += state.msg ? '<p class="pjl-' + (state.msg.charAt(0) === '!' ? 'err' : 'muted') + '">' + esc(state.msg.replace(/^!/, '')) + '</p>' : '';
      el.innerHTML = html;
    }
    function drivePicker() {
      return '<div class="pjl-field"><input class="pjl-input" data-q placeholder="Search Drive by name" value="' + esc(state.q) + '" /></div><div class="pjl-pick">' +
        (state.items.length ? state.items.map(function (f, i) { return '<button type="button" data-a="drive-add" data-i="' + i + '"><b>' + esc(f.name) + '</b><small>' + esc([f.path, f.indexed].filter(Boolean).join(' · ')) + '</small></button>'; }).join('') : '<p class="pjl-muted">' + (state.q.length < 2 && state.pick === 'drive' ? 'Type two letters to search.' : 'No files found.') + '</p>') + '</div>';
    }
    function clipPicker() {
      return '<div class="pjl-pick">' + (state.items.length ? state.items.map(function (c, i) { return '<button type="button" data-a="clip-add" data-i="' + i + '"><b>' + esc(c.title) + '</b><small>' + esc([c.duration, c.when].filter(Boolean).join(' · ')) + '</small></button>'; }).join('') : '<p class="pjl-muted">No clips yet. Record one with the camera button.</p>') + '</div><div class="pjl-row"><button type="button" class="pjl-btn" data-a="clip-as" data-as="brief">As the brief</button><button type="button" class="pjl-btn" data-a="clip-as" data-as="proof">As proof</button></div>';
    }
    function expenseCard(x, can) {
      return '<div class="pjl-item"><span class="t"><b>' + esc(x.doc_number) + '</b> ' + esc(x.total) + '<br /><small>' + esc(x.reason) + '</small></span><span class="pjl-chip ' + (x.signed ? 'pjl-chip--ok' : x.status === 'declined' ? 'pjl-chip--bad' : 'pjl-chip--warn') + '">' + esc(x.status_label) + '</span></div>' +
        (x.signed && x.decided_at ? '<p class="pjl-muted">Signed by ' + esc(x.approver) + ' on ' + esc(new Date(x.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '.</p>' : x.status === 'declined' && x.decline_note ? '<p class="pjl-muted">' + esc(x.decline_note) + '</p>' : '<p class="pjl-muted">Waiting for ' + esc(x.approver) + '.</p>') +
        '<div class="pjl-row"><a class="pjl-btn pjl-btn--quiet" href="' + esc(x.url) + '">Open expenses</a>' + (can ? '<button type="button" class="pjl-btn pjl-btn--quiet" data-a="exp-unlink">Unlink</button>' : '') + '</div>';
    }
    function expensePicker() {
      return '<div class="pjl-pick">' + (state.items.length ? state.items.map(function (x, i) { return '<button type="button" data-a="exp-add" data-i="' + i + '"><b>' + esc(x.doc_number) + ' ' + esc(x.total) + '</b><small>' + esc(x.status_label + ' · ' + x.reason) + '</small></button>'; }).join('') : '<p class="pjl-muted">You have no expense requests yet.</p>') + '</div>';
    }

    function load() { return call('GET', L + 'task/' + encodeURIComponent(ref) + '/links').then(function (d) { state.d = d; render(); }, function (e) { el.innerHTML = '<p class="pjl-muted">' + esc(e.status === 404 ? '' : e.message) + '</p>'; }); }
    function say(m) { state.msg = m; render(); }
    function post(path, body, method) { return call(method || 'POST', L + 'task/' + encodeURIComponent(ref) + '/' + path, body); }

    var timer = 0;
    el.addEventListener('input', function (e) {
      if (!e.target.hasAttribute('data-q')) return;
      state.q = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (state.pick === 'drive') {
          if (state.q.trim().length < 2) { state.items = []; render(); return; }
          call('GET', L + 'drive?q=' + encodeURIComponent(state.q.trim())).then(function (r) { state.items = r.files || []; var q = $('[data-q]', el); render(); var n = $('[data-q]', el); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, function () { state.items = []; render(); });
        }
      }, 250);
    });
    var chosenAs = 'brief', chosenClip = null;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), i = Number(b.getAttribute('data-i'));
      if (a === 'share') {
        post('chat', {}).then(function (r) { say('Shared in the project channel.'); toast('Shared in the project channel.', r.url); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'rec') {
        var as = b.getAttribute('data-as');
        try { sessionStorage.setItem(INTENT, JSON.stringify({ task: ref, as: as, at: Date.now() })); } catch (x) { /* no storage */ }
        var cam = document.getElementById('clip-cam');
        if (cam) { cam.click(); say('Record the clip. It is added to this task as the ' + (as === 'proof' ? 'proof' : 'brief') + ' when it is saved.'); } else say('!The recorder is not available on this page.');
      } else if (a === 'clips') {
        state.pick = state.pick === 'clips' ? null : 'clips'; state.items = []; chosenClip = null; render();
        if (state.pick) call('GET', L + 'clips').then(function (r) { state.items = r.clips || []; render(); });
      } else if (a === 'clip-add') { chosenClip = state.items[i]; say('Picked "' + chosenClip.title + '". Choose how to add it.'); }
      else if (a === 'clip-as') {
        if (!chosenClip) { say('!Pick a clip first.'); return; }
        post('clip', { clip_id: chosenClip.id, as: b.getAttribute('data-as') }).then(function () { state.pick = null; say('Clip added.'); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'drive' || a === 'folder-files') {
        state.pick = a === 'drive' ? 'drive' : 'folder'; state.q = ''; state.items = []; render();
        if (a === 'folder-files') call('GET', L + 'project/' + encodeURIComponent(state.d.project.key) + '/files').then(function (r) { state.items = r.files || []; render(); }, function (er) { say('!' + er.message); });
      } else if (a === 'drive-add') {
        var f = state.items[i];
        call('POST', '/api/tasks/' + encodeURIComponent(ref) + '/files', { kind: 'drive', name: f.name, url: f.url }).then(function () { state.pick = null; say('Attached ' + f.name + '.'); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'folder-make') {
        call('POST', L + 'project/' + encodeURIComponent(state.d.project.key) + '/folder', {}).then(function () { say('Project folder made in US Team Files.'); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'exp-pick') {
        state.pick = 'expense'; state.items = []; render();
        call('GET', L + 'expense/mine').then(function (r) { state.items = r.expenses || []; render(); });
      } else if (a === 'exp-add') {
        post('expense', { expense_id: state.items[i].id }, 'PUT').then(function () { state.pick = null; say('Expense request linked.'); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'exp-unlink') {
        post('expense', { expense_id: null }, 'PUT').then(function () { say('Unlinked.'); load(); }, function (er) { say('!' + er.message); });
      } else if (a === 'prefs') prefs();
    });
    el.__pjlReload = load;
    load();
  }

  function mountProject(el) {
    if (el.__pjl) return;
    el.__pjl = true;
    ensureCss();
    var key = el.getAttribute('data-project');
    el.innerHTML = '<button type="button" class="pjl-btn" data-a="chan">Open the project channel</button> <button type="button" class="pjl-btn pjl-btn--quiet" data-a="fold">Open the project folder</button>';
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      b.disabled = true;
      var go = b.getAttribute('data-a') === 'chan'
        ? call('POST', L + 'project/' + encodeURIComponent(key) + '/channel', {}).then(function (r) { location.href = r.url; })
        : call('POST', L + 'project/' + encodeURIComponent(key) + '/folder', {}).then(function (r) { window.open(r.folder.url, '_blank', 'noopener'); });
      go.then(function () { b.disabled = false; }, function (er) { b.disabled = false; toast(er.message); });
    });
  }

  /* ------------------------------------------------------------------ a clip recorded for a task */
  window.addEventListener('clips:changed', function (e) {
    var id = e && e.detail && e.detail.id;
    var raw = null;
    try { raw = JSON.parse(sessionStorage.getItem(INTENT) || 'null'); } catch (x) { raw = null; }
    if (!id || !raw || Date.now() - raw.at > 45 * 60 * 1000) return;
    try { sessionStorage.removeItem(INTENT); } catch (x) { /* no storage */ }
    call('POST', L + 'task/' + encodeURIComponent(raw.task) + '/clip', { clip_id: id, as: raw.as }).then(function () {
      toast('Clip added to the task as the ' + (raw.as === 'proof' ? 'proof' : 'brief') + '.');
      document.querySelectorAll('[data-pj-links]').forEach(function (n) { if (n.__pjlReload) n.__pjlReload(); });
    }, function (er) { toast(er.message); });
  });

  /* ------------------------------------------------------------------ the meeting notes page */
  function notesPage() {
    if (!/^\/meet\/notes\/?$/.test(location.pathname)) return;
    var mid = new URLSearchParams(location.search).get('m');
    if (!mid) return;
    var map = null, loading = false;
    function paint() {
      document.querySelectorAll('label.act input[data-idx]').forEach(function (cb) {
        var row = cb.closest('label.act'); if (!row || row.querySelector('.pjl-act')) return;
        var idx = cb.getAttribute('data-idx'), t = map && map[idx];
        var s = document.createElement('span'); s.className = 'pjl-act';
        s.innerHTML = t ? '<a class="pjl-btn" href="' + esc(t.url) + '">Task ' + esc(t.code || 'open') + '</a>' : '<button type="button" class="pjl-btn" data-pjl-act="' + esc(idx) + '">Make a task</button>';
        var box = row.querySelector('div') || row; box.appendChild(s);
      });
    }
    function load() {
      if (loading) return; loading = true;
      call('GET', L + 'meet/actions?meeting_id=' + encodeURIComponent(mid)).then(function (r) { map = r.tasks || {}; loading = false; paint(); }, function () { loading = false; map = null; });
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pjl-act]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      b.disabled = true;
      call('POST', L + 'meet/action-task', { meeting_id: mid, idx: Number(b.getAttribute('data-pjl-act')) }).then(function (r) {
        toast('Task made' + (r.task.code ? ': ' + r.task.code : '') + '.', r.task.url);
        map = map || {}; map[b.getAttribute('data-pjl-act')] = { url: r.task.url, code: r.task.code };
        var host = b.closest('.pjl-act'); if (host) host.innerHTML = '<a class="pjl-btn" href="' + esc(r.task.url) + '">Task ' + esc(r.task.code || 'open') + '</a>';
      }, function (er) { b.disabled = false; toast(er.message); });
    }, true);
    var nt = 0;
    new MutationObserver(function () { cancelAnimationFrame(nt); nt = requestAnimationFrame(function () { if (document.querySelector('label.act') && !document.querySelector('.pjl-act')) { if (map) paint(); else load(); } }); }).observe(document.body, { childList: true, subtree: true });
    load();
  }

  /* ------------------------------------------------------------------ start */
  function scan() {
    document.querySelectorAll('[data-pj-links]').forEach(mountLinks);
    document.querySelectorAll('[data-pj-project-links]').forEach(mountProject);
  }
  var scanT = 0;
  new MutationObserver(function () { cancelAnimationFrame(scanT); scanT = requestAnimationFrame(scan); }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  notesPage();

  window.PJLinks = { openTask: openTask, makeTask: makeTask, prefs: prefs, toast: toast, call: call, ensureCss: ensureCss, esc: esc };
})();
