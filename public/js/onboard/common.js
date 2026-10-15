/* Onboarding pages: the small helpers all three pages share (calls to /api/onboarding, dates, avatars, a person field that sits
   inside a form, a confirm sheet, a toast). The people list and sheets come from request-tasks.js (window.ReqTasks), which every
   hub page loads. */
(() => {
  'use strict';
  if (window.Onb) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/New_York';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const dayWord = (d, withYear) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined }) : '');
  const longDay = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : '');
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const ICON = {
    check: '<path d="m5 12 5 5 9-10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
    door: '<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17"/><path d="M3 21h18M12 12h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch('/api/onboarding/' + path, init); } catch (e) { throw new Error('No connection. Check your internet and try again.'); }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && data.message) || 'Something went wrong. Try again.');
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  let toastEl = null;
  let toastT = 0;
  function toast(msg, bad) {
    if (window.hubToast) { window.hubToast(msg, { tone: bad ? 'bad' : '' }); return; }
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ob-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-bad', !!bad);
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), bad ? 5200 : 2600);
  }

  // request-tasks.js is loaded by the layout after the page's own script, so wait for it before the first call.
  const ready = () => new Promise((resolve) => {
    let n = 0;
    const t = () => { if (window.ReqTasks) resolve(window.ReqTasks); else if (++n > 200) resolve(null); else setTimeout(t, 25); };
    t();
  });
  const RT = () => window.ReqTasks;
  const avatar = (email, size) => (RT() ? RT().avatar(email, size) : '');
  const nameOf = (email) => (RT() ? RT().person(email).name : String(email || '').split('@')[0]);

  /** A person field that lives inside a form: type to search the staff list, press a name to choose. */
  function personField(host, opts = {}) {
    const state = { email: opts.value || '' };
    host.classList.add('ob-pf');
    host.innerHTML = `<div class="ob-pf__box"><span class="ob-pf__face"></span><input type="text" class="ob-in" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="${esc(opts.label || 'Person')}" placeholder="${esc(opts.placeholder || 'Search by name or team')}" /><button type="button" class="ob-pf__x" aria-label="Clear" hidden>${ic('x')}</button></div><div class="ob-pf__list" role="listbox" hidden></div>`;
    const input = host.querySelector('input');
    const list = host.querySelector('.ob-pf__list');
    const face = host.querySelector('.ob-pf__face');
    const clear = host.querySelector('.ob-pf__x');
    let shown = [];
    let hi = 0;
    const paint = () => {
      if (state.email) {
        const p = RT().person(state.email);
        input.value = p.name;
        face.innerHTML = avatar(state.email, 'sm');
      } else face.innerHTML = '';
      clear.hidden = !state.email;
    };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const choose = (email) => { state.email = email; paint(); close(); if (opts.onChange) opts.onChange(email); };
    const draw = () => {
      const q = input.value.trim();
      const exclude = new Set((opts.exclude || []).map((e) => e.toLowerCase()));
      shown = RT().match(state.email && q === RT().person(state.email).name ? '' : q).filter((p) => !exclude.has(p.email)).slice(0, 30);
      hi = 0;
      list.innerHTML = shown.length
        ? shown.map((p, i) => `<button type="button" role="option" class="ob-pf__opt${i === 0 ? ' is-hi' : ''}" data-email="${esc(p.email)}">${avatar(p.email, 'sm')}<span><b>${esc(p.name)}</b><small>${esc([p.team, p.title].filter(Boolean).join(' · '))}</small></span></button>`).join('')
        : '<p class="ob-pf__none">Nobody on the staff list matches.</p>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    ready().then(() => RT().people()).then(paint);
    input.addEventListener('focus', () => { RT().people().then(draw); });
    input.addEventListener('input', () => { if (state.email) { state.email = ''; clear.hidden = true; face.innerHTML = ''; if (opts.onChange) opts.onChange(''); } RT().people().then(draw); });
    input.addEventListener('keydown', (e) => {
      if (list.hidden && (e.key === 'ArrowDown')) { draw(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
        list.querySelectorAll('.is-hi').forEach((x) => x.classList.remove('is-hi'));
        const cur = list.children[hi];
        if (cur) { cur.classList.add('is-hi'); cur.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter' && !list.hidden && shown[hi]) { e.preventDefault(); choose(shown[hi].email); }
      else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); }
    });
    list.addEventListener('mousedown', (e) => { e.preventDefault(); });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-email]'); if (b) choose(b.dataset.email); });
    clear.addEventListener('click', () => { state.email = ''; input.value = ''; paint(); if (opts.onChange) opts.onChange(''); input.focus(); });
    input.addEventListener('blur', () => setTimeout(() => { close(); if (!state.email) input.value = ''; else paint(); }, 120));
    paint();
    return { get: () => state.email, set: (e) => { state.email = e || ''; paint(); } };
  }

  /** A sheet with a title, a body that scrolls and footer buttons. Resolves with the id of the button pressed, or null. */
  function sheet(opts) {
    const foot = (opts.buttons || [])
      .map((b) => `<button type="button" class="rt-btn${b.primary ? ' rt-btn--primary' : ''}${b.danger ? ' ob-danger' : ''}" data-ob-btn="${esc(b.id)}"${b.disabled ? ' disabled' : ''}>${esc(b.label)}</button>`)
      .join('');
    const html = `<div class="rt-sheet__head"><h2>${esc(opts.title)}</h2><button type="button" class="rt-x" data-ob-btn="" aria-label="Close">${ic('x')}</button></div><div class="ob-sheet__body">${opts.body || ''}</div><div class="rt-sheet__foot">${foot}</div>`;
    const done = RT().openSheet(html, opts.title);
    const el = document.querySelector('.rt-sheet');
    el.classList.add('ob-sheet');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ob-btn]');
      if (!b || b.disabled) return;
      const id = b.dataset.obBtn;
      if (!id) { RT().closeSheet(null); return; }
      if (opts.onButton) { opts.onButton(id, el, (v) => RT().closeSheet(v === undefined ? id : v)); return; }
      RT().closeSheet(id);
    });
    if (opts.onOpen) opts.onOpen(el);
    return done;
  }

  const kindWord = (k) => (k === 'offboard' ? 'Offboarding' : 'Onboarding');
  const dateWord = (r) => (r.kind === 'offboard' ? `Last day ${dayWord(r.date)}` : `Starts ${dayWord(r.date)}`);
  const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

  window.Onb = { ready, esc, api, today, dayWord, longDay, first, ic, toast, avatar, nameOf, personField, sheet, kindWord, dateWord, pct };
})();
