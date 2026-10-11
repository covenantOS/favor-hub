/* Request board tasks: the staff list and the people picker (Send to, Waiting on, the @ button, filter by person), as a sheet on a
   phone and a dialog on a desktop. Loaded on every hub page with request-drawer.js, so a request opens in place from Chat,
   Today, the bell and search. The comment box is the shared mention composer (public/js/chat/mention-input.js). */
(() => {
  'use strict';
  if (window.ReqTasks) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
  const phone = () => matchMedia('(max-width: 860px)').matches;

  /* ------------------------------------------------------------------ the staff list */
  let peopleP = null;
  const P = { list: [], by: new Map(), me: '' };
  function people() {
    if (!peopleP) {
      peopleP = fetch('/api/requests/people', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((d) => {
          P.list = (d && d.people) || [];
          P.me = (d && d.me) || '';
          P.by = new Map(P.list.map((p) => [p.email, p]));
          return P;
        })
        .catch(() => { peopleP = null; return P; });
    }
    return peopleP;
  }
  const person = (email) => P.by.get(String(email || '').toLowerCase()) || { email, name: String(email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), team: '', title: '', picture: '' };
  function avatar(email, size) {
    const p = person(email);
    const inner = p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" />` : esc(initials(p.name));
    return `<span class="rq-av${size ? ' rq-av--' + size : ''}" data-c="${COLORS[hash(String(email || '')) % 7]}">${inner}</span>`;
  }
  const sub = (p) => [p.team, p.title].filter(Boolean).join(' · ');
  // Every word typed must appear; a first name that starts with it comes first, then any name that does, then the rest.
  function match(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return P.list.slice();
    const rank = (p) => {
      const n = p.name.toLowerCase();
      if (n.startsWith(words[0])) return 0;
      if (n.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1;
      return 2;
    };
    return P.list
      .filter((p) => words.every((w) => `${p.name} ${p.email} ${p.team} ${p.title}`.toLowerCase().includes(w)))
      .map((p, i) => ({ p, i, r: rank(p) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.p);
  }

  /* ------------------------------------------------------------------ a sheet (phone) or dialog (desktop) */
  let sheet = null;
  let sheetTok = null;
  function closeSheet(result) {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (sheetTok && window.hubOv) { const t = sheetTok; sheetTok = null; window.hubOv.off(t); }
    s.el.remove();
    s.scrim.remove();
    document.documentElement.classList.remove('rt-sheet-open');
    s.resolve(result || null);
    if (s.ret && s.ret.focus) { try { s.ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
  }
  function openSheet(html, label) {
    closeSheet(null);
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'rt-scrim';
      const el = document.createElement('div');
      el.className = 'rt-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', label);
      el.innerHTML = html;
      document.body.append(scrim, el);
      document.documentElement.classList.add('rt-sheet-open');
      sheet = { el, scrim, resolve, ret: document.activeElement };
      scrim.addEventListener('click', () => closeSheet(null));
      if (window.hubOv) sheetTok = window.hubOv.on(() => { sheetTok = null; closeSheet(null); });
      fitKeyboard();
    });
  }
  // The sheet ends at the top of the on-screen keyboard, never under it.
  function fitKeyboard() {
    const vv = window.visualViewport;
    const bottom = vv ? Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) : 0;
    document.documentElement.style.setProperty('--rt-kb', bottom + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitKeyboard);
    window.visualViewport.addEventListener('scroll', fitKeyboard);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet) { e.stopPropagation(); closeSheet(null); }
  }, true);

  const rowHtml = (p, i, on) => `<button type="button" class="rt-person${on ? ' is-on' : ''}" role="option" data-email="${esc(p.email)}" data-i="${i}" aria-selected="${on ? 'true' : 'false'}">${avatar(p.email, 'sm')}<span class="rt-person__t"><b>${esc(p.name)}</b>${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</span>${on ? `<span class="rt-person__ok">${ic('check')}</span>` : ''}</button>`;

  /**
   * Pick a person. opts: title, current (email), exclude (emails), note (true: a second step asks for context and returns it),
   * noteLabel, action (button word), clear (a label for "nobody", returns {email: null}). Resolves to {email, note} or null.
   */
  async function pick(opts = {}) {
    await people();
    const exclude = new Set((opts.exclude || []).map((e) => String(e).toLowerCase()));
    const title = opts.title || 'Pick a person';
    const done = openSheet('', title);
    const el = sheet.el;
    let shown = [];
    let hi = 0;
    let picked = null;
    let query = '';
    const listStep = () => {
      picked = null;
      el.classList.remove('rt-sheet--note');
      el.innerHTML = `<div class="rt-sheet__head"><h2>${esc(title)}</h2><button type="button" class="rt-x" data-rt-close aria-label="Close">${ic('x')}</button></div>
        <div class="rt-search">${ic('search')}<input type="search" data-rt-q placeholder="Search by name or team" aria-label="Search by name or team" autocomplete="off" enterkeyhint="search" /></div>
        <div class="rt-people" role="listbox" data-rt-list aria-label="Staff"></div>
        ${opts.clear ? `<div class="rt-sheet__foot"><button type="button" class="rt-btn" data-rt-clear>${esc(opts.clear)}</button></div>` : ''}`;
      const q = el.querySelector('[data-rt-q]');
      const list = el.querySelector('[data-rt-list]');
      q.value = query;
      const draw = () => {
        shown = match(q.value).filter((p) => !exclude.has(p.email));
        hi = Math.min(hi, Math.max(0, shown.length - 1));
        list.innerHTML = shown.length ? shown.map((p, i) => rowHtml(p, i, p.email === opts.current)).join('') : '<p class="rt-none">Nobody on the staff list matches.</p>';
        const cur = list.children[hi];
        if (cur && cur.classList && shown.length && !phone()) cur.classList.add('is-hi');
      };
      draw();
      if (!phone()) setTimeout(() => q.focus(), 0);
      q.addEventListener('input', () => { query = q.value; hi = 0; draw(); });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
          list.querySelectorAll('.is-hi').forEach((x) => x.classList.remove('is-hi'));
          const cur = list.children[hi];
          if (cur) { cur.classList.add('is-hi'); cur.scrollIntoView({ block: 'nearest' }); }
        }
        if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); chosen(shown[hi].email); }
      });
    };
    const noteStep = (email) => {
      picked = email;
      const p = person(email);
      el.classList.add('rt-sheet--note');
      el.innerHTML = `<div class="rt-sheet__head"><button type="button" class="rt-x" data-rt-back aria-label="Back to the list">${ic('back')}</button><h2>${esc(title)}</h2><button type="button" class="rt-x" data-rt-close aria-label="Close">${ic('x')}</button></div>
        <div class="rt-to">${avatar(email)}<span class="rt-person__t"><b>${esc(p.name)}</b>${sub(p) ? `<small>${esc(sub(p))}</small>` : ''}</span></div>
        <label class="rt-label" for="rt-note">${esc(opts.noteLabel || 'Context')}</label>
        <textarea id="rt-note" class="rt-note" rows="5" maxlength="2000" placeholder="What ${esc(p.name.split(' ')[0])} needs to know"></textarea>
        <div class="rt-sheet__foot"><button type="button" class="rt-btn" data-rt-back>Back</button><button type="button" class="rt-btn rt-btn--primary" data-rt-send>${ic('send')}${esc(opts.action || 'Send')}</button></div>`;
      const ta = el.querySelector('#rt-note');
      setTimeout(() => ta.focus(), 30);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeSheet({ email, note: ta.value.trim() }); } });
    };
    const chosen = (email) => { if (opts.note) noteStep(email); else closeSheet({ email }); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-rt-close]')) { closeSheet(null); return; }
      if (e.target.closest('[data-rt-clear]')) { closeSheet({ email: null }); return; }
      if (e.target.closest('[data-rt-back]')) { listStep(); return; }
      if (e.target.closest('[data-rt-send]') && picked) { const ta = el.querySelector('#rt-note'); closeSheet({ email: picked, note: ta ? ta.value.trim() : '' }); return; }
      const b = e.target.closest('[data-email]');
      if (b) chosen(b.dataset.email);
    });
    listStep();
    return done;
  }

  const dayWord = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '');

  window.ReqTasks = { people, person, avatar, pick, openSheet, closeSheet, sub, dayWord, match, names: (id) => person(id).name, me: () => P.me, list: () => P.list, ic, esc };
})();
