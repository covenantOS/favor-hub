/* Learn, Manage (hub admins and people marked HR): courses, learning paths, assignments, reports, and the course editor.
   Build a course from what exists: search the help library, your Clips and Drive in one box, add a written page, a quiz or a link,
   record a Clip straight into a lesson, and drag lessons into order (the arrows do the same for a keyboard or a touch screen). */
(() => {
  'use strict';
  const root = document.getElementById('ln');
  if (!root || window.__learnAdmin) return;
  window.__learnAdmin = true;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayWord = (ymd) => { const [, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const mins = (m) => (m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const IC = {
    video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    article: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    page: '<path d="M6 3h12v18H6z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    clip: '<rect x="3" y="8" width="14" height="11" rx="2"/><path d="M7 5h12a2 2 0 0 1 2 2v9"/><path d="m8.5 11.5 4 2-4 2z"/>',
    link: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    quiz: '<path d="m9 11 3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
    course: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2"/><path d="M8 7h7"/><path d="M8 11h5"/>',
    path: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    grip: '<path d="M9 6h.01"/><path d="M15 6h.01"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M9 18h.01"/><path d="M15 18h.01"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
  const KIND = { video: 'Video', article: 'Article', doc: 'Document', page: 'Written page', clip: 'Clip', link: 'Link', quiz: 'Quiz' };
  const COLORS = ['leaf', 'teal', 'sky', 'sun', 'dusk', 'terra', 'slate'];
  const STATUS = { draft: 'Draft', published: 'Published', archived: 'Archived' };

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'X-Hub-Request': '1' }, o.body ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, o, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const e = new Error(data.message || 'Something went wrong. Try again.');
      e.status = res.status;
      e.code = data.error;
      throw e;
    }
    return data;
  }
  const send = (method, path, body) => api(path, { method, body: JSON.stringify(body || {}) });

  let toastEl = null;
  let toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ln-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 3400);
  }

  /** A dialog that the back gesture and Escape both close. Returns { el, close }. */
  function modal(html, cls) {
    const el = document.createElement('dialog');
    el.className = 'ln-dlg' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    document.body.appendChild(el);
    let tok = null;
    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      if (tok && window.hubOv) window.hubOv.off(tok);
      try { el.close(); } catch (e) { /* not open */ }
      el.remove();
    };
    el.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.showModal();
    if (window.hubOv) tok = window.hubOv.on(() => { tok = null; close(); });
    return { el, close };
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      const m = modal(`<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn ${danger ? 'h-btn--warn' : 'h-btn--primary'}" data-yes>${esc(okLabel)}</button></div></form>`);
      let answered = false;
      const done = (v) => { if (answered) return; answered = true; m.close(); resolve(v); };
      $('[data-no]', m.el).addEventListener('click', () => done(false));
      $('form', m.el).addEventListener('submit', (e) => { e.preventDefault(); done(true); });
      m.el.addEventListener('close', () => done(false));
      $('[data-yes]', m.el).focus();
    });
  }

  const link = (href, inner, cls, attrs) => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}"${attrs || ''}>${inner}</a>`;
  const colorTile = (c, icon, sm) => `<span class="ln-tile${sm ? ' ln-tile--sm' : ''} ln-c--${esc(c || 'leaf')}">${svg(icon)}</span>`;
  const statusChip = (s) => `<span class="ln-chip${s === 'published' ? ' ln-chip--ok' : s === 'archived' ? '' : ' ln-chip--due'}">${esc(STATUS[s] || s)}</span>`;
  const view = root.dataset.view;
  const query = new URLSearchParams(location.search);

  let me = { admin: false };
  try {
    const n = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null');
    me = { admin: !!(n && n.access && n.access.admin) };
  } catch (e) { /* the settings strip stays hidden */ }

  function fail(err) {
    root.innerHTML = `<div class="ln-empty" role="alert"><b>${err && err.status === 403 ? 'Managing learning is for admins and HR' : 'That did not load'}</b><p>${esc((err && err.message) || 'Try again.')}</p><div class="ln-chips"><button type="button" class="h-btn h-btn--primary" onclick="location.reload()">Try again</button><a class="h-btn h-btn--ghost" href="/learn/">My learning</a></div></div>`;
    root.removeAttribute('aria-busy');
  }

  /* ================================================================== the Manage page */
  const A = { tab: 'courses', overview: null, people: null, report: null, filters: { course: '', path: '', team: '', status: '', q: '' }, assign: { target: '', who: 'people', team: '', emails: [], due: '', note: '' } };

  async function startAdmin() {
    A.tab = ['courses', 'paths', 'assign', 'report'].includes(query.get('tab')) ? query.get('tab') : 'courses';
    if (query.get('course')) A.assign.target = 'course:' + query.get('course');
    if (query.get('path')) A.assign.target = 'path:' + query.get('path');
    try {
      A.overview = await api('/api/learn/admin/overview');
    } catch (e) { fail(e); return; }
    drawAdmin();
  }

  function drawAdmin() {
    const tabs = [['courses', 'Courses'], ['paths', 'Paths'], ['assign', 'Assign'], ['report', 'Reports']];
    root.innerHTML = `<div class="ln-head"><div><h1>Manage learning</h1><p>${plural(A.overview.courses.length, 'course')} and ${plural(A.overview.paths.length, 'learning path')}</p></div>
        <div class="ln-head__acts">${A.tab === 'courses' ? '<button type="button" class="h-btn h-btn--primary" id="la-new">New course</button>' : A.tab === 'paths' ? '<button type="button" class="h-btn h-btn--primary" id="la-newpath">New path</button>' : ''}</div></div>
      <div class="la-tabs" role="tablist" aria-label="Manage learning">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join('')}</div>
      <div id="la-body"></div>`;
    root.removeAttribute('aria-busy');
    $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => {
      A.tab = b.dataset.tab;
      history.replaceState(history.state, '', '/learn/admin/?tab=' + A.tab);
      drawAdmin();
    }));
    const body = $('#la-body', root);
    if (A.tab === 'courses') drawCourses(body);
    else if (A.tab === 'paths') drawPaths(body);
    else if (A.tab === 'assign') drawAssign(body);
    else drawReport(body);
    const nc = $('#la-new', root);
    if (nc) nc.addEventListener('click', newCourse);
    const np = $('#la-newpath', root);
    if (np) np.addEventListener('click', () => pathDialog(null));
  }

  /* ------------------------------------------------------------------ courses */
  function drawCourses(body) {
    const order = { published: 0, draft: 1, archived: 2 };
    const list = A.overview.courses.slice().sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
    const settings = me.admin ? '<section class="ln-card la-form" id="la-set" aria-label="Who can use Learn"><h2>Who can use Learn</h2><p class="ln-sum" style="margin:0">Admins and HR build and assign courses either way.</p><div class="la-f" style="max-width:320px"><select id="la-mode" aria-label="Who can use Learn"><option value="admins">Admins and HR only</option><option value="staff">All staff</option><option value="off">Off</option></select></div></section>' : '';
    body.innerHTML = `<div class="ln-list">${list.length ? list.map((c) => `<div class="ln-card la-row ln-c--${esc(c.color)}">
        ${colorTile(c.color, 'course')}
        <div class="la-row__t"><b>${link('/learn/admin/course/?c=' + encodeURIComponent(c.id), esc(c.title))}</b><span>${statusChip(c.status)} ${c.audience ? esc(c.audience) + ' · ' : ''}${plural(c.lessons, 'lesson')}${c.minutes ? ' · ' + mins(c.minutes) : ''}</span></div>
        <div class="la-row__n">${c.assigned ? `${c.done} of ${c.assigned} assigned done` : 'Not assigned'}${c.completions ? `<br>${plural(c.completions, 'completion')}` : ''}</div>
        <div class="la-row__acts">${link('/learn/admin/course/?c=' + encodeURIComponent(c.id), 'Edit', 'h-btn h-btn--ghost h-btn--sm')}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-assign="course:${esc(c.id)}"${c.status === 'published' ? '' : ' disabled'}>Assign</button></div>
      </div>`).join('') : '<div class="ln-empty"><b>No courses yet</b><p>Build one from the help library, Clips and Drive.</p></div>'}</div>${settings}`;
    $$('[data-assign]', body).forEach((b) => b.addEventListener('click', () => { A.assign.target = b.dataset.assign; A.tab = 'assign'; history.replaceState(history.state, '', '/learn/admin/?tab=assign'); drawAdmin(); }));
    const mode = $('#la-mode', body);
    if (mode) {
      api('/api/admin/settings?area=chat').then((d) => { const s = (d.settings || []).find((x) => x.id === 'learn.enabled'); if (s) mode.value = s.value; }).catch(() => undefined);
      mode.addEventListener('change', async () => {
        try { await send('POST', '/api/admin/settings', { id: 'learn.enabled', value: mode.value }); toast('Saved'); } catch (e) { toast(e.message); }
      });
    }
  }
  async function newCourse() {
    const m = modal(`<form method="dialog"><h2>New course</h2><label class="la-f"><span>Name</span><input id="nc-t" required maxlength="120" autocomplete="off" /></label><label class="la-f"><span>Who it is for</span><input id="nc-a" maxlength="80" placeholder="Everyone, RDDs, Partner Care" autocomplete="off" /></label>
      <div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">Create course</button></div><p class="ln-sum" id="nc-e" role="alert" hidden></p></form>`);
    $('[data-no]', m.el).addEventListener('click', m.close);
    $('#nc-t', m.el).focus();
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await send('POST', '/api/learn/admin/courses', { title: $('#nc-t', m.el).value, audience: $('#nc-a', m.el).value });
        location.href = '/learn/admin/course/?c=' + encodeURIComponent(r.course.id);
      } catch (err) { const el = $('#nc-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  /* ------------------------------------------------------------------ paths */
  function drawPaths(body) {
    const cmap = new Map(A.overview.courses.map((c) => [c.id, c]));
    const list = A.overview.paths.slice().sort((a, b) => a.title.localeCompare(b.title));
    body.innerHTML = `<div class="ln-list">${list.length ? list.map((p) => `<div class="ln-card la-row ln-c--${esc(p.color)}">
        ${colorTile(p.color, 'path')}
        <div class="la-row__t"><b>${esc(p.title)}</b><span>${statusChip(p.status)} ${p.audience ? esc(p.audience) + ' · ' : ''}${p.courses.map((id) => esc((cmap.get(id) || {}).title || '')).filter(Boolean).join(', ') || 'No courses'}</span></div>
        <div class="la-row__n">${p.assigned ? `${p.done} of ${p.assigned} assigned done` : 'Not assigned'}</div>
        <div class="la-row__acts"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-edit="${esc(p.id)}">Edit</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-assign="path:${esc(p.id)}"${p.status === 'published' ? '' : ' disabled'}>Assign</button></div>
      </div>`).join('') : '<div class="ln-empty"><b>No learning paths yet</b><p>A path puts courses in order for a role or a purpose.</p></div>'}</div>`;
    $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => pathDialog(A.overview.paths.find((p) => p.id === b.dataset.edit))));
    $$('[data-assign]', body).forEach((b) => b.addEventListener('click', () => { A.assign.target = b.dataset.assign; A.tab = 'assign'; history.replaceState(history.state, '', '/learn/admin/?tab=assign'); drawAdmin(); }));
  }
  function pathDialog(p) {
    const isNew = !p;
    p = p || { title: '', summary: '', audience: '', color: 'leaf', status: 'draft', courses: [] };
    const st = { courses: p.courses.slice(), color: p.color };
    const m = modal(`<form method="dialog"><h2>${isNew ? 'New learning path' : 'Edit learning path'}</h2>
      <div class="la-fields">
        <label class="la-f wide"><span>Name</span><input id="pd-t" maxlength="120" value="${esc(p.title)}" autocomplete="off" /></label>
        <label class="la-f wide"><span>Summary</span><textarea id="pd-s" maxlength="400" style="min-height:80px">${esc(p.summary)}</textarea></label>
        <label class="la-f"><span>Who it is for</span><input id="pd-a" maxlength="80" value="${esc(p.audience)}" autocomplete="off" /></label>
        <label class="la-f"><span>Status</span><select id="pd-st">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === p.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="la-f wide"><span>Color</span><div class="la-colors" id="pd-col">${COLORS.map((c) => `<button type="button" class="ln-c--${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c === p.color}">${svg('check')}</button>`).join('')}</div></div>
        <div class="la-f wide"><span>Courses, in order</span><div id="pd-list" class="la-less ln-card"></div>
          <label class="la-f" style="margin-top:8px"><span class="ln-sr">Add a course</span><select id="pd-add"></select></label></div>
      </div>
      <p class="ln-sum" id="pd-e" role="alert" hidden></p>
      <div class="ln-dlg__acts">${isNew ? '' : '<button type="button" class="h-btn h-btn--ghost" id="pd-del" style="margin-right:auto">Delete</button>'}<button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">${isNew ? 'Create path' : 'Save'}</button></div></form>`, 'ln-dlg--wide');
    const cmap = new Map(A.overview.courses.map((c) => [c.id, c]));
    const drawList = () => {
      const box = $('#pd-list', m.el);
      box.innerHTML = st.courses.length ? st.courses.map((id, i) => `<div class="la-l" style="grid-template-columns:36px minmax(0,1fr) auto auto auto"><span class="ln-tile ln-tile--sm ln-c--${esc((cmap.get(id) || {}).color || 'leaf')}">${svg('course')}</span>
        <span class="la-l__t"><b>${esc((cmap.get(id) || {}).title || 'Missing course')}</b><span>${statusLabel(cmap.get(id))}</span></span>
        <button type="button" class="la-ib" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>${svg('up')}</button><button type="button" class="la-ib" data-dn="${i}" aria-label="Move down"${i < st.courses.length - 1 ? '' : ' disabled'}>${svg('down')}</button>
        <button type="button" class="la-ib la-ib--x" data-rm="${i}" aria-label="Remove">${svg('x')}</button></div>`).join('') : '<p class="ln-sum" style="padding:12px">No courses yet.</p>';
      const sel = $('#pd-add', m.el);
      const left = A.overview.courses.filter((c) => !st.courses.includes(c.id) && c.status !== 'archived');
      sel.innerHTML = `<option value="">Add a course</option>${left.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}${c.status === 'draft' ? ' (draft)' : ''}</option>`).join('')}`;
    };
    const statusLabel = (c) => (c ? `${STATUS[c.status]} · ${plural(c.lessons, 'lesson')}` : '');
    drawList();
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) { st.color = b.dataset.c; $$('#pd-col button', m.el).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); }
      const swap = (i, j) => { const t = st.courses[i]; st.courses[i] = st.courses[j]; st.courses[j] = t; drawList(); };
      if (b.dataset.up) swap(+b.dataset.up, +b.dataset.up - 1);
      if (b.dataset.dn) swap(+b.dataset.dn, +b.dataset.dn + 1);
      if (b.dataset.rm) { st.courses.splice(+b.dataset.rm, 1); drawList(); }
    });
    $('#pd-add', m.el).addEventListener('change', (e) => { if (e.target.value) { st.courses.push(e.target.value); drawList(); } });
    $('[data-no]', m.el).addEventListener('click', m.close);
    const del = $('#pd-del', m.el);
    if (del) del.addEventListener('click', async () => {
      if (!(await confirmBox('Delete this path?', 'A path nobody has been assigned is deleted. One with assignments is archived so the records stay.', 'Delete', true))) return;
      try { const r = await send('DELETE', '/api/learn/admin/path/' + encodeURIComponent(p.id)); toast(r.result === 'archived' ? 'Archived' : 'Deleted'); m.close(); await startAdmin(); } catch (err) { toast(err.message); }
    });
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { title: $('#pd-t', m.el).value, summary: $('#pd-s', m.el).value, audience: $('#pd-a', m.el).value, color: st.color, status: $('#pd-st', m.el).value, courses: st.courses };
      try {
        if (isNew) await send('POST', '/api/learn/admin/paths', body); else await send('PATCH', '/api/learn/admin/path/' + encodeURIComponent(p.id), body);
        toast('Saved');
        m.close();
        await startAdmin();
      } catch (err) { const el = $('#pd-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  /* ------------------------------------------------------------------ assign */
  async function drawAssign(body) {
    if (!A.people) {
      body.innerHTML = '<div class="ln-card ln-skel h-skel"></div>';
      try { A.people = await api('/api/learn/admin/people'); } catch (e) { body.innerHTML = `<div class="ln-empty"><b>The staff list did not load</b><p>${esc(e.message)}</p></div>`; return; }
    }
    const a = A.assign;
    const targets = [...A.overview.paths.filter((p) => p.status === 'published').map((p) => ['path:' + p.id, 'Path: ' + p.title]), ...A.overview.courses.filter((c) => c.status === 'published').map((c) => ['course:' + c.id, 'Course: ' + c.title])];
    if (a.target && !targets.some((t) => t[0] === a.target)) a.target = '';
    const byEmail = new Map(A.people.people.map((p) => [p.email, p]));
    body.innerHTML = `<form class="ln-card la-form" id="as-form" novalidate><h2>Assign learning</h2>
      <div class="la-fields">
        <label class="la-f wide"><span>Course or path</span><select id="as-t"><option value="">Choose one</option>${targets.map(([v, l]) => `<option value="${esc(v)}"${v === a.target ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <div class="la-f wide"><span>Who</span><div class="ln-seg" role="group" aria-label="Who">${[['people', 'People'], ['team', 'A team'], ['everyone', 'Everyone']].map(([k, l]) => `<button type="button" data-who="${k}" aria-pressed="${a.who === k}">${l}</button>`).join('')}</div></div>
        <div class="la-f wide" id="as-people" ${a.who === 'people' ? '' : 'hidden'}>
          <input class="la-in" id="as-find" type="search" placeholder="Find a person" autocomplete="off" aria-label="Find a person" />
          <div class="la-sel" id="as-sel"></div><div class="la-people" id="as-list" role="group" aria-label="Staff"></div></div>
        <label class="la-f wide" id="as-team" ${a.who === 'team' ? '' : 'hidden'}><span>Team</span><select id="as-teamsel"><option value="">Choose a team</option>${A.people.teams.map((t) => `<option${t === a.team ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="la-f"><span>Due date</span><input id="as-due" type="date" value="${esc(a.due)}" min="${todayEt()}" /><div class="ln-chips" style="margin-top:6px">${[[7, 'In a week'], [14, 'In two weeks'], [30, 'In 30 days']].map(([n, l]) => `<button type="button" class="ln-chip" data-dd="${n}" style="border:0;cursor:pointer;min-height:32px">${l}</button>`).join('')}<button type="button" class="ln-chip" data-dd="0" style="border:0;cursor:pointer;min-height:32px">No due date</button></div></div>
        <label class="la-f"><span>Note to them (optional)</span><textarea id="as-note" maxlength="500" style="min-height:96px">${esc(a.note)}</textarea></label>
      </div>
      <p class="ln-sum" id="as-msg" role="status" hidden></p>
      <div class="la-save"><button type="submit" class="h-btn h-btn--primary h-btn--lg" id="as-go">Assign</button><small id="as-count"></small></div></form>`;
    const sync = () => {
      const sel = $('#as-sel', body);
      sel.innerHTML = a.emails.map((e) => `<span class="ln-chip ln-chip--c">${esc((byEmail.get(e) || {}).name || e)}<button type="button" data-rm="${esc(e)}" aria-label="Remove ${esc((byEmail.get(e) || {}).name || e)}">&times;</button></span>`).join('');
      const needle = $('#as-find', body).value.trim().toLowerCase();
      const hits = A.people.people.filter((p) => !needle || `${p.name} ${p.team} ${p.title}`.toLowerCase().includes(needle)).slice(0, 80);
      $('#as-list', body).innerHTML = hits.length ? hits.map((p) => `<button type="button" class="la-person" data-pick="${esc(p.email)}" aria-pressed="${a.emails.includes(p.email)}">${a.emails.includes(p.email) ? svg('check').replace('<svg', '<svg style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:3"') : ''}<span>${esc(p.name)}</span><small>${esc(p.team || p.title || '')}</small></button>`).join('') : '<p class="ln-sum" style="padding:12px;margin:0">No one matches.</p>';
      const who = a.who === 'everyone' ? A.people.people.length : a.who === 'team' ? A.people.people.filter((p) => p.team === a.team).length : a.emails.length;
      $('#as-count', body).textContent = a.who === 'people' && !who ? '' : `${plural(who, 'person', 'people')}`;
    };
    sync();
    body.addEventListener('input', (e) => { if (e.target.id === 'as-find') sync(); if (e.target.id === 'as-note') a.note = e.target.value; });
    body.addEventListener('change', (e) => {
      if (e.target.id === 'as-t') a.target = e.target.value;
      if (e.target.id === 'as-teamsel') { a.team = e.target.value; sync(); }
      if (e.target.id === 'as-due') a.due = e.target.value;
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.who) { a.who = b.dataset.who; $$('[data-who]', body).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); $('#as-people', body).hidden = a.who !== 'people'; $('#as-team', body).hidden = a.who !== 'team'; sync(); }
      if (b.dataset.pick) { const em = b.dataset.pick; a.emails = a.emails.includes(em) ? a.emails.filter((x) => x !== em) : [...a.emails, em]; sync(); }
      if (b.dataset.rm) { a.emails = a.emails.filter((x) => x !== b.dataset.rm); sync(); }
      if (b.dataset.dd !== undefined) { a.due = +b.dataset.dd ? addDays(todayEt(), +b.dataset.dd) : ''; $('#as-due', body).value = a.due; }
    });
    $('#as-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#as-msg', body);
      const go = $('#as-go', body);
      const [kind, id] = (a.target || ':').split(':');
      msg.hidden = false;
      if (!id) { msg.textContent = 'Choose a course or a path.'; return; }
      if (a.who === 'people' && !a.emails.length) { msg.textContent = 'Pick at least one person.'; return; }
      if (a.who === 'team' && !a.team) { msg.textContent = 'Choose a team.'; return; }
      go.disabled = true;
      try {
        const r = await send('POST', '/api/learn/admin/assign', { kind, target: id, emails: a.who === 'people' ? a.emails : undefined, team: a.who === 'team' ? a.team : undefined, everyone: a.who === 'everyone', due_date: a.due || null, note: a.note });
        const bits = [];
        if (r.created) bits.push(`${plural(r.created, 'person', 'people')} assigned`);
        if (r.reopened) bits.push(`${r.reopened} given again`);
        if (r.updated) bits.push(`${r.updated} updated`);
        if (r.already_done) bits.push(`${r.already_done} had already finished it`);
        const tail = [];
        if (r.told) tail.push(`${r.told} told`);
        if (r.tasks) tail.push(`${plural(r.tasks, 'task')} added in Projects`);
        msg.textContent = (bits.join(', ') || 'Nothing changed') + (tail.length ? '. ' + tail.join(', ') : '') + '.';
        A.report = null;
        A.overview = await api('/api/learn/admin/overview');
      } catch (err) { msg.textContent = err.message; }
      go.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ report */
  async function drawReport(body) {
    const f = A.filters;
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    if (!A.report || A.reportQs !== qs) {
      if (!A.report) body.innerHTML = '<div class="ln-card ln-skel h-skel"></div>';
      try { A.report = await api('/api/learn/admin/report' + (qs ? '?' + qs : '')); A.reportQs = qs; } catch (e) { body.innerHTML = `<div class="ln-empty"><b>The report did not load</b><p>${esc(e.message)}</p></div>`; return; }
    }
    const r = A.report;
    const s = r.summary;
    const STAT = { done: 'Done', overdue: 'Late', in_progress: 'In progress', not_started: 'Not started' };
    const chip = (st) => `<span class="ln-chip${st === 'done' ? ' ln-chip--ok' : st === 'overdue' ? ' ln-chip--late' : st === 'in_progress' ? ' ln-chip--due' : ''}">${STAT[st]}</span>`;
    const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
    body.innerHTML = `<div class="la-sum"><div><b>${s.assigned}</b><span>assigned</span></div><div><b>${s.done}</b><span>done</span></div><div><b>${s.in_progress}</b><span>in progress</span></div><div><b>${s.not_started}</b><span>not started</span></div><div class="${s.overdue ? 'late' : ''}"><b>${s.overdue}</b><span>late</span></div><div><b>${s.avg_score == null ? '-' : s.avg_score + '%'}</b><span>average quiz score</span></div></div>
      <div class="la-filters">
        <label class="la-f"><span>Learning</span><select id="rp-c"><option value="">All</option>${A.overview.paths.map((p) => opt('p:' + p.slug, 'Path: ' + p.title, f.path ? 'p:' + f.path : f.course ? 'c:' + f.course : '')).join('')}${A.overview.courses.map((c) => opt('c:' + c.slug, c.title, f.path ? 'p:' + f.path : f.course ? 'c:' + f.course : '')).join('')}</select></label>
        <label class="la-f"><span>Team</span><select id="rp-t"><option value="">All teams</option>${r.teams.map((t) => opt(t, t, f.team)).join('')}</select></label>
        <label class="la-f"><span>Status</span><select id="rp-s"><option value="">Any</option>${Object.entries(STAT).map(([k, v]) => opt(k, v, f.status)).join('')}</select></label>
        <label class="la-f"><span>Person</span><input id="rp-q" type="search" value="${esc(f.q)}" placeholder="Name" autocomplete="off" /></label>
        <button type="button" class="h-btn h-btn--ghost" id="rp-csv"${r.rows.length ? '' : ' disabled'}>Download CSV</button></div>
      ${r.rows.length ? `<div class="ln-card la-tbl" role="table" aria-label="Assignments"><div class="la-tr la-tr--h" role="row"><span role="columnheader">Person</span><span role="columnheader">Learning</span><span role="columnheader">Due</span><span role="columnheader">Status</span><span role="columnheader">Progress</span><span role="columnheader">Score</span><span role="columnheader"></span></div>
        ${r.rows.map((x) => `<div class="la-tr" role="row"><span><b>${esc(x.name)}</b><br>${esc(x.team)}</span><span>${link(x.href, esc(x.title))}</span><span>${x.due_date ? dayWord(x.due_date) : 'No date'}</span><span>${chip(x.status)}</span><span>${x.pct}%${x.last_at ? '<br>' + dayWord(x.last_at.slice(0, 10)) : ''}</span><span>${x.best_score == null ? '' : x.best_score + '%'}</span>
          <span>${x.status === 'done' ? '' : `<button type="button" class="la-ib la-ib--x" data-rm="${esc(x.assignment_id)}" aria-label="Remove ${esc(x.name)} from ${esc(x.title)}">${svg('x')}</button>`}</span></div>`).join('')}</div>`
        : '<div class="ln-empty"><b>Nothing to show</b><p>Assigned courses and paths, and how far each person has come, list here.</p></div>'}`;
    const change = () => {
      const c = $('#rp-c', body).value;
      f.course = c.startsWith('c:') ? c.slice(2) : '';
      f.path = c.startsWith('p:') ? c.slice(2) : '';
      f.team = $('#rp-t', body).value;
      f.status = $('#rp-s', body).value;
      drawReport(body);
    };
    ['#rp-c', '#rp-t', '#rp-s'].forEach((id) => $(id, body).addEventListener('change', change));
    $('#rp-q', body).addEventListener('input', debounce((e) => { f.q = e.target.value; drawReport(body).then(() => { const i = $('#rp-q', body); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300));
    $('#rp-csv', body).addEventListener('click', () => {
      const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = [['Person', 'Team', 'Learning', 'Type', 'Due', 'Status', 'Percent', 'Quiz score', 'Last activity', 'Completed'].map(cell).join(',')].concat(r.rows.map((x) => [x.name, x.team, x.title, x.kind, x.due_date || '', STAT[x.status], x.pct, x.best_score == null ? '' : x.best_score, x.last_at ? x.last_at.slice(0, 10) : '', x.completed_at ? x.completed_at.slice(0, 10) : ''].map(cell).join(',')));
      const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `learning-report-${todayEt()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    $$('[data-rm]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('Remove this assignment?', 'The person keeps any progress. The task in Projects closes.', 'Remove', true))) return;
      try { await send('DELETE', '/api/learn/admin/assignments/' + encodeURIComponent(b.dataset.rm)); toast('Removed'); A.report = null; drawReport(body); } catch (e) { toast(e.message); }
    }));
  }

  /* ================================================================== the course editor */
  const E = { course: null, dirty: false, help: null, adding: false, drag: -1 };

  async function startEditor() {
    const id = query.get('c');
    if (!id) { location.href = '/learn/admin/'; return; }
    try { E.course = (await api('/api/learn/admin/course/' + encodeURIComponent(id))).course; } catch (e) { fail(e); return; }
    drawEditor();
  }
  const lessonMeta = (l) => [KIND[l.kind] || l.kind, l.kind === 'quiz' && l.quiz ? plural(l.quiz.questions.length, 'question') : '', l.kind === 'doc' || l.kind === 'link' ? l.ref.replace(/^https?:\/\//, '').slice(0, 48) : ''].filter(Boolean).join(' · ');

  function drawEditor() {
    const c = E.course;
    document.title = `${c.title} - Edit course - Favor Hub`;
    root.innerHTML = `<nav class="ln-crumb" aria-label="Where you are">${link('/learn/admin/', 'Manage learning')}<i>/</i><span>${esc(c.title)}</span></nav>
      <div class="ln-head"><div><h1>${esc(c.title)}</h1><p>${statusChip(c.status)} ${plural(c.lessons.length, 'lesson')}${c.completions ? ' · ' + plural(c.completions, 'completion') : ''}${c.open_assignments ? ' · ' + plural(c.open_assignments, 'open assignment') : ''}</p></div>
        <div class="ln-head__acts">${link('/learn/c/?c=' + encodeURIComponent(c.slug), 'Preview', 'h-btn h-btn--ghost', ' target="_blank" rel="noopener"')}${link('/learn/admin/?tab=assign&course=' + encodeURIComponent(c.id), 'Assign', 'h-btn h-btn--ghost')}</div></div>
      <form class="ln-card la-form" id="ed-form" novalidate>
        <div class="la-fields">
          <label class="la-f"><span>Name</span><input name="title" maxlength="120" value="${esc(c.title)}" autocomplete="off" /></label>
          <label class="la-f"><span>Who it is for</span><input name="audience" maxlength="80" value="${esc(c.audience)}" autocomplete="off" /></label>
          <label class="la-f wide"><span>Summary</span><textarea name="summary" maxlength="400" style="min-height:84px">${esc(c.summary)}</textarea></label>
          <div class="la-f"><span>Color</span><div class="la-colors" id="ed-col">${COLORS.map((x) => `<button type="button" class="ln-c--${x}" data-c="${x}" aria-label="${x}" aria-pressed="${x === c.color}">${svg('check')}</button>`).join('')}</div></div>
          <label class="la-f"><span>Status</span><select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === c.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <div class="la-save"><button type="submit" class="h-btn h-btn--primary" id="ed-save" disabled>Save details</button><small id="ed-msg" role="status"></small></div>
      </form>
      <section class="ln-sec" aria-label="Lessons"><h2>Lessons <em>${c.lessons.length}</em></h2>
        <div class="ln-card la-less" id="ed-less">${lessonsHtml()}</div>
        <div><button type="button" class="h-btn h-btn--primary" id="ed-add">${svg('plus').replace('<svg', '<svg class="h-i" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.2;margin-right:6px"')}Add a lesson</button></div>
        <div id="ed-addpanel"></div></section>
      <section class="ln-sec"><h2>Remove</h2><div><button type="button" class="h-btn h-btn--ghost" id="ed-del">${c.completions || c.open_assignments ? 'Archive this course' : 'Delete this course'}</button></div></section>`;
    root.removeAttribute('aria-busy');
    wireEditor();
  }
  function lessonsHtml() {
    const ls = E.course.lessons;
    if (!ls.length) return '<p class="ln-sum" style="padding:16px;margin:0">No lessons yet. Add a video, an article, a Google Doc, a clip, a written page or a quiz.</p>';
    return ls.map((l, i) => `<div class="la-l" draggable="true" data-i="${i}" data-id="${esc(l.id)}"><span class="la-grip" aria-hidden="true">${svg('grip')}</span>
      <span class="ln-tile ln-tile--sm" style="background:var(--r-sunk);color:var(--r-ink-2)">${svg(l.kind)}</span>
      <span class="la-l__t"><b>${esc(l.title)}</b><span>${esc(lessonMeta(l))}</span></span><span class="la-l__m">${l.minutes ? mins(l.minutes) : ''}</span>
      <span class="la-mini"><button type="button" class="la-ib" data-up="${i}" aria-label="Move ${esc(l.title)} up"${i ? '' : ' disabled'}>${svg('up')}</button><button type="button" class="la-ib" data-dn="${i}" aria-label="Move ${esc(l.title)} down"${i < ls.length - 1 ? '' : ' disabled'}>${svg('down')}</button><button type="button" class="la-ib" data-edit="${esc(l.id)}" aria-label="Edit ${esc(l.title)}">${svg('edit')}</button><button type="button" class="la-ib la-ib--x" data-del="${esc(l.id)}" aria-label="Remove ${esc(l.title)}">${svg('x')}</button></span></div>`).join('');
  }
  const redrawLessons = () => {
    $('#ed-less', root).innerHTML = lessonsHtml();
    const h = $('.ln-sec h2 em', root);
    if (h) h.textContent = E.course.lessons.length;
  };

  async function saveOrder(ids) {
    try { E.course = (await send('PUT', `/api/learn/admin/course/${E.course.id}/order`, { ids })).course; } catch (e) { toast(e.message); }
    redrawLessons();
  }

  function wireEditor() {
    const form = $('#ed-form', root);
    const save = $('#ed-save', root);
    const msg = $('#ed-msg', root);
    let color = E.course.color;
    const dirty = () => { save.disabled = false; msg.textContent = ''; msg.classList.remove('err'); };
    form.addEventListener('input', dirty);
    form.addEventListener('change', dirty);
    $('#ed-col', root).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      color = b.dataset.c;
      $$('#ed-col button', root).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      dirty();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      const fd = new FormData(form);
      try {
        const r = await send('PATCH', '/api/learn/admin/course/' + encodeURIComponent(E.course.id), { title: fd.get('title'), summary: fd.get('summary'), audience: fd.get('audience'), status: fd.get('status'), color });
        E.course = r.course;
        msg.textContent = 'Saved';
        $('.ln-head h1', root).textContent = E.course.title;
        $('.ln-head p', root).innerHTML = `${statusChip(E.course.status)} ${plural(E.course.lessons.length, 'lesson')}`;
      } catch (err) { msg.textContent = err.message; msg.classList.add('err'); save.disabled = false; }
    });

    const less = $('#ed-less', root);
    less.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const ls = E.course.lessons;
      const ids = ls.map((l) => l.id);
      const mv = (i, j) => { const t = ids[i]; ids[i] = ids[j]; ids[j] = t; saveOrder(ids).then(() => { const nb = $(`[data-${j < i ? 'up' : 'dn'}="${j}"]`, root); if (nb && !nb.disabled) nb.focus(); }); };
      if (b.dataset.up) mv(+b.dataset.up, +b.dataset.up - 1);
      else if (b.dataset.dn) mv(+b.dataset.dn, +b.dataset.dn + 1);
      else if (b.dataset.edit) editLesson(ls.find((l) => l.id === b.dataset.edit));
      else if (b.dataset.del) {
        const l = ls.find((x) => x.id === b.dataset.del);
        if (!(await confirmBox('Remove this lesson?', `${l.title} comes out of the course. Progress people made on it is removed too.`, 'Remove', true))) return;
        try { E.course = (await send('DELETE', '/api/learn/admin/lesson/' + encodeURIComponent(l.id))).course; redrawLessons(); } catch (err) { toast(err.message); }
      }
    });
    // Drag to reorder. The arrow buttons do the same.
    less.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.la-l');
      if (!row) return;
      E.drag = +row.dataset.i;
      row.classList.add('is-drag');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch (x) { /* Safari needs data */ }
    });
    less.addEventListener('dragover', (e) => {
      const row = e.target.closest('.la-l');
      if (!row || E.drag < 0) return;
      e.preventDefault();
      $$('.la-l', less).forEach((x) => x.classList.toggle('is-over', x === row && +row.dataset.i !== E.drag));
    });
    less.addEventListener('dragend', () => { E.drag = -1; $$('.la-l', less).forEach((x) => x.classList.remove('is-drag', 'is-over')); });
    less.addEventListener('drop', (e) => {
      const row = e.target.closest('.la-l');
      if (!row || E.drag < 0) return;
      e.preventDefault();
      const to = +row.dataset.i;
      const ids = E.course.lessons.map((l) => l.id);
      const [moved] = ids.splice(E.drag, 1);
      ids.splice(to, 0, moved);
      E.drag = -1;
      saveOrder(ids);
    });

    $('#ed-add', root).addEventListener('click', () => { E.adding = !E.adding; drawAddPanel(); if (E.adding) { const i = $('#ad-q', root); if (i) i.focus(); } });
    $('#ed-del', root).addEventListener('click', async () => {
      const used = E.course.completions || E.course.open_assignments;
      if (!(await confirmBox(used ? 'Archive this course?' : 'Delete this course?', used ? 'People have records on it, so it is archived. They keep their certificates.' : 'It has no records, so it is deleted for good.', used ? 'Archive' : 'Delete', true))) return;
      try { await send('DELETE', '/api/learn/admin/course/' + encodeURIComponent(E.course.id)); location.href = '/learn/admin/'; } catch (err) { toast(err.message); }
    });
  }

  /* ------------------------------------------------------------------ adding a lesson */
  async function addLesson(body) {
    try {
      const r = await send('POST', `/api/learn/admin/course/${E.course.id}/lessons`, body);
      E.course = r.course;
      redrawLessons();
      toast('Added ' + r.lesson.title);
      return r.lesson;
    } catch (err) { toast(err.message); return null; }
  }
  const slugOf = (url) => String(url).replace(/\/+$/, '').split('/').pop();

  async function loadHelp() {
    if (E.help) return E.help;
    E.help = fetch('/help/search.json', { credentials: 'same-origin' }).then((r) => r.json()).then((items) => items.map((i) => ({ kind: i.kind === 'video' ? 'video' : 'article', ref: slugOf(i.url), title: i.title, summary: i.summary || '', hay: `${i.title} ${i.summary} ${i.topic || ''} ${i.kind === 'video' ? i.text || '' : ''}`.toLowerCase() }))).catch(() => []);
    return E.help;
  }

  function drawAddPanel() {
    const box = $('#ed-addpanel', root);
    if (!E.adding) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="ln-card la-add"><h2>Add a lesson</h2>
      <label class="ln-search" style="max-width:none">${svg('search')}<span class="ln-sr">Search</span><input id="ad-q" type="search" placeholder="Search the help library, your Clips and Drive" autocomplete="off" /></label>
      <div class="la-kinds"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-new="page">Written page</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-new="quiz">Quiz</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-new="url">Google Doc, Drive file or link</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-new="record">${svg('cam').replace('<svg', '<svg class="h-i" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;margin-right:6px"')}Record a clip</button></div>
      <div class="la-res" id="ad-res" aria-live="polite"></div></div>`;
    const res = $('#ad-res', box);
    const inCourse = () => new Set(E.course.lessons.map((l) => l.kind + ':' + l.ref));
    const hit = (h) => `<div class="la-hit${inCourse().has(h.kind + ':' + h.ref) ? ' is-in' : ''}"><span class="ln-tile ln-tile--sm" style="background:var(--r-sunk);color:var(--r-ink-2)">${svg(h.kind)}</span><div><b>${esc(h.title)}</b><span>${esc(h.summary || h.sub || '')}</span></div><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-add='${esc(JSON.stringify({ kind: h.kind, ref: h.ref, title: h.title }))}'>${inCourse().has(h.kind + ':' + h.ref) ? 'Add again' : 'Add'}</button></div>`;
    const run = async () => {
      const q = $('#ad-q', box).value.trim().toLowerCase();
      const parts = [];
      const help = await loadHelp();
      const hv = help.filter((h) => h.kind === 'video' && (!q || h.hay.includes(q))).slice(0, q ? 12 : 8);
      const ha = help.filter((h) => h.kind === 'article' && (!q || h.hay.includes(q))).slice(0, q ? 12 : 8);
      if (hv.length) parts.push(`<h3>Help videos</h3>${hv.map(hit).join('')}`);
      if (ha.length) parts.push(`<h3>Help articles</h3>${ha.map(hit).join('')}`);
      res.innerHTML = parts.join('') || '<p class="ln-sum">No help video or article matches.</p>';
      const mine = [api('/api/learn/admin/clips?q=' + encodeURIComponent(q)).then((d) => d.clips || []).catch(() => [])];
      if (q.length >= 2) mine.push(api('/api/learn/admin/drive?q=' + encodeURIComponent(q)).then((d) => d.files || []).catch(() => []));
      const [clips, files] = await Promise.all(mine);
      if ($('#ad-q', box).value.trim().toLowerCase() !== q) return;
      if (clips && clips.length) parts.push(`<h3>Your clips</h3>${clips.map((c) => hit({ kind: 'clip', ref: c.id, title: c.title || 'Untitled clip', summary: c.summary || '' })).join('')}`);
      if (files && files.length) parts.push(`<h3>Drive</h3>${files.map((f) => hit({ kind: 'doc', ref: f.url, title: f.name, sub: f.path || '' })).join('')}`);
      res.innerHTML = parts.join('') || '<p class="ln-sum">Nothing matches.</p>';
    };
    run();
    $('#ad-q', box).addEventListener('input', debounce(run, 280));
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add) { b.disabled = true; const l = await addLesson(JSON.parse(b.dataset.add)); if (l) { b.textContent = 'Added'; } else b.disabled = false; return; }
      const k = b.dataset.new;
      if (k === 'page') pageDialog(null);
      else if (k === 'quiz') quizDialog(null);
      else if (k === 'url') urlDialog();
      else if (k === 'record') recordClip();
    });
  }

  /** Opens the recorder in the page header; the clip becomes a lesson when it saves. */
  function recordClip() {
    const cam = document.getElementById('clip-cam');
    if (!cam || cam.hidden) { toast('The recorder is not available on this page.'); return; }
    toast('Record your clip. It is added to this course when you stop.');
    const once = async (ev) => {
      const id = ev.detail && ev.detail.id;
      if (!id) return;
      window.removeEventListener('clips:changed', once);
      for (let i = 0; i < 6; i++) {
        const l = await addLesson({ kind: 'clip', ref: id });
        if (l) { editLesson(l); break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    window.addEventListener('clips:changed', once);
    cam.click();
  }

  function urlDialog() {
    const m = modal(`<form method="dialog"><h2>Google Doc, Drive file or link</h2>
      <label class="la-f"><span>Address</span><input id="u-url" type="url" placeholder="https://" required autocomplete="off" /></label>
      <label class="la-f"><span>Name</span><input id="u-t" maxlength="160" autocomplete="off" /></label>
      <p class="ln-sum" id="u-e" role="alert" hidden></p>
      <div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">Add lesson</button></div></form>`);
    $('[data-no]', m.el).addEventListener('click', m.close);
    $('#u-url', m.el).focus();
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = $('#u-url', m.el).value.trim();
      const kind = /^https:\/\/(docs|drive)\.google\.com\//i.test(url) ? 'doc' : 'link';
      try {
        const r = await send('POST', `/api/learn/admin/course/${E.course.id}/lessons`, { kind, ref: url, title: $('#u-t', m.el).value || (kind === 'doc' ? 'Google document' : 'Link') });
        E.course = r.course;
        redrawLessons();
        toast('Added ' + r.lesson.title);
        m.close();
      } catch (err) { const el = $('#u-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  function pageDialog(lesson) {
    const m = modal(`<form method="dialog"><h2>${lesson ? 'Edit written page' : 'Written page'}</h2>
      <label class="la-f"><span>Name</span><input id="p-t" maxlength="160" value="${esc(lesson ? lesson.title : '')}" autocomplete="off" /></label>
      <label class="la-f"><span>Text</span><textarea id="p-b" class="tall" maxlength="20000">${esc(lesson ? lesson.body : '')}</textarea><small>## Heading, - bullet, 1. numbered, **bold**, [text](https://address)</small></label>
      <p class="ln-sum" id="p-e" role="alert" hidden></p>
      <div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">${lesson ? 'Save' : 'Add lesson'}</button></div></form>`, 'ln-dlg--wide');
    $('[data-no]', m.el).addEventListener('click', m.close);
    $('#p-t', m.el).focus();
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { title: $('#p-t', m.el).value, body: $('#p-b', m.el).value };
      try {
        const r = lesson ? await send('PATCH', '/api/learn/admin/lesson/' + encodeURIComponent(lesson.id), body) : await send('POST', `/api/learn/admin/course/${E.course.id}/lessons`, { kind: 'page', ...body });
        E.course = r.course;
        redrawLessons();
        m.close();
      } catch (err) { const el = $('#p-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  function quizDialog(lesson) {
    const q = lesson && lesson.quiz ? JSON.parse(JSON.stringify(lesson.quiz)) : { pass: 80, questions: [{ id: 'q1', kind: 'choice', text: '', options: ['', ''], answer: 0, explain: '' }] };
    const m = modal(`<form method="dialog"><h2>${lesson ? 'Edit quiz' : 'Quiz'}</h2>
      <div class="la-fields"><label class="la-f wide"><span>Name</span><input id="q-t" maxlength="160" value="${esc(lesson ? lesson.title : 'Check what you learned')}" autocomplete="off" /></label>
      <label class="la-f"><span>Pass mark, percent</span><input id="q-p" type="number" inputmode="numeric" min="1" max="100" value="${q.pass}" /></label></div>
      <div class="la-qs" id="q-list"></div>
      <div><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="q-add">Add a question</button></div>
      <p class="ln-sum" id="q-e" role="alert" hidden></p>
      <div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">${lesson ? 'Save' : 'Add lesson'}</button></div></form>`, 'ln-dlg--wide');
    const list = $('#q-list', m.el);
    const draw = () => {
      list.innerHTML = q.questions.map((x, i) => `<fieldset class="la-q" data-i="${i}"><div class="la-q__h"><b>Question ${i + 1}</b><span class="la-mini">
          <select data-k aria-label="Type of question" class="la-in" style="width:auto;min-height:40px"><option value="choice"${x.kind === 'choice' ? ' selected' : ''}>Multiple choice</option><option value="tf"${x.kind === 'tf' ? ' selected' : ''}>True or false</option></select>
          <button type="button" class="la-ib" data-qup="${i}" aria-label="Move question up"${i ? '' : ' disabled'}>${svg('up')}</button><button type="button" class="la-ib" data-qdn="${i}" aria-label="Move question down"${i < q.questions.length - 1 ? '' : ' disabled'}>${svg('down')}</button><button type="button" class="la-ib la-ib--x" data-qrm="${i}" aria-label="Remove question"${q.questions.length > 1 ? '' : ' disabled'}>${svg('x')}</button></span></div>
        <input class="la-in" data-t placeholder="Question" value="${esc(x.text)}" maxlength="400" aria-label="Question ${i + 1}" />
        ${(x.kind === 'tf' ? ['True', 'False'] : x.options).map((o, j) => `<div class="la-o"><input type="radio" name="ans${i}" value="${j}" ${x.answer === j ? 'checked' : ''} aria-label="Right answer ${j + 1}" />${x.kind === 'tf' ? `<span style="padding:0 4px">${o}</span><span></span>` : `<input type="text" class="la-in" data-o="${j}" value="${esc(o)}" placeholder="Answer ${j + 1}" maxlength="240" aria-label="Answer ${j + 1}" /><button type="button" class="la-ib la-ib--x" data-orm="${i}:${j}" aria-label="Remove answer"${x.options.length > 2 ? '' : ' disabled'}>${svg('x')}</button>`}</div>`).join('')}
        ${x.kind === 'choice' && x.options.length < 6 ? `<div><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-oadd="${i}">Add an answer</button></div>` : ''}
        <input class="la-in" data-e placeholder="Why it is right (shown after an attempt)" value="${esc(x.explain)}" maxlength="500" aria-label="Explanation ${i + 1}" /></fieldset>`).join('');
    };
    draw();
    const read = () => $$('.la-q', list).forEach((fs) => {
      const x = q.questions[+fs.dataset.i];
      x.text = $('[data-t]', fs).value;
      x.explain = $('[data-e]', fs).value;
      if (x.kind === 'choice') x.options = $$('[data-o]', fs).map((o) => o.value);
      const r = $('input[type=radio]:checked', fs);
      if (r) x.answer = +r.value;
    });
    list.addEventListener('change', (e) => {
      if (e.target.matches('[data-k]')) {
        read();
        const x = q.questions[+e.target.closest('.la-q').dataset.i];
        x.kind = e.target.value;
        if (x.kind === 'tf') { x.options = ['True', 'False']; x.answer = Math.min(x.answer, 1); } else if (x.options.length < 2 || x.options[0] === 'True') { x.options = ['', '']; x.answer = 0; }
        draw();
      }
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      read();
      const d = b.dataset;
      if (d.qrm !== undefined) q.questions.splice(+d.qrm, 1);
      else if (d.qup !== undefined) { const i = +d.qup; [q.questions[i - 1], q.questions[i]] = [q.questions[i], q.questions[i - 1]]; } else if (d.qdn !== undefined) { const i = +d.qdn; [q.questions[i + 1], q.questions[i]] = [q.questions[i], q.questions[i + 1]]; } else if (d.oadd !== undefined) q.questions[+d.oadd].options.push('');
      else if (d.orm !== undefined) { const [i, j] = d.orm.split(':').map(Number); const x = q.questions[i]; x.options.splice(j, 1); if (x.answer >= x.options.length) x.answer = 0; else if (x.answer > j) x.answer--; } else return;
      draw();
    });
    $('#q-add', m.el).addEventListener('click', () => { read(); q.questions.push({ id: 'q' + (q.questions.length + 1), kind: 'choice', text: '', options: ['', ''], answer: 0, explain: '' }); draw(); const last = $$('.la-q', list).pop(); if (last) $('[data-t]', last).focus(); });
    $('[data-no]', m.el).addEventListener('click', m.close);
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      read();
      q.pass = +$('#q-p', m.el).value || 80;
      q.questions.forEach((x, i) => { x.id = 'q' + (i + 1); if (x.kind === 'choice') x.options = x.options.map((o) => o.trim()).filter(Boolean); });
      const body = { title: $('#q-t', m.el).value, quiz: q };
      try {
        const r = lesson ? await send('PATCH', '/api/learn/admin/lesson/' + encodeURIComponent(lesson.id), body) : await send('POST', `/api/learn/admin/course/${E.course.id}/lessons`, { kind: 'quiz', ...body });
        E.course = r.course;
        redrawLessons();
        m.close();
      } catch (err) { const el = $('#q-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  function editLesson(l) {
    if (l.kind === 'page') return pageDialog(l);
    if (l.kind === 'quiz') return quizDialog(l);
    const refEditable = l.kind === 'doc' || l.kind === 'link';
    const m = modal(`<form method="dialog"><h2>Edit lesson</h2>
      <label class="la-f"><span>Name</span><input id="e-t" maxlength="160" value="${esc(l.title)}" autocomplete="off" /></label>
      ${refEditable ? `<label class="la-f"><span>Address</span><input id="e-r" type="url" value="${esc(l.ref)}" autocomplete="off" /></label>` : ''}
      <label class="la-f"><span>Minutes</span><input id="e-m" type="number" inputmode="numeric" min="1" max="240" value="${l.minutes || ''}" /></label>
      <p class="ln-sum" id="e-e" role="alert" hidden></p>
      <div class="ln-dlg__acts"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="submit" class="h-btn h-btn--primary">Save</button></div></form>`);
    $('[data-no]', m.el).addEventListener('click', m.close);
    $('#e-t', m.el).focus();
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { title: $('#e-t', m.el).value, minutes: +$('#e-m', m.el).value || 0 };
      if (refEditable) body.ref = $('#e-r', m.el).value;
      try { E.course = (await send('PATCH', '/api/learn/admin/lesson/' + encodeURIComponent(l.id), body)).course; redrawLessons(); m.close(); } catch (err) { const el = $('#e-e', m.el); el.hidden = false; el.textContent = err.message; }
    });
  }

  if (view === 'editor') startEditor(); else startAdmin();
})();
