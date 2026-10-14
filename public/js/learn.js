/* Learn (FavorOS): My learning, the catalog, a course with its lesson player, a path, and the certificate.
   One page of script for all of them. Moving between Learn pages (a course card, the next lesson, Back) redraws the page body from
   /api/learn without a reload; every address still works on its own. Progress saves as a person goes: the lesson they opened, how far
   into a video, and each lesson they finish. A draft course previews for its authors and records nothing. */
(() => {
  'use strict';
  const root = document.getElementById('ln');
  // Once per page body: a page swapped in place (hub-swap.js) brings a fresh #ln and runs this again; its old listeners were removed.
  if (!root || root.dataset.lnOn) return;
  root.dataset.lnOn = '1';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ET = 'America/New_York';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayWord = (ymd) => { const [, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d; };
  const longDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: ET, month: 'long', day: 'numeric', year: 'numeric' });
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const mins = (m) => (m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
  const clockTime = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

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
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    list: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cert: '<circle cx="12" cy="9" r="5"/><path d="m9 13-1 8 4-2.5L16 21l-1-8"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
  const KIND = { video: 'Video', article: 'Article', doc: 'Document', page: 'Reading', clip: 'Clip', link: 'Link', quiz: 'Quiz' };

  /* ------------------------------------------------------------------ talking to the server */
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
  const post = (path, body, extra) => api(path, Object.assign({ method: 'POST', body: JSON.stringify(body || {}) }, extra || {}));

  /* ------------------------------------------------------------------ small pieces */
  let toastEl = null;
  let toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ln-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  let sheet = null;
  function closeSheet() {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (s.tok && window.hubOv) window.hubOv.off(s.tok);
    s.scrim.remove();
    s.el.remove();
    document.removeEventListener('keydown', s.key, true);
    if (s.ret && s.ret.focus) { try { s.ret.focus({ preventScroll: true }); } catch (e) { /* the page is gone */ } }
  }
  function openSheet(title, html) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'ln-sheet-scrim';
    const el = document.createElement('div');
    el.className = 'ln-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    el.innerHTML = `<div class="ln-sheet__bar"><b>${esc(title)}</b><button type="button" class="ln-sheet__x" aria-label="Close">&times;</button></div>${html}`;
    document.body.append(scrim, el);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } };
    document.addEventListener('keydown', key, true);
    sheet = { scrim, el, key, ret: document.activeElement, tok: null };
    sheet.tok = window.hubOv ? window.hubOv.on(() => { sheet.tok = null; closeSheet(); }) : null;
    scrim.addEventListener('click', closeSheet);
    $('.ln-sheet__x', el).addEventListener('click', closeSheet);
    $('.ln-sheet__x', el).focus({ preventScroll: true });
    return el;
  }

  /** Light Markdown for a written page: ## and ### headings, - and 1. lists, **bold**, *italic*, [text](https://...). */
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function markdown(src) {
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<${list.t}>${list.items.join('')}</${list.t}>`); list = null; } };
    for (const block of String(src || '').replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      const first = lines[0];
      if (/^###\s/.test(first)) { flush(); out.push(`<h3>${inline(first.replace(/^###\s+/, ''))}</h3>`); continue; }
      if (/^##?\s/.test(first)) { flush(); out.push(`<h2>${inline(first.replace(/^##?\s+/, ''))}</h2>`); lines.shift(); if (!lines.length) continue; }
      const ul = lines.every((l) => /^[-*]\s+/.test(l));
      const ol = lines.every((l) => /^\d+[.)]\s+/.test(l));
      if (ul || ol) {
        const t = ul ? 'ul' : 'ol';
        if (list && list.t !== t) flush();
        list = list || { t, items: [] };
        for (const l of lines) list.items.push(`<li>${inline(l.replace(/^([-*]|\d+[.)])\s+/, ''))}</li>`);
        continue;
      }
      flush();
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
    flush();
    return out.join('');
  }

  /* ------------------------------------------------------------------ links and routing */
  const courseHref = (slug, lessonId) => `/learn/c/?c=${encodeURIComponent(slug)}${lessonId ? '&l=' + encodeURIComponent(lessonId) : ''}`;
  const pathHref = (slug) => `/learn/p/?p=${encodeURIComponent(slug)}`;
  const link = (href, inner, cls, attrs) => `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" data-ln${attrs || ''}>${inner}</a>`;

  function markNav(id) {
    document.body.dataset.nav = id;
    const tab = id === 'learn-catalog' ? 'learn-catalog' : 'learn';
    $$('.h-tab, .h-pg__a').forEach((a) => {
      if (!a.dataset.navId || !/^learn/.test(a.dataset.navId)) return;
      const on = a.dataset.navId === tab;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function setPage(view, title, navId) {
    root.dataset.view = view;
    document.title = title + ' - FavorOS';
    markNav(navId || 'learn');
  }
  function paint(html, focusH1) {
    root.innerHTML = html;
    root.removeAttribute('aria-busy');
    if (focusH1) {
      window.scrollTo(0, 0);
      const h = $('h1', root);
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  const skeleton = (title) => paint(`<div class="ln-head"><div>${title ? `<h1>${esc(title)}</h1>` : ''}</div></div><div class="ln-list"><div class="ln-card ln-skel h-skel"></div><div class="ln-card ln-skel h-skel"></div></div>`);
  const failure = (err, retry) => {
    paint(`<div class="ln-empty" role="alert"><b>${err && err.status === 404 ? 'That page is gone' : err && err.status === 403 ? 'Not open to you yet' : 'That did not load'}</b><p>${esc((err && err.message) || 'Try again.')}</p><div class="ln-chips"><button type="button" class="h-btn h-btn--primary" data-retry>Try again</button><a class="h-btn h-btn--ghost" href="/learn/" data-ln>My learning</a></div></div>`);
    const b = $('[data-retry]', root);
    if (b) b.addEventListener('click', retry);
  };

  let navToken = 0;
  async function go(href, push) {
    const u = new URL(href, location.href);
    if (u.origin !== location.origin) { location.href = href; return; }
    if (window.__lnLeave) { window.__lnLeave(); window.__lnLeave = null; }
    closeSheet();
    // A sheet that just closed has a history step in flight; a new entry made before it lands would be undone by it.
    if (window.hubOv && window.hubOv.whenIdle) await new Promise((ok) => window.hubOv.whenIdle(ok));
    if (push) history.pushState({ ln: 1 }, '', u.pathname + u.search);
    await render();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-ln]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    go(a.getAttribute('href'), true);
  });
  window.addEventListener('popstate', () => {
    if (window.__hubOvHandled) return;
    if (window.__lnLeave) { window.__lnLeave(); window.__lnLeave = null; }
    closeSheet();
    render();
  });

  async function render() {
    const my = ++navToken;
    const u = new URL(location.href);
    const p = u.pathname.replace(/\/?$/, '/');
    const q = u.searchParams;
    try {
      if (p === '/learn/') await viewHome(my);
      else if (p === '/learn/catalog/') await viewCatalog(my);
      else if (p === '/learn/c/') await viewCourse(q.get('c') || '', q.get('l') || '', my);
      else if (p === '/learn/p/') await viewPath(q.get('p') || '', my);
      else if (p === '/learn/certificate/') await viewCert(q.get('c') || '', q.get('email') || '', my);
      else location.href = '/learn/';
    } catch (err) {
      if (my !== navToken) return;
      failure(err, () => render());
    }
  }

  /* ------------------------------------------------------------------ cards */
  const dueChip = (a) => {
    if (!a.due_date) return '';
    if (a.overdue) return `<span class="ln-chip ln-chip--late">${svg('clock')}Late, was due ${dayWord(a.due_date)}</span>`;
    const left = a.days_left;
    const word = left === 0 ? 'Due today' : left === 1 ? 'Due tomorrow' : 'Due ' + dayWord(a.due_date);
    return `<span class="ln-chip ln-chip--due">${svg('clock')}${word}</span>`;
  };
  const kindChip = (c) => `<span class="ln-chip ln-chip--c">${c.kind === 'path' ? 'Learning path' : 'Course'}</span>`;
  const sizeLine = (c) => {
    const bits = [];
    if (c.kind === 'path') bits.push(plural(c.courses || 0, 'course'));
    else bits.push(plural(c.lessons || 0, 'lesson'));
    if (c.minutes) bits.push('about ' + mins(c.minutes));
    return bits.join(' · ');
  };
  const progLine = (c) => {
    if (c.state === 'done') return c.completed_at ? 'Completed ' + dayWord(c.completed_at.slice(0, 10)) : 'Completed';
    if (!c.total) return '';
    return `${c.done} of ${plural(c.total, 'lesson')} done`;
  };
  const tile = (c, sm) => `<span class="ln-tile${sm ? ' ln-tile--sm' : ''}">${svg(c.kind === 'path' ? 'path' : 'course')}</span>`;

  function cardHtml(c) {
    return `<a class="ln-card ln-cc ln-c--${esc(c.color)}" href="${esc(c.href)}" data-ln>
      <span class="ln-cc__top">${tile(c)}<span class="ln-cc__t"><b>${esc(c.title)}</b>${c.summary ? `<span>${esc(c.summary)}</span>` : ''}</span></span>
      <span class="ln-cc__foot">
        ${c.state === 'new' ? '' : `<span class="ln-bar"><i style="width:${c.pct}%"></i></span>`}
        <span class="ln-cc__meta"><span>${esc(sizeLine(c))}</span>${c.state === 'new' ? '' : `<span>${esc(progLine(c))}</span>`}</span>
        <span class="ln-chips">${kindChip(c)}${c.audience ? `<span class="ln-chip">${esc(c.audience)}</span>` : ''}${c.state === 'done' ? `<span class="ln-chip ln-chip--ok">${svg('check')}Done</span>` : ''}</span>
      </span></a>`;
  }

  /* ------------------------------------------------------------------ My learning */
  const HOME_KEY = 'favor.learn.home.v1';
  async function viewHome(my) {
    setPage('home', 'My learning', 'learn');
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(HOME_KEY) || 'null'); } catch (e) { /* none */ }
    if (cached) drawHome(cached); else skeleton('My learning');
    const d = await api('/api/learn/home');
    if (my !== navToken) return;
    try { sessionStorage.setItem(HOME_KEY, JSON.stringify(d)); } catch (e) { /* storage refused */ }
    drawHome(d);
  }
  function assignedHtml(a) {
    const next = a.next;
    const href = a.kind === 'path' ? pathHref(a.slug) : courseHref(a.slug, next && a.state !== 'new' ? next.id : '');
    const go = a.state === 'new' ? 'Start' : 'Continue';
    const parts = a.parts && a.parts.length ? `<div class="ln-ac__parts">${a.parts.map((p) => `<span class="ln-chip${p.state === 'done' ? ' ln-chip--ok' : ''}">${p.state === 'done' ? svg('check') : ''}${esc(p.title)}</span>`).join('')}</div>` : '';
    return `<div class="ln-card ln-ac ln-c--${esc(a.color)}${a.overdue ? ' ln-ac--late' : ''}">
      ${tile(a)}
      <div class="ln-ac__t"><b>${link(href, esc(a.title))}</b>
        <div class="ln-chips">${kindChip(a)}${dueChip(a)}<span class="ln-chip">${esc(sizeLine(a))}</span></div>
        ${a.note ? `<p>${esc(a.note)}</p>` : a.assigned_by ? `<p>Assigned by ${esc(a.assigned_by)}</p>` : ''}
        <div class="ln-ac__prog">${a.state === 'new' ? '' : `<span class="ln-bar"><i style="width:${a.pct}%"></i></span><span>${esc(progLine(a))}</span>`}</div>
      </div>
      <div class="ln-ac__go">${link(href, go, 'h-btn h-btn--primary')}</div>
      ${parts}</div>`;
  }
  function drawHome(d) {
    const s = d.stats || {};
    const stats = [];
    if (s.assigned) stats.push(`<span class="ln-stat"><b>${s.assigned}</b>assigned</span>`);
    if (s.overdue) stats.push(`<span class="ln-stat ln-stat--late"><b>${s.overdue}</b>late</span>`);
    if (s.due_soon) stats.push(`<span class="ln-stat"><b>${s.due_soon}</b>due within a week</span>`);
    if (s.completed) stats.push(`<span class="ln-stat"><b>${s.completed}</b>completed</span>`);
    const cont = d.continue && d.assigned.length === 0 ? d.continue : null;
    const resume = cont ? `<div class="ln-resume"><div class="ln-resume__t"><small>Where you left off</small><b>${esc(cont.title)}</b><span class="ln-bar"><i style="width:${cont.pct}%"></i></span></div>${link(cont.href, 'Continue', 'h-btn h-btn--primary h-btn--lg')}</div>` : '';
    const assigned = d.assigned.length ? `<section class="ln-sec" aria-label="Assigned to you"><h2>Assigned to you <em>${d.assigned.length}</em></h2><div class="ln-list">${d.assigned.map(assignedHtml).join('')}</div></section>` : '';
    const prog = d.in_progress.length ? `<section class="ln-sec" aria-label="In progress"><h2>In progress <em>${d.in_progress.length}</em></h2><div class="ln-grid">${d.in_progress.map(cardHtml).join('')}</div></section>` : '';
    const done = d.completed.length ? `<section class="ln-sec" aria-label="Completed"><h2>Completed <em>${d.completed.length}</em></h2><div class="ln-list">${d.completed.map(doneRow).join('')}</div></section>` : '';
    const empty = !d.assigned.length && !d.in_progress.length && !d.completed.length
      ? `<div class="ln-empty"><b>Nothing assigned to you</b><p>Courses and learning paths that someone assigns show here with their due dates. The catalog lists everything you can take on your own.</p>${link('/learn/catalog/', 'Open the catalog', 'h-btn h-btn--primary')}</div>`
      : !d.assigned.length && !d.in_progress.length && d.completed.length
        ? `<div class="ln-empty"><b>You are all caught up</b><p>Nothing is assigned to you right now.</p>${link('/learn/catalog/', 'Open the catalog', 'h-btn h-btn--ghost')}</div>`
        : '';
    paint(`<div class="ln-head"><div><h1>My learning</h1></div></div>
      ${stats.length ? `<div class="ln-stats">${stats.join('')}</div>` : ''}${resume}${assigned}${prog}${done}${empty}`, false);
  }
  function doneRow(c) {
    return `<a class="ln-card ln-lr ln-c--${esc(c.color)}" href="${esc(c.href)}" data-ln style="grid-template-columns:36px minmax(0,1fr) auto">
      <span class="ln-tile ln-tile--sm">${svg('check')}</span><span class="ln-lr__t"><b>${esc(c.title)}</b><span>${esc(progLine(c))}</span></span>
      <span class="ln-lr__m">${c.cert ? 'Certificate' : ''}</span></a>`;
  }

  /* ------------------------------------------------------------------ catalog */
  async function viewCatalog(my) {
    setPage('catalog', 'Catalog', 'learn-catalog');
    skeleton('Catalog');
    const d = await api('/api/learn/catalog');
    if (my !== navToken) return;
    drawCatalog(d);
  }
  function drawCatalog(d) {
    const st = { q: '', f: 'all' };
    const all = [...d.paths, ...d.courses];
    paint(`<div class="ln-head"><div><h1>Catalog</h1><p>${plural(d.paths.length, 'learning path')} and ${plural(d.courses.length, 'course')}</p></div></div>
      <div class="ln-tools">
        <label class="ln-search">${svg('search')}<span class="ln-sr">Search courses</span><input id="ln-q" type="search" placeholder="Search courses and paths" autocomplete="off" /></label>
        <div class="ln-seg" role="group" aria-label="Show">
          <button type="button" data-f="all" aria-pressed="true">All</button><button type="button" data-f="new" aria-pressed="false">Not started</button>
          <button type="button" data-f="started" aria-pressed="false">In progress</button><button type="button" data-f="done" aria-pressed="false">Completed</button>
        </div>
      </div><div id="ln-res"></div>`, false);
    const draw = () => {
      const needle = st.q.trim().toLowerCase();
      const hit = (c) => (st.f === 'all' || c.state === st.f) && (!needle || `${c.title} ${c.summary} ${c.audience}`.toLowerCase().includes(needle));
      const paths = d.paths.filter(hit);
      const courses = d.courses.filter(hit);
      $('#ln-res', root).innerHTML = !paths.length && !courses.length
        ? `<div class="ln-empty"><b>${all.length ? 'Nothing matches' : 'No courses yet'}</b><p>${all.length ? 'Try a different word or filter.' : 'Published courses show here.'}</p></div>`
        : `${paths.length ? `<section class="ln-sec"><h2>Learning paths <em>${paths.length}</em></h2><div class="ln-grid">${paths.map(cardHtml).join('')}</div></section>` : ''}
           ${courses.length ? `<section class="ln-sec" style="margin-top:20px"><h2>Courses <em>${courses.length}</em></h2><div class="ln-grid">${courses.map(cardHtml).join('')}</div></section>` : ''}`;
    };
    draw();
    $('#ln-q', root).addEventListener('input', (e) => { st.q = e.target.value; draw(); });
    $$('.ln-seg button', root).forEach((b) => b.addEventListener('click', () => {
      st.f = b.dataset.f;
      $$('.ln-seg button', root).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      draw();
    }));
  }

  /* ------------------------------------------------------------------ a course */
  let C = null; // the course on screen
  let previewing = false;
  let celebrate = false; // the next course page opens with the completion panel

  async function viewCourse(slug, lessonId, my) {
    if (!slug) { location.href = '/learn/catalog/'; return; }
    setPage('course', 'Course', 'learn-course');
    const open = (justDone) => {
      document.title = C.title + ' - FavorOS';
      if (lessonId && C.lesson_list.some((l) => l.id === lessonId)) return drawPlayer(lessonId, my);
      drawCourse(justDone);
    };
    // Moving inside a course you already have open draws at once from the copy in hand, then reads the server's copy.
    if (C && C.slug === slug) {
      const now = celebrate;
      celebrate = false;
      await open(now);
      try {
        const d = await api('/api/learn/course/' + encodeURIComponent(slug));
        if (my !== navToken) return;
        C = d.course;
        previewing = !!d.preview;
        if (!lessonId && !now) drawCourse(false);
      } catch (e) { /* the copy in hand stands */ }
      return;
    }
    skeleton('');
    const d = await api('/api/learn/course/' + encodeURIComponent(slug));
    if (my !== navToken) return;
    C = d.course;
    previewing = !!d.preview;
    const now = celebrate;
    celebrate = false;
    await open(now);
  }
  const bannerFor = (c) => {
    const a = c.assignment;
    if (!a) return '';
    const who = a.assigned_by ? ` by ${esc(a.assigned_by)}` : '';
    if (a.overdue) return `<div class="ln-banner ln-banner--late">${svg('clock')}Assigned to you${who}, was due ${dayWord(a.due_date)}${a.note ? `<small>${esc(a.note)}</small>` : ''}</div>`;
    return `<div class="ln-banner">${svg('clock')}Assigned to you${who}${a.due_date ? ', due ' + dayWord(a.due_date) : ''}${a.note ? `<small>${esc(a.note)}</small>` : ''}</div>`;
  };
  function drawCourse(justDone) {
    const c = C;
    const total = c.lesson_list.length;
    const cur = c.next_id;
    const started = c.state !== 'new';
    const cta = c.state === 'done' ? 'Review' : started ? 'Continue' : 'Start';
    const startId = c.state === 'done' ? c.lesson_list[0] && c.lesson_list[0].id : cur || (c.lesson_list[0] && c.lesson_list[0].id);
    const left = c.lesson_list.filter((l) => l.state !== 'done').reduce((n, l) => n + l.minutes, 0);
    const rows = c.lesson_list.map((l, i) => lessonRow(l, i, c.slug, l.id === cur && started)).join('');
    const paths = c.paths && c.paths.length ? `<div class="ln-chips">${c.paths.map((p) => link(pathHref(p.slug), `${svg('path')}${esc(p.title)}`, 'ln-chip ln-chip--c')).join('')}</div>` : '';
    paint(`<nav class="ln-crumb" aria-label="Where you are">${link('/learn/', 'My learning')}<i>/</i>${link('/learn/catalog/', 'Catalog')}</nav>
      ${previewing ? `<div class="ln-banner">Draft. Only admins and HR can open this course, and nothing you do here is recorded.</div>` : ''}
      ${justDone ? completionHtml(c) : ''}
      <section class="ln-card ln-hero ln-c--${esc(c.color)}">
        <div class="ln-hero__top">${tile({ kind: 'course' })}<div><h1>${esc(c.title)}</h1>${c.summary ? `<p>${esc(c.summary)}</p>` : ''}</div></div>
        <div class="ln-chips"><span class="ln-chip">${plural(total, 'lesson')}</span>${c.minutes ? `<span class="ln-chip">about ${mins(c.minutes)}</span>` : ''}${c.audience ? `<span class="ln-chip">${esc(c.audience)}</span>` : ''}${c.state === 'done' ? `<span class="ln-chip ln-chip--ok">${svg('check')}Completed</span>` : ''}</div>
        ${bannerFor(c)}
        <div class="ln-hero__row">
          ${started && c.state !== 'done' ? `<div class="ln-hero__prog"><span class="ln-bar ln-bar--lg"><i style="width:${c.pct}%"></i></span><span>${c.done} of ${total} done${left ? ', about ' + mins(left) + ' left' : ''}</span></div>` : ''}
          ${startId ? link(courseHref(c.slug, startId), cta, 'h-btn h-btn--primary h-btn--lg') : ''}
          ${c.state === 'done' && c.completed ? link(`/learn/certificate/?c=${encodeURIComponent(c.slug)}`, `${svg('cert')} Certificate`, 'h-btn h-btn--ghost h-btn--lg') : ''}
        </div>
        ${paths}
      </section>
      <section class="ln-sec ln-c--${esc(c.color)}" aria-label="Lessons"><h2>Lessons <em>${total}</em></h2><div class="ln-card ln-lessons">${rows || '<p style="padding:16px;margin:0">This course has no lessons yet.</p>'}</div></section>`, true);
  }
  function lessonRow(l, i, slug, current) {
    const state = l.state;
    const num = state === 'done' ? svg('check') : String(i + 1);
    const sub = [KIND[l.kind] || l.kind, state === 'started' && l.kind === 'video' && l.position ? 'stopped at ' + clockTime(l.position) : '', l.kind === 'quiz' && l.best != null ? `best ${l.best}%` : ''].filter(Boolean).join(' · ');
    return `<a class="ln-lr is-${state}${current ? ' is-cur' : ''}" href="${esc(courseHref(slug, l.id))}" data-ln>
      <span class="ln-lr__n">${num}</span><span class="ln-tile ln-tile--sm" style="background:var(--r-sunk);color:var(--r-ink-2)">${svg(l.kind)}</span>
      <span class="ln-lr__t"><b>${esc(l.title)}</b><span>${esc(sub)}</span></span><span class="ln-lr__m">${l.minutes ? mins(l.minutes) : ''}</span></a>`;
  }
  function completionHtml(c) {
    const p = c.paths && c.paths[0];
    return `<section class="ln-done" aria-label="Course complete"><h2>Course complete</h2><p>${esc(c.title)} is on your record. The certificate is ready to print.</p>
      <div class="ln-chips">${link(`/learn/certificate/?c=${encodeURIComponent(c.slug)}`, `${svg('cert')} Open the certificate`, 'h-btn h-btn--primary')}${p ? link(pathHref(p.slug), `Back to ${esc(p.title)}`, 'h-btn h-btn--ghost') : ''}${link('/learn/', 'My learning', 'h-btn h-btn--ghost')}</div></section>`;
  }

  /* ------------------------------------------------------------------ the player */
  const lessonIndex = (id) => C.lesson_list.findIndex((l) => l.id === id);
  function outlineHtml(curId) {
    return C.lesson_list.map((l, i) => lessonRow(l, i, C.slug, l.id === curId)).join('');
  }
  function driveInfo(url) {
    const m = /(docs|drive)\.google\.com\/(document|spreadsheets|presentation|file)\/d\/([\w-]+)/.exec(url || '');
    if (!m) return null;
    const host = m[2] === 'file' ? 'drive.google.com' : 'docs.google.com';
    return { id: m[3], preview: `https://${host}/${m[2]}/d/${m[3]}/preview`, type: m[2] };
  }
  const saveProgress = (lesson, state, position, keep) =>
    post('/api/learn/progress', { lesson_id: lesson.id, state, position: Math.round(position || 0) }, keep ? { keepalive: true } : undefined);

  /** Applies the server's answer about the course to the page's copy. */
  function applyCourse(res, lessonId, state) {
    if (res.preview) return;
    const l = C.lesson_list.find((x) => x.id === lessonId);
    if (l && state) l.state = state;
    if (res.course) {
      C.done = res.course.done;
      C.total = res.course.total;
      C.pct = res.course.pct;
      if (res.course.completed) { C.state = 'done'; C.completed = res.course.completed; } else if (C.done > 0 || C.lesson_list.some((x) => x.state !== 'new')) C.state = 'started';
    }
    try { sessionStorage.removeItem(HOME_KEY); } catch (e) { /* none */ }
  }

  function refreshOutline(curId) {
    const side = $('.ln-side .ln-lessons', root);
    if (side) side.innerHTML = outlineHtml(curId);
  }

  async function drawPlayer(lessonId, my) {
    const i = lessonIndex(lessonId);
    const l = C.lesson_list[i];
    const prev = C.lesson_list[i - 1];
    const next = C.lesson_list[i + 1];
    setPage('player', C.title, 'learn-course');
    document.title = `${l.title} - ${C.title} - FavorOS`;
    const colorCls = `ln-c--${esc(C.color)}`;
    const done = l.state === 'done';
    const body = `<div id="ln-body" class="ln-lesson ln-card">${lessonBody(l)}</div>`;
    paint(`<nav class="ln-crumb" aria-label="Where you are">${link('/learn/', 'My learning')}<i>/</i>${link(courseHref(C.slug), esc(C.title))}</nav>
      ${previewing ? `<div class="ln-banner">Draft preview. Nothing you do here is recorded.</div>` : ''}
      <div class="ln-play ${colorCls}">
        <div class="ln-main">
          <div class="ln-lh"><div><h1>${esc(l.title)}</h1><div class="ln-chips"><span class="ln-chip ln-chip--c">${KIND[l.kind] || l.kind}</span><span class="ln-chip">Lesson ${i + 1} of ${C.lesson_list.length}</span>${l.minutes ? `<span class="ln-chip">${mins(l.minutes)}</span>` : ''}${done ? `<span class="ln-chip ln-chip--ok">${svg('check')}Done</span>` : ''}</div></div>
            <button type="button" class="h-btn h-btn--ghost ln-lessons-btn" id="ln-outline-btn">${svg('list').replace('<svg', '<svg class="h-i" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2"')} Lessons</button></div>
          ${body}
          <div class="ln-acts" id="ln-acts">${actionsHtml(l, prev, next)}</div>
        </div>
        <aside class="ln-card ln-side ${colorCls}" aria-label="Lessons in this course"><h2>${esc(C.title)}</h2><div class="ln-lessons" style="padding:0">${outlineHtml(l.id)}</div></aside>
      </div>`, true);
    const btn = $('#ln-outline-btn', root);
    if (btn) btn.addEventListener('click', () => {
      const el = openSheet(C.title, `<div class="ln-card ln-lessons ${colorCls}">${outlineHtml(l.id)}</div>`);
      el.addEventListener('click', (e) => { if (e.target.closest('a[data-ln]')) closeSheet(); });
    });
    wireLesson(l, prev, next, my);
    // Opening a lesson that is not finished records that it was started (and where a video stopped).
    if (!done && l.kind !== 'quiz' && !previewing) saveProgress(l, 'started', l.position || 0).then((r) => applyCourse(r, l.id, 'started')).catch(() => undefined);
  }

  function actionsHtml(l, prev, next) {
    const done = l.state === 'done';
    const left = prev ? link(courseHref(C.slug, prev.id), 'Previous', 'h-btn h-btn--ghost') : link(courseHref(C.slug), 'Course page', 'h-btn h-btn--ghost');
    if (l.kind === 'quiz') {
      return `<div>${left}</div><div class="ln-acts__r">${done ? `<span class="ln-done-note">${svg('check')}Passed</span>` : ''}${next ? link(courseHref(C.slug, next.id), 'Next lesson', 'h-btn ' + (done ? 'h-btn--primary' : 'h-btn--ghost')) : done ? link(courseHref(C.slug), 'Back to the course', 'h-btn h-btn--primary') : ''}</div>`;
    }
    return `<div>${left}</div><div class="ln-acts__r">${done ? `<span class="ln-done-note">${svg('check')}Done</span>` : ''}
      <button type="button" class="h-btn h-btn--primary h-btn--lg" id="ln-finish">${done ? (next ? 'Next lesson' : 'Finish course') : next ? 'Mark complete and continue' : 'Mark complete and finish'}</button></div>`;
  }

  function lessonBody(l) {
    switch (l.kind) {
      case 'video':
        return `<div class="ln-vid"><video id="ln-video" controls playsinline preload="metadata" poster="/api/videos/${esc(l.ref)}.jpg${l.cut ? '?v=' + esc(l.cut) : ''}"><source src="/api/videos/${esc(l.ref)}.mp4${l.cut ? '?v=' + esc(l.cut) : ''}" type="video/mp4" /><track kind="captions" src="/api/videos/${esc(l.ref)}.vtt${l.cut ? '?v=' + esc(l.cut) : ''}" srclang="en" label="English" default /></video></div>
          <div class="ln-chips">${link('/help/videos/' + encodeURIComponent(l.ref) + '/', 'Captions and transcript', 'ln-chip', ' target="_blank" rel="noopener"')}</div>`;
      case 'article':
        return `<div class="ln-art" id="ln-art"><div class="ln-card ln-skel h-skel" style="min-height:200px"></div></div>`;
      case 'doc': {
        const info = driveInfo(l.ref);
        return `${info ? `<iframe class="ln-frame" title="${esc(l.title)}" src="${esc(info.preview)}" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ''}
          <div class="ln-open"><b>${esc(l.title)}</b><span>${esc(l.ref)}</span><a class="h-btn h-btn--ghost" href="${esc(l.ref)}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a></div>`;
      }
      case 'page':
        return `<div class="ln-page">${markdown(l.body)}</div>`;
      case 'clip':
        return `<div class="ln-vid"><video id="ln-video" controls playsinline preload="metadata" poster="/api/clips/${esc(l.ref)}/media?poster=1" src="/api/clips/${esc(l.ref)}/media"></video></div>
          <div class="ln-chips">${link('/c/' + encodeURIComponent(l.ref), 'Open the clip page', 'ln-chip', ' target="_blank" rel="noopener"')}</div>`;
      case 'link':
        return `<div class="ln-open"><b>${esc(l.title)}</b><span>${esc(l.ref)}</span><a class="h-btn h-btn--primary" href="${esc(l.ref)}" target="_blank" rel="noopener noreferrer">Open the link</a></div>`;
      case 'quiz':
        return quizHtml(l);
      default:
        return '';
    }
  }

  let videoCleanup = null;
  function wireLesson(l, prev, next, my) {
    const finish = $('#ln-finish', root);
    if (finish) finish.addEventListener('click', () => completeLesson(l, next, finish));
    if (l.kind === 'article') loadArticle(l, my);
    if (l.kind === 'quiz') wireQuiz(l, next);
    const v = $('#ln-video', root);
    if (v && (l.kind === 'video' || l.kind === 'clip')) {
      let last = 0;
      let sent = 0;
      let doneSent = l.state === 'done';
      const resumeAt = l.state === 'done' ? 0 : l.position || 0;
      v.addEventListener('loadedmetadata', () => { if (resumeAt > 3 && resumeAt < (v.duration || 1e9) - 5) { try { v.currentTime = resumeAt; } catch (e) { /* the player decides */ } } }, { once: true });
      const save = (keep) => {
        if (previewing || doneSent || !v.currentTime) return;
        const t = Math.floor(v.currentTime);
        if (!keep && Math.abs(t - sent) < 8) return;
        sent = t;
        saveProgress(l, 'started', t, keep).catch(() => undefined);
      };
      v.addEventListener('timeupdate', () => { const n = Date.now(); if (n - last > 10000) { last = n; save(false); } });
      v.addEventListener('pause', () => save(true));
      v.addEventListener('ended', () => {
        if (doneSent) return;
        doneSent = true;
        completeLesson(l, next, null, true);
      });
      const hide = () => { if (document.visibilityState === 'hidden') save(true); };
      document.addEventListener('visibilitychange', hide);
      window.addEventListener('pagehide', hide);
      window.__lnLeave = () => { save(true); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', hide); try { v.pause(); } catch (e) { /* gone */ } };
    }
  }

  async function loadArticle(l, my) {
    const box = $('#ln-art', root);
    try {
      const res = await fetch('/help/' + encodeURIComponent(l.ref) + '/', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('missing');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const art = $('.hd-article', doc);
      if (!art) throw new Error('missing');
      if (my !== navToken) return;
      const figs = $$('figure.hd-video', art).map((f) => f.outerHTML).join('');
      const body = $('.hd-body', art);
      // Links inside the article stay in the hub, in the same tab.
      box.innerHTML = `${figs}<div class="hd-body">${body ? body.innerHTML : ''}</div><p style="margin:16px 0 0"><a class="ln-chip" href="/help/${encodeURIComponent(l.ref)}/" target="_blank" rel="noopener">Open the full article</a></p>`;
      $$('video[data-video]', box).forEach((vv) => { vv.preload = 'none'; });
    } catch (e) {
      box.innerHTML = `<div class="ln-open"><b>${esc(l.title)}</b><a class="h-btn h-btn--ghost" href="/help/${encodeURIComponent(l.ref)}/" target="_blank" rel="noopener">Open the article</a></div>`;
    }
  }

  async function completeLesson(l, next, btn, fromVideo) {
    if (previewing) { toast('Draft preview. Nothing is recorded.'); if (next) go(courseHref(C.slug, next.id), true); else go(courseHref(C.slug), true); return; }
    if (btn) { btn.disabled = true; }
    try {
      let res = { course: null };
      if (l.state !== 'done') {
        res = await saveProgress(l, 'done', 0);
        applyCourse(res, l.id, 'done');
      }
      if (res.just_completed) { celebrate = true; await go(courseHref(C.slug), true); return; }
      if (next) await go(courseHref(C.slug, next.id), true);
      else await go(courseHref(C.slug), true);
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(e.message || 'That did not save. Try again.');
      if (fromVideo) return;
    }
  }

  /* ------------------------------------------------------------------ quiz */
  function quizHtml(l) {
    const q = l.quiz;
    const best = l.best != null ? `<p class="ln-sum">Your best score is ${l.best}%${l.attempts ? ' in ' + plural(l.attempts, 'try', 'tries') : ''}.</p>` : '';
    return `<div class="ln-qz" id="ln-qz">
      <p class="ln-sum">${plural(q.questions.length, 'question')}. Pass mark ${q.pass}%. You can retake it as many times as you like.</p>${best}
      <div id="ln-result"></div>
      <form id="ln-qform" class="ln-qz" novalidate>${q.questions.map((x, i) => `
        <div class="ln-q" role="radiogroup" aria-labelledby="ln-qt-${i}" data-q="${esc(x.id)}"><p class="ln-q__h" id="ln-qt-${i}"><span>${i + 1}</span>${esc(x.text)}</p>
          <div class="ln-opts">${x.options.map((o, j) => `<label class="ln-opt"><input type="radio" name="${esc(x.id)}" value="${j}" /><span>${esc(o)}</span></label>`).join('')}</div>
          <p class="ln-why" hidden></p></div>`).join('')}
        <div class="ln-acts"><span class="ln-sum" id="ln-count"></span><button type="submit" class="h-btn h-btn--primary h-btn--lg" id="ln-submit" disabled>Submit answers</button></div>
      </form></div>`;
  }
  function wireQuiz(l, next) {
    const form = $('#ln-qform', root);
    const n = l.quiz.questions.length;
    const sub = $('#ln-submit', root);
    const count = $('#ln-count', root);
    const answers = () => { const a = {}; $$('input:checked', form).forEach((i) => { a[i.name] = Number(i.value); }); return a; };
    const sync = () => { const k = Object.keys(answers()).length; count.textContent = `${k} of ${n} answered`; sub.disabled = k < n; };
    form.addEventListener('change', sync);
    sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      sub.disabled = true;
      try {
        const r = await post('/api/learn/quiz/' + encodeURIComponent(l.id), { answers: answers() });
        showResult(l, next, r);
        applyCourse(r, l.id, r.passed ? 'done' : null);
        refreshOutline(l.id);
        if (r.best != null) { l.best = r.best; l.attempts = r.attempts; }
        if (r.just_completed) setTimeout(() => { celebrate = true; go(courseHref(C.slug), true); }, 2600);
      } catch (err) {
        sub.disabled = false;
        toast(err.message || 'That did not save. Try again.');
      }
    });
  }
  function showResult(l, next, r) {
    const form = $('#ln-qform', root);
    const box = $('#ln-result', root);
    const byId = new Map(r.results.map((x) => [x.id, x]));
    $$('.ln-q', form).forEach((fs) => {
      const x = byId.get(fs.dataset.q);
      fs.classList.toggle('is-right', !!x && x.correct);
      fs.classList.toggle('is-wrong', !!x && !x.correct);
      $$('input', fs).forEach((i) => { i.disabled = true; });
      const why = $('.ln-why', fs);
      if (x && x.explain && (!x.correct || r.passed)) { why.hidden = false; why.textContent = (x.correct ? 'Right. ' : 'Not quite. ') + x.explain; }
      if (x && r.passed && x.answer != null) $$('.ln-opt', fs)[x.answer].classList.add('is-key');
    });
    box.innerHTML = `<div class="ln-score ${r.passed ? 'ln-score--pass' : 'ln-score--fail'}" role="status"><span class="ln-score__n">${r.score}%</span>
      <div><b>${r.passed ? 'Passed' : 'Not yet'}</b><p>${r.correct} of ${r.total} right. Pass mark ${r.pass}%.${r.attempts > 1 ? ' Try ' + r.attempts + '.' : ''}${r.preview ? ' Draft preview, not recorded.' : ''}</p></div></div>`;
    const acts = $('.ln-acts', form);
    acts.innerHTML = r.passed
      ? `<span></span><div class="ln-acts__r">${next ? link(courseHref(C.slug, next.id), 'Next lesson', 'h-btn h-btn--primary h-btn--lg') : (r.just_completed ? link(`/learn/certificate/?c=${encodeURIComponent(C.slug)}`, 'Open the certificate', 'h-btn h-btn--primary h-btn--lg') : link(courseHref(C.slug), 'Back to the course', 'h-btn h-btn--primary h-btn--lg'))}</div>`
      : `<span class="ln-sum">Review the marked questions and try again.</span><button type="button" class="h-btn h-btn--primary h-btn--lg" id="ln-retake">Retake the quiz</button>`;
    const re = $('#ln-retake', root);
    if (re) re.addEventListener('click', () => { $('#ln-body', root).innerHTML = quizHtml(l); wireQuiz(l, next); window.scrollTo({ top: 0 }); });
    box.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------------ a path */
  async function viewPath(slug, my) {
    if (!slug) { location.href = '/learn/catalog/'; return; }
    setPage('path', 'Learning path', 'learn-path');
    skeleton('');
    const d = await api('/api/learn/path/' + encodeURIComponent(slug));
    if (my !== navToken) return;
    const p = d.path;
    document.title = p.title + ' - FavorOS';
    const nextSlug = p.next_course && p.next_course.slug;
    const a = p.assignment;
    const banner = a ? `<div class="ln-banner${a.overdue ? ' ln-banner--late' : ''}">${svg('clock')}Assigned to you${a.assigned_by ? ' by ' + esc(a.assigned_by) : ''}${a.due_date ? (a.overdue ? ', was due ' : ', due ') + dayWord(a.due_date) : ''}${a.note ? `<small>${esc(a.note)}</small>` : ''}</div>` : '';
    paint(`<nav class="ln-crumb" aria-label="Where you are">${link('/learn/', 'My learning')}<i>/</i>${link('/learn/catalog/', 'Catalog')}</nav>
      ${d.preview ? '<div class="ln-banner">Draft. Only admins and HR can open this path.</div>' : ''}
      <section class="ln-card ln-hero ln-c--${esc(p.color)}">
        <div class="ln-hero__top">${tile({ kind: 'path' })}<div><h1>${esc(p.title)}</h1>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div></div>
        <div class="ln-chips"><span class="ln-chip">${plural(p.courses || 0, 'course')}</span>${p.minutes ? `<span class="ln-chip">about ${mins(p.minutes)}</span>` : ''}${p.audience ? `<span class="ln-chip">${esc(p.audience)}</span>` : ''}${p.state === 'done' ? `<span class="ln-chip ln-chip--ok">${svg('check')}Completed</span>` : ''}</div>
        ${banner}
        <div class="ln-hero__row">${p.state !== 'new' && p.state !== 'done' ? `<div class="ln-hero__prog"><span class="ln-bar ln-bar--lg"><i style="width:${p.pct}%"></i></span><span>${p.done} of ${plural(p.total, 'lesson')} done</span></div>` : ''}
          ${nextSlug ? link(courseHref(nextSlug), p.state === 'new' ? 'Start' : 'Continue', 'h-btn h-btn--primary h-btn--lg') : ''}</div>
      </section>
      <section class="ln-sec" aria-label="Courses in this path"><h2>Courses <em>${p.course_list.length}</em></h2>
        <div class="ln-steps">${p.course_list.map((c, i) => `<div class="ln-step${c.state === 'done' ? ' is-done' : ''}${c.slug === nextSlug ? ' is-next' : ''} ln-c--${esc(c.color)}"><span class="ln-step__n">${c.state === 'done' ? svg('check') : i + 1}</span>${cardHtml(c)}</div>`).join('')}</div></section>`, true);
  }

  /* ------------------------------------------------------------------ certificate */
  async function viewCert(slug, email, my) {
    if (!slug) { location.href = '/learn/'; return; }
    setPage('cert', 'Certificate', 'learn-cert');
    skeleton('');
    const d = await api('/api/learn/certificate/' + encodeURIComponent(slug) + (email ? '?email=' + encodeURIComponent(email) : ''));
    if (my !== navToken) return;
    const c = d.certificate;
    document.title = `Certificate - ${c.course} - FavorOS`;
    paint(`<nav class="ln-crumb ln-noprint" aria-label="Where you are">${link('/learn/', 'My learning')}<i>/</i>${link(courseHref(slug), esc(c.course))}</nav>
      <div class="ln-cert-wrap"><article class="ln-cert" aria-label="Certificate of completion">
        <img src="/images/favor-logo-color.png" alt="Favor International" />
        <small>Certificate of completion</small>
        <h1>${esc(c.name)}</h1>
        <p>completed</p>
        <h2>${esc(c.course)}</h2>
        <div class="ln-cert__foot"><div><b>${esc(longDay(c.completed_at))}</b><span>Date completed</span></div><div><b>${esc(c.cert)}</b><span>Certificate number</span></div></div>
      </article>
      <div class="ln-chips ln-noprint"><button type="button" class="h-btn h-btn--primary h-btn--lg" id="ln-print">Print</button>${link(courseHref(slug), 'Back to the course', 'h-btn h-btn--ghost h-btn--lg')}</div></div>`, true);
    $('#ln-print', root).addEventListener('click', () => window.print());
  }

  render();
})();
