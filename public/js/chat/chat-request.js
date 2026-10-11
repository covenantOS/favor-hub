/* A request board card opened inside Favor Chat. Pressing a request card in a conversation shows the request over the chat
   (the same sheet files open in): what was asked, where it stands, the conversation on it, a comment box, and Mark done for
   the people on it. It reads and writes through the request board's own API, and draws the conversation with the board's own
   code (request-tasks.js), so a comment made here is the same comment on the board. chat.js calls attach(app). */
(function () {
  'use strict';
  var app = null, cur = null;
  var STATUS = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };
  var SURFACE = { website: 'Website', portal: 'Portal', dashboard: 'Hub', app: 'App' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(path, method, body) {
    return fetch('/api/requests/' + path, { method: method || 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || d.ok === false) { var e = new Error(d.message || 'That did not work. Try again.'); e.status = res.status; throw e; } return d; }); });
  }
  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function day(d) { return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''; }

  function paint() {
    if (!cur || !cur.req) return;
    var r = cur.req, RT = window.ReqTasks, t = r.task || null, can = r.can || {};
    var name = function (email) { return email ? (RT ? RT.person(email).name : String(email).split('@')[0]) : ''; };
    var late = t && t.due_date && r.status !== 'done' && r.status !== 'declined' && t.due_date < new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    var fields = t ? [['Owner', name(t.owner) || 'Nobody yet'], ['Due', t.due_date ? day(t.due_date) + (late ? ' (late)' : '') : 'No date'], ['Waiting on', name(t.waiting_on) || 'Nobody']] : [];
    var atts = (r.attachments || []).map(function (a) { return '<a class="ch-req__att" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.filename) + '</a>'; }).join('');
    var activity = RT && r.comments ? RT.activityHtml(r, cur.me) : '';
    var body = cur.el.querySelector('.ch-view__body'), scroll = body.querySelector('.ch-req__scroll');
    var was = scroll ? { top: scroll.scrollTop, end: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80 } : null;
    var typed = body.querySelector('[data-ta="rt"]'), text = typed ? typed.value : '';
    body.innerHTML = '<div class="ch-req"><div class="ch-req__scroll"><div class="ch-req__in">' +
      '<div class="ch-req__chips"><span class="ch-req__chip" data-s="' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span><span class="ch-req__chip">' + esc(SURFACE[r.surface] || r.surface) + '</span><span class="ch-req__chip">' + esc(r.submitter_name || '') + '</span></div>' +
      '<h2>' + esc(r.title) + '</h2>' +
      (fields.length ? '<dl class="ch-req__fields">' + fields.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
      '<div class="ch-req__body">' + linkify(r.body || '') + '</div>' + (atts ? '<div class="ch-req__atts">' + atts + '</div>' : '') +
      (activity ? '<h3 class="rt-h">Activity</h3><div class="rt-activity rt-ch" aria-live="polite">' + activity + '</div>' : '') +
      '</div></div>' +
      '<div class="ch-req__foot rt-dfoot rt-ch">' +
      (can.done || (r.status === 'done' && (can.comment || can.triage)) ? '<div class="ch-req__acts">' + (r.status === 'done' ? '<button type="button" class="ch-btn ch-btn--sm" data-rq="reopen">Reopen</button>' : '<button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-rq="done">Mark done</button>') + '</div>' : '') +
      (can.comment && RT ? RT.composerHtml('Comment, or @ to bring someone in') : '') + '</div></div>';
    var sub = cur.el.querySelector('.ch-view__t small'), title = cur.el.querySelector('.ch-view__t b');
    if (title) title.textContent = r.title;
    if (sub) sub.textContent = (STATUS[r.status] || r.status) + (t && t.owner ? ' · Owner ' + name(t.owner) : '');
    var ns = body.querySelector('.ch-req__scroll');
    if (was) ns.scrollTop = was.end ? ns.scrollHeight : was.top;
    if (can.comment && RT) {
      RT.bindComposer(body.querySelector('.ch-req__foot'), function (textOut) {
        return call(r.id + '/comments', 'POST', { body: textOut }).then(function (d) { cur.req = d.request; paint(); var s2 = cur.el.querySelector('.ch-req__scroll'); if (s2) s2.scrollTop = s2.scrollHeight; }).catch(function (e) { app.toast(e.message); throw e; });
      });
      var ta = body.querySelector('[data-ta="rt"]');
      if (ta && text) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }

  function open(id) {
    if (!app || !id) return;
    var el = app.sheet({ name: 'Request', sub: 'Request board', external: '/requests/?r=' + encodeURIComponent(id), externalShort: 'Board', externalLabel: 'Open on the request board' }, '<div class="ch-view__load"><i></i></div>', 'ch-view--req');
    if (!el) { location.href = '/requests/?r=' + encodeURIComponent(id); return; }
    var mine = (cur = { id: id, el: el, req: null, me: (app.state.me && app.state.me.id) || '' });
    var RT = window.ReqTasks;
    Promise.all([call(encodeURIComponent(id)), RT ? RT.people() : null]).then(function (both) {
      if (cur !== mine) return;
      cur.req = both[0].request;
      paint();
      // The notices about this request are read once it has been opened here, as on the board.
      call(encodeURIComponent(id) + '/read', 'POST', {}).then(function () { if (window.WCBell && window.WCBell.refresh) window.WCBell.refresh(); }).catch(function () {});
    }).catch(function (e) {
      if (cur !== mine) return;
      el.querySelector('.ch-view__body').innerHTML = '<div class="ch-view__fail"><p>' + esc(e.status === 404 ? 'This request is no longer on the board.' : e.message) + '</p></div>';
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rq]'), del = e.target.closest('[data-rt-del]');
      if (b && cur === mine && cur.req) {
        b.disabled = true;
        call(cur.req.id + '/' + b.dataset.rq, 'POST', {}).then(function (d) { cur.req = d.request; paint(); app.toast(b.dataset.rq === 'done' ? 'Marked done' : 'Reopened'); }).catch(function (err) { b.disabled = false; app.toast(err.message); });
      }
      if (del && cur === mine && cur.req) call(cur.req.id + '/comments/' + encodeURIComponent(del.getAttribute('data-rt-del')), 'DELETE').then(function (d) { cur.req = d.request; paint(); }).catch(function (err) { app.toast(err.message); });
    });
  }
  document.addEventListener('favor-chat:view-closed', function () { cur = null; });

  window.FavorChatRequest = { attach: function (a) { app = a; }, open: open };
})();
